// Browser checks for dihlabs.lol. Needs a built, running site:
//   bun run build && bun run start &   then   node e2e.cjs http://127.0.0.1:3001
const { chromium } = require("playwright");

const base = process.argv[2] ?? "http://127.0.0.1:3001";
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  " + String(detail).slice(0, 300)}`);

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  pg.on("console", (m) => (m.type() === "error" || m.type() === "warning") && !m.text().startsWith("Failed to load resource") && errs.push(m.text()));
  pg.on("response", (r) => r.status() >= 400 && !r.url().endsWith("/social") && errs.push(`${r.status()} ${r.url()}`));
  const docs = [];
  pg.on("request", (r) => r.resourceType() === "document" && docs.push(r.url()));
  // Chromium supports speculation rules, so the site navigates with real (prerendered) page
  // loads there. This page turns them off to test the HTML-swap fallback other browsers use;
  // the speculation path is checked on its own page below.
  await pg.route("**/_optz/speculation.json", (r) => r.fulfill({ contentType: "application/speculationrules+json", body: "{}" }));
  await pg.addInitScript(() => {
    const s = HTMLScriptElement.supports;
    HTMLScriptElement.supports = (t) => t !== "speculationrules" && s.call(HTMLScriptElement, t);
  });

  // ---- home ----
  await pg.goto(base + "/");
  await pg.waitForTimeout(1200);
  check("home: brand and tagline", (await pg.textContent("h1")) === "dihlabs.lol" && (await pg.textContent("main")).includes("A dev lab by sxnistxr"));
  check("home: live timing island hydrated", (await pg.textContent('section[aria-label="Live server status"]')).includes(" ms"));
  check("home: the lab's experiments", (await pg.locator("#lab ~ ol > li").count()) === 5 && (await pg.textContent("main")).includes("SDXL"));
  check("home: no social feed left", !(await pg.textContent("main")).includes("Latest on the feed"));

  // ---- navigation by HTML swap ----
  const d0 = docs.length;
  await pg.click("nav[aria-label=Site] >> text=Lab");
  await pg.waitForURL(base + "/lab");
  check("lab page via swap", docs.length === d0 && (await pg.textContent("h1")) === "Lab" && (await pg.textContent("main")).includes("LLMs"));
  await pg.click("nav[aria-label=Site] >> text=Docs");
  await pg.waitForURL(base + "/docs");
  check("docs index lists every section", docs.length === d0 && (await pg.locator("main section").count()) === 6);

  // ---- a docs page ----
  await pg.click("main section >> text=Framework reference");
  await pg.waitForURL(base + "/docs/framework");
  await pg.waitForTimeout(300);
  check("docs page via swap, sidebar marks it", docs.length === d0 && (await pg.getAttribute('nav[aria-label=Documentation] a[aria-current="page"]', "href")) === "/docs/framework");
  check("headings have anchors", (await pg.locator("h2#server-actions a.anchor").count()) === 1);
  check("on-this-page links", (await pg.locator('nav[aria-label="On this page"] a[href="#server-actions"]').count()) === 1);
  check("links between docs are rewritten", (await pg.locator('.prose-docs a[href="/docs/vs-nextjs"]').count()) >= 1);
  check("docs title and Open Graph image", (await pg.title()).startsWith("Framework reference") && (await pg.getAttribute('meta[property="og:image"]', "content")).endsWith("/_optz/og/docs/framework.png"));

  // ---- search ----
  await pg.keyboard.press("/");
  check('"/" focuses the search box', await pg.evaluate(() => document.activeElement?.id === "docs-search"));
  await pg.keyboard.type("deploy targets");
  await pg.waitForSelector("#docs-search-results li a");
  const firstHit = await pg.textContent("#docs-search-results li a");
  check("search finds headings", /Deploy targets/.test(firstHit), firstHit);
  await pg.keyboard.type(" zzzz");
  await pg.waitForTimeout(100);
  check("search says when nothing matches", (await pg.textContent("#docs-search-results")).includes("Nothing matches"));
  await pg.fill("#docs-search", "architecture");
  await pg.waitForSelector("#docs-search-results li a");
  await pg.keyboard.press("Enter");
  await pg.waitForURL(/\/docs\/architecture/);
  check("Enter opens the result without a reload", docs.length === d0 && (await pg.textContent("h1")) === "Architecture and tech");
  await pg.click("footer >> text=Next");
  await pg.waitForURL(base + "/docs/contributing");
  check("previous/next links", (await pg.textContent("h1")) === "Contributing");

  // ---- the rest ----
  await pg.goto(base + "/blog/a-close-that-never-closed");
  check("blog post renders", (await pg.textContent("h1")).includes("close"));
  const r = await pg.goto(base + "/social");
  check("the old /social page is gone (404)", r.status() === 404);
  const sm = await (await pg.request.get(base + "/sitemap.xml")).text();
  check("sitemap lists the docs and the lab", sm.includes("/docs/framework") && sm.includes("/lab"));
  const idx = await (await pg.request.get(base + "/api/docs")).json();
  check("search index is prerendered", idx.docs.length >= 16);
  check("no errors under a strict CSP", errs.length === 0, JSON.stringify(errs));

  // ---- speculation rules (Chromium): links prerender, clicks are real navigations ----
  const sp = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const spErrs = [];
  sp.on("pageerror", (e) => spErrs.push(e.message));
  const home = await sp.goto(base + "/");
  check("pages send the Speculation-Rules header", home.headers()["speculation-rules"] === '"/_optz/speculation.json"');
  const rules = await sp.request.get(base + "/_optz/speculation.json");
  check("rules file has the speculation content type", rules.headers()["content-type"].startsWith("application/speculationrules+json") && (await rules.json()).prerender.length === 1);
  check("HTML is cacheable at the CDN", home.headers()["cache-control"].includes("s-maxage="));
  await sp.hover("nav[aria-label=Site] >> text=Lab");
  await sp.waitForTimeout(600);
  await sp.click("nav[aria-label=Site] >> text=Lab");
  await sp.waitForURL(base + "/lab");
  check("speculated navigation lands on the page", (await sp.textContent("h1")) === "Lab" && spErrs.length === 0, JSON.stringify(spErrs));

  // ---- small screens ----
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(base + "/docs/getting-started");
  await m.click("text=Browse the docs");
  check("mobile: the docs menu opens", await m.locator("details[open] >> text=Deployment").isVisible());
  check("mobile: no horizontal page scroll", await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  await b.close();
  console.log(results.join("\n"));
  const failed = results.filter((x) => x.startsWith("FAIL")).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
