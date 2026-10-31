#!/usr/bin/env python3
"""Protocol and robustness checks beyond the official suite.

  python3 tests/protocol.py --seed /path/to/seed/feed.db [--long]

--long adds the 66-second idle keep-alive check (the spec asks for >= 65 s).
"""
import argparse, json, sys, threading, time
from harness import Server, connect, raw, read_response, request, token

failures = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + ("" if cond else f"  {detail}"))
    if not cond:
        failures.append(name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", required=True)
    ap.add_argument("--long", action="store_true")
    ap.add_argument("--port", type=int, default=3100)
    a = ap.parse_args()
    srv = Server(a.seed, a.port).start()
    port = a.port
    t = token()
    try:
        # Keep-alive: many requests on one connection.
        with connect(port) as s:
            ok = True
            for _ in range(50):
                s.sendall(raw("GET", "/posts/1"))
                st, _, _, left = read_response(s)
                ok &= st == 200 and left == b""
            check("50 requests on one keep-alive connection", ok)

        # Pipelining: three requests in one write come back in order.
        with connect(port) as s:
            s.sendall(raw("GET", "/posts/1") + raw("GET", "/nope") + raw("GET", "/posts/2"))
            buf, got = b"", []
            for _ in range(3):
                st, body, _, buf = read_response(s, buf)
                got.append((st, json.loads(body).get("post", {}).get("id")))
            check("pipelined requests answered in order", got == [(200, 1), (404, None), (200, 2)], got)

        # Pipelined write then read: the read must see the committed write.
        with connect(port) as s:
            s.sendall(raw("POST", "/posts", t, '{"body":"pipelined"}') + raw("GET", "/feed"))
            st1, b1, _, buf = read_response(s)
            st2, b2, _, _ = read_response(s, buf)
            new_id = json.loads(b1)["post"]["id"]
            check("pipelined create then feed sees the new post", st1 == 201 and json.loads(b2)["posts"][0]["id"] == new_id)

        # Byte-at-a-time request.
        with connect(port) as s:
            for c in raw("POST", "/posts", t, '{"body":"slow  "}'):
                s.send(bytes([c]))
                time.sleep(0.001)
            st, body, _, _ = read_response(s)
            check("byte-at-a-time request", st == 201 and json.loads(body)["post"]["body"] == "slow", (st, body))

        # Connection: close is honoured.
        with connect(port) as s:
            s.sendall(raw("GET", "/health", extra="Connection: close\r\n"))
            st, _, h, _ = read_response(s)
            closed = s.recv(10) == b""
            check("Connection: close closes after the response", st == 200 and h.get("connection") == "close" and closed)

        # Garbage gets a 400 and a close.
        with connect(port) as s:
            s.sendall(b"\x16\x03\x01garbage\r\n\r\n")
            st, _, _, _ = read_response(s)
            check("garbage request -> 400 and close", st == 400 and s.recv(10) == b"")

        # Oversized headers/body get refused, not buffered without bound.
        with connect(port) as s:
            s.sendall(b"POST /posts HTTP/1.1\r\nContent-Length: 999999\r\n\r\n")
            st, _, _, _ = read_response(s)
            check("oversized Content-Length -> 413", st == 413)
        with connect(port) as s:
            try:
                s.sendall(b"GET /" + b"a" * 200_000)
                st, _, _, _ = read_response(s)
                check("oversized request line -> 413", st == 413)
            except (EOFError, ConnectionResetError, BrokenPipeError):
                check("oversized request line -> refused", True)

        # Client disconnects mid-request and mid-write don't disturb others.
        for _ in range(50):
            s = connect(port)
            s.sendall(raw("POST", f"/posts/1/like", t)[:20])
            s.close()
            s = connect(port)
            s.sendall(raw("POST", f"/posts/2/like", t))
            s.close()
        check("server healthy after 100 abrupt disconnects", request(port, "GET", "/health")[0] == 200)

        # Every auth failure class on the like route, with auth checked before the id.
        cases = [(None, "/posts/abc/like", 401, "missing bearer token"),
                 ("garbage", "/posts/abc/like", 401, "invalid or expired token"),
                 (token(exp_in=-10), "/posts/1/like", 401, "invalid or expired token"),
                 (token(sub="0"), "/posts/1/like", 401, "invalid token payload"),
                 (t, "/posts/abc/like", 400, "invalid post id"),
                 (t, "/posts/999999999/like", 404, "post not found")]
        ok = True
        for auth, path, want, msg in cases:
            st, body = request(port, "POST", path, auth)
            ok &= st == want and json.loads(body) == {"error": msg}
        check("like route error classes", ok)

        # Many simultaneous connections, each doing a request.
        n = 2000
        socks, ok = [], True
        for _ in range(n):
            socks.append(connect(port))
        for s in socks:
            # Post 1 exists in every seed (the challenge's and bench/pgo_train.py's synthetic one).
            s.sendall(raw("GET", "/posts/1"))
        for s in socks:
            st, _, _, _ = read_response(s)
            ok &= st == 200
        check(f"{n} simultaneous keep-alive connections", ok)
        if a.long:
            print("  ...  idling 66 s")
            time.sleep(66)
            ok = True
            for s in socks[:200]:
                s.sendall(raw("GET", "/health"))
                st, _, _, _ = read_response(s)
                ok &= st == 200
            check("connections idle for 66 s are still open", ok)
        for s in socks:
            s.close()

        # Concurrent likes from many users on a new post: exact count afterwards. Users 1-400
        # exist in any seed; tokens for users that don't exist are refused (401).
        st, body = request(port, "POST", "/posts", t, json.dumps({"body": "like target"}))
        target = json.loads(body)["post"]["id"]
        statuses = []

        def like(uid):
            st, _ = request(port, "POST", f"/posts/{target}/like", token(sub=str(uid), username=f"u{uid}"))
            statuses.append(st)

        ths = [threading.Thread(target=like, args=(u,)) for u in range(1, 401)]
        [x.start() for x in ths]
        [x.join() for x in ths]
        _, after = request(port, "GET", f"/posts/{target}")
        check("400 concurrent likes counted exactly", statuses.count(201) == 400 and json.loads(after)["post"]["like_count"] == 400)
        st, body = request(port, "POST", f"/posts/{target}/like", token(sub="999999999", username="ghost"))
        check("a token for a user that doesn't exist writes nothing (401)", st == 401 and json.loads(body) == {"error": "unknown user"})
    finally:
        rc = srv.stop()
        check("clean shutdown on SIGTERM (exit 0)", rc == 0, srv.logtext()[-500:])
    print(f"protocol: {len(failures)} failures")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
