# The engine's contract

What the server reads, what it answers, and how. The code is the reference
(`src/handlers.rs`, `src/http.rs`, `src/jwt.rs`); this file is kept in step with it.

## Configuration

Four environment variables, all required. Nothing else is read.

| variable | meaning |
|---|---|
| `SQLITE_PATH` | the database file (the schema in `tests/schema.sql`; the server never changes it) |
| `JWT_SECRET` | the HS256 secret; empty is refused at startup, under 32 bytes logs a warning |
| `HOST`, `PORT` | where to listen |

Flags for tests and tuning: `--shard-slots=N` (fixed-file slots per ring), `--max-conns=N`
(the admission ceiling; default from memory, see below).

## HTTP

- HTTP/1.1 with keep-alive and pipelining (responses in request order); HTTP/1.0 closes unless
  `Connection: keep-alive`. `Connection: close` closes after the response.
- HTTP/1.1 requests need exactly one `Host`. At most one `Content-Length`; `Transfer-Encoding`
  is refused. Any of these, or an unparseable request: `400 bad request` and close.
- A request (line and headers) or body over 64 KiB: `413 request too large` and close.
- Every response is JSON (`Content-Type: application/json`) with `Content-Length`.
- Errors are `{"error": "<message>"}` with the messages below.

## Authentication

`Authorization: Bearer <JWT>`, HS256 only, signature checked before anything in it is read.

| claim | rule |
|---|---|
| `alg` (header) | `"HS256"` |
| `sub` | a positive integer as a string: the user id |
| `username` | a string: echoed as the author of new posts |
| `exp` | a NumericDate (seconds), finite, in the future and no later than 9999-12-31 |

| problem | status | error |
|---|---|---|
| no bearer token | 401 | `missing bearer token` |
| bad signature, algorithm, structure or `exp` | 401 | `invalid or expired token` |
| `sub` or `username` malformed | 401 | `invalid token payload` |
| valid token, but no such user in the database | 401 | `unknown user` (nothing is written) |

## Endpoints

A post is `{"id": int, "body": string, "created_at": "YYYY-MM-DDTHH:MM:SS.mmmZ", "author": string, "like_count": int}`.

### `GET /health`

`200 {"status":"ok","db":"ok","uptime_s":N}`, or `503 {"status":"degraded","db":"unreachable","error":"..."}`.

### `GET /feed`

`200 {"posts":[post, ...]}`: the 20 newest, `ORDER BY created_at DESC, id DESC`.

### `GET /posts/:id`

`200 {"post": post}`; `400 invalid post id` (not a positive integer); `404 post not found`.

### `POST /posts` (authenticated)

Body `{"body": "<text>"}`. The text is trimmed (JavaScript's `trim()`), then must be 1-500
characters with no NUL.

| outcome | status |
|---|---|
| created (durable: the WAL is fsynced first) | `201 {"post": post}` with `like_count` 0 |
| not a JSON object | `400 malformed JSON body` |
| missing, not a string, or empty after trimming | `400 body is required` |
| over 500 characters | `400 body must be at most 500 characters` |
| contains NUL | `400 body must not contain NUL characters` |
| the writer is far behind (over 16,384 queued writes or 32 MiB of bodies) | `503 server busy, retry shortly` |

### `POST /posts/:id/like` (authenticated)

| outcome | status |
|---|---|
| liked now | `201 {"liked":true,"already_liked":false,"post_id":id}` |
| already liked by this user | `200 {"liked":true,"already_liked":true,"post_id":id}` |
| id not a positive integer | `400 invalid post id` (checked after authentication) |
| no such post | `404 post not found` |
| writer far behind | `503 server busy, retry shortly` |

Anything else: `404 not found`.

## Limits and lifecycle

- Admission: a connection ceiling from memory (the smaller of the host's and the cgroup's
  limit, at ~4.8 KB per connection after a 320 MiB reserve), and no new connections while
  available memory (host or cgroup) is under 96 MiB, until it recovers past 128 MiB.
- Idle keep-alive connections stay open; a request or send stalled for 120 s is closed.
- `SIGTERM`/`SIGINT`: stop accepting, finish in-flight work (at most 5 s), checkpoint the WAL
  (`TRUNCATE`), exit 0.
