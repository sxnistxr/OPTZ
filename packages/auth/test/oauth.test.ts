import { test, expect } from "bun:test";
import { genericOAuth } from "../src/plugins";
import { fixture, cookieJar, origin, enroll } from "./helpers";

function provider(email = "social@example.test") {
  let exchanges = 0;
  const plugin = genericOAuth({ config: [{
    providerId: "test-idp", clientId: "test-client", clientSecret: "test-client-secret",
    authorizationUrl: "https://idp.example.test/authorize", scopes: ["openid", "email"], pkce: true,
    async getToken({ code, codeVerifier }) {
      expect(code).toBe("valid-code"); expect(codeVerifier!.length).toBeGreaterThanOrEqual(43); exchanges++;
      return { accessToken: "sensitive-provider-token", accessTokenExpiresAt: new Date(Date.now() + 60000) };
    },
    async getUserInfo() { return { id: "stable-subject", email, emailVerified: true, name: "Social User" }; },
  }] });
  return { plugin, get exchanges() { return exchanges; } };
}

async function begin(f: Awaited<ReturnType<typeof fixture>>, jar: ReturnType<typeof cookieJar>) {
  const result = await f.call("/sign-in/social", { provider: "test-idp", callbackURL: "/dashboard" }, jar);
  expect(result.response.status).toBe(200);
  const url = new URL(result.data.url);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("code_challenge")).toBeTruthy();
  return `${origin}/api/auth/callback/test-idp?code=valid-code&state=${url.searchParams.get("state")}`;
}

test("OAuth state + PKCE, encrypted provider tokens, callback replay and social MFA", async () => {
  const idp = provider(), f = await fixture({ plugins: [idp.plugin] });
  try {
    const jar = cookieJar(), callback = await begin(f, jar);
    const login = await f.call(callback, undefined, jar);
    expect(login.response.status).toBe(302);
    expect((await f.auth.getSession(new Request(origin, { headers: { Cookie: jar.value } })))!.user.email).toBe("social@example.test");
    expect(f.db.query<{ accessToken: string }, []>('SELECT "accessToken" FROM account').get()!.accessToken).not.toBe("sensitive-provider-token");
    const replay = cookieJar(); await f.call(callback, undefined, replay);
    expect(await f.auth.getSession(new Request(origin, { headers: { Cookie: replay.value } }))).toBeNull();
    expect(idp.exchanges).toBe(1);
    await enroll(f, jar);
    const pending = cookieJar(), again = await begin(f, pending);
    const challenge = await f.call(again, undefined, pending);
    expect(challenge.response.status).toBe(303);
    expect(challenge.response.headers.get("location")).toBe("/login?mfa=1");
    expect(await f.auth.getSession(new Request(origin, { headers: { Cookie: pending.value } }))).toBeNull();
  } finally { f.db.close(); }
});

test("OAuth denies missing/mismatched state before exchanging a code", async () => {
  const idp = provider(), f = await fixture({ plugins: [idp.plugin] });
  try {
    const jar = cookieJar(), callback = new URL(await begin(f, jar)); callback.searchParams.set("state", "forged-state");
    await f.call(callback.toString(), undefined, jar);
    expect(idp.exchanges).toBe(0);
    expect(await f.auth.getSession(new Request(origin, { headers: { Cookie: jar.value } }))).toBeNull();
  } finally { f.db.close(); }
});

test("matching email alone never implicitly links a social identity", async () => {
  const idp = provider("alice@example.test"), f = await fixture({ plugins: [idp.plugin] });
  try {
    await f.register();
    const jar = cookieJar(), callback = await begin(f, jar); await f.call(callback, undefined, jar);
    expect(await f.auth.getSession(new Request(origin, { headers: { Cookie: jar.value } }))).toBeNull();
    expect(f.db.query<{ n: number }, []>("SELECT count(*) n FROM account").get()!.n).toBe(1);
  } finally { f.db.close(); }
});

test("Google, GitHub, Microsoft, Apple and Discord use dedicated callbacks and code flows", async () => {
  const f = await fixture({ socialProviders: {
    google: { clientId: "test-id", clientSecret: "test-secret" },
    github: { clientId: "test-id", clientSecret: "test-secret" },
    microsoft: { clientId: "test-id", clientSecret: "test-secret" },
    apple: { clientId: "test-id", clientSecret: "test-secret" },
    discord: { clientId: "test-id", clientSecret: "test-secret" },
  } });
  try {
    for (const name of ["google", "github", "microsoft", "apple", "discord"]) {
      const result = await f.call("/sign-in/social", { provider: name, callbackURL: "/dashboard" });
      expect(result.response.status).toBe(200);
      const url = new URL(result.data.url);
      expect(url.protocol).toBe("https:"); expect(url.searchParams.get("state")).toBeTruthy();
      expect(url.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/callback/${name}`);
      expect(url.searchParams.get("response_type")!.split(" ")).toContain("code");
    }
  } finally { f.db.close(); }
});
