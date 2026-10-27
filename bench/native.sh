#!/usr/bin/env bash
# Would native code serve the site faster? The same built pages, on one pinned core:
#   optz (Bun, JavaScript)  vs  the optz single executable  vs  nginx (C) serving dist/static
# plus the ceiling: an empty "ok" response from Bun.serve and from nginx.
# nginx gets the same security headers and pre-compressed files (gzip_static; it has no brotli
# module here, so it sends gzip where optz sends brotli).
#   bash bench/native.sh      (needs nginx, wrk, taskset; run `optz build --compile` in portfolio first)
# Writes bench/native-results.json: provenance, every run (REPEATS per URL, median reported),
# response sizes per encoding, and memory measured the same way for every server (the RSS of the
# whole process tree after the load, nginx's master and worker included).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
DIST=$ROOT/portfolio/dist
DUR=${DUR:-10}
REPEATS=${REPEATS:-3}
SLUG=$(ls portfolio/content/blog | head -1 | sed 's/\.md$//')
PATHS=("/" "/blog/$SLUG" "/api/blog")
TMP=$(mktemp -d)
CSP="default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"
[ -x "$DIST/server" ] || { echo "run \`bun ../framework/src/cli.ts build --compile\` in portfolio first" >&2; exit 1; }

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
  client_body_temp_path $TMP; proxy_temp_path $TMP; fastcgi_temp_path $TMP; uwsgi_temp_path $TMP; scgi_temp_path $TMP;
  server {
    listen 127.0.0.1:3021;
    root $DIST/static;
    gzip_static on;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Content-Security-Policy "$CSP" always;
    add_header X-Frame-Options DENY always;
    location = /ok { return 200 "ok"; }
    location = /api/blog { default_type application/json; try_files /_optz/api/api/blog =404; }
    location / { try_files \$uri \$uri/index.html =404; }
  }
}
CONF
cat >"$TMP/ok.ts" <<'TS'
Bun.serve({ port: 3031, hostname: "127.0.0.1", fetch: () => new Response("ok") });
TS

median() { tr ' ' '\n' | grep -v '^$' | sort -g | awk '{a[NR]=$1} END {print (NR%2 ? a[(NR+1)/2] : (a[NR/2]+a[NR/2+1])/2)}'; }
json_list() { echo "[$(echo "$*" | tr -s ' ' | sed 's/^ //; s/ $//; s/ /,/g')]"; }
tree() { local pids="$1" all="$1" next; while next=$(pgrep -P "$(echo $pids | tr ' ' ',')" 2>/dev/null | tr '\n' ' '); [ -n "$next" ]; do all="$all $next"; pids="$next"; done; echo $all; }
rss_tree() { ps -o rss= -p "$(tree "$1" | tr ' ' ',')" | awk '{s+=$1} END {print s}'; } # KiB
wait_port() { until curl -s -o /dev/null "http://127.0.0.1:$1/"; do sleep 0.05; done; }

bench() { # name base paths... -> appends a JSON object to $TMP/out
  local name=$1 base=$2; shift 2
  local sep="" body=""
  for p in "$@"; do
    local br=$(curl -s -H 'Accept-Encoding: br' -o /dev/null -w '%{size_download}' "$base$p")
    local gz=$(curl -s -H 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}' "$base$p")
    local runs=""
    for _ in $(seq "$REPEATS"); do
      runs="$runs $(taskset -c 1-3 wrk -t3 -c64 -d"${DUR}s" -H 'Accept-Encoding: br, gzip' "$base$p" | awk '/Requests\/sec/ {print $2}')"
    done
    body="$body$sep\"$p\":{\"rps\":{\"runs\":$(json_list $runs),\"median\":$(echo $runs | median)},\"bytes\":{\"br\":$br,\"gzip\":$gz}}"
    sep=","
    printf '| %s | `%s` | %s | br %s / gzip %s |\n' "$name" "$p" "$(echo $runs | median | awk '{printf "%\047d", $1}')" "$br" "$gz" >&2
  done
  echo "\"$name\":{\"paths\":{$body}" >>"$TMP/out"
}
finish() { echo ",\"rss_kib\":$(rss_tree "$1")}," >>"$TMP/out"; kill $(tree "$1") 2>/dev/null || true; wait "$1" 2>/dev/null || true; sleep 0.5; }

: >"$TMP/out"
echo "| server | path | req/s (median of $REPEATS) | bytes |" >&2
echo "|---|---|---:|---:|" >&2
(cd portfolio && exec taskset -c 0 bun ../framework/src/cli.ts start >/dev/null 2>&1) & P=$!; wait_port 3001
bench "optz on Bun" http://127.0.0.1:3001 "${PATHS[@]}"; finish $P
(cd "$TMP" && PORT=3001 exec taskset -c 0 "$DIST/server" >/dev/null 2>&1) & P=$!; wait_port 3001
bench "optz single executable" http://127.0.0.1:3001 "${PATHS[@]}"; finish $P
taskset -c 0 nginx -c "$TMP/nginx.conf" -g "daemon off;" & P=$!; wait_port 3021
bench "nginx" http://127.0.0.1:3021 "${PATHS[@]}" /ok; finish $P
taskset -c 0 bun "$TMP/ok.ts" & P=$!; wait_port 3031
bench "Bun.serve, empty response" http://127.0.0.1:3031 /ok; finish $P

node - "$TMP/out" <<JS
const fs = require("fs");
const servers = JSON.parse("{" + fs.readFileSync(process.argv[2], "utf8").trim().replace(/,$/, "") + "}");
const out = {
  provenance: {
    date: new Date().toISOString(),
    commit: "$(git rev-parse HEAD)",
    dirty: $([ -z "$(git status --porcelain -- framework portfolio bench)" ] && echo false || echo true),
    command: "bash bench/native.sh",
    machine: { cpu: "$(awk -F': ' '/model name/ {print $2; exit}' /proc/cpuinfo)", cpus: $(nproc), kernel: "$(uname -r)", pinning: "server on CPU 0, wrk (3 threads, 64 connections) on CPUs 1-3" },
    versions: { bun: "$(bun --version)", nginx: "$(nginx -v 2>&1 | sed 's#.*/##')", wrk: "$(wrk --version 2>&1 | head -1 | awk '{print $2}')" },
    settings: { duration_s: $DUR, repeats: $REPEATS, accept_encoding: "br, gzip" },
  },
  servers,
};
fs.writeFileSync("bench/native-results.json", JSON.stringify(out, null, 2) + "\n");
for (const [name, s] of Object.entries(servers)) console.error(name + ": " + Math.round(s.rss_kib / 1024) + " MB RSS after load (process tree)");
JS
rm -rf "$TMP"
