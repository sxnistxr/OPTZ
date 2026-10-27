//! Minimal FFI to the vendored SQLite amalgamation, plus thin safe wrappers.
//!
//! All `unsafe` for SQLite lives here. A `Db` and its `Stmt`s are used by exactly one thread
//! (the build sets SQLITE_THREADSAFE=2), which `Db: !Sync` and the borrow on `Stmt` enforce.

use std::ffi::{CStr, CString, c_char, c_int, c_void};
use std::ptr;

#[repr(C)]
pub struct RawDb {
    _p: [u8; 0],
}
#[repr(C)]
pub struct RawStmt {
    _p: [u8; 0],
}

pub const OK: c_int = 0;
pub const ROW: c_int = 100;
pub const DONE: c_int = 101;
pub const CONSTRAINT: c_int = 19;
pub const CONSTRAINT_CHECK: c_int = CONSTRAINT | (1 << 8);

const OPEN_READWRITE: c_int = 0x02;
const OPEN_NOMUTEX: c_int = 0x8000;
const OPEN_EXRESCODE: c_int = 0x0200_0000;
const PREPARE_PERSISTENT: u32 = 0x01;
const CHECKPOINT_PASSIVE: c_int = 0;
const CHECKPOINT_RESTART: c_int = 2;
const CHECKPOINT_TRUNCATE: c_int = 3;
/// SQLITE_STATIC: SQLite does not copy or free bound text; we keep it alive until reset.
const STATIC: *const c_void = ptr::null();

type WalHook = unsafe extern "C" fn(*mut c_void, *mut RawDb, *const c_char, c_int) -> c_int;

unsafe extern "C" {
    fn sqlite3_initialize() -> c_int;
    fn sqlite3_open_v2(f: *const c_char, db: *mut *mut RawDb, flags: c_int, vfs: *const c_char) -> c_int;
    fn sqlite3_close_v2(db: *mut RawDb) -> c_int;
    fn sqlite3_exec(db: *mut RawDb, sql: *const c_char, cb: *const c_void, arg: *mut c_void, err: *mut *mut c_char) -> c_int;
    fn sqlite3_prepare_v3(
        db: *mut RawDb,
        sql: *const c_char,
        n: c_int,
        flags: u32,
        stmt: *mut *mut RawStmt,
        tail: *mut *const c_char,
    ) -> c_int;
    fn sqlite3_finalize(s: *mut RawStmt) -> c_int;
    fn sqlite3_step(s: *mut RawStmt) -> c_int;
    fn sqlite3_reset(s: *mut RawStmt) -> c_int;
    fn sqlite3_clear_bindings(s: *mut RawStmt) -> c_int;
    fn sqlite3_bind_int64(s: *mut RawStmt, i: c_int, v: i64) -> c_int;
    fn sqlite3_bind_text(s: *mut RawStmt, i: c_int, p: *const c_char, n: c_int, d: *const c_void) -> c_int;
    fn sqlite3_column_int64(s: *mut RawStmt, i: c_int) -> i64;
    fn sqlite3_column_text(s: *mut RawStmt, i: c_int) -> *const u8;
    fn sqlite3_column_bytes(s: *mut RawStmt, i: c_int) -> c_int;
    fn sqlite3_changes(db: *mut RawDb) -> c_int;
    #[cfg(test)]
    fn sqlite3_stmt_status(s: *mut RawStmt, op: c_int, reset: c_int) -> c_int;
    fn sqlite3_get_autocommit(db: *mut RawDb) -> c_int;
    fn sqlite3_errmsg(db: *mut RawDb) -> *const c_char;
    fn sqlite3_extended_errcode(db: *mut RawDb) -> c_int;
    fn sqlite3_busy_timeout(db: *mut RawDb, ms: c_int) -> c_int;
    fn sqlite3_wal_hook(db: *mut RawDb, cb: Option<WalHook>, arg: *mut c_void) -> *mut c_void;
    fn sqlite3_wal_checkpoint_v2(db: *mut RawDb, name: *const c_char, mode: c_int, log: *mut c_int, ckpt: *mut c_int) -> c_int;
}

/// An SQLite error: extended result code plus the connection's message at the time.
#[derive(Debug, Clone)]
pub struct Error {
    pub code: c_int,
    pub msg: String,
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} (code {})", self.msg, self.code)
    }
}

pub type Result<T> = std::result::Result<T, Error>;

pub struct Db {
    raw: *mut RawDb,
    /// WAL frame count reported by the wal hook after the last commit (writer only).
    wal_frames: Box<c_int>,
}

// A connection may move to the thread that owns it, but is never shared.
unsafe impl Send for Db {}

impl Db {
    /// Opens an existing database. Never creates one: a wrong SQLITE_PATH must fail loudly,
    /// not serve an empty database.
    pub fn open(path: &str) -> Result<Db> {
        Self::open_flags(path, OPEN_READWRITE | OPEN_NOMUTEX | OPEN_EXRESCODE)
    }

    #[cfg(test)]
    pub fn create(path: &str) -> Result<Db> {
        Self::open_flags(path, OPEN_READWRITE | OPEN_NOMUTEX | OPEN_EXRESCODE | 0x04)
    }

    fn open_flags(path: &str, flags: c_int) -> Result<Db> {
        let c = CString::new(path).map_err(|_| Error { code: 1, msg: "path contains NUL".into() })?;
        let mut raw = ptr::null_mut();
        unsafe {
            sqlite3_initialize();
            let rc = sqlite3_open_v2(c.as_ptr(), &mut raw, flags, ptr::null());
            let db = Db { raw, wal_frames: Box::new(0) };
            if rc != OK {
                return Err(db.error(rc));
            }
            Ok(db)
        }
    }

    fn error(&self, rc: c_int) -> Error {
        let msg = if self.raw.is_null() {
            "out of memory".to_string()
        } else {
            unsafe { CStr::from_ptr(sqlite3_errmsg(self.raw)) }.to_string_lossy().into_owned()
        };
        let code = if self.raw.is_null() { rc } else { unsafe { sqlite3_extended_errcode(self.raw) } };
        Error { code: if code == 0 { rc } else { code }, msg }
    }

    pub fn exec(&self, sql: &str) -> Result<()> {
        let c = CString::new(sql).expect("static SQL");
        let rc = unsafe { sqlite3_exec(self.raw, c.as_ptr(), ptr::null(), ptr::null_mut(), ptr::null_mut()) };
        if rc != OK { Err(self.error(rc)) } else { Ok(()) }
    }

    pub fn prepare(&self, sql: &str) -> Result<Stmt> {
        let mut raw = ptr::null_mut();
        let rc =
            unsafe { sqlite3_prepare_v3(self.raw, sql.as_ptr().cast(), sql.len() as c_int, PREPARE_PERSISTENT, &mut raw, ptr::null_mut()) };
        if rc != OK || raw.is_null() {
            return Err(self.error(rc));
        }
        Ok(Stmt { raw, db: self.raw })
    }

    pub fn changes(&self) -> i32 {
        unsafe { sqlite3_changes(self.raw) }
    }

    /// True when no transaction is open (used to detect a transaction SQLite aborted on error).
    pub fn autocommit(&self) -> bool {
        unsafe { sqlite3_get_autocommit(self.raw) != 0 }
    }

    pub fn busy_timeout(&self, ms: i32) {
        unsafe { sqlite3_busy_timeout(self.raw, ms) };
    }

    /// Track the WAL size after each commit, so the writer can decide when to checkpoint
    /// without querying anything.
    pub fn track_wal(&mut self) {
        unsafe extern "C" fn hook(arg: *mut c_void, _: *mut RawDb, _: *const c_char, frames: c_int) -> c_int {
            unsafe { *(arg as *mut c_int) = frames };
            OK
        }
        let p: *mut c_int = &mut *self.wal_frames;
        unsafe { sqlite3_wal_hook(self.raw, Some(hook), p.cast()) };
    }

    pub fn wal_frames(&self) -> i32 {
        *self.wal_frames
    }

    /// Returns (frames in WAL, frames checkpointed).
    pub fn checkpoint(&mut self, mode: Checkpoint) -> Result<(i32, i32)> {
        let m = match mode {
            Checkpoint::Passive => CHECKPOINT_PASSIVE,
            Checkpoint::Restart => CHECKPOINT_RESTART,
            Checkpoint::Truncate => CHECKPOINT_TRUNCATE,
        };
        let (mut log, mut ck) = (0, 0);
        let rc = unsafe { sqlite3_wal_checkpoint_v2(self.raw, ptr::null(), m, &mut log, &mut ck) };
        if rc != OK {
            return Err(self.error(rc));
        }
        if matches!(mode, Checkpoint::Restart | Checkpoint::Truncate) {
            *self.wal_frames = 0;
        }
        Ok((log, ck))
    }
}

impl Drop for Db {
    fn drop(&mut self) {
        unsafe { sqlite3_close_v2(self.raw) };
    }
}

#[derive(Clone, Copy)]
pub enum Checkpoint {
    Passive,
    Restart,
    Truncate,
}

/// A prepared statement. Always reset after use, so a finished read statement never holds a
/// read snapshot open.
///
/// A `Stmt` must be dropped before the `Db` it came from. The structs that own both
/// (`db::read::Reader`, `db::writer::Writer`) declare their statements before the connection,
/// and Rust drops fields in declaration order.
pub struct Stmt {
    raw: *mut RawStmt,
    db: *mut RawDb,
}

unsafe impl Send for Stmt {}

impl Stmt {
    fn error(&self, rc: c_int) -> Error {
        let msg = unsafe { CStr::from_ptr(sqlite3_errmsg(self.db)) }.to_string_lossy().into_owned();
        let code = unsafe { sqlite3_extended_errcode(self.db) };
        Error { code: if code == 0 { rc } else { code }, msg }
    }

    pub fn bind_i64(&mut self, i: i32, v: i64) {
        unsafe { sqlite3_bind_int64(self.raw, i, v) };
    }

    /// Binds text without copying. The caller must keep `v` alive until `reset`; every user in
    /// this crate binds, steps and resets within one function call.
    pub fn bind_text(&mut self, i: i32, v: &[u8]) {
        unsafe { sqlite3_bind_text(self.raw, i, v.as_ptr().cast(), v.len() as c_int, STATIC) };
    }

    /// Steps once. Ok(true) = a row is available, Ok(false) = done.
    pub fn step(&mut self) -> Result<bool> {
        match unsafe { sqlite3_step(self.raw) } {
            ROW => Ok(true),
            DONE => Ok(false),
            rc => Err(self.error(rc)),
        }
    }

    pub fn reset(&mut self) {
        unsafe {
            sqlite3_reset(self.raw);
            sqlite3_clear_bindings(self.raw);
        }
    }

    /// How many times SQLite has re-prepared this statement (SQLITE_STMTSTATUS_REPREPARE).
    #[cfg(test)]
    pub fn reprepares(&self) -> i32 {
        unsafe { sqlite3_stmt_status(self.raw, 5, 0) }
    }

    pub fn int(&self, i: i32) -> i64 {
        unsafe { sqlite3_column_int64(self.raw, i) }
    }

    /// Column text, borrowed until the next step/reset (the borrow of `self` enforces it).
    pub fn text(&self, i: i32) -> &[u8] {
        unsafe {
            let p = sqlite3_column_text(self.raw, i);
            if p.is_null() {
                return &[];
            }
            let n = sqlite3_column_bytes(self.raw, i);
            std::slice::from_raw_parts(p, n as usize)
        }
    }

    /// Runs a statement that returns no rows of interest, then resets it.
    pub fn run(&mut self) -> Result<()> {
        let r = loop {
            match self.step() {
                Ok(true) => continue,
                Ok(false) => break Ok(()),
                Err(e) => break Err(e),
            }
        };
        self.reset();
        r
    }
}

impl Drop for Stmt {
    fn drop(&mut self) {
        unsafe { sqlite3_finalize(self.raw) };
    }
}
