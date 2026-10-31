# OPTZ design context

The full token and component specification lives in `../DESIGN.md`; implementation tokens are in `../app/styles.css`.

Use Schibsted Grotesk and the existing monochrome surfaces. Documentation follows the user-pinned Next.js, Angular, Linear, shadcn and Raycast references: a shared sticky 76px masthead with search, grouped 14rem sidebar, separate 11rem contents rail, 16px/1.85 prose, and framed code blocks with language/copy tools. Native disclosures expose navigation and contents below their desktop breakpoints. The header search becomes full width at 800px.

The whole site supports device-aware light and dark themes. The header theme toggle persists an explicit choice across pages and synchronizes browser tabs. Use the effective `:root` semantic values in `app/styles.css`, which supersede the older `@theme` defaults.

The DIHLabs identity uses the supplied ring-and-slash mark and wordmark in header and footer. Its main-site OPTZ product menu links to the overview, docs and benchmarks; Escape, outside click and link selection close it.

The OPTZ identity combines slanted speed bars and a geometric SVG wordmark. Reusable assets are `public/optz-logo.svg` and `public/optz-mark.svg`. Yellow remains exclusive to artwork: the Three.js trails, OPTZ illustration details, and the source spotlight’s byte ring.

Trails continue with slower ambient movement after the request arrives. Keep the pause control, reduced-motion support, offscreen suspension, and static WebGL fallback. Request replay uses the existing small ghost Button.

Server status uses a connection label and separate round-trip, uptime, and memory readings, with a timeout and automatic retry.

The OPTZ overview preserves the light-trail hero and extends the shared type scale with scoped roles. Four large panels use a 7/5 then 5/7 desktop grid, 24px gutters, 20px corners, and 40px desktop copy insets; at 960px or below they use equal columns and 32px insets, and at 720px or below they stack with 28px side insets. Six smaller capabilities sit in an open three/two/one-column grid. Section separation is 80–136px. Section titles use 36–56px/500 at 1.12; card titles use 24px/500 at 1.25 (22px from 721–960px); supporting prose uses 18px at 1.65–1.75. Documentation keeps its own 16px reading layout.

The overview bento uses scoped `--optz-panel` (#f4f4f5 light, #18181b dark) while shared white/charcoal grounds and neutral controls stay in place. The first two panels use the original `PrebuiltIllustration` and `IslandsIllustration` from `app/components/OptzIllustrations.tsx` as inline SVG. These drawings are the authoritative base: retain flat lines, technical geometry, file/browser labels, theme classes, and yellow details. Only view-box framing changes (`84 26 360 270` and `56 30 368 260`); default standalone exports retain 480×320. The full-stack panel uses a real capture of an original fictional notes UI, captioned Example notes workspace. Its two theme-paired WebPs (91,936 bytes total) load lazily with 1100×760 intrinsic dimensions. Sample HTML/CSS and browser JPGs live in `branding/previews/`; follow its README for capture/conversion provenance. `branding/optz-bento/README.md` records the current sources. Route code/output, navigation, and meaningful controls remain HTML; the bento adds no JavaScript.

Keep the open foundation row, copyable install command, four working starter cards, runnable terminal/route examples, and plain closing CTA. The live HTML spotlight uses a 220px-diameter pointer circle and a 24px yellow UTF-8 byte ring around actual post HTML; it progressively enhances a keyboard-operable native View source disclosure, hydrates when visible, and has no idle loop. Its viewport is 480px tall (400px at 600px or below), with 18px Newsreader prose (17px on phones) and 13px source code. The three measured facts become readable rows at 600px or below. Payload figures read `content/optz-payload.json`; benchmark figures read `bench/results.json`. Follow `content/docs/html-spotlight.md` for behavior and measurement scope. This revision is code-led from supplied references #1, #9, #10, #12, and #5; it does not establish a new identity or an approved page comp.

### Documentation evidence and code

Docs discovery uses illustrated start-here, build-more and module cards, plus a seven-chapter
reading-list tutorial and full directory. `DocPreviews.tsx` supplies theme-aware HTML previews;
fit whole windows and their labels inside the preview area. Compact module cards simplify
their examples, and tutorial descriptions wrap. Articles add chapter progress, filename code
toolbars, callouts, responsive HTML diagrams, nested contents tracking and source update dates.
Copy page and View as Markdown use `/api/docs-markdown/<slug>`; `/api/docs` remains the search index.

Documentation now exposes the OPTZ 0.4 full-stack walkthrough, application APIs, starter configuration and dispatch design in a dedicated navigation group. Comparison matrices use semantic row/column headers and explicit built-in, partial, unavailable and integration states with CSS-drawn icons. They scroll inside keyboard-accessible regions on narrow screens.

Benchmark bars read `bench/results.json` and `bench/fullstack-results.json`, use zero-based linear axes, show units and provenance, and offer exact values in native disclosures. Historical network results and warmed dispatch microbenchmarks remain separate. These charts stay monochrome.

Documentation code uses Shiki TextMate tokenization with VS Code Light+/Dark+ themes. Syntax colors are a narrow exception to monochrome prose, used only inside code blocks. Tokens emit classes; `app/docs-syntax.css` is generated by `bun scripts/generate-syntax-css.ts` after a Shiki/theme upgrade. No browser highlighter or inline styles are required. [Shiki dual-theme documentation](https://shiki.style/guide/dual-themes).
