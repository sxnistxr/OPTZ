import { Parser } from "htmlparser2";
const tags = new Set("p div span section article h1 h2 h3 h4 h5 h6 a img br hr pre code blockquote ul ol li table thead tbody tfoot tr th td strong b em i del s details summary kbd samp sub sup figure figcaption dl dt dd abbr".split(" "));
const voids = new Set(["img", "br", "hr"]);
const hidden = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "template"]);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
function safeUrl(value: string, image: boolean) {
  const cleaned = value.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
  try { return (image ? ["http:", "https:"] : ["http:", "https:", "mailto:"]).includes(new URL(cleaned, "https://local.invalid").protocol); }
  catch { return false; }
}
/** Small allowlist for documentation prose, never scripts, handlers, CSS or embedded documents. */
export function safeHtml(html: string): string {
  const out: string[] = [];
  let skipped = 0;
  const parser = new Parser({
    onopentag(tag, attrs) {
      if (skipped || hidden.has(tag)) { skipped++; return; }
      if (!tags.has(tag)) return;
      const attributes: string[] = [];
      for (const [name, value] of Object.entries(attrs)) {
        const plain = ["id", "class", "title", "role", "aria-label", "aria-hidden"].includes(name) || (tag === "div" && name === "tabindex" && value === "0") || (tag === "img" && ["alt", "width", "height", "loading"].includes(name)) || (["th", "td"].includes(tag) && ["colspan", "rowspan", "data-align", "scope"].includes(name)) || (tag === "pre" && name === "data-lang");
        const url = (tag === "a" && name === "href") || (tag === "img" && name === "src");
        if (plain || (url && safeUrl(value, tag === "img"))) attributes.push(` ${name}="${esc(value)}"`);
      }
      if (tag === "a") attributes.push(' rel="noopener noreferrer"');
      out.push(`<${tag}${attributes.join("")}>`);
    },
    ontext(text) { if (!skipped) out.push(esc(text)); },
    onclosetag(tag) {
      if (skipped) { skipped--; return; }
      if (tags.has(tag) && !voids.has(tag)) out.push(`</${tag}>`);
    },
  }, { decodeEntities: true });
  parser.end(html);
  return out.join("");
}
