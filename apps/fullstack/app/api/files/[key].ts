import type { ApiContext } from "optz";
import { app, requireUser } from "$lib/app.server";
export async function GET({ request, params }: ApiContext<{ key: string }>) {
  const user = await requireUser(request), state = app();
  const file = state.db.query<{ name: string }, [string, string]>("SELECT name FROM files WHERE key=? AND user_id=?").get(params.key, user.id);
  if (!file) return new Response(null, { status: 404 });
  return state.files.response(params.key, file.name);
}
