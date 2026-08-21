import type { Zone, ZoneStats } from "../types";
import { coverage, isCovered } from "../lib/zones";
import { corner } from "../lib/streets";
import { clockTime } from "../lib/format";
import ProgressRing from "./ProgressRing";

/**
 * The signature element. Tonight's zones hung on a wire like kitchen tickets:
 * mint = covered, amber = nobody going yet. It is the legend and the summary
 * at once, and it sits at the top of every screen.
 *
 * Each ticket is a coverage donut with the percentage inside and the corner
 * underneath -- the shape the map badges used, which reads better here where
 * eight of them line up and can be compared than scattered over tiles where
 * they overlapped each other.
 *
 * A grid rather than the design's evenly-divided row: with eight real zones on
 * a phone, even division gives each one 44px, and a sideways scroller turned
 * the summary into a task.
 */

interface Props {
  zones: Zone[];
  stats: ZoneStats;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  label?: string;
  /** On the map screen the tiles carry the detail, so the big
   *  "N of 8 zones covered" header collapses to one line. */
  compact?: boolean;
}

export default function ZoneRail({
  zones,
  stats,
  selectedId,
  onSelect,
  label = "Tonight",
  compact = false,
}: Props) {
  const covered = zones.filter((z) => isCovered(stats, z)).length;

  return (
    <div className={`rail${compact ? " compact" : ""}`}>
      {compact ? (
        <div className="rail-head">
          <span className="ss-label rail-eyebrow">
            {label} · {covered} of {zones.length} covered
          </span>
          <span className="ss-num rail-time">{clockTime()}</span>
        </div>
      ) : (
        <>
          <div className="rail-head">
            <span className="ss-label rail-eyebrow">{label}</span>
            <span className="ss-num rail-time">{clockTime()}</span>
          </div>
          <div className="rail-summary">
            <span className="ss-num rail-num">
              {covered} of {zones.length}
            </span>
            <span className="rail-caption">zones covered</span>
          </div>
        </>
      )}

      <div className="rail-wire" role="list">
        <span aria-hidden="true" className="rail-line" />
        <div className="rail-tickets">
          {zones.map((z) => {
            const cov = isCovered(stats, z);
            const pct = coverage(stats, z);
            const on = z.id === selectedId;
            return (
              <button
                key={z.id}
                role="listitem"
                type="button"
                onClick={() => onSelect?.(z.id)}
                title={`${z.name} — ${Math.round(pct * 100)}% covered`}
                className={`ticket${cov ? " covered" : ""}${on ? " on" : ""}`}
              >
                <ProgressRing value={pct} covered={cov} size={compact ? 34 : 42} />
                <span className="ticket-place">{corner(z.landmark.a, z.landmark.b)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
