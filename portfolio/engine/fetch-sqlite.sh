#!/usr/bin/env bash
# Puts the pinned SQLite amalgamation in vendor/ (sqlite3.c, sqlite3.h), checksum-verified
# against vendor.sha256. build.rs compiles it; build.sh and CI run this first.
set -euo pipefail
cd "$(dirname "$0")"
[ -f vendor/sqlite3.c ] && [ -f vendor/sqlite3.h ] && exit 0
read -r SHA TARBALL < vendor.sha256
NAME="${TARBALL%.tar.gz}"
mkdir -p vendor
curl -fsSL --retry 3 "https://www.sqlite.org/2026/$TARBALL" -o "vendor/$TARBALL"
echo "$SHA  vendor/$TARBALL" | sha256sum -c -
tar -xzf "vendor/$TARBALL" -C vendor --strip-components=1 "$NAME/sqlite3.c" "$NAME/sqlite3.h"
rm "vendor/$TARBALL"
echo "fetch-sqlite: vendor/sqlite3.c ($NAME)"
