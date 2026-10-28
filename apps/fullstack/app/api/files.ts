import type { ApiContext } from "optz";
import { parseInput, ValidationError } from "optz/forms";
import { app, requireUser } from "$lib/app.server";
export async function POST({ request }: ApiContext) {
  const user = await requireUser(request), state = app();
  if (state.uploads >= 2) return new Response("Upload service busy", { status: 503 });
  state.uploads++;
  try {
    if (state.db.query<{ n: number }, [string]>("SELECT count(*) n FROM files WHERE user_id=?").get(user.id)!.n >= 20) return new Response("Attachment quota reached", { status: 409 });
    const file = await parseInput(request, input => {
      const file = (input as Record<string, unknown>)?.file;
      if (!(file instanceof File)) throw new ValidationError({ file: ["Choose a file"] });
      return file;
    }, { maxBytes: (5 << 20) + 65536 });
    let saved: Awaited<ReturnType<typeof state.files.save>>;
    try { saved = await state.files.save(file, { maxBytes: 5 << 20, types: ["text/plain", "image/png", "image/jpeg", "application/pdf"] }); }
    catch (error) {
      if (error instanceof RangeError) return new Response("Attachment exceeds 5 MiB", { status: 413 });
      if (error instanceof TypeError) return new Response("Attachment type is not allowed", { status: 415 });
      throw error;
    }
    try {
      const inserted = state.db.query("INSERT INTO files (key,user_id,name,size) SELECT ?,?,?,? WHERE (SELECT count(*) FROM files WHERE user_id=?)<20 AND (SELECT coalesce(sum(size),0) FROM files)+?<=?").run(saved.key, user.id, saved.name, saved.size, user.id, saved.size, state.maxStorageBytes);
      if (!inserted.changes) { await state.files.remove(saved.key); return new Response("Attachment quota reached", { status: 409 }); }
    }
    catch (error) { await state.files.remove(saved.key); throw error; }
    return new Response(null, { status: 303, headers: { Location: "/dashboard", "Cache-Control": "no-store" } });
  } finally { state.uploads--; }
}
