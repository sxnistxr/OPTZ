#!/usr/bin/env python3
"""SSH forced command: execute one administrator-allowlisted task, without a shell or HTTP.

Install root-owned task definitions in /etc/optz-runner/tasks.json:
  {"health": {"argv": ["/usr/bin/curl", "-fsS", "http://127.0.0.1:3000/health"]}}
The SSH client sends {"task":"health"}. No caller-supplied arguments are executed.
"""
import fcntl
from contextlib import suppress
import json
import os
import resource
import signal
import subprocess
import sys
import tempfile

MAX_INPUT = 4096
MAX_OUTPUT = 4 << 20


def execute(task, tasks, state, timeout=110):
    spec = tasks.get(task) if isinstance(task, str) else None
    if not isinstance(spec, dict):
        raise ValueError("unknown task")
    argv = spec.get("argv")
    if not isinstance(argv, list) or not argv or not all(isinstance(a, str) for a in argv) or not os.path.isabs(argv[0]):
        raise ValueError("task must define an absolute executable and fixed argv")
    # One task at a time across SSH sessions. No persistent jobs or accumulating logs.
    with open(os.path.join(state, "task.lock"), "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("runner busy") from None
        with tempfile.TemporaryFile(dir=state) as output:
            def limits():
                resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT, MAX_OUTPUT))
                resource.setrlimit(resource.RLIMIT_CPU, (timeout, timeout))
                resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
                resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
                os.umask(0o077)
            p = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
                                 cwd=state, env={"PATH": "/usr/bin:/bin", "HOME": state, "LANG": "C.UTF-8"},
                                 start_new_session=True, preexec_fn=limits)
            try:
                code = p.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                code = -1
            finally:
                # Also kill descendants of tasks that have already exited.
                # The group may already be gone; still reap the task below.
                with suppress(ProcessLookupError):
                    os.killpg(p.pid, signal.SIGKILL)
                p.wait()
            output.seek(0)
            return {"exit": code, "output": output.read(MAX_OUTPUT).decode("utf-8", "replace")}


def input_timeout(*_):
    raise ValueError("input timeout")


def main():
    if os.geteuid() == 0:
        raise ValueError("runner must not run as root")
    signal.signal(signal.SIGALRM, input_timeout)
    signal.alarm(10)
    raw = sys.stdin.buffer.readline(MAX_INPUT + 1)
    signal.alarm(0)
    if len(raw) > MAX_INPUT:
        raise ValueError("request too large")
    data = json.loads(raw)
    if not isinstance(data, dict) or set(data) != {"task"}:
        raise ValueError("expected one task name")
    with open("/etc/optz-runner/tasks.json", encoding="utf-8") as f:
        tasks = json.load(f)
    if not isinstance(tasks, dict):
        raise ValueError("task configuration must be an object")
    return execute(data["task"], tasks, "/var/lib/optz-runner")


if __name__ == "__main__":
    try:
        result = main()
    except (ValueError, OSError) as e:
        result = {"exit": 1, "output": str(e)}
    print(json.dumps(result))
    sys.exit(0 if result["exit"] == 0 else 1)
