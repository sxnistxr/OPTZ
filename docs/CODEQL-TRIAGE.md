# CodeQL review, 2026-10-31

Reviewed all 30 open alerts against main `341af0cf03382f0800337b5f90f8eb68966569b5`.
The fixes close Python files explicitly, make missing process metrics fail explicitly, remove
unused names, and express expected process/socket termination without empty exception handlers.
These address alerts 1–8, 10–19, 21, 23, 24 and 61 (22 alerts). GitHub must analyze the updated
commit before their status can be confirmed.

The remaining eight alerts do not establish vulnerabilities. No query has been disabled and
no GitHub alert has been dismissed. Keep the following boundaries when changing these sites:

| Alert | Location | Review evidence |
|---|---|---|
| 60, `py/overly-permissive-file` | `ops/migrate-autodeploy.py`, `write()` | Default mode is 0600; callers explicitly choose 0755 for executable helpers, 0644 for public SSH authorized keys, and 0440 for sudoers. Private keys and GitHub secret files use 0600. Atomic replacement never follows an existing destination symlink. Migration tests verify these modes. |
| 58, `js/http-to-file-access` | `framework/src/file-io.ts`, `writeFileAtomic()` | Remote download bytes are file contents. They do not choose this helper's destination. Writes use an exclusive temporary file and rename, replacing destination symlinks. File-I/O regressions cover the symlink boundary. |
| 41, `js/http-to-file-access` | `framework/src/fonts.ts`, `buildFonts()` | Build-time font data is written under `assetsDir`; names contain a sanitized family, a subset restricted to word characters/hyphens, and a content digest. A remote font cannot supply a filesystem path. |
| 39–40, `js/http-to-file-access` | `framework/src/build.ts`, `buildCss()` | Paths are the build's fixed `styles.tmp.css` and a digest-named asset under its output directory. Downloaded CSS contributes contents, not path components. The build runs under the deployment build account. |
| 38, `js/file-access-to-http` | `framework/src/net-cache.ts`, `cachedFetch()` | A cached font stylesheet supplies HTTPS font URLs during a trusted project build. The outgoing request has no local-file contents or credentials in its body; local bytes are only the stale-download fallback. This helper is not exposed as a request-time fetch proxy. |
| 43–44, `rust/hard-coded-cryptographic-value` | `portfolio/engine/src/jwt.rs`, `tests` | Both constants occur inside `#[cfg(test)]`: one signs test fixtures, the other verifies rejection of a wrong key. Production reads and validates `JWT_SECRET` in `src/main.rs`; these constants are not compiled into production. |

Revisit the JavaScript classifications if untrusted requests ever gain control of build
configuration, output directories, or download request credentials.
