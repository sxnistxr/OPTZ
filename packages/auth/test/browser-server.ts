// Loopback-only test fixture, deliberately excluded from the published package.
import { createAuth } from "../src/index";
import { openAuthDatabase, migrateAuth } from "../src/sqlite";
import type { EmailMessage } from "../src/delivery";
const emails: EmailMessage[] = [];
const bundle = await Bun.build({ entrypoints: [import.meta.dir + "/browser-client.ts"], target: "browser", minify: true });
if (!bundle.success) throw new Error("Browser fixture build failed");
let auth: ReturnType<typeof createAuth>;
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/") return new Response('<!doctype html><title>Passkey test</title><script type="module" src="/client.js"></script>', { headers: { "Content-Type": "text/html" } });
  if (path === "/client.js") return new Response(await bundle.outputs[0].arrayBuffer(), { headers: { "Content-Type": "text/javascript" } });
  if (path === "/test-mailbox") return Response.json(emails);
  return auth.handler(request);
} });
const origin = `http://localhost:${server.port}`;
auth = createAuth({ baseURL: origin, allowInsecureLocalhost: true,
  secret: crypto.getRandomValues(new Uint8Array(32)).toBase64({ alphabet: "base64url", omitPadding: true }),
  database: openAuthDatabase(":memory:"), email: { send: async message => { emails.push(message); } },
  limits: { requestsPerMinute: 1000, mutationsPerMinute: 1000 },
});
await migrateAuth(auth, true);
console.log(JSON.stringify({ origin }));
