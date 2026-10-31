---
name: DihLabs / OPTZ
description: A monochrome developer lab with yellow generative motion.
colors:
  paper: '#ffffff'
  ink: '#18181b'
  body: '#424247'
  muted: '#68686f'
  rule: '#e5e5e8'
  panel: '#f4f4f5'
  code: '#f8f8f9'
  code-ink: '#27272a'
  signal: '#27272a'
  focus: '#71717a'
  dark-paper: '#0c0c0e'
  dark-ink: '#f4f4f5'
  dark-body: '#c8c8cd'
  dark-muted: '#a1a1aa'
  dark-rule: '#29292e'
  dark-panel: '#1b1b1f'
  dark-code: '#141416'
  dark-code-ink: '#e4e4e7'
  dark-signal: '#f4f4f5'
  dark-focus: '#a1a1aa'
  trail-yellow: '#ffe46a'
  packet-yellow: '#ffdf51'
  optz-panel: '#f4f4f5'
  dark-optz-panel: '#18181b'
typography:
  display:
    fontFamily: '"Schibsted Grotesk", "Schibsted Grotesk Fallback", ui-sans-serif, system-ui, sans-serif'
    fontSize: clamp(3rem, 7vw, 6rem)
    fontWeight: 600
    lineHeight: 1
    letterSpacing: -0.045em
  display-optz:
    fontFamily: '"Schibsted Grotesk", "Schibsted Grotesk Fallback", ui-sans-serif, system-ui, sans-serif'
    fontSize: clamp(3rem, 7vw, 6rem)
    fontWeight: 600
    lineHeight: 1
    letterSpacing: -0.04em
  headline:
    fontFamily: '"Schibsted Grotesk", "Schibsted Grotesk Fallback", ui-sans-serif, system-ui, sans-serif'
    fontSize: clamp(2rem, 3.6vw, 3rem)
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.035em
  optz-headline:
    fontFamily: '"Schibsted Grotesk", "Schibsted Grotesk Fallback", ui-sans-serif, system-ui, sans-serif'
    fontSize: clamp(2.25rem, 4.3vw, 3.5rem)
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: -0.035em
  optz-feature-title:
    fontFamily: '"Schibsted Grotesk", "Schibsted Grotesk Fallback", ui-sans-serif, system-ui, sans-serif'
    fontSize: 1.5rem
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: -0.025em
  optz-intro:
    fontFamily: '"Schibsted Grotesk", "Schibsted Grotesk Fallback", ui-sans-serif, system-ui, sans-serif'
    fontSize: 1.25rem
    fontWeight: 400
    lineHeight: 1.65
  optz-reading:
    fontFamily: '"Schibsted Grotesk", "Schibsted Grotesk Fallback", ui-sans-serif, system-ui, sans-serif'
    fontSize: 1.125rem
    fontWeight: 400
    lineHeight: 1.65
  spotlight-body:
    fontFamily: '"Newsreader", "Newsreader Fallback", ui-serif, Georgia, serif'
    fontSize: 1.125rem
    fontWeight: 400
    lineHeight: 1.75
  spotlight-code:
    fontFamily: ui-monospace, "SF Mono", Menlo, Consolas, monospace
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.8
  page-title:
    fontFamily: '"Schibsted Grotesk", "Schibsted Grotesk Fallback", ui-sans-serif, system-ui, sans-serif'
    fontSize: clamp(2.5rem, 5vw, 3.5rem)
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: -0.04em
  body:
    fontFamily: '"Schibsted Grotesk", "Schibsted Grotesk Fallback", ui-sans-serif, system-ui, sans-serif'
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
  docs-body:
    fontFamily: '"Schibsted Grotesk", "Schibsted Grotesk Fallback", ui-sans-serif, system-ui, sans-serif'
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.75
  docs-title:
    fontFamily: '"Schibsted Grotesk", "Schibsted Grotesk Fallback", ui-sans-serif, system-ui, sans-serif'
    fontSize: clamp(2.25rem, 3.6vw, 2.75rem)
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: -0.035em
  docs-navigation:
    fontFamily: '"Schibsted Grotesk", "Schibsted Grotesk Fallback", ui-sans-serif, system-ui, sans-serif'
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.6
  post-body:
    fontFamily: '"Newsreader", "Newsreader Fallback", ui-serif, Georgia, serif'
    fontSize: 1.1875rem
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: '"Schibsted Grotesk", "Schibsted Grotesk Fallback", ui-sans-serif, system-ui, sans-serif'
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: 1.5
  code:
    fontFamily: ui-monospace, "SF Mono", Menlo, Consolas, monospace
    fontSize: 0.86rem
    fontWeight: 400
    lineHeight: 1.65
rounded:
  focus: 2px
  chart: 3px
  inline-code: 4px
  field: 6px
  control: 8px
  menu: 10px
  panel: 12px
  optz-bento: 20px
  spotlight: 16px
  dot: 9999px
spacing:
  xs: 0.5rem
  sm: 0.75rem
  md: 1rem
  lg: 1.5rem
  xl: 2rem
  2xl: 3rem
  3xl: 3.5rem
  4xl: 4rem
  5xl: 5rem
  6xl: 6rem
  optz-copy: 2.5rem
  optz-copy-phone: 1.75rem
  optz-section: clamp(5rem, 9vw, 8.5rem)
components:
  button-primary:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.paper}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: 0.6rem 1rem
  button-primary-hover:
    backgroundColor: '{colors.body}'
  button-outline:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: 0.6rem 1rem
  button-outline-hover:
    backgroundColor: '{colors.panel}'
  button-ghost:
    backgroundColor: transparent
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: 0.6rem 1rem
  button-ghost-hover:
    backgroundColor: '{colors.panel}'
  docs-search:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.body}'
    rounded: '{rounded.field}'
    padding: 0.5rem 3.5rem 0.5rem 2.1rem
    height: 36px
    width: 220px
  site-navigation:
    textColor: '{colors.body}'
    typography: '{typography.docs-navigation}'
    padding: 0.75rem 0
  theme-toggle:
    textColor: '{colors.muted}'
    rounded: '{rounded.field}'
    size: 36px
  request-path:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.ink}'
    rounded: '{rounded.panel}'
    padding: 1.5rem 2rem
  optz-product-card:
    backgroundColor: '{colors.optz-panel}'
    textColor: '{colors.ink}'
    rounded: '{rounded.optz-bento}'
  optz-product-copy:
    typography: '{typography.optz-reading}'
    padding: 2.5rem 2.5rem 0
  work-row:
    textColor: '{colors.ink}'
    padding: 2rem 0
---

# Design System: DihLabs / OPTZ

## Overview

**Creative North Star: "Curiosity, in progress."**

DihLabs presents a developer's work with an immersive introduction, open space, and direct editorial lists. OPTZ shares the same monochrome world, adding a playful request character and a sense of speed. The approved composition is confident and clear; Next.js informs hierarchy without supplying the identity. Documentation draws on the user-pinned Next.js, Angular, Linear, shadcn and Raycast references for a familiar reading interface.

Generative yellow geometry is the expressive element. The OPTZ overview uses its original flat, technical SVG line drawings and a labeled browser capture of an original example workspace. Interface controls, navigation, status, and benchmark evidence remain monochrome; the source spotlight uses a yellow byte ring as an inspection effect. DihLabs leads with development work and writing; AI, SDXL, and language-model showcases are outside its approved identity.

**Key Characteristics:**

- Large, closely tracked sans-serif headings and generous reading space.
- Device-aware light and dark themes across introductions, editorial content, and documentation, with restrained rules.
- Yellow Three.js artwork with an arrival animation, continuous ambient motion, and deliberate replay.
- On the OPTZ overview, spacious asymmetric panels, each with an inset HTML window: build output, a page with one island, a typed route, and a labeled app capture.

This spec describes the implemented portfolio app. Token primitives above are normative; `app/styles.css` implements their light and dark assignments. `.impeccable/design.json` adds component previews and behavior metadata. The repository's `docs/DESIGN.md` describes the engine, not this visual system.

## Colors

### Primary

Ink is the interface's primary color, reversed to pale ink on dark surfaces. Trail Yellow and Packet Yellow supply the artwork's warmth; shader lines and sparks vary that yellow through opacity and lighting.

### Neutral

Paper carries reading surfaces; Body and Muted distinguish prose from supporting information. Rule divides rows and navigation. Panel supports code fragments and architecture diagrams. Code and Code Ink separate code blocks from surrounding prose. Signal marks selected documentation and static status dots. OPTZ Panel is a scoped neutral for the overview bento; its dark edition is distinct from the shared Dark Panel. Keep those assignments local to `/optz`.

The `dark-*` values replace their matching semantic tokens across the entire website. Both themes use distinct Code and Code Ink tokens. The device preference sets the initial theme; the header toggle remembers an explicit light or dark choice across pages and browser tabs. Without an explicit choice, device changes continue to apply. Focus uses the active theme's dedicated value. Light Three.js artwork uses `brightness(.62) saturate(1.3)`; dark Three.js artwork is unfiltered. The original inline OPTZ diagrams follow semantic theme tokens directly; the notes capture uses separate light/dark editions selected by the same theme state. Neither uses the Three.js artwork filter.

**The Artwork Only Rule.** Reserve yellow for the generated trails, request character, OPTZ illustration details, and the source spotlight’s byte ring. Controls, focus, status, and benchmark bars stay monochrome.

## Typography

Schibsted Grotesk carries display, interface, and documentation text. Newsreader carries long-form posts. The system monospace stack is reserved for code. Font configuration supplies size-matched fallbacks; do not substitute an unrelated display face.

One role-based scale lives in `app/styles.css` as `--text-*` tokens, calibrated against measured Vercel, Next.js, Raycast, Bun and Apple pages. Each step has a shared role. The OPTZ overview adds the scoped roles below for its user-requested spacious layout; those additions do not change documentation or homepage text:

| role | size | use |
|---|---|---|
| display | clamp(3rem, 7vw, 6rem), 1.0, -0.045em | the one headline that opens a landing page |
| title | clamp(2.5rem, 5vw, 3.5rem), -0.04em | inner page names: Projects, Writing, errors |
| heading | clamp(2rem, 3.6vw, 3rem), -0.035em | a section of a landing page |
| subheading | 1.5rem | a block inside a section; docs h2 |
| lead | 1.25rem (1.125rem on phones) | the sentence that introduces a hero or page |
| item | 1.25rem, weight 600 | the name of a row in a list |
| body | 1rem, 1.65 | reading text and row descriptions, in Muted |
| ui | 0.875rem | navigation, buttons, dates, metadata, captions, docs sidebar |
| fine | 0.75rem | keyboard hints and code-block labels only |

Documentation uses a fluid 36–44px title at weight 500, 18px introduction, 16px prose at 1.75, open 24px section headings, 19px subheads, a 14px sidebar and a 13px contents rail. The docs index uses a 40–56px title. Posts set a 36–52px title over 19px Newsreader capped at 36rem.

The following roles belong to the OPTZ overview. Their frontmatter tokens describe the default; responsive and contextual line-height changes are intentional:

| role | use and responsive behavior |
|---|---|
| optz-headline | Section and closing headings, fluid 36–56px, weight 500; balanced lines. The hero retains the shared display size and weight with OPTZ tracking. |
| optz-feature-title | The four bento titles: 24px desktop and at 720px or below; 22px from 721–960px. |
| optz-intro | Feature-section introduction: 20px, 18px at 960px or below. The hero introduction independently scales from 18–20px at 1.65. |
| optz-reading | Supporting feature, capability, foundation, mechanism, start, and HTML-demo prose: 18px at 1.65 in cards, 1.7 in open entries, and 1.75 in reading sections; measures of 35–47ch. |
| spotlight-body | Newsreader article preview: 18px, 17px at 600px or below. |
| spotlight-code | Actual HTML source: 13px; the typed-route code is also 13px, with its own 1.9 code line-height. |

Bento links use 15px with a 44px minimum target; the example-workspace caption uses 14px. Open capability and starter titles use 18px/500, foundation titles use 22px/500, and starter descriptions and request-path text use 16px/1.65. These roles keep examples and supporting details legible without making them compete with the large feature titles. Documentation prose remains 16px.

**The Scoped Reading Rule.** Use the larger OPTZ reading and heading roles inside the overview; retain the shared reading scale on other routes.

Hierarchy rules: a headline, its introduction and its action sit together. Rows carry a name and one sentence, nothing between. Do not add decorative captions, taglines floating beside content, or stacked sub-labels; if a fact matters, it belongs in the sentence. The OPTZ example-workspace caption and source-demo instruction identify an example or explain an interaction and remain useful. Supporting text steps down in color (Muted) before it steps down in size. Schibsted's tabular figures space commas widely, so dates and single figures use proportional numerals; only aligned table columns use tabular ones.

## Layout

The main container is `min(100% - 7rem, 80rem)`; documentation uses `min(100% - 4rem, 90rem)`. At 800px and below, horizontal gutters become 1.5rem. The shared masthead is sticky at the top, has a 76px minimum height, and separates itself with a one-pixel rule. At 800px and below it wraps with a 68px minimum height and .9rem vertical padding; navigation takes its own row and docs search takes a full-width row. At 1100px and below the desktop DIHLabs return link moves into the navigation row and search narrows from 220px to 180px.

Editorial sections use fluid vertical padding from 4rem to 6rem. Work and writing are divided rows rather than uniform card grids. Work rows use three columns on desktop and a title/action row over the description on mobile. Writing dates move beneath the text. Architecture uses two columns until 800px; feature columns collapse below 600px.

The OPTZ overview uses section separation of `clamp(5rem, 9vw, 8.5rem)` (80–136px), fixed to 5rem at 600px or below. Its four bento panels sit on a 12-column grid with 24px gaps: prepared pages/islands span 7/5, then routing/full-stack span 5/7. At 960px or below they become equal two-column panels; at 720px or below they stack. Copy insets are 40px on desktop, 32px at 960px or below, then 32px top/28px sides at 720px or below. Artwork has its own clipped region rather than shrinking the reading inset. The six open capability entries use three columns, two at 960px or below, and one at 600px or below.

The measured-fact strip uses three columns, then three horizontal reading rows at 600px or below. The HTML demonstration becomes one column at 800px or below; its text/facts use a temporary two-column arrangement from 601–800px. The start picker stacks its options above the terminal at 900px or below. The source viewport is 480px tall, reducing to 400px at 600px or below. Keep section titles clear of the sticky header using the existing scroll offsets.

Documentation gains its 14rem grouped sidebar at 64rem and its 11rem contents rail at 80rem. The sidebar sticks 108px from the top with its own viewport-limited scroll; the contents rail sticks at 124px. The reading column caps at 46rem, with a 3.5rem contents gap; the sidebar gap is 3rem, then 2.5rem below 1280px. Below their thresholds, native disclosures expose Browse the docs and On this page (the latter when there are more than two section headings). The docs index uses a two-column section directory, becoming one column below 800px. Reading content remains `min-width: 0`; tables and code scroll horizontally instead of widening the page. Heading scroll offsets clear the sticky masthead (104px desktop, 195px below 800px).

## Elevation & Depth

The interface is predominantly flat. Thin rules and surface changes carry structure. Search suggestions and the OPTZ product menu are the exceptions: their floating panels use restrained shadows, recorded in the sidecar. The extruded request character has real Three.js lighting and depth. The four OPTZ bento previews are inset windows with one soft offset shadow; captured app UI may show its own internal depth.

**The Flat by Default Rule.** Use surface tone and thin rules to separate content. Reserve interface shadows for floating search results and the product menu.

**The Inset Window Rule.** Every OPTZ bento preview is one window set into its panel's lower right corner and cropped by the panel edges: 12px upper-left radius, Paper ground, Rule top/left border, and selectable HTML content. The original line drawings stay available as standalone exports.

## Shapes

Controls and code blocks have modest rounding; fields and search results use the smaller field radius. Architecture and project panels use the shared panel radius. The four OPTZ bento panels use the scoped 20px radius; their inset route/workspace frames retain 12px upper corners. The live source spotlight uses its scoped 16px radius. Editorial rows remain open, separated by one-pixel rules. Status dots are circular. Benchmark bars use the chart radius and proportional widths. Do not turn every content region into a rounded card.

## Components

### Buttons

The shared shadcn-style Button uses class-variance-authority and Radix Slot composition. Its variants are `default`, `outline`, and `ghost`; sizes are `default`, `lg`, and `sm`. Use `asChild` for navigation links so semantics remain correct.

Primary buttons invert Ink and Paper and shift to Body on hover. Outline buttons use a Muted border and a Panel hover; ghost buttons inherit text color and gain a Panel hover. All use the control radius. Default, large, and small minimum heights are 42px, 52px, and 36px, with padding `0.6rem 1rem`, `0.85rem 1.5rem`, and `0.4rem 0.75rem`. Disabled controls use 60% opacity and a default cursor. Background and border transitions last 180ms. Keyboard focus is a two-pixel Focus outline with a three-pixel offset.

On small screens, hero actions remain at least 48px tall and trail controls at least 44px. Do not infer a new active animation: none is implemented.

### Navigation

Site navigation uses restrained 14px text links and an underlined current page with a seven-pixel underline offset. DIHLabs exposes Projects, Writing, and an OPTZ product disclosure. Its panel links to Explore OPTZ, Documentation, and Benchmarks; clicking outside, following a link, or pressing Escape closes it, with Escape returning focus to its summary. OPTZ and docs expose Overview, Docs, and Benchmarks. GitHub and the theme switch sit in the action cluster; the DIHLabs return link moves into the navigation row below 1100px. Preserve the longest matching current route, `aria-current`, skip link, and mobile wrapping.

The DihLabs identity refines the user-supplied ring-and-slash reference through a generated image traced into editable SVG paths. The full lockup is 148px wide in the header and 116px in the footer; the emblem is optically balanced with the mixed-case wordmark. Source image and prompt provenance live in `branding/`. OPTZ uses a geometric SVG wordmark and slanted speed mark, 120px wide in the header. Docs add a divider and Docs label beside it. All identity artwork inherits the active ink color. Docs use the selected global theme, a filled active sidebar item, and a one-pixel left rule for the current contents heading. The thin page navigation progress indicator is monochrome.

The theme switch is a 36px icon button with a 6px radius and Panel hover. It shows the destination theme icon and updates its accessible label to Switch to light mode or Switch to dark mode.

### Documentation search

Search lives in the docs masthead. Its 36px field uses Panel, a transparent border, the field radius, a search icon, and a Ctrl K hint. Compact 12px input text leaves room for both adornments. Focus changes its border to Ink. Suggestions use Paper with a floating shadow; the active option uses Panel. Each result pairs a medium title with smaller Muted context.

The island loads the index on first focus and returns at most eight results. `/` or Ctrl/Cmd K focuses search; arrows select; Enter navigates; Escape clears. Preserve its accessible label, combobox/listbox relationship, active descendant, and status text for loading, counts, and no matches. The results panel is at least 300px wide and right-aligned to the desktop field; below 800px it follows the full field width.

### Editorial rows and panels

Work rows combine a title, one sentence, and an arrow; hover underlines the title. Writing rows pair title and summary with a right-aligned date. The footer repeats the header's destinations beside the mark. Both use rules and spacing instead of elevation. Architecture panels use Panel with the panel radius and distinct build-time/request stages. Documentation next/previous links use restrained borders that darken on hover. Code, tables, and prose preserve their separate reading treatments. Docs code blocks have a Rule border, theme-aware Code surface, and a Panel language/copy toolbar; code text is 13px with 1.25rem inner padding. Copy shows Copied or Select to copy for two seconds before resetting. The contents rail tracks the current section during scroll.

### OPTZ page sections

After the original speed hero, four substantial bento panels present prepared pages, interactive islands, typed routes, and a full-stack example. Their asymmetric proportions, open space, and larger reading roles apply the user-supplied references without replacing the existing identity. Six smaller capabilities sit in an open grid below: actions, streaming, regeneration, client navigation, fonts/images, and deployment. The former nine-panel inventory and inverted release tile are no longer part of this composition.

All four panels share the inset window (`.product-workspace`). Prepared pages are the `BuildFiles` island: a `dist/static` explorer whose `index.html`, `.br` and `.gz` entries are tabs (click or arrow keys) showing the HTML source or a hex dump of the real compressed bytes, made at build time with `optz build`'s settings (`app/lib/prepared-files.ts`). The `GET /hello` response follows the chosen file's encoding. The contents panel has a fixed height with a bottom fade while more remains; below a 32rem window width the files become editor tabs above it. Islands show a browser page whose `Counter` island (`Counter.island.tsx`, the real file) counts on Add one, inside the original drawing's ink outline and yellow dot; the page around it stays HTML. Routing keeps selectable code and output. The full-stack panel uses a real browser capture of locally authored, fictional HTML/CSS, explicitly captioned “Example notes workspace.” Controls in the first two windows are live islands that hydrate when visible; the notes capture's apparent controls are not. The `/hello` page threads through the first three windows.

Only the notes workspace uses raster assets: two shipping WebPs in `public/images/optz/` (91,936 bytes total). They declare 1100×760 intrinsic dimensions, use lazy loading and asynchronous decoding, and switch editions through CSS. Original sample HTML/CSS and browser JPGs live in `branding/previews/`; keep their capture provenance with replacements and follow its README for capture/conversion. `branding/optz-bento/README.md` records the current visual sources. The original SVG component file is authoritative for the diagrams. Meaningful text, source inspection, navigation, and controls remain HTML.

The benchmark and three measured facts read checked-in JSON. Bars have a zero baseline, proportional widths, and no entrance animation; they stay monochrome. The HTML spotlight follows, with measured blog-page payload figures beside a browser frame. Its rendered article fragment, actual HTML source, and UTF-8 binary band share one source string. A pointer-driven 220px-diameter circle reveals source, surrounded by a softened 24px yellow byte ring. The ring extends the artwork language into user-driven inspection; source and controls remain monochrome. The native View source disclosure works without JavaScript, supports keyboard activation, and expands to a scrollable full-frame source view. The visible island adds masks, coalesces pointer input into one frame, clears pending work offscreen, and respects reduced motion. It has no idle loop. See `content/docs/html-spotlight.md` for behavior, examples, verification, and measurement scope.

The request path, open foundation row (Bun, React, Preact islands) and live status remain in use. One closing section, “Less waiting. More building.”, replaces the former get-started cards, quickstart panels and separate call-to-action band, which all led to the same guide. Its `StartPicker` island pairs five starting points (new app, full-stack app, every feature, authentication, existing project) with a terminal showing the real commands for the chosen one, a copy button and that path's guide. The terminal keeps a fixed six-line height so switching never moves the page. Grouped resource links and the shared footer follow.

The original token-drawn SVGs are the live illustration base. `bun scripts/export-illustrations.tsx` retains their default 480×320 framing when exporting light/dark files to `branding/illustrations/`. Future refinements must build from these drawings and preserve their flat technical style.

### Three.js trails

The shared Trail island has `flow` and `speed` modes. DihLabs shows the flowing field and a Reseed control. OPTZ adds an extruded yellow `200 OK` character and Send a request control. This is illustrative artwork, never a live benchmark.

The visible island dynamically imports the renderer; documentation does not load Three.js. The request arrives over 2400ms with quintic easing; flow reseeds by smoothly morphing its deterministic curve over 1400ms. Each trail quad is sized to hold its whole head flare, and every glow and flare falloff is windowed to zero at the quad edge, with half-step dithering against banding; light never ends on a straight line. GPU trails and sparks share the same curve and continue ambient motion after completion. A compact pause control preserves the current phase and resumes from it. Replay is disabled while paused. The aspect-correct camera keeps the request character proportional at every width. Animation pauses offscreen and while the document is hidden. Pixel ratio is capped at 1.5; mobile uses fewer lines. ResizeObserver keeps the canvas fitted.

Reduced motion produces a static render, and OPTZ's disabled control reads Reduced motion. Flow may still reseed without animation. Loading, running, and unavailable states disable replay; fallback reads Static preview. The deterministic SVG is present before hydration and remains usable without JavaScript or WebGL. Context loss restores that fallback. Unmount removes observers, listeners, animation frames, canvas, geometry, materials, textures, and the renderer. Preserve the screen-reader status outside the hidden artwork.

## Do's and Don'ts

### Do:

- Do use the shared shadcn Button variants and the active surface tokens.
- Do preserve the visible keyboard focus, wrapped mobile navigation, and readable text measures.
- Do provide a pause control, respect reduced motion, and retain the deterministic SVG fallback.
- Do present benchmark scope and methodology beside measured results.
- Do present every OPTZ bento preview as an inset HTML window; keep the original line drawings for standalone exports.
- Do keep app captures theme-paired, preserve capture provenance, and label fictional workspaces as examples.
- Do keep code/output selectable and use the scoped OPTZ reading, spacing, and bento roles for overview extensions.

### Don't:

- Don't copy Next.js branding or page composition.
- Don't use yellow for interface controls, status indicators, or focus rings.
- Don't replace developer content with an AI or SDXL showcase.
- Don't turn illustrative speed into a universal performance claim or remove the motion pause control.
- Don't turn a captured example interface into a substitute for live controls or the actual HTML spotlight.
- Don't replace the bento windows with dimensional or sculptural artwork.

### Documentation evidence and code

The docs index opens with illustrated Quickstart, Learn OPTZ and framework-reference cards. A
seven-chapter reading-list project teaches pages, data loaders, islands, forms, typed API calls
and deployment. Build-more and optional-module cards follow, then the complete directory.
Chapter descriptions wrap instead of truncating, and chapter pages show progress and previous/next links.

`DocPreviews.tsx` draws theme-aware HTML examples rather than loading screenshots. Preview text
is decorative inside a single card link; the card's title and description supply its accessible name.
Keep the entire preview window inside its frame, with commands visible together and shorter
representations for compact module cards. Cards use 16px corners, a 20px gap and 224px preview
areas (200px for small module cards); the Learn path uses a 20px corner. Card grids collapse
at 1100px and 700px. Article banners keep a 240px preview area, including on phones.

Articles provide Copy page, a native View as Markdown link, Git-based source update dates when
available, nested contents tracking, filename labels on code blocks and GitHub issue links.
Markdown is prerendered at `/api/docs-markdown/<slug>`; search retains `/api/docs`. The distinct
endpoint roots avoid a prerendered file/directory collision. GitHub-style callouts and `flow`,
`sequence` and `files` fences render as semantic HTML at build time. Flow and file diagrams stack
inside narrow reading columns. Module diagrams explain startup injection, upload approval,
status publication, consented analytics, session adapters and CDN revalidation.

Documentation now exposes the OPTZ 0.4 full-stack walkthrough, application APIs, starter configuration and dispatch design in a dedicated navigation group. Comparison matrices use semantic row/column headers and explicit built-in, partial, unavailable and integration states with CSS-drawn icons. They scroll inside keyboard-accessible regions on narrow screens.

Benchmark bars read `bench/results.json` and `bench/fullstack-results.json`, use zero-based linear axes, show units and provenance, and offer exact values in native disclosures. Historical network results and warmed dispatch microbenchmarks remain separate. These charts stay monochrome.

Documentation code uses Shiki TextMate tokenization with VS Code Light+/Dark+ themes. Syntax colors are a narrow exception to monochrome prose, used only inside code blocks. Tokens emit classes; `app/docs-syntax.css` is generated by `bun scripts/generate-syntax-css.ts` after a Shiki/theme upgrade. No browser highlighter or inline styles are required. [Shiki dual-theme documentation](https://shiki.style/guide/dual-themes).
