# Deployment

The old root service that polled a mutable Git branch and ran repository hooks is retired. On existing VPS installations, run `sudo bash deploy/setup-vps.sh` to stop and disable `optz-sync.timer` and its service. Repository changes alone do not stop an installed timer.

Use `ops/install-prod.sh` for initial installation. Promote an explicitly reviewed commit with `sudo bash ops/deploy.sh /path/to/reviewed-checkout`; it builds unprivileged and uses health-checked releases with rollback. Do not run deployment through the task runner or enable unattended repository hooks. Review deployment scripts and configuration along with the commit being promoted.

For CI automation, publish immutable build artifacts identified by commit and digest and give a separate deployment identity only permission to promote those approved artifacts. No root credentials belong in pull-request jobs. Runtime data stays outside the checkout under `/var/lib/optz`.

## Restore automatic GitHub deployment

Run `sudo python3 ops/migrate-autodeploy.py --host your-server.example --configure-github`
from the updated server checkout. It migrates the existing production installation, preserves
its app/database, installs a restricted SSH deployment identity and sandboxed builder, and uses
an authenticated GitHub CLI session to configure production secrets and the Deploy workflow.
Preview with `--dry-run`. See [automatic deployment migration](../ops/autodeploy/README.md)
for prerequisites, private repositories, SSH ports, backups and retry behavior.
