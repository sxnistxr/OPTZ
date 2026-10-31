# Fieldnotes sample previews

These are original, static sample interfaces authored for the OPTZ portfolio redesign. Fieldnotes is an illustrative product name. The document copy, workspace, note counts, and attachment are sample content, not a connected application or a customer claim.

The light and dark pages share `notes.css`. Every apparent action is a non-focusable presentational element; there are no scripts, links, form controls, external images, external requests, or live behavior. The only font request is the local portfolio Schibsted Grotesk asset.

## Capture

Serve `/home/cj/Code/OPTZ/portfolio` as the web root on port **3003**. The pages use the local font URL `/dist/static/assets/schibsted-grotesk-latin-4c8b93f431.woff2`.

- Light: `http://localhost:3003/branding/previews/notes-light.html`
- Dark: `http://localhost:3003/branding/previews/notes-dark.html`
- Browser viewport: **1100 × 760 CSS pixels**
- Final captures: **1×**, 1100 × 760 image pixels (the available in-app browser viewport)
- Capture the viewport, not a full page; wait for `document.fonts.ready` before capture
- No browser window chrome, padding, additional background, or viewport crop is required

The source is HTML text, CSS, and small authored stroke SVG navigation/document icons. No generated illustration is embedded in these sample screens.

The checked-in `notes-light.jpg` and `notes-dark.jpg` are the actual browser captures used in the site. Both were visually inspected after the local font loaded. Convert them with `cwebp -q 92 notes-light.jpg -o ../../public/images/optz/notes-preview-light.webp` (and the dark equivalent). Capture origins are embedded in the JPEGs and recorded beside the shipping WebPs.
