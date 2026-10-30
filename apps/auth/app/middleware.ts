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
const security: Middleware = (ctx, next) => {
  let connect = "'self'";
  if (ctx.url.pathname === "/files" && process.env.S3_ENDPOINT) {
    const endpoint = new URL(process.env.S3_ENDPOINT);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return new Response("Invalid object-storage endpoint", { status: 503 });
    connect += " " + endpoint.origin;
  }
  return secureHeaders({ "Referrer-Policy": "no-referrer", "Content-Security-Policy": `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src ${connect}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` })(ctx, next);
};
export default [security, gateway];
