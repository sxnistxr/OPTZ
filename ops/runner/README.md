# Administrative task runner

The old plaintext HTTP/root shell runner is retired. Installing the replacement disables its systemd service. Existing servers must run this installer or explicitly disable `optz-runner.service`; changing repository files alone does not retire a running service.

Run `sudo bash ops/runner/install.sh /path/to/client-key.pub` on the server. Add only fixed, trusted commands to root-owned `/etc/optz-runner/tasks.json`, for example:

```json
{"health":{"argv":["/usr/bin/curl","-fsS","http://127.0.0.1:3000/health"]}}
```

Connect with `RUNNER_SSH_HOST=optz-runner@your-host python3 ops/runner/remote.py run health`. Enroll the server host key through a trusted channel first. Standard SSH key authentication and encryption replace HMAC over HTTP. The installed key has a forced command, no PTY, forwarding, agent forwarding or user rc. Tasks run as `optz-runner`, with no sudo grants, a fixed environment, bounded output, a 110-second deadline and one concurrent task. The allowlist permits no tasks initially. Definitions must not invoke interpreters, shells, or scripts writable by the runner account.

Arbitrary shell strings and persistent background jobs are intentionally unsupported. Use normal administrator SSH for deployment; do not grant deployment privileges to this account. Remove the old runner secret after retiring any old clients.
