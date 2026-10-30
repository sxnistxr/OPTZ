import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkEnvManifest, readEnv } from "../src/env";
import { dopplerRunArgs, dopplerSelection, generateEnvironment } from "../src/env-cli";

test("environment contracts parse types and redact all validation values", () => {
  const values = readEnv({ COUNT: { type: "number" }, ENABLED: { type: "boolean" }, MODE: { values: ["dev", "prod"] }, OPTIONAL: { optional: true }, DEFAULT: { default: "ready" } }, { COUNT: "4", ENABLED: "false", MODE: "dev" });
  expect(values.COUNT).toBe(4); expect(values.ENABLED).toBe(false); expect(values.OPTIONAL).toBeUndefined(); expect(values.DEFAULT).toBe("ready"); expect(Object.isFrozen(values)).toBe(true);
  const error = (() => { try { readEnv({ URL: { type: "url" } }, { URL: "PRIVATE_BAD_VALUE" }); } catch (e) { return e as Error; } })();
  expect(error?.message).toContain("URL"); expect(error?.message).not.toContain("PRIVATE_BAD_VALUE");
  expect(() => checkEnvManifest({ variables: { TOKEN: { public: true } } })).toThrow("PUBLIC_");
  expect(() => readEnv({ MISSING: {} }, {})).toThrow("required");
  expect(() => readEnv({ N: { type: "number" } }, { N: "Infinity" })).toThrow();
});
test("Doppler selection is mode-aware, fail-closed in production and never shell-concatenated", () => {
  const manifest = { doppler: { project: "app", config: { development: "dev_personal", production: "prd" }, watch: true, preserve: ["PORT"] }, variables: {} };
  expect(dopplerSelection(manifest, "development")).toEqual(["--project", "app", "--config", "dev_personal"]);
  expect(dopplerRunArgs(manifest, ["bun", "script.ts", "a; echo bad"], "production")).toEqual(["run", "--project", "app", "--config", "prd", "--forward-signals", "--no-fallback", "--preserve-env=PORT", "--", "bun", "script.ts", "a; echo bad"]);
  expect(dopplerRunArgs(manifest, ["bun"], "development")).toContain("--watch");
  expect(() => dopplerSelection(manifest, "test")).toThrow("No Doppler config");
  expect(() => checkEnvManifest({ doppler: { project: "--token=secret" }, variables: {} })).toThrow();
});
test("public generation writes explicit allowed values and declarations contain names only", () => {
  const root = mkdtempSync(join(tmpdir(), "optz-env-"));
  const old = { PRIVATE_FIXTURE: process.env.PRIVATE_FIXTURE, PUBLIC_FIXTURE: process.env.PUBLIC_FIXTURE };
  try {
    process.env.PRIVATE_FIXTURE = "PRIVATE_SENTINEL"; process.env.PUBLIC_FIXTURE = "hello";
    generateEnvironment(root, { variables: { PRIVATE_FIXTURE: {}, PUBLIC_FIXTURE: { public: true } } });
    expect(JSON.parse(readFileSync(join(root, ".optz/env.public.json"), "utf8"))).toEqual({ PUBLIC_FIXTURE: "hello" });
    expect(readFileSync(join(root, ".optz/env.d.ts"), "utf8")).toContain("PRIVATE_FIXTURE");
    expect(readFileSync(join(root, ".optz/env.d.ts"), "utf8")).not.toContain("PRIVATE_SENTINEL");
  } finally { for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(root, { recursive: true, force: true }); }
});
test("real OPTZ CLI uses the provider process once, validates before commands and suppresses write output", async () => {
  const root = mkdtempSync(join(tmpdir(), "optz-doppler-")), cli = join(import.meta.dir, "../src/cli.ts");
  const fake = join(root, "doppler");
  writeFileSync(fake, `#!${process.execPath} --no-env-file\nconst args=process.argv.slice(2);
if(args[0]==="run"){
 const c=args.slice(args.indexOf("--")+1),env={...process.env};
 if(!args.includes("empty"))env.ENV_TEST_SECRET="PRIVATE_SENTINEL";
 const p=Bun.spawn(c,{env,stdio:["inherit","inherit","inherit"]});process.exit(await p.exited);
}else if(args[1]==="set"){console.log("PRIVATE_SENTINEL")}
else if(args[1]==="download"){console.log(JSON.stringify(args.includes("prd")?{VALUE:"PRIVATE_TARGET",ADDED:"PRIVATE_ADDED"}:{VALUE:"PRIVATE_CURRENT"}))}
else{process.exit(0)}`);
  chmodSync(fake, 0o700);
  writeFileSync(join(root, "optz.env.json"), JSON.stringify({ doppler: { project: "fixture", config: "dev" }, variables: { ENV_TEST_SECRET: {} } }));
  const execute = async (args: string[]) => {
    const p = Bun.spawn([process.execPath, cli, "env", ...args], { cwd: root, env: { ...process.env, PATH: `${root}:${process.env.PATH}`, NODE_ENV: "development" }, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const output = await new Response(p.stdout).text() + await new Response(p.stderr).text(); return { code: await p.exited, output };
  };
  try {
    const check = await execute(["check"]); expect(check.code).toBe(0); expect(check.output).toContain("Environment valid"); expect(check.output).not.toContain("PRIVATE_SENTINEL");
    const set = await execute(["set", "ENV_TEST_SECRET"]); expect(set.code).toBe(0); expect(set.output).not.toContain("PRIVATE_SENTINEL");
    const unsafe = await execute(["set", "ENV_TEST_SECRET", "VALUE_IN_ARGV"]); expect(unsafe.code).toBe(1); expect(unsafe.output).not.toContain("VALUE_IN_ARGV");
    const reveal = await execute(["get", "ENV_TEST_SECRET"]); expect(reveal.code).toBe(1); expect(reveal.output).toContain("--reveal");
    const diff = await execute(["diff", "--config", "prd"]); expect(diff.code).toBe(0); expect(diff.output).toContain("ADDED"); expect(diff.output).toContain("VALUE"); expect(diff.output).not.toContain("PRIVATE_");
    writeFileSync(join(root, ".env"), "ENV_TEST_SECRET=STALE_DOTENV_VALUE\n");
    writeFileSync(join(root, "optz.env.json"), JSON.stringify({ doppler: { project: "fixture", config: "empty" }, variables: { ENV_TEST_SECRET: {} } }));
    const missing = await execute(["check"]); expect(missing.code).toBe(1); expect(missing.output).toContain("required"); expect(missing.output).not.toContain("STALE_DOTENV_VALUE");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
