#!/usr/bin/env bash
# Runs once as root on a clean Ubuntu 24.04. Installs a pinned, checksum-verified Rust toolchain
# from the official standalone tarball (no rustup, nothing piped into a shell).
set -euo pipefail
RUST_VERSION=1.99.1
RUST_DATE=2026-10-15
RUST_SHA256=231fcae47ee950621374725b5fc3b5441d2fbda2955ac45dd7dc816d8876cfe7
PREFIX=/opt/rust-$RUST_VERSION

apt-get update
apt-get install -y --no-install-recommends build-essential curl ca-certificates xz-utils

if [ ! -x "$PREFIX/bin/cargo" ]; then
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  name="rust-$RUST_VERSION-x86_64-unknown-linux-gnu"
  curl -fsSL --retry 3 "https://static.rust-lang.org/dist/$RUST_DATE/$name.tar.xz" -o "$tmp/rust.tar.xz"
  echo "$RUST_SHA256  $tmp/rust.tar.xz" | sha256sum -c -
  tar -xJf "$tmp/rust.tar.xz" -C "$tmp"
  "$tmp/$name/install.sh" --prefix="$PREFIX" --disable-ldconfig \
    --components=rustc,cargo,rust-std-x86_64-unknown-linux-gnu
fi
chmod -R a+rX "$PREFIX"
"$PREFIX/bin/rustc" --version
