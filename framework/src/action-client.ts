// Browser side of Server Actions: what an island gets when it imports a "use server" module.
// A call POSTs the arguments as JSON (or the FormData, for form actions), follows redirects
// and, when the action revalidated something, refreshes the current page in place.

export class ActionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ActionError";
  }
}

interface OptzGlobal {
  navigate?: (href: string) => unknown;
  refresh?: () => unknown;
}
const optz = () => (globalThis as { __optz?: OptzGlobal }).__optz ?? {};

type Action = ((...args: unknown[]) => Promise<unknown>) & { bind: (thisArg: unknown, ...args: unknown[]) => Action };

export function createAction(id: string, name: string, bound: unknown[] = []): Action {
  const fn = (async (...args: unknown[]) => call(id, name, [...bound, ...args])) as Action;
  Object.defineProperty(fn, "bind", { value: (_t: unknown, ...more: unknown[]) => createAction(id, name, [...bound, ...more]) });
  return fn;
}

async function call(id: string, name: string, args: unknown[]) {
  const last = args[args.length - 1];
  let body: BodyInit;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (typeof FormData !== "undefined" && last instanceof FormData) {
    const fd = new FormData();
    last.forEach((v, k) => fd.append(k, v));
    fd.set("$optz_args", JSON.stringify(args.slice(0, -1)));
    body = fd;
    headers["X-Optz-Action"] = "form";
  } else {
    body = JSON.stringify(args);
    headers["Content-Type"] = "application/json";
    headers["X-Optz-Action"] = "json";
  }
  let res: Response;
  try {
    res = await fetch(`/_optz/action/${id}/${encodeURIComponent(name)}`, { method: "POST", headers, body });
  } catch {
    throw new ActionError("Couldn't reach the server. Check your connection and try again.", 0);
  }
  const out = (await res.json().catch(() => null)) as { ok: boolean; value?: unknown; error?: string; redirect?: string; revalidated?: boolean } | null;
  if (!out) throw new ActionError(`The server answered ${res.status}.`, res.status);
  if (out.redirect) {
    const nav = optz().navigate;
    if (nav) nav(out.redirect);
    else location.assign(out.redirect);
    return out.value;
  }
  if (!out.ok) throw new ActionError(out.error ?? "Something went wrong.", res.status);
  if (out.revalidated) optz().refresh?.();
  return out.value;
}
