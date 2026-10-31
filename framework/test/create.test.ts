import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { name, version } from "../package.json";
import { create } from "../src/create";

test.each(["basic", "fullstack"] as const)("%s starters use an installable registry dependency outside the workspace", (template) => {
  const root = mkdtempSync(join(tmpdir(), "optz-create-"));
  try {
    create(join(root, "my-app"), template);
    const pkg = JSON.parse(readFileSync(join(root, "my-app/package.json"), "utf8"));
    expect(pkg.dependencies.optz).toBe(`npm:${name}@${version}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repository starters alias the scoped workspace package as optz", () => {
  const root = mkdtempSync(join(tmpdir(), "optz-workspace-create-"));
  try {
    mkdirSync(join(root, "framework"));
    writeFileSync(join(root, "framework/package.json"), JSON.stringify({ name, version }));
    create(join(root, "apps/my-app"));
    const pkg = JSON.parse(readFileSync(join(root, "apps/my-app/package.json"), "utf8"));
    expect(pkg.dependencies.optz).toBe(`workspace:${name}@*`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
