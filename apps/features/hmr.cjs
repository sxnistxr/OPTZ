// Dev-server checks: edits show up without a reload and islands keep their state.
//   optz dev &   then   node hmr.cjs http://127.0.0.1:3002
// Edits real files (and puts them back).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const base = process.argv[2] ?? "http://127.0.0.1:3002";
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  " + String(detail).slice(0, 300)}`);
const file = (f) => path.join(__dirname, f);
const saved = new Map();
const edit = (f, from, to) => {
  const p = file(f);
  const src = fs.readFileSync(p, "utf8");
  if (!saved.has(p)) saved.set(p, src);
  if (!src.includes(from)) throw new Error(`${f}: "${from}" not found`);
  fs.writeFileSync(p, src.replace(from, to));
};
const restore = () => saved.forEach((src, p) => fs.writeFileSync(p, src));

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  let loads = 0;
  pg.on("load", () => loads++);
  try {
    await pg.goto(base + "/notes");
    await pg.waitForSelector('[data-testid="clicks"]');
    await pg.waitForTimeout(800);
    for (let i = 0; i < 3; i++) await pg.click('[data-testid="clicks"]');
    const l0 = loads;

    // 1. island code: Fast Refresh swaps it, the counter keeps its value
    edit("app/components/NoteForm.island.tsx", "clicked {clicks}", "pressed {clicks}");
    await pg.waitForFunction(() => document.querySelector('[data-testid="clicks"]')?.textContent?.startsWith("pressed"), null, { timeout: 15000 }).catch(() => {});
    check("island edit applied without a reload", loads === l0 && (await pg.textContent('[data-testid="clicks"]')).startsWith("pressed"), await pg.textContent('[data-testid="clicks"]'));
    check("island state survived the edit", (await pg.textContent('[data-testid="clicks"]')) === "pressed 3", await pg.textContent('[data-testid="clicks"]'));

    // 2. server-only page code: the HTML updates in place, the island stays mounted
    edit("app/routes/notes.tsx", '<h1 className="text-2xl font-bold">Notes</h1>', '<h1 className="text-2xl font-bold">Notes (edited)</h1>');
    await pg.waitForFunction(() => document.querySelector("h1")?.textContent === "Notes (edited)", null, { timeout: 15000 }).catch(() => {});
    check("page edit applied without a reload", loads === l0 && (await pg.textContent("h1")) === "Notes (edited)", await pg.textContent("h1"));
    check("island state survived the page edit", (await pg.textContent('[data-testid="clicks"]')) === "pressed 3", await pg.textContent('[data-testid="clicks"]'));

    // 3. CSS: the stylesheet swaps, nothing else changes
    edit("app/styles.css", "@theme {", '[data-testid="msg"] { color: rgb(1, 2, 3); }\n\n@theme {');
    await pg.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="msg"]')).color === "rgb(1, 2, 3)", null, { timeout: 15000 }).catch(() => {});
    check("CSS edit applied without a reload", loads === l0 && (await pg.$eval('[data-testid="msg"]', (e) => getComputedStyle(e).color)) === "rgb(1, 2, 3)");
    check("no errors", errs.length === 0, JSON.stringify(errs));
  } finally {
    restore();
    await b.close();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
