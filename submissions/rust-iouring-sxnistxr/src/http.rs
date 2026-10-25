//! HTTP/1.1 request parsing (httparse for the request line and headers) and response framing.

pub const MAX_REQUEST: usize = 64 * 1024;
const MAX_HEADERS: usize = 24;

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Method {
    Get,
    Post,
    Other,
}

#[derive(Debug)]
pub struct Request<'a> {
    pub method: Method,
    pub path: &'a [u8],
    pub authorization: Option<&'a [u8]>,
    pub body: &'a [u8],
    /// The client asked to close (or speaks HTTP/1.0 without keep-alive).
    pub close: bool,
}

#[derive(Debug)]
pub enum Parse<'a> {
    /// Need more bytes.
    Partial,
    /// A complete request and the number of bytes it used (the rest may be a pipelined request).
    Done(Request<'a>, usize),
    /// Unparseable or unsupported; answer 400 (or 413) and close.
    Bad(u16),
}

pub fn parse(buf: &[u8]) -> Parse<'_> {
    let mut headers = [httparse::EMPTY_HEADER; MAX_HEADERS];
    let mut req = httparse::Request::new(&mut headers);
    let head_len = match req.parse(buf) {
        Ok(httparse::Status::Complete(n)) => n,
        Ok(httparse::Status::Partial) => {
            return if buf.len() >= MAX_REQUEST { Parse::Bad(413) } else { Parse::Partial };
        }
        Err(_) => return Parse::Bad(400),
    };
    let method = match req.method {
        Some("GET") => Method::Get,
        Some("POST") => Method::Post,
        _ => Method::Other,
    };
    let path = req.path.unwrap_or("/").as_bytes();
    let path = match memchr_q(path) {
        Some(i) => &path[..i],
        None => path,
    };
    let mut close = req.version == Some(0);
    let mut content_length: usize = 0;
    let mut authorization = None;
    for h in req.headers.iter() {
        let name = h.name.as_bytes();
        if name.eq_ignore_ascii_case(b"content-length") {
            content_length = match parse_len(h.value) {
                Some(n) => n,
                None => return Parse::Bad(400),
            };
        } else if name.eq_ignore_ascii_case(b"authorization") {
            authorization = Some(h.value);
        } else if name.eq_ignore_ascii_case(b"connection") {
            for token in h.value.split(|&c| c == b',') {
                let t = trim_ows(token);
                if t.eq_ignore_ascii_case(b"close") {
                    close = true;
                } else if t.eq_ignore_ascii_case(b"keep-alive") {
                    close = false;
                }
            }
        } else if name.eq_ignore_ascii_case(b"transfer-encoding") {
            // Chunked uploads aren't used by any client of this API; refuse rather than misframe.
            return Parse::Bad(400);
        }
    }
    if content_length > MAX_REQUEST {
        return Parse::Bad(413);
    }
    let total = head_len + content_length;
    if buf.len() < total {
        return Parse::Partial;
    }
    Parse::Done(Request { method, path, authorization, body: &buf[head_len..total], close }, total)
}

fn memchr_q(p: &[u8]) -> Option<usize> {
    p.iter().position(|&c| c == b'?')
}

fn trim_ows(s: &[u8]) -> &[u8] {
    let s = match s.iter().position(|&c| c != b' ' && c != b'\t') {
        Some(i) => &s[i..],
        None => return &[],
    };
    let e = s.iter().rposition(|&c| c != b' ' && c != b'\t').map_or(0, |i| i + 1);
    &s[..e]
}

fn parse_len(v: &[u8]) -> Option<usize> {
    let v = trim_ows(v);
    if v.is_empty() || v.len() > 9 {
        return None;
    }
    v.iter().try_fold(0usize, |a, &c| c.is_ascii_digit().then(|| a * 10 + (c - b'0') as usize))
}

/// Bytes reserved at the front of every response buffer for the status line and headers,
/// which are written after the body so Content-Length is known without a second pass.
pub const HEAD_RESERVE: usize = 128;

pub fn reason(status: u16) -> &'static str {
    match status {
        200 => "200 OK",
        201 => "201 Created",
        400 => "400 Bad Request",
        401 => "401 Unauthorized",
        404 => "404 Not Found",
        413 => "413 Content Too Large",
        503 => "503 Service Unavailable",
        _ => "500 Internal Server Error",
    }
}

/// Starts a response in `out`: clears it and reserves header space. Write the JSON body after.
pub fn begin(out: &mut Vec<u8>) {
    out.clear();
    out.resize(HEAD_RESERVE, 0);
}

/// Writes the headers in front of the body and returns the offset the response starts at.
pub fn finish(out: &mut [u8], status: u16, close: bool) -> usize {
    let body_len = out.len() - HEAD_RESERVE;
    let mut head = [0u8; HEAD_RESERVE];
    let mut n = 0;
    let mut put = |s: &[u8]| {
        head[n..n + s.len()].copy_from_slice(s);
        n += s.len();
    };
    put(b"HTTP/1.1 ");
    put(reason(status).as_bytes());
    put(b"\r\nContent-Type: application/json\r\nContent-Length: ");
    let mut digits = [0u8; 20];
    let mut i = digits.len();
    let mut v = body_len;
    loop {
        i -= 1;
        digits[i] = b'0' + (v % 10) as u8;
        v /= 10;
        if v == 0 {
            break;
        }
    }
    put(&digits[i..]);
    if close {
        put(b"\r\nConnection: close");
    }
    put(b"\r\n\r\n");
    let start = HEAD_RESERVE - n;
    out[start..HEAD_RESERVE].copy_from_slice(&head[..n]);
    start
}

#[cfg(test)]
mod tests {
    use super::*;

    fn done(buf: &[u8]) -> (Request<'_>, usize) {
        match parse(buf) {
            Parse::Done(r, n) => (r, n),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn parses_k6_style_requests() {
        let raw = b"POST /posts/12/like HTTP/1.1\r\nHost: x\r\nUser-Agent: k6\r\nAuthorization: Bearer t.o.k\r\nContent-Type: application/json\r\nContent-Length: 0\r\n\r\n";
        let (r, n) = done(raw);
        assert_eq!((r.method, r.path, r.authorization, r.body, r.close, n), (Method::Post, &b"/posts/12/like"[..], Some(&b"Bearer t.o.k"[..]), &b""[..], false, raw.len()));
        let (r, _) = done(b"GET /feed?x=1 HTTP/1.1\r\nconnection: Close\r\n\r\n");
        assert_eq!((r.path, r.close), (&b"/feed"[..], true));
        let (r, _) = done(b"GET / HTTP/1.0\r\n\r\n");
        assert!(r.close);
        let (r, _) = done(b"GET / HTTP/1.0\r\nConnection: keep-alive\r\n\r\n");
        assert!(!r.close);
    }

    #[test]
    fn partial_pipelined_and_bad() {
        let full = b"POST /posts HTTP/1.1\r\nContent-Length: 12\r\n\r\n{\"body\":\"x\"}";
        for i in 0..full.len() {
            assert!(matches!(parse(&full[..i]), Parse::Partial), "prefix {i}");
        }
        let mut two = full.to_vec();
        two.extend_from_slice(b"GET /feed HTTP/1.1\r\n\r\n");
        let (r, n) = done(&two);
        assert_eq!((r.body, n), (&b"{\"body\":\"x\"}"[..], full.len()));
        assert!(matches!(parse(&two[n..]), Parse::Done(..)));
        assert!(matches!(parse(b"\x00\x01garbage\r\n\r\n"), Parse::Bad(400)));
        assert!(matches!(parse(b"POST / HTTP/1.1\r\nContent-Length: abc\r\n\r\n"), Parse::Bad(400)));
        assert!(matches!(parse(b"POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n"), Parse::Bad(400)));
        assert!(matches!(parse(b"POST / HTTP/1.1\r\nContent-Length: 999999\r\n\r\n"), Parse::Bad(413)));
        let huge = [b'a'; MAX_REQUEST + 1];
        assert!(matches!(parse(&huge), Parse::Bad(_)));
    }

    #[test]
    fn frames_response() {
        let mut out = Vec::new();
        begin(&mut out);
        out.extend_from_slice(b"{\"a\":1}");
        let start = finish(&mut out, 201, true);
        assert_eq!(&out[start..], b"HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: 7\r\nConnection: close\r\n\r\n{\"a\":1}");
    }
}
