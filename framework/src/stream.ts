export interface ServerEvent { data: unknown; event?: string; id?: string; retry?: number }
/** Pull-based SSE: no unbounded send queue. Producers must observe signal for pending async work. */
export function eventStream(request: Request, source: (signal: AbortSignal) => AsyncIterable<ServerEvent>, options: { maxEventBytes?: number; onClose?: () => void } = {}) {
  const abort = new AbortController();
  const iterator = source(abort.signal)[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  let closed = false;
  const cleanup = () => { if (closed) return; closed = true; request.signal.removeEventListener("abort", stop); options.onClose?.(); };
  const finish = () => { abort.abort(); cleanup(); void iterator.return?.().catch(() => {}); };
  let stop: () => void;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      stop = () => { controller.error(new DOMException("Request aborted", "AbortError")); finish(); };
      if (request.signal.aborted) stop(); else request.signal.addEventListener("abort", stop, { once: true });
    },
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (abort.signal.aborted) return;
        if (next.done) { cleanup(); controller.close(); return; }
        const { data, event, id, retry } = next.value;
        if ([event, id].some(v => v !== undefined && /[\r\n\0]/.test(v)) || (retry !== undefined && (!Number.isSafeInteger(retry) || retry < 0))) throw new TypeError("Invalid SSE metadata");
        const text = typeof data === "string" ? data : JSON.stringify(data);
        const bytes = encoder.encode(`${event ? `event: ${event}\n` : ""}${id !== undefined ? `id: ${id}\n` : ""}${retry !== undefined ? `retry: ${retry}\n` : ""}${String(text).split(/\r?\n|\r/).map(line => `data: ${line}`).join("\n")}\n\n`);
        if (bytes.byteLength > (options.maxEventBytes ?? 65536)) throw new RangeError("SSE event exceeds its budget");
        controller.enqueue(bytes);
      } catch (error) { if (!abort.signal.aborted) controller.error(error); finish(); }
    },
    cancel() { finish(); },
  }, { highWaterMark: 1 });
  return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store", "X-Accel-Buffering": "no" } });
}
