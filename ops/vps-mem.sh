#!/usr/bin/env bash
# Memory per idle connection on this box (run as root from anywhere):
#   bash /srv/optz/ops/vps-mem.sh
set -uo pipefail
cd "$(dirname "$0")/../portfolio/engine"
SEED=/root/optz-validate/challenge/seed/feed.db
ulimit -n 1048576
swapoff -a
for n in 40000 80000; do
  timeout 900 python3 tests/connmem.py --seed "$SEED" --conns "$n" --sources 400 2>&1 | tail -16
done
swapon -a
