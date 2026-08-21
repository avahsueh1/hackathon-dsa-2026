/** "1 meal", "2 meals". The stepper reaches 1 whenever a zone is nearly
 *  covered, so this is a visible case, not a pedantic one. */
export function plural(n: number, one: string, many = one + "s"): string {
  return n === 1 ? one : many;
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function todayStamp(d = new Date()): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

export function clockTime(d = new Date()): string {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h % 12 || 12}:${m} ${h >= 12 ? "PM" : "AM"}`;
}

export function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
