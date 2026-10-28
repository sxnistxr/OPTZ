#!/usr/bin/python3
"""Forced SSH command. No shell interpretation, stdin protocol or arbitrary sudo arguments."""
import os
import re
import subprocess
import sys


def command(value):
    match = re.fullmatch(r"deploy ([0-9a-f]{40}) ([1-9][0-9]{0,19})", value)
    if not match:
        raise ValueError("only 'deploy FULL_SHA CI_RUN_ID' is accepted")
    return ["/usr/bin/sudo", "-n", "/usr/local/lib/optz-deploy/controller.py", *match.groups()]


if __name__ == "__main__":
    try:
        result = subprocess.run(command(os.environ.get("SSH_ORIGINAL_COMMAND", "")), stdin=subprocess.DEVNULL)
        sys.exit(result.returncode)
    except (ValueError, OSError) as error:
        sys.exit(str(error))
