#!/usr/bin/env python3
"""Memory per idle keep-alive connection, server side, measured.

  python3 tests/connmem.py --seed SEED --conns 18000 [--sources 64]

Opens N connections (each makes one request, then sits idle, like a k6 user thinking) and
measures system-wide Slab and MemAvailable deltas plus the server's RSS. It does this twice:
against this server, and against a plain Python server that only accepts and holds sockets.
The client's sockets cost the same in both runs, so

    our cost per connection = plain-socket cost + (ours - plain) / N

where plain-socket cost = (plain run delta) / (2N), since there both ends are plain sockets.
Client sockets are spread over 127.0.0.0/8 source addresses so N isn't capped by one
address's ephemeral ports. Run as root with a high fd limit for the client.
"""
import argparse, json, os, resource, socket, subprocess, sys, time
from harness import Server, raw, read_response

PLAIN = r'''
import socket, sys
ls = socket.socket(); ls.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
ls.bind(("127.0.0.1", int(sys.argv[1]))); ls.listen(65535)
held = []
while True:
    s, _ = ls.accept()
    s.recv(4096)
    s.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}")
    held.append(s)
'''


def meminfo():
    d = {}
    for l in open("/proc/meminfo"):
        k, v = l.split(":")
        d[k] = int(v.split()[0]) * 1024
    return d


def rss(pid):
    for l in open(f"/proc/{pid}/status"):
        if l.startswith("VmRSS:"):
            return int(l.split()[1]) * 1024


def settle():
    subprocess.run(["sync"])
    time.sleep(2)


def fill(port, n, sources):
    socks = []
    for i in range(n):
        s = socket.socket()
        src = f"127.{1 + (i % sources) // 250}.{(i % sources) % 250 + 1}.1"
        s.bind((src, 0))
        s.connect(("127.0.0.1", port))
        s.sendall(raw("GET", "/health"))
        socks.append(s)
    for s in socks:
        s.settimeout(10)
        read_response(s)
    return socks


def measure(pid, port, n, sources):
    settle()
    m0, r0 = meminfo(), rss(pid)
    socks = fill(port, n, sources)
    settle()
    m1, r1 = meminfo(), rss(pid)
    out = {"slab": m1["Slab"] - m0["Slab"], "avail": m0["MemAvailable"] - m1["MemAvailable"], "rss": r1 - r0}
    for s in socks:
        s.close()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", required=True)
    ap.add_argument("--conns", type=int, default=18000)
    ap.add_argument("--sources", type=int, default=64)
    ap.add_argument("--server-nofile", type=int, default=65535,
                    help="run the server with this RLIMIT_NOFILE, as the scoring box's systemd unit does")
    a = ap.parse_args()
    hard = resource.getrlimit(resource.RLIMIT_NOFILE)[1]
    resource.setrlimit(resource.RLIMIT_NOFILE, (hard, hard))
    n = a.conns

    plain = subprocess.Popen([sys.executable, "-c", PLAIN, "3601"])
    time.sleep(0.5)
    p = measure(plain.pid, 3601, n, a.sources)
    plain.kill()
    plain.wait()
    time.sleep(2)

    lim = a.server_nofile
    srv = Server(a.seed, 3602, wrap=["prlimit", f"--nofile={lim}:{lim}", "--"]).start()
    o = measure(srv.proc.pid, 3602, n, a.sources)
    srv.stop()

    plain_socket = p["avail"] / (2 * n)
    ours_extra = (o["avail"] - p["avail"]) / n
    print(json.dumps({
        "conns": n,
        "plain_run": {k: round(v / n) for k, v in p.items()},
        "our_run": {k: round(v / n) for k, v in o.items()},
        "plain_socket_bytes": round(plain_socket),
        "our_extra_vs_plain_bytes": round(ours_extra),
        "our_server_bytes_per_conn": round(plain_socket + ours_extra),
        "our_rss_bytes_per_conn": round(o["rss"] / n),
        "kernel": os.uname().release,
    }, indent=1))


if __name__ == "__main__":
    main()
