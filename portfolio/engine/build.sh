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
TARGET="${CARGO_TARGET_DIR:-$PWD/target}"

# Plain build first: it's the fallback if PGO can't run, and it's what tests use.
cargo build --release --locked

# SQLite PGO (build.rs, BENCHMARKS.md section 8): instrument SQLite, train on a synthetic
# database generated here (never the challenge seed), rebuild with the profile. The profiled
# objects live in their own target dir so the profile matches their paths. Any failure keeps
# the plain build. `bash build.sh --no-pgo` skips it.
if [ "${1:-}" != "--no-pgo" ] && command -v python3 >/dev/null; then
  PGO_TARGET="$TARGET/pgo"
  PGO_DATA="$PGO_TARGET/profile"
  if rm -rf "$PGO_DATA" \
    && TWELVE_SQLITE_PGO="gen:$PGO_DATA" cargo build --release --locked --target-dir "$PGO_TARGET" \
    && python3 bench/pgo_train.py "$PGO_TARGET/release/twelve-iouring" "$PGO_TARGET/train" \
    && TWELVE_SQLITE_PGO="use:$PGO_DATA" cargo build --release --locked --target-dir "$PGO_TARGET"; then
    cp "$PGO_TARGET/release/twelve-iouring" "$TARGET/release/twelve-iouring.pgo"
    mv "$TARGET/release/twelve-iouring.pgo" "$TARGET/release/twelve-iouring"
    rm -rf "$PGO_TARGET/train"
    echo "build: SQLite PGO applied"
  else
    echo "build: PGO step failed; keeping the plain build" >&2
    cargo build --release --locked
  fi
fi
