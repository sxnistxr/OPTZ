#!/usr/bin/env bash
# optz vs Next.js on the same app (portfolio/ and bench/nextjs-portfolio/), same machine.
# The server is pinned to CPU 0 (one core, like the $12 VPS); wrk runs on the other CPUs.
#   bash bench/compare.sh     # prints markdown tables and writes bench/results.json
# Needs: bun, node/npm, wrk, taskset, curl; `npm ci` in bench/nextjs-portfolio first. With
# Playwright on NODE_PATH (or installed), it also measures the JavaScript each page loads.
#
# Everything the numbers depend on is recorded in results.json (commit, machine, versions,
# settings), each URL is measured REPEATS times (the median is reported, every run is kept),
# builds and cold starts are repeated too, and response sizes are recorded per encoding.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
DUR=${DUR:-10}
CONNS=${CONNS:-64}
REPEATS=${REPEATS:-3}
COLD_REPEATS=${COLD_REPEATS:-5}
BUILD_REPEATS=${BUILD_REPEATS:-3}
SLUG=$(ls portfolio/content/blog | head -1 | sed 's/\.md$//')
PATHS=("/" "/blog/$SLUG" "/api/blog" "/nope")
export NEXT_TELEMETRY_DISABLED=1
OUT=$(mktemp -d)

since() { awk "BEGIN {printf \"%.4f\", $(date +%s.%N) - $1}"; }
median() { tr ' ' '\n' | grep -v '^$' | sort -g | awk '{a[NR]=$1} END {print (NR%2 ? a[(NR+1)/2] : (a[NR/2]+a[NR/2+1])/2)}'; }
json_list() { echo "[$(echo "$*" | tr -s ' ' | sed 's/^ //; s/ $//; s/ /,/g')]"; }
tree() { # a process and its descendants
  local pids="$1" all="$1" next
  while next=$(pgrep -P "$(echo $pids | tr ' ' ',')" 2>/dev/null | tr '\n' ' '); [ -n "$next" ]; do all="$all $next"; pids="$next"; done
  echo $all
}
rss_tree() { ps -o rss= -p "$(tree "$1" | tr ' ' ',')" | awk '{s+=$1} END {print s}'; } # KiB
wait_200() { until [ "$(curl -s -o /dev/null -w '%{http_code}' "$1/")" = 200 ]; do sleep 0.01; done; }
stop() { kill $(tree "$1") 2>/dev/null || true; wait "$1" 2>/dev/null || true; sleep 0.5; }

# ---- provenance ----
COMMIT=$(git rev-parse HEAD)
DIRTY=$([ -z "$(git status --porcelain -- framework portfolio bench)" ] && echo false || echo true)
CPU=$(awk -F': ' '/model name/ {print $2; exit}' /proc/cpuinfo)
NEXT_VERSION=$(node -p 'require("./bench/nextjs-portfolio/node_modules/next/package.json").version')

start_server() { # name port dir cmd... -> prints pid
  local name=$1 port=$2 dir=$3; shift 3
  (cd "$dir" && exec taskset -c 0 "$@" >"$OUT/$name.log" 2>&1) &
  echo $!
}

cold_starts() { # name port dir cmd...
  local name=$1 port=$2 dir=$3; shift 3
  local runs=""
  for _ in $(seq "$COLD_REPEATS"); do
    local t0=$(date +%s.%N)
    local pid=$(start_server "$name" "$port" "$dir" "$@")
    wait_200 "http://127.0.0.1:$port"
    runs="$runs $(since $t0)"
    stop "$pid"
  done
  echo "$runs"
}

measure() { # name port dir cmd...
  local name=$1 port=$2 dir=$3; shift 3
  local base=http://127.0.0.1:$port
  local cold=$(cold_starts "$name" "$port" "$dir" "$@")
  local pid=$(start_server "$name" "$port" "$dir" "$@")
  wait_200 "$base"
  # First request of every path (lazy compilation/loading on the server shows up here).
  local first=0
  for p in "${PATHS[@]}"; do first=$(awk "BEGIN {print $first + $(curl -s -o /dev/null -w '%{time_total}' "$base$p")}"); done
  sleep 2
  local idle=$(rss_tree "$pid") peak=0
  peak=$idle
  {
    printf '{"server":"%s","cold_start_s":{"runs":%s,"median":%s},"first_hits_s":%s,"idle_rss_kib":%s,"paths":{' \
      "$name" "$(json_list $cold)" "$(echo $cold | median)" "$first" "$idle"
  } >"$OUT/$name.json"
  local sep=""
  for p in "${PATHS[@]}"; do
    local status=$(curl -s -o /dev/null -w '%{http_code}' "$base$p")
    local br=$(curl -s -H 'Accept-Encoding: br' -o /dev/null -w '%{size_download}' "$base$p")
    local gz=$(curl -s -H 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}' "$base$p")
    local raw=$(curl -s -H 'Accept-Encoding: identity' -o /dev/null -w '%{size_download}' "$base$p")
    local h=$(curl -s -D - -o /dev/null -H 'Accept-Encoding: br, gzip' "$base$p" | tr -d '\r')
    local hdr=$(awk -F': ' 'tolower($1) ~ /^(cache-control|content-encoding|x-nextjs-cache|x-nextjs-prerender)$/ {printf "%s\"%s\":\"%s\"", (n++ ? "," : ""), tolower($1), $2}' <<<"$h")
    local rps_runs="" reqs_runs="" non2_runs="" p50="" p99=""
    for r in $(seq "$REPEATS"); do
      taskset -c 1-3 wrk -t3 -c"$CONNS" -d"${DUR}s" --latency -H 'Accept-Encoding: br, gzip' "$base$p" >"$OUT/wrk.txt" &
      local w=$!
      while kill -0 $w 2>/dev/null; do local now=$(rss_tree "$pid"); [ "$now" -gt "$peak" ] && peak=$now; sleep 0.5; done
      rps_runs="$rps_runs $(awk '/Requests\/sec/ {print $2}' "$OUT/wrk.txt")"
      reqs_runs="$reqs_runs $(awk '/requests in/ {print $1}' "$OUT/wrk.txt")"
      non2_runs="$non2_runs $(awk '/Non-2xx/ {print $5}' "$OUT/wrk.txt" | grep . || echo 0)"
      # Latency percentiles from the middle run.
      if [ "$r" = $(( (REPEATS + 1) / 2 )) ]; then
        p50=$(awk '$1=="50%" {print $2}' "$OUT/wrk.txt")
        p99=$(awk '$1=="99%" {print $2}' "$OUT/wrk.txt")
      fi
    done
    printf '%s"%s":{"status":%s,"bytes":{"br":%s,"gzip":%s,"identity":%s},"headers":{%s},"rps":{"runs":%s,"median":%s},"requests":%s,"non2xx":%s,"p50":"%s","p99":"%s"}' \
      "$sep" "$p" "$status" "$br" "$gz" "$raw" "$hdr" "$(json_list $rps_runs)" "$(echo $rps_runs | median)" "$(json_list $reqs_runs)" "$(json_list $non2_runs)" "$p50" "$p99" >>"$OUT/$name.json"
    sep=","
  done
  echo "},\"peak_rss_kib\":$peak}" >>"$OUT/$name.json"
  # JavaScript per page, in Chromium (optional).
  if node -e 'require("playwright")' 2>/dev/null; then
    node bench/js-per-page.cjs "$base" "/" "/blog" "/blog/$SLUG" >"$OUT/$name-js.json" || echo '{}' >"$OUT/$name-js.json"
  else
    echo '{}' >"$OUT/$name-js.json"
  fi
  stop "$pid"
}

builds() { # dir clean-cmd build-cmd -> build times
  local runs=""
  for _ in $(seq "$BUILD_REPEATS"); do
    (cd "$1" && eval "$2")
    local t0=$(date +%s.%N)
    (cd "$1" && eval "$3" >/dev/null 2>&1)
    runs="$runs $(since $t0)"
  done
  echo "$runs"
}

echo "building optz (x$BUILD_REPEATS)..." >&2
# Font downloads are cached in ~/.cache/optz; FONT_CACHE says whether that cache was warm.
FONT_CACHE=$([ -d "${OPTZ_CACHE_DIR:-$HOME/.cache/optz}" ] && echo warm || echo cold)
OPTZ_BUILDS=$(builds portfolio "rm -rf dist .optz/gen" "bun ../framework/src/cli.ts build")
echo "building next (x$BUILD_REPEATS)..." >&2
(cd bench/nextjs-portfolio && npm run -s sync)
NEXT_BUILDS=$(builds bench/nextjs-portfolio "rm -rf .next" "npx next build")

echo "benchmarking optz..." >&2
PORT=3001 measure optz 3001 portfolio bun ../framework/src/cli.ts start
echo "benchmarking next..." >&2
measure next 3011 bench/nextjs-portfolio node node_modules/next/dist/bin/next start -p 3011 -H 127.0.0.1

OPTZ_SIZE=$(cd framework && du -sb src skills README.md package.json | awk '{s+=$1} END {print s}')
NEXT_SIZE=$(cd bench/nextjs-portfolio/node_modules && du -sb next @next 2>/dev/null | awk '{s+=$1} END {print s}')

node - "$OUT" <<JS
const fs = require("fs");
const dir = process.argv[2];
const read = (f) => JSON.parse(fs.readFileSync(dir + "/" + f));
const list = (s) => s.trim().split(/\s+/).map(Number);
const med = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const ob = list("$OPTZ_BUILDS"), nb = list("$NEXT_BUILDS");
const out = {
  provenance: {
    date: new Date().toISOString(),
    commit: "$COMMIT",
    dirty: $DIRTY,
    command: "bash bench/compare.sh",
    machine: { cpu: "$CPU", cpus: $(nproc), kernel: "$(uname -r)", pinning: "server on CPU 0 (taskset -c 0), wrk on CPUs 1-3" },
    versions: { bun: "$(bun --version)", node: "$(node --version)", next: "$NEXT_VERSION", wrk: "$(wrk --version 2>&1 | head -1 | awk '{print $2}')" },
    settings: { duration_s: $DUR, connections: $CONNS, wrk_threads: 3, repeats: $REPEATS, cold_repeats: $COLD_REPEATS, build_repeats: $BUILD_REPEATS, accept_encoding: "br, gzip", font_cache: "$FONT_CACHE" },
  },
  build_s: { optz: { runs: ob, median: med(ob) }, next: { runs: nb, median: med(nb) } },
  framework_bytes: { optz: { bytes: $OPTZ_SIZE, what: "the published package: framework/src, skills, README.md, package.json" }, next: { bytes: $NEXT_SIZE, what: "node_modules/next + node_modules/@next as installed" } },
  optz: { ...read("optz.json"), js: read("optz-js.json") },
  next: { ...read("next.json"), js: read("next-js.json") },
};
fs.writeFileSync("bench/results.json", JSON.stringify(out, null, 2) + "\n");
const f = (x) => Math.round(x).toLocaleString("en-US");
const o = out.optz, n = out.next;
console.log("| path | optz req/s | Next req/s | optz p99 | Next p99 | Next cache |\n|---|---:|---:|---:|---:|---|");
for (const p of Object.keys(o.paths)) { const a = o.paths[p], b = n.paths[p];
  console.log("| \`" + p + "\` (" + a.status + "/" + b.status + ") | " + f(a.rps.median) + " | " + f(b.rps.median) + " | " + a.p99 + " | " + b.p99 + " | " + (b.headers["x-nextjs-cache"] ?? "none") + " |"); }
console.log("\n| | optz | Next |\n|---|---:|---:|");
console.log("| build (median of " + ob.length + ") | " + out.build_s.optz.median.toFixed(1) + " s | " + out.build_s.next.median.toFixed(1) + " s |");
console.log("| cold start to first 200 (median of " + o.cold_start_s.runs.length + ") | " + Math.round(o.cold_start_s.median * 100) * 10 + " ms | " + Math.round(n.cold_start_s.median * 100) * 10 + " ms |");
console.log("| RSS idle | " + (o.idle_rss_kib / 1024).toFixed(0) + " MB | " + (n.idle_rss_kib / 1024).toFixed(0) + " MB |");
console.log("| RSS peak under load | " + (o.peak_rss_kib / 1024).toFixed(0) + " MB | " + (n.peak_rss_kib / 1024).toFixed(0) + " MB |");
console.log("| bytes for / (br / gzip / none) | " + Object.values(o.paths["/"].bytes).map(f).join(" / ") + " | " + Object.values(n.paths["/"].bytes).map(f).join(" / ") + " |");
JS
