# Environment variables and Doppler

OPTZ treats Doppler as a startup environment source. Your app declares the variables it needs;
normal `optz dev`, `build`, `start`, `check` and `export` load and validate them before importing
the application config. No secrets SDK, polling or environment fetch runs on the request path.

## Start with a contract

Install the [official Doppler CLI](https://docs.doppler.com/docs/cli) on the machine where you
run OPTZ. Authentication and encrypted fallbacks remain owned by that CLI, not a second OPTZ
credential store.

```sh
# In your app directory
bunx optz env init --project my-app --config dev
bunx optz env login
bunx optz env setup
```

`init` creates `optz.env.json`. If `.env.example` exists it imports **names only**, never the
example's values. It refuses to overwrite an existing manifest. Review the generated rules:
they begin as required strings because OPTZ cannot infer your application's policy.

```json
{
  "doppler": {
    "project": "my-app",
    "config": { "development": "dev_personal", "production": "prd", "test": "dev_test" },
    "watch": false
  },
  "variables": {
    "DATABASE_URL": { "type": "url" },
    "AUTH_SECRET": { "type": "string" },
    "PORT": { "type": "number", "default": "3001" },
    "FEATURE_UPLOADS": { "type": "boolean", "default": "false" },
    "LOG_LEVEL": { "values": ["info", "warn", "error"], "default": "info" },
    "PUBLIC_API_ORIGIN": { "type": "url", "public": true },
    "OPTIONAL_KEY": { "optional": true }
  }
}
```

Commit the contract: it contains names and non-secret defaults. Never put credentials in
`default`. `DOPPLER_*` names and OPTZ's bootstrap marker are reserved for the provider/control
plane. For editor completion, point `$schema` at `node_modules/optz/schema/env.schema.json`
(or `../../framework/schema/env.schema.json` in this repository's example apps).

The checked-in [auth/modules example contract](../apps/auth/optz.env.example.json) demonstrates
the complete setup. Copy it to `optz.env.json` only when you are ready to enable Doppler.
Without a manifest, existing `.env` and process-environment workflows keep working.

## Develop normally

```sh
bun run dev
bun run check
bun run build
bun run start
```

The command selects the config mapped to `NODE_ENV`, asks `doppler run` to inject values,
then re-enters OPTZ once. Declared inherited values are cleared before injection unless named
in `doppler.preserve`. The re-entered Bun process disables automatic `.env` loading, so an old
dotenv file cannot silently fill a required secret missing from Doppler. Defaults are applied
after injection, and the contract is validated before `optz.config.ts` executes.

Development defaults to `NODE_ENV=development`; build/start default to production. An explicitly
set `NODE_ENV` wins. Every configured mode must have a mapping, or startup fails. You can omit
project/config selection to use the CLI's scoped setup or a config-scoped service token.

`"preserve": ["PORT"]` deliberately allows a local override for that variable. Avoid preserving
all environment values: a stale credential must not unexpectedly override the source of truth.

`"watch": true` opts development into Doppler's upstream **beta** restart-on-secret-change
behavior. Otherwise values are a process-start snapshot; restart after rotation. Restart the
outer `optz dev` command after changing the manifest's project/config mapping. Ordinary source
changes keep OPTZ's existing fast dev rebuild path.

## Validate and manage without dumping secrets

| Command | Behavior |
|---|---|
| `optz env doctor` | Local manifest, selection, declared names, CLI/token presence; no values or network |
| `optz env check` | Inject and validate required values, types and enums; errors show names/reasons only |
| `optz env list` | Doppler secret **names only** |
| `optz env set API_KEY` | Read the value from stdin; mutation output is suppressed |
| `optz env get API_KEY --reveal` | Explicitly print one secret; without `--reveal` it refuses |
| `optz env delete API_KEY --confirm` | Explicit deletion; provider values are not printed |
| `optz env diff --config prd` | Added, removed and changed **names**, never values |
| `optz env types` | Validate and generate declarations plus the public allowlist |
| `optz env public` | Validate and regenerate the public JSON/declarations |
| `optz env run -- COMMAND ARGS` | Validate, inject and run an arbitrary process without shell concatenation |

For automation, feed `set` through stdin rather than putting a secret on the command line.
OPTZ never invokes a shell to interpolate a command or secret value. Provider/write failures
are reported without echoing a provider response that might contain secrets.

`diff` fetches the two configs into bounded memory through the official CLI with file/fallback
output disabled. A failed or oversized comparison fails without printing its payload.

## Typed server access

Use the same shape with `readEnv` when an application module needs parsed values:

```ts
// app/lib/environment.server.ts
import { readEnv } from "optz/env";

export const environment = readEnv({
  DATABASE_URL: { type: "url" },
  MAX_UPLOAD_BYTES: { type: "number", default: "104857600" },
  UPLOADS_ENABLED: { type: "boolean", default: "false" },
} as const);

// MAX_UPLOAD_BYTES is a number; UPLOADS_ENABLED is a boolean.
```

Supported types are string, finite number, exact `true`/`false`, JSON and URL. URL rules accept
HTTP(S), PostgreSQL, MySQL and Redis connection schemes. Required empty values fail. Optional
empty values become undefined. `values` restricts the original string to an enum. Defaults
are strings, parsed through the same rule. Returned objects are frozen.

The generated `.optz/env.d.ts` augments `process.env` with string-valued names; the route type
file references it automatically. `readEnv` supplies the parsed TypeScript types. Validation
never includes the actual invalid value in its error.

## Public browser values are explicit

Only variables with **both** a `PUBLIC_` name and `"public": true` enter
`.optz/env.public.json`. All other values stay out of generated browser data. There is no
automatic prefix-wide exposure and no `process.env` object serialization.

```ts
// Browser code: import the generated, explicitly selected build-time snapshot.
import settings from "../../.optz/env.public.json";
console.log(settings.PUBLIC_API_ORIGIN);
```

Dev/build/export/check generate the public snapshot. A production startup validates private
runtime values but does not rewrite built browser assets. Rebuild when a public value changes.
Keep `.optz/` ignored. `optz/env`, private modules and provider/server package exports are rejected
when they enter a browser dependency graph.

An explicit public variable is public by design. Do not mark a password or private token public
even if you have named it with a `PUBLIC_` prefix.

## Production, CI and containers

Use a [config-scoped service token](https://docs.doppler.com/docs/service-tokens) with the least
access needed. Store `DOPPLER_TOKEN` in your CI secret store, systemd credentials/environment
file, or container secret mechanism. Never commit it, pass it as an argv flag, bake it into an
image, or use it as a build argument.

```sh
# DOPPLER_TOKEN is already supplied by the runtime's secret mechanism.
NODE_ENV=production bun run start
```

Install the verified official CLI in the runtime image if startup uses the manifest. Build
and startup may use separate tokens/configs: the public browser snapshot is fixed at build
time, while private services use the production process's injected values.

Encrypted CLI fallbacks are enabled by default in development and disabled by default in
production (`--no-fallback`). Set `"fallback": true` explicitly if your production outage policy
permits Doppler's encrypted local cache. Manage its age, file permissions, backup/rotation and
revocation policy using the native CLI. OPTZ does not write a plaintext fallback or invent a
second encryption system.

Dynamic-secret leases, scoped setup, branches, service-token management, config history,
rollback, integrations and native offline modes remain available through the same tool:

```sh
optz env doppler configs
optz env doppler secrets --only-names
optz env doppler --help
```

This explicit advanced command preserves Doppler's native output and flags. Unlike the safe
wrappers, native commands can intentionally display/export values. Use the
[CLI reference](https://docs.doppler.com/docs/cli) for those operations. Dynamic leases require
the appropriate provider/runtime lifecycle; a static process snapshot is not a lease-renewal
service.

## Failure behavior and verification

A missing CLI, login failure, unmapped mode, missing required variable or invalid value prevents
startup. Production does not silently fall back to dotenv or continue with partial secrets.
HTTP handlers do not contact Doppler, so ordinary request latency and public static serving
do not depend on its availability after a successful start.

The integration tests use a fake provider executable to exercise the actual OPTZ CLI,
single injection, redaction and generation without accessing a live account. A live deployment
still needs your project/config, scoped token and operational fallback/rotation policy.
