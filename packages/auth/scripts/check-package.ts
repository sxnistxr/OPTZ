import { mkdtempSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = join(import.meta.dir, ".."), temp = mkdtempSync(join(tmpdir(), "optz-auth-package-"));
function command(args: string[], cwd = root) {
  const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe", env: process.env });
  if (result.exitCode !== 0) throw new Error(`Package check failed: ${args[1]}\n${result.stderr.toString()}`);
  return result.stdout.toString();
}
try {
  command([process.execPath, "pm", "pack", "--destination", temp]);
  const tarball = join(temp, readdirSync(temp).find(file => file.endsWith(".tgz"))!);
  const files = command(["tar", "-tzf", tarball]).trim().split("\n");
  if (files.some(file => !/^package\/(?:package\.json|README\.md|LICENSE|src\/.*\.ts)$/.test(file))) throw new Error("Unexpected files in auth package");
  writeFileSync(join(temp, "package.json"), JSON.stringify({ name: "auth-package-smoke", type: "module", dependencies: { "@sxnistxr/optz-auth": "file:" + tarball } }));
  command([process.execPath, "install", "--ignore-scripts"], temp);
  const code = `import {createAuth} from "@sxnistxr/optz-auth";
import {openAuthDatabase,migrateAuth} from "@sxnistxr/optz-auth/sqlite";
import {createAuthClient,passkeyClient} from "@sxnistxr/optz-auth/client";
import {organization} from "@sxnistxr/optz-auth/plugins";
import {resend} from "@sxnistxr/optz-auth/delivery";
const db=openAuthDatabase(":memory:"); const auth=createAuth({database:db,baseURL:"https://package.example.test",secret:crypto.getRandomValues(new Uint8Array(32)).toBase64({alphabet:"base64url",omitPadding:true})});
await migrateAuth(auth,true); if((await auth.handler(new Request("https://package.example.test/api/auth/get-session"))).status!==200)throw new Error("handler failed");
createAuthClient({plugins:[passkeyClient()]}); if(typeof organization!=="function"||typeof resend!=="function")throw new Error("exports failed"); db.close();`;
  writeFileSync(join(temp, "check.ts"), code);
  command([process.execPath, "check.ts"], temp);
  console.log(`auth: all 5 exports import from an isolated installed tarball (${files.length} packaged files)`);
} finally { rmSync(temp, { recursive: true, force: true }); }
