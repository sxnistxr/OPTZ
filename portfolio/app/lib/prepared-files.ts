import { brotliCompressSync, constants as zc, gzipSync } from "node:zlib";

export type PreparedFile = { name: string; encoding: "identity" | "br" | "gzip"; bytes: Uint8Array };

/** One page as `optz build` leaves it: the HTML and its compressed copies, at the build's settings. */
export function preparedFiles(html: string, name = "index.html"): PreparedFile[] {
  const source = new TextEncoder().encode(html);
  return [
    { name, encoding: "identity", bytes: source },
    { name: `${name}.br`, encoding: "br", bytes: new Uint8Array(brotliCompressSync(source, { params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_SIZE_HINT]: source.length } })) },
    { name: `${name}.gz`, encoding: "gzip", bytes: new Uint8Array(gzipSync(source, { level: 9 })) },
  ];
}

/** A hex dump: a four-digit offset, then up to `perRow` bytes as pairs. */
export function hexRows(bytes: Uint8Array, perRow = 10): string {
  const rows: string[] = [];
  for (let at = 0; at < bytes.length; at += perRow) {
    const pairs = Array.from(bytes.subarray(at, at + perRow), byte => byte.toString(16).padStart(2, "0"));
    rows.push(`${at.toString(16).padStart(4, "0")}  ${pairs.join(" ")}`);
  }
  return rows.join("\n");
}
