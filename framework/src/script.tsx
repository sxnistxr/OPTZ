// <Script>: third-party scripts that don't slow the page down.
//
//   import { Script } from "optz/script";
//   <Script src="https://example.com/analytics.js" strategy="lazyOnload" />
//
//   beforeInteractive  a normal <script>: runs before the page's own code (blocks parsing)
//   afterInteractive   loads as soon as the page's runtime starts (default)
//   lazyOnload         loads after the page has loaded, when the browser is idle
//
// Each src loads once, also across in-app navigations. Inline scripts aren't supported (they'd
// need 'unsafe-inline' in your CSP); host the code in public/ and point src at it.
import { createElement, useEffect } from "react";
import { loadScript } from "./script-loader";

export interface ScriptProps {
  src: string;
  strategy?: "beforeInteractive" | "afterInteractive" | "lazyOnload";
  /** Called when it has loaded (only from islands and SPA pages, which run in the browser). */
  onLoad?: () => void;
  onError?: (e: Error) => void;
  /** Extra attributes for the <script>, e.g. { "data-domain": "example.com" }. */
  attrs?: Record<string, string>;
}

export function Script({ src, strategy = "afterInteractive", onLoad, onError, attrs = {} }: ScriptProps) {
  useEffect(() => {
    if (strategy === "beforeInteractive") return;
    const go = () => loadScript(src, attrs).then(onLoad, onError);
    if (strategy === "lazyOnload" && document.readyState !== "complete") {
      addEventListener("load", go, { once: true });
      return () => removeEventListener("load", go);
    }
    go();
  }, [src, strategy]);
  if (strategy === "beforeInteractive") return createElement("script", { src, ...attrs });
  // Pages are HTML: the marker is how the islands runtime finds scripts outside islands.
  const data: Record<string, string> = { "data-src": src, "data-strategy": strategy };
  for (const [k, v] of Object.entries(attrs)) data[`data-attr-${k}`] = v;
  return createElement("optz-script", data);
}

export default Script;
