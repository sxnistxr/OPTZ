import { createHmac } from "node:crypto";
import { createAuth, type AuthOptions } from "../src/index";
import { openAuthDatabase, migrateAuth } from "../src/sqlite";
import type { EmailMessage, SMSMessage } from "../src/delivery";

export const origin = "https://auth.example.test";
export const password = "correct horse battery staple 2026";
export function cookieJar() {
  const values = new Map<string, string>();
  return {
    get value() { return [...values].map(([k, v]) => `${k}=${v}`).join("; "); },
    update(response: Response) {
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(";"); const at = pair.indexOf("=");
        const key = pair.slice(0, at), value = pair.slice(at + 1);
        if (!value || /max-age=0/i.test(cookie)) values.delete(key); else values.set(key, value);
      }
    },
  };
}
export async function fixture(overrides: Partial<AuthOptions> = {}, path = ":memory:") {
  const db = openAuthDatabase(path), emails: EmailMessage[] = [], sms: SMSMessage[] = [];
  const auth = createAuth({ database: db, baseURL: origin,
    secret: crypto.getRandomValues(new Uint8Array(32)).toBase64({ alphabet: "base64url", omitPadding: true }),
    email: { send: async message => { emails.push(message); } },
    phone: { send: async message => { sms.push(message); }, allowed: number => number.startsWith("+1555") },
    limits: { requestsPerMinute: 1000, mutationsPerMinute: 1000, smsPerMinute: 100 },
    ...overrides,
  });
  await migrateAuth(auth, true);
  async function call(path: string, body?: unknown, jar = cookieJar(), headers: Record<string, string> = {}) {
    const response = await auth.handler(new Request(path.startsWith("http") ? path : origin + "/api/auth" + path, {
      method: body === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: jar.value, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    jar.update(response);
    const data = await response.clone().json().catch(() => null);
    return { response, data };
  }
  async function register(email = "alice@example.test", jar = cookieJar()) {
    const result = await call("/sign-up/email", { email, password, name: "Alice" }, jar);
    if (!result.response.ok) throw new Error(`Registration failed: ${JSON.stringify(result.data)}`);
    const link = emails.findLast(message => message.to === email && message.purpose === "verify-email")!.url!;
    const verify = await call(link, undefined, jar);
    if (verify.response.status >= 400) throw new Error(`Verification failed: ${JSON.stringify(verify.data)}`);
    const login = await call("/sign-in/email", { email, password }, jar);
    if (!login.response.ok) throw new Error(`Login failed: ${JSON.stringify(login.data)}`);
    return jar;
  }
  return { db, auth, emails, sms, call, register };
}

/** RFC 6238 code generator used only by tests, against the real server verifier. */
export function totp(uri: string) {
  const base32 = new URL(uri).searchParams.get("secret")!;
  const bits = [...base32.toUpperCase()].map(c => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map(v => parseInt(v, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac("sha1", key).update(counter).digest(), at = hash[19] & 15;
  return String((hash.readUInt32BE(at) & 0x7fffffff) % 1000000).padStart(6, "0");
}

export async function enroll(f: Awaited<ReturnType<typeof fixture>>, jar: ReturnType<typeof cookieJar>) {
  const start = await f.call("/two-factor/enable", { password }, jar);
  if (!start.response.ok) throw new Error(`Enrollment failed: ${JSON.stringify(start.data)}`);
  const verify = await f.call("/two-factor/verify-totp", { code: totp(start.data.totpURI) }, jar);
  if (!verify.response.ok) throw new Error(`TOTP failed: ${JSON.stringify(verify.data)}`);
  return start.data as { totpURI: string; backupCodes: string[] };
}
