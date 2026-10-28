// HTTPS image downloads: validate every redirect and the exact addresses used by the socket.
import { lookup } from "node:dns";
import { request } from "node:https";
import { isIP } from "node:net";

export const MAX_IMAGE_BYTES = 20 << 20;
export class ImageDownloadError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  // Only global unicast, excluding special-use and transition ranges. This also excludes
  // IPv4-mapped, NAT64, link-local, ULA, loopback and multicast addresses.
  if (isIP(address) !== 6) return false;
  const groups = address.toLowerCase().split(":");
  const first = parseInt(groups[0], 16), second = parseInt(groups[1] || "0", 16);
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 &&
    !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
}

/** Stop reading at the byte budget, including chunked bodies and dishonest lengths. */
export async function readImageBody(body: AsyncIterable<Uint8Array>, limit = MAX_IMAGE_BYTES): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > limit) throw new ImageDownloadError("image too large", 413);
    chunks.push(chunk);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
  return out;
}

export async function fetchRemoteImage(initial: URL, allowed: string[], open = openImage): Promise<{ body: Uint8Array; type: string }> {
  const signal = AbortSignal.timeout(8000);
  let url = initial;
  for (let hop = 0; hop <= 3; hop++) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password ||
        !allowed.includes(url.hostname) || (isIP(host) && !isPublicAddress(host))) {
      throw new ImageDownloadError("image destination is not allowed", 403);
    }
    const res = await open(url, signal);
    if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
      const location = res.headers.location;
      res.destroy();
      if (!location || hop === 3) throw new ImageDownloadError("too many image redirects");
      url = new URL(location, url);
      continue;
    }
    try {
      if (res.statusCode !== 200) throw new ImageDownloadError("couldn't fetch the image");
      const len = res.headers["content-length"];
      if (len && (!/^\d+$/.test(len) || Number(len) > MAX_IMAGE_BYTES)) throw new ImageDownloadError("image too large", 413);
      const type = res.headers["content-type"] ?? "";
      if (!/^image\//i.test(type)) throw new ImageDownloadError("source is not an image", 415);
      return { body: await readImageBody(res), type };
    } finally { res.destroy(); }
  }
  throw new ImageDownloadError("too many image redirects");
}

async function openImage(url: URL, signal: AbortSignal): Promise<import("node:http").IncomingMessage> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
    const req = request(url, {
      signal,
      // Node's TLS connection consumes this very lookup result; no second DNS resolution.
      lookup: (_host, options, callback) => lookup(host, { all: true, verbatim: true }, (err, addresses) => {
        if (err) return callback(err, "", 4);
        if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
          return callback(new ImageDownloadError("image address is not public", 403), "", 4);
        }
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      }),
    }, resolve);
    req.on("error", reject);
    req.end();
  });
}
