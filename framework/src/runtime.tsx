// The router runtime. Used on the server (to render) and in the browser (to hydrate and
// navigate without full page loads). Must not touch browser globals at import time.
import {
  Component,
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
} from "react";
import { dataPath, matchRoute, matchSegments, type Segment } from "./match";
import type { ErrorModule, Head, Href, LayoutModule, PageModule, Params, RenderMode } from "./types";

// ---- state ---------------------------------------------------------------------------------

/** i18n settings the browser needs to build links. */
export interface LocaleInfo {
  locale: string;
  locales: string[];
  defaultLocale: string;
  prefixDefault?: boolean;
}

export interface PageState {
  pathname: string;
  params: Params;
  data: unknown;
  Page: ComponentType<{ data: unknown; params: Params; locale?: string }>;
  layouts: ComponentType<{ children: ReactNode; params: Params }>[];
  ErrorView?: ComponentType<{ error: Error; params: Params }>;
  /** Shown while the page streams (_loading.tsx). Server only. */
  Loading?: ComponentType<{ params: Params }>;
  /** Parallel route slots per layout (same index as `layouts`). Server only. */
  slots?: Array<Record<string, ReactNode> | undefined>;
  i18n?: LocaleInfo;
}

/** "/blog" -> "/fr/blog" for the current (or given) locale. */
export function localizeHref(href: string, i18n: LocaleInfo | undefined, locale?: string): string {
  if (!i18n || !href.startsWith("/") || href.startsWith("//")) return href;
  const first = href.split(/[/?#]/)[1];
  if (i18n.locales.includes(first)) return href;
  const l = locale ?? i18n.locale;
  if (l === i18n.defaultLocale && !i18n.prefixDefault) return href;
  return `/${l}${href === "/" ? "" : href}`;
}

interface RouterValue {
  state: PageState;
  navigate: (href: string, opts?: { replace?: boolean; scroll?: boolean }) => Promise<void>;
  prefetch: (href: string) => void;
  navigating: boolean;
}

const noop = async () => {};
const RouterContext = createContext<RouterValue | null>(null);

const useRouterValue = () => {
  const v = useContext(RouterContext);
  if (!v) throw new Error("optz: router hooks must be used inside an optz page");
  return v;
};

/** The loader data of the current page. */
export const useLoaderData = <T = unknown,>() => useRouterValue().state.data as T;
export const useParams = <P extends Params = Params>() => useRouterValue().state.params as P;
export const useNavigating = () => useRouterValue().navigating;
/** The current locale when `i18n` is configured. */
export const useLocale = () => useRouterValue().state.i18n?.locale;
export function useRouter() {
  const { state, navigate, prefetch, navigating } = useRouterValue();
  return {
    pathname: state.pathname,
    params: state.params,
    locale: state.i18n?.locale,
    navigate,
    prefetch,
    navigating,
    back: () => history.back(),
    /** Re-fetch the current page from the server (islands mode keeps unchanged islands mounted). */
    refresh: () => (globalThis as { __optz?: { refresh?: () => unknown } }).__optz?.refresh?.(),
  };
}

// ---- rendering -----------------------------------------------------------------------------

class Boundary extends Component<{ view?: PageState["ErrorView"]; params: Params; resetKey: string; children: ReactNode }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  static getDerivedStateFromProps(p: { resetKey: string }, s: { key: string }) {
    return p.resetKey !== s.key ? { error: null, key: p.resetKey } : null;
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const View = this.props.view;
    return View ? <View error={error} params={this.props.params} /> : <p role="alert">Something went wrong on this page: {error.message}</p>;
  }
}

/** Layouts wrapped around the page, with the nearest error boundary inside the layouts. */
export function Tree({ state }: { state: PageState }) {
  const { Page, layouts, params, data, ErrorView, Loading, pathname, slots } = state;
  let page: ReactNode = <Page data={data} params={params} locale={state.i18n?.locale} />;
  if (Loading) page = <Suspense fallback={<Loading params={params} />}>{page}</Suspense>;
  let node: ReactNode = (
    <Boundary view={ErrorView} params={params} resetKey={pathname}>
      {page}
    </Boundary>
  );
  for (let i = layouts.length - 1; i >= 0; i--) {
    const L = layouts[i];
    node = (
      <L params={params} {...slots?.[i]}>
        {node}
      </L>
    );
  }
  return node;
}

/** What an island sees of the router (islands mode). */
export interface IslandContext {
  pathname: string;
  params: Params;
  navigate: (href: string) => void;
  i18n?: LocaleInfo;
}

/** Router hooks inside an island: pathname, params and navigation, no page data. */
export function IslandRouter({ ctx, children }: { ctx: IslandContext; children: ReactNode }) {
  const value = useMemo<RouterValue>(
    () => ({
      state: { pathname: ctx.pathname, params: ctx.params, data: undefined, Page: () => null, layouts: [], i18n: ctx.i18n },
      navigate: async (href) => ctx.navigate(href),
      prefetch: () => {},
      navigating: false,
    }),
    [ctx],
  );
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

/** Server-side wrapper: same tree, no navigation. */
export function StaticRouter({ state }: { state: PageState }) {
  const value = useMemo(() => ({ state, navigate: noop, prefetch: () => {}, navigating: false }), [state]);
  return (
    <RouterContext.Provider value={value}>
      <Tree state={state} />
    </RouterContext.Provider>
  );
}

// ---- Link ----------------------------------------------------------------------------------

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  /** Typed against your routes: a URL no page answers is a type error. */
  href: Href;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean;
  /** i18n: link to this locale's version, or `false` to leave the href as written. Default: the current locale. */
  locale?: string | false;
};

/** An <a> that navigates without a full page load and prefetches on hover/focus. */
export function Link({ href: rawHref, replace, scroll, prefetch = true, locale, onClick, onMouseEnter, onFocus, onTouchStart, ...rest }: LinkProps) {
  const r = useContext(RouterContext);
  const href = locale === false ? rawHref : localizeHref(rawHref, r?.state.i18n, locale);
  const pre = () => prefetch && r?.prefetch(href);
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (!r || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (rest.target && rest.target !== "_self") return;
    if (rest.download !== undefined) return;
    e.preventDefault();
    r.navigate(href, { replace, scroll });
  };
  return (
    <a
      href={href}
      onClick={click}
      onMouseEnter={(e) => (onMouseEnter?.(e), pre())}
      onFocus={(e) => (onFocus?.(e), pre())}
      onTouchStart={(e) => (onTouchStart?.(e), pre())}
      {...rest}
    />
  );
}

// ---- browser ------------------------------------------------------------------------------

export interface ClientRoute {
  pattern: string;
  segments: Segment[];
  render: RenderMode;
  hasLoader: boolean;
  load: () => Promise<PageModule>;
  layouts: Array<() => Promise<LayoutModule>>;
  error?: () => Promise<ErrorModule>;
}

interface Payload {
  data?: unknown;
  head?: Head;
  redirect?: string;
}

interface SpaBoot {
  pattern: string;
  params: Params;
  data: unknown;
  i18n?: LocaleInfo;
  dev?: boolean;
}

/** "/fr/blog" -> { locale info for fr, path "/blog" } */
function splitLocale(pathname: string, base: LocaleInfo | undefined): { i18n?: LocaleInfo; path: string } {
  if (!base) return { path: pathname };
  const first = pathname.split("/")[1];
  if (base.locales.includes(first)) return { i18n: { ...base, locale: first }, path: pathname.slice(first.length + 1) || "/" };
  return { i18n: { ...base, locale: base.defaultLocale }, path: pathname };
}
const readBoot = (): SpaBoot | null => {
  try {
    return JSON.parse(document.getElementById("__optz_boot")?.textContent || "null");
  } catch {
    return null;
  }
};

async function loadState(route: ClientRoute, pathname: string, params: Params, data: unknown, i18n?: LocaleInfo): Promise<PageState> {
  const [mod, layouts, err] = await Promise.all([route.load(), Promise.all(route.layouts.map((l) => l())), route.error?.()]);
  return { pathname, params, data, Page: mod.default as PageState["Page"], layouts: layouts.map((l) => l.default), ErrorView: err?.default, i18n };
}

function applyHead(head: Head | undefined) {
  if (!head) return;
  if (head.title) document.title = head.title;
  if (head.description !== undefined) {
    let m = document.querySelector('meta[name="description"]');
    if (!m) {
      m = document.createElement("meta");
      m.setAttribute("name", "description");
      document.head.append(m);
    }
    m.setAttribute("content", head.description);
  }
}

function Root({ routes, initial, urlParams }: { routes: ClientRoute[]; initial: PageState; urlParams?: Params }) {
  const [state, setState] = useState(initial);
  // Client-rendered shells are built without params: hydrate exactly as rendered, then supply
  // the real ones from the URL.
  useEffect(() => {
    if (urlParams) setState((s) => ({ ...s, params: urlParams }));
  }, [urlParams]);
  const [navigating, setNavigating] = useState(false);
  const cache = useRef(new Map<string, Promise<Payload | null>>());
  const seq = useRef(0);

  const fetchPayload = useCallback((pathname: string, route: ClientRoute): Promise<Payload | null> => {
    if (!route.hasLoader || route.render === "client") return Promise.resolve({});
    // Dynamic pages are fetched fresh each time; static ones are cached for the session.
    const key = pathname;
    const hit = route.render === "static" ? cache.current.get(key) : undefined;
    if (hit) return hit;
    const p = fetch(dataPath(pathname), { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? (r.json() as Promise<Payload>) : null))
      .catch(() => null);
    if (route.render === "static") cache.current.set(key, p);
    return p;
  }, []);

  const prefetch = useCallback(
    (href: string) => {
      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return;
      const m = matchRoute(routes, splitLocale(url.pathname, initial.i18n).path);
      if (!m) return;
      m.route.load();
      m.route.layouts.forEach((l) => l());
      if (m.route.render === "static") fetchPayload(url.pathname, m.route);
    },
    [routes, fetchPayload, initial.i18n],
  );

  const navigate = useCallback(
    async (href: string, opts: { replace?: boolean; scroll?: boolean; pop?: boolean } = {}) => {
      const url = new URL(href, location.href);
      const loc = splitLocale(url.pathname, initial.i18n);
      const m = url.origin === location.origin ? matchRoute(routes, loc.path) : null;
      if (!m) return void location.assign(url.href);
      if (url.pathname === location.pathname && url.hash && !opts.pop) {
        history.pushState(null, "", url.href);
        return void document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView();
      }
      const id = ++seq.current;
      setNavigating(true);
      try {
        const [payload, next] = await Promise.all([fetchPayload(url.pathname, m.route), loadState(m.route, url.pathname, m.params, undefined, loc.i18n)]);
        if (id !== seq.current) return;
        // No data (404, error, offline): let the server render the page properly.
        if (!payload) return void location.assign(url.href);
        if (payload.redirect) return void navigate(payload.redirect, { replace: true });
        next.data = payload.data;
        if (!opts.pop) {
          history.replaceState({ ...history.state, scroll: scrollY }, "");
          history[opts.replace ? "replaceState" : "pushState"]({ scroll: 0 }, "", url.href);
        }
        setState(next);
        const mod = await m.route.load();
        applyHead(payload.head ?? mod.head?.(undefined as never, { params: m.params }));
        requestAnimationFrame(() => {
          if (opts.pop) return scrollTo(0, history.state?.scroll ?? 0);
          if (url.hash) return document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView();
          if (opts.scroll !== false) scrollTo(0, 0);
        });
      } catch {
        location.assign(url.href);
      } finally {
        if (id === seq.current) setNavigating(false);
      }
    },
    [routes, fetchPayload, initial.i18n],
  );

  useEffect(() => {
    history.scrollRestoration = "manual";
    const onPop = () => navigate(location.href, { pop: true });
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [navigate]);

  useEffect(() => {
    (globalThis as { __optz?: unknown }).__optz = {
      navigate: (href: string) => navigate(href),
      refresh: () => {
        cache.current.clear();
        return navigate(location.href, { replace: true, scroll: false });
      },
    };
  }, [navigate]);

  const value = useMemo(() => ({ state, navigate, prefetch, navigating }), [state, navigate, prefetch, navigating]);
  return (
    <RouterContext.Provider value={value}>
      <Tree state={state} />
    </RouterContext.Provider>
  );
}

/** Browser entry: hydrates the server-rendered page, then takes over navigation. */
export async function start(routes: ClientRoute[], _i18n?: unknown) {
  const boot = readBoot();
  const el = document.getElementById("__optz");
  if (!boot || !el) return;
  if (boot.dev) import("./dev-client").then((m) => m.connect({ refresh: async () => (globalThis as { __optz?: { refresh?: () => Promise<void> } }).__optz?.refresh?.() }));
  const route = routes.find((r) => r.pattern === boot.pattern);
  if (!route) return;
  const { hydrateRoot } = await import("react-dom/client");
  const initial = await loadState(route, location.pathname, boot.params, boot.data, boot.i18n);
  const urlParams = route.render === "client" ? (matchSegments(route.segments, splitLocale(location.pathname, boot.i18n).path) ?? undefined) : undefined;
  hydrateRoot(el, <Root routes={routes} initial={initial} urlParams={urlParams} />);
}
