---
name: DihLabs / OPTZ
description: A monochrome developer lab with yellow generative motion.
colors:
  paper: '#f7f7f7'
  ink: '#161616'
  body: '#3e3e3e'
  muted: '#686868'
  rule: '#dedede'
  panel: '#eeeeee'
  code: '#161616'
  code-ink: '#f1f1f1'
  signal: '#333333'
  focus: '#777777'
  dark-paper: '#080808'
  dark-ink: '#fafafa'
  dark-body: '#d0d0d0'
  dark-muted: '#aaa'
  dark-rule: '#303030'
  dark-panel: '#1b1b1b'
  dark-signal: '#fff'
  dark-focus: '#888'
  trail-yellow: '#ffe46a'
  packet-yellow: '#ffdf51'
typography:
  display:
    fontFamily: '"Schibsted Grotesk", "Schibsted Grotesk Fallback", ui-sans-serif, system-ui, sans-serif'
    fontSize: clamp(2.7rem, 6.2vw, 5.7rem)
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.04em
  display-optz:
    fontFamily: '"Schibsted Grotesk", "Schibsted Grotesk Fallback", ui-sans-serif, system-ui, sans-serif'
    fontSize: clamp(3rem, 7.4vw, 6rem)
    fontWeight: 600
    lineHeight: 1.07
    letterSpacing: -0.04em
  headline:
    fontFamily: '"Schibsted Grotesk", "Schibsted Grotesk Fallback", ui-sans-serif, system-ui, sans-serif'
    fontSize: clamp(1.9rem, 3.1vw, 2.75rem)
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.035em
  page-title:
    fontFamily: '"Schibsted Grotesk", "Schibsted Grotesk Fallback", ui-sans-serif, system-ui, sans-serif'
    fontSize: clamp(2.75rem, 6vw, 4.5rem)
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: -0.04em
  body:
    fontFamily: '"Schibsted Grotesk", "Schibsted Grotesk Fallback", ui-sans-serif, system-ui, sans-serif'
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
  docs-body:
    fontFamily: '"Schibsted Grotesk", "Schibsted Grotesk Fallback", ui-sans-serif, system-ui, sans-serif'
    fontSize: 1.0625rem
    fontWeight: 400
    lineHeight: 1.75
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
  panel: 12px
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
    backgroundColor: '{colors.paper}'
    textColor: '{colors.body}'
    rounded: '{rounded.field}'
    padding: 0.5rem 0.75rem
    width: 100%
  site-navigation:
    textColor: '{colors.body}'
    padding: 0.75rem 0
  request-path:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.ink}'
    rounded: '{rounded.panel}'
    padding: 1.5rem 2rem
  work-row:
    textColor: '{colors.ink}'
    padding: 2rem 0
---

# Design System: DihLabs / OPTZ

## Overview

**Creative North Star: "Curiosity, in progress."**

DihLabs presents a developer's work with an immersive introduction, open space, and direct editorial lists. OPTZ shares the same monochrome world, adding a playful request character and a sense of speed. The approved composition is confident and clear; Next.js informs hierarchy without supplying the identity.

Generative yellow geometry is the expressive element. Interface controls, navigation, status, and technical evidence remain monochrome. DihLabs leads with development work and writing; AI, SDXL, and language-model showcases are outside its approved identity.

**Key Characteristics:**

- Large, closely tracked sans-serif headings and generous reading space.
- Dark introductions, light editorial content, and restrained rules.
- Yellow Three.js artwork with a bounded arrival animation and deliberate replay.

This spec describes the implemented portfolio app. Token primitives above are normative; `app/styles.css` implements their light and dark assignments. `.impeccable/design.json` adds component previews and behavior metadata. The repository's `docs/DESIGN.md` describes the engine, not this visual system.

## Colors

### Primary

Ink is the interface's primary color, reversed to pale ink on dark surfaces. Trail Yellow and Packet Yellow supply the artwork's warmth; shader lines and sparks vary that yellow through opacity and lighting.

### Neutral

Paper carries reading surfaces; Body and Muted distinguish prose from supporting information. Rule divides rows and navigation. Panel supports code fragments and architecture diagrams. Code and Code Ink separate code blocks from surrounding prose. Signal marks selected documentation and static status dots.

The `dark-*` values replace their matching semantic tokens within dark surfaces. Focus uses the dedicated light or dark focus value; preserve the brighter dark focus treatment.

**The Artwork Only Rule.** Reserve yellow for the generated trails and request character. Controls, focus, status, and benchmark bars stay monochrome.

## Typography

Schibsted Grotesk carries display, interface, and documentation text. Newsreader carries long-form posts. The system monospace stack is reserved for code, measurements, and technical annotations. Font configuration supplies size-matched fallbacks; do not substitute an unrelated display face.

The frontmatter records the implemented roles rather than a fixed modular scale. Display and section headings use fluid sizing and tight tracking. Standard headings use medium-to-semibold weight; documentation subheads and prose emphasis use weight 650. Body copy stays comfortably spaced. Posts cap at 36rem; documentation prose caps at 68ch while tables and code may use the full column.

At the narrow layout breakpoint, OPTZ's display becomes 3.2rem with a 9ch measure; the DihLabs heading caps at 10ch. Keep headline wrapping intentional and labels in sentence case.

## Layout

The main container is `min(100% - 7rem, 80rem)`; documentation allows 90rem. At 800px and below, horizontal gutters become 1.5rem. Headers are 96px tall, then at least 84px below 800px. Below 600px the header wraps, and site navigation takes the full width and wraps its links.

Editorial sections use fluid vertical padding from 4rem to 6rem. Work and writing are divided rows rather than uniform card grids. Work rows use three columns on desktop and a title/action row over the description on mobile. Writing dates move beneath the text. Architecture uses two columns until 800px; feature columns collapse below 600px.

Documentation gains its sticky 14rem sidebar at 64rem and its 12rem contents rail at 80rem. Gaps are 3.5rem. Below those thresholds, native disclosure controls expose the menus. Reading content remains `min-width: 0`; tables and code scroll horizontally instead of widening the page.

## Elevation & Depth

The interface is predominantly flat. Thin rules and surface changes carry structure. Search suggestions are the exception: their floating panel uses the existing Tailwind large shadow, recorded in the sidecar. The extruded request character has real Three.js lighting and depth; that treatment belongs to the artwork.

**The Flat by Default Rule.** Use surface tone and thin rules to separate content. Reserve interface shadows for floating search results.

## Shapes

Controls and code blocks have modest rounding; fields and search results use the smaller field radius. Architecture and project panels use the larger panel radius. Editorial rows remain open, separated by one-pixel rules. Status dots are circular. Benchmark bars use the chart radius and proportional widths. Do not turn every content region into a rounded card.

## Components

### Buttons

The shared shadcn-style Button uses class-variance-authority and Radix Slot composition. Its variants are `default`, `outline`, and `ghost`; sizes are `default`, `lg`, and `sm`. Use `asChild` for navigation links so semantics remain correct.

Primary buttons invert Ink and Paper and shift to Body on hover. Outline buttons use a Muted border and a Panel hover; ghost buttons inherit text color and gain a Panel hover. All use the control radius. Default, large, and small minimum heights are 42px, 52px, and 36px, with padding `0.6rem 1rem`, `0.85rem 1.5rem`, and `0.4rem 0.75rem`. Disabled controls use 60% opacity and a default cursor. Background and border transitions last 180ms. Keyboard focus is a two-pixel Focus outline with a three-pixel offset.

On small screens, hero actions remain at least 48px tall and trail controls at least 44px. Do not infer a new active animation: none is implemented.

### Navigation

Site navigation uses restrained text links, a one-pixel header rule, and an underlined current page with a seven-pixel underline offset. DihLabs exposes Projects, Writing, OPTZ, and GitHub. OPTZ and docs expose Overview, Docs, Benchmarks, GitHub, and the separated DihLabs return link. Preserve the longest matching current route, `aria-current`, skip link, and mobile wrapping.

The brand is compact, bold, and tightly tracked; OPTZ is italic. Docs sidebar and contents navigation mark the current item with a left rule. The thin page navigation progress indicator is monochrome.

### Documentation search

The field uses Paper, a Rule border, the field radius, and compact padding. Focus changes its border to Ink. Its suggestions use the same surface with a floating shadow; the active option uses Panel. Each result pairs a medium title with smaller Muted context.

The island loads the index on first focus and returns at most eight results. `/` focuses search; arrows select; Enter navigates; Escape clears. Preserve its accessible label, combobox/listbox relationship, active descendant, and status text for loading, counts, and no matches. The results panel expands to 22rem at the desktop sidebar breakpoint.

### Editorial rows and panels

Work rows combine title, technical context, description, and arrow; hover underlines the title. Writing rows pair title and summary with a quiet date. Both use rules and spacing instead of elevation. Architecture panels use Panel with the panel radius and distinct build-time/request stages. Documentation next/previous links use restrained borders that darken on hover. Code, tables, and prose preserve their separate reading treatments.

### Three.js trails

The shared Trail island has `flow` and `speed` modes. DihLabs shows the flowing field and a Reseed control. OPTZ adds an extruded yellow `200 OK` character and Send a request control. This is illustrative artwork, never a live benchmark.

The visible island dynamically imports the renderer; documentation does not load Three.js. Both modes play once on arrival for 3600ms and then rest. User replay is deliberate; flow also changes its deterministic seed. Animation pauses offscreen and while the document is hidden. Pixel ratio is capped at 1.5; mobile uses fewer lines. ResizeObserver keeps the canvas fitted.

Reduced motion produces a static render, and OPTZ's disabled control reads Reduced motion. Flow may still reseed without animation. Loading, running, and unavailable states disable replay; fallback reads Static preview. The deterministic SVG is present before hydration and remains usable without JavaScript or WebGL. Context loss restores that fallback. Unmount removes observers, listeners, animation frames, canvas, geometry, materials, textures, and the renderer. Preserve the screen-reader status outside the hidden artwork.

## Do's and Don'ts

### Do:

- Do use the shared shadcn Button variants and the active surface tokens.
- Do preserve the visible keyboard focus, wrapped mobile navigation, and readable text measures.
- Do keep motion bounded, respect reduced motion, and retain the deterministic SVG fallback.
- Do present benchmark scope and methodology beside measured results.

### Don't:

- Don't copy Next.js branding or page composition.
- Don't use yellow for interface controls, status indicators, or focus rings.
- Don't replace developer content with an AI or SDXL showcase.
- Don't turn illustrative speed into a universal performance claim or an endless animation.
