// Dev server endpoints: the update stream browsers listen to, and stats.
import type { ResponseCache } from "./cache";
import type { Manifest } from "./manifest";

type Client = ReadableStreamDefaultController<string>;
// Kept on globalThis so connections survive the dev server re-running its modules.
const g = globalThis as { __optzDevClients?: Set<Client>; __optzDevPing?: Timer };
const clients = (g.__optzDevClients ??= new Set());
g.__optzDevPing ??= setInterval(() => clients.forEach((c) => c.enqueue(": ping\n\n")), 15000);

/** Sends an update to every open page: "reload", "css <url>", "islands <json>" or "page". */
export function broadcast(event: string, data = "") {
  for (const c of clients) {
    try {
      c.enqueue(`event: ${event}\ndata: ${data}\n\n`);
    } catch {
      clients.delete(c);
    }
  }
}

export function devRequest(_req: Request, p: string, cache: ResponseCache | null, manifest: Manifest): Response {
  if (p === "/_optz/dev/events") {
    let ctl: Client;
    return new Response(
      new ReadableStream<string>({
        start(c) {
          ctl = c;
          clients.add(c);
          // What this build is: pages compare it with what they loaded and update in place.
          c.enqueue(`event: hello\ndata: ${JSON.stringify({ build: manifest.builtAt, mode: manifest.mode, islands: manifest.islands, css: manifest.css })}\n\n`);
        },
        cancel() {
          clients.delete(ctl);
        },
      }),
      { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
    );
  }
  if (p === "/_optz/dev/stats") return Response.json({ cache: cache?.stats ?? null, memory: process.memoryUsage() });
  return new Response("Not found", { status: 404 });
}
