# @optz/auth

Optional authentication for OPTZ applications on **Bun + SQLite**, based on pinned Better Auth
1.7.14 and its maintained WebAuthn implementation. The framework itself never imports this package.
No remote auth service, ORM setup or browser-wide provider is required. A complete working OPTZ
example is in [`apps/auth`](../../apps/auth/README.md).

## Capabilities

| Capability | Implementation |
|---|---|
| Social OAuth / OIDC | Typed Better Auth providers: Google, GitHub, Microsoft, Apple, Discord, Facebook, X, LinkedIn, GitLab, Twitch, Spotify, Slack and others; generic OIDC extension |
| Email/password | Verified email required, Argon2id through Bun, 12–128 characters, recovery revokes all sessions |
| Passwordless email | Expiring, single-use magic links and email codes; hashed stored values and bounded attempts |
| Mobile phone authentication | E.164 validation, mandatory destination policy, expiring/consumed SMS codes, verified-number sign-in |
| Passkeys / security keys | WebAuthn with exact origin/RP binding, authenticated enrollment, required user verification checked on the server, resident credentials, maximum 10 per user with the SQLite migration helper |
| Two-factor authentication | TOTP, optional delivered email/SMS codes, account lockout and attempt budgets; applies to all supported sign-in methods |
| Recovery / backup codes | Ten encrypted, single-use codes; regeneration through the upstream authenticated API |
| Sessions / devices | HttpOnly host-only cookies, database revocation/expiry, session listing/revocation; opt-in trusted-device cookies expire after seven days |
| Linked identities / usernames | Explicit provider linking, same-email restrictions, ASCII usernames; no implicit linking merely because email strings match |
| Organizations / access control | Optional organization membership, invitations, roles and teams via `@optz/auth/plugins` |
| Administration / multiple accounts | Optional admin and multi-session extensions, never enabled implicitly |
| Delivery | Dependency-free Resend/Twilio adapters or your own typed callbacks |

This is a self-hosted package, not the entire Clerk hosted platform. Managed deliverability,
fraud detection, country pricing, a hosted user dashboard, billing, SAML/SCIM and native mobile
SDKs are separate integrations. SMS and email codes are weaker than phishing-resistant passkeys;
using the same delivery channel twice does not create two independent factors. Prefer TOTP as
the fallback to a passkey.

## Setup

While this change is a workspace release, use the checked-out monorepo. It has not been published
to the npm registry. `bun install` links `@optz/auth`; add `"@optz/auth": "workspace:*"` to an app.
The package exports TypeScript for Bun and bundlers, just like OPTZ.

```ts
// app/lib/auth.server.ts
import { createAuth } from "@optz/auth";
import { openAuthDatabase, sqliteBudget, migrateAuth } from "@optz/auth/sqlite";
import { resend } from "@optz/auth/delivery";

const db = openAuthDatabase(process.env.AUTH_DATABASE_PATH!);
export const auth = createAuth({
  database: db,
  budget: sqliteBudget(db),
  secret: process.env.AUTH_SECRET!,
  baseURL: "https://app.example.com",
  email: { send: resend({ apiKey: process.env.RESEND_API_KEY!, from: "App <auth@example.com>" }) },
  socialProviders: {
    google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! },
    github: { clientId: process.env.GITHUB_CLIENT_ID!, clientSecret: process.env.GITHUB_CLIENT_SECRET! },
  },
});
// Deployment command only: review await migrateAuth(auth), back up, then apply explicitly.
// await migrateAuth(auth, true);
```

Generate a 32-byte secret once and persist it outside the repository:

```sh
bun -e 'console.log(crypto.getRandomValues(new Uint8Array(32)).toBase64({alphabet:"base64url",omitPadding:true}))'
```

Remote HTTP origins, weak/missing secrets and unsafe callback paths are refused. Local loopback
HTTP needs `allowInsecureLocalhost: true`. Set `baseURL` from trusted configuration, never from
incoming Host or forwarding headers. All application callbacks must use this exact origin.
Provider secrets and the auth secret stay in `.server.ts` modules. OPTZ rejects the root,
SQLite, delivery and plugin imports in browser builds; browser code uses `@optz/auth/client`.

## Mount once, authenticate at the data boundary

```ts
// app/middleware.ts (lazy import avoids loading auth for public-only traffic)
import type { Middleware } from "optz";
const authRoutes: Middleware = async (ctx, next) => {
  if (ctx.url.pathname !== "/api/auth" && !ctx.url.pathname.startsWith("/api/auth/")) return next();
  return (await import("./lib/auth.server")).auth.handler(ctx.request);
};
export default [authRoutes];
```

Alternatively mount `auth.middleware`, or export `auth.handler` for GET/POST catch-all API routes.
Do not put an origin-checking middleware in front of OAuth callbacks that need cross-origin
provider POSTs; the auth engine validates their state and state cookie. Other HTTP mutations
require the configured Origin and reject cross-site fetch metadata, including requests without
Origin. Server-to-server callers of the HTTP handler must set it explicitly too.

```ts
// A private loader/API/data operation; constrain every SQL query by this user ID.
const { user } = await auth.requireSession(request);
const rows = db.query("SELECT * FROM notes WHERE user_id=?").all(user.id);
// Optional policy for sensitive features:
await auth.requireSession(request, { mfa: true, freshSeconds: 300 });
```

`requireSession` throws a private, no-store 401/403 Response. `mfa: true` requires enrollment;
the supported sign-in methods challenge enrolled users before issuing an authenticated session.
Sensitive credential changes also require a session created within five minutes. Native server
`auth.api.*` endpoints are available for trusted server code; they are **not** the HTTP abuse/
body-limit boundary. Forward untrusted traffic through `auth.handler`.

`getSession` performs an authoritative database lookup with cookie caching and refresh disabled.
This preserves immediate revocation. Browser `/get-session` handles normal refresh. Do not cache
sessions globally, put session tokens in browser storage, or treat a pending 2FA cookie as a session.
Keep authenticated page/API responses private and no-store, including app-authored responses.

## Browser client

```ts
import { createAuthClient, passkeyClient, twoFactorClient } from "@optz/auth/client";
export const client = createAuthClient({ plugins: [passkeyClient(), twoFactorClient()] });
await client.signIn.social({ provider: "google", callbackURL: "/account" });
await client.passkey.addPasskey({ name: "My security key" });
await client.signIn.passkey();
// Handle data.twoFactorRedirect before navigating to protected content.
await client.twoFactor.verifyTotp({ code, trustDevice: false });
// Or: client.twoFactor.verifyBackupCode({ code, trustDevice: false }).
```

For enrollment, call `client.twoFactor.enable({ password })`, display/save its backup codes and
add the TOTP secret to an authenticator. Verify a TOTP code before claiming protection is enabled.
Passwordless users can enroll without a password; credential accounts still require theirs.
Enrollment revokes older sessions. Password changes/recovery and MFA re-enrollment invalidate
pending challenges/trusted-device records. OAuth and email-link MFA callbacks redirect to
`twoFactor.page` (default `/login?mfa=1`) while preserving the pending challenge cookie.

Select email, magic-link, phone, username, organization, admin or multi-session client plugins
explicitly from the same browser entry. Passkeys require a secure context (or localhost), a
compatible browser and an authenticator that supports user verification. No biometric data is
sent to this server. The Chromium suite covers real WebAuthn ceremonies with a virtual authenticator.

## Extensions

```ts
import { organization, admin, genericOAuth, multiSession } from "@optz/auth/plugins";
// Pass as createAuth({ ..., plugins: [...] }), then migrate the expanded schema.
organization({ requireEmailVerificationOnInvitation: true, membershipLimit: 100 });
admin({ defaultRole: "user", adminUserIds: ["a-user-id-selected-by-your-trusted-admin-process"] });
genericOAuth({ config: [{
  providerId: "company", clientId: "...", clientSecret: "...",
  discoveryUrl: "https://idp.example.com/.well-known/openid-configuration",
  requireIdTokenVerification: true, scopes: ["openid", "email", "profile"], pkce: true,
}] });
```

Organization invitations need a real `sendInvitationEmail` callback; reserve delivery budgets
for it too. Roles and tenant membership never replace owner/tenant predicates in application SQL.
Do not expose admin impersonation or role assignment to ordinary users. New protocols/plugins
need their own policy tests; the MFA contract here covers the built-in sign-ins and generic OAuth.

## Resource and storage contracts

- Default limits: 240 requests/minute, 30 mutations/minute, four concurrent auth requests,
  128 KiB actual body bytes, ten-second body reads. No unbounded password-work queue.
- Default global delivery budgets: 60 emails/minute and ten SMS/minute; each destination/purpose
  has a 30-second resend cooldown. Some enumeration-resistant upstream endpoints intentionally
  return a generic success even when no message is sent. Limits may consume budget on failed sends.
- `clientKey` is an optional trusted identity resolver. Default requests share one bucket;
  arbitrary `X-Forwarded-For` values never bypass it. Do not implement the resolver by accepting
  caller-controlled headers without a trusted ingress that overwrites and validates them.
- The default memory budget is bounded/per-process. `sqliteBudget(db)` uses atomic capped counters
  shared by workers on one machine. Both fail closed at capacity. For multiple machines, supply
  a `RequestBudget` whose consume operation is atomic in shared storage (e.g. Redis).
- SQLite uses WAL, foreign keys, a busy timeout, private files and explicit upstream migrations.
  Review schema changes before applying them and back up with SQLite's online backup API. New
  required fields on populated tables are refused when an unsafe backfill would be required.
  The SQLite helper also installs an atomic per-user passkey quota constraint. Other database
  adapters must add their own constraint for a strict cap under concurrent enrollment.
- Treat the database, backups and secret as credentials. OAuth tokens, TOTP secrets and backup
  codes are encrypted; email OTP/magic tokens are hashed. Upstream session tokens and short-lived
  phone OTP records are database-resident secrets, not a claim of hash-only storage for every field.
  This database is separate from the basic `optz/sessions` store; existing accounts need an explicit migration.
- `onEvent` provides only endpoint templates, method, status and duration. Dynamic reset/provider
  paths, queries, cookies, passwords and codes are excluded. Provider delivery failures are generic;
  auth telemetry and raw library logging are disabled.

## Verification and performance

Run `bun test packages/auth/test` and `bun node_modules/typescript/bin/tsc -p packages/auth/tsconfig.json`.
With Playwright installed, run `node packages/auth/test/passkeys.cjs`. CI covers both plus the OPTZ
example, server-only build boundaries, package exports/tarball and the existing framework suite.

`bun packages/auth/bench.ts --out packages/auth/bench-results.json` records cold import and warmed
session/bypass/budget samples with source provenance. This is an in-process microbenchmark on
in-memory SQLite, not network throughput, full-app latency or a comparison against Clerk.
The cost of password hashing is deliberate; weakening it for a speed number would reduce security.
The public application path should not call `getSession` unless it needs identity.

## Primary documentation

- [Better Auth](https://better-auth.com/docs/introduction), [Bun SQLite](https://better-auth.com/docs/adapters/sqlite), [security](https://better-auth.com/docs/reference/security).
- [OAuth providers](https://better-auth.com/docs/concepts/oauth), [generic OAuth/OIDC](https://better-auth.com/docs/plugins/generic-oauth).
- [Passkeys](https://better-auth.com/docs/plugins/passkey), [2FA](https://better-auth.com/docs/plugins/2fa), [phone](https://better-auth.com/docs/plugins/phone-number), [email OTP](https://better-auth.com/docs/plugins/email-otp), [magic links](https://better-auth.com/docs/plugins/magic-link).
- [Clerk's authentication strategies](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options), [MFA recovery](https://clerk.com/docs/guides/secure/mfa-recovery). These informed the capability list; there is no claim of drop-in Clerk compatibility.

### Local measurements (29 October 2026, Asia/Beirut)

Bun 1.4.4 on AMD EPYC 9V45 96-Core Processor. Five warmed samples; medians below.

| Operation | Median |
|---|---:|
| public middleware bypass (auth already imported) | 0.5 µs |
| anonymous session lookup | 15.73 µs |
| authenticated SQLite session lookup | 121.39 µs |
| persistent SQLite budget consume | 2.43 µs |

The separate cold-import probe took 125.9 ms with 48.1 MiB total process RSS
(not incremental auth memory). These costs are paid only by applications that import the package.
The example lazy route guard can keep auth out of public-only server traffic.

Validation: 28 auth tests (177 assertions), 111 framework tests (625 assertions), all seven app
type-checks/builds, isolated tarball installation and all five exports, real Chromium passkey/UV/MFA
checks, and the OPTZ example browser suite. The dependency audit reports no known vulnerabilities.
Live OAuth provider credentials and email/SMS gateways were not used during these tests; delivery
was captured locally and the OAuth exchange was exercised through a controlled provider adapter.
