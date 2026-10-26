#!/usr/bin/env bun
// optz <command>
//   dev            develop with live reload (http://127.0.0.1:3001)
//   build          production build into dist/ (--compile: also a single executable,
//                  --target edge: also an edge worker)
//   start          serve dist/ (PORT and HOST env vars override optz.config.ts)
//   export         static site in dist/static for any static host (no server features)
//   check          generate route types and type-check the project (tsc)
//   nginx [dir]    print an nginx config for this app (dir: where dist/ is deployed)
//   create <dir>   start a new app
import { existsSync, watch } from "node:fs";
import { join, resolve } from "node:path";
import type { Subprocess } from "bun";
import { resolveConfig, type Config, type ResolvedConfig } from "./types";

const root = process.cwd();
const [cmd, ...args] = process.argv.slice(2);
// React picks its production build from NODE_ENV; `optz start` and `build` must never run the
// development one (several times slower, and noisy).
if (cmd !== "dev" && cmd !== "__dev-child") process.env.NODE_ENV ??= "production";
else process.env.NODE_ENV ??= "development";

async function loadConfig(): Promise<ResolvedConfig> {
  for (const f of ["optz.config.ts", "optz.config.js"]) {
    if (existsSync(join(root, f))) return resolveConfig(((await import(join(root, f))).default ?? {}) as Config);
  }
  return resolveConfig({});
}

switch (cmd) {
  case "build": {
    const { build } = await import("./build");
    const config = await loadConfig();
    const manifest = await build({ root, config });
    const target = args.find((a) => a.startsWith("--target="))?.slice(9) ?? (args.includes("--target") ? args[args.indexOf("--target") + 1] : undefined);
    if (args.includes("--compile") || target === "edge") {
      const { buildServerBundle } = await import("./server-bundle");
      if (args.includes("--compile")) await buildServerBundle({ root, config, manifest, target: "bun" });
      if (target === "edge") await buildServerBundle({ root, config, manifest, target: "edge" });
    }
    break;
  }
  case "export": {
    const { build } = await import("./build");
    const m = await build({ root, config: await loadConfig(), exportOnly: true });
    const shells = m.routes.filter((r) => r.shell);
    console.log(`optz: static site in ${join(root, "dist/static")}`);
    if (shells.length) {
      console.log("Client-rendered routes need a rewrite on the static host, e.g. nginx:");
      for (const r of shells) {
        const re = r.segments.map((s) => (s.kind === "static" ? s.value : s.kind === "param" ? "[^/]+" : ".+")).join("/");
        console.log(`  location ~ ^/${re}$ { try_files ${r.shell} =404; }`);
      }
    }
    break;
  }
  case "start": {
    const { serve } = await import("./server");
    if (!existsSync(join(root, "dist/manifest.json"))) {
      console.error("optz: no build found. Run `optz build` first.");
      process.exit(1);
    }
    await serve({ root, config: await loadConfig() });
    break;
  }
  case "check": {
    const { writeTypes } = await import("./codegen");
    const { scanApi, scanRoutes } = await import("./routes");
    const config = await loadConfig();
    writeTypes(root, scanRoutes(join(root, "app/routes")).routes, config.features.api ? scanApi(join(root, "app/api")) : []);
    const tsPkg = Bun.resolveSync("typescript/package.json", import.meta.dir);
    const tsc = join(tsPkg, "..", (JSON.parse(await Bun.file(tsPkg).text()) as { bin: { tsc: string } }).bin.tsc);
    const p = Bun.spawnSync([process.execPath, tsc, "--noEmit", "-p", "tsconfig.json"], { cwd: root, stdio: ["inherit", "inherit", "inherit"] });
    if (p.exitCode === 0) console.log("optz: types ok");
    process.exit(p.exitCode ?? 1);
  }
  case "nginx": {
    const { nginxConfig } = await import("./nginx");
    process.stdout.write(nginxConfig(await loadConfig(), { distDir: args[0] ?? join(root, "dist") }));
    break;
  }
  case "__dev-child": {
    const { build } = await import("./build");
    const { serve } = await import("./server");
    const config = await loadConfig();
    try {
      await build({ root, config, dev: true });
    } catch (e) {
      console.error("optz: build failed:\n", e);
    }
    await serve({ root, config, dev: true, port: Number(process.env.PORT ?? config.port ?? 3001) });
    break;
  }
  case "dev": {
    // The child builds and serves; any change restarts it. Browsers reconnect and reload.
    let child: Subprocess | null = null;
    const spawn = () => {
      child = Bun.spawn([process.execPath, import.meta.path, "__dev-child"], { cwd: root, stdio: ["inherit", "inherit", "inherit"], env: process.env });
    };
    spawn();
    let timer: Timer | undefined;
    const ignored = /(^|[/\\])(node_modules|dist|\.optz|\.git|target)([/\\]|$)/;
    watch(root, { recursive: true }, (_e, file) => {
      if (!file || ignored.test(file)) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        console.log(`optz: ${file} changed, restarting`);
        child?.kill();
        await child?.exited;
        spawn();
      }, 80);
    });
    process.on("SIGINT", () => {
      child?.kill();
      process.exit(0);
    });
    break;
  }
  case "create": {
    const { create } = await import("./create");
    const dir = args[0];
    if (!dir) {
      console.error("usage: optz create <dir>");
      process.exit(2);
    }
    create(resolve(dir));
    break;
  }
  default:
    console.log(`optz: a small, fast React framework for Bun

  optz dev            develop with live reload
  optz build          production build into dist/
                      --compile       also dist/server, a single executable
                      --target edge   also dist/edge/worker.js (Workers, Deno, Vercel Edge)
  optz start          serve the build (PORT/HOST env vars override optz.config.ts)
  optz export         static site in dist/static (no server features)
  optz check          generate route types and type-check (tsc)
  optz nginx [dir]    print an nginx config (dir: deployed dist/ path)
  optz create <dir>   start a new app`);
    if (cmd) process.exit(2);
}
