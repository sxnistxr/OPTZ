#!/usr/bin/env bash
# One-time VPS setup: clones the repo and installs a systemd timer that keeps
# the checkout in sync with GitHub. Run as root (or with sudo) on the VPS:
#
#   curl -fsSL https://raw.githubusercontent.com/sxnistxr/OPTZ/main/deploy/setup-vps.sh | sudo bash
#
# Optional overrides: REPO_URL, BRANCH, APP_DIR, INTERVAL (systemd time span).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/sxnistxr/OPTZ.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/srv/optz}"
INTERVAL="${INTERVAL:-30s}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo bash setup-vps.sh)" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y git
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y git
  elif command -v yum >/dev/null 2>&1; then
    yum install -y git
  else
    echo "Install git manually, then re-run." >&2
    exit 1
  fi
fi

if [ ! -d "$APP_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cat > /etc/default/optz-sync <<CONF
APP_DIR=$APP_DIR
BRANCH=$BRANCH
CONF

cat > /etc/systemd/system/optz-sync.service <<UNIT
[Unit]
Description=Sync $APP_DIR with GitHub ($BRANCH)
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/default/optz-sync
ExecStart=/bin/bash $APP_DIR/deploy/sync.sh
UNIT

cat > /etc/systemd/system/optz-sync.timer <<UNIT
[Unit]
Description=Poll GitHub for OPTZ changes every $INTERVAL

[Timer]
OnBootSec=30s
OnUnitActiveSec=$INTERVAL
AccuracySec=1s

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now optz-sync.timer
systemctl start optz-sync.service

echo
echo "Done. $APP_DIR now tracks $BRANCH every $INTERVAL."
echo "Logs:   journalctl -u optz-sync.service -f"
echo "Status: systemctl list-timers optz-sync.timer"
