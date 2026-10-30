/** Small number and time formats shared by the dashboard pages. */
export function compact(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
}

/** `3 days ago` style, from seconds since the epoch. */
export function ago(seconds: number, now = Date.now()): string {
  const diff = Math.max(0, now / 1000 - seconds);
  const units: [number, string][] = [
    [365 * 86_400, "year"],
    [30 * 86_400, "month"],
    [7 * 86_400, "week"],
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    const count = Math.floor(diff / size);
    if (count >= 1) return `${count} ${name}${count > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

export const percent = (share: number) => `${Math.round(share * 100)}%`;
