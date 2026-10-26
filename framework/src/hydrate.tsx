// Browser side of one island: hydrate it in place, with router hooks available.
import { createElement, type ComponentType } from "react";
import { hydrateRoot } from "react-dom/client";
import { IslandRouter, type IslandContext } from "./runtime";

export function hydrateIsland(el: Element, Component: ComponentType<Record<string, unknown>>, props: Record<string, unknown>, ctx: IslandContext) {
  return hydrateRoot(el, createElement(IslandRouter, { ctx }, createElement(Component, props)));
}
