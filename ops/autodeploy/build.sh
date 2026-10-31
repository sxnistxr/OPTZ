#!/usr/bin/env bash
# Frozen during migration; this entire script and all repository build code run as optz-build.
set -euo pipefail
export HOME=/var/cache/optz-build/home
export PATH=/opt/bun/bin:/opt/rust-1.99.1/bin:/usr/bin:/bin
export CARGO_HOME="$HOME/cargo"
export CARGO_TARGET_DIR=/var/cache/optz-build/target
export OPTZ_CACHE_DIR="$HOME/optz"
export BUN_INSTALL_CACHE_DIR="$HOME/bun"
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0
export NODE_ENV=development
work=/var/cache/optz-build/work
rm -rf "$work"
mkdir -p "$HOME" "$work/src" "$work/release/bin" "$work/release/web"
tar --no-same-owner -xf /var/lib/optz-deploy/source.tar -C "$work/src"
cd "$work/src"
bash portfolio/engine/build.sh --no-pgo
install -m 0755 "$CARGO_TARGET_DIR/release/twelve-iouring" "$work/release/bin/twelve-iouring"
bun install --frozen-lockfile
export NODE_ENV=production
(cd portfolio && bun ../framework/src/cli.ts check && bun ../framework/src/cli.ts build)
# Keep workspace links inside the release. Do not ship or install repository systemd/nginx files.
cp -a package.json bun.lock bunfig.toml framework packages node_modules apps "$work/release/web/"
# Runtime docs loaders read repository Markdown and benchmark data after the build, including
# when an unknown docs slug falls through to its dynamic API handler.
cp -a docs "$work/release/web/"
mkdir -p "$work/release/web/bench" "$work/release/web/portfolio/engine" "$work/release/web/ops"
install -m 0644 bench/results.json bench/fullstack-results.json "$work/release/web/bench/"
install -m 0644 portfolio/engine/README.md "$work/release/web/portfolio/engine/README.md"
install -m 0644 ops/README.md ops/RESTORE.md "$work/release/web/ops/"
mkdir -p "$work/release/web/portfolio"
tar --exclude=./engine -C portfolio -cf - . | tar --no-same-owner -xf - -C "$work/release/web/portfolio"
# The installed backup unit resolves its helper through the current release.
mkdir -p "$work/release/ops/backup"
install -m 0644 ops/backup/optz-backup.py "$work/release/ops/backup/optz-backup.py"
