#!/usr/bin/env bash
# Runs on the VPS from the repo root after each new commit is pulled (see deploy/sync.sh).
# Once production is installed (ops/install-prod.sh), every pulled commit is built and deployed
# with health-checked rollback. Until then this does nothing.
set -euo pipefail
if [ -f /etc/optz/env ]; then
  bash ops/deploy.sh "$PWD"
else
  echo "post-deploy: production not installed; skipping"
fi
