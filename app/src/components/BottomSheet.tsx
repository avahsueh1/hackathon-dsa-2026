import { useEffect, type CSSProperties, type ReactNode } from "react";

/**
 * Rises from the map when a zone is tapped. Rounded top corners only, the one
 * lifting shadow in the system, three snap points.
 *
 * Positioned absolute rather than fixed: the app renders into a 9:16 phone
 * frame, and a fixed sheet would escape it and cover the whole browser window.
 */

export type Snap = "peek" | "half" | "full";

const HEIGHTS: Record<Snap, string> = { peek: "30%", half: "58%", full: "92%" };

interface Props {
  open?: boolean;
  snap?: Snap;
  onSnapChange?: (s: Snap) => void;
  onClose?: () => void;
  children: ReactNode;
  style?: CSSProperties;
  label?: string;
}

export default function BottomSheet({
  open = true,
  snap = "half",
  onSnapChange,
  onClose,
  children,
  style,
  label,
}: Props) {
  // The close control sits at the top of a scrolling sheet and is not always
  // reachable one-handed, so Escape has to work too.
  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const cycle = () => onSnapChange?.(snap === "peek" ? "half" : snap === "half" ? "full" : "peek");

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="sheet"
        /* max, not fixed: a short flow hugs its content instead of leaving
           a stretch of empty panel under the last control. */
        style={{ maxHeight: HEIGHTS[snap], ...style }}
      >
        <button
          type="button"
          aria-label="Resize sheet"
          onClick={cycle}
          className="sheet-grabhit"
        >
          <span className="sheet-grab" />
        </button>

        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="sheet-close">
            ×
          </button>
        )}

        <div className="sheet-body">{children}</div>
      </section>
    </>
  );
}
