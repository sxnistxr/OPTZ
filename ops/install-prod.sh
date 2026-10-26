#!/usr/bin/env bash
# One-time production install on Ubuntu 24.04 (run as root from a checkout of this repo).
#   sudo bash ops/install-prod.sh [--seed /path/to/feed.db] [--jwt-secret S]
#
# Creates the optz user and directories, the env file, the database (an empty schema, or a copy
# of --seed), installs the Rust toolchain, Node (for the site build), nginx, systemd units, the
# backup timer and the journald limit, then deploys the current commit.
#
# Layout: nginx on :80 serves the site and proxies /api/* to the API on 127.0.0.1:3000.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SEED="" PORT=3000 SECRET=""
NODE_VERSION=24.22.1
NODE_SHA256=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6
while [ $# -gt 0 ]; do
  case "$1" in
    --seed) SEED="$2"; shift 2 ;;
    --jwt-secret) SECRET="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

bash "$REPO/submissions/rust-iouring-sxnistxr/install.sh"
apt-get install -y --no-install-recommends python3 git curl nginx xz-utils
if [ ! -x /opt/node-v$NODE_VERSION/bin/node ]; then
  tmp="$(mktemp -d)"
  curl -fsSL --retry 3 "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" -o "$tmp/node.tar.xz"
  echo "$NODE_SHA256  $tmp/node.tar.xz" | sha256sum -c -
  mkdir -p /opt/node-v$NODE_VERSION
  tar -xJf "$tmp/node.tar.xz" -C /opt/node-v$NODE_VERSION --strip-components=1
  rm -rf "$tmp"
fi
ln -sfn /opt/node-v$NODE_VERSION /opt/node
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
    runuser -u optz -- python3 - "$REPO/submissions/rust-iouring-sxnistxr/tests/schema.sql" <<'PY'
import sqlite3, sys
db = sqlite3.connect("/var/lib/optz/feed.db")
db.execute("PRAGMA journal_mode=WAL")
db.executescript(open(sys.argv[1]).read())
db.close()
PY
  fi
fi

install -m 0644 "$REPO/ops/systemd/optz.service" /etc/systemd/system/optz.service
install -m 0644 "$REPO/ops/backup/optz-backup.service" /etc/systemd/system/optz-backup.service
install -m 0644 "$REPO/ops/backup/optz-backup.timer" /etc/systemd/system/optz-backup.timer
install -d /etc/systemd/journald.conf.d
install -m 0644 "$REPO/ops/journald/optz.conf" /etc/systemd/journald.conf.d/optz.conf
install -m 0644 "$REPO/ops/nginx/optz.conf" /etc/nginx/sites-available/optz
ln -sfn /etc/nginx/sites-available/optz /etc/nginx/sites-enabled/optz
rm -f /etc/nginx/sites-enabled/default
systemctl daemon-reload
systemctl restart systemd-journald
systemctl enable optz.service optz-backup.timer
bash "$REPO/ops/deploy.sh" "$REPO"
nginx -t && systemctl enable --now nginx && systemctl reload nginx
systemctl start optz-backup.timer
echo "installed: site on http://<this box>/, API under /api"
echo "mint a posting token: sudo python3 /opt/optz/current/ops/mint-token.py <username>"
