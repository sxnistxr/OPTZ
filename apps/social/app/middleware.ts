import { defineMiddleware } from "optz";

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'";

export default defineMiddleware(async (_ctx, next) => {
  const res = await next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  if (res.headers.get("Content-Type")?.startsWith("text/html")) res.headers.set("Content-Security-Policy", CSP);
  return res;
});
