import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Polygon, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import type { Offer } from "../types";
import { ZONES, downtownBounds, zoneRings } from "../lib/zones";
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
function pingIcon(label: string, selected: boolean, soon: boolean): L.DivIcon {
  const fill = soon ? "var(--amber-solid)" : "transparent";
  const scale = selected ? 1.12 : 1;
  return L.divIcon({
    className: "ping-icon",
    html: `<div style="
        display:flex;flex-direction:column;align-items:center;gap:2px;
        transform:scale(${scale});transform-origin:bottom center;
        transition:transform 160ms cubic-bezier(.2,.8,.2,1)">
      <span style="
        padding:1px 5px;border-radius:999px;white-space:nowrap;
        background:rgba(14,20,22,.88);color:var(--amber-ink);
        font:700 10px/1.3 var(--font-ui);
        border:1px solid ${selected ? "var(--blue)" : "transparent"}">${label}</span>
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

function Fit({ focus, points }: { focus: Offer | null; points: [number, number][] }) {
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
      map.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
    } else {
      map.fitBounds(downtownBounds(), { padding: [16, 16] });
    }
    // `key` stands in for `points`, which is a fresh array every render.
  }, [map, focus, key]);   // eslint-disable-line react-hooks/exhaustive-deps

  return null;
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
  offers: Offer[];
  /** Stops this driver has already taken, drawn as the route. */
  route?: Offer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function PickupMap({ offers, route = [], selectedId, onSelect }: Props) {
  const pins = useMemo(
    () => offers.filter((o) => o.lat != null && o.lng != null),
    [offers],
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
  const soonCutoff = Date.now() + 2 * 60 * 60 * 1000;

  const allPoints = useMemo(
    () =>
      [...pins, ...stops].map((o) => [o.lat as number, o.lng as number] as [number, number]),
    [pins, stops],
  );

  return (
    <div className="pickupmap">
      <MapContainer
        bounds={downtownBounds()}
        zoomControl={false}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%", background: "var(--surface)" }}
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
          maxZoom={18}
        />

        {/* The zones, faint. Context for where the food is going, not the
            subject of this screen. */}
        {ZONES.zones.map((z) => (
          <Polygon
            key={z.id}
            positions={zoneRings(z)}
            interactive={false}
            pathOptions={{ color: "#5FA3F0", weight: 1, opacity: 0.35, fillOpacity: 0.05 }}
          />
        ))}

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

        {pins.map((o) => (
          <Marker
            key={o.id}
            position={[o.lat as number, o.lng as number]}
            icon={pingIcon(
              shortHour(o.pickup_from),
              o.id === selectedId,
              new Date(o.pickup_from).getTime() <= soonCutoff,
            )}
            eventHandlers={{ click: () => onSelect(o.id) }}
          />
        ))}

        <Fit focus={focus} points={allPoints} />
      </MapContainer>
    </div>
  );
}
