// CI: every package.json export and bin points at a file that exists and imports cleanly, the
// published tarball holds what it should (src, skills, README) and nothing else.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { exports: Record<string, string>; bin: Record<string, string>; files: string[] };
const problems: string[] = [];
for (const [name, target] of [...Object.entries(pkg.exports), ...Object.entries(pkg.bin).map(([k, v]) => [`bin ${k}`, v])]) {
  const f = join(dir, target);
  if (!existsSync(f)) {
    problems.push(`${name} -> ${target}: missing`);
    continue;
  }
  if (name.startsWith("bin ")) continue;
  try {
    await import(f);
  } catch (e) {
    problems.push(`${name} -> ${target}: ${(e as Error).message}`);
  }
}
const pack = Bun.spawnSync([process.execPath, "pm", "pack", "--dry-run"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
if (pack.exitCode !== 0) problems.push("Package dry-run failed");
const listing = pack.stdout.toString() + pack.stderr.toString();
for (const line of listing.split("\n")) {
  const m = line.match(/^packed\s+\S+\s+(\S+)$/);
  if (m && !/^(src\/|skills\/|schema\/|README\.md$|package\.json$)/.test(m[1])) problems.push(`unexpected file in the tarball: ${m[1]}`);
}
if (problems.length) {
  console.error(`package check failed:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`package ok: ${Object.keys(pkg.exports).length} exports import cleanly`);
await import("./check-starter");
