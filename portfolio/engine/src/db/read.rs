//! The read-only connection, used only by the network thread.
//!
//! Reads never see uncommitted writes: writes happen on the writer's own connection and a reply
//! is only sent after its COMMIT returns. Reads within one event-loop batch share one read
//! transaction (one WAL snapshot and one lock acquisition instead of one per statement); the
//! loop ends it before waiting for more events, so every new request starts a fresh snapshot.

use crate::json::{write_int, write_str};
use crate::sqlite::{self, Db, Stmt};

const FEED_LEN: usize = 20;
/// The newest 20 ids normally form a run of 20 consecutive ids. Up to this span we read rows
/// and likes with two range scans instead of 20 lookups each; wider spans use the exact query.
const RANGE_SPAN: i64 = 64;

const POST_SQL: &str = "SELECT p.id, p.body, p.created_at, u.username, \
     (SELECT count(*) FROM likes l WHERE l.post_id = p.id) \
     FROM posts p JOIN users u ON u.id = p.user_id";

pub struct Reader {
    // Statements before `db`: fields drop in declaration order (see sqlite::Stmt).
    begin: Stmt,
    commit: Stmt,
    health: Stmt,
    post: Stmt,
    feed_ids: Stmt,
    feed_rows: Stmt,
    feed_likes: Stmt,
    feed_exact: Stmt,
    db: Db,
    in_txn: bool,
    scratch: Scratch,
}

/// Rows from the range scan, copied out of SQLite (column pointers die on the next step) so
/// they can be emitted in feed order. Reused across requests; never shrinks.
#[derive(Default)]
struct Scratch {
    text: Vec<u8>,
    rows: Vec<Row>,
}

#[derive(Clone, Copy)]
struct Row {
    id: i64,
    body: (u32, u32),
    created_at: (u32, u32),
    author: (u32, u32),
}

impl Reader {
    pub fn open(path: &str) -> sqlite::Result<Reader> {
        let db = Db::open(path)?;
        db.busy_timeout(5000);
        db.exec(
            "PRAGMA journal_mode=WAL; PRAGMA query_only=1; PRAGMA mmap_size=1073741824; \
             PRAGMA cache_size=-16384; PRAGMA temp_store=MEMORY; PRAGMA foreign_keys=ON;",
        )?;
        Ok(Reader {
            begin: db.prepare("BEGIN")?,
            commit: db.prepare("COMMIT")?,
            health: db.prepare("SELECT 1")?,
            post: db.prepare(&format!("{POST_SQL} WHERE p.id = ?1"))?,
            feed_ids: db.prepare("SELECT id FROM posts ORDER BY created_at DESC, id DESC LIMIT 20")?,
            feed_rows: db.prepare(
                "SELECT p.id, p.body, p.created_at, u.username FROM posts p JOIN users u ON u.id = p.user_id \
                 WHERE p.id BETWEEN ?1 AND ?2",
            )?,
            feed_likes: db.prepare("SELECT post_id FROM likes WHERE post_id BETWEEN ?1 AND ?2")?,
            feed_exact: db.prepare(&format!("{POST_SQL} ORDER BY p.created_at DESC, p.id DESC LIMIT 20"))?,
            db,
            in_txn: false,
            scratch: Scratch::default(),
        })
    }

    fn txn(&mut self) -> sqlite::Result<()> {
        if !self.in_txn {
            self.begin.run()?;
            self.in_txn = true;
        }
        Ok(())
    }

    /// Ends the batch's read transaction, if one was started.
    pub fn end_batch(&mut self) {
        if self.in_txn {
            self.in_txn = false;
            if self.commit.run().is_err() {
                // A read transaction can't fail to commit in a way that matters; make sure
                // nothing stays open.
                let _ = self.db.exec("ROLLBACK");
            }
        }
    }

    pub fn health(&mut self) -> sqlite::Result<()> {
        let r = self.health.step().map(drop);
        self.health.reset();
        r
    }

    /// Writes `{"post":{...}}` and returns true, or returns false if there's no such post.
    pub fn post(&mut self, id: i64, out: &mut Vec<u8>) -> sqlite::Result<bool> {
        self.txn()?;
        let s = &mut self.post;
        s.bind_i64(1, id);
        let r = match s.step() {
            Ok(true) => {
                out.extend_from_slice(b"{\"post\":");
                write_post(out, s.int(0), s.text(1), s.text(2), s.text(3), s.int(4));
                out.push(b'}');
                Ok(true)
            }
            Ok(false) => Ok(false),
            Err(e) => Err(e),
        };
        s.reset();
        r
    }

    /// Writes `{"posts":[...]}`: the 20 newest posts, `ORDER BY created_at DESC, id DESC`.
    pub fn feed(&mut self, out: &mut Vec<u8>) -> sqlite::Result<()> {
        self.txn()?;
        let mut ids = [0i64; FEED_LEN];
        let mut n = 0;
        let r = loop {
            match self.feed_ids.step() {
                Ok(true) => {
                    ids[n] = self.feed_ids.int(0);
                    n += 1;
                }
                Ok(false) => break Ok(()),
                Err(e) => break Err(e),
            }
        };
        self.feed_ids.reset();
        r?;
        let ids = &ids[..n];
        let (lo, hi) = ids.iter().fold((i64::MAX, i64::MIN), |(lo, hi), &id| (lo.min(id), hi.max(id)));
        let start = out.len();
        if n > 0 && hi - lo < RANGE_SPAN && self.feed_range(ids, lo, hi, out)? {
            return Ok(());
        }
        out.truncate(start);
        self.feed_exact(out)
    }

    /// Range path. Returns Ok(false) if any id has no row in the join (e.g. its author row is
    /// missing), in which case the caller falls back to the exact query.
    fn feed_range(&mut self, ids: &[i64], lo: i64, hi: i64, out: &mut Vec<u8>) -> sqlite::Result<bool> {
        let sc = &mut self.scratch;
        sc.text.clear();
        sc.rows.clear();
        let s = &mut self.feed_rows;
        s.bind_i64(1, lo);
        s.bind_i64(2, hi);
        let r = loop {
            match s.step() {
                Ok(true) => {
                    let mut put = |b: &[u8]| {
                        let o = sc.text.len() as u32;
                        sc.text.extend_from_slice(b);
                        (o, b.len() as u32)
                    };
                    let id = s.int(0);
                    let body = put(s.text(1));
                    let created_at = put(s.text(2));
                    let author = put(s.text(3));
                    sc.rows.push(Row { id, body, created_at, author });
                }
                Ok(false) => break Ok(()),
                Err(e) => break Err(e),
            }
        };
        s.reset();
        r?;

        let mut counts = [0i64; RANGE_SPAN as usize];
        let s = &mut self.feed_likes;
        s.bind_i64(1, lo);
        s.bind_i64(2, hi);
        let r = loop {
            match s.step() {
                Ok(true) => counts[(s.int(0) - lo) as usize] += 1,
                Ok(false) => break Ok(()),
                Err(e) => break Err(e),
            }
        };
        s.reset();
        r?;

        // Index rows by id offset so emission in feed order is O(n).
        let mut at = [u8::MAX; RANGE_SPAN as usize];
        for (i, row) in sc.rows.iter().enumerate() {
            at[(row.id - lo) as usize] = i as u8;
        }
        out.extend_from_slice(b"{\"posts\":[");
        for (k, &id) in ids.iter().enumerate() {
            let i = at[(id - lo) as usize];
            if i == u8::MAX {
                return Ok(false);
            }
            let row = sc.rows[i as usize];
            if k > 0 {
                out.push(b',');
            }
            let t = |(o, l): (u32, u32)| &sc.text[o as usize..(o + l) as usize];
            write_post(out, id, t(row.body), t(row.created_at), t(row.author), counts[(id - lo) as usize]);
        }
        out.extend_from_slice(b"]}");
        Ok(true)
    }

    fn feed_exact(&mut self, out: &mut Vec<u8>) -> sqlite::Result<()> {
        let s = &mut self.feed_exact;
        out.extend_from_slice(b"{\"posts\":[");
        let mut first = true;
        let r = loop {
            match s.step() {
                Ok(true) => {
                    if !first {
                        out.push(b',');
                    }
                    first = false;
                    write_post(out, s.int(0), s.text(1), s.text(2), s.text(3), s.int(4));
                }
                Ok(false) => break Ok(()),
                Err(e) => break Err(e),
            }
        };
        s.reset();
        out.extend_from_slice(b"]}");
        r
    }
}

pub fn write_post(out: &mut Vec<u8>, id: i64, body: &[u8], created_at: &[u8], author: &[u8], likes: i64) {
    out.extend_from_slice(b"{\"id\":");
    write_int(out, id);
    out.extend_from_slice(b",\"body\":");
    write_str(out, body);
    out.extend_from_slice(b",\"created_at\":");
    write_str(out, created_at);
    out.extend_from_slice(b",\"author\":");
    write_str(out, author);
    out.extend_from_slice(b",\"like_count\":");
    write_int(out, likes);
    out.push(b'}');
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Needs a seed copy: TWELVE_SEED=/path/to/copy/of/feed.db cargo test -- --ignored
    #[test]
    #[ignore]
    fn statements_are_not_reprepared() {
        let path = std::env::var("TWELVE_SEED").expect("TWELVE_SEED");
        let mut r = Reader::open(&path).unwrap();
        let mut out = Vec::new();
        for i in 0..200 {
            out.clear();
            assert!(r.post(1 + i, &mut out).unwrap());
            out.clear();
            r.feed(&mut out).unwrap();
            r.end_batch();
        }
        for (name, s) in [
            ("begin", &r.begin),
            ("commit", &r.commit),
            ("post", &r.post),
            ("feed_ids", &r.feed_ids),
            ("feed_rows", &r.feed_rows),
            ("feed_likes", &r.feed_likes),
        ] {
            eprintln!("{name}: {} reprepares", s.reprepares());
        }
        assert_eq!(r.post.reprepares() + r.feed_ids.reprepares(), 0);
    }

    /// In-process comparison of feed strategies (SQL cost only, no network):
    /// TWELVE_SEED=... cargo test --release feed_variants -- --ignored --nocapture
    #[test]
    #[ignore]
    fn feed_variants() {
        let path = std::env::var("TWELVE_SEED").expect("TWELVE_SEED");
        let mut r = Reader::open(&path).unwrap();
        let mut group = r.db.prepare("SELECT post_id, count(*) FROM likes WHERE post_id BETWEEN ?1 AND ?2 GROUP BY post_id").unwrap();
        let mut point = r.db.prepare("SELECT count(*) FROM likes WHERE post_id = ?1").unwrap();
        let mut ordered =
            r.db.prepare(
                "SELECT p.id, p.body, p.created_at, u.username FROM posts p JOIN users u ON u.id = p.user_id \
             ORDER BY p.created_at DESC, p.id DESC LIMIT 20",
            )
            .unwrap();
        let n = 20_000;
        let mut out = Vec::with_capacity(8192);
        let mut want = Vec::new();
        r.feed_exact(&mut want).unwrap();
        r.end_batch();
        let mut time = |name: &str, f: &mut dyn FnMut(&mut Reader, &mut Vec<u8>)| {
            let t = std::time::Instant::now();
            for _ in 0..n {
                out.clear();
                f(&mut r, &mut out);
                r.end_batch();
            }
            let us = t.elapsed().as_secs_f64() * 1e6 / n as f64;
            eprintln!("{name:<36} {us:6.2} us/feed");
        };
        time("exact (20 correlated counts)", &mut |r, o| {
            r.txn().unwrap();
            r.feed_exact(o).unwrap()
        });
        time("range + likes scan counted in Rust", &mut |r, o| r.feed(o).unwrap());
        time("ids only (F1)", &mut |r, _| {
            r.txn().unwrap();
            while r.feed_ids.step().unwrap() {}
            r.feed_ids.reset();
        });
        let (lo, hi) = (499_981, 500_000);
        time("likes: range scan counted in Rust", &mut |r, _| {
            r.txn().unwrap();
            let s = &mut r.feed_likes;
            s.bind_i64(1, lo);
            s.bind_i64(2, hi);
            let mut c = 0;
            while s.step().unwrap() {
                c += s.int(0);
            }
            s.reset();
            std::hint::black_box(c);
        });
        time("likes: GROUP BY post_id", &mut |r, _| {
            r.txn().unwrap();
            group.bind_i64(1, lo);
            group.bind_i64(2, hi);
            let mut c = 0;
            while group.step().unwrap() {
                c += group.int(1);
            }
            group.reset();
            std::hint::black_box(c);
        });
        time("likes: 20 point count(*)", &mut |r, _| {
            r.txn().unwrap();
            let mut c = 0;
            for id in lo..=hi {
                point.bind_i64(1, id);
                point.step().unwrap();
                c += point.int(0);
                point.reset();
            }
            std::hint::black_box(c);
        });
        time("rows: range scan + user join", &mut |r, _| {
            r.txn().unwrap();
            let s = &mut r.feed_rows;
            s.bind_i64(1, lo);
            s.bind_i64(2, hi);
            let mut c = 0;
            while s.step().unwrap() {
                c += s.text(1).len();
            }
            s.reset();
            std::hint::black_box(c);
        });
        time("rows: index walk + join (no F1)", &mut |r, _| {
            r.txn().unwrap();
            let mut c = 0;
            while ordered.step().unwrap() {
                c += ordered.text(1).len();
            }
            ordered.reset();
            std::hint::black_box(c);
        });
        out.clear();
        r.feed(&mut out).unwrap();
        assert_eq!(out, want, "range path must equal the exact query");
    }
}
