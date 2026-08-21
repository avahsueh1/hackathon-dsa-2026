import type { CSSProperties, Dispatch, SetStateAction } from "react";

/** The 10pm typing problem: presets first, big +/- second, free entry last. */

const PRESETS = [10, 25, 50];

const TAP: CSSProperties = {
  width: "var(--tap-stepper)",
  height: "var(--tap-stepper)",
  flex: "none",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  background: "var(--surface-raised)",
  color: "var(--text)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--r-sm)",
  font: "var(--t-title)",
  lineHeight: 1,
};

interface Props {
  value: number;
  /* A setter, not a plain callback. Each tap has to derive the next value from
     the previous STATE rather than from the `value` prop: React does not flush
     between synchronous events, so hammering + at 10pm would otherwise have
     every tap read the same stale prop and only the last one would count. */
  onChange: Dispatch<SetStateAction<number>>;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  presets?: number[];
  label?: string;
}

export default function QuantityStepper({
  value,
  onChange,
  step = 5,
  min = 1,
  max = 5000,
  unit = "servings",
  presets = PRESETS,
  label = "What are you bringing?",
}: Props) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const set = (n: number) => onChange(clamp(n));
  const nudge = (delta: number) => onChange((prev) => clamp(prev + delta));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-3)" }}>
      <span
        style={{
          font: "var(--t-label)",
          letterSpacing: "var(--tracking-label)",
          textTransform: "uppercase",
          color: "var(--text-secondary)",
        }}
      >
        {label}
      </span>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--s-4)" }}>
        <button type="button" aria-label={`Fewer ${unit}`} style={TAP} onClick={() => nudge(-step)}>
          −
        </button>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--s-2)", minWidth: 0, flex: 1 }}>
          <span
            style={{
              fontFamily: "var(--font-num)",
              fontVariantNumeric: "tabular-nums",
              fontSize: "var(--t-title-size)",
              fontWeight: 650,
              color: "var(--text)",
            }}
          >
            ~{value}
          </span>
          <span style={{ font: "var(--t-caption)", color: "var(--text-secondary)" }}>{unit}</span>
        </div>
        <button type="button" aria-label={`More ${unit}`} style={TAP} onClick={() => nudge(step)}>
          +
        </button>
      </div>

      <div style={{ display: "flex", gap: "var(--s-2)", flexWrap: "wrap" }}>
        {presets.map((p) => {
          const on = p === value;
          return (
            <button
              key={p}
              type="button"
              onClick={() => set(p)}
              style={{
                minHeight: "var(--tap-min)",
                padding: "0 var(--s-4)",
                cursor: "pointer",
                borderRadius: "var(--r-full)",
                font: "var(--t-body)",
                fontFamily: "var(--font-num)",
                fontVariantNumeric: "tabular-nums",
                background: on ? "var(--amber-tint)" : "transparent",
                color: on ? "var(--amber-ink)" : "var(--text-secondary)",
                border: `1px solid ${on ? "var(--amber-solid)" : "var(--border-strong)"}`,
              }}
            >
              ~{p}
            </button>
          );
        })}
      </div>
    </div>
  );
}
