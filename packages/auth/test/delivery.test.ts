import { test, expect } from "bun:test";
import { resend, twilio } from "../src/delivery";

test("delivery adapters use fixed provider endpoints and redact failures", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string | URL | Request, init: RequestInit) => { requests.push({ url: String(url), init }); return new Response(null, { status: 202 }); }) as typeof fetch;
  await resend({ apiKey: "test-email-secret", from: "auth@example.test", fetch: fakeFetch })({ to: "user@example.test", purpose: "magic-link", url: "https://app.example.test/verify?token=test" });
  await twilio({ accountSid: "AC" + "1".repeat(32), authToken: "test-sms-secret", from: "+15551234567", fetch: fakeFetch })({ to: "+15557654321", code: "123456", purpose: "sign-in" });
  expect(requests[0].url).toBe("https://api.resend.com/emails");
  expect(JSON.parse(requests[0].init.body as string).text).toContain("https://app.example.test/verify");
  expect(requests[1].url).toStartWith("https://api.twilio.com/2010-04-01/Accounts/AC");
  expect((requests[1].init.body as URLSearchParams).get("Body")).toContain("123456");
  const failure = (async () => new Response("sensitive-provider-response", { status: 403 })) as unknown as typeof fetch;
  await expect(resend({ apiKey: "test-secret", from: "auth@example.test", fetch: failure })({ to: "user@example.test", purpose: "sign-in", code: "123456" })).rejects.toThrow("Email delivery failed");
});
