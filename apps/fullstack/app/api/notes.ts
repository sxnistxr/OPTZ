import type { ApiContext } from "optz";
import { parseInput } from "optz/forms";
import { app, requireUser } from "$lib/app.server";
import { textField } from "$lib/input.server";
export async function POST({ request }: ApiContext) {
  const user = await requireUser(request);
  const text = await parseInput(request, input => textField(input, "text"), { maxBytes: 8192 });
  const db = app().db;
  const inserted = db.query("INSERT INTO notes (id,user_id,text) SELECT ?,?,? WHERE (SELECT count(*) FROM notes WHERE user_id=?)<1000").run(crypto.randomUUID(), user.id, text, user.id);
  if (!inserted.changes) return new Response("Note quota reached", { status: 409 });
  return new Response(null, { status: 303, headers: { Location: "/dashboard", "Cache-Control": "no-store" } });
}
