#!/usr/bin/env python3
"""Mint a posting token for the site's feed (run on the server as root).

  sudo python3 /opt/optz/current/ops/mint-token.py <username> [--days 30]

There's no login endpoint: the API trusts any HS256 token signed with JWT_SECRET. This signs
one with the secret from /etc/optz/env, and makes sure a users row exists for that name
(the feed only shows posts whose author has a users row). Paste the printed token into the
site's Feed page.
"""
import argparse, base64, hashlib, hmac, json, sqlite3, time


def env():
    out = {}
    for line in open("/etc/optz/env"):
        if "=" in line:
            k, v = line.rstrip("\n").split("=", 1)
            out[k] = v
    return out


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("username")
    ap.add_argument("--days", type=int, default=30)
    a = ap.parse_args()
    e = env()
    db = sqlite3.connect(e["SQLITE_PATH"], timeout=10)
    row = db.execute("SELECT id FROM users WHERE username = ?", (a.username,)).fetchone()
    if row is None:
        db.execute("INSERT INTO users(username) VALUES (?)", (a.username,))
        db.commit()
        row = db.execute("SELECT id FROM users WHERE username = ?", (a.username,)).fetchone()
    db.close()
    now = int(time.time())
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    p = b64(json.dumps({"sub": str(row[0]), "username": a.username, "iat": now, "exp": now + a.days * 86400},
                       separators=(",", ":")).encode())
    sig = b64(hmac.new(e["JWT_SECRET"].encode(), f"{h}.{p}".encode(), hashlib.sha256).digest())
    print(f"{h}.{p}.{sig}")


if __name__ == "__main__":
    main()
