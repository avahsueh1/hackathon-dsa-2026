import type { CSSProperties, ReactNode } from "react";

/** Status never by colour alone: every pill carries a glyph and a word. */

export type PillStatus = "open" | "covered" | "unconfirmed";
export type NeedLevel = "highest" | "high" | "steady";

interface Props {
  status?: PillStatus;
  need?: NeedLevel;
  children?: ReactNode;
  style?: CSSProperties;
}

export default function StatusPill({ status = "open", need, children, style }: Props) {
  const covered = status === "covered";
  const unconfirmed = status === "unconfirmed";
  const glyph = covered || unconfirmed ? "◉" : "○";

  const skin: CSSProperties = covered
    ? { background: "var(--mint-tint)", color: "var(--mint-ink)", border: "1px solid var(--mint-solid)" }
    : unconfirmed
      ? { background: "var(--mint-tint)", color: "var(--mint-ink)", border: "1px solid var(--amber-solid)" }
      : need === "highest"
        ? { background: "var(--amber-solid)", color: "var(--ink-on-solid)", border: "1px solid var(--highest)" }
        : need === "high"
          ? { background: "var(--amber-tint)", color: "var(--amber-ink)", border: "1px solid var(--amber-solid)" }
          : { background: "transparent", color: "var(--amber-ink)", border: "1px solid var(--amber-solid)" };

  const label =
    children ??
    (covered
      ? "Covered"
      : unconfirmed
        ? "Claimed · unconfirmed"
        : need === "highest"
          ? "Open · highest need"
          : need === "high"
            ? "Open · high need"
            : "Open");

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--s-2)",
        padding: "var(--s-1) var(--s-3)",
        borderRadius: "var(--r-full)",
        font: "var(--t-label)",
        letterSpacing: "var(--tracking-label)",
        textTransform: "uppercase",
        // The figure beside this pill is also nowrap, so let the row wrap
        // rather than push it out of the card.
        whiteSpace: "nowrap",
        ...skin,
        ...style,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 11, lineHeight: 1 }}>
        {glyph}
      </span>
      {label}
    </span>
  );
}
