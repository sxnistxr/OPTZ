import type { Middleware } from "optz";
import { secureHeaders } from "optz/security";
const gateway: Middleware = async (ctx, next) => {
  if (ctx.url.pathname !== "/api/auth" && !ctx.url.pathname.startsWith("/api/auth/")) {
    const response = await next();
    if (ctx.url.pathname !== "/reset") return response;
    const out = new Response(response.body, response);
    out.headers.set("Cache-Control", "private, no-store");
    return out;
  }
  return (await import("$lib/auth.server")).getAuth().handler(ctx.request);
};
export default [secureHeaders({ "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" }), gateway];
