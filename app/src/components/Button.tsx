import { useState, type CSSProperties, type ReactNode } from "react";

/**
 * The one action on the screen. Amber solid, dark ink, 56px tall.
 * One primary button per screen.
 *
 * Ported from the design system's Button.jsx -- same variants, same padding
 * table, same press treatment.
 */

export type ButtonVariant = "primary" | "covered" | "secondary" | "quiet" | "danger";

const PAD: Record<ButtonVariant, string> = {
  primary: "0 24px",
  covered: "0 20px",
  secondary: "0 20px",
  quiet: "0 20px",
  danger: "0 20px",
};

const SKINS: Record<ButtonVariant, CSSProperties> = {
  primary: { background: "var(--amber-solid)", color: "var(--ink-on-solid)", border: "1px solid transparent" },
  covered: { background: "var(--mint-strong)", color: "#FFFFFF", border: "1px solid transparent" },
  secondary: { background: "transparent", color: "var(--text)", border: "1px solid var(--border-strong)" },
  quiet: { background: "transparent", color: "var(--text-secondary)", border: "1px solid transparent" },
  danger: { background: "transparent", color: "var(--danger)", border: "1px solid var(--danger)" },
};

interface Props {
  variant?: ButtonVariant;
  size?: "lg" | "md";
  fullWidth?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  style?: CSSProperties;
  "aria-label"?: string;
}

export default function Button({
  variant = "primary",
  size = "lg",
  fullWidth = false,
  disabled = false,
  disabledReason,
  children,
  onClick,
  type = "button",
  style,
  ...rest
}: Props) {
  const [pressed, setPressed] = useState(false);
  const height = size === "lg" ? "var(--tap-primary)" : "var(--tap-min)";

  const btn = (
    <button
      type={type}
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--s-2)",
        minHeight: height,
        height,
        width: fullWidth ? "100%" : "auto",
        minWidth: 0,
        padding: PAD[variant],
        font: size === "lg" ? "var(--t-body-lg)" : "var(--t-body)",
        borderRadius: "var(--r-md)",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "transform var(--dur-toast-in) var(--ease), filter var(--dur-toast-in) var(--ease)",
        transform: pressed && !disabled ? "scale(var(--press-scale))" : "none",
        filter: pressed && !disabled ? "brightness(0.94)" : "none",
        ...(disabled
          ? { background: "var(--surface-raised)", color: "var(--text-muted)", border: "1px solid var(--border)" }
          : SKINS[variant]),
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );

  // A disabled button that does not say why is a dead end. The design system
  // pairs the two, so the reason travels with the control.
  if (disabled && disabledReason) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--s-2)",
          width: fullWidth ? "100%" : "auto",
        }}
      >
        {btn}
        <span style={{ font: "var(--t-caption)", color: "var(--text-muted)" }}>{disabledReason}</span>
      </div>
    );
  }
  return btn;
}
