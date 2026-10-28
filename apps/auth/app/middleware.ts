import type { Middleware } from "optz";
import { secureHeaders } from "optz/security";
const gateway: Middleware = async (ctx, next) => {
  if (ctx.url.pathname !== "/api/auth" && !ctx.url.pathname.startsWith("/api/auth/")) return next();
  return (await import("$lib/auth.server")).getAuth().handler(ctx.request);
};
export default [secureHeaders({ "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" }), gateway];
