import { existsSync } from "node:fs";
import { join } from "node:path";
for (const name of ["uploads", "status", "analytics", "db"]) {
  const root = join(import.meta.dir, name), pkg = await Bun.file(join(root, "package.json")).json();
  for (const target of Object.values(pkg.exports) as string[]) { if (!existsSync(join(root, target))) throw new Error(`Missing ${name} export`); await import(join(root, target)); }
  const packed = Bun.spawnSync([process.execPath, "pm", "pack", "--dry-run"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (packed.exitCode) throw new Error(`${name} package dry-run failed`);
  const listing = packed.stdout.toString() + packed.stderr.toString();
  for (const line of listing.split("\n")) { const file = line.match(/^packed\s+\S+\s+(\S+)$/)?.[1]; if (file && !/^(src\/|README\.md$|LICENSE$|package\.json$)/.test(file)) throw new Error(`Unexpected file in ${name}: ${file}`); }
  console.log(`@optz/${name}: exports and package dry-run passed`);
}
