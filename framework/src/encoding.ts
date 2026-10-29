/** Pick an available coding, honoring explicit exclusions and quality weights.
 * Identity is the fallback unless the client explicitly weights or rejects it. */
export function selectEncoding(header: string | null, brotli: boolean, gzip: boolean): "br" | "gzip" | "identity" | null {
  if (!header?.trim()) return "identity";
  let br: number | undefined, gz: number | undefined, identity: number | undefined, wildcard: number | undefined;
  for (const item of header.toLowerCase().split(",")) {
    const [name, ...parameters] = item.trim().split(";");
    let quality = 1;
    for (const parameter of parameters) {
      const [key, value = ""] = parameter.trim().split("=");
      if (key.trim() === "q") quality = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value.trim()) ? Number(value) : 0;
    }
    if (name.trim() === "br") br = quality;
    else if (name.trim() === "gzip") gz = quality;
    else if (name.trim() === "identity") identity = quality;
    else if (name.trim() === "*") wildcard = quality;
  }
  const b = brotli ? br ?? wildcard ?? 0 : 0;
  const g = gzip ? gz ?? wildcard ?? 0 : 0;
  if (identity !== undefined && identity > Math.max(b, g)) return "identity";
  if (b > 0 && b >= g) return "br";
  if (g > 0) return "gzip";
  return (identity ?? (wildcard === 0 ? 0 : 1)) > 0 ? "identity" : null;
}
