// JavaScript a cold page load downloads, per page, in Chromium: every script response's
// encoded (as transferred) and decoded size. Prints JSON: { "<path>": { scripts, transferred, decoded } }.
//   node bench/js-per-page.cjs http://127.0.0.1:3001 / /blog
const { chromium } = require("playwright");

const [base, ...paths] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch();
  const out = {};
  for (const path of paths) {
    // A fresh context per page: nothing cached from the previous one.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const scripts = [];
    page.on("requestfinished", async (req) => {
      if (req.resourceType() !== "script") return;
      const sizes = await req.sizes().catch(() => null);
      const res = await req.response();
      const body = await res?.body().catch(() => null);
      scripts.push({ url: req.url(), transferred: sizes?.responseBodySize ?? 0, decoded: body?.length ?? 0 });
    });
    await page.goto(base + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    out[path] = { scripts: scripts.length, transferred: scripts.reduce((n, s) => n + s.transferred, 0), decoded: scripts.reduce((n, s) => n + s.decoded, 0) };
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(out));
})();
