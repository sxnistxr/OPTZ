#!/usr/bin/env bash
# Installs the remote test runner as a systemd service on port 80.
#   sudo bash /srv/optz/ops/runner/install.sh <secret>
set -euo pipefail
SECRET="${1:?usage: install.sh <secret>}"
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
install -d -m 700 /etc/optz-runner /var/lib/optz-runner
umask 077; printf '%s\n' "$SECRET" > /etc/optz-runner/secret
cat > /etc/systemd/system/optz-runner.service <<UNIT
[Unit]
Description=OPTZ remote test runner (signed commands on :80)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/python3 /srv/optz/ops/runner/runner.py
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now optz-runner.service
systemctl restart optz-runner.service
sleep 1
curl -fsS http://127.0.0.1/ping && echo && echo "runner is up"
