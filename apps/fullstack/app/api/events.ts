import type { ApiContext } from "optz";
import { eventStream } from "optz/stream";
import { setTimeout } from "node:timers/promises";
import { app, requireUser } from "$lib/app.server";
export async function GET({ request }: ApiContext) {
  const user = await requireUser(request), state = app();
  if (state.streams >= 32) return new Response("Stream capacity reached", { status: 503 });
  state.streams++;
  return eventStream(request, async function* (signal) {
    while (!signal.aborted && await state.sessions.read(request)) {
        const count = state.db.query<{ count: number }, [string]>("SELECT count(*) count FROM notes WHERE user_id=?").get(user.id)!.count;
        yield { event: "notes", data: { count } };
        try { await setTimeout(15000, undefined, { signal }); } catch { return; }
      }
  }, { onClose: () => { state.streams--; } });
}
