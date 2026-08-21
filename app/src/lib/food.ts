export const DROP_WINDOWS = [
  "Tonight, 7-8pm",
  "Tonight, 8-9pm",
  "Tonight, 9-10pm",
  "Tonight, after 10pm",
] as const;

/** Rough conversion for the SB 1383 log. One serving is about 1.3 lb of food. */
export const LBS_PER_MEAL = 1.3;

/** Pickup windows a kitchen can actually promise at the end of service.
 *  Values are hours in 24h local time. */
export const PICKUP_WINDOWS: { label: string; from: number; to: number }[] = [
  { label: "5-6pm", from: 17, to: 18 },
  { label: "6-7pm", from: 18, to: 19 },
  { label: "7-8pm", from: 19, to: 20 },
  { label: "8-9pm", from: 20, to: 21 },
  { label: "9-10pm", from: 21, to: 22 },
  { label: "After 10pm", from: 22, to: 23 },
];

/** Today at a given hour, as an ISO timestamp. */
export function todayAt(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export function windowLabel(fromIso: string, toIso: string): string {
  const f = new Date(fromIso);
  const t = new Date(toIso);
  const hh = (d: Date) => {
    const h = d.getHours();
    const m = d.getMinutes();
    const base = `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}`;
    return base + (h >= 12 ? "pm" : "am");
  };
  return `${hh(f)}-${hh(t)}`;
}

/** "9p" — a map pin only has room to say roughly when, and six full windows
 *  written out collide into an unreadable pile over East Village. The list and
 *  the detail card carry the exact window. */
export function shortHour(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  return `${h % 12 || 12}${h >= 12 ? "p" : "a"}`;
}
