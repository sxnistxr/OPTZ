#!/usr/bin/env bash
# Runs on the VPS from the repo root after each new commit is pulled.
# Add whatever "go live" means for this project, e.g.:
#   npm ci && npm run build
#   systemctl restart optz
#   rsync -a --delete public/ /var/www/html/
set -euo pipefail
echo "post-deploy: nothing to do yet"
