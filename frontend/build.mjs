// Builds the static site into dist/: pages from templates and content/, CSS with Tailwind.
//   node build.mjs
// Blog posts are content/blog/<slug>.md with a small front matter block (title, date, summary).
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const site = JSON.parse(readFileSync(join(root, "content/site.json"), "utf8"));

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmtDate = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

function frontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) throw new Error("missing front matter");
  const meta = Object.fromEntries(
    m[1].split("\n").filter(Boolean).map((l) => {
      const i = l.indexOf(":");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );
  return { meta, body: text.slice(m[0].length) };
}

const posts = readdirSync(join(root, "content/blog"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => {
    const { meta, body } = frontMatter(readFileSync(join(root, "content/blog", f), "utf8"));
    for (const k of ["title", "date"]) if (!meta[k]) throw new Error(`${f}: missing ${k}`);
    return { slug: f.replace(/\.md$/, ""), ...meta, html: marked.parse(body) };
  })
  .sort((a, b) => b.date.localeCompare(a.date));

const nav = [
  ["/", "Home"],
  ["/blog/", "Writing"],
  ["/social/", "Feed"],
];

function layout({ title, description, current, body, scripts = [] }) {
  const navLinks = nav
    .map(([href, label]) => {
      const here = current === href;
      return `<a href="${href}" ${here ? 'aria-current="page"' : ""} class="py-1 ${
        here ? "text-ink font-medium" : "text-muted hover:text-ink"
      }">${label}</a>`;
    })
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Schibsted+Grotesk:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/assets/site.css">
</head>
<body class="min-h-dvh">
<a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 bg-paper px-3 py-2">Skip to content</a>
<div class="mx-auto max-w-5xl px-4 py-8 sm:px-8 md:grid md:grid-cols-[9rem_minmax(0,1fr)] md:gap-14 md:py-16">
  <header class="mb-10 flex items-baseline justify-between gap-6 md:mb-0 md:block">
    <a href="/" class="font-semibold tracking-tight text-ink">${esc(site.name)}</a>
    <nav aria-label="Site" class="flex gap-5 text-[0.95rem] md:mt-8 md:flex-col md:gap-1">${navLinks}</nav>
  </header>
  <main id="main" class="min-w-0">
${body}
  </main>
</div>
${scripts.map((s) => `<script type="module" src="${s}"></script>`).join("\n")}
</body>
</html>
`;
}

const postList = (items) => `<ol class="space-y-7">
${items
  .map(
    (p) => `  <li>
    <a href="/blog/${p.slug}/" class="group block">
      <span class="block text-lg font-semibold leading-snug tracking-tight group-hover:underline group-hover:decoration-rule group-hover:underline-offset-4">${esc(p.title)}</span>
      ${p.summary ? `<span class="mt-1 block max-w-[36rem] text-muted">${esc(p.summary)}</span>` : ""}
      <time datetime="${p.date}" class="mt-1 block text-sm text-muted">${fmtDate(p.date)}</time>
    </a>
  </li>`,
  )
  .join("\n")}
</ol>`;

const pulse = `<section aria-label="Live server status" class="mt-10 border-l-2 border-rule pl-5" data-pulse>
      <p class="flex items-center gap-2.5 text-sm text-muted"><span class="signal-dot" data-state="idle" data-pulse-dot></span><span data-pulse-state>Checking the server</span></p>
      <p class="mt-2 text-2xl leading-snug tracking-tight md:text-3xl">The server behind this page answered in <strong class="font-semibold tabular-nums" data-pulse-ms>…</strong>.</p>
      <p class="mt-1 text-muted">It has been up for <span class="tabular-nums text-ink" data-pulse-uptime>…</span>, on one CPU core and 2 GB of memory.</p>
    </section>`;

const pages = {};

pages["index.html"] = layout({
  title: site.title,
  description: site.about,
  current: "/",
  scripts: ["/assets/social.js"],
  body: `    <h1 class="text-5xl font-semibold leading-[1.02] tracking-[-0.03em] md:text-7xl">${esc(site.name)}</h1>
    <p class="mt-6 max-w-[36rem] text-lg leading-relaxed md:text-xl">${esc(site.about)}</p>
    <p class="mt-4 flex gap-5">${site.links.map((l) => `<a class="underline decoration-rule underline-offset-4 hover:decoration-ink" href="${esc(l.href)}">${esc(l.label)}</a>`).join("")}</p>
    ${pulse}

    <section class="mt-20" aria-labelledby="writing">
      <h2 id="writing" class="mb-6 text-sm font-medium text-muted">Writing</h2>
      ${postList(posts.slice(0, 5))}
    </section>

    <section class="mt-20" aria-labelledby="feed">
      <h2 id="feed" class="mb-6 text-sm font-medium text-muted">Latest on the feed</h2>
      <ol data-feed data-limit="5" class="max-w-[40rem] divide-y divide-rule border-y border-rule"></ol>
      <p class="mt-5"><a href="/social/" class="underline decoration-rule underline-offset-4 hover:decoration-ink">Open the feed</a></p>
    </section>`,
});

pages["blog/index.html"] = layout({
  title: `Writing | ${site.title}`,
  description: `Writing by ${site.name}.`,
  current: "/blog/",
  body: `    <h1 class="text-4xl font-semibold tracking-[-0.02em] md:text-5xl">Writing</h1>
    <p class="mt-4 max-w-[36rem] text-muted">Notes from building fast things on small machines.</p>
    <div class="mt-12">${postList(posts)}</div>`,
});

for (const p of posts) {
  pages[`blog/${p.slug}/index.html`] = layout({
    title: `${p.title} | ${site.title}`,
    description: p.summary || p.title,
    current: "/blog/",
    body: `    <article>
      <header class="max-w-[38rem]">
        <time datetime="${p.date}" class="text-sm text-muted">${fmtDate(p.date)}</time>
        <h1 class="mt-2 text-4xl font-semibold leading-[1.08] tracking-[-0.02em] md:text-5xl">${esc(p.title)}</h1>
      </header>
      <div class="prose-post mt-10">
${p.html}
      </div>
      <p class="mt-14"><a href="/blog/" class="text-muted hover:text-ink">All writing</a></p>
    </article>`,
  });
}

pages["social/index.html"] = layout({
  title: `Feed | ${site.title}`,
  description: "A small social network running on a $12 server.",
  current: "/social/",
  scripts: ["/assets/social.js"],
  body: `    <h1 class="text-4xl font-semibold tracking-[-0.02em] md:text-5xl">Feed</h1>
    <p class="mt-4 max-w-[36rem] text-muted">A small social network running on the same $12 server as this site. Anyone can read it. Posting and liking need a token.</p>

    <section class="mt-10 max-w-[38rem]" aria-label="Your token" data-auth></section>

    <form class="mt-6 max-w-[38rem]" data-compose hidden>
      <label for="compose-body" class="text-sm font-medium">Write a post</label>
      <textarea id="compose-body" name="body" rows="3" maxlength="500" required
        class="mt-2 block w-full resize-y rounded-md border border-rule bg-paper px-3 py-2.5 text-[1.05rem] leading-relaxed placeholder:text-muted focus:border-ink focus:outline-none"
        placeholder="What are you working on?"></textarea>
      <div class="mt-2 flex items-center justify-between gap-4">
        <span class="text-sm text-muted tabular-nums" data-count>0 of 500</span>
        <button class="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50">Post</button>
      </div>
      <p class="mt-2 text-sm text-[#c2483d]" data-compose-error role="alert"></p>
    </form>

    <section class="mt-12" aria-labelledby="newest">
      <div class="mb-4 flex max-w-[40rem] items-baseline justify-between gap-4">
        <h2 id="newest" class="text-sm font-medium text-muted">Newest 20 posts</h2>
        <button class="text-sm text-muted underline decoration-rule underline-offset-4 hover:text-ink" data-refresh>Load newest</button>
      </div>
      <ol data-feed data-limit="20" class="max-w-[40rem] divide-y divide-rule border-y border-rule"></ol>
    </section>`,
});

pages["social/post/index.html"] = layout({
  title: `Post | ${site.title}`,
  description: "A post on the feed.",
  current: "/social/",
  scripts: ["/assets/social.js"],
  body: `    <p><a href="/social/" class="text-muted hover:text-ink">Back to the feed</a></p>
    <ol data-single class="mt-8 max-w-[40rem] divide-y divide-rule border-y border-rule"></ol>`,
});

pages["404.html"] = layout({
  title: `Not found | ${site.title}`,
  description: "Page not found.",
  current: "",
  body: `    <h1 class="text-4xl font-semibold tracking-[-0.02em]">This page doesn't exist</h1>
    <p class="mt-4 text-muted">Check the address, or start from the <a class="underline decoration-rule underline-offset-4" href="/">home page</a>.</p>`,
});

rmSync(dist, { recursive: true, force: true });
for (const [path, html] of Object.entries(pages)) {
  mkdirSync(dirname(join(dist, path)), { recursive: true });
  writeFileSync(join(dist, path), html);
}
cpSync(join(root, "public"), dist, { recursive: true });
mkdirSync(join(dist, "assets"), { recursive: true });
cpSync(join(root, "src/social.js"), join(dist, "assets/social.js"));
execFileSync(
  join(root, "node_modules/.bin/tailwindcss"),
  ["-i", join(root, "src/styles.css"), "-o", join(dist, "assets/site.css"), "--minify"],
  { stdio: ["ignore", "ignore", "inherit"] },
);
console.log(`built ${Object.keys(pages).length} pages, ${posts.length} posts -> dist/`);
