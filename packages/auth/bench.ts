// Warmed in-process auth costs, not HTTP throughput or a comparison with another provider.
import { createAuth } from "./src/index";
import { openAuthDatabase, migrateAuth, sqliteBudget } from "./src/sqlite";
import { cpus } from "node:os";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
const cold = Bun.spawnSync([process.execPath, "-e", `const start=performance.now(); await import(${JSON.stringify(import.meta.dir + "/src/index.ts")}); console.log(JSON.stringify({ms:performance.now()-start,rss:process.memoryUsage().rss}))`], { stdout: "pipe", stderr: "pipe" });
if (cold.exitCode) throw new Error("Cold import probe failed");
const db = openAuthDatabase(":memory:"), origin = "https://bench.example.test";
const auth = createAuth({ database: db, baseURL: origin, secret: crypto.getRandomValues(new Uint8Array(32)).toBase64({ alphabet: "base64url", omitPadding: true }), email: { send: async () => {} } });
await migrateAuth(auth, true);
const context = await auth.$context;
const user = await context.internalAdapter.createUser({ name: "Bench", email: "bench@example.test", emailVerified: true }, { method: "benchmark" });
const password = "benchmark fixture password (not a real account)";
await context.internalAdapter.createAccount({ accountId: user.id, userId: user.id, providerId: "credential", password: await context.password.hash(password) });
const login = await auth.handler(new Request(origin + "/api/auth/sign-in/email", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ email: user.email, password }) }));
const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
const req = new Request(origin, { headers: { Cookie: cookie } });
if (!(await auth.getSession(req))) throw new Error("Invalid benchmark session fixture");
const anonymous = new Request(origin);
const publicRequest = new Request(origin + "/public");
const response = new Response("public");
const budget = sqliteBudget(db);
async function measure(name: string, count: number, action: () => unknown) {
  for (let i = 0; i < 200; i++) await action();
  const samples = [];
  for (let round = 0; round < 5; round++) {
    const start = performance.now();
    for (let i = 0; i < count; i++) await action();
    samples.push((performance.now() - start) * 1000 / count);
  }
  return { name, unit: "microseconds/op", count, samples, median: [...samples].sort((a,b)=>a-b)[2] };
}
const results = [
  await measure("public middleware bypass (auth already imported)", 5000, () => auth.middleware({ request: publicRequest }, async () => response)),
  await measure("anonymous session lookup", 2000, () => auth.getSession(anonymous)),
  await measure("authenticated SQLite session lookup", 2000, () => auth.getSession(req)),
  await measure("persistent SQLite budget consume", 2000, () => budget.consume("bench", 1000000, 60000)),
];
const hash = createHash("sha256");
for (const file of readdirSync(import.meta.dir + "/src").sort()) hash.update(file).update(readFileSync(import.meta.dir + "/src/" + file));
const report = { runtime: Bun.version, platform: process.platform, cpu: cpus()[0]?.model, date: new Date().toISOString(), sourceSha256: hash.digest("hex"), coldImport: JSON.parse(cold.stdout.toString()), results,
  limitations: "Five warmed sequential in-process samples, in-memory SQLite, same request reused, no cookie cache. Not network throughput, disk durability latency, full page rendering or a hosted-auth comparison." };
const out = process.argv[process.argv.indexOf("--out") + 1];
if (process.argv.includes("--out")) await Bun.write(out, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
db.close();
