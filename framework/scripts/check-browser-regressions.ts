// Runs in the browser CI job: NODE_PATH=/tmp/pw/node_modules bun framework/scripts/check-browser-regressions.ts
// Virtual fixtures bundle the real runtimes and intercept network I/O; no test server is needed.
import assert from "node:assert/strict";
import { join } from "node:path";
const { chromium } = require("playwright");
const origin = "https://regression.test";
const root = join(import.meta.dir, "../..");

async function bundle(source: string, inspectPrefetch = false) {
  const result = await Bun.build({
    entrypoints: ["fixture:entry"], target: "browser", format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "fixture", setup(build) {
      build.onResolve({ filter: /^fixture:/ }, () => ({ path: "entry", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: source, loader: "tsx", resolveDir: root }));
      if (inspectPrefetch) build.onLoad({ filter: /\/src\/islands\.ts$/ }, async ({ path }) => ({
        contents: await Bun.file(path).text() + "\nwindow.testPrefetch = fetchHtml; window.testCache = () => [...prefetched.values()].map(e => ({at:e.at,size:e.size}));",
        loader: "ts",
      }));
    } }],
  });
  if (!result.success) throw new AggregateError(result.logs);
  return result.outputs[0].text();
}
const html = (text: string, css = "") => `<!doctype html><html lang="en"><head><title>${text}</title>${css ? `<link rel="stylesheet" href="${origin}/${css}">` : ""}</head><body><div id="__optz"><main id="main">${text}</main></div><script id="__optz_boot" type="application/json">{}</script></body></html>`;

const browser = await chromium.launch();
try {
  // Query strings reach loaders on navigation, hash navigation, prefetch, and cached variants.
  const spa = await browser.newPage();
  const requests: string[] = [];
  const spaHtml = `<!doctype html><title>initial</title><div id="__optz"><main id="main"><h1>initial</h1><a href="/static?q=prefetched">Next</a><div id="target"></div></main></div><script id="__optz_boot" type="application/json">{"pattern":"/search","params":{},"data":{"q":"initial"}}</script>`;
  await spa.route(origin + "/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/_optz/data/")) {
      requests.push(url.pathname + url.search);
      const q = url.searchParams.get("q") ?? "missing";
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { q }, head: { title: q } }) });
    } else await route.fulfill({ contentType: "text/html", body: spaHtml });
  });
  await spa.goto(origin + "/search");
  await spa.addScriptTag({ content: await bundle(`
    import React from 'react';
    import { start, Link } from './framework/src/runtime';
    import { compilePattern } from './framework/src/match';
    const Page = ({data}) => <main id="main"><h1>{data.q}</h1><Link href="/static?q=prefetched">Next</Link><div id="target" /></main>;
    start(['/search','/static'].map(pattern => ({pattern,segments:compilePattern(pattern),render:pattern==='/static'?'static':'dynamic',hasLoader:true,load:async()=>({default:Page}),layouts:[]})));
  `) });
  await spa.waitForFunction(() => !!window.__optz);
  await spa.evaluate(() => window.__optz.navigate("/search?q=first"));
  await spa.waitForFunction(() => document.querySelector("h1")?.textContent === "first");
  await spa.evaluate(() => window.__optz.navigate("/search?q=second#target"));
  await spa.waitForFunction(() => document.querySelector("h1")?.textContent === "second");
  assert(requests.includes("/_optz/data/search.json?q=second"));
  await spa.locator("a").hover();
  await spa.waitForFunction(() => document.querySelector("a"));
  await spa.locator("a").click();
  await spa.waitForFunction(() => document.querySelector("h1")?.textContent === "prefetched");
  assert.equal(requests.filter(url => url === "/_optz/data/static.json?q=prefetched").length, 1);
  await spa.evaluate(() => window.__optz.navigate("/static?q=other"));
  await spa.waitForFunction(() => document.querySelector("h1")?.textContent === "other");
  await spa.evaluate(() => window.__optz.navigate("/static?q=prefetched"));
  await spa.waitForFunction(() => document.querySelector("h1")?.textContent === "prefetched");
  assert.equal(requests.filter(url => url === "/_optz/data/static.json?q=prefetched").length, 1);
  await spa.close();
  console.log("ok SPA queries survive navigation, hash changes, prefetch and cached variants");

  // A superseded page must not commit after its stylesheet finally loads.
  const islands = await browser.newPage();
  let releaseCss!: () => void, sawCss!: () => void;
  const cssGate = new Promise<void>(resolve => { releaseCss = resolve; });
  const cssSeen = new Promise<void>(resolve => { sawCss = resolve; });
  await islands.route(origin + "/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/slow.css") {
      sawCss(); await cssGate;
      await route.fulfill({ contentType: "text/css", body: "main { color: black }" });
    } else await route.fulfill({ contentType: "text/html", body: html(path.slice(1) || "start", path === "/slow" ? "slow.css" : "") });
  });
  await islands.goto(origin + "/start");
  await islands.addScriptTag({ content: await bundle(`
    import {startIslands,navigate,refresh} from './framework/src/islands';
    document.startViewTransition=undefined;
    startIslands({}, {navigation:true,prefetch:false});
    window.nav=navigate; window.reloadPage=refresh; window.events=[];
    addEventListener('optz:navigate',e=>window.events.push(e.detail.url));
  `, true) });
  await islands.evaluate(() => { window.slow = window.nav("/slow"); });
  await cssSeen;
  await islands.evaluate(() => window.nav("/fast"));
  releaseCss();
  await islands.evaluate(() => window.slow);
  assert.equal(await islands.locator("main").textContent(), "fast");
  assert.equal(await islands.title(), "fast");
  assert.equal(new URL(islands.url()).pathname, "/fast");
  assert.deepEqual(await islands.evaluate(() => window.events), [origin + "/fast"]);
  assert.equal(await islands.evaluate(() => document.documentElement.classList.contains("optz-navigating")), false);

  await islands.evaluate(async () => {
    await Promise.all(Array.from({length:100}, (_,i) => window.testPrefetch(`/page-${i}`)));
  });
  assert((await islands.evaluate(() => window.testCache())).length <= 32);
  await islands.evaluate(async () => {
    const now = Date.now;
    Date.now = () => now() + 31_000;
    try { await window.testPrefetch('/fresh'); }
    finally { Date.now = now; }
  });
  assert.equal((await islands.evaluate(() => window.testCache())).length, 1);
  await islands.route(origin + "/large", route => route.fulfill({ contentType: "text/html", body: "x".repeat(2_000_001) }));
  await islands.evaluate(() => window.testPrefetch("/large"));
  assert((await islands.evaluate(() => window.testCache())).reduce((n, entry) => n + entry.size, 0) <= 2_000_000);
  await islands.close();
  console.log("ok islands ignore superseded stylesheet waits and bound prefetch age, count and size");

  // A failed search index request can be retried without reloading the document.
  const search = await browser.newPage();
  let attempts = 0;
  await search.route(origin + "/**", async route => {
    if (new URL(route.request().url()).pathname === "/api/docs") {
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ docs: [{slug:"framework",title:"Framework",section:"Learn",description:"Guide",headings:[]}] }) });
    }
    await route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
  });
  await search.goto(origin);
  await search.addScriptTag({ content: await bundle(`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Search from './portfolio/app/components/DocsSearch.island';
    createRoot(document.getElementById('root')).render(<Search/>);
  `) });
  await search.locator("input").fill("Framework");
  await search.getByRole("button", { name: "Retry" }).waitFor();
  assert.match(await search.getByRole("status").textContent(), /unavailable/);
  assert.equal(attempts, 1);
  await search.getByRole("button", { name: "Retry" }).click();
  await search.getByRole("option").waitFor();
  assert.equal(attempts, 2);
  await search.locator("input").fill("nothing matches");
  await search.locator("input").press("ArrowDown");
  await search.locator("input").fill("Framework");
  assert.equal(await search.locator("input").getAttribute("aria-activedescendant"), "docs-hit-0");
  await search.close();
  console.log("ok docs search reports failures, retries and restores keyboard selection");
} finally { await browser.close(); }
