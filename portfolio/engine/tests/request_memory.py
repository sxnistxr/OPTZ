#!/usr/bin/env python3
"""Bound incomplete uploads across existing sockets; verify close/drain reclaims the quota."""
import argparse
from pathlib import Path
import resource
import selectors
import shutil
import socket
import sqlite3
import tempfile
import time

import harness


def ensure_fd_limit(client_count=1024):
    # Leave room for the selector, health checks and server/log descriptors, too.
    required = client_count + len(list(Path("/proc/self/fd").iterdir())) + 32
    soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    if soft == resource.RLIM_INFINITY or soft >= required:
        return
    prerequisite = f"RLIMIT_NOFILE >= {required} is required for {client_count} clients plus existing descriptors (soft={soft}, hard={hard})"
    if hard != resource.RLIM_INFINITY and hard < required:
        raise RuntimeError(prerequisite + "; increase the hard limit before running this test")
    try:
        resource.setrlimit(resource.RLIMIT_NOFILE, (required, hard))
    except (OSError, ValueError) as error:
        raise RuntimeError(prerequisite + "; unable to raise the soft limit") from error


def partial_uploads(port, complete=False, count=1024):
    # Connect everyone first: admission control cannot protect against subsequent growth.
    clients = []
    try:
        for _ in range(count):
            clients.append(socket.create_connection(("127.0.0.1", port), timeout=3))
        incomplete = b"POST /posts HTTP/1.1\r\nHost: test\r\nContent-Length: 65536\r\n\r\n" + b"x" * 65535
        for client in clients:
            try:
                client.sendall(incomplete)
            except (BrokenPipeError, ConnectionResetError):
                # Expected under load: some peers may already be closed/reset.
                # This test accounts for that later by measuring which sockets remain open.
                pass
        closed = set()
        with selectors.DefaultSelector() as poll:
            for client in clients:
                client.setblocking(False)
                poll.register(client, selectors.EVENT_READ)
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                for key, _ in poll.select(0.05):
                    try:
                        data = key.fileobj.recv(1, socket.MSG_PEEK)
                    except BlockingIOError:
                        continue
                    except ConnectionResetError:
                        data = b""
                    if data == b"":
                        closed.add(key.fd)
                        poll.unregister(key.fileobj)
        held = count - len(closed)
        assert 128 <= held <= 600, f"expected a bounded set of buffered uploads, got {held}"
        if complete:
            # Completing a body must release its quota even before the socket closes.
            for client in clients:
                if client.fileno() not in closed:
                    client.settimeout(3)
                    client.sendall(b"x")
                    status, _, _, _ = harness.read_response(client)
                    assert status == 401, f"complete unauthenticated upload returned {status}"
        assert harness.request(port, "GET", "/health")[0] == 200
        return held
    finally:
        for client in clients:
            client.close()


def peak_rss(pid):
    return int(next(line.split()[1] for line in Path(f"/proc/{pid}/status").read_text().splitlines() if line.startswith("VmHWM:")))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", default=harness.BINARY)
    parser.add_argument("--port", type=int, default=3192)
    args = parser.parse_args()
    try:
        ensure_fd_limit()
    except RuntimeError as error:
        parser.error(str(error))
    harness.BINARY = args.binary
    with tempfile.TemporaryDirectory(prefix="optz-request-memory-") as directory:
        seed = Path(directory) / "seed.db"
        with sqlite3.connect(seed) as db:
            db.executescript(Path(__file__).with_name("schema.sql").read_text())
            db.execute("INSERT INTO users(id, username) VALUES (1, 'fixture')")
        server = harness.Server(str(seed), args.port, db=str(seed))
        try:
            server.start()
            before = peak_rss(server.proc.pid)
            first = partial_uploads(args.port)
            time.sleep(0.1)  # let disconnect completions release all retained buffers
            second = partial_uploads(args.port, complete=True)
            time.sleep(0.1)
            third = partial_uploads(args.port)
            growth = peak_rss(server.proc.pid) - before
            assert growth < 96 * 1024, f"partial uploads grew peak RSS by {growth} KiB"
            print(f"request memory: held {first}/{second}/{third} uploads across three rounds; peak RSS growth {growth} KiB; healthy")
        except Exception:
            print(server.logtext())
            raise
        finally:
            if server.proc is not None:
                server.stop()
            if hasattr(server, "log"):
                server.log.close()
            # The harness keeps logs separate from the isolated database.
            shutil.rmtree(server.dir)


if __name__ == "__main__":
    main()
