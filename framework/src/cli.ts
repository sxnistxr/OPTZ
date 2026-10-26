#!/usr/bin/env bun
// optz <command>
//   dev            develop with live reload (http://127.0.0.1:3001)
//   build          production build into dist/
//   start          serve dist/ (PORT and HOST env vars override optz.config.ts)
//   export         build a static site into dist/static for any static host (no server features)
//   create <dir>   start a new app
import { existsSync, watch } from "node:fs";
import { join, resolve } from "node:path";
import type { Subprocess } from "bun";
import type { Config } from "./types";

const root = process.cwd();

async function loadConfig(): Promise<Config> {
  for (const f of ["optz.config.ts", "optz.config.js"]) {
    if (existsSync(join(root, f))) return ((await import(join(root, f))).default ?? {}) as Config;
  }
  return {};
}

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "build": {
    const { build } = await import("./build");
    await build({ root, config: await loadConfig() });
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
        const re = "^" + r.segments.map((s) => (s.kind === "static" ? s.value : s.kind === "param" ? "[^/]+" : ".+")).join("/") + "$";
        console.log(`  location ~ ^/${re.slice(1)} { try_files ${r.shell} =404; }`);
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
  case "__dev-child": {
    const { build } = await import("./build");
    const { serve } = await import("./server");
    const config = await loadConfig();
    try {
      await build({ root, config, dev: true });
    } catch (e) {
      console.error("optz: build failed:\n", e);
      // Keep a server up so the browser can reconnect after the next save.
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
    const ignored = /(^|[/\\])(node_modules|dist|\.optz|\.git)([/\\]|$)/;
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
  optz start          serve the build (PORT/HOST env vars override optz.config.ts)
  optz export         static site in dist/static (no server features)
  optz create <dir>   start a new app`);
    if (cmd) process.exit(2);
}
