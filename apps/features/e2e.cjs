// Browser checks for every feature in this app. Needs a built, running app:
//   bun run build && bun run start &   then   node e2e.cjs http://127.0.0.1:3002
// Also passes against the single executable (optz build --compile) and the edge worker
// (optz build --target edge, in workerd) with UNOPTIMIZED=1.
const { chromium } = require("playwright");

const base = process.argv[2] ?? "http://127.0.0.1:3002";
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  " + String(detail).slice(0, 300)}`);

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  // Failed requests are reported with their URL (the browser's console message has none).
  pg.on("console", (m) => (m.type() === "error" || m.type() === "warning") && !m.text().startsWith("Failed to load resource") && errs.push(m.text()));
  // 422 from an action is an ActionError the page shows on purpose ("write something first").
  pg.on("response", (r) => r.status() >= 400 && !/\/boom$/.test(r.url()) && !(r.status() === 422 && r.url().includes("/_optz/action/")) && errs.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  const docs = [];
  pg.on("request", (r) => r.resourceType() === "document" && docs.push(r.url()));

  // ---- streaming under a strict CSP (React's streaming scripts need the nonce) ----
  await pg.goto(base + "/stream");
  await pg.waitForSelector('[data-testid="b"]');
  check("stream: both Suspense boundaries resolved in place", (await pg.locator('[data-testid="a"]').isVisible()) && !(await pg.locator('[data-testid="fallback-b"]').isVisible()));
  check("stream: no CSP violations or errors", errs.length === 0, JSON.stringify(errs));
  await pg.goto(base + "/slow");
  check("_loading.tsx replaced by the async page", (await pg.textContent('[data-testid="slow"]')) === "slow data" && !(await pg.locator('[data-testid="loading"]').isVisible()));

  // ---- Server Actions from an island, refresh keeps island state ----
  errs.length = 0;
  await pg.goto(base + "/notes");
  await pg.waitForTimeout(300);
  for (let i = 0; i < 3; i++) await pg.click('[data-testid="clicks"]');
  const before = await pg.locator('[data-testid="notes"] > li').count();
  const d0 = docs.length;
  await pg.fill('input[aria-label="island note"]', "from the island");
  await pg.click("text=Add (island)");
  await pg.waitForFunction((n) => document.querySelectorAll('[data-testid="notes"] > li').length === n + 1, before);
  check("action from island: page refreshed with the new note, no reload", docs.length === d0 && (await pg.textContent('[data-testid="notes"]')).includes("from the island"));
  check("refresh kept the island's state", (await pg.textContent('[data-testid="clicks"]')) === "clicked 3", await pg.textContent('[data-testid="clicks"]'));
  check("action return value", (await pg.textContent('[data-testid="msg"]')).startsWith("added #"));
  await pg.click("text=Add (island)");
  await pg.waitForTimeout(300);
  check("ActionError message reaches the island", (await pg.textContent('[data-testid="msg"]')) === "Write something first.");
  await pg.click('[data-testid="count"]');
  await pg.waitForTimeout(300);
  check("action with no arguments", /^count \d+$/.test(await pg.textContent('[data-testid="msg"]')));
  await pg.click('[data-testid="remember"]');
  await pg.waitForTimeout(300);
  check("action set a cookie", (await ctx.cookies()).some((c) => c.name === "name" && c.value === "ada" && c.httpOnly));
  check("notes page: no errors", errs.length === 0, JSON.stringify(errs));

  // ---- the same forms without JavaScript ----
  const nojs = await b.newContext({ javaScriptEnabled: false });
  const np = await nojs.newPage();
  await np.goto(base + "/notes");
  await np.fill('input[aria-label="plain note"]', "posted without js");
  await np.click("text=Add (no JS)");
  await np.waitForURL(base + "/notes");
  check("no-JS form posts to the action and comes back", (await np.textContent('[data-testid="notes"]')).includes("posted without js"));
  await np.fill('input[aria-label="rename 1"]', "renamed without js");
  await np.click("li:first-child >> text=Rename");
  await np.waitForURL(base + "/notes");
  check("no-JS bound action (rename.bind(null, id))", (await np.textContent('[data-testid="notes"] > li:first-child')).includes("renamed without js"));
  await nojs.close();

  // ---- intercepting route in a parallel slot ----
  await pg.goto(base + "/gallery");
  await pg.waitForTimeout(200);
  const d1 = docs.length;
  await pg.click("text=Photo 2");
  await pg.waitForSelector('[data-testid="photo-modal"]');
  check("intercepted: photo opens as a modal over the gallery", (await pg.locator('[data-testid="gallery"]').isVisible()) && pg.url() === base + "/gallery/photo/2" && docs.length === d1);
  await pg.reload();
  check("reload shows the real photo page", await pg.locator('[data-testid="photo-page"]').isVisible());
  await pg.goto(base + "/dashboard");
  check("parallel slots render with the page", (await pg.textContent('[data-testid="stats-slot"]')).includes("visits 42") && (await pg.textContent('[data-testid="feed-slot"]')).includes("feed for the dashboard"));

  // ---- images and scripts ----
  errs.length = 0;
  const imgTypes = [];
  pg.on("response", (r) => r.url().includes("/_optz/image") && imgTypes.push(r.headers()["content-type"]));
  await pg.goto(base + "/media");
  await pg.waitForTimeout(800);
  const hero = await pg.$eval('[data-testid="hero"]', (i) => ({ w: i.naturalWidth, src: i.currentSrc }));
  // UNOPTIMIZED=1: edge workers and binaries without sharp send images as they are.
  if (process.env.UNOPTIMIZED) check("<Image> loads (unoptimized)", hero.w > 0, JSON.stringify(hero));
  else check("<Image> loads an optimized AVIF", hero.w > 0 && imgTypes.includes("image/avif"), JSON.stringify({ hero, imgTypes }));
  check("<Script lazyOnload> ran once", (await pg.evaluate(() => window.__thirdParty)) === 1);
  await pg.click("nav >> text=Home");
  await pg.waitForTimeout(300);
  await pg.click("nav >> text=Media");
  await pg.waitForTimeout(500);
  check("script not loaded again after navigating back", (await pg.evaluate(() => window.__thirdParty)) === 1);
  check("media: no errors", errs.length === 0, JSON.stringify(errs));

  // ---- i18n ----
  await pg.goto(base + "/");
  await pg.click('[data-testid="to-fr"]');
  await pg.waitForURL(base + "/fr");
  check("switch locale: /fr in French", (await pg.textContent("h1")) === "Bonjour" && (await pg.getAttribute("html", "lang")) === "fr");
  await pg.click("nav >> text=Docs");
  await pg.waitForURL(base + "/fr/docs");
  check("links keep the locale", (await pg.textContent('[data-testid="locale"]')).includes("fr"));

  // ---- errors ----
  const res = await pg.goto(base + "/boom");
  check("a page that throws: 500 with _error.tsx", res.status() === 500 && (await pg.textContent('[data-testid="error"]')).includes("kaboom"));

  await b.close();
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
