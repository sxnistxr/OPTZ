//! HS256 JWT verification. Every request's signature is checked; nothing is remembered between
//! requests. The HMAC key schedule (inner/outer padded key state) is computed once from the
//! secret at startup and cloned for each verification.

use crate::json::{self, Val};
use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;
use std::borrow::Cow;

#[derive(Debug, PartialEq)]
pub enum JwtError {
    /// Bad signature, expired, missing `exp`, not HS256, or malformed.
    Invalid,
    /// Valid token, but `sub` isn't a positive-integer string or `username` isn't a string.
    Payload,
}

#[derive(Debug)]
pub struct Claims<'a> {
    pub user_id: i64,
    pub username: Cow<'a, [u8]>,
}

/// The latest expiry accepted (9999-12-31), so a token can't be made to live forever.
pub const MAX_EXP: f64 = 253_402_300_799.0;

pub struct Verifier {
    keyed: Hmac<Sha256>,
    header: Vec<u8>,
    payload: Vec<u8>,
}

impl Verifier {
    pub fn new(secret: &[u8]) -> Verifier {
        Verifier {
            keyed: Hmac::<Sha256>::new_from_slice(secret).expect("HMAC accepts any key length"),
            header: Vec::with_capacity(128),
            payload: Vec::with_capacity(512),
        }
    }

    /// Verifies `token` (the text after `Bearer `) at unix time `now`.
    pub fn verify(&mut self, token: &[u8], now: i64) -> Result<Claims<'_>, JwtError> {
        let mut parts = token.split(|&c| c == b'.');
        let (h, p, s) = match (parts.next(), parts.next(), parts.next(), parts.next()) {
            (Some(h), Some(p), Some(s), None) => (h, p, s),
            _ => return Err(JwtError::Invalid),
        };
        // Signature first: nothing from an unauthenticated token is trusted or parsed beyond
        // base64, except the header's algorithm, which must be HS256 either way.
        let mut sig = [0u8; 33];
        let n = b64url_decode_into(s, &mut sig).ok_or(JwtError::Invalid)?;
        if n != 32 {
            return Err(JwtError::Invalid);
        }
        let mut mac = self.keyed.clone();
        mac.update(&token[..h.len() + 1 + p.len()]);
        mac.verify_slice(&sig[..32]).map_err(|_| JwtError::Invalid)?;

        self.header.clear();
        b64url_decode_vec(h, &mut self.header).ok_or(JwtError::Invalid)?;
        match json::parse_object(&self.header, [b"alg"]) {
            Ok(Some([Some(Val::Str(alg))])) if &*alg == b"HS256" => {}
            _ => return Err(JwtError::Invalid),
        }

        self.payload.clear();
        b64url_decode_vec(p, &mut self.payload).ok_or(JwtError::Invalid)?;
        let [sub, username, exp] = match json::parse_object(&self.payload, [b"sub", b"username", b"exp"]) {
            Ok(Some(v)) => v,
            _ => return Err(JwtError::Invalid),
        };
        let exp = match exp {
            Some(Val::Num(n)) => std::str::from_utf8(n).ok().and_then(|n| n.parse::<f64>().ok()).ok_or(JwtError::Invalid)?,
            _ => return Err(JwtError::Invalid),
        };
        // A NumericDate in seconds: finite and before MAX_EXP. "1e400" parses as infinity and
        // would otherwise never expire.
        if !exp.is_finite() || exp > MAX_EXP || (now as f64) >= exp {
            return Err(JwtError::Invalid);
        }
        let user_id = match sub {
            Some(Val::Str(s)) => parse_positive(&s).ok_or(JwtError::Payload)?,
            _ => return Err(JwtError::Payload),
        };
        let username = match username {
            Some(Val::Str(u)) => u,
            _ => return Err(JwtError::Payload),
        };
        Ok(Claims { user_id, username })
    }
}

/// A positive integer of ASCII digits that fits in i64.
pub fn parse_positive(s: &[u8]) -> Option<i64> {
    if s.is_empty() || s.len() > 19 {
        return None;
    }
    let mut v: i64 = 0;
    for &c in s {
        if !c.is_ascii_digit() {
            return None;
        }
        v = v.checked_mul(10)?.checked_add((c - b'0') as i64)?;
    }
    (v > 0).then_some(v)
}

static B64: [u8; 256] = {
    let mut t = [0xFFu8; 256];
    let a = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut i = 0;
    while i < 64 {
        t[a[i] as usize] = i as u8;
        i += 1;
    }
    t
};

/// Unpadded base64url. Returns None for any character outside the alphabet (including `=`)
/// or an impossible length.
fn b64url_decode(s: &[u8], mut emit: impl FnMut(u8) -> bool) -> Option<()> {
    if s.len() % 4 == 1 {
        return None;
    }
    let mut acc: u32 = 0;
    let mut bits = 0;
    for &c in s {
        let v = B64[c as usize];
        if v == 0xFF {
            return None;
        }
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            if !emit((acc >> bits) as u8) {
                return None;
            }
        }
    }
    Some(())
}

fn b64url_decode_into(s: &[u8], out: &mut [u8]) -> Option<usize> {
    let mut n = 0;
    b64url_decode(s, |b| {
        if n == out.len() {
            return false;
        }
        out[n] = b;
        n += 1;
        true
    })?;
    Some(n)
}

fn b64url_decode_vec(s: &[u8], out: &mut Vec<u8>) -> Option<()> {
    if s.len() > 8192 {
        return None;
    }
    b64url_decode(s, |b| {
        out.push(b);
        true
    })
}

#[cfg(test)]
pub mod tests {
    use super::*;

    use std::io::Read;
    use std::sync::OnceLock;

    fn random_key() -> [u8; 32] {
        let mut key = Vec::new();
        std::fs::File::open("/dev/urandom")
            .and_then(|file| file.take(32).read_to_end(&mut key))
            .expect("OS randomness is required for JWT tests");
        key.try_into().expect("OS randomness must supply exactly 32 key bytes")
    }

    fn secret() -> &'static [u8; 32] {
        static SECRET: OnceLock<[u8; 32]> = OnceLock::new();
        SECRET.get_or_init(random_key)
    }

    pub fn b64(data: &[u8]) -> String {
        const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut out = String::new();
        for chunk in data.chunks(3) {
            let n = chunk.iter().enumerate().fold(0u32, |a, (i, &b)| a | (b as u32) << (16 - 8 * i));
            for i in 0..=chunk.len() {
                out.push(A[(n >> (18 - 6 * i) & 63) as usize] as char);
            }
        }
        out
    }

    pub fn sign_with(header: &str, payload: &str, secret: &[u8]) -> String {
        let hp = format!("{}.{}", b64(header.as_bytes()), b64(payload.as_bytes()));
        let mut m = Hmac::<Sha256>::new_from_slice(secret).unwrap();
        m.update(hp.as_bytes());
        format!("{hp}.{}", b64(&m.finalize().into_bytes()))
    }

    pub fn sign(payload: &str) -> String {
        sign_with(r#"{"alg":"HS256","typ":"JWT"}"#, payload, secret())
    }

    fn check(token: &str) -> Result<(i64, Vec<u8>), JwtError> {
        Verifier::new(secret()).verify(token.as_bytes(), 1_000).map(|c| (c.user_id, c.username.into_owned()))
    }

    #[test]
    fn accepts_valid() {
        assert_eq!(check(&sign(r#"{"sub":"7","username":"ann","iat":1,"exp":2000}"#)), Ok((7, b"ann".to_vec())));
        assert_eq!(check(&sign(r#"{"sub":"7","username":"a\"n","exp":1000.5}"#)), Ok((7, b"a\"n".to_vec())));
        let reordered = sign_with(r#"{"typ":"JWT","alg":"HS256"}"#, r#"{"exp":2000,"username":"x","sub":"1"}"#, secret());
        assert_eq!(check(&reordered), Ok((1, b"x".to_vec())));
    }

    #[test]
    fn rejects_invalid() {
        let good = sign(r#"{"sub":"7","username":"ann","exp":2000}"#);
        let (hp, _) = good.rsplit_once('.').unwrap();
        let none = format!("{}.{}.", b64(br#"{"alg":"none","typ":"JWT"}"#), hp.split('.').nth(1).unwrap());
        for bad in [
            "abc".to_string(),
            format!("{hp}.c2lnbmF0dXJlLWlzLW5vdC12YWxpZC1hdC1hbGwtYXQtYWxsLTEyMzQ"),
            none,
            sign(r#"{"sub":"7","username":"ann","exp":999}"#),
            sign(r#"{"sub":"7","username":"ann","exp":1000}"#),
            sign(r#"{"sub":"7","username":"ann"}"#),
            sign(r#"{"sub":"7","username":"ann","exp":"2000"}"#),
            // exp that parses to infinity, or is absurdly far away, never counts.
            sign(r#"{"sub":"7","username":"ann","exp":1e400}"#),
            sign(r#"{"sub":"7","username":"ann","exp":1e300}"#),
            sign_with(r#"{"alg":"HS512"}"#, r#"{"sub":"7","username":"ann","exp":2000}"#, secret()),
            sign_with(r#"{"alg":"HS256"}"#, r#"{"sub":"7","username":"ann","exp":2000}"#, &random_key()),
            sign_with("not json", r#"{"sub":"7","username":"ann","exp":2000}"#, secret()),
            sign(r#"[1,2]"#),
            sign("{bad"),
            format!("{good}.x"),
            format!("{good}="),
            good.replacen('.', "..", 1),
        ] {
            assert_eq!(check(&bad), Err(JwtError::Invalid), "{bad}");
        }
    }

    #[test]
    fn rejects_payload() {
        for p in [
            r#"{"sub":"abc","username":"a","exp":2000}"#,
            r#"{"sub":"0","username":"a","exp":2000}"#,
            r#"{"sub":"-1","username":"a","exp":2000}"#,
            r#"{"sub":7,"username":"a","exp":2000}"#,
            r#"{"sub":"7","exp":2000}"#,
            r#"{"sub":"7","username":5,"exp":2000}"#,
            r#"{"username":"a","exp":2000}"#,
            r#"{"sub":"99999999999999999999","username":"a","exp":2000}"#,
        ] {
            assert_eq!(check(&sign(p)), Err(JwtError::Payload), "{p}");
        }
    }
}
