---
version: 1
slug: "app-routes-docs"
primary_target: "app/routes/docs"
related_targets: ["app/routes/_layout.tsx","app/styles.css"]
---

# Documentation and shared chrome

Mode: Read. The shared header, themes and DIHLabs identity extend the established site; the docs composition follows the user-pinned Next.js, Angular, Linear, shadcn and Raycast references.

## Direction contract

THESIS: familiar developer documentation with a compact product masthead, grouped navigation, a calm reading column, and a separate contents rail. The OPTZ and DIHLabs marks connect the two products.

OWN-WORLD: monochrome paper (#ffffff / #0c0c0e), crisp ink (#18181b / #f4f4f5), quiet panels (#f4f4f5 / #1b1b1f), Schibsted Grotesk, compact 13px navigation, 16px prose, and measured rules. Yellow belongs to the artwork. DIHLabs retains the supplied ring-and-speed-bars symbol with the site wordmark.

STORY: locate a guide, understand the page, copy an example, follow the next topic. The theme follows the device initially and remembers an explicit choice across pages.

FIRST VIEWPORT: a sticky 76px product header with navigation, search and theme switch; a 224px navigation rail; a 40px title over a readable introduction; code and section headings below; a contents rail at wide widths. On mobile the search is full width and navigation folds into a disclosure.

FORM: user-pinned documentation canon, with the OPTZ product menu on the DIHLabs header as its signature navigation interaction. seed: none (user-pinned). No new arrival animation.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

The 0.4 documentation pass adds a full-stack navigation group and API guides. Matrices replace emoji with labeled CSS icons and semantic headers. Evidence charts use repository benchmark JSON with dates, independent units and exact-value disclosures. Code uses build-time Shiki with class-based VS Code Light+/Dark+ colors; raw text and strict CSP remain intact.
