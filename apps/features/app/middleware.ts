import { defineMiddleware } from "optz";

// A strict CSP: no 'unsafe-inline'. Streamed pages still work: optz adds a per-response nonce
// for React's streaming scripts to script-src.
export default defineMiddleware(async (_ctx, next) => {
  const res = await next();
  if (res.headers.get("Content-Type")?.startsWith("text/html")) {
    res.headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'");
  }
  return res;
});
