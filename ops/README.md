# ops: production deployment (outside the challenge submission)

The challenge entry in `submissions/rust-iouring-sxnistxr/` stays exactly what the rules ask
for. Everything needed to run it as a real service lives here.

| file | what it does |
|---|---|
| `nginx/optz.conf` | :80 → `/api/*` to the Rust API (127.0.0.1:3000), `/assets/*` from disk, everything else to the site on Bun (127.0.0.1:3001) |
| `systemd/optz-web.service` | Runs the site (`apps/site`, on the optz framework) with Bun, memory-capped and sandboxed |
| `mint-token.py` | Signs a posting token for a username (creating its user row) with the server's secret |
| `install-prod.sh` | One-time install on Ubuntu 24.04: `optz` user, `/var/lib/optz`, `/etc/optz/env` (with a random JWT secret unless given), the database (empty schema or `--seed`), toolchain, units, journald limit, first deploy |
| `deploy.sh` | Builds the current commit as the `optz` user (shared cargo cache, so later builds are incremental), installs it as `/opt/optz/releases/<sha>`, switches `/opt/optz/current`, restarts, and **rolls back if `/health` isn't OK within 30 s**. Keeps 5 releases |
| `systemd/optz.service` | `Restart=on-failure`, `LimitNOFILE=65535`, `CAP_NET_BIND_SERVICE` only, `MemoryHigh/Max`, `ProtectSystem=strict`, `NoNewPrivileges`, syscall filter (with io_uring), etc. |
| `backup/optz-backup.{py,service,timer}` | Hourly online snapshot backup, `integrity_check` on every copy, gzip + sha256, keeps 24 hourly + 14 daily; the unit fails loudly if verification fails |
| `journald/optz.conf` | Caps journal disk use at 200 MB |
| `RESTORE.md` | Step-by-step restore |
| `runner/` | Signed remote-command runner used for testing on the VPS (not needed in production) |

## Continuous deployment from this repo

`deploy/` (set up on the VPS) pulls the tracked branch every 30 s and runs
`deploy/post-deploy.sh`, which calls `ops/deploy.sh` once production is installed. So every push
gets built and deployed, and a bad commit is rolled back automatically.

```sh
# on the VPS, once:
sudo bash /srv/optz/ops/install-prod.sh                  # site on :80 (Bun on 3001), API on 127.0.0.1:3000
```

## Verified here

- The backup under continuous writes (17.7k creates/s): finishes in 20 s with a consistent
  snapshot, and the writer isn't blocked. A batched backup (pages=1000) restarted on every write
  and only finished after writes stopped, so it's single-step now.
- Restoring a backup: its sha256 matches the record, `integrity_check` returns ok.
- systemd units, `install-prod.sh` and `deploy.sh` need a systemd host. They are syntax-checked
  here and get exercised on the VPS.
