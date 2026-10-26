import { handler, json, type ApiContext, type HandlerContext } from "optz";

// API route: app/api/hello.ts answers /api/hello. Return types flow to the typed client:
//   import { api } from "optz";  const r = await api("/api/hello", { query: { name: "Ada" } });  // r.hello: string
export const GET = ({ url, locals }: ApiContext) => json({ hello: url.searchParams.get("name") ?? "world", requestId: String(locals.requestId) });

// handler() + HandlerContext<Params, Body> types the request body for both sides.
export const POST = handler(async ({ body }: HandlerContext<{}, { message: string }>) => json({ received: (await body()).message }, { status: 201 }));
