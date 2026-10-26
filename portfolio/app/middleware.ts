// Runs for every page, data and API request handled by the Bun server (not for /assets/*,
// and not for /api/social/*, which nginx sends straight to the engine).
import { defineMiddleware } from "optz";

// No 'unsafe-inline' anywhere: the framework's boot data is a JSON script, not code.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join("; ");

export default defineMiddleware(async (_ctx, next) => {
  const res = await next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (res.headers.get("Content-Type")?.startsWith("text/html")) {
    res.headers.set("Content-Security-Policy", CSP);
    res.headers.set("X-Frame-Options", "DENY");
  }
  return res;
});
