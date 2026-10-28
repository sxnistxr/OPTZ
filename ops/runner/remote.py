#!/usr/bin/env python3
"""Run a named task via the optz-runner SSH forced command.

  RUNNER_SSH_HOST=optz-runner@your-host python3 remote.py run health
Use ~/.ssh/config for keys, port and bastion settings. Host keys must already be trusted.
"""
import json
import os
import re
import subprocess
import sys


def call(task):
    host = os.environ.get("RUNNER_SSH_HOST", "")
    if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.@:\[\]-]*", host):
        raise ValueError("set RUNNER_SSH_HOST to a trusted SSH destination")
    r = subprocess.run(["ssh", "-T", "-oBatchMode=yes", "-oStrictHostKeyChecking=yes",
                        "-oConnectTimeout=10", "-oServerAliveInterval=15", "-oServerAliveCountMax=2", host],
                       input=json.dumps({"task": task}) + "\n", text=True, capture_output=True, timeout=130)
    if r.returncode == 255:
        raise ValueError("SSH connection failed: " + r.stderr.strip())
    return json.loads(r.stdout)


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "run":
        sys.exit("usage: remote.py run <allowlisted-task>")
    try:
        result = call(sys.argv[2])
        sys.stdout.write(result["output"])
        sys.exit(0 if result["exit"] == 0 else 1)
    except (ValueError, OSError, subprocess.TimeoutExpired) as e:
        sys.exit(str(e))
