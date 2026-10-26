// Shared by build and server; deliberately imports nothing heavy.
import { join } from "node:path";
import type { Segment } from "./match";
import type { RenderMode } from "./types";

export interface ManifestRoute {
  pattern: string;
  segments: Segment[];
  file: string;
  kind: "page" | "api";
  render: RenderMode;
  hasLoader: boolean;
  layouts: string[];
  error?: string;
  preload: string[];
  shell?: string;
}

export interface Manifest {
  version: 2;
  mode: "islands" | "spa";
  entry: string;
  css: string[];
  routes: ManifestRoute[];
  /** Islands mode: island id -> chunk URL. */
  islands: Record<string, string>;
  notFound?: string;
  rootLayouts: string[];
  redirects: Record<string, { status: number; location: string }>;
}

export const outDirFor = (root: string, dev?: boolean) => (dev ? join(root, ".optz/dev") : join(root, "dist"));
