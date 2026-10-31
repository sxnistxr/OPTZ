// Exports the OPTZ page illustrations as standalone SVG files (light and dark) into branding/illustrations,
// for slides, posts and README images. The page itself renders the same components inline, themed by CSS.
// Run from portfolio/: bun scripts/export-illustrations.tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PrebuiltIllustration, IslandsIllustration, RoutesIllustration } from "../app/components/OptzIllustrations";

// The same tokens as app/styles.css, so an exported file matches the page. `front` is the page's
// color-mix of ink into rule, precomputed because not every SVG viewer supports color-mix().
const themes = {
  light: { paper: "#ffffff", ink: "#18181b", body: "#424247", muted: "#68686f", rule: "#e5e5e8", panel: "#f4f4f5", accent: "#c98a00", front: "#a8a8ab" },
  dark: { paper: "#0c0c0e", ink: "#f4f4f5", body: "#c8c8cd", muted: "#a1a1aa", rule: "#29292e", panel: "#1b1b1f", accent: "#ffe46a", front: "#666669" },
};
const style = (t: typeof themes.light) => `<style>
.ill-card{fill:${t.paper};stroke:${t.rule}}.ill-card-front{stroke:${t.front}}
.ill-soft{fill:${t.panel}}.ill-ink{fill:${t.ink}}.ill-rule{fill:none;stroke:${t.rule}}.ill-gridline{fill:none;stroke:${t.rule};stroke-width:1}
.ill-island{fill:${t.paper};stroke:${t.ink};stroke-width:1.5}.ill-accent{fill:${t.accent}}
.ill-accent-stroke{fill:none;stroke:${t.accent};stroke-width:2;stroke-linecap:round}
.ill-link{fill:none;stroke:${t.muted};stroke-dasharray:3 4;opacity:.7}.ill-link-hot{fill:none;stroke:${t.ink};stroke-width:1.5}
.ill-label{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:11px;fill:${t.muted}}
.ill-label-body{fill:${t.body}}.ill-label-ink{fill:${t.ink}}
</style><rect width="480" height="320" fill="${t.paper}"/>`;

const out = join(import.meta.dir, "../branding/illustrations");
mkdirSync(out, { recursive: true });
const art = { "rendered-before-the-request": PrebuiltIllustration, "islands-not-bundles": IslandsIllustration, "typed-from-file-to-link": RoutesIllustration };
for (const [name, Component] of Object.entries(art)) {
  const svg = renderToStaticMarkup(<Component />);
  for (const [theme, tokens] of Object.entries(themes)) {
    const file = svg
      .replace('class="illustration" ', `xmlns="http://www.w3.org/2000/svg" width="960" height="640" `)
      .replace(/aria-hidden="true">/, `role="img" aria-label="${name.replace(/-/g, " ")}">${style(tokens)}`);
    writeFileSync(join(out, `${name}-${theme}.svg`), file + "\n");
    console.log(`branding/illustrations/${name}-${theme}.svg`);
  }
}
