//! A narrow, strict JSON reader and an escaping writer.
//!
//! The reader validates a whole document (RFC 8259: no trailing commas, no comments, no lone
//! surrogates, no raw control characters in strings, valid UTF-8) and extracts only the top-level
//! object members it is asked for. Duplicate keys resolve to the last value, as in `JSON.parse`.
//! Strings without escapes are borrowed from the input; escaped ones are decoded into a `Vec`.

use std::borrow::Cow;

const MAX_DEPTH: u32 = 64;

#[derive(Debug, PartialEq)]
pub enum Val<'a> {
    Str(Cow<'a, [u8]>),
    /// The raw number text, already validated against the JSON grammar.
    Num(&'a [u8]),
    Other,
}

#[derive(Debug, PartialEq)]
pub struct Malformed;

/// Parses `input` as one JSON document. Returns `Ok(None)` if it is valid JSON but not an object,
/// otherwise the last value of each requested top-level key.
pub fn parse_object<'a, const N: usize>(
    input: &'a [u8],
    keys: [&[u8]; N],
) -> Result<Option<[Option<Val<'a>>; N]>, Malformed> {
    let mut p = Parser { s: input, i: 0 };
    p.ws();
    if p.peek() != Some(b'{') {
        p.value(0)?;
        p.ws();
        return if p.i == p.s.len() { Ok(None) } else { Err(Malformed) };
    }
    p.i += 1;
    let mut out: [Option<Val<'a>>; N] = std::array::from_fn(|_| None);
    p.ws();
    if p.peek() == Some(b'}') {
        p.i += 1;
    } else {
        loop {
            p.ws();
            if p.peek() != Some(b'"') {
                return Err(Malformed);
            }
            let key = p.string()?;
            p.ws();
            if p.next() != Some(b':') {
                return Err(Malformed);
            }
            p.ws();
            let slot = keys.iter().position(|k| *k == &*key);
            match slot {
                Some(k) => out[k] = Some(p.captured_value()?),
                None => p.value(1)?,
            }
            p.ws();
            match p.next() {
                Some(b',') => continue,
                Some(b'}') => break,
                _ => return Err(Malformed),
            }
        }
    }
    p.ws();
    if p.i != p.s.len() {
        return Err(Malformed);
    }
    Ok(Some(out))
}

struct Parser<'a> {
    s: &'a [u8],
    i: usize,
}

impl<'a> Parser<'a> {
    #[inline]
    fn peek(&self) -> Option<u8> {
        self.s.get(self.i).copied()
    }

    #[inline]
    fn next(&mut self) -> Option<u8> {
        let c = self.peek();
        self.i += 1;
        c
    }

    #[inline]
    fn ws(&mut self) {
        while let Some(b' ' | b'\t' | b'\n' | b'\r') = self.peek() {
            self.i += 1;
        }
    }

    fn captured_value(&mut self) -> Result<Val<'a>, Malformed> {
        match self.peek() {
            Some(b'"') => Ok(Val::Str(self.string()?)),
            Some(b'-' | b'0'..=b'9') => {
                let start = self.i;
                self.number()?;
                Ok(Val::Num(&self.s[start..self.i]))
            }
            _ => {
                self.value(1)?;
                Ok(Val::Other)
            }
        }
    }

    fn value(&mut self, depth: u32) -> Result<(), Malformed> {
        if depth > MAX_DEPTH {
            return Err(Malformed);
        }
        match self.peek().ok_or(Malformed)? {
            b'"' => self.string().map(drop),
            b'-' | b'0'..=b'9' => self.number(),
            b't' => self.literal(b"true"),
            b'f' => self.literal(b"false"),
            b'n' => self.literal(b"null"),
            b'[' => {
                self.i += 1;
                self.ws();
                if self.peek() == Some(b']') {
                    self.i += 1;
                    return Ok(());
                }
                loop {
                    self.ws();
                    self.value(depth + 1)?;
                    self.ws();
                    match self.next() {
                        Some(b',') => continue,
                        Some(b']') => return Ok(()),
                        _ => return Err(Malformed),
                    }
                }
            }
            b'{' => {
                self.i += 1;
                self.ws();
                if self.peek() == Some(b'}') {
                    self.i += 1;
                    return Ok(());
                }
                loop {
                    self.ws();
                    if self.peek() != Some(b'"') {
                        return Err(Malformed);
                    }
                    self.string()?;
                    self.ws();
                    if self.next() != Some(b':') {
                        return Err(Malformed);
                    }
                    self.ws();
                    self.value(depth + 1)?;
                    self.ws();
                    match self.next() {
                        Some(b',') => continue,
                        Some(b'}') => return Ok(()),
                        _ => return Err(Malformed),
                    }
                }
            }
            _ => Err(Malformed),
        }
    }

    fn literal(&mut self, lit: &[u8]) -> Result<(), Malformed> {
        if self.s[self.i..].starts_with(lit) {
            self.i += lit.len();
            Ok(())
        } else {
            Err(Malformed)
        }
    }

    fn digits(&mut self) -> usize {
        let start = self.i;
        while let Some(b'0'..=b'9') = self.peek() {
            self.i += 1;
        }
        self.i - start
    }

    fn number(&mut self) -> Result<(), Malformed> {
        if self.peek() == Some(b'-') {
            self.i += 1;
        }
        match self.peek() {
            Some(b'0') => self.i += 1,
            Some(b'1'..=b'9') => {
                self.digits();
            }
            _ => return Err(Malformed),
        }
        if self.peek() == Some(b'.') {
            self.i += 1;
            if self.digits() == 0 {
                return Err(Malformed);
            }
        }
        if let Some(b'e' | b'E') = self.peek() {
            self.i += 1;
            if let Some(b'+' | b'-') = self.peek() {
                self.i += 1;
            }
            if self.digits() == 0 {
                return Err(Malformed);
            }
        }
        Ok(())
    }

    /// Parses a string starting at the opening quote.
    fn string(&mut self) -> Result<Cow<'a, [u8]>, Malformed> {
        self.i += 1;
        let start = self.i;
        // Fast path: no escapes. Validate UTF-8 and control characters while scanning.
        loop {
            let c = self.peek().ok_or(Malformed)?;
            match c {
                b'"' => {
                    let raw = &self.s[start..self.i];
                    self.i += 1;
                    std::str::from_utf8(raw).map_err(|_| Malformed)?;
                    return Ok(Cow::Borrowed(raw));
                }
                b'\\' => break,
                0..=0x1f => return Err(Malformed),
                _ => self.i += 1,
            }
        }
        let mut out = self.s[start..self.i].to_vec();
        loop {
            let c = self.next().ok_or(Malformed)?;
            match c {
                b'"' => {
                    std::str::from_utf8(&out).map_err(|_| Malformed)?;
                    return Ok(Cow::Owned(out));
                }
                b'\\' => {
                    let e = self.next().ok_or(Malformed)?;
                    match e {
                        b'"' => out.push(b'"'),
                        b'\\' => out.push(b'\\'),
                        b'/' => out.push(b'/'),
                        b'b' => out.push(8),
                        b'f' => out.push(12),
                        b'n' => out.push(b'\n'),
                        b'r' => out.push(b'\r'),
                        b't' => out.push(b'\t'),
                        b'u' => {
                            let hi = self.hex4()?;
                            let cp = if (0xD800..0xDC00).contains(&hi) {
                                if self.next() != Some(b'\\') || self.next() != Some(b'u') {
                                    return Err(Malformed);
                                }
                                let lo = self.hex4()?;
                                if !(0xDC00..0xE000).contains(&lo) {
                                    return Err(Malformed);
                                }
                                0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00)
                            } else if (0xDC00..0xE000).contains(&hi) {
                                return Err(Malformed);
                            } else {
                                hi
                            };
                            let ch = char::from_u32(cp).ok_or(Malformed)?;
                            let mut b = [0u8; 4];
                            out.extend_from_slice(ch.encode_utf8(&mut b).as_bytes());
                        }
                        _ => return Err(Malformed),
                    }
                }
                0..=0x1f => return Err(Malformed),
                _ => out.push(c),
            }
        }
    }

    fn hex4(&mut self) -> Result<u32, Malformed> {
        let mut v = 0u32;
        for _ in 0..4 {
            let c = self.next().ok_or(Malformed)?;
            let d = match c {
                b'0'..=b'9' => c - b'0',
                b'a'..=b'f' => c - b'a' + 10,
                b'A'..=b'F' => c - b'A' + 10,
                _ => return Err(Malformed),
            };
            v = (v << 4) | d as u32;
        }
        Ok(v)
    }
}

/// 1 for bytes that need escaping inside a JSON string.
static NEEDS_ESCAPE: [u8; 256] = {
    let mut t = [0u8; 256];
    let mut i = 0;
    while i < 0x20 {
        t[i] = 1;
        i += 1;
    }
    t[b'"' as usize] = 1;
    t[b'\\' as usize] = 1;
    t
};

/// Appends `s` as a quoted JSON string. `s` must be valid UTF-8 (all our text is: it came from
/// SQLite TEXT written by us, or from a validated JSON string).
pub fn write_str(out: &mut Vec<u8>, s: &[u8]) {
    out.reserve(s.len() + 2);
    out.push(b'"');
    let mut start = 0;
    for (i, &c) in s.iter().enumerate() {
        if NEEDS_ESCAPE[c as usize] == 0 {
            continue;
        }
        out.extend_from_slice(&s[start..i]);
        match c {
            b'"' => out.extend_from_slice(b"\\\""),
            b'\\' => out.extend_from_slice(b"\\\\"),
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b'\t' => out.extend_from_slice(b"\\t"),
            8 => out.extend_from_slice(b"\\b"),
            12 => out.extend_from_slice(b"\\f"),
            _ => {
                const HEX: &[u8; 16] = b"0123456789abcdef";
                out.extend_from_slice(b"\\u00");
                out.push(HEX[(c >> 4) as usize]);
                out.push(HEX[(c & 15) as usize]);
            }
        }
        start = i + 1;
    }
    out.extend_from_slice(&s[start..]);
    out.push(b'"');
}

/// Appends a decimal integer.
pub fn write_int(out: &mut Vec<u8>, v: i64) {
    let mut buf = [0u8; 20];
    let mut i = buf.len();
    let neg = v < 0;
    let mut n = v.unsigned_abs();
    loop {
        i -= 1;
        buf[i] = b'0' + (n % 10) as u8;
        n /= 10;
        if n == 0 {
            break;
        }
    }
    if neg {
        out.push(b'-');
    }
    out.extend_from_slice(&buf[i..]);
}

/// `String.prototype.trim` semantics on UTF-8: strips ECMAScript WhiteSpace and LineTerminator
/// code points from both ends. `s` must be valid UTF-8.
pub fn trim_js(s: &[u8]) -> &[u8] {
    let str = std::str::from_utf8(s).expect("validated UTF-8");
    str.trim_matches(is_js_space).as_bytes()
}

fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}' | '\u{A}' | '\u{B}' | '\u{C}' | '\u{D}' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}'
            | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

/// Number of Unicode scalar values in valid UTF-8, which is what SQLite's `length()` counts for
/// TEXT (the schema's CHECK constraint).
pub fn char_count(s: &[u8]) -> usize {
    s.iter().filter(|&&b| (b & 0xC0) != 0x80).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(input: &str) -> Result<Option<Option<Vec<u8>>>, Malformed> {
        parse_object(input.as_bytes(), [b"body"]).map(|o| {
            o.map(|[v]| match v {
                Some(Val::Str(s)) => Some(s.into_owned()),
                _ => None,
            })
        })
    }

    #[test]
    fn extracts_body() {
        assert_eq!(body(r#"{"body":"hi"}"#), Ok(Some(Some(b"hi".to_vec()))));
        assert_eq!(body(r#" { "x" : [1, {"a":null}], "body" : "a\"b\u00e9\ud83d\ude00" } "#),
            Ok(Some(Some("a\"bé😀".as_bytes().to_vec()))));
        assert_eq!(body(r#"{"body":"a","body":"b"}"#), Ok(Some(Some(b"b".to_vec()))));
        assert_eq!(body(r#"{"body":123}"#), Ok(Some(None)));
        assert_eq!(body(r#"{}"#), Ok(Some(None)));
        assert_eq!(body(r#"[]"#), Ok(None));
        assert_eq!(body(r#""x""#), Ok(None));
    }

    #[test]
    fn rejects_malformed() {
        for bad in [
            "", "{bad json", "{\"body\":\"x\",}", "{\"body\" \"x\"}", "{\"body\":\"\\x\"}",
            "{\"body\":\"\\ud800\"}", "{\"body\":\"\\udc00x\"}", "{\"body\":\"a\nb\"}", "{} x",
            "{\"a\":01}", "{\"a\":1.}", "{\"a\":-}", "{\"a\":tru}", "{'a':1}", "{\"a\":[1,]}",
            "\u{FEFF}{}",
        ] {
            assert_eq!(body(bad), Err(Malformed), "{bad:?}");
        }
        let deep = "[".repeat(100) + &"]".repeat(100);
        assert_eq!(body(&deep), Err(Malformed));
    }

    #[test]
    fn writes_escapes() {
        let mut o = Vec::new();
        write_str(&mut o, "a\"b\\c\n\u{1}é/<>".as_bytes());
        assert_eq!(std::str::from_utf8(&o).unwrap(), r#""a\"b\\c\n\u0001é/<>""#);
        o.clear();
        write_int(&mut o, -1234567890123);
        write_int(&mut o, 0);
        assert_eq!(&o, b"-12345678901230");
    }

    #[test]
    fn trims_like_js() {
        assert_eq!(trim_js("  \t\u{3000}x y\u{FEFF}\n".as_bytes()), b"x y");
        assert_eq!(trim_js(b"   "), b"");
        assert_eq!(char_count("café ✓".as_bytes()), 6);
    }
}
