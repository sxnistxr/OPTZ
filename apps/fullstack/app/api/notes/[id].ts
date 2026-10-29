import type { ApiContext } from "optz";
import { parseInput } from "optz/forms";
import { app, requireUser } from "$lib/app.server";
import { textField } from "$lib/input.server";
export async function POST({ request, params }: ApiContext<{ id: string }>) {
  const user = await requireUser(request);
  const operation = await parseInput(request, input => textField(input, "operation", 10), { maxBytes: 8192 });
  const db = app().db;
  if (!["toggle", "delete"].includes(operation)) return new Response(null, { status: 400 });
  const query = operation === "delete" ? "DELETE FROM notes WHERE id=? AND user_id=?" : "UPDATE notes SET done=1-done WHERE id=? AND user_id=?";
  if (!db.query(query).run(params.id, user.id).changes) return new Response(null, { status: 404 });
  return new Response(null, { status: 303, headers: { Location: "/dashboard", "Cache-Control": "no-store" } });
}
