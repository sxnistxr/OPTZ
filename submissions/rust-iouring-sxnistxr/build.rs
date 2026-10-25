// Compiles the vendored SQLite amalgamation (downloaded and checksum-verified by build.sh).
fn main() {
    println!("cargo:rerun-if-changed=vendor/sqlite3.c");
    let mut b = cc::Build::new();
    b.file("vendor/sqlite3.c")
        .opt_level(3)
        .flag_if_supported("-march=native")
        .warnings(false);
    for (k, v) in [
        // Each connection is used by one thread at a time: no per-call mutexes.
        ("SQLITE_THREADSAFE", "2"),
        ("SQLITE_DEFAULT_MEMSTATUS", "0"),
        ("SQLITE_DEFAULT_WAL_SYNCHRONOUS", "2"),
        ("SQLITE_DQS", "0"),
        ("SQLITE_MAX_MMAP_SIZE", "2147483648"),
        ("SQLITE_TEMP_STORE", "3"),
        ("HAVE_FDATASYNC", "1"),
        ("HAVE_USLEEP", "1"),
    ] {
        b.define(k, v);
    }
    for k in [
        "SQLITE_OMIT_DEPRECATED",
        "SQLITE_OMIT_SHARED_CACHE",
        "SQLITE_OMIT_LOAD_EXTENSION",
        "SQLITE_OMIT_PROGRESS_CALLBACK",
        "SQLITE_LIKE_DOESNT_MATCH_BLOBS",
        "SQLITE_USE_ALLOCA",
        "SQLITE_OMIT_AUTOINIT",
        // Query planner stability: plans never depend on bound values. Without it SQLite marks
        // the single-post statement for re-planning whenever ?1 changes, i.e. on every request,
        // and re-parses its SQL each time (measured: 200 reprepares in 200 calls).
        "SQLITE_ENABLE_QPSG",
    ] {
        b.define(k, None);
    }
    // Optional SQLite PGO (build-time only): TWELVE_SQLITE_PGO=gen:<dir> instruments, then
    // TWELVE_SQLITE_PGO=use:<dir> rebuilds with the collected profile. build.sh drives it.
    println!("cargo:rerun-if-env-changed=TWELVE_SQLITE_PGO");
    match std::env::var("TWELVE_SQLITE_PGO").ok().as_deref().and_then(|v| v.split_once(':')) {
        Some(("gen", dir)) => {
            b.flag(format!("-fprofile-generate={dir}")).flag("-fprofile-update=atomic");
            println!("cargo:rustc-link-lib=gcov");
        }
        Some(("use", dir)) => {
            b.flag(format!("-fprofile-use={dir}")).flag("-fprofile-partial-training").flag("-Wno-missing-profile");
        }
        _ => {}
    }
    b.compile("sqlite3");
}
