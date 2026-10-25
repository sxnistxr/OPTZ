#!/usr/bin/env python3
"""Server CPU per request at fixed open-loop rates (bench/rate.js), server pinned to one CPU.

  python3 bench/rate.py --seed SEED --tokens TOKENS --k6 /path/to/k6 --rates 5000,15000,25000
"""
import argparse, json, os, re, shutil, subprocess, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.sysconf("SC_CLK_TCK")


def cpu(pid):
    f = open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()
    return (int(f[11]) + int(f[12])) / TICK


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", required=True)
    ap.add_argument("--tokens", required=True)
    ap.add_argument("--k6", required=True)
    ap.add_argument("--binary", default=os.path.join(HERE, "..", "target", "release", "twelve-iouring"))
    ap.add_argument("--rates", default="5000,15000,25000")
    ap.add_argument("--vus", type=int, default=2000)
    ap.add_argument("--secs", type=int, default=30)
    ap.add_argument("--label", default="current")
    ap.add_argument("--port", type=int, default=3500)
    a = ap.parse_args()
    for rate in map(int, a.rates.split(",")):
        d = tempfile.mkdtemp(prefix="twelve-rate-")
        db = os.path.join(d, "feed.db")
        shutil.copy(a.seed, db)
        env = dict(os.environ, SQLITE_PATH=db, JWT_SECRET="twelve-dollar-challenge", HOST="127.0.0.1", PORT=str(a.port))
        srv = subprocess.Popen(["taskset", "-c", "0", a.binary], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(0.5)
        k6 = ["taskset", "-c", "1-3", a.k6, "run", "--quiet", "--summary-export", os.path.join(d, "s.json"),
              "-e", f"BASE_URL=http://127.0.0.1:{a.port}", "-e", f"RATE={rate}", "-e", f"VUS={a.vus}",
              "-e", f"DURATION={a.secs}s", "-e", f"TOKENS={a.tokens}", os.path.join(HERE, "rate.js")]
        c0 = cpu(srv.pid)
        subprocess.run(k6, capture_output=True)
        c1 = cpu(srv.pid)
        s = json.load(open(os.path.join(d, "s.json")))["metrics"]
        reqs = s["http_reqs"]["count"]
        dur = s["http_req_duration"]
        print(json.dumps({"label": a.label, "target_rate": rate, "achieved_rps": round(s["http_reqs"]["rate"]),
                          "us_per_req": round((c1 - c0) * 1e6 / reqs, 2), "server_cpu_pct": round((c1 - c0) * 100 / a.secs, 1),
                          "p95_ms": round(dur["p(95)"], 2), "p99_ms": round(dur["p(99)"], 2),
                          "failed": s["http_req_failed"]["value"], "dropped": s.get("dropped_iterations", {}).get("count", 0)}), flush=True)
        srv.terminate()
        srv.wait()
        shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    main()
