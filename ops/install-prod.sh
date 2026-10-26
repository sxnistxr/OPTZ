#!/usr/bin/env bash
# One-time production install on Ubuntu 24.04 (run as root from a checkout of this repo).
#   sudo bash ops/install-prod.sh [--seed /path/to/feed.db] [--jwt-secret S]
#
# Creates the optz user and directories, the env file, the database (an empty schema, or a copy
# of --seed), installs the Rust toolchain, Bun (the site runs on the optz framework), nginx, systemd units, the
# backup timer and the journald limit, then deploys the current commit.
#
# Layout: nginx on :80; /api/social/* -> the Rust engine on 127.0.0.1:3000; pages and /api/* ->
# the portfolio on Bun
# (127.0.0.1:3001); /assets/* straight from disk.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SEED="" PORT=3000 SECRET=""
BUN_VERSION=1.4.4
# sha512 "integrity" of @oven/bun-linux-x64@1.4.4 from the npm registry.
BUN_SHA512=CHbbkmHVM28T1GFq+6GL4Ao4ujwwYwj1CxFFwEFzLanPfNsId9AhbIP0Q4reWuWBkGimUkoQygrK7Rgjtj3vog==
while [ $# -gt 0 ]; do
  case "$1" in
    --seed) SEED="$2"; shift 2 ;;
    --jwt-secret) SECRET="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

bash "$REPO/portfolio/engine/install.sh"
apt-get install -y --no-install-recommends python3 git curl nginx openssl
if [ ! -x /opt/bun-$BUN_VERSION/bin/bun ]; then
  tmp="$(mktemp -d)"
  curl -fsSL --retry 3 "https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-$BUN_VERSION.tgz" -o "$tmp/bun.tgz"
  got="$(openssl dgst -sha512 -binary "$tmp/bun.tgz" | openssl base64 -A)"
  [ "$got" = "$BUN_SHA512" ] || { echo "bun tarball checksum mismatch: $got" >&2; exit 1; }
  tar -xzf "$tmp/bun.tgz" -C "$tmp"
  install -D -m 0755 "$tmp/package/bin/bun" /opt/bun-$BUN_VERSION/bin/bun
  rm -rf "$tmp"
fi
ln -sfn /opt/bun-$BUN_VERSION /opt/bun
id optz >/dev/null 2>&1 || useradd --system --home /var/lib/optz --shell /usr/sbin/nologin optz
install -d -o optz -g optz -m 0750 /var/lib/optz /var/backups/optz /var/cache/optz
install -d -m 0755 /opt/optz/releases
install -d -m 0750 -g optz /etc/optz

if [ ! -f /etc/optz/env ]; then
  [ -n "$SECRET" ] || SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  umask 027
  cat > /etc/optz/env <<ENV
SQLITE_PATH=/var/lib/optz/feed.db
JWT_SECRET=$SECRET
HOST=127.0.0.1
PORT=$PORT
ENV
  chgrp optz /etc/optz/env
fi

if [ ! -f /var/lib/optz/feed.db ]; then
  if [ -n "$SEED" ]; then
    install -o optz -g optz -m 0640 "$SEED" /var/lib/optz/feed.db
  else
    runuser -u optz -- python3 - "$REPO/portfolio/engine/tests/schema.sql" <<'PY'
import sqlite3, sys
db = sqlite3.connect("/var/lib/optz/feed.db")
db.execute("PRAGMA journal_mode=WAL")
db.executescript(open(sys.argv[1]).read())
db.close()
PY
  fi
fi

install -m 0644 "$REPO/ops/systemd/optz.service" /etc/systemd/system/optz.service
install -m 0644 "$REPO/ops/systemd/optz-web.service" /etc/systemd/system/optz-web.service
install -m 0644 "$REPO/ops/backup/optz-backup.service" /etc/systemd/system/optz-backup.service
install -m 0644 "$REPO/ops/backup/optz-backup.timer" /etc/systemd/system/optz-backup.timer
install -d /etc/systemd/journald.conf.d
install -m 0644 "$REPO/ops/journald/optz.conf" /etc/systemd/journald.conf.d/optz.conf
# The real nginx config is generated from portfolio/optz.config.ts on each deploy; this is the
# first one, so nginx can start.
install -m 0644 "$REPO/ops/nginx/optz.conf" /etc/nginx/sites-available/optz
install -d -o www-data -g www-data /var/cache/nginx/optz
ln -sfn /etc/nginx/sites-available/optz /etc/nginx/sites-enabled/optz
rm -f /etc/nginx/sites-enabled/default
systemctl daemon-reload
systemctl restart systemd-journald
systemctl enable optz.service optz-web.service optz-backup.timer
bash "$REPO/ops/deploy.sh" "$REPO"
nginx -t && systemctl enable --now nginx && systemctl reload nginx
systemctl start optz-backup.timer
echo "installed: site on http://<this box>/, API under /api"
echo "mint a posting token: sudo python3 /opt/optz/current/ops/mint-token.py <username>"
