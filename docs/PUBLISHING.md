# Publishing to npm

The framework and the optional modules publish under the `@sxnistxr` scope:

| directory | npm package |
|---|---|
| `framework` | `@sxnistxr/optz` |
| `packages/auth` | `@sxnistxr/optz-auth` |
| `packages/analytics` | `@sxnistxr/optz-analytics` |
| `packages/db` | `@sxnistxr/optz-db` |
| `packages/status` | `@sxnistxr/optz-status` |
| `packages/uploads` | `@sxnistxr/optz-uploads` |

Apps import the framework as `optz`, and the build writes `optz/...` imports into generated
client code, so it must be installed under that name with an npm alias:

```sh
bun add optz@npm:@sxnistxr/optz @sxnistxr/optz-auth
```

The modules declare that same alias as a peer dependency (`"optz": "npm:@sxnistxr/optz@>=0.4.0"`).
In this workspace every app depends on `"optz": "workspace:@sxnistxr/optz@*"`.

## Release

Bump `version` in each package you are releasing, then from the repository root:

```sh
bun install
bun run test && bun run test:modules
bun packages/check-modules.ts && bun packages/auth/scripts/check-package.ts && bun framework/scripts/check-package.ts
npm login
(cd framework && npm publish)
for m in auth analytics db status uploads; do (cd packages/$m && npm publish); done
```

Publish the framework first when a module needs a newer framework version. Every package sets
`publishConfig.access` to `public`. Add `--otp=<code>` when your npm account uses two-factor
authentication, and `--dry-run` to see what would be uploaded. A published version cannot be
replaced, so bump the version for each release.

The framework bundles Satori's dependency tree with patched fflate. Install with Bun first
so the Satori manifest patch is applied. Its prepack guard and isolated tarball check must
pass; a clean workspace audit alone does not verify consumer dependencies. See
[the Socket review](SOCKET-REVIEW.md) for the finding and remaining inventory warnings.
