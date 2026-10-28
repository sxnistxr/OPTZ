#!/usr/bin/env bash
# Retired: never execute an automatically fetched repository hook as root.
set -euo pipefail
echo 'Automatic branch deployment is retired. Stop optz-sync.timer and promote a reviewed commit using ops/deploy.sh.' >&2
exit 1
