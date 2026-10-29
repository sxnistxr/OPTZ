export interface BudgetResult { allowed: boolean; retryAfter: number }
export interface RequestBudget {
  /** A shared implementation must atomically consume its counter. No credentials in keys. */
  consume(key: string, limit: number, windowMs: number): BudgetResult | Promise<BudgetResult>;
}

/** Bound memory and fail closed when new identities exceed capacity. Per process only. */
export function memoryBudget(maxKeys = 10000, now = Date.now): RequestBudget {
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) throw new TypeError("Invalid budget capacity");
  const entries = new Map<string, { count: number; expires: number }>();
  return { consume(key, limit, windowMs) {
    const time = now();
    // Expiries can differ between endpoint budgets; do not assume insertion order is expiry order.
    if (entries.size >= maxKeys) for (const [id, entry] of entries) if (entry.expires <= time) entries.delete(id);
    let entry = entries.get(key);
    if (entry && entry.expires <= time) { entries.delete(key); entry = undefined; }
    if (!entry) {
      if (entries.size >= maxKeys) return { allowed: false, retryAfter: Math.ceil(windowMs / 1000) };
      entries.set(key, entry = { count: 0, expires: time + windowMs });
    }
    const allowed = entry.count < limit;
    if (allowed) entry.count++;
    return { allowed, retryAfter: Math.max(1, Math.ceil((entry.expires - time) / 1000)) };
  } };
}

export function privateResponse(response: Response): Response {
  const out = new Response(response.body, response);
  out.headers.set("Cache-Control", "private, no-store");
  out.headers.set("Pragma", "no-cache");
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Referrer-Policy", "no-referrer");
  out.headers.append("Vary", "Cookie");
  return out;
}

/** Read the actual stream, not Content-Length, under both byte and time budgets. */
export async function boundedRequest(request: Request, maxBytes: number, timeoutMs: number) {
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const timeout = setTimeout(() => { void reader.cancel().catch(() => {}); }, timeoutMs);
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (Date.now() >= deadline || request.signal.aborted) throw new Response("Request timed out", { status: 408 });
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new Response("Request too large", { status: 413 });
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return new Request(request, { body: bytes });
  } finally {
    clearTimeout(timeout);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
