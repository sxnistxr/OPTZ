# Socket review: OPTZ 0.4.0

Reviewed 2026-10-31 against the [Socket dependency alerts](https://socket.dev/npm/package/@sxnistxr/optz/alerts/0.4.0?tab=dependencies).
These are fixes for the next release; the published 0.4.0 archive is immutable.

## Confirmed finding and packaging fix

**CVE-2026-45820 / GHSA-px8p-9vwx-vf98:** Satori 0.63.2 pins fflate 0.7.3.
The [advisory](https://github.com/advisories/GHSA-px8p-9vwx-vf98) identifies malformed ZIP64
archives that can hang unzipSync; 0.7.5 fixes the 0.7 branch. The workspace already overrode
fflate to 0.7.5, but root overrides do not propagate to consumers of an npm library.

The release now bundles Satori's resolved dependency tree. A Bun manifest patch changes its
fflate pin to 0.7.5, the existing override patches OpenType's compatible range too, and the
prepack check refuses unpatched trees. An isolated tarball installation without any consumer
overrides verifies both importers resolve 0.7.5 and renders an SVG through Satori. OG imports
remain lazy. Bundling increases the archive size and makes dependency refreshes part of release
maintenance; do not skip the isolated check when updating Satori or Bun.

Bun 1.4.3 audit of the isolated consumer still reports fflate 0.7.3 from registry dependency
metadata, despite the installed bundled resolutions being 0.7.5. The workspace audit is clean.
Socket may retain upstream metadata alerts until it analyzes a new release; no remote alert
was dismissed and no claim is made that the old version's alert page is cleared.

**Missing license:** the registry/Socket metadata for 0.4.0 has no license, and its archive
lacks LICENSE. The current manifest already declares MIT. The next archive explicitly includes
the repository's MIT license and THIRD-PARTY.md, plus bundled dependency notices.

## Security flags reviewed

- **OpenType development server:** @shuding/opentype.js@1.4.0-beta.0 bin/server.js does
  concatenate req.url into a filesystem read. OPTZ imports Satori's renderer, which uses the
  font parser; it never launches this upstream development server. Do not run that server
  on untrusted networks. The vulnerable utility remains in the upstream package.
- **picomatch@2.3.2 ReDoS:** the chain is Tailwind CLI → @parcel/watcher →
  micromatch → picomatch. The watcher converts ignore globs to regexes. OPTZ invokes the
  CLI for a project's CSS with fixed argv; it does not supply request-controlled globs.
  Treat project source/config as trusted build input. Follow-up investigation reproduced
  single-branch repeated-star backtracking covered by CVE-2026-112366 on 2.3.2. The proposed
  [2.x fix](https://github.com/micromatch/picomatch/pull/246) is awaiting upstream review;
  it is not installed by this OPTZ change. No released fix was established. Replacing it
  across major versions without compatibility evidence would not establish a fix.
- **WASM/N-API eval and worker flags:** Tailwind's oxide WASI fallback and emnapi expose
  host execution primitives as part of their native compatibility layer. The reported worker
  also has broad filesystem/environment access. These are build dependencies, not a sandbox
  for untrusted projects or WASM. No malicious payload was established by this review.
- **react-dom static.js native wrapper:** the installed 19.3.1 file matches the reported
  require('./static.node') wrapper. Native execution is expected for this entry point but
  the binary's provenance/behavior was not independently audited here. This remains a
  supply-chain review limitation, not a confirmed OPTZ exploit or a dismissed alert.
- **Other AI anomalies:** graceful-fs patches fs for retry handling; tapable generates
  plugin hooks; jiti evaluates trusted project modules; detect-libc probes the platform;
  oxide supports an environment-selected native module. Their capabilities require trusted
  build inputs and environment. High-entropy strings were reported in jiti's bundled code;
  no OPTZ credential leak was established. No blanket suppression was added.

## Remaining inventory warnings

Shell, filesystem, environment, network, dynamic require, debug, minification, eval and native
code warnings describe capabilities of the image/build toolchain. Removing these libraries
would remove supported features; this review does not equate capabilities with malware.
Sharp's tiny platform wrappers select native binaries rather than providing trivial standalone
business logic. New-author and age warnings are maintenance signals; the old Satori utility
packages remain upstream dependencies. The suggested string.prototype.codepointat replacement
is an optional Socket optimization, not a vulnerability patch.

The 40 copyleft/non-permissive matches largely enumerate platform variants of resvg/Satori/
Lightning CSS (MPL-2.0) and sharp/libvips (LGPL-3.0-or-later). Those notices remain applicable;
OPTZ's MIT declaration does not relicense dependencies. THIRD-PARTY.md identifies the bundled
Satori source and manifest modification. This review does not certify all native dependencies
or provide a license-policy approval.

## Verification

Run from the repository root:

```sh
bun install --frozen-lockfile
bun framework/scripts/check-package.ts
bun audit
bunx tsc --noEmit -p framework/tsconfig.json
bun run test
```

The package check packs the candidate, installs it outside the workspace, verifies the license
and patched OG resolution, renders an SVG, then checks starter types, production build and
hook islands in production/development. The prepack check also validates patched metadata
before publishing. Use Bun to install the workspace so patchedDependencies is applied.

Results against current main on local Bun 1.4.3: package/starter checks, framework type-check
and workspace audit pass (373 packages). All 149 framework tests pass (907 assertions).
CI uses the package's required Bun 1.4.4. The candidate archive is about 11.56 MB compressed
versus 164 KB before bundling; the renderer dependencies were already part of normal installs,
but are now delivered inside the framework archive.
