#!/usr/bin/env python3
"""Local throughput/CPU benchmark: server pinned to one CPU, wrk on the others.

  python3 bench/run.py --seed SEED --tokens TOKENS [--workloads feed,mixed] [--conns 64] [--secs 15]
                       [--binary path] [--trials 1] [--label name]

Prints one JSON line per trial: req/s, server CPU microseconds per request (utime+stime from
/proc/<pid>/stat over the measured window), peak RSS, and wrk's non-2xx/socket errors.
Every trial starts from a fresh copy of the seed. CPU pinning is test-harness only.
"""
import argparse, json, os, re, shutil, subprocess, tempfile, time
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.sysconf("SC_CLK_TCK")


def cpu_secs(pid):
    f = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
    return (int(f[11]) + int(f[12])) / TICK


def rss_peak_kb(pid):
    for l in Path(f"/proc/{pid}/status").read_text().splitlines():
        if l.startswith("VmHWM:"):
            return int(l.split()[1])
    raise RuntimeError(f"VmHWM missing for process {pid}")


def trial(a, workload):
    d = tempfile.mkdtemp(prefix="twelve-bench-")
    db = os.path.join(d, "feed.db")
    shutil.copy(a.seed, db)
    env = dict(os.environ, SQLITE_PATH=db, JWT_SECRET="twelve-dollar-challenge", HOST="127.0.0.1", PORT=str(a.port))
    with open(os.path.join(d, "log"), "w") as log:
        srv = subprocess.Popen(["taskset", "-c", a.server_cpu, a.binary], env=env, stdout=subprocess.DEVNULL, stderr=log)
    try:
        for _ in range(100):
            if subprocess.run(["curl", "-sf", "--noproxy", "*", f"http://127.0.0.1:{a.port}/health"], capture_output=True).returncode == 0:
                break
            time.sleep(0.05)
        wenv = dict(os.environ, WORKLOAD=workload, TOKENS=a.tokens)
        wrk = ["taskset", "-c", a.load_cpus, "wrk", "-t", str(a.threads), "-c", str(a.conns), "-s", os.path.join(HERE, "mix.lua"), "--latency"]
        url = f"http://127.0.0.1:{a.port}"
        subprocess.run(wrk + ["-d", f"{a.warmup}s", url], env=wenv, capture_output=True)
        c0, t0 = cpu_secs(srv.pid), time.time()
        out = subprocess.run(wrk + ["-d", f"{a.secs}s", url], env=wenv, capture_output=True, text=True).stdout
        c1, t1 = cpu_secs(srv.pid), time.time()
        reqs = int(re.search(r"(\d+) requests in", out).group(1))
        non2xx = int(m.group(1)) if (m := re.search(r"Non-2xx or 3xx responses: (\d+)", out)) else 0
        sock = re.search(r"Socket errors: (.*)", out)
        lat = dict(re.findall(r"\s+(50|90|99)%\s+([\d.]+\w+)", out))
        return {
            "label": a.label, "workload": workload, "conns": a.conns, "secs": round(t1 - t0, 2),
            "rps": round(reqs / (t1 - t0)), "us_per_req": round((c1 - c0) * 1e6 / max(reqs, 1), 2),
            "server_cpu_pct": round((c1 - c0) * 100 / (t1 - t0), 1), "rss_peak_mib": round(rss_peak_kb(srv.pid) / 1024, 1),
            "non2xx": non2xx, "socket_errors": sock.group(1) if sock else "", "p50": lat.get("50"), "p99": lat.get("99"),
        }
    finally:
        srv.terminate()
        srv.wait()
        shutil.rmtree(d, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", required=True)
    ap.add_argument("--tokens", required=True)
    ap.add_argument("--binary", default=os.path.join(HERE, "..", "target", "release", "twelve-iouring"))
    ap.add_argument("--workloads", default="feed,post,mixed")
    ap.add_argument("--conns", type=int, default=64)
    ap.add_argument("--threads", type=int, default=3)
    ap.add_argument("--secs", type=int, default=15)
    ap.add_argument("--warmup", type=int, default=5)
    ap.add_argument("--trials", type=int, default=1)
    ap.add_argument("--port", type=int, default=3200)
    ap.add_argument("--server-cpu", default="0")
    ap.add_argument("--load-cpus", default="1-3")
    ap.add_argument("--label", default="current")
    a = ap.parse_args()
    for _ in range(a.trials):
        for w in a.workloads.split(","):
            print(json.dumps(trial(a, w)), flush=True)


if __name__ == "__main__":
    main()
