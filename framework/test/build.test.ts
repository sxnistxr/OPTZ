// optz build/export (audit: C6, X5): a failed build keeps the last good dist/, and exported
// sites keep their redirects.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "../src/build";
import { resolveConfig } from "../src/types";

// Inside the repo, so "optz" and React resolve from the workspace.
const root = join(import.meta.dir, "../.tmp", `app-${process.pid}`);
const file = (f: string, s: string) => {
  mkdirSync(join(root, f, ".."), { recursive: true });
  writeFileSync(join(root, f), s);
};
afterAll(() => rmSync(root, { recursive: true, force: true }));

file("app/routes/index.tsx", "export default function Home() { return <h1>home v1</h1>; }\n");
file("app/routes/old.tsx", 'import { redirect } from "optz";\nexport const loader = () => { throw redirect("/new", 308); };\nexport default function Old() { return null; }\n');
file("app/routes/new.tsx", "export default function New() { return <h1>new</h1>; }\n");

test("export writes forwarding pages and _redirects for redirects", async () => {
  const log = console.log;
  console.log = () => {};
  await build({ root, config: resolveConfig({ features: { dynamic: false } }), exportOnly: true });
  console.log = log;
  const stub = readFileSync(join(root, "dist/static/old/index.html"), "utf8");
  expect(stub).toContain('<meta http-equiv="refresh" content="0; url=/new">');
  expect(readFileSync(join(root, "dist/static/_redirects"), "utf8")).toBe("/old /new 301\n");
});

test("a failed build leaves the previous dist/ in place", async () => {
  const log = console.log;
  console.log = () => {};
  const err = console.error;
  console.error = () => {};
  await build({ root, config: resolveConfig({}) });
  expect(readFileSync(join(root, "dist/static/index.html"), "utf8")).toContain("home v1");
  // A new page that fails to render (a changed file would come from the module cache).
  file("app/routes/broken.tsx", 'export default function Broken(): never { throw new Error("broken"); }\n');
  await expect(build({ root, config: resolveConfig({}) })).rejects.toThrow();
  console.log = log;
  console.error = err;
  expect(readFileSync(join(root, "dist/static/index.html"), "utf8")).toContain("home v1");
  expect(existsSync(join(root, "dist/manifest.json"))).toBe(true);
});
