import type { ApiContext } from "optz";
import { assertSameOrigin } from "optz/security";
import { parseInput } from "optz/forms";
import { analytics, origin } from "$lib/modules.server";
import { getAuth } from "$lib/auth.server";
export async function POST({ request }: ApiContext) {
  assertSameOrigin(request, origin());
  const session = await getAuth().requireSession(request);
  const input = await parseInput(request, value => { const action = (value as { action?: string })?.action; if (action !== "export" && action !== "delete") throw new Response("Choose export or delete", { status: 422 }); return action; }, { maxBytes: 1024 });
  if (input === "delete") { await analytics().deleteSubject(session.user.id); return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } }); }
  return Response.json(await analytics().exportSubject(session.user.id), { headers: { "Cache-Control": "private, no-store" } });
}
