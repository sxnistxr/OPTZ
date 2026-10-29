from datetime import datetime, timedelta
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("optz-backup.py")


class BackupRetentionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.database = self.root / "source.db"
        with sqlite3.connect(self.database) as db:
            db.execute("CREATE TABLE posts (id INTEGER PRIMARY KEY)")
            db.execute("INSERT INTO posts VALUES (1)")
        self.destination = self.root / "backups"
        self.destination.mkdir()
        self.seed_old_backups()

    def seed_old_backups(self):
        for day in range(40):
            stamp = (datetime(2000, 1, 1) + timedelta(days=day)).strftime("%Y%m%dT%H%M%SZ")
            name = self.destination / f"feed-{stamp}.db.gz"
            name.write_bytes(b"old backup fixture")
            name.with_name(name.name + ".sha256").write_text("old checksum fixture")

    def run_backup(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), "--db", str(self.database), "--dest", str(self.destination), *args], capture_output=True, text=True, timeout=10)

    def test_zero_disables_only_its_retention_category(self):
        for hourly, daily in [(1, 0), (0, 1), (0, 0)]:
            with self.subTest(hourly=hourly, daily=daily):
                self.seed_old_backups()
                result = self.run_backup("--hourly", str(hourly), "--daily", str(daily))
                self.assertEqual(result.returncode, 0, result.stderr)
                copies = list(self.destination.glob("*.db.gz"))
                self.assertEqual(len(copies), max(hourly, daily))
                self.assertEqual(len(list(self.destination.glob("*.sha256"))), len(copies))
                self.assertFalse(any(path.name.startswith("feed-2000") for path in copies))

    def test_defaults_keep_the_newest_24_copies(self):
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(list(self.destination.glob("*.db.gz"))), 24)
        self.assertEqual(len(list(self.destination.glob("*.sha256"))), 24)

    def test_negative_counts_fail_before_writing_or_pruning(self):
        before = sorted(path.name for path in self.destination.iterdir())
        for flag in ["--hourly", "--daily"]:
            result = self.run_backup(flag, "-1")
            self.assertEqual(result.returncode, 2)
            self.assertIn("non-negative", result.stderr)
            self.assertEqual(sorted(path.name for path in self.destination.iterdir()), before)


if __name__ == "__main__":
    unittest.main()
