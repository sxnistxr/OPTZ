// Server Actions at runtime (no Node APIs, so it also runs in edge workers): URLs and the
// form-action tagging that lets <form action={fn}> work without JavaScript.

export interface ActionModule {
  file: string;
  exports: string[];
}

export const actionUrl = (id: string, name: string) => `/_optz/action/${id}/${encodeURIComponent(name)}`;
export const BOUND_FIELD = "$optz_bound";

type Tagged = ((...a: unknown[]) => unknown) & { $$FORM_ACTION?: unknown; $$optz?: true };

/** Server side: lets React render <form action={fn}> as a real form post to the action URL
 *  (progressive enhancement), including arguments bound with fn.bind(null, ...). */
export function tagAction(fn: Tagged, id: string, name: string, bound: unknown[] = []): Tagged {
  if (typeof fn !== "function") return fn;
  if (fn.$$optz && !bound.length) return fn;
  const original = fn;
  Object.defineProperty(fn, "$$optz", { value: true, configurable: true });
  Object.defineProperty(fn, "$$FORM_ACTION", {
    configurable: true,
    value: () => {
      let data: FormData | null = null;
      if (bound.length) {
        data = new FormData();
        data.set(BOUND_FIELD, JSON.stringify(bound));
      }
      return { name: undefined, action: actionUrl(id, name), encType: "multipart/form-data", method: "POST", target: undefined, data };
    },
  });
  Object.defineProperty(fn, "bind", {
    configurable: true,
    value: (thisArg: unknown, ...args: unknown[]) => tagAction(Function.prototype.bind.call(original, thisArg, ...args) as Tagged, id, name, [...bound, ...args]),
  });
  return fn;
}

export async function tagModule(mod: Record<string, unknown>, id: string, a: ActionModule) {
  for (const n of a.exports) if (typeof mod[n] === "function") tagAction(mod[n] as Tagged, id, n);
}
