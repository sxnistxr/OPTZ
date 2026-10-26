#!/usr/bin/env bash
# Validates the submission on the VPS (Ubuntu 24.04, 1 vCPU / 2 GB, kernel 6.8): the box that
# matches the scoring machine. Run as root:
#   sudo bash /srv/optz/ops/vps-validate.sh 2>&1 | tee /root/optz-validation.txt
# Takes ~15-25 minutes (toolchain + seed + LTO build on one CPU). Safe to re-run.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SUB="$REPO/submissions/rust-iouring-sxnistxr"
W=/root/optz-validate
CHAL=$W/challenge
mkdir -p $W
echo "== box"; uname -a; nproc; free -m; grep -m1 "model name" /proc/cpuinfo; grep -o -w sha_ni /proc/cpuinfo | head -1 || echo "no sha_ni"

echo "== tools"
apt-get update -qq && apt-get install -y -qq git curl jq openssl sqlite3 nodejs python3 >/dev/null
[ -d $CHAL ] || git clone -q https://github.com/arjaythedev/twelve-dollar-server-challenge.git $CHAL
ln -sfn "$SUB" $CHAL/submissions/rust-iouring-sxnistxr
[ -f $CHAL/seed/feed.db ] || (cd $CHAL && bash seed/make-seed.sh)
SEED=$CHAL/seed/feed.db

echo "== install.sh"; bash "$SUB/install.sh" >/dev/null && echo ok
echo "== build + official suite"
(cd $CHAL && bash test/run.sh submissions/rust-iouring-sxnistxr 2>&1 | grep -v "Compiling\|Download" | tail -50)
cd "$SUB"
ulimit -n 1048576
echo "== unit tests"; timeout 900 /opt/rust-1.99.1/bin/cargo test --release 2>&1 | grep -E "test result|error|FAILED|panicked" | head -20
echo "== protocol (incl. 66 s idle)"; timeout 600 python3 tests/protocol.py --seed $SEED --long 2>&1 | tail -16
echo "== shards"; timeout 300 python3 tests/shards.py --seed $SEED 2>&1 | tail -8; ls -t /tmp/twelve-*/server.log 2>/dev/null | head -2 | xargs -r tail -n 5
echo "== crash (kill -9 x 5)"; timeout 600 python3 tests/crash.py --seed $SEED --rounds 5 2>&1 | tail -6
echo "== socket option inheritance on this kernel"
python3 - <<'PY'
import socket
ls=socket.socket(); ls.setsockopt(socket.IPPROTO_TCP,socket.TCP_NODELAY,1); ls.bind(('127.0.0.1',0)); ls.listen(8)
c=socket.create_connection(ls.getsockname()); s,_=ls.accept()
print("accepted socket inherits TCP_NODELAY:", bool(s.getsockopt(socket.IPPROTO_TCP,socket.TCP_NODELAY)))
PY
echo "== memory per idle connection (server limited to 65535 fds, like the scoring unit)"
swapoff -a 2>/dev/null; echo "swap off for the measurement"
for n in 40000 80000; do timeout 900 python3 tests/connmem.py --seed $SEED --conns $n --sources 400 2>&1 | tail -16; done
swapon -a 2>/dev/null
echo "== done"
