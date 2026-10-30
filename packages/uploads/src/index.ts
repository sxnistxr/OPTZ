import { assertSameOrigin, createRateLimiter } from "optz/security";
import { parseInput } from "optz/forms";
export { localStorage } from "optz/storage";
export interface UploadRecord {
  id: string; owner: string; key: string; finalKey: string; name: string; type: string; size: number;
  partSize: number; uploadId?: string; expiresAt: number;
  state: "pending" | "active" | "completing" | "complete" | "aborted";
}
export interface UploadStore {
  reserve(record: UploadRecord): void | Promise<void>;
  get(id: string): UploadRecord | undefined | Promise<UploadRecord | undefined>;
  activate(id: string, uploadId?: string): void | Promise<void>;
  claim(id: string, from?: "active" | "complete"): boolean | Promise<boolean>;
  finish(id: string, state: "active" | "complete" | "aborted"): void | Promise<void>;
  release(id: string): void | Promise<void>;
  expired(now: number): UploadRecord[] | Promise<UploadRecord[]>;
}
export interface StoredPart { number: number; size: number; etag: string; checksum?: string }
export interface ObjectProvider {
  checksums: boolean;
  create(record: UploadRecord): Promise<string>;
  sign(record: UploadRecord, part: number | undefined, checksum?: string): Promise<{ url: string; headers: Record<string, string> }>;
  parts(record: UploadRecord): Promise<StoredPart[]>;
  complete(record: UploadRecord, parts: StoredPart[]): Promise<void>;
  abort(record: UploadRecord): Promise<void>;
  head(key: string): Promise<{ size: number; type: string } | undefined>;
  /** Copy to a different, never-presigned key before granting application access. */
  promote(record: UploadRecord): Promise<void>;
  remove(key: string): Promise<void>;
  download(record: UploadRecord): Promise<{ url: string }>;
}
export function createUploads(options: { store: UploadStore; provider: ObjectProvider; maxBytes?: number; types: readonly string[]; multipartThreshold?: number; partSize?: number; lifetimeMs?: number; inspect?: (record: Readonly<UploadRecord>) => Promise<void> }) {
  const max = options.maxBytes ?? 100 * 1024 * 1024, threshold = options.multipartThreshold ?? 32 * 1024 * 1024;
  const partSize = options.partSize ?? 8 * 1024 * 1024, lifetime = options.lifetimeMs ?? 86400000;
  if (![max, threshold, partSize, lifetime].every(v => Number.isSafeInteger(v) && v > 0) || max > 5 * 1024 ** 3 || threshold > 64 * 1024 ** 2 || partSize < 5 * 1024 ** 2 || partSize > 64 * 1024 ** 2 || lifetime > 7 * 86400000 || !options.types.length || options.types.some(t => !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(t))) throw new TypeError("Invalid upload limits or types (maximum object: 5 GiB)");
  const record = async (owner: string, id: string) => {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Response("Upload not found", { status: 404 });
    const value = await options.store.get(id);
    if (!value || value.owner !== owner) throw new Response("Upload not found", { status: 404 });
    return value;
  };
  const active = (value: UploadRecord) => { if (value.state !== "active" || value.expiresAt <= Date.now()) throw new Response("Upload is not active", { status: 409 }); };
  const plan = (r: UploadRecord) => ({ id: r.id, state: r.state, size: r.size, partSize: r.partSize, parts: Math.ceil(r.size / r.partSize), multipart: !!r.uploadId, checksums: options.provider.checksums, expiresAt: r.expiresAt });
  const validateObject = (r: UploadRecord, object: { size: number; type: string } | undefined) => { if (!object || object.size !== r.size || object.type.split(";")[0].trim().toLowerCase() !== r.type) throw new Response("Uploaded object does not match its declaration", { status: 422 }); };
  return {
    async initiate(owner: string, input: { name: string; type: string; size: number }) {
      if (!owner || owner.length > 128 || typeof input.name !== "string" || !input.name || input.name.length > 255 || /[\u0000-\u001f]/.test(input.name) || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > max || typeof input.type !== "string" || !options.types.includes(input.type.toLowerCase())) throw new Response("Invalid upload declaration", { status: 422 });
      const id = crypto.randomUUID();
      const r: UploadRecord = { id, owner, name: input.name, type: input.type.toLowerCase(), size: input.size, partSize: Math.max(partSize, Math.ceil(input.size / 10000)), key: `pending/${id}`, finalKey: `objects/${crypto.randomUUID()}`, state: "pending", expiresAt: Date.now() + lifetime };
      await options.store.reserve(r);
      try {
        if (r.size >= threshold) r.uploadId = await options.provider.create(r);
        await options.store.activate(id, r.uploadId); r.state = "active"; return plan(r);
      } catch (error) { if (r.uploadId) await options.provider.abort(r).catch(() => {}); await options.store.finish(id, "aborted"); throw error; }
    },
    async resume(owner: string, id: string) { const r = await record(owner, id); active(r); return { ...plan(r), uploadedParts: r.uploadId ? await options.provider.parts(r) : [] }; },
    async sign(owner: string, id: string, part?: number, checksum?: string) {
      const r = await record(owner, id); active(r);
      if (r.uploadId ? !Number.isSafeInteger(part) || part! < 1 || part! > Math.ceil(r.size / r.partSize) : part !== undefined) throw new Response("Invalid part number", { status: 422 });
      if (options.provider.checksums && (typeof checksum !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(checksum))) throw new Response("A base64 SHA-256 checksum is required", { status: 422 });
      return options.provider.sign(r, part, checksum);
    },
    async complete(owner: string, id: string) {
      const r = await record(owner, id);
      if (r.state === "complete") return { id, key: r.finalKey, name: r.name, type: r.type, size: r.size };
      active(r); if (!await options.store.claim(id)) throw new Response("Upload is being finalized", { status: 409 });
      try {
        const promoted = await options.provider.head(r.finalKey);
        if (!promoted) {
          let uploaded = await options.provider.head(r.key);
          if (!uploaded && r.uploadId) {
            const parts = (await options.provider.parts(r)).sort((a, b) => a.number - b.number);
            if (parts.length !== Math.ceil(r.size / r.partSize) || parts.some((p, i) => p.number !== i + 1 || p.size !== Math.min(r.partSize, r.size - i * r.partSize) || !p.etag || (options.provider.checksums && !p.checksum))) throw new Response("Upload parts are incomplete or have incorrect sizes", { status: 422 });
            await options.provider.complete(r, parts); uploaded = await options.provider.head(r.key);
          }
          validateObject(r, uploaded);
          await options.provider.promote(r);
        }
        validateObject(r, await options.provider.head(r.finalKey));
        // Inspect the immutable, never-presigned copy; mutable staging URLs cannot race a scan.
        if (options.inspect) try { await options.inspect(Object.freeze({ ...r, key: r.finalKey })); }
        catch (error) { await options.provider.remove(r.finalKey).catch(() => {}); throw error; }
        await options.store.finish(id, "complete");
        await options.provider.remove(r.key).catch(() => {});
        return { id, key: r.finalKey, name: r.name, type: r.type, size: r.size };
      } catch (error) { await options.store.finish(id, "active"); throw error; }
    },
    async abort(owner: string, id: string) {
      const r = await record(owner, id);
      if (r.state === "complete" || r.state === "completing") throw new Response("Upload cannot be aborted in this state", { status: 409 });
      if (r.state === "aborted") return;
      if (r.state !== "active" || !await options.store.claim(id)) throw new Response("Upload state changed", { status: 409 });
      try { if (r.uploadId) await options.provider.abort(r); await options.provider.remove(r.key); await options.provider.remove(r.finalKey); await options.store.finish(id, "aborted"); }
      catch (error) { await options.store.finish(id, "active"); throw error; }
    },
    async download(owner: string, id: string) { const r = await record(owner, id); if (r.state !== "complete") throw new Response("Upload is not complete", { status: 409 }); return options.provider.download(r); },
    async remove(owner: string, id: string) { const r = await record(owner, id); if (r.state !== "complete" || !await options.store.claim(id, "complete")) throw new Response("File is not ready for deletion", { status: 409 }); try { await options.provider.remove(r.finalKey); await options.store.finish(id, "aborted"); } catch (error) { await options.store.finish(id, "complete"); throw error; } },
    async cleanup() {
      let cleaned = 0;
      for (const r of await options.store.expired(Date.now())) {
        if (r.state !== "pending" && r.state !== "aborted" && !await options.store.claim(r.id)) continue;
        if (r.uploadId) await options.provider.abort(r);
        await options.provider.remove(r.key); await options.provider.remove(r.finalKey); await options.store.release(r.id); cleaned++;
      }
      return cleaned;
    },
  };
}
/** Control API only. File bytes travel directly to the storage provider. */
export function createUploadHandler(options: { uploads: ReturnType<typeof createUploads>; origin: string; authorize: (request: Request) => Promise<{ id: string } | null>; requestsPerMinute?: number }) {
  const limit = createRateLimiter({ limit: options.requestsPerMinute ?? 600, windowMs: 60000, maxKeys: 10000 });
  return async (request: Request) => {
    try {
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
      assertSameOrigin(request, options.origin);
      const user = await options.authorize(request);
      if (!user || !user.id || user.id.length > 128) return new Response("Authentication required", { status: 401, headers: { "Cache-Control": "private, no-store" } });
      if (!limit.consume(user.id).allowed) return new Response("Upload request limit reached", { status: 429, headers: { "Cache-Control": "private, no-store" } });
      const input = await parseInput(request, v => { if (!v || typeof v !== "object" || Array.isArray(v)) throw new Response("Invalid control input", { status: 422 }); return v as Record<string, unknown>; }, { maxBytes: 8192 });
      const action = new URL(request.url).pathname.split("/").at(-1);
      const id = typeof input.id === "string" ? input.id : "";
      let result: unknown;
      if (action === "initiate") result = await options.uploads.initiate(user.id, input as unknown as { name: string; type: string; size: number });
      else if (action === "resume") result = await options.uploads.resume(user.id, id);
      else if (action === "sign") result = await options.uploads.sign(user.id, id, input.part as number | undefined, input.checksum as string | undefined);
      else if (action === "complete") result = await options.uploads.complete(user.id, id);
      else if (action === "download") result = await options.uploads.download(user.id, id);
      else if (action === "delete") { await options.uploads.remove(user.id, id); result = { deleted: true }; }
      else if (action === "abort") { await options.uploads.abort(user.id, id); result = { aborted: true }; }
      else return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof Response) { const response = new Response(error.body, error); response.headers.set("Cache-Control", "private, no-store"); return response; }
      return new Response("Upload operation failed", { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  };
}
