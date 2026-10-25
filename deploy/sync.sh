#!/usr/bin/env bash
# Pulls the latest commit of $BRANCH into $APP_DIR. If the commit changed and
# deploy/post-deploy.sh exists, runs it (install deps, restart services, etc.).
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/optz}"
BRANCH="${BRANCH:-main}"

cd "$APP_DIR"
git fetch --quiet origin "$BRANCH"

old="$(git rev-parse HEAD)"
new="$(git rev-parse "origin/$BRANCH")"
[ "$old" = "$new" ] && exit 0

git reset --quiet --hard "$new"
git clean -fdq
echo "Updated $old -> $new"

if [ -f deploy/post-deploy.sh ]; then
  bash deploy/post-deploy.sh
fi
