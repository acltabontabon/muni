//! Small helpers: tokens, hashing, email normalisation, text limits.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{Rng, RngCore};
use sha2::{Digest, Sha256};

pub fn random_token(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

/// Six digits, from a CSPRNG, zero padded.
pub fn random_code() -> String {
    let n: u32 = rand::rng().random_range(0..1_000_000);
    format!("{n:06}")
}

pub fn sha256(input: &[u8]) -> Vec<u8> {
    Sha256::digest(input).to_vec()
}

pub fn sha256_hex(input: &[u8]) -> String {
    hex::encode(Sha256::digest(input))
}

/// Normalises an email for identity purposes: trim, lowercase.
/// Deliberately does not strip plus-suffixes or dots; those are the
/// mailbox owner's business and stripping them can merge distinct people.
pub fn normalize_email(raw: &str) -> Option<String> {
    let e = raw.trim().to_lowercase();
    let (local, domain) = e.split_once('@')?;
    if local.is_empty() || domain.is_empty() || !domain.contains('.') || e.len() > 254 {
        return None;
    }
    if e.chars().any(|c| c.is_whitespace() || c == '<' || c == '>' || c == ',') {
        return None;
    }
    Some(e)
}

pub fn trimmed_nonempty(s: &str, max: usize, field: &str) -> Result<String, String> {
    let t = s.trim();
    if t.is_empty() {
        return Err(format!("{field} can’t be empty"));
    }
    if t.chars().count() > max {
        return Err(format!("{field} is too long (max {max} characters)"));
    }
    Ok(t.to_string())
}

pub fn trimmed_optional(s: Option<&str>, max: usize, field: &str) -> Result<Option<String>, String> {
    match s.map(str::trim) {
        None | Some("") => Ok(None),
        Some(t) if t.chars().count() > max => Err(format!("{field} is too long (max {max} characters)")),
        Some(t) => Ok(Some(t.to_string())),
    }
}

pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    use subtle::ConstantTimeEq;
    a.len() == b.len() && a.ct_eq(b).into()
}

pub fn shuffle<T>(items: &mut [T]) {
    use rand::seq::SliceRandom;
    items.shuffle(&mut rand::rng());
}

pub fn random_i32() -> i32 {
    rand::rng().random_range(0..i32::MAX)
}
