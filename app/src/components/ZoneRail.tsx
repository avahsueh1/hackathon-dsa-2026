import type { Zone, ZoneStats } from "../types";
import { isCovered } from "../lib/zones";
import { corner } from "../lib/streets";
import { clockTime } from "../lib/format";

/**
 * The signature element. Tonight's zones hung on a wire like kitchen tickets:
 * mint = covered, amber = nobody going yet. It is the legend and the summary
 * at once, and it sits at the top of every screen.
 *
 * The design's rail divides the width evenly (minmax(0, 1fr)). That was drawn
 * against nine mock zones on a wide artboard; with eight real zones on a 390px
 * phone each ticket would be 44px and the cross-street unreadable. So the
 * tickets keep a legible fixed width and the wire scrolls sideways instead.
 */

interface Props {
  zones: Zone[];
  stats: ZoneStats;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  label?: string;
  /** On the map screen the badges already report coverage, so the big
   *  "N of 8 zones covered" header is repetition -- and on a phone it is
   *  repetition that costs the map about 70px of height. */
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
        <div className="rail-head">
          <span className="ss-label rail-eyebrow">{label}</span>
          <span className="ss-num rail-num">
            {covered} of {zones.length}
          </span>
          <span className="rail-caption">zones covered</span>
          <span className="ss-num rail-time">{clockTime()}</span>
        </div>
      )}

      <div className="rail-wire" role="list">
        <span aria-hidden="true" className="rail-line" />
        <div className="rail-tickets">
          {zones.map((z, i) => {
            const cov = isCovered(stats, z);
            const on = z.id === selectedId;
            return (
              <button
                key={z.id}
                role="listitem"
                type="button"
                onClick={() => onSelect?.(z.id)}
                title={`${z.name} — ${cov ? "covered" : "open"}`}
                className={`ticket${cov ? " covered" : ""}${on ? " on" : ""}`}
              >
                <span className="ticket-n">
                  <span aria-hidden="true" style={{ fontSize: 11 }}>
                    {cov ? "◉" : "○"}
                  </span>
                  {i + 1}
                </span>
                <span className="ticket-place">{corner(z.landmark.a, z.landmark.b)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
