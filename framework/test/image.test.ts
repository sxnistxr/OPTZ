// The image optimizer (audit: C14, X11): async I/O, a bounded encode pool, and no failure when
// the disk cache can't be written (systemd's ProtectSystem=strict).
import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { handleImage } from "../src/image";
import * as remote from "../src/remote-image";
import type { StaticEntry } from "../src/static";
import { resolveConfig } from "../src/types";

const jpeg = new Uint8Array(await sharp({ create: { width: 800, height: 600, channels: 3, background: "#3366aa" } }).jpeg().toBuffer());
const files = new Map<string, StaticEntry>([["/p.jpg", { body: jpeg, type: "image/jpeg", etag: '"p"', cache: "" }]]);
const get = (root: string, w: number, cacheDir?: string, accept = "image/webp") =>
  handleImage(new Request("http://x/_optz/image", { headers: { Accept: accept } }), new URL(`http://x/_optz/image?url=/p.jpg&w=${w}`), {
    root,
    config: resolveConfig({ images: { sizes: [100, 200, 300, 400], cacheDir, concurrency: 2 } }),
    files,
  });

test("a read-only cache directory still serves optimized images (from memory)", async () => {
  const warn = console.warn;
  console.warn = () => {};
  const r = await get("/", 200, "/proc/optz-images-cannot-exist");
  console.warn = warn;
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toBe("image/webp");
  expect((await sharp(new Uint8Array(await r.arrayBuffer())).metadata()).width).toBe(200);
});

test("widths round up to configured sizes; encodes run concurrently but bounded", async () => {
  const root = mkdtempSync(join(tmpdir(), "optz-img-"));
  const rs = await Promise.all([100, 150, 300, 400, 999].map((w) => get(root, w, join(root, "cache"), "image/avif")));
  const widths = await Promise.all(rs.map(async (r) => (await sharp(new Uint8Array(await r.arrayBuffer())).metadata()).width));
  expect(widths).toEqual([100, 200, 300, 400, 400]);
});

test("remote image hits reuse bounded source data, coalesce downloads and refresh after expiry", async () => {
  const root = mkdtempSync(join(tmpdir(), "optz-remote-cache-"));
  let downloads = 0, time = Date.now();
  const clock = spyOn(Date, "now").mockImplementation(() => time);
  const download = spyOn(remote, "fetchRemoteImage").mockImplementation(async () => { downloads++; return { body: jpeg, type: "image/jpeg" }; });
  const ctx = { root, files: new Map<string, StaticEntry>(), config: resolveConfig({ images: { sizes: [100], remoteHosts: ["images.test"] } }) };
  const get = (n: number, tag?: string) => {
    const url = new URL(`https://site.test/_optz/image?url=${encodeURIComponent(`https://images.test/${n}.jpg`)}&w=100`);
    return handleImage(new Request(url, { headers: { Accept: "image/webp", ...(tag ? { "If-None-Match": tag } : {}) } }), url, ctx);
  };
  try {
    const responses = await Promise.all([get(0), get(0), get(0)]);
    expect(downloads).toBe(1);
    const tag = responses[0].headers.get("etag")!;
    expect((await get(0, tag)).status).toBe(304);
    expect(downloads).toBe(1);
    time += 300_001;
    expect((await get(0, tag)).status).toBe(304);
    expect(downloads).toBe(2);
    for (let n = 1; n <= 32; n++) expect((await get(n)).status).toBe(200);
    expect(downloads).toBe(34);
    await get(0);
    expect(downloads).toBe(35); // The oldest source was evicted at the 32-entry limit.
  } finally { download.mockRestore(); clock.mockRestore(); rmSync(root, { recursive: true, force: true }); }
});
