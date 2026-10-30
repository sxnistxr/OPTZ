import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDocument, DomUtils } from "htmlparser2";
import { getDoc, listDocs, renderDocBody } from "../app/lib/docs";
import { renderDocsChart } from "../app/lib/docs-charts";
import network from "../../bench/results.json";

const entry = { slug: "fixture", title: "Fixture", file: "portfolio/content/docs/getting-started.md" };

describe("documentation rendering", () => {
  test("highlights code without changing the text or permitting executable markup", () => {
    const code = 'export const markup = "<script>alert(1)</script>";\n// a < b && c > d';
    const { html } = renderDocBody(entry, `\`\`\`ts\n${code}\n\`\`\``);
    const tree = parseDocument(html);
    const block = DomUtils.findOne(node => node.name === "code", tree.children, true)!;
    expect(DomUtils.textContent(block)).toBe(code);
    expect(html).toContain("syntax-l");
    expect(html).toContain("syntax-d");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("style=");
    const plain = renderDocBody(entry, '```unknown-language\n<hello> & goodbye\n```').html;
    expect(plain).toContain("&lt;hello&gt; &amp; goodbye");
  });

  test("renders labeled support states and semantic keyboard-scrollable tables", () => {
    const { html } = renderDocBody(entry, "## Support\n\n| Feature | Support |\n|---|---|\n| One | [built-in] `api()` |\n| Two | [partial] Some paths |\n| Three | [unavailable] |\n| Four | [integration] Provider |\n");
    expect(html).toContain('scope="row"');
    expect(html).toContain('scope="col"');
    expect(html).toContain('tabindex="0" role="region" aria-label="Support table"');
    for (const state of ["Built in", "Partial", "Unavailable", "Integration"]) expect(html).toContain(state);
    expect(html).toContain('<code>api()</code>');
    expect(html).not.toContain("[built-in]");
    expect(html).not.toMatch(/[✅❌◐]/u);
  });

  test("only the known data renderer can emit a chart; prose SVG stays blocked", () => {
    const { html } = renderDocBody(entry, '<svg onload="alert(1)"><text>unsafe</text></svg>\n\n```stats\nthroughput\n```');
    expect(html).not.toContain("onload");
    expect(html).not.toContain("unsafe");
    expect(html).toContain('<figure class="docs-chart">');
    expect(html).toContain(network.optz.paths["/"].rps.median.toLocaleString("en-US"));
    expect(html).toContain("bench/results.json");
    expect(renderDocsChart("made-up-results")).toBeUndefined();
    expect(renderDocBody(entry, '```stats\nmade-up-results\n```').html).toContain("made-up-results");
  });

  test("every indexed page renders and all syntax colors have both-theme CSS rules", () => {
    const css = readFileSync(new URL("../app/docs-syntax.css", import.meta.url), "utf8");
    for (const meta of listDocs()) {
      const doc = getDoc(meta.slug)!;
      expect(doc.html.length).toBeGreaterThan(0);
      expect(doc.html).not.toMatch(/docs-chart-slot-\d/);
      for (const match of doc.html.matchAll(/syntax-[ld][a-f0-9]{6,8}/g)) expect(css).toContain(`.${match[0]} `);
    }
    expect(getDoc("full-stack")).toBeDefined();
    expect(getDoc("application-apis")).toBeDefined();
    expect(getDoc("vs-nextjs")!.html).not.toMatch(/[✅❌◐]/u);
  });
});
