import { describe, expect, spyOn, test } from "bun:test";
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
    pattern: "/post", pathname: "/post", params: {}, ctx: {} as RenderInput["ctx"], og, metadataBase: config.site?.url,
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

test.each(["reject", "throw"])("producer load failures are optional for pages, but not image requests (%s)", async (failure) => {
  const manifest: Manifest = {
    version: 3, builtAt: 0, mode: "islands", entry: "/entry.js", css: [],
    routes: [{ pattern: "/post", segments: compilePattern("/post"), file: "post.tsx", og: "post.og.tsx", kind: "page", render: "dynamic", hasLoader: false, layouts: [], preload: [] }],
    islands: {}, rootLayouts: [], redirects: {}, slots: [], intercepts: [], actions: {}, fonts: [], apiStatic: {},
  };
  let renderedImages = 0;
  const app = await createApp({
    manifest, config: resolveConfig({ site: { url: "https://example.com" }, features: { streaming: false } }), files: new Map(),
    platform: {
      load(file) {
        if (file === "post.og.tsx") {
          const error = new Error("Producer unavailable");
          if (failure === "throw") throw error;
          return Promise.reject(error);
        }
        return Promise.resolve({ default: () => React.createElement("main", null, "Post"), head: () => ({ title: "Post" }) });
      },
      og: async () => { renderedImages++; return new Uint8Array(); },
    },
  });
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await app.fetch(new Request("https://example.com/post"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<main>Post</main>");
    const data = await app.fetch(new Request("https://example.com/_optz/data/post.json"));
    expect(data.status).toBe(200);
    expect((await data.json()).head.openGraph.images[0]).toMatchObject({ width: 1200, height: 630, type: "image/png" });
    expect((await app.fetch(new Request("https://example.com/_optz/og/post.png"))).status).toBe(500);
    expect(renderedImages).toBe(0);
  } finally { log.mockRestore(); }
});

/** Build an uncached dynamic route so every request exercises producer metadata loading. */
async function appWithProducer(loadProducer: () => Promise<unknown>, prerender = false) {
  const manifest: Manifest = {
    version: 3, builtAt: 0, mode: "islands", entry: "/entry.js", css: [],
    routes: [{ pattern: "/post", segments: compilePattern("/post"), file: "post.tsx", og: "post.og.tsx", kind: "page", render: prerender ? "static" : "dynamic", hasLoader: false, layouts: [], preload: [] }],
    islands: {}, rootLayouts: [], redirects: {}, slots: [], intercepts: [], actions: {}, fonts: [], apiStatic: {},
  };
  return createApp({
    prerender, manifest, config: resolveConfig({ site: { url: "https://example.com" }, features: { streaming: false, cache: false } }), files: new Map(),
    platform: {
      load: (file) => file === "post.og.tsx" ? loadProducer() : Promise.resolve({ default: () => React.createElement("main", null, "Post"), head: () => ({ title: "Post" }) }),
      og: async () => new Uint8Array(),
    },
  });
}

test("stalled producers do not block HTML or data and remain shared for later requests", async () => {
  let loads = 0;
  let release!: (value: unknown) => void;
  const pending = new Promise(resolve => { release = resolve; });
  const app = await appWithProducer(() => { loads++; return pending; });
  try {
    const [page, data] = await Promise.all([
      app.fetch(new Request("https://example.com/post")),
      app.fetch(new Request("https://example.com/_optz/data/post.json")),
    ]);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<main>Post</main>");
    expect(data.status).toBe(200);
    expect((await data.json()).head.openGraph.images[0]).toMatchObject({ width: 1200, height: 630 });
    release({ size: { width: 800, height: 800 }, default: () => null });
    await pending;
    const next = await app.fetch(new Request("https://example.com/_optz/data/post.json"));
    expect((await next.json()).head.openGraph.images[0]).toMatchObject({ width: 800, height: 800 });
    expect(loads).toBe(1);
  } finally { release({}); }
}, 2000);

test.each(["immediate", "after timeout"])("failed optional producers can be retried (%s)", async (failure) => {
  let loads = 0;
  let reject!: (error: Error) => void;
  const pending = new Promise((_, fail) => { reject = fail; });
  const app = await appWithProducer(() => {
    loads++;
    return loads === 1 ? pending : Promise.resolve({ size: { width: 800, height: 800 }, default: () => null });
  });
  const first = app.fetch(new Request("https://example.com/_optz/data/post.json"));
  if (failure === "immediate") reject(new Error("Transient import failure"));
  try {
    expect((await first).status).toBe(200);
    if (failure === "after timeout") reject(new Error("Late import failure"));
    await pending.catch(() => undefined);
    const image = await app.fetch(new Request("https://example.com/_optz/og/post.png"));
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    const next = await app.fetch(new Request("https://example.com/_optz/data/post.json"));
    expect(next.status).toBe(200);
    expect((await next.json()).head.openGraph.images[0]).toMatchObject({ width: 800, height: 800 });
    expect(loads).toBe(2);
  } finally { reject(new Error("Test cleanup")); }
}, 2000);

test("prerenders await slow producer dimensions for both HTML and data", async () => {
  let release!: (value: unknown) => void;
  const pending = new Promise(resolve => { release = resolve; });
  const app = await appWithProducer(() => pending, true);
  let completed = 0;
  const responses = Promise.all(["/post", "/_optz/data/post.json"].map(async path => {
    const response = await app.fetch(new Request("https://example.com" + path));
    completed++;
    return response;
  }));
  try {
    // Exceed the live-request budget before allowing this build-time import to finish.
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(completed).toBe(0);
    release({ size: { width: 800, height: 800 }, default: () => null });
    const [page, data] = await responses;
    const html = await page.text();
    expect(html).toContain('property="og:image:width" content="800"');
    expect(html).toContain('property="og:image:height" content="800"');
    expect((await data.json()).head.openGraph.images[0]).toMatchObject({ width: 800, height: 800 });
  } finally { release({}); await responses; }
}, 2000);

test.each([
  [{ twitter: { images: ["/child.png"] } }, undefined],
  [{ twitter: { images: ["/parent.png"] } }, "Parent image"],
  [{ twitter: { images: ["https://example.com/parent.png"] } }, "Parent image"],
  [{ twitter: { images: ["/child.png"], imageAlt: "Child image" } }, "Child image"],
  [{ twitter: { images: ["/child.png"], imageAlt: "" } }, ""],
  [{ openGraph: { images: ["/child.png"] } }, undefined],
])("Twitter alt inheritance follows the effective image (%j)", (child, expected) => {
  const fixture = input(child as Head);
  fixture.layouts = [{ default: () => null, head: () => ({ openGraph: { images: ["/parent.png"] }, twitter: { imageAlt: "Parent image" } }) }];
  const head = mergeHead(fixture, null);
  expect(head.twitter?.imageAlt).toBe(expected);
  const tags = headTags(head, config, "/post");
  if (expected !== undefined) expect(tags).toContain(`name="twitter:image:alt" content="${expected}"`);
  else expect(tags).not.toContain('name="twitter:image:alt"');
});

test("Open Graph overrides preserve alt text when Twitter keeps its own image", () => {
  const fixture = input({ openGraph: { images: ["/child.png"] } });
  fixture.layouts = [{ default: () => null, head: () => ({ twitter: { images: ["/twitter.png"], imageAlt: "Twitter image" } }) }];
  expect(mergeHead(fixture, null).twitter?.imageAlt).toBe("Twitter image");
});

test("inherited alt comparisons use the same metadata base as emitted image URLs", () => {
  const fixture = input({ twitter: { images: ["image.png"] } });
  fixture.metadataBase = "https://example.com/app/";
  fixture.layouts = [{ default: () => null, head: () => ({ twitter: { images: ["/image.png"], imageAlt: "Root image" } }) }];
  expect(mergeHead(fixture, null).twitter?.imageAlt).toBeUndefined();
});
