import { Fragment, useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polygon,
  Polyline,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import type { Pickup, ZoneStats } from "../types";
import { ZONES, coverage, downtownBounds, isCovered, zoneRings } from "../lib/zones";
import { corner } from "../lib/streets";
import { shortHour } from "../lib/food";

/**
 * Where food is ready, and when.
 *
 * A ping per restaurant carrying its pickup time, over a faint outline of the
 * zones so a driver can see at a glance whether a run starts near the places
 * that need feeding. Selecting one lifts it; the detail card lives below the
 * map, not in a popup, so it stays put while you look around.
 */

/**
 * Amber for every open pickup, because that is what amber means everywhere
 * else in this app: nobody has taken it yet. Mint is reserved for covered,
 * and using it for "collect later" made six untaken runs look done.
 *
 * Urgency is carried by weight instead -- a pickup in the next two hours gets
 * the solid pin, a later one a hollow ring.
 */
function pingIcon(label: string, selected: boolean, soon: boolean, withTime: boolean): L.DivIcon {
  const fill = soon ? "var(--amber-solid)" : "transparent";
  const scale = selected ? 1.12 : 1;
  return L.divIcon({
    className: "ping-icon",
    html: `<div style="
        display:flex;flex-direction:column;align-items:center;gap:2px;
        transform:scale(${scale});transform-origin:bottom center;
        transition:transform 160ms cubic-bezier(.2,.8,.2,1)">
      ${
        withTime || selected
          ? `<span style="
        padding:1px 5px;border-radius:999px;white-space:nowrap;
        background:rgba(14,20,22,.88);color:var(--amber-ink);
        font:700 10px/1.3 var(--font-ui);
        border:1px solid ${selected ? "var(--blue)" : "transparent"}">${label}</span>`
          : ""
      }
      <span style="
        display:block;width:15px;height:15px;border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);background:${fill};
        border:2px solid ${selected ? "var(--blue)" : "var(--amber-solid)"};
        box-shadow:0 2px 6px rgba(0,0,0,.45)"></span>
    </div>`,
    iconSize: [64, 40],
    iconAnchor: [32, 40],
  });
}

function Fit({ focus, points }: { focus: Pickup | null; points: [number, number][] }) {
  const map = useMap();

  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    map.invalidateSize();
    return () => ro.disconnect();
  }, [map]);

  // Zoom to a selected pin; otherwise frame everything there is to see.
  // Without the second half the map stayed wherever the last selection left
  // it, so clearing the selection showed one stop out of six.
  const key = points.map((p) => p.join()).join("|");

  useEffect(() => {
    if (focus && focus.lat != null && focus.lng != null) {
      map.setView([focus.lat, focus.lng], Math.max(map.getZoom(), 15), { animate: true });
    } else if (points.length > 0) {
      // Capped one step below the label threshold on purpose: fitting to
      // exactly 15 meant the overview always rendered every time pill and
      // zone name, which is the pile-up this was meant to avoid.
      map.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
    } else {
      map.fitBounds(downtownBounds(), { padding: [16, 16] });
    }
    // `key` stands in for `points`, which is a fresh array every render.
  }, [map, focus, key]);   // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/**
 * Detail thresholds.
 *
 * At 15 you still see all eight zones at once, so eight name plates and six
 * time pills land in a heap over East Village -- the overlay is legible but
 * the labels are not. At 16 the viewport holds three or four zones, which is
 * when a name has somewhere to sit.
 *
 * The coloured overlay is not gated at all: knowing which zones are short is
 * useful at every zoom, and a filled shape never collides with anything.
 */
const NAME_ZOOM = 16;
const TIME_ZOOM = 16;

/* Three steps of coverage, the same scale the zone map uses. Ember (#C0491A),
   not --danger: red is reserved for destructive actions and is never a need
   level. */
function zoneTier(pct: number, covered: boolean) {
  if (covered) return { line: "#2FB37D", fill: "#2FB37D", ink: "#5FD3A2", op: 0.22 };
  if (pct > 0) return { line: "#F0A315", fill: "#F0A315", ink: "#FFC24D", op: 0.2 };
  return { line: "#C0491A", fill: "#C0491A", ink: "#FF9A73", op: 0.22 };
}

/**
 * The zone's number, and its cross-street once there is room for it.
 *
 * Downtown's eight zones sit within about two kilometres of each other, so at
 * the default zoom eight name plates land on top of one another and on top of
 * the pickup pings -- less readable than the faint outlines they replaced.
 * The number always shows; the name waits until you have zoomed in far enough
 * for it to have somewhere to go.
 */
function zoneLabel(n: number, name: string, ink: string, withName: boolean): L.DivIcon {
  const plate = withName
    ? `<span style="
        margin-top:1px;padding:1px 5px;border-radius:4px;background:rgba(14,20,22,.72);
        color:${ink};font:600 9px/1.25 var(--font-ui)">${name}</span>`
    : "";
  return L.divIcon({
    className: "zone-label",
    html: `<div style="
        display:flex;flex-direction:column;align-items:center;
        width:${withName ? 96 : 20}px;text-align:center;pointer-events:none">
      <span style="
        display:grid;place-items:center;width:18px;height:18px;border-radius:50%;
        background:rgba(14,20,22,.8);color:${ink};
        border:1px solid ${ink};font:700 10px/1 var(--font-ui)">${n}</span>
      ${plate}
    </div>`,
    iconSize: [withName ? 96 : 20, withName ? 34 : 18],
    iconAnchor: [withName ? 48 : 10, withName ? 17 : 9],
  });
}

/**
 * The pickup pings. Their time pill follows the same rule as the zone names:
 * eight of them within two kilometres pile onto each other and onto the zone
 * numbers at the default zoom. The pin always shows, the time waits for room
 * -- except on the selected one, which you have asked about.
 */
function PinLayer({
  pins,
  selectedId,
  onSelect,
}: {
  pins: Pickup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const zoom = useZoom();
  const soonCutoff = Date.now() + 2 * 60 * 60 * 1000;

  return (
    <>
      {pins.map((o) => (
        <Marker
          key={o.id}
          position={[o.lat as number, o.lng as number]}
          icon={pingIcon(
            shortHour(o.pickup_from),
            o.id === selectedId,
            new Date(o.pickup_from).getTime() <= soonCutoff,
            zoom >= TIME_ZOOM,
          )}
          eventHandlers={{ click: () => onSelect(o.id) }}
        />
      ))}
    </>
  );
}

/** Zoom, as state, so the labels can decide whether they fit. */
function useZoom(): number {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({
    zoomend() {
      setZoom(map.getZoom());
    },
  });
  return zoom;
}

/** Everything that depends on how far in you are. Split into its own child so
 *  a zoom does not re-render the tile layer with it. */
function ZoneLayer({ stats }: { stats?: ZoneStats }) {
  const zoom = useZoom();
  const named = zoom >= NAME_ZOOM;

  return (
    <>
      {ZONES.zones.map((z, i) => {
        const pct = stats ? coverage(stats, z) : 0;
        const covered = stats ? isCovered(stats, z) : false;
        const t = zoneTier(pct, covered);
        return (
          <Fragment key={z.id}>
            <Polygon
              positions={zoneRings(z)}
              interactive={false}
              pathOptions={{
                color: t.line,
                weight: 1,
                opacity: 0.55,
                fillColor: t.fill,
                fillOpacity: t.op,
              }}
            />
            <Marker
              position={[z.centroid[1], z.centroid[0]]}
              icon={zoneLabel(i + 1, corner(z.landmark.a, z.landmark.b), t.ink, named)}
              interactive={false}
            />
          </Fragment>
        );
      })}
    </>
  );
}

/** A stop already on the route: numbered, mint, joined by the run line. */
function stopIcon(n: number): L.DivIcon {
  return L.divIcon({
    className: "ping-icon",
    html: `<div style="
        display:grid;place-items:center;width:26px;height:26px;border-radius:50%;
        background:var(--mint-solid);color:var(--ink-on-solid);
        font:700 12px/1 var(--font-ui);
        border:2px solid var(--ink-on-solid);box-shadow:0 2px 6px rgba(0,0,0,.45)"
      >${n}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

interface Props {
  pickups: Pickup[];
  /** Stops this driver has already taken, drawn as the route. */
  route?: Pickup[];
  /** Coverage per zone, so the drop-offs are coloured by what they still
   *  need rather than being anonymous outlines. */
  stats?: ZoneStats;
  /** Zoom buttons. On at full size, off on the 160px route previews, where
   *  they would cover a quarter of the map to no purpose. */
  controls?: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function PickupMap({
  pickups,
  route = [],
  stats,
  controls = true,
  selectedId,
  onSelect,
}: Props) {
  const pins = useMemo(
    () => pickups.filter((p) => p.lat != null && p.lng != null),
    [pickups],
  );

  // In pickup-time order, which is the order you would actually drive it.
  const stops = useMemo(
    () =>
      route
        .filter((o) => o.lat != null && o.lng != null)
        .sort((a, b) => a.pickup_from.localeCompare(b.pickup_from)),
    [route],
  );

  const line = useMemo(
    () => stops.map((o) => [o.lat as number, o.lng as number] as [number, number]),
    [stops],
  );

  const focus = pins.find((o) => o.id === selectedId) ?? null;

  const allPoints = useMemo(
    () =>
      [...pins, ...stops].map((o) => [o.lat as number, o.lng as number] as [number, number]),
    [pins, stops],
  );

  return (
    <div className="pickupmap">
      <MapContainer
        bounds={downtownBounds()}
        zoomControl={controls}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%", background: "var(--surface)" }}
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
          maxZoom={18}
        />

        {/* The drop-offs: every zone, coloured by how covered it is. Muted
            against the pickup pings, which are what this screen is for. */}
        <ZoneLayer stats={stats} />

        {/* The run so far: a dashed line through the stops in driving order. */}
        {line.length > 1 && (
          <Polyline
            positions={line}
            interactive={false}
            pathOptions={{ color: "#2FB37D", weight: 3, opacity: 0.9, dashArray: "6 6" }}
          />
        )}

        {stops.map((o, i) => (
          <Marker
            key={`stop-${o.id}`}
            position={[o.lat as number, o.lng as number]}
            icon={stopIcon(i + 1)}
            eventHandlers={{ click: () => onSelect(o.id) }}
          />
        ))}

        <PinLayer pins={pins} selectedId={selectedId} onSelect={onSelect} />

        <Fit focus={focus} points={allPoints} />
      </MapContainer>
    </div>
  );
}
