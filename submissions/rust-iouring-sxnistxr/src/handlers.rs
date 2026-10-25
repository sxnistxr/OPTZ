//! Routing and request handling. Reads are answered here; writes become jobs for the writer.

use crate::db::read::{Reader, write_post};
use crate::db::writer::{Kind, Outcome, Reply};
use crate::http::{Method, Request};
use crate::json::{self, Val, write_int, write_str};
use crate::jwt::{JwtError, Verifier, parse_positive};

pub const MAX_BODY_CHARS: usize = 500;

pub struct Ctx {
    pub reader: Reader,
    pub jwt: Verifier,
    pub started: std::time::Instant,
}

pub enum Action {
    /// The body is in `out`; send it with this status.
    Respond(u16),
    /// Queue this write; the response is formatted when the writer replies.
    Write(Kind),
}

fn error(out: &mut Vec<u8>, status: u16, msg: &str) -> Action {
    out.extend_from_slice(b"{\"error\":\"");
    out.extend_from_slice(msg.as_bytes());
    out.extend_from_slice(b"\"}");
    Action::Respond(status)
}

pub fn internal_error(out: &mut Vec<u8>) -> u16 {
    error(out, 500, "internal server error");
    500
}

enum Route<'a> {
    Health,
    Feed,
    Post(&'a [u8]),
    Create,
    Like(&'a [u8]),
    NotFound,
}

fn route<'a>(method: Method, path: &'a [u8]) -> Route<'a> {
    match (method, path) {
        (Method::Get, b"/health") => Route::Health,
        (Method::Get, b"/feed") => Route::Feed,
        (Method::Post, b"/posts") => Route::Create,
        _ => match path.strip_prefix(b"/posts/") {
            Some(rest) => match (method, rest.strip_suffix(b"/like")) {
                (Method::Post, Some(id)) if !id.contains(&b'/') => Route::Like(id),
                (Method::Get, None) if !rest.contains(&b'/') => Route::Post(rest),
                _ => Route::NotFound,
            },
            None => Route::NotFound,
        },
    }
}

pub fn handle(ctx: &mut Ctx, req: &Request<'_>, out: &mut Vec<u8>, now: i64) -> Action {
    let start = out.len();
    match route(req.method, req.path) {
        Route::Health => match ctx.reader.health() {
            Ok(()) => {
                out.extend_from_slice(b"{\"status\":\"ok\",\"db\":\"ok\",\"uptime_s\":");
                write_int(out, ctx.started.elapsed().as_secs() as i64);
                out.push(b'}');
                Action::Respond(200)
            }
            Err(e) => {
                out.extend_from_slice(b"{\"status\":\"degraded\",\"db\":\"unreachable\",\"error\":");
                write_str(out, e.msg.as_bytes());
                out.push(b'}');
                Action::Respond(503)
            }
        },
        Route::Feed => match ctx.reader.feed(out) {
            Ok(()) => Action::Respond(200),
            Err(e) => {
                eprintln!("feed: {e}");
                out.truncate(start);
                Action::Respond(internal_error(out))
            }
        },
        Route::Post(id) => {
            let Some(id) = parse_positive(id) else { return error(out, 400, "invalid post id") };
            match ctx.reader.post(id, out) {
                Ok(true) => Action::Respond(200),
                Ok(false) => error(out, 404, "post not found"),
                Err(e) => {
                    eprintln!("post: {e}");
                    Action::Respond(internal_error(out))
                }
            }
        }
        Route::Create => {
            let (user, username) = match auth(&mut ctx.jwt, req, now) {
                Ok(c) => c,
                Err(a) => return a(out),
            };
            let body = match json::parse_object(req.body, [b"body"]) {
                Err(_) => return error(out, 400, "malformed JSON body"),
                Ok(Some([Some(Val::Str(s))])) => s,
                Ok(_) => return error(out, 400, "body is required"),
            };
            let body = json::trim_js(&body);
            if body.is_empty() {
                return error(out, 400, "body is required");
            }
            if json::char_count(body) > MAX_BODY_CHARS {
                return error(out, 400, "body must be at most 500 characters");
            }
            Action::Write(Kind::Create { user, body: body.to_vec(), username })
        }
        Route::Like(id) => {
            let (user, _) = match auth(&mut ctx.jwt, req, now) {
                Ok(c) => c,
                Err(a) => return a(out),
            };
            let Some(post) = parse_positive(id) else { return error(out, 400, "invalid post id") };
            Action::Write(Kind::Like { user, post })
        }
        Route::NotFound => error(out, 404, "not found"),
    }
}

type Deny = fn(&mut Vec<u8>) -> Action;

fn auth(jwt: &mut Verifier, req: &Request<'_>, now: i64) -> Result<(i64, Vec<u8>), Deny> {
    let token = match req.authorization.and_then(|a| a.strip_prefix(b"Bearer ")) {
        Some(t) => t,
        None => return Err(|o| error(o, 401, "missing bearer token")),
    };
    match jwt.verify(token, now) {
        Ok(c) => Ok((c.user_id, c.username.into_owned())),
        Err(JwtError::Invalid) => Err(|o| error(o, 401, "invalid or expired token")),
        Err(JwtError::Payload) => Err(|o| error(o, 401, "invalid token payload")),
    }
}

/// Formats the response for a committed (or failed) write. Returns the status.
pub fn write_reply(reply: &Reply, out: &mut Vec<u8>) -> u16 {
    match (&reply.outcome, &reply.kind) {
        (Outcome::Liked { post, already }, _) => {
            out.extend_from_slice(b"{\"liked\":true,\"already_liked\":");
            out.extend_from_slice(if *already { b"true" } else { b"false" });
            out.extend_from_slice(b",\"post_id\":");
            write_int(out, *post);
            out.push(b'}');
            if *already { 200 } else { 201 }
        }
        (Outcome::NoPost, _) => {
            error(out, 404, "post not found");
            404
        }
        (Outcome::Created { id, created_at, created_len }, Kind::Create { body, username, .. }) => {
            out.extend_from_slice(b"{\"post\":");
            write_post(out, *id, body, &created_at[..*created_len as usize], username, 0);
            out.push(b'}');
            201
        }
        (Outcome::BadBody, _) => {
            error(out, 400, "body is required");
            400
        }
        _ => internal_error(out),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes() {
        assert!(matches!(route(Method::Get, b"/feed"), Route::Feed));
        assert!(matches!(route(Method::Get, b"/posts/12"), Route::Post(b"12")));
        assert!(matches!(route(Method::Post, b"/posts/abc/like"), Route::Like(b"abc")));
        assert!(matches!(route(Method::Get, b"/posts/1/like"), Route::NotFound));
        assert!(matches!(route(Method::Get, b"/posts/1/x"), Route::NotFound));
        assert!(matches!(route(Method::Post, b"/posts/1/2/like"), Route::NotFound));
        assert!(matches!(route(Method::Get, b"/nope"), Route::NotFound));
        assert!(matches!(route(Method::Get, b"/posts/"), Route::Post(b"")));
    }

    #[test]
    fn ids() {
        for bad in [&b"0"[..], b"-1", b"abc", b"1.5", b"", b"+1", b" 1", b"1e3", b"99999999999999999999"] {
            assert_eq!(parse_positive(bad), None, "{bad:?}");
        }
        assert_eq!(parse_positive(b"500000"), Some(500000));
        assert_eq!(parse_positive(b"007"), Some(7));
    }
}
