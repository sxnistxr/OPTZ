// `optz create <dir>`: a small app that shows every feature once.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

export function create(dir: string) {
  if (existsSync(dir) && readdirSync(dir).length) {
    console.error(`optz: ${dir} isn't empty`);
    process.exit(1);
  }
  const frameworkDir = join(import.meta.dir, "..");
  // Inside this repo's workspace (apps/*), depend on the workspace copy; elsewhere, by path.
  const inWorkspace = basename(dirname(dir)) === "apps" && existsSync(join(dirname(dirname(dir)), "framework/package.json"));
  const optzDep = inWorkspace ? "workspace:*" : `file:${relative(dir, frameworkDir)}`;

  const files: Record<string, string> = {
    "package.json": JSON.stringify(
      {
        name: basename(dir),
        private: true,
        type: "module",
        scripts: { dev: "optz dev", build: "optz build", start: "optz start", check: "optz check" },
        dependencies: { optz: optzDep, react: "19.3.1", "react-dom": "19.3.1" },
        devDependencies: { "@types/bun": "1.4.4", "@types/react": "19.3.0", "@types/react-dom": "19.3.0" },
      },
      null,
      2,
    ),
    ".gitignore": "dist/\n.optz/\nnode_modules/\n",
    "tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "react-jsx",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          types: ["bun"],
          paths: { "$lib/*": ["./app/lib/*"], "$components/*": ["./app/components/*"] },
        },
        include: ["app", "optz.config.ts", ".optz/types.d.ts"],
      },
      null,
      2,
    ),
    "optz.config.ts": `import { defineConfig } from "optz";

// Every option is optional; hover one in your editor for its docs.
export default defineConfig({
  port: 3001,
  // Forward a prefix to another server (your API), e.g.:
  // proxy: { "/api/backend": { target: "http://127.0.0.1:3000", strip: true } },
  client: {
    mode: "islands", // pages are HTML; only *.island.tsx components ship JS ("spa" hydrates everything)
    navigation: true, // swap pages without full reloads (~2 KB)
    prefetch: true,
    runtime: "react", // "preact": islands ship ~4 KB instead of ~60 KB, same React API
  },
  features: {
    middleware: true,
    dynamic: true, // per-request rendering; off = React's server renderer never loads at runtime
    api: true,
    cache: true,
  },
  cache: { maxEntries: 500, maxBytes: 32 << 20 },
  server: { idleTimeout: 30, maxRequestBodySize: 1 << 20 },
});
`,
    "app/styles.css": `@import "tailwindcss";
@source ".";
`,
    "app/lib/greeting.ts": `// Anything in app/lib is importable as $lib/...
export const greeting = (name: string) => \`Hello, \${name}.\`;
`,
    "app/middleware.ts": `import { defineMiddleware } from "optz";

// Runs before every page, data and API request. Call next() to continue; change or replace
// the response; put values in ctx.locals for loaders and API routes.
export default defineMiddleware(async (ctx, next) => {
  const started = performance.now();
  ctx.locals.requestId = crypto.randomUUID();
  const res = await next();
  res.headers.set("X-Request-Id", String(ctx.locals.requestId));
  res.headers.set("Server-Timing", \`app;dur=\${(performance.now() - started).toFixed(1)}\`);
  return res;
});
`,
    "app/components/Counter.island.tsx": `import { useState } from "react";

// An island: the only part of the page that ships JavaScript. Hydrates when scrolled into view.
export const hydrate = "visible";

export default function Counter({ start = 0 }: { start?: number }) {
  const [n, setN] = useState(start);
  return (
    <button className="rounded border px-3 py-1" onClick={() => setN(n + 1)}>
      Clicked {n} times
    </button>
  );
}
`,
    "app/routes/_layout.tsx": `import { Link } from "optz";
import type { ReactNode } from "react";

export const head = () => ({ title: "My optz app" });

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl p-6 font-sans">
      <nav className="mb-8 flex gap-4 text-sm">
        <Link href="/">Home</Link>
        <Link href="/about">About</Link>
        <Link href="/users/ada">Ada</Link>
        <Link href="/time">Server time</Link>
      </nav>
      <main>{children}</main>
    </div>
  );
}
`,
    "app/routes/index.tsx": `import type { PageProps } from "optz";
import Counter from "$components/Counter.island";
import { greeting } from "$lib/greeting";

// Static (the default): rendered once at build time. The loader never reaches the browser.
export const loader = () => ({ message: greeting("world"), builtAt: new Date().toISOString() });

export default function Home({ data }: PageProps<{ message: string; builtAt: string }>) {
  return (
    <>
      <h1 className="text-3xl font-semibold">{data.message}</h1>
      <p className="mt-2 text-gray-500">Built at {data.builtAt}.</p>
      <div className="mt-6">
        <Counter start={1} />
      </div>
    </>
  );
}
`,
    "app/routes/about.tsx": `export const head = () => ({ title: "About", description: "What this app is." });

export default function About() {
  return <h1 className="text-3xl font-semibold">About</h1>;
}
`,
    "app/routes/users/[name].tsx": `import type { LoaderContext, PageProps } from "optz";

// A static page with a parameter: paths() lists the pages to build.
export const paths = () => [{ name: "ada" }, { name: "grace" }];
export const loader = ({ params }: LoaderContext) => ({ name: params.name });
export const head = (d: { name: string }) => ({ title: \`User \${d.name}\` });

export default function User({ data }: PageProps<{ name: string }, "/users/[name]">) {
  return <h1 className="text-3xl font-semibold">User {data.name}</h1>;
}
`,
    "app/routes/time.tsx": `import type { LoaderContext, PageProps } from "optz";

// Dynamic: rendered on every request; the loader sees the request and middleware locals.
// Cached for 2 s: under load, at most one render per 2 s, everyone else gets it from memory.
export const config = { render: "dynamic" } as const;
export const cache = { maxAge: 2, staleWhileRevalidate: 10 };
export const loader = ({ request, locals }: LoaderContext) => ({
  now: new Date().toISOString(),
  requestId: String(locals.requestId),
  agent: request?.headers.get("user-agent") ?? "",
});

export default function Time({ data }: PageProps<{ now: string; requestId: string; agent: string }>) {
  return (
    <>
      <h1 className="text-3xl font-semibold">Server time</h1>
      <p className="mt-2">{data.now}</p>
      <p className="mt-2 text-sm text-gray-500">Request {data.requestId}</p>
    </>
  );
}
`,
    "app/routes/old-about.tsx": `import { redirect } from "optz";

// Redirects work from any loader: throw redirect(...).
export const loader = () => {
  throw redirect("/about", 301);
};
export default function OldAbout() {
  return null;
}
`,
    "app/api/hello.ts": `import { handler, json, type ApiContext, type HandlerContext } from "optz";

// API route: app/api/hello.ts answers /api/hello. Return types flow to the typed client:
//   import { api } from "optz";  const r = await api("/api/hello", { query: { name: "Ada" } });  // r.hello: string
export const GET = ({ url, locals }: ApiContext) => json({ hello: url.searchParams.get("name") ?? "world", requestId: String(locals.requestId) });

// handler() + HandlerContext<Params, Body> types the request body for both sides.
export const POST = handler(async ({ body }: HandlerContext<{}, { message: string }>) => json({ received: (await body()).message }, { status: 201 }));
`,
    "app/routes/_404.tsx": `export default function NotFound() {
  return <h1 className="text-3xl font-semibold">Page not found</h1>;
}
`,
    "public/robots.txt": "User-agent: *\nAllow: /\n",
  };
  for (const [f, content] of Object.entries(files)) {
    const p = join(dir, f);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  console.log(`optz: created ${dir}

  cd ${relative(process.cwd(), dir) || "."}
  bun install
  bun run dev`);
}
