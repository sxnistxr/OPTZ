# Restore runbook

Backups are in `/var/backups/optz/feed-<UTC stamp>.db.gz`, each with a `.sha256` of the
uncompressed file. Every backup already passed `PRAGMA integrity_check` before it was kept.

## 1. Pick and verify the backup

```sh
cd /var/backups/optz
ls -1t feed-*.db.gz | head                      # newest first
B=feed-YYYYMMDDTHHMMSSZ.db.gz                   # the one to restore
gunzip -c "$B" > /tmp/restore.db
sha256sum /tmp/restore.db; cat "$B.sha256"      # the two hashes must match
python3 -c "import sqlite3; d=sqlite3.connect('/tmp/restore.db'); print(d.execute('PRAGMA integrity_check').fetchone()[0], d.execute('SELECT count(*), max(id) FROM posts').fetchone())"
```

Expect `ok` and a plausible post count and max id.

## 2. Swap it in

```sh
sudo systemctl stop optz                         # clean stop: drains and checkpoints the WAL
sudo mv /var/lib/optz/feed.db /var/lib/optz/feed.db.bad-$(date +%s)
sudo rm -f /var/lib/optz/feed.db-wal /var/lib/optz/feed.db-shm   # stale WAL/shm from the old file
sudo install -o optz -g optz -m 0640 /tmp/restore.db /var/lib/optz/feed.db
sudo -u optz python3 -c "import sqlite3; sqlite3.connect('/var/lib/optz/feed.db').execute('PRAGMA journal_mode=WAL')"
sudo systemctl start optz
```

Never leave a `-wal` file from a *different* database next to the restored one. SQLite would try
to apply it.

## 3. Check

```sh
curl -s http://127.0.0.1:$(sed -n 's/^PORT=//p' /etc/optz/env)/health    # {"status":"ok",...}
curl -s http://127.0.0.1:$(sed -n 's/^PORT=//p' /etc/optz/env)/feed | head -c 300
journalctl -u optz -n 20 --no-pager
```

Writes made after the backup's timestamp are lost unless an off-box replica (below) has them.
Keep `feed.db.bad-*` until you're sure it isn't needed.

## Off-box copies

The backup unit has a commented-out `ExecStartPost` for `rclone copy` to object storage. That's
the recommended off-box path: copies that have already been verified, on a fixed schedule.
Litestream can stream the WAL continuously instead (point-in-time restore). Its last release I
could confirm was v0.5.0 (Oct 2025), so check that it's still maintained before relying on it.
