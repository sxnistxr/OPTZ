import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataPath, fillPattern, matchRoute, scanApi, scanRoutes, sortRoutes } from "../src/routes";
import { scriptJson } from "../src/render";

function app(files: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "optz-"));
  for (const f of files) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), "export default () => null;\n");
  }
  return dir;
}

describe("scanRoutes", () => {
  const dir = app([
    "index.tsx", "about.tsx", "_layout.tsx", "_404.tsx", "_error.tsx", "helper.ts",
    "blog/index.tsx", "blog/[slug].tsx", "blog/new.tsx", "blog/_layout.tsx",
    "docs/[...rest].tsx", "(marketing)/pricing.tsx", "_private/secret.tsx", "lib.d.ts", "x.test.tsx",
  ]);
  const t = scanRoutes(dir);
  const patterns = t.routes.map((r) => r.pattern);

  test("finds pages, skips private, test and helper .ts files", () => {
    expect(new Set(patterns)).toEqual(new Set(["/", "/about", "/blog", "/blog/[slug]", "/blog/new", "/docs/[...rest]", "/pricing"]));
    expect(t.notFound).toEndWith("_404.tsx");
  });

  test("nests layouts and finds error boundaries", () => {
    const post = t.routes.find((r) => r.pattern === "/blog/[slug]")!;
    expect(post.layouts.map((l) => l.slice(dir.length))).toEqual(["/_layout.tsx", "/blog/_layout.tsx"]);
    expect(post.error).toEndWith("_error.tsx");
    expect(t.routes.find((r) => r.pattern === "/about")!.layouts).toHaveLength(1);
  });

  test("static segments beat params, params beat catch-alls", () => {
    expect(matchRoute(t.routes, "/blog/new")!.route.pattern).toBe("/blog/new");
    expect(matchRoute(t.routes, "/blog/hello")).toMatchObject({ route: { pattern: "/blog/[slug]" }, params: { slug: "hello" } });
    expect(matchRoute(t.routes, "/docs/a/b/c")!.params).toEqual({ rest: "a/b/c" });
    expect(matchRoute(t.routes, "/docs")).toBeNull();
    expect(matchRoute(t.routes, "/")!.route.pattern).toBe("/");
    expect(matchRoute(t.routes, "/nope/x")).toBeNull();
    expect(matchRoute(t.routes, "/blog/caf%C3%A9")!.params.slug).toBe("café");
  });

  test("rejects two files for the same URLs", () => {
    expect(() => scanRoutes(app(["a/[x].tsx", "a/[y].tsx"]))).toThrow(/same URLs/);
  });
});

test("fillPattern and dataPath", () => {
  const segs = scanRoutes(app(["blog/[slug].tsx"])).routes[0].segments;
  expect(fillPattern(segs, { slug: "a b" })).toBe("/blog/a%20b");
  expect(dataPath("/")).toBe("/_optz/data/index.json");
  expect(dataPath("/blog/x")).toBe("/_optz/data/blog/x.json");
});

test("boot JSON can't break out of its script tag", () => {
  const s = scriptJson({ x: "</script><script>alert(1)</script> " });
  expect(s).not.toContain("</script>");
  expect(s).not.toContain(" ");
  expect(JSON.parse(s).x).toBe("</script><script>alert(1)</script> ");
});

test("API routes live in app/api under /api", () => {
  const dir = app(["stats.ts", "posts/index.ts", "posts/[id].ts", "posts/[id]/like.ts", "_internal.ts", "types.d.ts"]);
  const apis = sortRoutes(scanApi(dir));
  expect(new Set(apis.map((r) => r.pattern))).toEqual(new Set(["/api/posts/[id]/like", "/api/posts", "/api/stats", "/api/posts/[id]"]));
  expect(matchRoute(apis, "/api/posts")!.route.pattern).toBe("/api/posts");
  expect(matchRoute(apis, "/api/posts/7")!.route.pattern).toBe("/api/posts/[id]");
  expect(apis.every((r) => r.kind === "api")).toBe(true);
  expect(matchRoute(apis, "/api/posts/7/like")!.params).toEqual({ id: "7" });
});
