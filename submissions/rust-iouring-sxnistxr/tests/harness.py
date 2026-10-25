"""Shared helpers for the integration tests: start the server on a fresh seed copy, sign JWTs,
and speak raw HTTP/1.1 over sockets (so pipelining and partial writes can be tested)."""
import base64, hashlib, hmac, json, os, shutil, signal, socket, subprocess, tempfile, time

SECRET = b"twelve-dollar-challenge"
HERE = os.path.dirname(os.path.abspath(__file__))
BINARY = os.path.join(HERE, "..", "target", "release", "twelve-iouring")


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def token(sub="1", username="golden_ember_1", exp_in=3600):
    now = int(time.time())
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    p = b64(json.dumps({"sub": sub, "username": username, "iat": now, "exp": now + exp_in}).encode())
    sig = hmac.new(SECRET, f"{h}.{p}".encode(), hashlib.sha256).digest()
    return f"{h}.{p}.{b64(sig)}"


class Server:
    def __init__(self, seed, port=3100, args=(), db=None):
        self.dir = tempfile.mkdtemp(prefix="twelve-")
        self.db = db or os.path.join(self.dir, "feed.db")
        if db is None:
            shutil.copy(seed, self.db)
        self.port, self.args = port, list(args)
        self.proc = None

    def start(self):
        env = dict(os.environ, SQLITE_PATH=self.db, JWT_SECRET=SECRET.decode(), HOST="127.0.0.1", PORT=str(self.port))
        self.log = open(os.path.join(self.dir, "server.log"), "ab")
        self.proc = subprocess.Popen([BINARY, *self.args], env=env, stdout=self.log, stderr=self.log)
        for _ in range(200):
            try:
                s, b = request(self.port, "GET", "/health")
                if s == 200:
                    return self
            except OSError:
                time.sleep(0.05)
        raise RuntimeError("server did not become healthy")

    def kill9(self):
        self.proc.send_signal(signal.SIGKILL)
        self.proc.wait()

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.send_signal(signal.SIGTERM)
            self.proc.wait(timeout=15)
        return self.proc.returncode

    def logtext(self):
        return open(os.path.join(self.dir, "server.log"), "rb").read().decode(errors="replace")


def raw(method, path, auth=None, body=None, extra=""):
    h = f"{method} {path} HTTP/1.1\r\nHost: t\r\n"
    if auth:
        h += f"Authorization: Bearer {auth}\r\n"
    data = b""
    if body is not None:
        data = body if isinstance(body, bytes) else body.encode()
        h += f"Content-Type: application/json\r\nContent-Length: {len(data)}\r\n"
    return (h + extra + "\r\n").encode() + data


def read_response(sock, buf=b""):
    """Reads one response. Returns (status, body, headers, leftover bytes)."""
    while b"\r\n\r\n" not in buf:
        d = sock.recv(65536)
        if not d:
            raise EOFError("connection closed")
        buf += d
    head, rest = buf.split(b"\r\n\r\n", 1)
    lines = head.decode().split("\r\n")
    status = int(lines[0].split()[1])
    headers = {k.lower(): v for k, v in (l.split(": ", 1) for l in lines[1:])}
    n = int(headers["content-length"])
    while len(rest) < n:
        d = sock.recv(65536)
        if not d:
            raise EOFError("connection closed mid-body")
        rest += d
    return status, rest[:n], headers, rest[n:]


def connect(port):
    s = socket.create_connection(("127.0.0.1", port))
    s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    s.settimeout(10)
    return s


def request(port, method, path, auth=None, body=None):
    with connect(port) as s:
        s.sendall(raw(method, path, auth, body))
        st, b, _, _ = read_response(s)
        return st, b
