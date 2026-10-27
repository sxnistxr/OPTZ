// The typed API client (audit: A6-A8): URL filling and the types it derives from patterns.
import { expect, test } from "bun:test";
import { apiUrl, json } from "../src/index";
import type { ApiContext, PatternParams } from "../src/types";

test("apiUrl escapes single segments, keeps catch-all slashes and refuses missing params", () => {
  expect(apiUrl("/api/posts/[id]", { id: "a/b c" })).toBe("/api/posts/a%2Fb%20c");
  expect(apiUrl("/api/files/[...path]", { path: "a/b c" })).toBe("/api/files/a/b%20c");
  expect(apiUrl("/api/shop/[[...rest]]", {})).toBe("/api/shop");
  expect(apiUrl("/api/shop/[[...rest]]", { rest: "x/y" })).toBe("/api/shop/x/y");
  expect(() => apiUrl("/api/posts/[id]", {})).toThrow(/missing param "id"/);
  expect(() => apiUrl("/api/files/[...path]", {})).toThrow(/missing param "path"/);
});

test("params are typed from a pattern; json() keeps Headers objects", async () => {
  const p: PatternParams<"/api/a/[id]/[...rest]/[[...opt]]"> = { id: "1", rest: "x" };
  // @ts-expect-error: id is required
  const missing: PatternParams<"/api/a/[id]"> = {};
  const handler = ({ params }: ApiContext<"/api/posts/[id]">) => params.id.toUpperCase();
  expect(p.id).toBe("1");
  expect(Object.keys(missing)).toEqual([]);
  expect(typeof handler).toBe("function");
  const r = json({ ok: true }, { status: 201, headers: new Headers({ "X-A": "1" }) });
  expect(r.headers.get("x-a")).toBe("1");
  expect(r.headers.get("content-type")).toBe("application/json");
});
