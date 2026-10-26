# Deployment

dihlabs.lol runs on one $12 VPS: 1 vCPU, 2 GB of memory, Ubuntu 24.04. nginx in front, the site
on Bun, the Rust engine next to it, all under systemd, updated from this repository
automatically.

## Production layout

| piece | where | runs as |
|---|---|---|
| nginx | `:80` (and `:443` with TLS) | `www-data` |
| The site (`optz start`) | `127.0.0.1:3001`, from `/opt/optz/current/web/portfolio` | `optz-web.service` |
| The Rust engine | `127.0.0.1:3000` | `optz.service` |
| Releases | `/opt/optz/releases/<sha>`, `/opt/optz/current` → the live one | |
| Data and backups | `/var/lib/optz` (SQLite), hourly verified snapshots | `optz-backup.timer` |
| Secrets | `/etc/optz/env` | root only |

## First install

```sh
ssh root@your-server
# clone into /srv/optz and pull the branch every 30 s (BRANCH defaults to main)
curl -fsSL https://raw.githubusercontent.com/sxnistxr/OPTZ/main/deploy/setup-vps.sh | sudo BRANCH=main bash
sudo bash /srv/optz/ops/install-prod.sh        # users, toolchains (pinned, checksummed), units, first deploy
```

`install-prod.sh` installs Bun 1.4.4 and the Rust toolchain from pinned, checksummed archives,
creates the `optz` user and directories, writes `/etc/optz/env` with a random secret, installs
the systemd units and runs the first deploy.

## Every deploy

`ops/deploy.sh` builds the commit, switches releases and health-checks them; it rolls back by
itself if the new release isn't healthy within 30 seconds, and keeps the five newest releases.
Follow it with `journalctl -u optz-sync.service -f`.

The site build downloads its fonts from Google at build time and renders Open Graph images, so
the server needs outbound HTTPS while building (not while serving).

## The domain and TLS

Point `dihlabs.lol` (and `www`) at the server with A records, then:

```sh
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d dihlabs.lol -d www.dihlabs.lol
```

certbot adds the `:443` server and renews by itself. The site's absolute URLs (canonical links,
Open Graph, sitemap) come from `url` in `portfolio/content/site.json`, or the `SITE_URL`
environment variable.

## nginx

The config is generated, not hand-written: `optz nginx` turns `optz.config.ts` into a server
block (hashed assets from disk with `gzip_static`, everything else to Bun with keep-alive, and
micro-caching for proxied APIs). The deploy regenerates and reloads it when it changes.

## Other ways to run an optz app

| | command | notes |
|---|---|---|
| Single executable | `optz build --compile` → `dist/server` | copy one file and run it; sharp is used if it can be found |
| Edge worker | `optz build --target edge` → `dist/edge/` | `npx wrangler deploy` from there (Cloudflare), or Deno Deploy / Vercel Edge |
| Static host | `optz export` → `dist/static` | no server features |

## Operations

- Logs: `journalctl -u optz -u optz-web -f`
- Restart: `sudo systemctl restart optz optz-web`
- Memory per connection on the box: `bash /srv/optz/ops/vps-mem.sh`
- Restore a backup: `ops/RESTORE.md`
