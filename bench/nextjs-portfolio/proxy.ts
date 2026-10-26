// Same security headers as portfolio/app/middleware.ts. Next inlines its RSC payload as
// <script> tags, so a static page needs 'unsafe-inline' (a nonce would force every page dynamic).
import { NextResponse, type NextRequest } from "next/server";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join("; ");

export function proxy(_request: NextRequest) {
  const res = NextResponse.next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Content-Security-Policy", CSP);
  res.headers.set("X-Frame-Options", "DENY");
  return res;
}

// Like optz: not for static assets or the proxied engine.
export const config = { matcher: ["/((?!_next/static|_next/image|api/social|favicon.svg).*)"] };
