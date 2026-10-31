import { describe, expect, test } from "bun:test";
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
