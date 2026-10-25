#!/usr/bin/env python3
"""Client for runner.py.

  remote.py run  "<cmd>" [timeout]     run and print output, exit with its code
  remote.py job  "<cmd>"               start a background job, follow its output
  remote.py tail <id>                  follow an existing job
  remote.py kill <id>

Env: RUNNER_URL (default http://162.35.162.49), RUNNER_SECRET_FILE (path to the shared secret).
"""
import hashlib, hmac, json, os, secrets, sys, time, urllib.request

URL = os.environ.get("RUNNER_URL", "http://162.35.162.49").rstrip("/")
SECRET = open(os.environ["RUNNER_SECRET_FILE"], "rb").read().strip()


def call(method, path, obj=None, timeout=130):
    body = json.dumps(obj).encode() if obj is not None else b""
    ts, nonce = str(int(time.time())), secrets.token_hex(12)
    msg = f"{method}\n{path}\n{ts}\n{nonce}\n{hashlib.sha256(body).hexdigest()}".encode()
    req = urllib.request.Request(URL + path, data=body if method == "POST" else None, method=method, headers={
        "X-Ts": ts, "X-Nonce": nonce, "X-Sig": hmac.new(SECRET, msg, hashlib.sha256).hexdigest(),
        "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def follow(jid):
    off = 0
    while True:
        r = call("GET", f"/jobs/{jid}?offset={off}")
        sys.stdout.write(r["output"]); sys.stdout.flush()
        off = r["offset"]
        if not r["running"] and not r["output"]:
            print(f"[job {jid} exit {r['exit']}]")
            return r["exit"] or 0
        if not r["output"]:
            time.sleep(2)


if __name__ == "__main__":
    op = sys.argv[1]
    if op == "run":
        r = call("POST", "/run", {"cmd": sys.argv[2], "timeout": float(sys.argv[3]) if len(sys.argv) > 3 else 100})
        sys.stdout.write(r["output"]); sys.exit(0 if r["exit"] == 0 else 1)
    elif op == "job":
        r = call("POST", "/jobs", {"cmd": sys.argv[2]}); print(f"[job {r['id']}]"); sys.exit(follow(r["id"]))
    elif op == "tail":
        sys.exit(follow(sys.argv[2]))
    elif op == "kill":
        print(call("POST", f"/jobs/{sys.argv[2]}/kill"))
