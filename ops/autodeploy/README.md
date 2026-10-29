# Automatic deployment migration

This migrates an **existing Ubuntu 24.04 production installation** to GitHub → successful CI → restricted SSH → isolated build → health-checked release. It does not initialize or rewrite the database. It leaves the current app running during migration; a later successful deployment restarts the app services and rolls back if health checks fail.

Commit and push these changes, including `.github/workflows/deploy.yml`, through your normal review process first. On the VPS, use a checkout containing this migration and its `ops/autodeploy/` files. Set the public host/SSH port GitHub runners can reach. Do not change your admin SSH access or firewall during migration.

```sh
# Preview; no root, credentials, files, accounts or service changes.
python3 ops/migrate-autodeploy.py --host your-server.example --port 22 --dry-run

# One-time prerequisites if they are not installed. The existing OPTZ installation already
# supplies the pinned Bun/Rust toolchains, systemd services, nginx and database.
sudo apt-get install -y python3 git openssh-client sudo gh

# Authenticate as the repository administrator. Classic token scopes: repo and workflow.
# gh stores credentials; no token or SSH private key goes in command-line arguments.
gh auth login --scopes repo,workflow

# Apply the VPS migration AND configure GitHub automatically.
sudo python3 ops/migrate-autodeploy.py \
  --repo /srv/optz --host your-server.example --port 22 --configure-github
```

Replace the host and checkout path. The script uses the invoking user's authenticated `gh` session through `runuser`; when already running as root, authenticate `gh` as root or provide `GH_TOKEN` through the environment. With a fine-grained token, grant the permissions needed to manage Actions, the production environment and its secrets, and Contents/Workflows if the workflow has not already been committed. Repository rules and environment approvals are preserved; the script does not bypass protected branches. An existing unrelated `deploy.yml` is refused unless you explicitly pass `--replace-workflow`.

If GitHub configuration succeeds and the latest `main` CI run already passed before setup, the script reruns that CI once to activate deployment. If CI is still running, it waits for that run; failed CI never deploys. Later pushes deploy automatically after CI passes. The server independently validates the successful CI run ID, exact SHA, workflow path, repository, event and branch, and checks that the SHA is still the latest `main` both before building and before promotion. Superseded runs do not roll the server back.

## What changes

- Backs up migration configuration to a timestamped root-only directory under `/var/backups/optz-autodeploy/` and records the old service state.
  Each snapshot keeps `/etc/optz-deploy` in `config/`, `/usr/local/lib/optz-deploy` in
  `helpers/`, and `/etc/sudoers.d/optz-deploy` in `sudoers`, so their identical names cannot collide.
- Stops the legacy polling timer without killing an active deployment; if one is running, migration refuses and can be retried after it finishes.
- Installs root-owned deployment code under `/usr/local/lib/optz-deploy/`. Automatic deployment never executes updated repository scripts as root and cannot install systemd units or nginx directives from the build.
- Creates `optz-deploy` for a forced SSH command, with no PTY or forwarding, and one narrowly scoped sudo entrypoint. The entrypoint validates all arguments and accepts no shell commands, repository paths or configuration arguments.
- Creates a separate `optz-build` identity. Builds run in a systemd sandbox with production secrets/data inaccessible, capped memory/processes/CPU, a 30-minute limit and descendant cleanup. Builds do not use the runtime `optz` identity.
- Generates an Ed25519 key once and preserves it on reruns. The private key is stored root-only and passed to GitHub through stdin. SSH host pinning comes from the server's installed public host key, not an unauthenticated network scan.
- Configures `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_KEY` and `DEPLOY_KNOWN_HOSTS` as **production environment secrets**. New environments allow only `main`; existing environment approvals/branch rules remain unchanged.
- Retires the old HTTP runner after the replacement installation succeeds. The optional administrative task runner is independent of deployment.

Existing app units, nginx configuration, `/etc/optz/env`, databases and backups are not rewritten. Updating those privileged configurations remains an explicit administrative operation with reviewed files. The automatic controller preserves the five newest managed releases plus the immediate rollback target and never removes legacy release directories. If existing Cloudflare purge credentials are configured in `/etc/optz/env`, it attempts a purge after a successful deployment.

## Without GitHub authentication on the VPS

Omit `--configure-github`. This installs the server side and retires the insecure services, but automatic deployment remains pending until GitHub is configured. The script writes:

- `/etc/optz-deploy/deploy.yml`: workflow to commit as `.github/workflows/deploy.yml` if it is not already in the repository.
- `/etc/optz-deploy/github-secrets/{DEPLOY_HOST,DEPLOY_PORT,DEPLOY_KEY,DEPLOY_KNOWN_HOSTS}`: root-only input files. Feed them to `gh secret set NAME --repo OWNER/REPO --env production` through stdin on the server; never print the private key or paste it into chat.

Rerun the same command with `--configure-github` once authenticated. Reruns preserve the key and live app. Configuration is written atomically and the sudo rule is checked with `visudo`. If GitHub permissions or repository rules reject activation, correct them and rerun; the app stays running, while the insecure polling timer stays disabled.

## Private repositories and API limits

For a private repository, or to avoid GitHub's anonymous API rate limit, supply `--github-token-file /path/to/read-token`. Use a separate token with **read-only Contents and Actions** access to this one repository. The script stores it at `/etc/optz-deploy/github-token` with mode 0600. The controller uses it for API validation and fetching source; it is not exposed to the build or runtime. The authenticated `gh` setup session is separate and needs broader one-time setup permissions.

## Monitor and recover

The controller and builder are frozen under `/usr/local/lib/optz-deploy/`; pushing changes
to their repository copies does not update an existing server. Before deploying this
backup-layout fix, rerun the migration from a reviewed checkout containing the fix:

```sh
sudo python3 ops/migrate-autodeploy.py \
  --repo /srv/optz --host your-server.example --port 22 --configure-github
```

This refreshes the frozen helpers and preserves the dedicated SSH key, database and running
app. Install this refresh before merging/deploying the new commit: completed releases for
an already-deployed SHA are reused, so refreshing the builder does not rebuild that release.
New releases include the backup script at the installed unit's expected path and preserve
the authentication workspace links. After the next successful deployment, run
`sudo systemctl start optz-backup.service` and check `journalctl -u optz-backup.service -n 20`.

Use the GitHub **Deploy** workflow logs and `journalctl -u optz-build` for build failures. An unsuccessful build does not change the live symlink. A failed restart/health check restores the previous symlink and restarts both app services; a failed rollback health check is reported explicitly. A reboot or interrupted SSH session may leave a completed release to reuse on retry; incomplete copied staging directories are cleaned before the same SHA is built again.

The server must be reachable from GitHub-hosted runners over its SSH port. This script does not open firewall ports or remove your administrator keys. If the server is private, use a trusted self-hosted deployment runner with network access and update `runs-on` in the workflow rather than exposing the old HTTP runner.

For maintenance, disable the Deploy workflow or revoke `/etc/optz-deploy/.ssh/authorized_keys`; do not re-enable the retired HTTP root runner. Audit privileged deployment-controller updates as administrative changes and rerun migration from a reviewed checkout when upgrading them.

## Local validation

`python3 -m unittest discover -s ops/autodeploy -p 'test_*.py'` covers release/service paths,
authentication workspace links, forced-command injection,
CI provenance, escaping artifacts, dry runs, key-preserving migration reruns, environment-rule
preservation, one-time CI activation, sandbox construction and failed-health rollback. Tests
use temporary directories and mocked systemd/GitHub operations; they do not substitute for a
first deployment on your VPS. `bash -n ops/autodeploy/build.sh` checks the builder script.
`python3 -m unittest discover -s ops/backup -p 'test_*.py'` checks zero/default/negative retention.
