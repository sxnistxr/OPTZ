#!/usr/bin/env bash
# Builds the server as a normal user. fetch-sqlite.sh downloads the pinned SQLite amalgamation (checksum-verified);
# crates are verified by Cargo.lock checksums.
set -euo pipefail
cd "$(dirname "$0")"
RUST=/opt/rust-1.99.1/bin   # the toolchain rust-toolchain.toml pins, installed for the build user

./fetch-sqlite.sh

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
