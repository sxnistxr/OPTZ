// Local private attachments, opt-in Node/Bun module. Persist metadata/ownership in your data layer.
import { mkdir, open, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, join } from "node:path";
import { Readable } from "node:stream";
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const filename = (name: string) => Array.from(name.toWellFormed()).slice(0, 255).join("");
export function localStorage(root: string) {
  root = resolve(root);
  const path = (key: string) => { if (!KEY.test(key)) throw new TypeError("Invalid storage key"); return join(root, key); };
  return {
    async save(file: File, options: { maxBytes?: number; types?: readonly string[] } = {}) {
      const max = options.maxBytes ?? (5 << 20);
      if (!Number.isSafeInteger(max) || max < 1) throw new TypeError("Invalid upload budget");
      if (file.size > max) throw new RangeError("File exceeds its budget");
      if (options.types && !options.types.some(type => type.toLowerCase() === file.type.split(";")[0].trim().toLowerCase())) throw new TypeError("File type is not allowed");
      await mkdir(root, { recursive: true, mode: 0o700 });
      const key = crypto.randomUUID(), destination = path(key);
      const fd = await open(destination, "wx", 0o600);
      const reader = file.stream().getReader();
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > max) throw new RangeError("File exceeds its budget");
          let at = 0;
          while (at < value.length) { const { bytesWritten } = await fd.write(value, at); if (!bytesWritten) throw new Error("Short file write"); at += bytesWritten; }
        }
      } catch (error) { await unlink(destination).catch(() => {}); throw error; }
      finally { await fd.close(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
      return { key, size, name: filename(file.name), type: file.type };
    },
    async response(key: string, name = "download") {
      const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(filename(name)).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16))}`;
      const fd = await open(path(key), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await fd.stat();
        if (!stat.isFile()) throw new TypeError("Storage object is not a file");
        const body = Readable.toWeb(fd.createReadStream()) as unknown as ReadableStream<Uint8Array>;
        return new Response(body, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(stat.size), "Content-Disposition": disposition, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
      } catch (error) { await fd.close(); throw error; }
    },
    async remove(key: string) { await unlink(path(key)).catch(error => { if (error.code !== "ENOENT") throw error; }); },
  };
}
