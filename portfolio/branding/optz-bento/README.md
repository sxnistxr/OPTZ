# OPTZ overview visuals

Every bento panel previews in the same inset window, set into the panel's lower right corner and cropped by its edges. The first two windows carry the subjects of the original OPTZ diagrams (prepared `.html`, `.br`, and `.gz` files; a browser page with one outlined island, its yellow dot, and the speed streak) as selectable HTML. The rejected sculptural imagegen objects have not been reintroduced.

| Visual | Authoritative source | Rendering |
| --- | --- | --- |
| Prepared pages | `app/components/BuildFiles.island.tsx`, `app/lib/prepared-files.ts` | Live `dist/static` explorer: HTML source and real build-time `.br`/`.gz` bytes, with the matching `GET /hello` response |
| Interactive island | `app/components/Counter.island.tsx` | Browser page with one live, outlined counter island |
| Typed route | `app/components/OptzFeatures.tsx` | Selectable code and output in HTML |
| Example notes workspace | `branding/previews/notes-{light,dark}.html` and `notes.css` | Local browser captures in `/images/optz/notes-preview-{light,dark}.webp` |

## Original illustration exports

The source of truth is the existing SVG component file. The default line-only rendering and 480 × 320 view box remain available for standalone exports. Generate those from `portfolio/`:

```sh
bun scripts/export-illustrations.tsx
```

This writes light/dark SVGs to `branding/illustrations/`. The live bento no longer renders these drawings; their optional `depth` treatment remains in the component file but is unused.

## Notes capture

Follow `../previews/README.md` to capture the original sample HTML/CSS at 1100 × 760, then convert each JPG with `cwebp -q 92`. The two shipping WebPs total 91,936 bytes. They are decorative, lazy-loaded, dimensioned, and selected by the user's theme; the on-page caption identifies the fictional example. WebP capture provenance lives in the same-name `.webp.json` sidecars.

The sample image remains separate from live controls and the actual HTML spotlight. All meaningful product copy, code, links, and controls remain HTML. The bento's only JavaScript is its two islands, `BuildFiles` and `Counter`, which hydrate when visible.

## Layout and review

`app/components/OptzFeatures.tsx` composes four panels and six open feature entries. Overview-only CSS in `app/styles.css` keeps the spacious desktop proportions, equal tablet columns, stacked phone panels, and notes crop.

Current captures are under `.impeccable/review/inset-diagrams/`: desktop and phone in both themes, 698px in-app width, and 900px tablet. The guide at `content/docs/html-spotlight.md` explains the live source interaction, measured bytes, and runnable starter examples.
