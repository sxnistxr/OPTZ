// Exercise the published layout outside the workspace: linked source directories can load
// React from bunx's cache while an app's hooks use its own copy.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { name, version } from "../package.json";

const framework = join(import.meta.dir, ".."), temp = mkdtempSync(join(tmpdir(), "optz-starter-package-"));
function command(args: string[], cwd: string, mode = "production") {
  const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe", timeout: 60_000, env: { ...process.env, NODE_ENV: mode } });
  if (result.exitCode !== 0) throw new Error(`Starter check failed: ${args.slice(1).join(" ")}\n${result.stdout.toString()}${result.stderr.toString()}`);
  return result.stdout.toString();
}

try {
  command([process.execPath, "pm", "pack", "--destination", temp], framework);
  const tarball = join(temp, readdirSync(temp).find(file => file.endsWith(".tgz"))!);
  const creator = join(temp, "bunx-cache"), app = join(temp, "my-app");
  mkdirSync(creator);
  writeFileSync(join(creator, "package.json"), JSON.stringify({ private: true, dependencies: { [name]: `file:${tarball}` } }));
  command([process.execPath, "install", "--ignore-scripts"], creator);
  command([process.execPath, join(creator, "node_modules", name, "src/cli.ts"), "create", app], temp);

  const pkgFile = join(app, "package.json"), pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
  if (pkg.dependencies.optz !== `npm:${name}@${version}`) throw new Error("Starter must install optz from the registry, not link to its creator's temporary installation");
  // Install this candidate release, including unpublished changes, using a tarball rather
  // than a directory link. Everything else is the starter's generated dependency set.
  pkg.dependencies.optz = `file:${tarball}`;
  writeFileSync(pkgFile, JSON.stringify(pkg));
  command([process.execPath, "install", "--ignore-scripts"], app);
  rmSync(creator, { recursive: true, force: true });

  writeFileSync(join(app, "app/routes/hooks.tsx"), `import Counter from "$components/Counter.island";
export const config = { render: "dynamic" } as const;
export default function Hooks() { return <Counter start={7} />; }
`);
  command([process.execPath, "run", "check"], app);
  command([process.execPath, "run", "build"], app);

  const smoke = join(app, "smoke.ts");
  writeFileSync(smoke, `import { dirname, join } from "node:path";
import { resolveConfig } from "optz";
import userConfig from "./optz.config";
const source = dirname(Bun.resolveSync("optz", process.cwd()));
const config = resolveConfig(userConfig), dev = process.env.NODE_ENV === "development";
if (dev) await (await import(join(source, "build.ts"))).build({ root: process.cwd(), config, dev });
const { server } = await (await import(join(source, "server.ts"))).serve({ root: process.cwd(), config, dev, port: 0 });
try {
  for (const [path, count] of [["/", 1], ["/hooks", 7]] as const) {
    const response = await fetch(new URL(path, server.url));
    const html = (await response.text()).replaceAll("<!-- -->", "");
    if (!response.ok || !html.includes("Clicked " + count + " times") || !html.includes('<optz-island data-id="app/components/Counter.island.tsx"')) {
      throw new Error("Hook island failed to render " + path + ": " + response.status + "\\n" + html);
    }
  }
} finally { server.stop(true); }
// The development SSE heartbeat stays alive for the lifetime of a CLI process.
process.exit(0);
`);
  for (const mode of ["production", "development"]) command([process.execPath, smoke], app, mode);
  console.log("starter ok: isolated tarball, type-check, production build and hook islands in production/development");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
