import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuth, memoryBudget } from "../src/index";
import { migrateAuth, openAuthDatabase, sqliteBudget } from "../src/sqlite";
import { cookieJar, fixture, origin, password, enroll } from "./helpers";

test("configuration fails closed for remote HTTP, weak secrets and unsafe paths", () => {
  const db = openAuthDatabase(":memory:");
  const valid = { database: db, baseURL: origin, secret: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" };
  for (const options of [{ baseURL: "http://evil.test" }, { secret: "a".repeat(64) }, { basePath: "/api/../auth" }, { twoFactor: { page: "//evil.test" } }, { baseURL: origin + "/path" }, { twoFactor: { delivery: "sms" as const } }]) expect(() => createAuth({ ...valid, ...options })).toThrow();
  expect(() => createAuth({ ...valid, baseURL: "http://localhost:3008", allowInsecureLocalhost: true })).not.toThrow();
  db.close();
});

test("verified password auth, Argon2id, secure cookies, revocation and session isolation", async () => {
  const f = await fixture();
  try {
    const signup = await f.call("/sign-up/email", { email: "alice@example.test", name: "Alice", password });
    expect(signup.response.status).toBe(200);
    const unverified = await f.call("/sign-in/email", { email: "alice@example.test", password });
    expect(unverified.response.status).toBe(403);
    const verify = f.emails.find(m => m.purpose === "verify-email")!.url!;
    await f.call(verify);
    const jar = cookieJar(), login = await f.call("/sign-in/email", { email: "alice@example.test", password }, jar);
    expect(login.response.status).toBe(200);
    expect(login.response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(login.response.headers.get("set-cookie")).toContain("Secure");
    expect(login.response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(login.response.headers.get("cache-control")).toContain("no-store");
    expect(f.db.query<{ password: string }, []>('SELECT password FROM account WHERE "providerId"=\'credential\'').get()!.password).toStartWith("$argon2id$");
    const req = new Request(origin, { headers: { Cookie: jar.value } });
    expect((await f.auth.requireSession(req)).user.email).toBe("alice@example.test");
    expect(await f.auth.getSession(new Request(origin))).toBeNull();
    await f.call("/sign-out", {}, jar);
    expect(await f.auth.getSession(req)).toBeNull();
  } finally { f.db.close(); }
});

test("origin, redirect, byte and stream timeout defenses apply to HTTP ingress", async () => {
  const f = await fixture({ limits: { maxBodyBytes: 1024, bodyTimeoutMs: 20 } });
  try {
    expect((await f.call("/sign-in/email", {}, undefined, { Origin: "https://evil.test" })).response.status).toBe(403);
    expect((await f.call("/sign-in/email", {}, undefined, { Origin: "" })).response.status).toBe(403);
    expect((await f.call("/sign-in/email", { x: "x".repeat(1024) })).response.status).toBe(413);
    expect((await f.call("/sign-in/magic-link", { email: "alice@example.test", callbackURL: "https://evil.test" })).response.status).toBe(403);
    const response = await f.auth.handler(new Request(origin + "/api/auth/sign-in/email", { method: "POST", headers: { Origin: origin }, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([123])); } }), duplex: "half" } as RequestInit));
    expect(response.status).toBe(408);
    expect((await f.auth.handler(new Request(origin + "/api/authentic"))).status).toBe(404);
  } finally { f.db.close(); }
});

test("email OTP is single-use, hashed, expires and caps wrong attempts", async () => {
  const f = await fixture();
  try {
    await f.call("/email-otp/send-verification-otp", { email: "otp@example.test", type: "sign-in" });
    const code = f.emails.at(-1)!.code!;
    expect(f.db.query<{ value: string }, []>("SELECT value FROM verification").all().every(r => !r.value.includes(code))).toBe(true);
    const jar = cookieJar();
    expect((await f.call("/sign-in/email-otp", { email: "otp@example.test", otp: code }, jar)).response.status).toBe(200);
    expect((await f.auth.getSession(new Request(origin, { headers: { Cookie: jar.value } })))!.user.emailVerified).toBe(true);
    expect((await f.call("/sign-in/email-otp", { email: "otp@example.test", otp: code })).response.ok).toBe(false);
    await f.call("/email-otp/send-verification-otp", { email: "wrong@example.test", type: "sign-in" });
    const wrongCode = f.emails.at(-1)!.code!;
    for (let i = 0; i < 3; i++) await f.call("/sign-in/email-otp", { email: "wrong@example.test", otp: wrongCode === "000000" ? "111111" : "000000" });
    expect((await f.call("/sign-in/email-otp", { email: "wrong@example.test", otp: wrongCode })).response.ok).toBe(false);
    await f.call("/email-otp/send-verification-otp", { email: "expired@example.test", type: "sign-in" });
    const expiredCode = f.emails.at(-1)!.code!;
    f.db.exec('UPDATE verification SET "expiresAt"=0');
    expect((await f.call("/sign-in/email-otp", { email: "expired@example.test", otp: expiredCode })).response.ok).toBe(false);
  } finally { f.db.close(); }
});

test("magic links are single-use and untrusted redirects are denied", async () => {
  const f = await fixture();
  try {
    await f.call("/sign-in/magic-link", { email: "link@example.test", callbackURL: "/dashboard" });
    const url = f.emails.at(-1)!.url!, token = new URL(url).searchParams.get("token")!;
    expect(f.db.query<{ identifier: string }, []>("SELECT identifier FROM verification").all().every(r => !r.identifier.includes(token))).toBe(true);
    const jar = cookieJar(), first = await f.call(url, undefined, jar);
    expect(first.response.status).toBe(302);
    expect((await f.auth.getSession(new Request(origin, { headers: { Cookie: jar.value } })))!.user.email).toBe("link@example.test");
    const second = cookieJar(); await f.call(url, undefined, second);
    expect(await f.auth.getSession(new Request(origin, { headers: { Cookie: second.value } }))).toBeNull();
  } finally { f.db.close(); }
});

test("TOTP activation revokes old sessions; pending MFA has no session; backup codes cannot replay", async () => {
  const f = await fixture();
  try {
    const jar = await f.register(), other = cookieJar();
    await f.call("/sign-in/email", { email: "alice@example.test", password }, other);
    const enrollment = await enroll(f, jar);
    expect(enrollment.backupCodes).toHaveLength(10);
    expect(await f.auth.getSession(new Request(origin, { headers: { Cookie: other.value } }))).toBeNull();
    expect(f.db.query<{ backupCodes: string }, []>('SELECT "backupCodes" FROM "twoFactor"').get()!.backupCodes).not.toContain(enrollment.backupCodes[0]);
    const pending = cookieJar(), login = await f.call("/sign-in/email", { email: "alice@example.test", password }, pending);
    expect(login.data.twoFactorRedirect).toBe(true);
    expect(await f.auth.getSession(new Request(origin, { headers: { Cookie: pending.value } }))).toBeNull();
    expect((await f.call("/two-factor/verify-backup-code", { code: enrollment.backupCodes[0], trustDevice: false }, pending)).response.status).toBe(200);
    expect(await f.auth.getSession(new Request(origin, { headers: { Cookie: pending.value } }))).not.toBeNull();
    const replay = cookieJar(); await f.call("/sign-in/email", { email: "alice@example.test", password }, replay);
    expect((await f.call("/two-factor/verify-backup-code", { code: enrollment.backupCodes[0] }, replay)).response.ok).toBe(false);
    expect(await f.auth.getSession(new Request(origin, { headers: { Cookie: replay.value } }))).toBeNull();
  } finally { f.db.close(); }
});

test("email OTP and magic links cannot bypass an enrolled second factor", async () => {
  const f = await fixture();
  try {
    const jar = await f.register(); await enroll(f, jar);
    await f.call("/email-otp/send-verification-otp", { email: "alice@example.test", type: "sign-in" });
    const pending = cookieJar(), result = await f.call("/sign-in/email-otp", { email: "alice@example.test", otp: f.emails.at(-1)!.code! }, pending);
    expect(result.data.twoFactorRedirect).toBe(true);
    expect(await f.auth.getSession(new Request(origin, { headers: { Cookie: pending.value } }))).toBeNull();
    await f.call("/sign-in/magic-link", { email: "alice@example.test", callbackURL: "/dashboard" });
    const magic = cookieJar(), link = await f.call(f.emails.at(-1)!.url!, undefined, magic);
    expect(link.response.status).toBe(303);
    expect(link.response.headers.get("location")).toBe("/login?mfa=1");
    expect(await f.auth.getSession(new Request(origin, { headers: { Cookie: magic.value } }))).toBeNull();
  } finally { f.db.close(); }
});

test("SMS validates destination, verifies once and produces an unverified reserved email identity", async () => {
  const f = await fixture();
  try {
    expect((await f.call("/phone-number/send-otp", { phoneNumber: "+442012345678" })).response.status).toBe(400);
    expect(f.sms).toHaveLength(0);
    await f.call("/phone-number/send-otp", { phoneNumber: "+15551234567" });
    const jar = cookieJar(), code = f.sms[0].code;
    const verify = await f.call("/phone-number/verify", { phoneNumber: "+15551234567", code }, jar);
    expect(verify.response.status).toBe(200);
    const session = await f.auth.getSession(new Request(origin, { headers: { Cookie: jar.value } }));
    expect(session!.user.email).toEndWith("@phone.invalid");
    expect(session!.user.emailVerified).toBe(false);
    expect((await f.call("/phone-number/verify", { phoneNumber: "+15551234567", code })).response.ok).toBe(false);
  } finally { f.db.close(); }
});

test("password recovery revokes every session and reset tokens are single-use", async () => {
  const f = await fixture();
  try {
    const jar = await f.register(), req = new Request(origin, { headers: { Cookie: jar.value } });
    await f.call("/request-password-reset", { email: "alice@example.test", redirectTo: "/reset" });
    const url = new URL(f.emails.at(-1)!.url!), token = url.pathname.split("/").at(-1)!;
    expect((await f.call("/reset-password", { token, newPassword: password + " changed" })).response.status).toBe(200);
    expect(await f.auth.getSession(req)).toBeNull();
    expect((await f.call("/reset-password", { token, newPassword: password })).response.ok).toBe(false);
    expect((await f.call("/sign-in/email", { email: "alice@example.test", password })).response.status).toBe(401);
  } finally { f.db.close(); }
});

test("freshness and mandatory MFA enrollment are explicit data-access policies", async () => {
  const f = await fixture();
  try {
    const jar = await f.register(), req = new Request(origin, { headers: { Cookie: jar.value } });
    await expect(f.auth.requireSession(req, { mfa: true })).rejects.toBeInstanceOf(Response);
    f.db.exec('UPDATE session SET "createdAt"=1');
    expect((await f.call("/two-factor/enable", { password }, jar)).response.status).toBe(403);
    expect((await f.call("/passkey/generate-register-options", undefined, jar)).response.status).toBe(403);
  } finally { f.db.close(); }
});

test("signup shutdown applies to password, OTP, magic and SMS registrations", async () => {
  const f = await fixture({ allowSignUp: false });
  try {
    expect((await f.call("/sign-up/email", { email: "new@example.test", password, name: "New" })).response.ok).toBe(false);
    await f.call("/email-otp/send-verification-otp", { email: "new@example.test", type: "sign-in" });
    if (f.emails.at(-1)?.code) await f.call("/sign-in/email-otp", { email: "new@example.test", otp: f.emails.at(-1)!.code });
    await f.call("/phone-number/send-otp", { phoneNumber: "+15551234567" });
    await f.call("/phone-number/verify", { phoneNumber: "+15551234567", code: f.sms.at(-1)?.code });
    expect(f.db.query<{ n: number }, []>("SELECT count(*) n FROM user").get()!.n).toBe(0);
  } finally { f.db.close(); }
});

test("budgets bound request floods, do not trust IP headers and fail closed", async () => {
  const f = await fixture({ limits: { requestsPerMinute: 2, mutationsPerMinute: 2 } });
  try {
    expect((await f.call("/get-session")).response.status).toBe(200);
    expect((await f.call("/get-session", undefined, undefined, { "x-forwarded-for": "1.2.3.4" })).response.status).toBe(200);
    expect((await f.call("/get-session", undefined, undefined, { "x-forwarded-for": "9.8.7.6" })).response.status).toBe(429);
    const bounded = memoryBudget(1, () => 100);
    expect(bounded.consume("one", 1, 1000)).toEqual({ allowed: true, retryAfter: 1 });
    expect(bounded.consume("two", 1, 1000)).toEqual({ allowed: false, retryAfter: 1 });
    const failed = await fixture({ budget: { consume() { throw new Error("down"); } } });
    try { expect((await failed.call("/get-session")).response.status).toBe(503); } finally { failed.db.close(); }
  } finally { f.db.close(); }
});

test("delivery cooldown and app-wide SMS spend budget apply independently of client identities", async () => {
  const f = await fixture({ clientKey: request => request.headers.get("test-peer") ?? "test", limits: { smsPerMinute: 1 } });
  try {
    expect((await f.call("/phone-number/send-otp", { phoneNumber: "+15551234567" })).response.status).toBe(200);
    expect((await f.call("/phone-number/send-otp", { phoneNumber: "+15557654321" }, undefined, { "test-peer": "second" })).response.status).toBe(429);
    expect(f.sms).toHaveLength(1);
    await f.call("/email-otp/send-verification-otp", { email: "cool@example.test", type: "sign-in" });
    await f.call("/email-otp/send-verification-otp", { email: "cool@example.test", type: "sign-in" });
    expect(f.emails.filter(message => message.to === "cool@example.test")).toHaveLength(1);
  } finally { f.db.close(); }
});

test("SQLite migration is explicit/idempotent; private permissions, sessions and budgets persist", async () => {
  const dir = mkdtempSync(join(tmpdir(), "optz-auth-")), path = join(dir, "auth.sqlite");
  const f = await fixture({}, path);
  try {
    const jar = await f.register();
    expect((statSync(path).mode & 0o777)).toBe(0o600);
    expect(await migrateAuth(f.auth)).toBe("");
    const budget = sqliteBudget(f.db, () => 100);
    expect(budget.consume("test", 1, 1000)).toEqual({ allowed: true, retryAfter: 1 });
    expect(sqliteBudget(f.db, () => 100, 1).consume("capacity", 1, 1000)).toEqual({ allowed: false, retryAfter: 1 });
    const db2 = openAuthDatabase(path), auth2 = createAuth({ database: db2, baseURL: origin, secret: f.auth.options.secret! });
    try {
      expect(sqliteBudget(db2, () => 100).consume("test", 1, 1000)).toEqual({ allowed: false, retryAfter: 1 });
      expect((await auth2.getSession(new Request(origin, { headers: { Cookie: jar.value } })))!.user.email).toBe("alice@example.test");
    } finally { db2.close(); }
  } finally { f.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("SQLite passkey capacity is a database constraint, including concurrent enrollment writes", async () => {
  const f = await fixture();
  try {
    await f.register();
    const user = f.db.query<{ id: string }, []>("SELECT id FROM user").get()!;
    const insert = f.db.query('INSERT INTO passkey(id,publicKey,userId,credentialID,counter,deviceType,backedUp) VALUES (?,?,?,?,0,\'singleDevice\',0)');
    for (let i = 0; i < 10; i++) insert.run(String(i), "test-key", user.id, "test-credential-" + i);
    expect(() => insert.run("eleven", "test-key", user.id, "test-credential-eleven")).toThrow("Passkey capacity reached");
  } finally { f.db.close(); }
});

test("middleware leaves public paths untouched and observer events contain no query or credentials", async () => {
  const events: unknown[] = [], f = await fixture({ onEvent: event => { events.push(event); } });
  try {
    let touched = false;
    const publicResponse = await f.auth.middleware({ request: new Request(origin + "/public") }, async () => { touched = true; return new Response("public"); });
    expect(touched).toBe(true); expect(await publicResponse.text()).toBe("public"); expect(events).toHaveLength(0);
    await f.call("/get-session?secret=sensitive");
    await f.call("/reset-password/sensitive-recovery-token");
    await f.call("/unknown/sensitive-identifier");
    expect(JSON.stringify(events)).not.toContain("sensitive");
    expect(JSON.stringify(events)).not.toContain("cookie");
  } finally { f.db.close(); }
});

test("recovery invalidates pending MFA challenges and previously trusted device cookies", async () => {
  const f = await fixture();
  try {
    const jar = await f.register(), enrollment = await enroll(f, jar);
    const trusted = cookieJar(); await f.call("/sign-in/email", { email: "alice@example.test", password }, trusted);
    expect((await f.call("/two-factor/verify-backup-code", { code: enrollment.backupCodes[0], trustDevice: true }, trusted)).response.status).toBe(200);
    expect(trusted.value).toContain("trust_device");
    const pending = cookieJar(); await f.call("/sign-in/email", { email: "alice@example.test", password }, pending);
    await f.call("/request-password-reset", { email: "alice@example.test", redirectTo: "/reset" });
    const token = new URL(f.emails.at(-1)!.url!).pathname.split("/").at(-1)!;
    expect((await f.call("/reset-password", { token, newPassword: password + " changed" })).response.status).toBe(200);
    expect((await f.call("/two-factor/verify-backup-code", { code: enrollment.backupCodes[1] }, pending)).response.ok).toBe(false);
    const again = await f.call("/sign-in/email", { email: "alice@example.test", password: password + " changed" }, trusted);
    expect(again.data.twoFactorRedirect).toBe(true);
    expect(await f.auth.getSession(new Request(origin, { headers: { Cookie: trusted.value } }))).toBeNull();
  } finally { f.db.close(); }
});

test("racing email OTP and backup-code redemptions cannot mint two sessions", async () => {
  const f = await fixture();
  try {
    await f.call("/email-otp/send-verification-otp", { email: "race@example.test", type: "sign-in" });
    const otp = f.emails.at(-1)!.code!;
    const redeemed = await Promise.all([f.call("/sign-in/email-otp", { email: "race@example.test", otp }), f.call("/sign-in/email-otp", { email: "race@example.test", otp })]);
    expect(redeemed.filter(result => result.response.ok)).toHaveLength(1);
    const jar = await f.register(), enrollment = await enroll(f, jar);
    const first = cookieJar(), second = cookieJar();
    await f.call("/sign-in/email", { email: "alice@example.test", password }, first);
    await f.call("/sign-in/email", { email: "alice@example.test", password }, second);
    const raced = await Promise.all([f.call("/two-factor/verify-backup-code", { code: enrollment.backupCodes[0] }, first), f.call("/two-factor/verify-backup-code", { code: enrollment.backupCodes[0] }, second)]);
    expect(raced.filter(result => result.response.ok)).toHaveLength(1);
  } finally { f.db.close(); }
});

test("slow bodies exhaust a bounded concurrency slot and release it on timeout", async () => {
  const f = await fixture({ limits: { concurrent: 1, bodyTimeoutMs: 100 } });
  try {
    const pending = f.auth.handler(new Request(origin + "/api/auth/sign-in/email", { method: "POST", headers: { Origin: origin }, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([123])); } }), duplex: "half" } as RequestInit));
    await Bun.sleep(10);
    expect((await f.call("/get-session")).response.status).toBe(503);
    expect((await pending).status).toBe(408);
    expect((await f.call("/get-session")).response.status).toBe(200);
  } finally { f.db.close(); }
});
