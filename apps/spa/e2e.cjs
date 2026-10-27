// Browser checks for SPA navigation (client.mode "spa"). Needs a built, running app:
//   bun run build && bun run start &   then   node e2e.cjs http://127.0.0.1:3006
const { chromium } = require("playwright");

const base = process.argv[2] ?? "http://127.0.0.1:3006";
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  " + String(detail).slice(0, 300)}`);

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  const docs = [];
  pg.on("request", (r) => r.resourceType() === "document" && docs.push(r.url()));

  await pg.goto(base + "/");
  await pg.waitForTimeout(500);
  const d0 = docs.length;
  await pg.click("nav >> text=About");
  await pg.waitForURL(base + "/about");
  await pg.waitForTimeout(400);
  const head = await pg.evaluate(() => ({
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content,
    robots: document.querySelector('meta[name="robots"]')?.content,
    canonical: document.querySelector('link[rel="canonical"]')?.href,
    og: document.querySelector('meta[property="og:title"]')?.content,
    focus: document.activeElement?.id,
    live: document.getElementById("optz-announcer")?.textContent,
    script: window.__markerLoaded,
  }));
  check("client-side navigation (no document request)", docs.length === d0);
  check("head follows the page: title, description, robots, canonical, Open Graph", head.title === "About" && head.description === "About the SPA fixture." && /noindex/.test(head.robots ?? "") && head.canonical === "https://spa.example/about" && head.og === "About (OG)", JSON.stringify(head));
  check("focus moves to <main> and the page is announced", head.focus === "main" && head.live === "About", JSON.stringify(head));
  check("<Script> on the new page loaded", head.script === 1, JSON.stringify(head));

  await pg.click("nav >> text=À propos");
  await pg.waitForURL(base + "/fr/about");
  await pg.waitForTimeout(400);
  const fr = await pg.evaluate(() => ({ lang: document.documentElement.lang, title: document.title, alt: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => l.hreflang).sort().join(",") }));
  check("<html lang> and hreflang alternates follow the locale", fr.lang === "fr" && fr.title === "À propos" && fr.alt === "en,fr", JSON.stringify(fr));

  await pg.goto(base + "/about");
  await pg.waitForTimeout(300);
  await pg.keyboard.press("Tab");
  await pg.keyboard.press("Enter");
  await pg.waitForTimeout(100);
  check("skip link moves focus to the main content", (await pg.evaluate(() => document.activeElement?.id)) === "main");
  check("no page errors", errs.length === 0, JSON.stringify(errs));

  await b.close();
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
