/** Enforce byte and time budgets while consuming request streams, before allocating a body. */
export class BodyLimitError extends Error {}
export async function readBody(body: ReadableStream<Uint8Array> | null, max: number, timeoutMs = 30_000): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new BodyLimitError("body read timed out")); void reader.cancel().catch(() => {}); }, timeoutMs);
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new BodyLimitError("request body too large");
      chunks.push(value);
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
