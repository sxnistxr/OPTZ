# OPTZ Auth example

An executable OPTZ application using the separate `@sxnistxr/optz-auth` workspace package. The public
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

## Optional module integration

This app now includes public `/status`, protected `/modules`, protected `/files` and an explicit
consent demo at `/metrics-demo`. The static homepage still initializes no modules or auth client.
Status views/admin forms and analytics meters render without JavaScript. Only files and consent
demos load their small islands, with no AWS/PostHog SDK in the browser.

Set `MODULES_ADMIN_USER_ID` to an existing verified account ID to grant administration; no
account is an admin by default. Set `ANALYTICS_HASH_SECRET` to enable local analytics. S3/R2/B2
uploads require `S3_BUCKET`, a fixed HTTPS `S3_ENDPOINT`, region and provider credentials or IAM.
`S3_SHA256=false` is an explicit compatibility choice for providers lacking that checksum mode.
Keep the bucket private and configure exact-origin PUT/checksum CORS. The files page alone adds
the configured storage origin to CSP. Quotas default to 1 GiB per owner and 100 MiB per upload.

Copy `optz.env.example.json` to `optz.env.json` to opt into the first-class Doppler workflow,
then select your project/config and follow the [environment guide](../../docs/DOPPLER.md).
The example contract enables no provider accounts and contains no secrets.

Full APIs, cleanup policies and integration boundaries are in the [module guides](../../docs/MODULES.md).
The analytics privacy API derives identity from the authenticated session for local export/delete;
clients must have deliberately identified that opaque account ID after consent for those events
to be associated with it. Anonymous in-memory visits are retained only under the configured policy.

Schedule `bun run modules:maintenance` under the same runtime environment to prune analytics
and clean expired/cancelled upload sessions. With Doppler use
`optz env run -- bun run modules:maintenance`. No maintenance timer starts on static requests.
Cancelled upload reservations remain counted for the signed-URL grace period before cleanup
can safely release them; provider lifecycle rules remain required as a backstop.
