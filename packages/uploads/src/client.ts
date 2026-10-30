export interface UploadPlan { id: string; size: number; partSize: number; parts: number; multipart: boolean; checksums: boolean; uploadedParts?: { number: number; size: number; checksum?: string }[] }
/** Optional browser helper. No provider SDK, persistence, global listeners or background work. */
export async function uploadFile(file: File, options: { endpoint: string; resumeId?: string; signal?: AbortSignal; concurrency?: number; retries?: number; onProgress?: (bytes: number, total: number) => void }) {
  const endpoint = new URL(options.endpoint, location.href);
  if (endpoint.origin !== location.origin || endpoint.search || endpoint.hash) throw new TypeError("Use a same-origin upload control endpoint");
  const concurrency = options.concurrency ?? 3, retries = options.retries ?? 2;
  const stop = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, stop.signal]) : stop.signal;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 6 || !Number.isSafeInteger(retries) || retries < 0 || retries > 5) throw new TypeError("Invalid upload retry/concurrency limits");
  const control = async (action: string, data: unknown) => {
    const response = await fetch(new URL(endpoint.pathname.replace(/\/$/, "") + "/" + action, endpoint), { method: "POST", credentials: "same-origin", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (!response.ok) throw new Error(`Upload ${action} failed (HTTP ${response.status})`);
    return response.json();
  };
  const plan: UploadPlan = options.resumeId ? await control("resume", { id: options.resumeId }) : await control("initiate", { name: file.name, type: file.type || "application/octet-stream", size: file.size });
  if (plan.size !== file.size || !/^[a-f0-9-]{36}$/i.test(plan.id) || !Number.isSafeInteger(plan.partSize) || plan.partSize < 1 || plan.partSize > 64 * 1024 ** 2 || !Number.isSafeInteger(plan.parts) || plan.parts < 1 || plan.parts > 10000 || typeof plan.checksums !== "boolean" || typeof plan.multipart !== "boolean" || (plan.multipart && plan.parts !== Math.ceil(file.size / plan.partSize))) throw new Error("Selected file does not match the upload plan");
  // Skip a resumed part only when its provider checksum matches the selected local bytes.
  const count = plan.multipart ? plan.parts : 1;
  let next = 0, sent = 0;
  const worker = async () => {
    while (next < count) {
      const index = next++, blob = plan.multipart ? file.slice(index * plan.partSize, Math.min(file.size, (index + 1) * plan.partSize)) : file;
      if (signal.aborted) throw new DOMException("Upload aborted", "AbortError");
      const checksum = plan.checksums ? btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())))) : undefined;
      if (plan.multipart && checksum && plan.uploadedParts?.some(p => p.number === index + 1 && p.size === blob.size && p.checksum === checksum)) { sent += blob.size; options.onProgress?.(sent, file.size); continue; }
      for (let attempt = 0; ; attempt++) {
        const signed = await control("sign", { id: plan.id, ...(plan.multipart ? { part: index + 1 } : {}), checksum });
        const url = new URL(signed.url);
        if (url.protocol !== "https:") throw new Error("Object uploads require HTTPS");
        try {
          const response = await fetch(url, { method: "PUT", credentials: "omit", redirect: "error", signal, headers: signed.headers, body: blob });
          if (!response.ok) { await response.body?.cancel(); throw new Error(`Object upload failed (HTTP ${response.status})`); }
          sent += blob.size; options.onProgress?.(sent, file.size); break;
        } catch (error) { if (signal.aborted || attempt >= retries) throw error; await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 4000))); }
      }
    }
  };
  try { await Promise.all(Array.from({ length: Math.min(concurrency, count) }, worker)); return await control("complete", { id: plan.id }); }
  catch (error) { stop.abort(); throw Object.assign(error instanceof Error ? error : new Error("Upload failed"), { uploadId: plan.id }); }
}
