#!/usr/bin/env bash
# Build and deploy a commit of this repo as /opt/optz/current, with health-checked rollback.
#   sudo bash ops/deploy.sh [repo-dir]       (default: the repo this script lives in)
#
# Layout: /opt/optz/releases/<sha>/{bin/twelve-iouring, ops/...}; /opt/optz/current -> one of them.
# Builds run as the unprivileged optz user with a shared cargo cache, so deploys after the first
# are incremental. If the new build fails, nothing changes. If the new release isn't healthy
# within 30 s, the previous release is restored.
set -euo pipefail
REPO="$(cd "${1:-$(dirname "$0")/..}" && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
[ -f /etc/optz/env ] || { echo "production not installed (run ops/install-prod.sh)" >&2; exit 1; }
SHA="$(git -C "$REPO" rev-parse --short=12 HEAD)"
REL=/opt/optz/releases/$SHA
SUB=submissions/rust-iouring-sxnistxr
CACHE=/var/cache/optz
PORT="$(sed -n 's/^PORT=//p' /etc/optz/env)"

if [ ! -x "$REL/bin/twelve-iouring" ]; then
  echo "deploy: building $SHA"
  src="$CACHE/src"
  rm -rf "$src" && mkdir -p "$src" "$CACHE/cargo" "$CACHE/target"
  git -C "$REPO" archive HEAD | tar -x -C "$src"
  if [ -f "$CACHE/vendor/sqlite3.c" ]; then mkdir -p "$src/$SUB/vendor" && cp "$CACHE"/vendor/sqlite3.* "$src/$SUB/vendor/"; fi
  chown -R optz:optz "$CACHE"
  runuser -u optz -- env HOME="$CACHE" CARGO_HOME="$CACHE/cargo" CARGO_TARGET_DIR="$CACHE/target" bash "$src/$SUB/build.sh"
  mkdir -p "$CACHE/vendor" && cp "$src/$SUB"/vendor/sqlite3.* "$CACHE/vendor/"
  mkdir -p "$REL/bin"
  install -m 0755 "$CACHE/target/release/twelve-iouring" "$REL/bin/twelve-iouring"
  cp -r "$src/ops" "$REL/ops"
  if [ -f "$src/frontend/package.json" ]; then
    echo "deploy: building the site"
    runuser -u optz -- env HOME="$CACHE" PATH="/opt/node/bin:$PATH" bash -c "cd '$src/frontend' && npm ci --no-audit --no-fund --loglevel=error && node build.mjs"
    cp -r "$src/frontend/dist" "$REL/site"
  fi
  echo "$SHA" > "$REL/REVISION"
fi

prev="$(readlink -f /opt/optz/current 2>/dev/null || true)"
if [ "$prev" = "$REL" ] && systemctl is-active --quiet optz; then
  echo "deploy: $SHA already live"
  exit 0
fi
ln -sfn "$REL" /opt/optz/current.new && mv -T /opt/optz/current.new /opt/optz/current
systemctl restart optz
for _ in $(seq 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    if systemctl is-active --quiet nginx && ! curl -fsS --max-time 2 -o /dev/null http://127.0.0.1/; then
      echo "deploy: warning: nginx isn't serving the site" >&2
    fi
    echo "deploy: $SHA is live"
    # Keep the five newest releases.
    ls -1dt /opt/optz/releases/* | tail -n +6 | grep -v -x -F "$REL" | xargs -r rm -rf
    exit 0
  fi
  sleep 1
done
echo "deploy: $SHA unhealthy after 30 s" >&2
journalctl -u optz -n 30 --no-pager >&2 || true
if [ -n "$prev" ] && [ -d "$prev" ]; then
  ln -sfn "$prev" /opt/optz/current.new && mv -T /opt/optz/current.new /opt/optz/current
  systemctl restart optz
  echo "deploy: rolled back to $(basename "$prev")" >&2
fi
exit 1
