#!/usr/bin/env bash
# Migration for installations of the old privileged branch-polling service.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo 'Run as root to retire the old timer.' >&2; exit 1; }
systemctl disable --now optz-sync.timer optz-sync.service 2>/dev/null || true
echo 'Automatic root branch deployment disabled. Install production with ops/install-prod.sh and deploy reviewed commits with ops/deploy.sh.'
