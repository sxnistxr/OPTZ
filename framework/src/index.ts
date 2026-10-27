// The isomorphic public API: safe to import from pages, layouts, islands and API routes.
import type { ApiContext, Config, Middleware, Params, PatternParams, RouteCache, TypedResponse } from "./types";

export type * from "./types";
export { resolveConfig } from "./types";
export { Link, useRouter, useParams, useLoaderData, useNavigating, useLocale, localizeHref } from "./runtime";

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
export const json = <T,>(data: T, init: ResponseInit = {}): TypedResponse<T> => {
  // init.headers may be a Headers object or [k, v] pairs, which spreading would lose.
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
};

/** What a `handler()` receives: the usual API context plus a typed JSON body reader. */
export interface HandlerContext<P extends Params = Params, B = unknown> extends ApiContext<P> {
  body: () => Promise<B>;
}

/** An API handler whose request body type flows to the typed `api()` client. Annotate the
 *  context; everything else is inferred:
 *  export const POST = handler(async ({ params, body }: HandlerContext<{ id: string }, { text: string }>) =>
 *    json({ saved: (await body()).text }, { status: 201 })); */
export function handler<P extends Params, B, R extends TypedResponse<unknown> | Promise<TypedResponse<unknown>>>(fn: (ctx: HandlerContext<P, B>) => R) {
  const h = (ctx: ApiContext<P>) => fn({ ...ctx, body: () => readJson<B>(ctx.request) });
  return h as ((ctx: ApiContext<P>) => R) & { readonly __body?: B };
}

/** The request's JSON body. Answers for you (the thrown Response is sent as is) with 415 when
 *  it isn't JSON and 400 when it doesn't parse. */
export async function readJson<B = unknown>(request: Request): Promise<B> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/([\w.+-]+\+)?json\b/i.test(type)) throw json({ error: "Send the body as JSON (Content-Type: application/json)." }, { status: 415 });
  const text = await request.text();
  try {
    return JSON.parse(text) as B;
  } catch {
    throw json({ error: "The body isn't valid JSON." }, { status: 400 });
  }
}

export type { RouteCache };

// ---- typed API client ----------------------------------------------------------------------

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Registry = import("./types").ApiRegistry;
/** Until `optz check`/`build` generates the registry, any path (and any method) is allowed. */
type Untyped = keyof Registry extends never ? true : false;
type ApiPath = Untyped extends true ? string : keyof Registry & string;
type Mod<P extends string> = P extends keyof Registry ? Registry[P] : Record<Method, (...a: never[]) => unknown>;
type MethodsOf<P extends string> = Untyped extends true ? Method : Extract<keyof Mod<P>, Method>;
type Out<H> = H extends (...a: never[]) => infer R ? (Awaited<R> extends TypedResponse<infer T> ? T : unknown) : unknown;
type In<H> = H extends { readonly __body?: infer B } ? B : unknown;
type HasParams<P extends string> = P extends `${string}[${string}]${string}` ? true : false;
export type ApiOptions<P extends string, M extends MethodsOf<P>> = {
  method?: M;
  query?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
} & (HasParams<P> extends true ? { params: PatternParams<P> } : { params?: undefined }) &
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
/** Fills an API pattern: [x] is one segment (a "/" in it is escaped), [...x] one or more and
 *  [[...x]] zero or more (slashes kept). A missing required param is an error, not an empty
 *  segment. */
export function apiUrl(pattern: string, params: Params = {}): string {
  return pattern
    .replace(/\/\[\[\.\.\.(\w+)\]\]/g, (_m, k: string) => (params[k] ? "/" + params[k].split("/").map(encodeURIComponent).join("/") : ""))
    .replace(/\[\.\.\.(\w+)\]/g, (_m, k: string) => {
      if (!params[k]) throw new TypeError(`api(${pattern}): missing param "${k}"`);
      return params[k].split("/").map(encodeURIComponent).join("/");
    })
    .replace(/\[(\w+)\]/g, (_m, k: string) => {
      if (params[k] === undefined || params[k] === "") throw new TypeError(`api(${pattern}): missing param "${k}"`);
      return encodeURIComponent(params[k]);
    });
}

export async function api<P extends ApiPath, M extends MethodsOf<P> = Extract<"GET", MethodsOf<P>>>(
  path: P,
  ...[opts]: HasParams<P> extends true ? [ApiOptions<P, M>] : [ApiOptions<P, M>?]
): Promise<Out<Mod<P>[M]>> {
  const o = (opts ?? {}) as { method?: string; params?: Params; query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal };
  let url = apiUrl(path as string, o.params);
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
