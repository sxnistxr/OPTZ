#!/usr/bin/env python3
"""Crash durability: every acknowledged write must survive `kill -9`.

  python3 tests/crash.py --seed /path/to/seed/feed.db [--rounds 10] [--clients 64]

Each round: clients hammer creates and likes over keep-alive connections, recording every 201
(and every like answered 200/201). At a random moment the server is SIGKILLed mid-batch. It is
restarted on the same files (SQLite WAL recovery runs), and every acknowledged post must exist
with its exact body and every acknowledged like row must exist.

This is a process crash, not a power cut: the OS page cache survives `kill -9`. With
synchronous=FULL each commit is fsynced, which is what protects against power loss; only a
VM-level hard reset tests that end to end.
"""
import argparse, json, random, sqlite3, sys, threading, time
from harness import Server, connect, raw, read_response, token


def client(port, uid, stop, acked_posts, acked_likes, lock):
    t = token(sub=str(uid), username=f"crash_{uid}")
    n = 0
    try:
        s = connect(port)
        while not stop.is_set():
            n += 1
            if n % 3:
                body = f"crash test {uid}-{n} {random.random()}"
                s.sendall(raw("POST", "/posts", t, json.dumps({"body": body})))
                st, b, _, _ = read_response(s)
                if st == 201:
                    with lock:
                        acked_posts[json.loads(b)["post"]["id"]] = body
            else:
                post = random.randint(1, 500000)
                s.sendall(raw("POST", f"/posts/{post}/like", t))
                st, _, _, _ = read_response(s)
                if st in (200, 201):
                    with lock:
                        acked_likes.add((uid, post))
    except (OSError, EOFError, ValueError):
        pass  # the server died under us; that's the point


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", required=True)
    ap.add_argument("--rounds", type=int, default=10)
    ap.add_argument("--clients", type=int, default=64)
    ap.add_argument("--port", type=int, default=3101)
    a = ap.parse_args()
    srv = Server(a.seed, a.port)
    total_posts = total_likes = 0
    bad = 0
    for rnd in range(a.rounds):
        srv.start()
        stop = threading.Event()
        acked_posts, acked_likes, lock = {}, set(), threading.Lock()
        ths = [threading.Thread(target=client, args=(a.port, 40000 + rnd * 1000 + i, stop, acked_posts, acked_likes, lock))
               for i in range(a.clients)]
        [t.start() for t in ths]
        time.sleep(random.uniform(0.5, 2.5))
        srv.kill9()
        stop.set()
        [t.join() for t in ths]
        # Restart: SQLite recovers the WAL on open. Then verify from a separate connection.
        srv.start()
        db = sqlite3.connect(f"file:{srv.db}?mode=ro", uri=True)
        missing_p = sum(1 for pid, body in acked_posts.items()
                        if db.execute("SELECT body FROM posts WHERE id=?", (pid,)).fetchone() != (body,))
        missing_l = sum(1 for (u, p) in acked_likes
                        if db.execute("SELECT 1 FROM likes WHERE user_id=? AND post_id=?", (u, p)).fetchone() is None)
        integrity = db.execute("PRAGMA quick_check").fetchone()[0]
        db.close()
        srv.stop()
        print(f"  round {rnd + 1}: {len(acked_posts)} acked posts, {len(acked_likes)} acked likes -> "
              f"missing {missing_p} posts, {missing_l} likes, quick_check {integrity}")
        bad += missing_p + missing_l + (integrity != "ok")
        total_posts += len(acked_posts)
        total_likes += len(acked_likes)
    print(f"crash: {a.rounds} rounds, {total_posts} acked posts, {total_likes} acked likes, {bad} problems")
    sys.exit(1 if bad or total_posts == 0 else 0)


if __name__ == "__main__":
    main()
