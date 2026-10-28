# OPTZ Auth example

An executable OPTZ application using the separate `@optz/auth` workspace package. The public
landing page is static. The interactive login/account panels load only on pages with auth islands.
Authentication state initializes lazily; no schema migrations run in request handlers.

```sh
bun install                 # from the repository root
cd apps/auth
cp .env.example .env
bun -e 'console.log(crypto.getRandomValues(new Uint8Array(32)).toBase64({alphabet:"base64url",omitPadding:true}))'
# Put the generated value in AUTH_SECRET in .env. Keep it stable and outside Git.
# Configure Resend, Twilio, or an OAuth application in .env.
bun run migrate
bun run dev
```

Open **http://localhost:3008**. Use that exact origin for WebAuthn and provider callbacks.
Resend enables verified email/password, email codes, magic links and recovery. Twilio enables
phone codes only for `SMS_ALLOWED_PREFIXES`; set a spending cap in the provider account too.
Without delivery/provider configuration, registration remains unavailable. No codes are printed
to the console and no mock identity provider is enabled in this application.

Register `PUBLIC_URL/api/auth/callback/PROVIDER` with Google, GitHub, Microsoft, Apple, Discord
or another configured provider. Apple needs a valid rotating client-secret JWT. Other providers
may require additional scopes or app review; configure their typed options in `auth.server.ts`.

After sign-in, open `/account` to add a passkey or enroll a TOTP authenticator and save its
recovery codes. Activate TOTP by entering a code after setup. The login panel supports authenticator
and recovery challenges after OAuth, email codes, links, phone codes and passkeys as well as passwords.
Recovery codes are displayed only when generated and stay out of persistent browser storage.

Production needs HTTPS, an explicit `PUBLIC_URL`, a private persistent `AUTH_DATABASE_PATH`,
backups, and an explicit migration step before starting the Bun service. Public requests should
go through the constrained reverse proxy; limit auth routes at ingress as well. The supplied
SQLite budget is shared across workers on this machine. The default HTTP budget is shared across
all callers; inject a trusted socket/ingress identity or a shared rate limiter when scaling.

The existing repository VPS workflow deploys the portfolio. Deploy this example as its own Bun
service with its own environment and data directory. It does not migrate the basic fullstack
starter's accounts or replace the portfolio's authentication automatically.

See [the package guide](../../packages/auth/README.md) for APIs, security contracts, extensions,
supported methods, benchmarks, and the difference from a hosted identity service.
