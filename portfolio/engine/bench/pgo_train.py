#!/usr/bin/env python3
"""PGO training run for the SQLite part of the build (called by build.sh).

  python3 bench/pgo_train.py <instrumented-binary> <work-dir>

Generates a synthetic database (same schema, random data; never the challenge seed), starts the
instrumented server on it with a training-only secret, drives the load.js request mix for a few
seconds over keep-alive connections, and stops it with SIGTERM so the profile is written.
"""
import base64, hashlib, hmac, json, os, random, signal, socket, sqlite3, string, subprocess, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
SECRET = b"pgo-training-only"
USERS, POSTS, LIKES = 20_000, 100_000, 400_000
SECONDS = 12


def synth(path):
    db = sqlite3.connect(path)
    db.execute("PRAGMA journal_mode=OFF")
    db.execute("PRAGMA synchronous=OFF")
    db.executescript(open(os.path.join(HERE, "..", "tests", "schema.sql")).read())
    r = random.Random(1)
    words = ["".join(r.choice(string.ascii_lowercase) for _ in range(r.randint(2, 9))) for _ in range(2000)]
    db.executemany("INSERT INTO users(id, username) VALUES (?, ?)", ((i, f"trainer_{i}") for i in range(1, USERS + 1)))
    db.executemany(
        "INSERT INTO posts(id, user_id, body, created_at) VALUES (?, ?, ?, ?)",
        ((i, r.randint(1, USERS), " ".join(r.choice(words) for _ in range(r.randint(3, 30)))[:500],
          f"2024-01-01T00:{i // 6000 % 60:02d}:{i // 100 % 60:02d}.{i % 1000:03d}Z") for i in range(1, POSTS + 1)))
    db.executemany("INSERT OR IGNORE INTO likes(user_id, post_id) VALUES (?, ?)",
                   ((r.randint(1, USERS), r.randint(1, POSTS)) for _ in range(LIKES)))
    db.commit()
    db.execute("PRAGMA journal_mode=WAL")
    db.close()


def b64(x):
    return base64.urlsafe_b64encode(x).rstrip(b"=").decode()


def token(uid):
    h = b64(b'{"alg":"HS256","typ":"JWT"}')
    p = b64(json.dumps({"sub": str(uid), "username": f"trainer_{uid}", "iat": 0, "exp": 4102444800}).encode())
    return f"{h}.{p}.{b64(hmac.new(SECRET, f'{h}.{p}'.encode(), hashlib.sha256).digest())}"


def client(port, stop, seed):
    r = random.Random(seed)
    toks = [token(r.randint(1, USERS)) for _ in range(20)]
    s = socket.create_connection(("127.0.0.1", port))
    buf = b""
    while not stop.is_set():
        x = r.random()
        if x < 0.461:
            req = b"GET /feed HTTP/1.1\r\nHost: t\r\n\r\n"
        elif x < 0.922:
            req = f"GET /posts/{r.randint(POSTS - 5000, POSTS + 50)} HTTP/1.1\r\nHost: t\r\n\r\n".encode()
        else:
            t = r.choice(toks)
            if x < 0.991:
                req = f"POST /posts/{r.randint(1, POSTS)}/like HTTP/1.1\r\nAuthorization: Bearer {t}\r\nContent-Length: 0\r\n\r\n".encode()
            else:
                body = json.dumps({"body": f"training post {r.random()}"})
                req = f"POST /posts HTTP/1.1\r\nAuthorization: Bearer {t}\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n{body}".encode()
        s.sendall(req)
        while True:
            if b"\r\n\r\n" in buf:
                head, rest = buf.split(b"\r\n\r\n", 1)
                n = int(head.lower().split(b"content-length: ")[1].split(b"\r\n")[0])
                if len(rest) >= n:
                    buf = rest[n:]
                    break
            d = s.recv(65536)
            if not d:
                return
            buf += d
    s.close()


def main():
    binary, work = sys.argv[1], sys.argv[2]
    os.makedirs(work, exist_ok=True)
    db = os.path.join(work, "train.db")
    for f in (db, db + "-wal", db + "-shm"):
        if os.path.exists(f):
            os.remove(f)
    synth(db)
    port = random.Random().randint(20000, 40000)
    env = dict(os.environ, SQLITE_PATH=db, JWT_SECRET=SECRET.decode(), HOST="127.0.0.1", PORT=str(port))
    srv = subprocess.Popen([binary], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", port)).close()
            break
        except OSError:
            time.sleep(0.05)
    stop = threading.Event()
    threads = [threading.Thread(target=client, args=(port, stop, i)) for i in range(8)]
    [t.start() for t in threads]
    time.sleep(SECONDS)
    stop.set()
    [t.join() for t in threads]
    srv.send_signal(signal.SIGTERM)
    rc = srv.wait(timeout=30)
    print(f"pgo: training run finished (server exit {rc})")
    sys.exit(rc)


if __name__ == "__main__":
    main()
