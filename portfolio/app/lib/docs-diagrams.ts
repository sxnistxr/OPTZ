// Diagrams for the docs, written as fenced blocks in Markdown and rendered to plain HTML at build
// time. The source stays readable as text on GitHub; on the site it becomes a figure. Every piece
// of text is escaped here, so the output can join the page after sanitizing.
//
//   ```flow                         ```sequence                        ```files
//   title: A caption                title: A caption                   app/routes/index.tsx -> /
//   Build | React pages | Detail    Browser -> App: Ask to upload      app/api/posts.ts -> /api/posts
//   Request* | GET / | Detail       App -> Browser: Signed URLs
//   ```                             ```                                ```
//
// In a flow, `*` after a label marks the step the figure is about. `code` in backticks works in
// every label.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const inline = (s: string) => esc(s.trim()).replace(/`([^`]+)`/g, "<code>$1</code>");
const plainText = (s: string) => s.replace(/`/g, "").trim();

function parse(source: string) {
  let title = "";
  const lines: string[] = [];
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const caption = line.match(/^title:\s*(.+)$/i);
    if (caption) title = caption[1];
    else lines.push(line);
  }
  return { title, lines };
}

const figure = (kind: string, title: string, body: string, extra = "") =>
  `<figure class="docs-diagram docs-${kind}${extra}"${title ? ` aria-label="${esc(plainText(title))}"` : ""}>${body}${title ? `<figcaption>${inline(title)}</figcaption>` : ""}</figure>`;

/** Steps in order, left to right (top to bottom on narrow screens). */
export function renderFlow(source: string): string | null {
  const { title, lines } = parse(source);
  const steps = lines.map((line) => line.split("|").map((part) => part.trim()));
  if (!steps.length || steps.some((s) => s.length < 2 || !s[0] || !s[1])) return null;
  const items = steps.map(([label, name, detail]) => {
    const key = label.endsWith("*");
    return `<li class="flow-step${key ? " is-key" : ""}"><span class="flow-label">${inline(key ? label.slice(0, -1) : label)}</span><strong>${inline(name)}</strong>${detail ? `<span class="flow-detail">${inline(detail)}</span>` : ""}</li>`;
  });
  return figure("flow", title, `<ol>${items.join("")}</ol>`, ` steps-${Math.min(steps.length, 5)}`);
}

/** Messages between up to four actors, in the order they happen. */
export function renderSequence(source: string): string | null {
  const { title, lines } = parse(source);
  const actors: string[] = [];
  const messages: { from: number; to: number; text: string }[] = [];
  for (const line of lines) {
    const m = line.match(/^(.+?)\s*->\s*(.+?)\s*:\s*(.+)$/);
    if (!m) return null;
    const index = (name: string) => (actors.includes(name) ? actors.indexOf(name) : actors.push(name) - 1);
    messages.push({ from: index(m[1]), to: index(m[2]), text: m[3] });
  }
  if (!messages.length || actors.length < 2 || actors.length > 4 || messages.some((m) => m.from === m.to)) return null;
  const head = `<div class="seq-actors" aria-hidden="true">${actors.map((a) => `<span>${inline(a)}</span>`).join("")}</div>`;
  const rows = messages.map(({ from, to, text }) => {
    const [start, end] = [Math.min(from, to), Math.max(from, to)];
    return `<li class="seq-message seq-start-${start + 1} seq-span-${end - start + 1}${from > to ? " is-reverse" : ""}"><span class="sr-only">${esc(actors[from])} to ${esc(actors[to])}: </span><span class="seq-text">${inline(text)}</span><span class="seq-arrow" aria-hidden="true"></span></li>`;
  });
  return figure("sequence", title, `${head}<ol class="seq-messages">${rows.join("")}</ol>`, ` actors-${actors.length}`);
}

/** Files on the left, what each one becomes on the right. */
export function renderFiles(source: string): string | null {
  const { title, lines } = parse(source);
  const pairs = lines.map((line) => line.split(/\s+->\s+/));
  if (!pairs.length || pairs.some((p) => p.length !== 2 || !p[0] || !p[1])) return null;
  const items = pairs.map(([file, result]) => `<li><code>${esc(file.trim())}</code><span class="files-arrow" aria-hidden="true"></span><span class="sr-only"> becomes </span><code>${esc(result.trim())}</code></li>`);
  return figure("files", title, `<ul>${items.join("")}</ul>`);
}

export const diagrams: Record<string, (source: string) => string | null> = { flow: renderFlow, sequence: renderSequence, files: renderFiles };
