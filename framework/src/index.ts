// The isomorphic public API: safe to import from pages, layouts, islands and API routes.
import type { ApiContext, Config, Middleware, Params, RouteCache, TypedResponse } from "./types";

export type * from "./types";
export { resolveConfig } from "./types";
export { Link, useRouter, useParams, useLoaderData, useNavigating } from "./runtime";

/** Typed config for optz.config.ts (every option is documented on hover). */
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

/** A JSON response whose body type flows to the typed `api()` client. */
export const json = <T,>(data: T, init: ResponseInit = {}): TypedResponse<T> =>
  new Response(JSON.stringify(data), { ...init, headers: { "Content-Type": "application/json", ...init.headers } });

/** What a `handler()` receives: the usual API context plus a typed JSON body reader. */
export interface HandlerContext<P extends Params = Params, B = unknown> extends ApiContext<P> {
  body: () => Promise<B>;
}

/** An API handler whose request body type flows to the typed `api()` client. Annotate the
 *  context; everything else is inferred:
 *  export const POST = handler(async ({ params, body }: HandlerContext<{ id: string }, { text: string }>) =>
 *    json({ saved: (await body()).text }, { status: 201 })); */
export function handler<P extends Params, B, R extends TypedResponse<unknown> | Promise<TypedResponse<unknown>>>(fn: (ctx: HandlerContext<P, B>) => R) {
  const h = (ctx: ApiContext<P>) => fn({ ...ctx, body: () => ctx.request.json() as Promise<B> });
  return h as ((ctx: ApiContext<P>) => R) & { readonly __body?: B };
}

export type { RouteCache };

// ---- typed API client ----------------------------------------------------------------------

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type ApiPath = keyof import("./types").ApiRegistry & string;
type Mod<P extends ApiPath> = import("./types").ApiRegistry[P];
type MethodsOf<P extends ApiPath> = Extract<keyof Mod<P>, Method>;
type Out<H> = H extends (...a: never[]) => infer R ? (Awaited<R> extends TypedResponse<infer T> ? T : unknown) : unknown;
type In<H> = H extends { readonly __body?: infer B } ? B : unknown;
type HasParams<P extends string> = P extends `${string}[${string}]${string}` ? true : false;

export type ApiOptions<P extends ApiPath, M extends MethodsOf<P>> = {
  method?: M;
  query?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
} & (HasParams<P> extends true ? { params: Params } : { params?: undefined }) &
  (M extends "GET" ? { body?: undefined } : { body?: In<Mod<P>[M]> });

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: unknown,
  ) {
    super(message);
  }
}

/** Calls one of this app's API routes with types from the route file:
 *  const stats = await api("/api/stats");            // typed from app/api/stats.ts's GET
 *  await api("/api/posts/[id]", { method: "POST", params: { id: "1" }, body: { text } }); */
export async function api<P extends ApiPath, M extends MethodsOf<P> = Extract<"GET", MethodsOf<P>>>(
  path: P,
  ...[opts]: HasParams<P> extends true ? [ApiOptions<P, M>] : [ApiOptions<P, M>?]
): Promise<Out<Mod<P>[M]>> {
  const o = (opts ?? {}) as { method?: string; params?: Params; query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal };
  let url = path.replace(/\[(?:\.\.\.)?(\w+)\]/g, (_, k: string) => encodeURIComponent(o.params?.[k] ?? "")).replace(/%2F/g, "/");
  if (o.query) url += "?" + new URLSearchParams(Object.entries(o.query).map(([k, v]) => [k, String(v)]));
  const res = await fetch(url, {
    method: o.method ?? "GET",
    headers: { Accept: "application/json", ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}), ...o.headers },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    signal: o.signal,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError((data as { error?: string })?.error ?? `${res.status} ${res.statusText}`, res.status, data);
  return data as Out<Mod<P>[M]>;
}
