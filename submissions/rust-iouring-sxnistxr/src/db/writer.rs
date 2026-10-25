//! The writer thread: owns the only connection that writes.
//!
//! Group commit: it drains every pending job into one `BEGIN IMMEDIATE` transaction, commits
//! (with `synchronous=FULL` this fsyncs the WAL), and only then hands the results back. The
//! network thread sends no write reply before that, so a 201 always means the row is durable.
//!
//! Each job is one write statement, which SQLite already makes atomic: a failed statement (e.g. a
//! CHECK violation) is rolled back by itself and the transaction carries on. Only an error that
//! aborts the whole transaction (I/O error, disk full, out of memory) needs care: the job that
//! hit it gets a 500, and the batch is replayed without it in a fresh transaction.

use crate::spsc;
use crate::sqlite::{self, CONSTRAINT_CHECK, Checkpoint, Db, Stmt};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering, fence};

/// Upper bound on jobs per transaction, so one commit can't delay a reply indefinitely.
const MAX_BATCH: usize = 1024;
/// Checkpoint (copy WAL frames into the database) once the WAL holds this many frames.
const CHECKPOINT_FRAMES: i32 = 4096;
/// If PASSIVE checkpoints can't keep up, force a RESTART past this size.
const FORCE_RESTART_FRAMES: i32 = 32768;
/// How many times a batch may be replayed after transaction-aborting errors.
const MAX_REPLAYS: usize = 3;

pub enum Kind {
    Like { user: i64, post: i64 },
    Create { user: i64, body: Vec<u8>, username: Vec<u8> },
}

pub struct Job {
    /// Opaque connection reference, returned untouched in the reply.
    pub conn: u64,
    pub kind: Kind,
}

pub enum Outcome {
    Liked { post: i64, already: bool },
    NoPost,
    Created { id: i64, created_at: [u8; 32], created_len: u8 },
    /// The schema rejected the body (its CHECK counts characters up to the first NUL).
    BadBody,
    Failed,
}

/// The job comes back with its outcome, so the reply can echo the body and username without the
/// writer moving them out (a replayed batch must still have them).
pub struct Reply {
    pub conn: u64,
    pub kind: Kind,
    pub outcome: Outcome,
}

/// Shared between the network thread and the writer.
pub struct Signal {
    pub sleeping: AtomicBool,
    pub stop: AtomicBool,
    pub thread: std::thread::Thread,
}

impl Signal {
    /// Called by the producer after pushing jobs.
    pub fn wake(&self) {
        fence(Ordering::SeqCst);
        if self.sleeping.load(Ordering::SeqCst) {
            self.thread.unpark();
        }
    }
}

struct Writer {
    begin: Stmt,
    commit: Stmt,
    rollback: Stmt,
    like: Stmt,
    exists: Stmt,
    create: Stmt,
    db: Db,
}

impl Writer {
    fn open(path: &str) -> sqlite::Result<Writer> {
        let mut db = Db::open(path)?;
        db.busy_timeout(5000);
        db.exec(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=0; \
             PRAGMA journal_size_limit=67108864; PRAGMA mmap_size=1073741824; PRAGMA cache_size=-8192; \
             PRAGMA temp_store=MEMORY;",
        )?;
        db.track_wal();
        Ok(Writer {
            begin: db.prepare("BEGIN IMMEDIATE")?,
            commit: db.prepare("COMMIT")?,
            rollback: db.prepare("ROLLBACK")?,
            // Inserts only if the post exists; changes()==0 then means "already liked" or "no post".
            like: db.prepare(
                "INSERT INTO likes(user_id, post_id) SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM posts WHERE id = ?2) \
                 ON CONFLICT(user_id, post_id) DO NOTHING",
            )?,
            exists: db.prepare("SELECT 1 FROM posts WHERE id = ?1")?,
            create: db.prepare("INSERT INTO posts(user_id, body) VALUES (?1, ?2) RETURNING id, created_at")?,
            db,
        })
    }

    fn exec(&mut self, kind: &Kind) -> sqlite::Result<Outcome> {
        match kind {
            Kind::Like { user, post } => {
                self.like.bind_i64(1, *user);
                self.like.bind_i64(2, *post);
                self.like.run()?;
                if self.db.changes() == 1 {
                    return Ok(Outcome::Liked { post: *post, already: false });
                }
                self.exists.bind_i64(1, *post);
                let found = self.exists.step();
                self.exists.reset();
                Ok(if found? { Outcome::Liked { post: *post, already: true } } else { Outcome::NoPost })
            }
            Kind::Create { user, body, .. } => {
                let s = &mut self.create;
                s.bind_i64(1, *user);
                s.bind_text(2, body);
                let row = match s.step() {
                    Ok(true) => {
                        let mut created_at = [0u8; 32];
                        let c = s.text(1);
                        let n = c.len().min(32);
                        created_at[..n].copy_from_slice(&c[..n]);
                        Ok(Some((s.int(0), created_at, n as u8)))
                    }
                    Ok(false) => Ok(None),
                    Err(e) => Err(e),
                };
                // Finish the statement so the insert is complete before COMMIT.
                let rest = row.and_then(|r| s.step().map(|_| r));
                s.reset();
                match rest {
                    Ok(Some((id, created_at, created_len))) => Ok(Outcome::Created { id, created_at, created_len }),
                    Ok(None) => Ok(Outcome::Failed),
                    Err(e) if e.code == CONSTRAINT_CHECK => Ok(Outcome::BadBody),
                    Err(e) => Err(e),
                }
            }
        }
    }

    /// Runs one batch to a committed state. Returns one outcome per job.
    fn batch(&mut self, jobs: &[Job]) -> Vec<Outcome> {
        let mut poisoned = vec![false; jobs.len()];
        for _ in 0..=MAX_REPLAYS {
            if let Err(e) = self.begin.run() {
                eprintln!("writer: BEGIN failed: {e}");
                break;
            }
            let mut out = Vec::with_capacity(jobs.len());
            let mut aborted = false;
            for (i, job) in jobs.iter().enumerate() {
                if poisoned[i] {
                    out.push(Outcome::Failed);
                    continue;
                }
                let o = self.exec(&job.kind).unwrap_or_else(|e| {
                    eprintln!("writer: statement failed: {e}");
                    Outcome::Failed
                });
                if self.db.autocommit() {
                    // SQLite rolled the whole transaction back. Drop this job and replay the rest.
                    poisoned[i] = true;
                    aborted = true;
                    break;
                }
                out.push(o);
            }
            if aborted {
                continue;
            }
            match self.commit.run() {
                Ok(()) => return out,
                Err(e) => {
                    eprintln!("writer: COMMIT failed: {e}");
                    let _ = self.rollback.run();
                    break;
                }
            }
        }
        if !self.db.autocommit() {
            let _ = self.rollback.run();
        }
        jobs.iter().map(|_| Outcome::Failed).collect()
    }

    fn maybe_checkpoint(&mut self) {
        let frames = self.db.wal_frames();
        if frames >= FORCE_RESTART_FRAMES {
            self.db.busy_timeout(50);
            if let Err(e) = self.db.checkpoint(Checkpoint::Restart) {
                eprintln!("writer: RESTART checkpoint: {e}");
            }
            self.db.busy_timeout(5000);
        } else if frames >= CHECKPOINT_FRAMES {
            match self.db.checkpoint(Checkpoint::Passive) {
                // Everything copied: the next commit restarts the WAL from the beginning.
                Ok((log, done)) if log == done => {}
                Ok(_) => {}
                Err(e) => eprintln!("writer: checkpoint: {e}"),
            }
        }
    }
}

pub struct Handle {
    pub signal: Arc<Signal>,
    pub jobs: spsc::Producer<Job>,
    pub replies: spsc::Consumer<Reply>,
}

/// Opens the writer connection and starts the thread. `notify` is called after each batch's
/// replies are queued (it writes the eventfd the network thread watches).
pub fn spawn(path: &str, capacity: usize, notify: impl Fn() + Send + 'static) -> sqlite::Result<(Handle, std::thread::JoinHandle<()>)> {
    let mut w = Writer::open(path)?;
    let (jobs, mut job_rx) = spsc::channel::<Job>(capacity);
    let (mut reply_tx, replies) = spsc::channel::<Reply>(capacity);
    let (tx, rx) = std::sync::mpsc::channel();
    let join = std::thread::Builder::new()
        .name("writer".into())
        .spawn(move || {
            let signal: Arc<Signal> = rx.recv().unwrap();
            let mut batch = Vec::with_capacity(MAX_BATCH);
            loop {
                while batch.len() < MAX_BATCH {
                    match job_rx.pop() {
                        Some(j) => batch.push(j),
                        None => break,
                    }
                }
                if batch.is_empty() {
                    if signal.stop.load(Ordering::SeqCst) {
                        break;
                    }
                    signal.sleeping.store(true, Ordering::SeqCst);
                    fence(Ordering::SeqCst);
                    if job_rx.is_empty() && !signal.stop.load(Ordering::SeqCst) {
                        std::thread::park();
                    }
                    signal.sleeping.store(false, Ordering::SeqCst);
                    continue;
                }
                let outcomes = w.batch(&batch);
                for (job, outcome) in batch.drain(..).zip(outcomes) {
                    let mut r = Reply { conn: job.conn, kind: job.kind, outcome };
                    // The network thread caps jobs in flight at the queue capacity, so this
                    // only spins if that invariant is broken.
                    while let Err(back) = reply_tx.push(r) {
                        r = back;
                        std::thread::yield_now();
                    }
                }
                notify();
                w.maybe_checkpoint();
            }
            // Clean shutdown: fold the WAL back into the database file.
            if let Err(e) = w.db.checkpoint(Checkpoint::Truncate) {
                eprintln!("writer: final checkpoint: {e}");
            }
        })
        .expect("spawn writer");
    let signal = Arc::new(Signal { sleeping: AtomicBool::new(false), stop: AtomicBool::new(false), thread: join.thread().clone() });
    tx.send(signal.clone()).unwrap();
    Ok((Handle { signal, jobs, replies }, join))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCHEMA: &str = include_str!("../../tests/schema.sql");

    fn fresh(extra: &str) -> (String, Writer) {
        let dir = std::env::temp_dir().join(format!("twelve-writer-{}-{}", std::process::id(), extra.len()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.db").to_string_lossy().into_owned();
        let db = Db::create(&path).unwrap();
        db.exec("PRAGMA journal_mode=WAL").unwrap();
        db.exec(SCHEMA).unwrap();
        db.exec("INSERT INTO users(id, username) VALUES (1, 'ann'); INSERT INTO posts(id, user_id, body) VALUES (1, 1, 'p1');").unwrap();
        db.exec(extra).unwrap();
        drop(db);
        let w = Writer::open(&path).unwrap();
        (path, w)
    }

    fn create(body: &[u8]) -> Job {
        Job { conn: 0, kind: Kind::Create { user: 1, body: body.to_vec(), username: b"ann".to_vec() } }
    }

    fn count(path: &str, sql: &str) -> i64 {
        let db = Db::open(path).unwrap();
        let mut s = db.prepare(sql).unwrap();
        assert!(s.step().unwrap());
        let n = s.int(0);
        s.reset();
        n
    }

    #[test]
    fn likes_and_creates() {
        let (path, mut w) = fresh("");
        let jobs = [
            Job { conn: 0, kind: Kind::Like { user: 1, post: 1 } },
            Job { conn: 0, kind: Kind::Like { user: 1, post: 1 } },
            Job { conn: 0, kind: Kind::Like { user: 1, post: 99 } },
            create(b"hello"),
        ];
        let out = w.batch(&jobs);
        assert!(matches!(out[0], Outcome::Liked { post: 1, already: false }));
        assert!(matches!(out[1], Outcome::Liked { post: 1, already: true }));
        assert!(matches!(out[2], Outcome::NoPost));
        assert!(matches!(out[3], Outcome::Created { id: 2, created_len: 24, .. }));
        assert_eq!(count(&path, "SELECT count(*) FROM likes"), 1);
        assert_eq!(count(&path, "SELECT count(*) FROM posts WHERE body = 'hello'"), 1);
    }

    #[test]
    fn check_violation_fails_only_its_job() {
        let (path, mut w) = fresh(" ");
        // SQLite's length() stops at the first NUL, so this body fails the schema's CHECK.
        let out = w.batch(&[create(b"ok1"), create(b"\0x"), create(b"ok2")]);
        assert!(matches!(out[0], Outcome::Created { .. }));
        assert!(matches!(out[1], Outcome::BadBody));
        assert!(matches!(out[2], Outcome::Created { .. }));
        assert_eq!(count(&path, "SELECT count(*) FROM posts WHERE body IN ('ok1','ok2')"), 2);
    }

    #[test]
    fn transaction_abort_replays_batch_without_the_poisoned_job() {
        // A test-only trigger (never on the real schema) that aborts the whole transaction.
        let (path, mut w) = fresh(
            "CREATE TRIGGER boom BEFORE INSERT ON posts WHEN NEW.body = 'abort' BEGIN SELECT RAISE(ROLLBACK, 'boom'); END;",
        );
        let out = w.batch(&[create(b"a1"), create(b"abort"), create(b"a2")]);
        assert!(matches!(out[0], Outcome::Created { .. }));
        assert!(matches!(out[1], Outcome::Failed));
        assert!(matches!(out[2], Outcome::Created { .. }));
        assert_eq!(count(&path, "SELECT count(*) FROM posts WHERE body IN ('a1','a2')"), 2);
        assert_eq!(count(&path, "SELECT count(*) FROM posts WHERE body = 'abort'"), 0);
        // The connection is usable afterwards.
        assert!(matches!(w.batch(&[create(b"after")])[0], Outcome::Created { .. }));
    }
}
