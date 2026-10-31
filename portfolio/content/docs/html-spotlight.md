# HTML, under the spotlight

The OPTZ overview lets you inspect a real post as a page, UTF-8 bytes, and HTML. It is also a small example of progressive enhancement with an island.

## Try it

Open the [OPTZ overview](/optz#html-title) and move your pointer across the example post. A 220px circle reveals its source; a softened 24px ring shows bytes from that same HTML. On a touch screen, press and drag horizontally. Vertical gestures scroll the page normally.

Use **View source** to read and scroll the full source. The native disclosure works with Enter or Space and reports its expanded state to assistive technology. Close it with **View page**. This also works when JavaScript is disabled.

With reduced motion enabled, the spotlight still follows your input, but opens instantly and keeps the binary grid still. There is no idle animation.

## One document, three views

`app/components/HtmlSpotlight.tsx` reads the existing SQLite post supplied by the route loader. It builds one article string from escaped metadata and the existing sanitized Markdown output. The rendered layer uses that string as HTML; the source layer shows the exact same string as escaped text. It is the article fragment, rather than the whole response with its header, metadata, and scripts.

The middle layer encodes that string with `TextEncoder`. Bytes are padded to eight binary digits. A literal `<` becomes `00111100`; multi-byte characters produce multiple groups. The grid shifts through neighbouring bytes as the pointer moves. It is a byte stream from the article, rather than a one-to-one mapping between rendered glyph positions and source offsets.

The grid is prepared at build time. CSS radial masks reveal the page, the binary band, and the source. Yellow belongs to the moving byte ring; controls and benchmark charts use the normal monochrome tokens.

## The island

`HtmlSpotlight.island.tsx` exports `hydrate = "visible"`. OPTZ loads it when it approaches the viewport. Its first child is a small marker with a real layout box, so the framework's visibility observer can detect it.

The island enhances the surrounding server-rendered frame. It reads the source already in the DOM instead of sending the post again in island props. Pointer events record coordinates; one `requestAnimationFrame` applies them. The callback does not schedule another frame. Binary text changes only when the pointer reaches another byte offset, and remains static with reduced motion.

The radius transitions over 250ms. Opening the disclosure sets the radius large enough to cover the farthest corner; closing returns to the pointer circle or the normal page. The source is keyboard-scrollable in full-source mode. The visually hidden layer becomes inert and is hidden from screen readers after enhancement.

Scroll, pointer cancellation, leaving the frame, leaving the viewport, and a hidden document clear the active spotlight and pending frame. ResizeObserver updates its bounds. Unmount removes all listeners and disconnects both observers. If CSS masking is unavailable, the normal page and native source toggle remain available.

## A minimal island example

Use an island for the part of a page that needs input. The surrounding route remains static HTML:

```tsx
// app/components/Counter.island.tsx
import { useState } from "react";

export const hydrate = "visible";

export default function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      Count: {count}
    </button>
  );
}
```

```tsx
// app/routes/index.tsx
import Counter from "$components/Counter.island";

export default function Home() {
  return (
    <main>
      <h1>HTML, with a little interaction.</h1>
      <p>This text needs no browser rendering.</p>
      <Counter />
    </main>
  );
}
```

The [framework reference](/docs/framework#islands-the-payload-optimization) explains hydration, JSON props, and the optional Preact runtime. The [example apps](https://github.com/sxnistxr/OPTZ/tree/main/apps/features) show actions, streaming, caching, and routing in context.

## Payload measurements

The figures beside the spotlight describe `/blog/sqlite-was-reparsing-my-query`, measured from a production build. They do not describe the larger OPTZ landing page or include its Three.js hero and spotlight.

`content/optz-payload.json` stores exact byte counts, the route, date, and scope. The page displays decimal KB (1 KB = 1,000 bytes), rounded to one decimal. HTML has both its uncompressed and gzip size; JavaScript sums the gzip sizes of unique external script URLs in the page. CSS, fonts, response headers, inline script text, and dynamically requested island chunks are excluded. Inline boot data remains part of the HTML count. This blog route currently has no interactive islands.

Refresh the figures from the repository root:

```sh
cd portfolio
bun run build
bun scripts/measure-payload.ts
bun run build
```

The final build incorporates the new JSON into the overview. The script fails if a script is external or a compressed artifact is missing, so it cannot silently report an incomplete measurement. Benchmark throughput, build, start, and memory figures separately read `bench/results.json`; they retain their historical workload and date.

## Working apps

The overview preserves the four starter cards and links to these runnable applications in the repository:

| App | What to inspect |
| --- | --- |
| [Basic starter](https://github.com/sxnistxr/OPTZ/tree/main/apps/example) | Static and dynamic routes, loaders, and islands |
| [Feature showcase](https://github.com/sxnistxr/OPTZ/tree/main/apps/features) | Streaming, actions, ISR, and routing variants |
| [Accounts and modules](https://github.com/sxnistxr/OPTZ/tree/main/apps/auth) | Authentication and optional services |
| [Full-stack starter](https://github.com/sxnistxr/OPTZ/tree/main/apps/fullstack) | Persistent SQLite, sessions, private notes, and files |

Read each app's setup instructions before running it. The full-stack SQLite app needs a Bun server with persistent disk. A static export or an edge worker is appropriate only for features supported by that target.

## Verify a change

Run `bun run check`, `bun test test/html-bytes.test.ts`, and `bun run build` from `portfolio/`. Serve the production build on a free port, for example `PORT=3002 bun run start`, then inspect `/optz` at desktop, tablet, and narrow mobile widths in both themes.

Check pointer entry, movement, stopping, exit, and full-source expansion. Tab to View source, toggle it with Enter and Space, and scroll the revealed code by keyboard. Repeat with JavaScript disabled and reduced motion enabled. On touch, check horizontal exploration and normal vertical scrolling. Navigate to docs and back using client navigation, then verify the spotlight still works and no animation frames keep running after exit.

## Layout and visual examples

The overview uses four substantial bento panels: prepared pages, interactive islands, a typed route with its output, and an example notes workspace. Six smaller capabilities use open rows beneath them. The page keeps the light-trail hero, live measurements, foundation row, copyable install command, and four starter cards from the updated main branch.

Supporting prose is 18px with a generous line height. Sections have 80–136px of separation, and the bento has 24px gutters and 32–40px copy insets. Cards stack below 720px. The measurement strip becomes three readable rows on phones. These rules are scoped to the overview; documentation keeps its own reading layout.

The prepared-page and island panels use the original diagrams from `app/components/OptzIllustrations.tsx`. Their layered files, browser layout, technical labels, and yellow details remain the base. An optional `depth` variant adds shallow neutral faces, beveled edges, offset soft shadows, and faint connector paths, following the user's inset-panel reference. Corresponding light/dark variables keep this treatment within the site's existing theme. These are SVG and CSS visuals with no additional JavaScript.

The notes image is a real browser capture of a locally authored, fictional workspace, labeled as an example. Its two light/dark WebPs carry dimensions and load lazily. The route code and output remain selectable HTML. The original SVG exports are in `branding/illustrations/`; sample pages and capture steps are in `branding/previews/`; `branding/optz-bento/README.md` documents how the visuals join the page.
