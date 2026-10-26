import { json, type ApiHandler } from "optz";

// API route: a .ts file in app/routes exporting HTTP method handlers.
export const GET: ApiHandler = ({ url, locals }) => json({ hello: url.searchParams.get("name") ?? "world", requestId: locals.requestId });
export const POST: ApiHandler = async ({ request }) => json({ received: await request.json() }, { status: 201 });
