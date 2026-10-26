export const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function ago(iso: string, now = Date.now()) {
  const s = (new Date(iso).getTime() - now) / 1000;
  for (const [u, n] of [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]] as const) {
    if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  }
  return "just now";
}

export const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

export function duration(sec: number) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d) return `${plural(d, "day")} ${plural(h, "hour")}`;
  if (h) return `${plural(h, "hour")} ${plural(m, "minute")}`;
  if (m) return plural(m, "minute");
  return plural(sec, "second");
}
