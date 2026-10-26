#!/usr/bin/env bash
# Would native code serve the site faster? The same built pages, on one pinned core:
#   optz (Bun, JavaScript)  vs  the optz single executable  vs  nginx (C) serving dist/static
# nginx gets the same security headers and pre-compressed files (gzip_static; it has no brotli
# module here, so it sends gzip where optz sends brotli).
#   bash bench/native.sh      (needs nginx, wrk, taskset; run `optz build --compile` in portfolio first)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
DIST=$ROOT/portfolio/dist
DUR=${DUR:-10}
SLUG=$(ls portfolio/content/blog | head -1 | sed 's/\.md$//')
PATHS=("/" "/blog/$SLUG" "/api/blog")
TMP=$(mktemp -d)
CSP="default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"

cat >"$TMP/nginx.conf" <<CONF
worker_processes 1;
pid $TMP/nginx.pid;
error_log $TMP/error.log;
events { worker_connections 4096; }
http {
  access_log off;
  include /etc/nginx/mime.types;
  sendfile on; tcp_nopush on; tcp_nodelay on;
  keepalive_requests 1000000;
  server {
    listen 127.0.0.1:3021;
    root $DIST/static;
    gzip_static on;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Content-Security-Policy "$CSP" always;
    add_header X-Frame-Options DENY always;
    location = /api/blog { default_type application/json; try_files /_optz/api/api/blog =404; }
    location / { try_files \$uri \$uri/index.html =404; }
  }
}
CONF

bench() { # name base
  for p in "${PATHS[@]}"; do
    local bytes=$(curl -s -H 'Accept-Encoding: br, gzip' -o /dev/null -w '%{size_download}' "$2$p")
    local out=$(taskset -c 1-3 wrk -t3 -c64 -d"${DUR}s" --latency -H 'Accept-Encoding: br, gzip' "$2$p")
    printf '| %s | `%s` | %s | %s | %s |\n' "$1" "$p" "$(awk '/Requests\/sec/ {printf "%\047d", $2}' <<<"$out")" "$(awk '$1=="99%" {print $2}' <<<"$out")" "$bytes"
  done
}
wait_port() { until curl -s -o /dev/null "http://127.0.0.1:$1/"; do sleep 0.05; done; }
rss() { ps -o rss= -p "$1" | awk '{printf "%d MB", $1/1024}'; }

echo "| server | path | req/s | p99 | bytes |"
echo "|---|---|---:|---:|---:|"
(cd portfolio && exec taskset -c 0 bun ../framework/src/cli.ts start >/dev/null 2>&1) & P=$!; wait_port 3001
bench "optz (Bun)" http://127.0.0.1:3001; R1=$(rss $P); kill $P; wait $P 2>/dev/null || true
(cd "$TMP" && PORT=3001 exec taskset -c 0 "$DIST/server" >/dev/null 2>&1) & P=$!; wait_port 3001
bench "optz single executable" http://127.0.0.1:3001; R2=$(rss $P); kill $P; wait $P 2>/dev/null || true
taskset -c 0 nginx -c "$TMP/nginx.conf" -g "daemon off;" & P=$!; wait_port 3021
bench "nginx (C)" http://127.0.0.1:3021; R3=$(ps -o rss= --ppid $P | awk '{s+=$1} END {printf "%d MB", s/1024}'); kill $P; wait $P 2>/dev/null || true
echo
echo "memory after load: optz $R1, single executable $R2, nginx worker $R3"
rm -rf "$TMP"
