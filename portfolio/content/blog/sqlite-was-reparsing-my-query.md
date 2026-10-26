---
title: SQLite was re-parsing my query on every request
date: 2026-10-25
summary: A prepared statement that wasn't staying prepared, and the compile flag that fixed it.
---

The single-post endpoint was slower than it had any right to be: 18 µs per request for one
primary-key lookup and a count. A profile showed the surprise right at the top. `yy_reduce` and
`sqlite3RunParser` were running on every request. That's the SQL parser, and a prepared
statement should never need it again.

`sqlite3_stmt_status(stmt, SQLITE_STMTSTATUS_REPREPARE, 0)` confirmed it: 200 re-prepares in 200
calls.

## Why

When SQLite plans a query, it can notice that the best plan might depend on the value bound to a
parameter. If so, it marks the statement so that binding a *different* value expires it, and the
next step re-prepares it from the SQL text. Each request bound a different post id, so each
request paid for a full parse and plan.

## The fix

Compile SQLite with `SQLITE_ENABLE_QPSG`, the query planner stability guarantee. Plans are fixed
when the statement is prepared and never depend on bound values. For simple index lookups that's
exactly what you want anyway.

Single-post reads went from 47,800 to about 108,000 requests per second on one core. A test now
asserts zero re-prepares, so it can't quietly come back.
