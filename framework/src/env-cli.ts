import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkEnvManifest, readEnv, type EnvManifest } from "./env";
import { readBody } from "./body";

const manifestName = "optz.env.json";
const marker = "__OPTZ_DOPPLER_ACTIVE";
const keyName = /^[A-Z_][A-Z0-9_]*$/;
export function loadEnvManifest(root: string): EnvManifest | undefined {
  const path = join(root, manifestName);
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  if (text.length > 1 << 20) throw new Error("Environment manifest exceeds 1 MiB");
  let manifest: unknown;
  try { manifest = JSON.parse(text); } catch { throw new Error("Invalid JSON in optz.env.json"); }
  checkEnvManifest(manifest); return manifest;
}
export function dopplerSelection(manifest: EnvManifest, mode = process.env.NODE_ENV ?? "development") {
  const d = manifest.doppler;
  if (!d) return [];
  const config = typeof d.config === "string" ? d.config : d.config?.[mode];
  if (d.config && !config) throw new Error(`No Doppler config mapped for ${mode}`);
  return [...(d.project ? ["--project", d.project] : []), ...(config ? ["--config", config] : [])];
}
export function dopplerRunArgs(manifest: EnvManifest, command: string[], mode = process.env.NODE_ENV ?? "development") {
  const d = manifest.doppler;
  return ["run", ...dopplerSelection(manifest, mode), "--forward-signals", ...((d?.fallback ?? mode === "development") ? [] : ["--no-fallback"]), ...(d?.watch && mode === "development" ? ["--watch"] : []), ...(d?.preserve?.length ? [`--preserve-env=${d.preserve.join(",")}`] : []), "--", ...command];
}
function providerEnvironment(manifest: EnvManifest) {
  const env: Record<string, string | undefined> = { ...process.env, [marker]: "1" };
  for (const key of Object.keys(manifest.variables)) if (!manifest.doppler?.preserve?.includes(key)) delete env[key];
  return env;
}
async function waitForChild(child: { kill(signal?: NodeJS.Signals): unknown; exited: Promise<number> }) {
  const interrupt = () => child.kill("SIGINT"), terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt); process.on("SIGTERM", terminate);
  try { return await child.exited; } finally { process.off("SIGINT", interrupt); process.off("SIGTERM", terminate); }
}
function executable() {
  const path = Bun.which("doppler");
  if (!path) throw new Error("Doppler CLI is required. Install from https://docs.doppler.com/docs/cli, then run `optz env login` and `optz env setup`.");
  return path;
}
async function run(args: string[], root: string, options: { privateOutput?: boolean; env?: Record<string, string | undefined> } = {}) {
  const child = Bun.spawn([executable(), ...args], { cwd: root, env: options.env ?? process.env, stdin: "inherit", stdout: options.privateOutput ? "ignore" : "inherit", stderr: options.privateOutput ? "ignore" : "inherit" });
  return waitForChild(child);
}
export function generateEnvironment(root: string, manifest: EnvManifest) {
  const values = readEnv(manifest.variables);
  const publicValues = Object.fromEntries(Object.entries(manifest.variables).filter(([, rule]) => rule.public).map(([key]) => [key, values[key]]));
  const dir = join(root, ".optz"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "env.public.json"), JSON.stringify(publicValues, null, 2) + "\n");
  const names = Object.entries(manifest.variables).map(([key, rule]) => `    readonly ${key}${rule.optional ? "?" : ""}: string;`).join("\n");
  writeFileSync(join(dir, "env.d.ts"), `// Generated names only; no secret values.\nexport {};\ndeclare global { namespace NodeJS { interface ProcessEnv {\n${names}\n} } }\n`);
}
/** Runs before importing application config. All provider work stays at process startup. */
export async function prepareEnvironment(root: string, command: string, args: string[]) {
  const manifest = loadEnvManifest(root);
  if (!manifest) return;
  if (manifest.doppler && process.env[marker] !== "1") {
    const code = await run(dopplerRunArgs(manifest, [process.execPath, "--no-env-file", process.argv[1], command, ...args]), root, { env: providerEnvironment(manifest) });
    process.exit(code);
  }
  const values = readEnv(manifest.variables);
  // Defaults must be visible to the config and application, not just the validator.
  for (const [key, rule] of Object.entries(manifest.variables)) if (process.env[key] === undefined && rule.default !== undefined) process.env[key] = rule.default;
  if (["dev", "__dev-child", "build", "export", "check"].includes(command)) generateEnvironment(root, manifest);
  return values;
}

export async function environmentCommand(root: string, args: string[]) {
  const [action, ...rest] = args;
  if (!action || action === "help" || action === "--help") {
    console.log(`optz env init --project NAME --config NAME  create a names-only contract
optz env login / setup                     official scoped Doppler authentication/setup
optz env doctor                            safe local diagnostics (no secret values)
optz env check / types / public             inject, validate; generate names/public allowlist
optz env list                              secret names only
optz env get NAME --reveal                  explicitly print a secret
optz env set NAME                           set from stdin; values never passed as arguments
optz env delete NAME --confirm              explicit deletion; output values suppressed
optz env diff --config NAME                 compare key names and changed values, never display values
optz env run -- COMMAND [ARGS]              inject into an arbitrary command
optz env doppler [ARGS]                     full native CLI, including configs/history/rollback

Normal optz dev/build/start automatically use optz.env.json. No per-request secret fetching.
Public browser imports: .optz/env.public.json. Never import optz/env from browser code.`);
    return 0;
  }
  if (action === "init") {
    if (existsSync(join(root, manifestName))) throw new Error("optz.env.json already exists; edit it instead of overwriting");
    const flag = (name: string) => rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined;
    const manifest: EnvManifest = { doppler: { project: flag("--project"), config: flag("--config") }, variables: {} };
    const example = join(root, ".env.example");
    if (existsSync(example)) for (const line of readFileSync(example, "utf8").split("\n")) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/);
      if (match && !match[1].startsWith("DOPPLER_")) manifest.variables[match[1]] = { type: "string" };
    }
    checkEnvManifest(manifest);
    writeFileSync(join(root, manifestName), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
    console.log("Created optz.env.json with names only. Review required/public rules, then run optz env setup."); return 0;
  }
  const manifest = loadEnvManifest(root) ?? { variables: {} };
  if (action === "doctor") {
    console.log(JSON.stringify({ manifest: existsSync(join(root, manifestName)), dopplerInstalled: !!Bun.which("doppler"), serviceTokenPresent: !!process.env.DOPPLER_TOKEN, selection: dopplerSelection(manifest), required: Object.entries(manifest.variables).filter(([, v]) => !v.optional).map(([k]) => k), public: Object.entries(manifest.variables).filter(([, v]) => v.public).map(([k]) => k) }, null, 2)); return 0;
  }
  if (["check", "types", "public"].includes(action)) {
    if (manifest.doppler && process.env[marker] !== "1") return run(dopplerRunArgs(manifest, [process.execPath, "--no-env-file", process.argv[1], "env", action]), root, { env: providerEnvironment(manifest) });
    readEnv(manifest.variables);
    if (action !== "check") generateEnvironment(root, manifest);
    console.log(`Environment valid: ${Object.keys(manifest.variables).length} declared variables. No private values printed.`); return 0;
  }
  if (action === "run") {
    const command = rest[0] === "--" ? rest.slice(1) : rest;
    if (!command.length) throw new Error("Usage: optz env run -- COMMAND [ARGS]");
    // Re-enter through the contract check before executing the caller's command.
    if (manifest.doppler && process.env[marker] !== "1") return run(dopplerRunArgs(manifest, [process.execPath, "--no-env-file", process.argv[1], "env", "run", "--", ...command]), root, { env: providerEnvironment(manifest) });
    readEnv(manifest.variables);
    for (const [key, rule] of Object.entries(manifest.variables)) if (process.env[key] === undefined && rule.default !== undefined) process.env[key] = rule.default;
    const child = Bun.spawn(command, { cwd: root, env: process.env, stdio: ["inherit", "inherit", "inherit"] });
    return waitForChild(child);
  }
  const selection = dopplerSelection(manifest);
  if (action === "diff") {
    if (rest.length !== 2 || rest[0] !== "--config") throw new Error("Use optz env diff --config NAME");
    const other = { ...manifest, doppler: { ...manifest.doppler, config: rest[1] } }; checkEnvManifest(other);
    const download = async (selected: string[]) => {
      const child = Bun.spawn([executable(), "secrets", "download", "--no-file", "--no-fallback", "--format=json", ...selected], { cwd: root, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
      const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
      try {
        const bytes = await readBody(child.stdout, 1 << 20, 15000);
        if (await child.exited) throw new Error("Doppler comparison could not fetch the selected config");
        let values: unknown; try { values = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("Invalid Doppler comparison response"); }
        if (!values || typeof values !== "object" || Array.isArray(values) || Object.values(values).some(v => typeof v !== "string")) throw new Error("Invalid Doppler comparison response");
        return Object.fromEntries(Object.entries(values).filter(([key]) => keyName.test(key) && !key.startsWith("DOPPLER_"))) as Record<string, string>;
      } catch { child.kill(); throw new Error("Doppler comparison failed; no secret values were printed or saved"); } finally { clearTimeout(timer); }
    };
    const current = await download(selection), target = await download(dopplerSelection(other));
    console.log(JSON.stringify({ added: Object.keys(target).filter(k => !Object.hasOwn(current, k)), removed: Object.keys(current).filter(k => !Object.hasOwn(target, k)), changed: Object.keys(current).filter(k => Object.hasOwn(target, k) && current[k] !== target[k]) }, null, 2)); return 0;
  }
  if (action === "login") return run(["login", ...rest], root);
  if (action === "setup") return run(["setup", ...selection, ...rest], root);
  if (action === "list") return run(["secrets", "--only-names", ...selection], root);
  if (action === "get") {
    if (rest.length !== 2 || !keyName.test(rest[0]) || rest[1] !== "--reveal") throw new Error("Use optz env get NAME --reveal to explicitly print a value");
    return run(["secrets", "get", rest[0], "--plain", ...selection], root);
  }
  if (action === "set" || action === "delete") {
    if ((action === "set" ? rest.length !== 1 : rest.length !== 2 || rest[1] !== "--confirm") || !keyName.test(rest[0])) throw new Error(`Use optz env ${action} NAME${action === "set" ? " and provide the value on stdin" : " --confirm"}`);
    const code = await run(["secrets", action, rest[0], ...(action === "delete" ? ["--yes"] : []), ...selection], root, { privateOutput: true });
    if (code) throw new Error(`Doppler ${action} failed (exit ${code}); no values were printed`);
    console.log(`${rest[0]} ${action === "set" ? "updated" : "deleted"}.`); return 0;
  }
  if (action === "doppler") return run([...rest, ...selection], root);
  throw new Error("Unknown environment command; run optz env help");
}
