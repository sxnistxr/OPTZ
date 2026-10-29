#!/usr/bin/env python3
"""Online SQLite backup with verification and retention.

Uses SQLite's online backup API in a single step: one read transaction over a consistent
snapshot. In WAL mode a reader never blocks the server's writer. (Copying in page batches
looks gentler, but any write to the source from another connection restarts a batched backup
from the beginning, so under steady writes it may never finish: measured, see
docs/MEASUREMENTS.md.) Every copy gets `PRAGMA integrity_check` before it counts. If the check
fails the copy is deleted and the run exits non-zero, so systemd marks the unit failed.

  optz-backup.py --db /var/lib/optz/feed.db --dest /var/backups/optz [--hourly 24] [--daily 14]

Copies are gzip-compressed. Retention keeps the newest N hourly copies, plus the newest copy of
each of the last M days.
"""
import argparse, datetime, gzip, hashlib, os, shutil, sqlite3, sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--dest", required=True)
    ap.add_argument("--hourly", type=int, default=24)
    ap.add_argument("--daily", type=int, default=14)
    a = ap.parse_args()
    if a.hourly < 0 or a.daily < 0:
        ap.error("retention counts must be non-negative")
    os.makedirs(a.dest, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    tmp = os.path.join(a.dest, f".feed-{stamp}.db.partial")

    src = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True, timeout=30)
    dst = sqlite3.connect(tmp)
    src.backup(dst, pages=-1)
    src.close()
    ok = dst.execute("PRAGMA integrity_check").fetchone()[0]
    posts = dst.execute("SELECT count(*), max(id) FROM posts").fetchone()
    dst.execute("PRAGMA journal_mode=DELETE")
    dst.close()
    if ok != "ok":
        os.remove(tmp)
        print(f"backup FAILED integrity_check: {ok}", file=sys.stderr)
        sys.exit(1)

    final = os.path.join(a.dest, f"feed-{stamp}.db.gz")
    h = hashlib.sha256()
    with open(tmp, "rb") as fi, gzip.open(final + ".partial", "wb", compresslevel=6) as fo:
        while chunk := fi.read(1 << 20):
            h.update(chunk)
            fo.write(chunk)
    os.replace(final + ".partial", final)
    with open(final + ".sha256", "w") as f:
        f.write(f"{h.hexdigest()}  feed-{stamp}.db\n")
    os.remove(tmp)
    print(f"backup ok: {final} ({os.path.getsize(final) >> 20} MiB gz), posts={posts[0]} max_id={posts[1]}")

    # Retention.
    copies = sorted(f for f in os.listdir(a.dest) if f.startswith("feed-") and f.endswith(".db.gz"))
    keep = set(copies[-a.hourly:]) if a.hourly else set()
    by_day = {}
    for f in copies:
        by_day[f[5:13]] = f  # last copy of each day wins
    if a.daily:
        keep |= set(sorted(by_day.values())[-a.daily:])
    for f in copies:
        if f not in keep:
            os.remove(os.path.join(a.dest, f))
            if os.path.exists(os.path.join(a.dest, f + ".sha256")):
                os.remove(os.path.join(a.dest, f + ".sha256"))


if __name__ == "__main__":
    main()
