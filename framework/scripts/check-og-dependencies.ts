// Root overrides are not inherited by package consumers. Satori pins vulnerable fflate,
// so pack its resolved dependency tree and refuse to release an unpatched snapshot.
import { dirname, join } from "node:path";
import { existsSync, readFileSync, symlinkSync } from "node:fs";

const root = dirname(import.meta.dir);
const satori = Bun.resolveSync("satori", root);
const satoriManifest = JSON.parse(readFileSync(Bun.resolveSync("satori/package.json", root), "utf8"));
if (satoriManifest.dependencies.fflate !== "0.7.5") throw new Error("Apply the Satori manifest patch with bun install before packing");
const opentype = Bun.resolveSync("@shuding/opentype.js", dirname(satori));
for (const importer of [satori, opentype]) {
  const entry = Bun.resolveSync("fflate", dirname(importer));
  const manifest = Bun.resolveSync("fflate/package.json", dirname(importer));
  const { version } = JSON.parse(readFileSync(manifest, "utf8"));
  if (version !== "0.7.5") throw new Error(`OG dependency snapshot requires fflate 0.7.5, got ${version} at ${entry}`);
}
// Bun hoists workspace dependencies. Its packer only bundles from the package's own
// node_modules; point it at that installed tree when there is no local directory.
const local = join(root, "node_modules");
if (!existsSync(local)) {
  const installed = dirname(dirname(Bun.resolveSync("satori/package.json", root)));
  symlinkSync(installed, local, "dir");
}
if (!existsSync(join(local, "satori/package.json"))) throw new Error("Install Satori before packing the OG dependency snapshot");
console.log("OG dependencies ok: Satori and OpenType resolve patched fflate 0.7.5");
