import Button from "./Button";

/** Never a shrug. An empty screen is an instruction. */

interface Props {
  headline: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function EmptyState({ headline, detail, actionLabel, onAction }: Props) {
  return (
    <div className="emptystate">
      <span className="emptystate-h">{headline}</span>
      {detail && <span className="emptystate-d">{detail}</span>}
      {actionLabel && (
        <div style={{ marginTop: "var(--s-2)" }}>
          <Button onClick={onAction}>{actionLabel}</Button>
        </div>
      )}
    </div>
  );
}
