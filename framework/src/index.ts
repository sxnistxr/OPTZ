// The isomorphic public API: safe to import from pages, layouts and components.
export type * from "./types";
export { Link, useRouter, useParams, useLoaderData, useNavigating } from "./runtime";
import type { Config, Middleware } from "./types";

export const defineConfig = (c: Config) => c;
export const defineMiddleware = (m: Middleware) => m;

/** Throw from a loader (or return from middleware/API code) to redirect. */
export function redirect(location: string, status: 301 | 302 | 303 | 307 | 308 = 302): Response {
  return new Response(null, { status, headers: { Location: location } });
}

/** Throw from a loader to answer 404 with the app's not-found page. */
export class NotFound extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFound";
  }
}
export const notFound = (message?: string): never => {
  throw new NotFound(message);
};

export const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
