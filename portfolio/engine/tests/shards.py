#!/usr/bin/env python3
"""Shard spill-over and admission control, at small scale.

  python3 tests/shards.py --seed /path/to/seed/feed.db

Runs the server with --shard-slots=1000 (a test-only flag) so 5,000 connections must spread
over 5 rings, then with --max-conns to check that connections past the ceiling are refused
cleanly (closed at once) while existing ones keep working, and that freed slots are reused.
"""
import argparse, socket, sys
from harness import Server, connect, raw, read_response

failures = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + ("" if cond else f"  {detail}"))
    if not cond:
        failures.append(name)


def open_and_request(port, n):
    socks, ok = [], 0
    for _ in range(n):
        socks.append(connect(port))
    for s in socks:
        try:
            s.sendall(raw("GET", "/posts/1"))
            st, _, _, _ = read_response(s)
            ok += st == 200
        except (EOFError, ConnectionResetError, BrokenPipeError):
            # Admission control may close a newly refused socket before it answers.
            continue
        except socket.timeout:
            raise SystemExit(f"  FAIL request timed out after {ok} answers: server stopped responding")
    return socks, ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", required=True)
    a = ap.parse_args()

    srv = Server(a.seed, 3102, ["--shard-slots=1000"]).start()
    try:
        socks, ok = open_and_request(3102, 5000)
        check("5000 connections over 1000-slot shards all served", ok == 5000, ok)
        # Requests on the earliest and latest connections still work (all shards polled).
        good = True
        for s in socks[:50] + socks[-50:]:
            s.sendall(raw("GET", "/health"))
            good &= read_response(s)[0] == 200
        check("connections on first and last shards keep working", good)
        for s in socks:
            s.close()
        socks, ok = open_and_request(3102, 5000)
        check("slots are reused after 5000 closes", ok == 5000, ok)
        for s in socks:
            s.close()
    finally:
        srv.stop()

    srv = Server(a.seed, 3103, ["--max-conns=1500", "--shard-slots=1000"]).start()
    try:
        socks, ok = open_and_request(3103, 2000)
        # The health probe in Server.start() used one slot and was closed again.
        check("connections past the ceiling are refused", 1400 <= ok <= 1500, ok)
        held = [s for s in socks]
        good = True
        for s in held[:100]:
            try:
                s.sendall(raw("GET", "/health"))
                good &= read_response(s)[0] == 200
            except (EOFError, ConnectionResetError, BrokenPipeError):
                good = False
        check("admitted connections unaffected by refusals", good)
        for s in socks:
            s.close()
        socks, ok = open_and_request(3103, 1000)
        check("capacity returns after connections close", ok == 1000, ok)
        for s in socks:
            s.close()
    finally:
        rc = srv.stop()
    check("clean shutdown", rc == 0)
    print(f"shards: {len(failures)} failures")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
