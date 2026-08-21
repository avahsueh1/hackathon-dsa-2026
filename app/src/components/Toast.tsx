import { useEffect } from "react";

/** One line, four seconds. The verb matches the button exactly: Claim -> Claimed. */

interface Props {
  message: string;
  tone?: "covered" | "open" | "danger";
  open?: boolean;
  onDismiss?: () => void;
  duration?: number;
}

export default function Toast({ message, tone = "covered", open = true, onDismiss, duration = 4000 }: Props) {
  useEffect(() => {
    if (!open || !onDismiss) return;
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
  }, [open, onDismiss, duration, message]);

  if (!open) return null;

  const ink = tone === "danger" ? "var(--danger)" : tone === "open" ? "var(--amber-ink)" : "var(--mint-ink)";

  return (
    <div role="status" className="toast">
      <span aria-hidden="true" style={{ color: ink, fontSize: 12 }}>
        {tone === "covered" ? "◉" : "○"}
      </span>
      <span>{message}</span>
    </div>
  );
}
