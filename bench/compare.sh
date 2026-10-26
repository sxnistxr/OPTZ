#!/usr/bin/env bash
# optz vs Next.js on the same app (portfolio/ and bench/nextjs-portfolio/), same machine.
# The server is pinned to CPU 0 (one core, like the $12 VPS); wrk runs on the other CPUs.
#   bash bench/compare.sh            # prints a markdown table and writes bench/results.json
# Needs: bun, node/npm, wrk, taskset, curl. Run `npm ci` in bench/nextjs-portfolio first.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
DUR=${DUR:-10}
CONNS=${CONNS:-64}
SLUG=$(ls portfolio/content/blog | head -1 | sed 's/\.md$//')
PATHS=("/" "/blog/$SLUG" "/api/blog" "/nope")
export NEXT_TELEMETRY_DISABLED=1

add() { awk "BEGIN {printf \"%.4f\", $1 + $2}"; }
since() { add "$(date +%s.%N)" "-$1"; }
tree() { # a process and its descendants
  local pids="$1" all="$1" next
  while next=$(pgrep -P "$(echo $pids | tr ' ' ',')" 2>/dev/null | tr '\n' ' '); [ -n "$next" ]; do all="$all $next"; pids="$next"; done
  echo $all
}
rss_tree() { ps -o rss= -p "$(tree "$1" | tr ' ' ',')" | awk '{s+=$1} END {print s}'; } # KiB

run() { # name port dir cmd...
  local name=$1 port=$2 dir=$3; shift 3
  local base=http://127.0.0.1:$port
  local t0=$(date +%s.%N)
  (cd "$dir" && exec taskset -c 0 "$@" >/tmp/bench-$name.log 2>&1) &
  local pid=$!
  until [ "$(curl -s -o /dev/null -w '%{http_code}' "$base/")" = 200 ]; do sleep 0.02; done
  local cold=$(since $t0)
  # first request of every path (lazy compilation/loading on the server shows up here)
  local first=0; for p in "${PATHS[@]}"; do first=$(add $first "$(curl -s -o /dev/null -w '%{time_total}' "$base$p")"); done
  sleep 2
  local idle=$(rss_tree $pid)
  local peak=$idle
  echo "{\"server\":\"$name\",\"cold_start_s\":$cold,\"first_hits_s\":$first,\"idle_rss_kib\":$idle,\"paths\":{" >/tmp/bench-$name.json
  local sep=""
  for p in "${PATHS[@]}"; do
    local bytes=$(curl -s -H 'Accept-Encoding: br, gzip' -o /dev/null -w '%{size_download}' "$base$p")
    local status=$(curl -s -o /dev/null -w '%{http_code}' "$base$p")
    taskset -c 1-3 wrk -t3 -c"$CONNS" -d"${DUR}s" --latency -H 'Accept-Encoding: br, gzip' "$base$p" >/tmp/bench-wrk.txt &
    local w=$!
    while kill -0 $w 2>/dev/null; do r=$(rss_tree $pid); [ "$r" -gt "$peak" ] && peak=$r; sleep 0.5; done
    local rps=$(awk '/Requests\/sec/ {print $2}' /tmp/bench-wrk.txt)
    local p50=$(awk '$1=="50%" {print $2}' /tmp/bench-wrk.txt)
    local p99=$(awk '$1=="99%" {print $2}' /tmp/bench-wrk.txt)
    local non2=$(awk '/Non-2xx/ {print $5}' /tmp/bench-wrk.txt)
    printf '%s"%s":{"status":%s,"bytes":%s,"rps":%s,"p50":"%s","p99":"%s","non2xx":%s}' "$sep" "$p" "$status" "$bytes" "$rps" "$p50" "$p99" "${non2:-0}" >>/tmp/bench-$name.json
    sep=","
  done
  echo "},\"peak_rss_kib\":$peak}" >>/tmp/bench-$name.json
  kill $(tree $pid) 2>/dev/null || true; wait $pid 2>/dev/null || true
  sleep 1
}

echo "building optz..." >&2
t0=$(date +%s.%N); (cd portfolio && bun ../framework/src/cli.ts build >/dev/null); OPTZ_BUILD=$(since $t0)
echo "building next..." >&2
(cd bench/nextjs-portfolio && npm run -s sync && rm -rf .next)
t0=$(date +%s.%N); (cd bench/nextjs-portfolio && npx next build >/dev/null); NEXT_BUILD=$(since $t0)

echo "benchmarking optz..." >&2
PORT=3001 run optz 3001 portfolio bun ../framework/src/cli.ts start
echo "benchmarking next..." >&2
run next 3011 bench/nextjs-portfolio node node_modules/next/dist/bin/next start -p 3011 -H 127.0.0.1

node -e '
const fs = require("fs");
const o = JSON.parse(fs.readFileSync("/tmp/bench-optz.json")), n = JSON.parse(fs.readFileSync("/tmp/bench-next.json"));
const out = { date: new Date().toISOString(), build_s: { optz: +process.argv[1], next: +process.argv[2] }, optz: o, next: n };
fs.writeFileSync("bench/results.json", JSON.stringify(out, null, 2) + "\n");
const f = (x) => Math.round(x).toLocaleString("en-US");
console.log("| path | optz req/s | Next req/s | optz p99 | Next p99 | optz bytes | Next bytes |\n|---|---:|---:|---:|---:|---:|---:|");
for (const p of Object.keys(o.paths)) { const a = o.paths[p], b = n.paths[p];
  console.log(`| \`${p}\` (${a.status}/${b.status}) | ${f(a.rps)} | ${f(b.rps)} | ${a.p99} | ${b.p99} | ${f(a.bytes)} | ${f(b.bytes)} |`); }
console.log(`\n| | optz | Next |\n|---|---:|---:|`);
console.log(`| build | ${out.build_s.optz.toFixed(1)} s | ${out.build_s.next.toFixed(1)} s |`);
console.log(`| cold start to first 200 | ${(o.cold_start_s*1000).toFixed(0)} ms | ${(n.cold_start_s*1000).toFixed(0)} ms |`);
console.log(`| first hit of each path (sum) | ${(o.first_hits_s*1000).toFixed(0)} ms | ${(n.first_hits_s*1000).toFixed(0)} ms |`);
console.log(`| RSS idle | ${(o.idle_rss_kib/1024).toFixed(0)} MB | ${(n.idle_rss_kib/1024).toFixed(0)} MB |`);
console.log(`| RSS peak under load | ${(o.peak_rss_kib/1024).toFixed(0)} MB | ${(n.peak_rss_kib/1024).toFixed(0)} MB |`);
' "$OPTZ_BUILD" "$NEXT_BUILD"
