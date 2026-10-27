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
SUB=portfolio/engine
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
  if [ -f "$src/portfolio/package.json" ]; then
    echo "deploy: type-checking and building the site"
    runuser -u optz -- env HOME="$CACHE" PATH="/opt/bun/bin:$PATH" bash -c "cd '$src' && bun install --frozen-lockfile && cd portfolio && bun ../framework/src/cli.ts check && bun ../framework/src/cli.ts build"
    mkdir -p "$REL/web"
    cp -a "$src/package.json" "$src/bunfig.toml" "$src/bun.lock" "$src/framework" "$src/node_modules" "$REL/web/"
    # The site without the engine's sources (the engine runs from $REL/bin).
    mkdir -p "$REL/web/portfolio" && (cd "$src/portfolio" && tar --exclude=./engine -cf - .) | tar -xf - -C "$REL/web/portfolio"
  fi
  echo "$SHA" > "$REL/REVISION"
fi

# nginx config generated from optz.config.ts, so proxies and caching can't drift apart. Checked on
# every run, not just new builds: once a Let's Encrypt certificate exists (certbot certonly), the
# config gains HTTPS and an http -> https redirect without waiting for the next commit.
if [ -d "$REL/web/portfolio" ]; then
  CERT_DIR="$(ls -d /etc/letsencrypt/live/*/ 2>/dev/null | head -n 1 || true)"
  (cd "$REL/web/portfolio" && /opt/bun/bin/bun ../framework/src/cli.ts nginx /opt/optz/current/web/portfolio/dist ${CERT_DIR:+--tls "$CERT_DIR"}) > "$REL/nginx.conf.new"
  mv "$REL/nginx.conf.new" "$REL/nginx.conf"
  if ! cmp -s "$REL/nginx.conf" /etc/nginx/sites-available/optz; then
    install -m 0644 "$REL/nginx.conf" /etc/nginx/sites-available/optz
    install -d -o www-data -g www-data /var/cache/nginx/optz   # nginx workers write the micro-cache
    if nginx -t; then systemctl reload nginx; else echo "deploy: nginx rejected the new config" >&2; fi
  fi
fi

prev="$(readlink -f /opt/optz/current 2>/dev/null || true)"
if [ "$prev" = "$REL" ] && systemctl is-active --quiet optz; then
  echo "deploy: $SHA already live"
  exit 0
fi
ln -sfn "$REL" /opt/optz/current.new && mv -T /opt/optz/current.new /opt/optz/current
# Keep the systemd units in step with the release (paths change between versions).
changed=0
for u in optz.service optz-web.service optz-backup.service optz-backup.timer; do
  src_unit="$(find "$REL/ops" -name "$u" -print -quit)"
  if [ -n "$src_unit" ] && ! cmp -s "$src_unit" "/etc/systemd/system/$u"; then install -m 0644 "$src_unit" "/etc/systemd/system/$u"; changed=1; fi
done
[ "$changed" = 1 ] && systemctl daemon-reload
systemctl restart optz
if [ -d "$REL/web" ]; then systemctl restart optz-web; fi
for _ in $(seq 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 \
     && { [ ! -d "$REL/web" ] || curl -fsS --max-time 2 -o /dev/null http://127.0.0.1:3001/; }; then
    # nginx only answers the site's own name (optz nginx refuses other Hosts): ask for it, locally.
    SITE_HOST="$(cd "$REL/web/portfolio" 2>/dev/null && /opt/bun/bin/bun -e 'const c=(await import("./optz.config.ts")).default; console.log(new URL(c.site?.url ?? "http://localhost").hostname)' 2>/dev/null || echo localhost)"
    if systemctl is-active --quiet nginx && ! curl -fsSk --max-time 2 -o /dev/null -L --resolve "$SITE_HOST:80:127.0.0.1" --resolve "$SITE_HOST:443:127.0.0.1" "http://$SITE_HOST/"; then
      echo "deploy: warning: nginx isn't serving the site" >&2
    fi
    echo "deploy: $SHA is live"
    # Cloudflare caches pages when the site sets server.cdnMaxAge: drop them so the new release
    # shows at once. Optional: set CF_ZONE_ID and CF_API_TOKEN (Zone > Cache Purge) in /etc/optz/env.
    CF_ZONE_ID="$(sed -n 's/^CF_ZONE_ID=//p' /etc/optz/env 2>/dev/null || true)"
    CF_API_TOKEN="$(sed -n 's/^CF_API_TOKEN=//p' /etc/optz/env 2>/dev/null || true)"
    if [ -n "$CF_ZONE_ID" ] && [ -n "$CF_API_TOKEN" ]; then
      if curl -fsS --max-time 15 -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
           -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" --data '{"purge_everything":true}' >/dev/null; then
        echo "deploy: Cloudflare cache purged"
      else
        echo "deploy: warning: Cloudflare cache purge failed" >&2
      fi
    fi
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
  if [ -d "$prev/web" ]; then systemctl restart optz-web; fi
  echo "deploy: rolled back to $(basename "$prev")" >&2
fi
exit 1
