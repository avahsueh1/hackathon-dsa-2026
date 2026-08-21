/**
 * A coverage donut. Percentage in the middle, nothing else.
 *
 * This is the shape the zone badges used on the map; it reads better in the
 * rail, where eight of them line up and can be compared at a glance, than
 * scattered over tiles where they overlapped each other.
 */

interface Props {
  /** 0..1 */
  value: number;
  covered: boolean;
  size?: number;
  stroke?: number;
}

export default function ProgressRing({ value, covered, size = 42, stroke = 4 }: Props) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  const ink = covered ? "var(--mint-ink)" : "var(--amber-ink)";
  const arc = covered ? "var(--mint-solid)" : "var(--amber-solid)";

  return (
    <svg
      className="ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        /* Strong enough to read as a ring at 0%, where there is no arc at all. */
        stroke="var(--border-strong)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={arc}
        strokeWidth={stroke}
        strokeLinecap="round"
        /* A zero-length dash with a round cap still paints a dot, which reads
           as "something is coming" on a zone where nothing is. */
        strokeDasharray={`${(c * pct).toFixed(2)} ${c.toFixed(2)}`}
        opacity={pct === 0 ? 0 : 1}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray var(--dur-flip) var(--ease), stroke var(--dur-flip) var(--ease)" }}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fill={ink}
        style={{ font: "600 11px/1 var(--font-ui)" }}
      >
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}
