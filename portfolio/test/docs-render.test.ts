import { describe, expect, test } from "bun:test";
import { renderFiles, renderFlow, renderSequence } from "../app/lib/docs-diagrams";
import { renderDocBody } from "../app/lib/docs";

const page = { slug: "test", file: "portfolio/content/docs/test.md", title: "Test" };

describe("flow diagrams", () => {
  test("renders each step in order and marks the key step", () => {
    const html = renderFlow("title: On a request\nBuild | React pages | Render once\nRequest* | `GET /` | Map lookup")!;
    expect(html).toContain('aria-label="On a request"');
    expect(html.indexOf("React pages")).toBeLessThan(html.indexOf("<code>GET /</code>"));
    expect(html).toContain('<li class="flow-step is-key"><span class="flow-label">Request</span>');
    expect(html).toContain("<figcaption>On a request</figcaption>");
  });

  test("escapes text and rejects lines without a title", () => {
    expect(renderFlow("A | <script>")).toContain("&lt;script&gt;");
    expect(renderFlow("just a label")).toBeNull();
  });
});

describe("sequence diagrams", () => {
  test("places each message between its actors, reversed when it goes back", () => {
    const html = renderSequence("Browser -> App: Ask\nApp -> Storage: Sign\nStorage -> Browser: Done")!;
    expect(html).toContain("actors-3");
    expect(html).toContain('class="seq-message seq-start-1 seq-span-2"');
    expect(html).toContain('class="seq-message seq-start-2 seq-span-2"');
    expect(html).toContain('class="seq-message seq-start-1 seq-span-3 is-reverse"');
    expect(html).toContain('<span class="sr-only">Storage to Browser: </span>');
  });

  test("rejects malformed lines, self messages and more than four actors", () => {
    expect(renderSequence("Browser talks to App")).toBeNull();
    expect(renderSequence("A -> A: loop")).toBeNull();
    expect(renderSequence("A -> B: 1\nC -> D: 2\nE -> A: 3")).toBeNull();
  });
});

describe("file maps", () => {
  test("pairs each file with what it becomes", () => {
    const html = renderFiles("app/routes/index.tsx -> /\napp/routes/blog/[slug].tsx -> /blog/:slug")!;
    expect(html).toContain("<code>app/routes/blog/[slug].tsx</code>");
    expect(html).toContain("<code>/blog/:slug</code>");
    expect(renderFiles("no arrow here")).toBeNull();
  });
});

describe("Markdown extensions", () => {
  test("turns GitHub alerts into callouts and leaves plain quotes alone", () => {
    const { html } = renderDocBody(page, "> [!TIP]\n> Run `bun run check` first.\n\n> Just a quote.");
    expect(html).toContain('<div class="callout callout-tip" role="note"><p class="callout-title">Tip</p><p>Run <code>bun run check</code> first.</p>');
    expect(html).toContain("<blockquote>");
  });

  test("puts a code block's file name on the block", () => {
    const { html } = renderDocBody(page, '```tsx title="app/routes/index.tsx"\nexport default function Home() {}\n```');
    expect(html).toContain('data-lang="tsx" data-title="app/routes/index.tsx"');
  });

  test("renders diagram blocks, and keeps an unparseable one as code", () => {
    expect(renderDocBody(page, "```flow\nBuild | Pages\n```").html).toContain('class="docs-diagram docs-flow');
    expect(renderDocBody(page, "```sequence\nnot a message\n```").html).toContain('data-lang="sequence"');
  });
});
