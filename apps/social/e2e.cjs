// Browser checks for the social demo. Needs the engine on :3000 with the challenge seed and
// JWT_SECRET=twelve-dollar-challenge, and this app built and running:
//   bun run build && bun run start &   then   node e2e.cjs http://127.0.0.1:3005
const { chromium } = require("playwright");
const crypto = require("crypto");

const b64 = (b) => Buffer.from(b).toString("base64url");
const h = b64('{"alg":"HS256","typ":"JWT"}');
const p = b64(JSON.stringify({ sub: "1", username: "golden_ember_1", iat: 0, exp: Math.floor(Date.now() / 1000) + 86400 }));
const token = `${h}.${p}.${crypto.createHmac("sha256", process.env.JWT_SECRET ?? "twelve-dollar-challenge").update(`${h}.${p}`).digest("base64url")}`;
const base = process.argv[2] ?? "http://127.0.0.1:3005";
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  " + String(detail).slice(0, 300)}`);

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  pg.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  const docs = [];
  pg.on("request", (r) => r.resourceType() === "document" && docs.push(r.url()));

  await pg.goto(base + "/post/500000");
  await pg.waitForTimeout(1200);
  check("client-rendered post page loads its post by id", (await pg.textContent("main")).includes("swift_ember_22228"), await pg.textContent("main"));
  await pg.click("text=Back to the feed");
  await pg.waitForTimeout(1200);
  check("feed islands hydrated after swap", (await pg.locator("#token").count()) === 1 && (await pg.locator("main ol li").count()) >= 20);
  await pg.fill("#token", token);
  await pg.click("text=Use this token");
  await pg.waitForTimeout(300);
  check("token accepted", (await pg.textContent("main")).includes("Posting as golden_ember_1"));
  await pg.fill("#compose-body", "  Posted from an island  ");
  await pg.click('button:has-text("Post")');
  await pg.waitForTimeout(800);
  const first = pg.locator("main ol li").first();
  check("post appears on top, trimmed", (await first.textContent()).includes("Posted from an island"));
  await first.locator('button:has-text("Like")').click();
  await pg.waitForTimeout(500);
  check("like works", (await first.textContent()).includes("Liked") && (await first.textContent()).includes("1 like"));
  const d1 = docs.length;
  await first.locator("a").first().click();
  await pg.waitForTimeout(1000);
  check("swap into the post page picks up the id", (await pg.textContent("main")).includes("Posted from an island") && docs.length === d1);
  check("no errors under a strict CSP", errs.length === 0, JSON.stringify(errs));

  await b.close();
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
