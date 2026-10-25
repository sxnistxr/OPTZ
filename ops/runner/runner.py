#!/usr/bin/env python3
"""Remote test runner for the OPTZ VPS.

Runs shell commands sent by an authorised client and streams their output back.
Plain HTTP (the only thing the session's egress proxy can reach), so every request
is signed instead of carrying the secret:

  X-Ts:    unix seconds; must be within 120 s of the server clock
  X-Nonce: random string, never accepted twice
  X-Sig:   hex HMAC-SHA256(secret, "METHOD\\nPATH\\nTS\\nNONCE\\nsha256hex(body)")

Requests can't be forged or replayed, but they and their output travel unencrypted,
so don't run commands that print secrets.

Endpoints (all JSON):
  GET  /ping                         unauthenticated liveness check
  POST /run    {"cmd", "timeout"?}   run synchronously (timeout <= 110 s)
  POST /jobs   {"cmd"}               start a background job -> {"id"}
  GET  /jobs/<id>?offset=N           output from byte N, plus status and exit code
  POST /jobs/<id>/kill               SIGKILL the job's process group
"""
import hashlib, hmac, json, os, secrets, signal, subprocess, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

SECRET = open(os.environ.get("RUNNER_SECRET_FILE", "/etc/optz-runner/secret"), "rb").read().strip()
STATE = os.environ.get("RUNNER_STATE", "/var/lib/optz-runner")
PORT = int(os.environ.get("RUNNER_PORT", "80"))
WINDOW = 120
MAX_BODY = 1 << 20
MAX_CHUNK = 4 << 20

os.makedirs(f"{STATE}/jobs", exist_ok=True)
nonces, nonce_lock = {}, threading.Lock()
jobs, jobs_lock = {}, threading.Lock()


def verify(method, path, headers, body):
    try:
        ts = int(headers.get("X-Ts", ""))
    except ValueError:
        return False
    nonce, sig = headers.get("X-Nonce", ""), headers.get("X-Sig", "")
    now = time.time()
    if abs(now - ts) > WINDOW or not (8 <= len(nonce) <= 64):
        return False
    msg = f"{method}\n{path}\n{ts}\n{nonce}\n{hashlib.sha256(body).hexdigest()}".encode()
    if not hmac.compare_digest(hmac.new(SECRET, msg, hashlib.sha256).hexdigest(), sig):
        return False
    with nonce_lock:
        for n, t in list(nonces.items()):
            if now - t > 2 * WINDOW:
                del nonces[n]
        if nonce in nonces:
            return False
        nonces[nonce] = now
    return True


def start_job(cmd):
    jid = time.strftime("%Y%m%d-%H%M%S-") + secrets.token_hex(3)
    log = open(f"{STATE}/jobs/{jid}.log", "wb")
    p = subprocess.Popen(["bash", "-lc", cmd], stdout=log, stderr=subprocess.STDOUT,
                         stdin=subprocess.DEVNULL, start_new_session=True, cwd="/root")
    job = {"id": jid, "cmd": cmd, "pid": p.pid, "started": time.time(), "exit": None, "proc": p}
    with jobs_lock:
        jobs[jid] = job

    def reap():
        job["exit"] = p.wait()
        job["ended"] = time.time()
        log.close()
    threading.Thread(target=reap, daemon=True).start()
    return job


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def reply(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_any(self, method):
        url = urlsplit(self.path)
        if method == "GET" and url.path == "/ping":
            return self.reply(200, {"ok": True, "time": int(time.time())})
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            return self.reply(413, {"error": "body too large"})
        body = self.rfile.read(n) if n else b""
        if not verify(method, self.path, self.headers, body):
            time.sleep(1)  # slow down guessing
            return self.reply(401, {"error": "bad signature"})
        try:
            args = json.loads(body) if body else {}
        except ValueError:
            return self.reply(400, {"error": "bad json"})
        parts = url.path.strip("/").split("/")

        if method == "POST" and parts == ["run"]:
            t = min(float(args.get("timeout", 60)), 110)
            t0 = time.time()
            try:
                r = subprocess.run(["bash", "-lc", args["cmd"]], capture_output=True, timeout=t,
                                   stdin=subprocess.DEVNULL, cwd="/root")
                out, code = r.stdout + r.stderr, r.returncode
            except subprocess.TimeoutExpired as e:
                out, code = (e.stdout or b"") + (e.stderr or b"") + b"\n[runner] timed out\n", -1
            return self.reply(200, {"exit": code, "secs": round(time.time() - t0, 3),
                                    "output": out[-MAX_CHUNK:].decode("utf-8", "replace")})
        if method == "POST" and parts == ["jobs"]:
            job = start_job(args["cmd"])
            return self.reply(200, {"id": job["id"], "pid": job["pid"]})
        if len(parts) >= 2 and parts[0] == "jobs":
            with jobs_lock:
                job = jobs.get(parts[1])
            if job is None:
                return self.reply(404, {"error": "no such job"})
            if method == "POST" and parts[2:] == ["kill"]:
                try:
                    os.killpg(job["pid"], signal.SIGKILL)
                except ProcessLookupError:
                    pass
                return self.reply(200, {"killed": True})
            if method == "GET" and len(parts) == 2:
                off = int(parse_qs(url.query).get("offset", ["0"])[0])
                with open(f"{STATE}/jobs/{job['id']}.log", "rb") as f:
                    f.seek(off)
                    chunk = f.read(MAX_CHUNK)
                return self.reply(200, {"id": job["id"], "exit": job["exit"], "running": job["exit"] is None,
                                        "offset": off + len(chunk), "output": chunk.decode("utf-8", "replace")})
        return self.reply(404, {"error": "not found"})

    def do_GET(self):
        self.handle_any("GET")

    def do_POST(self):
        self.handle_any("POST")

    def log_message(self, fmt, *a):
        pass  # no per-request logging; journald gets only startup lines


if __name__ == "__main__":
    print(f"optz-runner listening on :{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
