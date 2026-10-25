#!/usr/bin/env bash
# Builds the server as a normal user. Downloads the pinned SQLite amalgamation (checksum-verified);
# crates are verified by Cargo.lock checksums.
set -euo pipefail
cd "$(dirname "$0")"
RUST=/opt/rust-1.99.1/bin
SQLITE_TARBALL=sqlite-autoconf-3540100
SQLITE_SHA256=926ef8d3eab93fbf6e06011901273eec076b25594a4e1cdadd50c987f4f6d64e

if [ ! -f vendor/sqlite3.c ]; then
  mkdir -p vendor
  curl -fsSL --retry 3 "https://www.sqlite.org/2026/$SQLITE_TARBALL.tar.gz" -o vendor/sqlite.tar.gz
  echo "$SQLITE_SHA256  vendor/sqlite.tar.gz" | sha256sum -c -
  tar -xzf vendor/sqlite.tar.gz -C vendor --strip-components=1 "$SQLITE_TARBALL/sqlite3.c" "$SQLITE_TARBALL/sqlite3.h"
  rm vendor/sqlite.tar.gz
fi

export PATH="$RUST:$PATH"
export CARGO_HOME="${CARGO_HOME:-$PWD/.cargo-home}"
export RUSTFLAGS="-C target-cpu=native ${RUSTFLAGS:-}"
cargo build --release --locked
