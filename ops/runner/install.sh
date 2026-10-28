#!/usr/bin/env bash
# Install an SSH-only, unprivileged task runner. Takes a PUBLIC key file, never a secret.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
key_file="${1:?usage: install.sh /path/to/public-key.pub}"
ssh-keygen -l -f "$key_file" >/dev/null
read -r key_type key_data _ < "$key_file"
case "$key_type" in ssh-ed25519|ssh-rsa|ecdsa-sha2-*) ;; *) echo "unsupported public key" >&2; exit 1;; esac
# Retire the old public root service before installing the replacement.
systemctl disable --now optz-runner.service 2>/dev/null || true
rm -f /etc/systemd/system/optz-runner.service
systemctl daemon-reload
id optz-runner >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/optz-runner --shell /bin/sh optz-runner
install -d -m 0755 /usr/local/lib/optz-runner /etc/optz-runner
install -m 0644 "$(dirname "$0")/runner.py" /usr/local/lib/optz-runner/runner.py
# Existing root-owned allowlist survives reinstalls; initial install permits no tasks.
if [ ! -f /etc/optz-runner/tasks.json ]; then printf '{}\n' > /etc/optz-runner/tasks.json; fi
chown root:root /etc/optz-runner/tasks.json
chmod 0644 /etc/optz-runner/tasks.json
install -d -o optz-runner -g optz-runner -m 0700 /var/lib/optz-runner
# Keep authorized_keys and the account's home root-owned so tasks cannot replace restrictions.
usermod -d /etc/optz-runner optz-runner
install -d -m 0755 /etc/optz-runner/.ssh
printf 'restrict,command="/usr/bin/python3 /usr/local/lib/optz-runner/runner.py" %s %s\n' "$key_type" "$key_data" > /etc/optz-runner/.ssh/authorized_keys
chown root:root /etc/optz-runner/.ssh/authorized_keys
chmod 0644 /etc/optz-runner/.ssh/authorized_keys
printf 'Installed SSH task runner. Add fixed commands to /etc/optz-runner/tasks.json. No HTTP listener.\n'
