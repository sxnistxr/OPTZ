import { test, expect } from "bun:test";
import { admin, organization } from "../src/plugins";
import { fixture, password, origin, cookieJar, enroll, totp } from "./helpers";
import { memoryBudget } from "../src/index";

test("organization extensions isolate tenants and protect membership updates", async () => {
  const f = await fixture({ plugins: [organization({ requireEmailVerificationOnInvitation: true, organizationLimit: 5, membershipLimit: 100 })] });
  try {
    const alice = await f.register(), bob = await f.register("bob@example.test");
    const created = await f.call("/organization/create", { name: "Alice's team", slug: "alice-team" }, alice);
    expect(created.response.status).toBe(200);
    const organizationId = created.data.id;
    expect((await f.call("/organization/list-members?organizationId=" + organizationId, undefined, alice)).response.status).toBe(200);
    expect((await f.call("/organization/list-members?organizationId=" + organizationId, undefined, bob)).response.ok).toBe(false);
    expect((await f.call("/organization/update", { organizationId, data: { name: "Stolen" } }, bob)).response.ok).toBe(false);
  } finally { f.db.close(); }
});

test("admin extension never trusts role fields sent by an ordinary user", async () => {
  const f = await fixture({ plugins: [admin({ defaultRole: "user", adminUserIds: ["configured-trusted-user-id"] })] });
  try {
    const jar = await f.register();
    expect((await f.call("/admin/list-users", undefined, jar)).response.status).toBe(403);
    expect((await f.call("/update-user", { role: "admin" }, jar)).response.ok).toBe(false);
    expect((await f.call("/admin/list-users", undefined, jar)).response.status).toBe(403);
    expect(f.db.query<{ role: string }, []>("SELECT role FROM user").get()!.role).toBe("user");
  } finally { f.db.close(); }
});

test("phone OTP cannot bypass MFA; SMS second factor only targets an already verified phone", async () => {
  let time = Date.now();
  const f = await fixture({ budget: memoryBudget(10000, () => time), twoFactor: { delivery: "sms" } });
  try {
    const phoneNumber = "+15551234567", jar = cookieJar();
    await f.call("/phone-number/send-otp", { phoneNumber });
    expect((await f.call("/phone-number/verify", { phoneNumber, code: f.sms.at(-1)!.code }, jar)).response.status).toBe(200);
    await enroll(f, jar);
    time += 31000;
    await f.call("/phone-number/send-otp", { phoneNumber });
    const pending = cookieJar(), result = await f.call("/phone-number/verify", { phoneNumber, code: f.sms.at(-1)!.code }, pending);
    expect(result.data.twoFactorRedirect).toBe(true);
    expect(await f.auth.getSession(new Request(origin, { headers: { Cookie: pending.value } }))).toBeNull();
    expect((await f.call("/two-factor/send-otp", {}, pending)).response.status).toBe(200);
    expect(f.sms.at(-1)!.purpose).toBe("second-factor");
    expect((await f.call("/two-factor/verify-otp", { code: f.sms.at(-1)!.code, trustDevice: false }, pending)).response.status).toBe(200);
  } finally { f.db.close(); }
});

test("second-factor challenges stop accepting guesses after their attempt budget", async () => {
  const f = await fixture();
  try {
    const jar = await f.register(); const enrollment = await enroll(f, jar);
    const pending = cookieJar(); await f.call("/sign-in/email", { email: "alice@example.test", password }, pending);
    const wrong = totp(enrollment.totpURI) === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await f.call("/two-factor/verify-totp", { code: wrong }, pending)).response.ok).toBe(false);
    expect((await f.call("/two-factor/verify-backup-code", { code: enrollment.backupCodes[0] }, pending)).response.ok).toBe(false);
    expect(await f.auth.getSession(new Request(origin, { headers: { Cookie: pending.value } }))).toBeNull();
  } finally { f.db.close(); }
});
