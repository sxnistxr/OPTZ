import { defineMiddleware } from "optz";

// Runs before every page, data and API request. Call next() to continue; change or replace
// the response; put values in ctx.locals for loaders and API routes.
export default defineMiddleware(async (ctx, next) => {
  const started = performance.now();
  ctx.locals.requestId = crypto.randomUUID();
  const res = await next();
  res.headers.set("X-Request-Id", String(ctx.locals.requestId));
  res.headers.set("Server-Timing", `app;dur=${(performance.now() - started).toFixed(1)}`);
  return res;
});
