// Types for Open Graph image files (`page.og.tsx` next to `page.tsx`):
//
//   import type { OgProps } from "optz/og";
//   export const size = { width: 1200, height: 630 };
//   export default function Og({ data }: OgProps<Post>) {
//     return <div style={{ display: "flex", fontSize: 64, background: "#111", color: "#fff" }}>{data.title}</div>;
//   }
//
// Rendered to PNG with satori: flexbox layout and inline styles only (no classes).
import type { ReactElement } from "react";
import type { Params } from "./types";

export interface OgProps<D = unknown, P extends Params = Params> {
  /** The page's loader data. */
  data: D;
  params: P;
  locale?: string;
}

export interface OgFont {
  name: string;
  /** A .ttf/.otf/.woff file: a path relative to the project, or an https URL. */
  src: string;
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  style?: "normal" | "italic";
}

export interface OgModule<D = unknown> {
  default: (props: OgProps<D>) => ReactElement;
  size?: { width: number; height: number };
  /** Fonts to draw text with. Default: the families in config.fonts (or Inter). */
  fonts?: OgFont[];
}
