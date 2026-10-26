// Runs for every page, data and API request handled by the Bun server (not for /assets/*,
// and not for /api/*, which nginx sends straight to the Rust API).
import { defineMiddleware } from "optz";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // the inline boot data script
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
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
