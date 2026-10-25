#!/usr/bin/env bash
# Foreground; configured only by SQLITE_PATH, JWT_SECRET, HOST, PORT.
exec "$(dirname "$0")/target/release/twelve-iouring"
