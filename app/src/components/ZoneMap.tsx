import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Polygon, useMap } from "react-leaflet";
import type { Zone, ZoneStats } from "../types";
import { coverage, zoneRings, downtownBounds } from "../lib/zones";

/* NOTE: §8 of the design system says "flat shapes, no basemap tiles". This
   screen deliberately overrides it, exactly as the design's own
   ZoneLeafletMap.jsx does -- and for the same reason: the streets are how a
   driver finds the corner. In field mode the tiles are desaturated in CSS so
   amber and mint stay the only saturated things on the screen.

   Unlike the design's version, the polygons here are the real block geometry
   from the pipeline rather than a synthetic box around a centroid. */

interface Tier {
  ring: string;
  ink: string;
  fill: string;
  fillOpacity: number;
}

/* Three steps of coverage. Ember (#C0491A), not --danger: red is reserved for
   destructive actions and is never a need level (§4.1). */
function tierOf(pct: number): Tier {
  if (pct >= 0.999) return { ring: "#2FB37D", ink: "#5FD3A2", fill: "#2FB37D", fillOpacity: 0.28 };
  if (pct > 0) return { ring: "#F0A315", ink: "#FFC24D", fill: "#F0A315", fillOpacity: 0.3 };
  return { ring: "#C0491A", ink: "#FF9A73", fill: "#C0491A", fillOpacity: 0.34 };
}

/** Leaflet needs a real size; inside a flex column it can mount at 0px and
 *  render grey until something happens to resize the window. */
function Fit({ focus }: { focus: Zone | null }) {
  const map = useMap();

  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    map.invalidateSize();
    return () => ro.disconnect();
  }, [map]);

  useEffect(() => {
    if (focus) {
      const pts = zoneRings(focus).flat();
      if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 });
    } else {
      map.fitBounds(downtownBounds(), { padding: [16, 16] });
    }
  }, [map, focus]);

  return null;
}

interface Props {
  zones: Zone[];
  stats: ZoneStats;
  focus?: Zone | null;
  onSelect?: (id: string) => void;
  /** The landing page shows the map as a picture of downtown, not a control.
   *  Zoom buttons and drag there invite fiddling with something that has no
   *  answer behind it. */
  interactive?: boolean;
}

export default function ZoneMap({ zones, stats, focus = null, onSelect, interactive = true }: Props) {
  const shapes = useMemo(
    () =>
      zones.map((z) => ({
        zone: z,
        pct: coverage(stats, z),
        rings: zoneRings(z),
      })),
    [zones, stats],
  );

  return (
    <div className="mapwrap">
      <div className="mapbox">
        <MapContainer
          bounds={downtownBounds()}
          scrollWheelZoom={false}
          zoomControl={interactive}
          dragging={interactive}
          touchZoom={interactive}
          doubleClickZoom={interactive}
          keyboard={interactive}
          attributionControl
          style={{ height: "100%", width: "100%", background: "var(--surface)" }}
        >
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
            maxZoom={18}
          />

          {shapes.map(({ zone, pct, rings }) => {
            const t = tierOf(pct);
            const on = focus?.id === zone.id;
            return (
              <Polygon
                key={zone.id}
                positions={rings}
                eventHandlers={{ click: () => onSelect?.(zone.id) }}
                pathOptions={{
                  color: on ? "#5FA3F0" : t.ring,
                  weight: on ? 3 : 2,
                  fillColor: t.fill,
                  fillOpacity: on ? t.fillOpacity + 0.12 : t.fillOpacity,
                }}
              />
            );
          })}

          <Fit focus={focus} />
        </MapContainer>
      </div>

    </div>
  );
}
