import type { ApiContext } from "optz";
import { handleStatus, origin } from "$lib/modules.server";
import { revalidateTag } from "optz/server";
export const GET = ({ request }: ApiContext) => handleStatus(request);
export async function POST({ request }: ApiContext) {
  const response = await handleStatus(request);
  if (response.ok) revalidateTag("module-status");
  return response.ok && request.headers.get("accept")?.includes("text/html") ? new Response(null, { status: 303, headers: { Location: new URL("/modules", origin()).href, "Cache-Control": "no-store" } }) : response;
}
