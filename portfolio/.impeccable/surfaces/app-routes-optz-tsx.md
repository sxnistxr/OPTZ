---
version: 1
slug: "app-routes-optz-tsx"
primary_target: "app/routes/optz.tsx"
related_targets: ["app/components/OptzFeatures.tsx","app/components/OptzIllustrations.tsx","app/components/HtmlSpotlight.tsx","app/components/HtmlSpotlight.island.tsx"]
---

# OPTZ overview: spacious product panels

Scope: existing `/optz` landing-page layout and typography revision, inside the current monochrome identity. Visitor mode: persuade, supported by technical evidence and working examples.

The user requested closer composition to their supplied spacious bento references, visuals based on the existing illustrations, screenshots of sample interfaces, more room, and better readability. The dimensional imagegen replacements were rejected because they did not match the originals; the user clarified that the old drawings must be the base. Their latest reference, `/tmp/codex-clipboard-75ceeebf-8717-4b16-9679-986e8264a189.png`, adds shallow inset depth, illuminated edges, and faint connected diagrams while retaining the website's feel. This precise refinement applies that treatment to the actual original SVGs and existing bento panels. The implementation retains the hero and useful product elements. Deployment is outside this request.

## Direction contract

**THESIS:** HTML is prepared before the visitor arrives; the page demonstrates that mechanism through substantial visual examples, measured evidence, and a live source reveal. Four varied feature panels replace the former uniform nine-card inventory.

**OWN-WORLD:** Inherit Schibsted Grotesk, white/charcoal grounds, muted grey prose, thin neutral rules, and yellow reserved for artwork. Keep 20px corners, 24px gutters, 28–40px responsive side insets, 18px prose, and 80–136px section separation. The original PrebuiltIllustration and IslandsIllustration remain the base: preserve their subjects, technical geometry, and labels. The new reference permits shallow neutral surface gradients, beveled SVG faces, offset soft shadows, inset edge highlights, and faint connected traces. Keep these local to the bento and provide corresponding light/dark treatments. No social logos, blue accents, invented analytics, or sculptural imagegen objects enter the page. The notes workspace remains a labeled raster capture.

**STORY:** Understand the framework, inspect pages/islands/routing/full-stack examples, assess scoped measurements, look through real HTML, then start a project or open the docs. Four runnable starter cards and selectable code remain available.

**FIRST VIEWPORT:** Preserve the existing centered “Blink. It’s served.” speed hero, full-width yellow WebGL trails, plain React/Bun description, Start building and Read the docs actions, and pause/request controls. The next section leads with a large two-line heading and four generous panels. The signature source spotlight remains live farther down the page.

**FORM:** Code-led existing-surface layout/typeset revision, informed by the user-pinned images #1, #9, #10, #12, and #5. This is not a new visual world or an undecided whole-surface concept round. No seed or approved page comp was generated for this revision; no claim of unavailable tooling. The provided reference images carry structural authority, while existing product identity and behavior remain authoritative.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Verification and artifacts

Current captures belong in `.impeccable/review/inset-diagrams/`: desktop 1440px and phone 390px in both themes, 698px in-app width, and 900px tablet. The original inline source is `app/components/OptzIllustrations.tsx`; optional `depth` rendering adds interface shading to the same diagram geometry. View boxes are `76 14 376 302` and `50 24 380 278`, including room for shadows and traces. The default line-only 480×320 exports remain in `branding/illustrations/`. The two notes WebPs and provenance remain in `public/images/optz/` (91,936 bytes total); sample HTML/CSS and browser JPGs are in `branding/previews/`. No rejected generated assets have been reintroduced.

The prior line-only correction was reviewed at `.impeccable/review/original-art-restored/finish-review.md`. It predates the new inset-depth reference. This refinement requires current captures, documentation alignment, and a new review; no user approval of the result is recorded.

## Inset window revision (2026-10-31)

The user asked for the first two panels' previews to match the routing and full-stack panels. Both now use the shared `.product-workspace` inset window with HTML content: a `dist/static` explorer, prerendered source, and `GET /hello` response; and a browser page with one outlined `Counter.island.tsx` region. The original drawings' subjects, the island's yellow dot, and the speed streak carry over. This supersedes the inset-depth SVG treatment for the bento; the drawings remain for standalone exports. No JavaScript or raster assets were added. Captures in `.impeccable/review/inset-windows/`: desktop 1440px in both themes, 900px tablet, and 390px phone in both themes.

Follow-up: the user asked for these UI elements to be interactive. `BuildFiles.island.tsx` makes the files tabs over real HTML and compressed bytes; `Counter.island.tsx` counts. Both hydrate when visible.
