import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = join(import.meta.dir, "..");
const clients = [];
for (const name of ["analytics", "uploads"]) {
  const build = await Bun.build({ entrypoints: [join(root, "packages", name, "src/client.ts")], target: "browser", minify: true, write: false });
  if (!build.success) throw new Error(`Client build failed: ${name}`);
  const text = await build.outputs[0].text();
  if (/DOPPLER_TOKEN|@aws-sdk|better-auth|bun:sqlite|secretAccessKey/.test(text)) throw new Error(`Server code leaked into ${name} client`);
  if (new TextEncoder().encode(text).length > (name === "analytics" ? 2000 : 5000)) throw new Error(`${name} exceeded its optional browser-helper budget`);
  clients.push({ package: `@optz/${name}/client`, minified_bytes: new TextEncoder().encode(text).length, gzip_bytes: Bun.gzipSync(text).length });
}
const assets = join(root, "portfolio/dist/static/assets");
const entries = [...new Bun.Glob("entry-*.js").scanSync(assets)].map(file => {
  const text = readFileSync(join(assets, file));
  return { file, bytes: text.length, sha256: createHash("sha256").update(text).digest("hex") };
});
const baselineFile = process.argv[process.argv.indexOf("--baseline") + 1];
const saved = process.argv.includes("--baseline") && existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, "utf8")) : null;
const baseline = Array.isArray(saved) ? saved : saved?.portfolio_entry ?? null;
const result = { date: new Date().toISOString(), bun: Bun.version, method: "Standalone optional browser helper exports, minified with Bun; gzip via Bun. Default entry measured from current portfolio production build. Not a cold-browser transfer audit.", clients, portfolio_entry: entries, baseline_portfolio_entry: baseline, default_entry_identical: baseline ? entries.length === baseline.length && entries.every(e => baseline.some((b: { bytes: number; sha256: string }) => e.bytes === b.bytes && e.sha256 === b.sha256)) : null };
writeFileSync(join(root, "bench/module-bundles.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
