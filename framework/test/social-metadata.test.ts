import { describe, expect, test } from "bun:test";
import React from "react";
import { createApp } from "../src/handler";
import { compilePattern } from "../src/match";
import type { Manifest } from "../src/manifest";
import { headTags, mergeHead, type RenderInput } from "../src/render";
import { resolveConfig, type Head } from "../src/types";

const config = resolveConfig({ site: { url: "https://example.com" } });
function input(head: Head, og?: string): RenderInput {
  return {
    page: { default: () => null, head: () => head },
    layouts: [{ default: () => null, head: () => ({ openGraph: { siteName: "Lab", locale: "en_US" }, twitter: { card: "summary_large_image" } }) }],
    pattern: "/post", pathname: "/post", params: {}, ctx: {} as RenderInput["ctx"], og,
  };
}

describe("social metadata", () => {
  test("article overrides retain layout branding and large-card defaults", () => {
    const head = mergeHead(input({ title: "A post", openGraph: { type: "article" }, twitter: { creator: "@author" } }, "/card.png"), null);
    expect(head.openGraph).toMatchObject({ siteName: "Lab", locale: "en_US", type: "article" });
    expect(head.twitter).toMatchObject({ card: "summary_large_image", creator: "@author" });
    const tags = headTags(head, config, "/post");
    expect(tags).toContain('property="og:image" content="https://example.com/card.png"');
    expect(tags).toContain('property="og:image:type" content="image/png"');
    expect(tags).toContain('property="og:image:width" content="1200"');
    expect(tags).toContain('property="og:image:height" content="630"');
    expect(tags).toContain('property="og:image:secure_url" content="https://example.com/card.png"');
    expect(tags).toContain('name="twitter:image:alt" content="A post"');
  });

  test("social URLs follow canonical aliases and metadata stays escaped", () => {
    const tags = headTags({ title: 'A < B & "C"', canonical: "/original", openGraph: {} }, config, "/alias");
    expect(tags).toContain('property="og:url" content="https://example.com/original"');
    expect(tags).toContain("A &lt; B &amp; &quot;C&quot;");
  });

  test("explicit image and Twitter alt overrides survive generated defaults", () => {
    const head = mergeHead(input({ openGraph: { images: [{ url: "/custom.jpg", type: "image/jpeg", alt: "A diagram" }] }, twitter: { imageAlt: "Custom description" } }, "/generated.png"), null);
    const tags = headTags(head, config, "/post");
    expect(tags).toContain('property="og:image" content="https://example.com/custom.jpg"');
    expect(tags).toContain('property="og:image:alt" content="A diagram"');
    expect(tags).toContain('name="twitter:image:alt" content="Custom description"');
    expect(tags).not.toContain("generated.png");
  });
});

for (const mode of ["dev", "prerender", "dynamic"] as const) {
  test(`registered producer dimensions reach HTML and data metadata (${mode})`, async () => {
    const manifest: Manifest = {
      version: 3, builtAt: 0, mode: "islands", entry: "/entry.js", css: [],
      routes: [{ pattern: "/post", segments: compilePattern("/post"), file: "post.tsx", og: "post.og.tsx", kind: "page", render: mode === "dynamic" ? "dynamic" : "static", hasLoader: false, layouts: [], preload: [] }],
      islands: {}, rootLayouts: [], redirects: {}, slots: [], intercepts: [], actions: {}, fonts: [], apiStatic: {},
    };
    const app = await createApp({
      manifest, config: resolveConfig({ site: { url: "https://example.com" }, features: { streaming: false } }), files: new Map(),
      dev: mode === "dev", prerender: mode === "prerender",
      platform: { load: async (file) => file === "post.og.tsx"
        ? { size: { width: 800, height: 800 }, default: () => null }
        : { default: () => React.createElement("main", null, "Post"), head: () => ({ title: "Post" }) } },
    });
    const response = await app.fetch(new Request("https://example.com/post"));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('property="og:image:width" content="800"');
    expect(html).toContain('property="og:image:height" content="800"');
    expect(html).toContain('property="og:image:type" content="image/png"');
    const data = await app.fetch(new Request("https://example.com/_optz/data/post.json"));
    expect(data.status).toBe(200);
    expect((await data.json()).head.openGraph.images[0]).toMatchObject({ width: 800, height: 800, type: "image/png", alt: "Post" });
  });
}

test.each([
  [undefined, undefined, "Open Graph diagram"],
  ["https://example.com/shared.png", undefined, "Open Graph diagram"],
  ["/different.png", undefined, undefined],
  ["/different.png", "Twitter diagram", "Twitter diagram"],
])("Twitter alt follows its selected image (%s, %s)", (image, imageAlt, expected) => {
  const tags = headTags({ openGraph: { images: [{ url: "/shared.png", alt: "Open Graph diagram" }] }, twitter: { images: image ? [image] : undefined, imageAlt } }, config, "/post");
  if (expected) expect(tags).toContain(`name="twitter:image:alt" content="${expected}"`);
  else expect(tags).not.toContain('name="twitter:image:alt"');
});
