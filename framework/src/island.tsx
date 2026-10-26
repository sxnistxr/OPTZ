// Server side of islands. Every `*.island.tsx` default export is wrapped (by the loader plugin
// in plugin.ts) so that, when rendered on the server, it emits
//   <optz-island data-id="components/Feed.island.tsx" data-props="{...}">...html...</optz-island>
// The browser hydrates exactly those elements and nothing else, so a page without islands
// ships no React at all. Islands nested inside islands render inline (the outer one owns them).
import { createContext, createElement, useContext, type ComponentType } from "react";
import type { Hydrate } from "./types";

const InIsland = createContext(false);

export function island<P extends object>(id: string, Component: ComponentType<P>, hydrate: Hydrate = "load"): ComponentType<P> {
  const Wrapped = (props: P) => {
    if (useContext(InIsland)) return createElement(Component, props);
    if ("children" in props && props.children != null && typeof props.children !== "string") {
      throw new Error(`island ${id}: props must be JSON (children can only be a string)`);
    }
    return createElement(
      "optz-island",
      { "data-id": id, "data-props": JSON.stringify(props), ...(hydrate !== "load" ? { "data-hydrate": hydrate } : {}) },
      createElement(InIsland.Provider, { value: true }, createElement(Component, props)),
    );
  };
  Wrapped.displayName = `Island(${Component.displayName || Component.name || id})`;
  return Wrapped;
}
