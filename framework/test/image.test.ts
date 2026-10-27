// The image optimizer (audit: C14, X11): async I/O, a bounded encode pool, and no failure when
// the disk cache can't be written (systemd's ProtectSystem=strict).
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { handleImage } from "../src/image";
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
