import { Fragment, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Polygon, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import type { Claim, Zone } from "../types";
import { coverage, zoneRings, zoneCenter, downtownBounds } from "../lib/zones";

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

/** The coverage donut that hangs over each zone. */
function badgeIcon(n: number, pct: number): L.DivIcon {
  const t = tierOf(pct);
  const r = 15;
  const c = 2 * Math.PI * r;
  const html = `<div style="width:60px;display:flex;flex-direction:column;align-items:center">
    <svg width="42" height="42" viewBox="0 0 42 42" style="display:block">
      <circle cx="21" cy="21" r="20" fill="rgba(14,20,22,.82)"/>
      <circle cx="21" cy="21" r="${r}" fill="none" stroke="rgba(240,243,242,.18)" stroke-width="4"/>
      <circle cx="21" cy="21" r="${r}" fill="none" stroke="${t.ring}" stroke-width="4" stroke-linecap="round"
        stroke-dasharray="${(c * pct).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 21 21)"/>
      <text x="21" y="21" text-anchor="middle" dominant-baseline="central" fill="${t.ink}"
        style="font:600 12px/1 var(--font-ui)">${Math.round(pct * 100)}%</text>
    </svg>
    <span style="margin-top:3px;padding:1px 6px;border-radius:999px;background:rgba(14,20,22,.82);
      color:${t.ink};font:600 11px/1.4 var(--font-ui);letter-spacing:.06em;white-space:nowrap">ZONE ${n}</span>
  </div>`;
  return L.divIcon({ className: "zone-badge", html, iconSize: [60, 62], iconAnchor: [30, 21] });
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
  claims: Claim[];
  focus?: Zone | null;
  onSelect?: (id: string) => void;
  showLegend?: boolean;
}

export default function ZoneMap({ zones, claims, focus = null, onSelect, showLegend = true }: Props) {
  const shapes = useMemo(
    () =>
      zones.map((z, i) => ({
        zone: z,
        n: i + 1,
        pct: coverage(claims, z),
        rings: zoneRings(z),
        center: zoneCenter(z),
      })),
    [zones, claims],
  );

  return (
    <div className="mapwrap">
      <div className="mapbox">
        <MapContainer
          bounds={downtownBounds()}
          scrollWheelZoom={false}
          zoomControl
          style={{ height: "100%", width: "100%", background: "var(--surface)" }}
        >
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
            maxZoom={18}
          />

          {shapes.map(({ zone, n, pct, rings, center }) => {
            const t = tierOf(pct);
            const on = focus?.id === zone.id;
            return (
              <Fragment key={zone.id}>
                <Polygon
                  positions={rings}
                  eventHandlers={{ click: () => onSelect?.(zone.id) }}
                  pathOptions={{
                    color: on ? "#5FA3F0" : t.ring,
                    weight: on ? 3 : 2,
                    fillColor: t.fill,
                    fillOpacity: t.fillOpacity,
                  }}
                />
                <Marker
                  position={center}
                  icon={badgeIcon(n, pct)}
                  eventHandlers={{ click: () => onSelect?.(zone.id) }}
                />
              </Fragment>
            );
          })}

          <Fit focus={focus} />
        </MapContainer>
      </div>

      {showLegend && (
        <div className="maplegend">
          <span>
            <span style={{ color: "var(--mint-ink)" }}>◉</span> fully covered
          </span>
          <span>
            <span style={{ color: "var(--amber-ink)" }}>◐</span> partly covered
          </span>
          <span>
            <span style={{ color: "#FF9A73" }}>○</span> nobody going yet
          </span>
        </div>
      )}
    </div>
  );
}
