//! The installation's secrets (Phase 19, docs/local-windows/SECURITY.md): the installation id and date, and the three
//! keys the server needs (BIOMETRIC_KEY seals two-step secrets, AUTH_SECRET signs short-lived sign-in cookies,
//! CRON_SECRET guards the job runner). On Windows they are kept sealed with DPAPI for this Windows user
//! (`secrets.dpapi`): the file is useless copied to another computer or read by another user, and no plain copy stays
//! on disk. The shell unseals them when FITRON opens and hands them to the server as environment variables, the way a
//! hosted FITRON gets them, so the server never writes them.
//!
//! An older installation (or a restore, which writes the restored keys as plain `secrets.json`) is sealed on the next
//! start and the plain file removed. On Linux and macOS, where there is no DPAPI, the plain file stays, as before.

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const SEALED: &str = "secrets.dpapi";
const PLAIN: &str = "secrets.json";

#[derive(Clone, Debug, PartialEq)]
pub struct Secrets {
    pub installation_id: String,
    pub created_at: String,
    pub biometric_key: String,
    pub auth_secret: String,
    pub cron_secret: String,
}

/// How the secrets were obtained, for the log.
#[derive(Debug, PartialEq)]
pub enum How {
    Sealed,
    SealedFromPlain,
    NewSealed,
    Plain,
    NewPlain,
}

fn random_hex(n: usize) -> String {
    let mut b = vec![0u8; n];
    getrandom::fill(&mut b).expect("the operating system could not provide random numbers");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn uuid_v4() -> String {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).expect("the operating system could not provide random numbers");
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

impl Secrets {
    pub fn generate(now: &str) -> Secrets {
        Secrets { installation_id: uuid_v4(), created_at: now.to_string(), biometric_key: random_hex(32), auth_secret: random_hex(32), cron_secret: random_hex(32) }
    }

    /// The same JSON the server writes (src/lib/runtime/local-secrets.ts). Missing keys are made; an id is kept.
    pub fn from_json(text: &str, now: &str) -> Result<Secrets, String> {
        let v: serde_json::Value = serde_json::from_str(text).map_err(|e| format!("not JSON ({e})"))?;
        let s = |k: &str| v[k].as_str().filter(|x| !x.is_empty()).map(str::to_string);
        Ok(Secrets {
            installation_id: s("installationId").unwrap_or_else(uuid_v4),
            created_at: s("createdAt").unwrap_or_else(|| now.to_string()),
            biometric_key: s("BIOMETRIC_KEY").unwrap_or_else(|| random_hex(32)),
            auth_secret: s("AUTH_SECRET").unwrap_or_else(|| random_hex(32)),
            cron_secret: s("CRON_SECRET").unwrap_or_else(|| random_hex(32)),
        })
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(&serde_json::json!({
            "installationId": self.installation_id,
            "BIOMETRIC_KEY": self.biometric_key,
            "AUTH_SECRET": self.auth_secret,
            "CRON_SECRET": self.cron_secret,
            "createdAt": self.created_at,
        }))
        .expect("secrets serialise")
    }

    /// What the server gets. FITRON_SECRETS=shell tells it the shell holds them and it must not write a file.
    pub fn env(&self) -> Vec<(&'static str, OsString)> {
        vec![
            ("FITRON_SECRETS", "shell".into()),
            ("FITRON_INSTALLATION_ID", self.installation_id.clone().into()),
            ("FITRON_INSTALLED_AT", self.created_at.clone().into()),
            ("BIOMETRIC_KEY", self.biometric_key.clone().into()),
            ("AUTH_SECRET", self.auth_secret.clone().into()),
            ("CRON_SECRET", self.cron_secret.clone().into()),
        ]
    }
}

fn write_atomically(file: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = file.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, file)
}

/// Loads this installation's secrets, making and sealing them as described above. `now` is today's date-time (ISO).
#[cfg(windows)]
pub fn load_or_create(root: &Path, now: &str) -> io::Result<(Secrets, How)> {
    let sealed: PathBuf = root.join(SEALED);
    let plain: PathBuf = root.join(PLAIN);
    let bad = |m: String| io::Error::new(io::ErrorKind::InvalidData, m);
    // A plain file is newer than a sealed one: a restore, or an installation from before sealing.
    if plain.is_file() {
        let s = Secrets::from_json(&fs::read_to_string(&plain)?, now).map_err(|e| bad(format!("{PLAIN}: {e}")))?;
        write_atomically(&sealed, &dpapi::seal(s.to_json().as_bytes())?)?;
        fs::remove_file(&plain)?;
        return Ok((s, How::SealedFromPlain));
    }
    if sealed.is_file() {
        let text = dpapi::unseal(&fs::read(&sealed)?)?;
        let s = Secrets::from_json(&String::from_utf8_lossy(&text), now).map_err(|e| bad(format!("{SEALED}: {e}")))?;
        return Ok((s, How::Sealed));
    }
    let s = Secrets::generate(now);
    write_atomically(&sealed, &dpapi::seal(s.to_json().as_bytes())?)?;
    Ok((s, How::NewSealed))
}

/// Linux and macOS (development, CI): no DPAPI, so the plain file, readable by this user only.
#[cfg(not(windows))]
pub fn load_or_create(root: &Path, now: &str) -> io::Result<(Secrets, How)> {
    let plain: PathBuf = root.join(PLAIN);
    if plain.is_file() {
        let s = Secrets::from_json(&fs::read_to_string(&plain)?, now).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, format!("{PLAIN}: {e}")))?;
        return Ok((s, How::Plain));
    }
    let s = Secrets::generate(now);
    write_atomically(&plain, s.to_json().as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&plain, fs::Permissions::from_mode(0o600))?;
    }
    Ok((s, How::NewPlain))
}

#[cfg(windows)]
mod dpapi {
    //! CryptProtectData / CryptUnprotectData, user scope: only this Windows user on this computer can unseal.
    use std::io;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

    /// Tied in: a blob sealed for anything else does not unseal as FITRON's secrets.
    const PURPOSE: &[u8] = b"FITRON Gym Accounting secrets v1";

    fn blob(b: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB { cbData: b.len() as u32, pbData: b.as_ptr() as *mut u8 }
    }

    fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        let v = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize) }.to_vec();
        unsafe { LocalFree(out.pbData as _) };
        v
    }

    pub fn seal(plain: &[u8]) -> io::Result<Vec<u8>> {
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        let ok = unsafe { CryptProtectData(&blob(plain), std::ptr::null(), &blob(PURPOSE), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out) };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(take(out))
    }

    pub fn unseal(sealed: &[u8]) -> io::Result<Vec<u8>> {
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        let ok = unsafe { CryptUnprotectData(&blob(sealed), std::ptr::null_mut(), &blob(PURPOSE), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out) };
        if ok == 0 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, format!("the sealed secrets could not be opened by this Windows user on this computer ({})", io::Error::last_os_error())));
        }
        Ok(take(out))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makes_secrets_the_server_understands() {
        let s = Secrets::generate("2026-10-11T17:00:00.000Z");
        assert_eq!(s.installation_id.len(), 36);
        assert_eq!(s.biometric_key.len(), 64);
        assert_ne!(s.auth_secret, s.cron_secret);
        let back = Secrets::from_json(&s.to_json(), "later").unwrap();
        assert_eq!(back, s);
        let env: std::collections::HashMap<_, _> = s.env().into_iter().collect();
        assert_eq!(env["FITRON_SECRETS"], "shell");
        assert_eq!(env["FITRON_INSTALLATION_ID"], s.installation_id.as_str());
        assert_eq!(env["BIOMETRIC_KEY"], s.biometric_key.as_str());
    }

    #[test]
    fn keeps_an_installation_id_and_fills_what_is_missing() {
        let s = Secrets::from_json(r#"{"installationId":"abc","BIOMETRIC_KEY":"k"}"#, "2026-01-01T00:00:00Z").unwrap();
        assert_eq!(s.installation_id, "abc");
        assert_eq!(s.biometric_key, "k");
        assert_eq!(s.auth_secret.len(), 64);
        assert_eq!(s.created_at, "2026-01-01T00:00:00Z");
        assert!(Secrets::from_json("not json", "x").is_err());
    }

    #[test]
    fn loads_and_creates_in_a_data_folder() {
        let dir = std::env::temp_dir().join(format!("fitron-secrets-{}", random_hex(4)));
        fs::create_dir_all(&dir).unwrap();
        let (a, how) = load_or_create(&dir, "2026-10-11T17:00:00Z").unwrap();
        assert!(matches!(how, How::NewSealed | How::NewPlain));
        let (b, how2) = load_or_create(&dir, "2026-10-12T17:00:00Z").unwrap();
        assert_eq!(a, b);
        assert!(matches!(how2, How::Sealed | How::Plain));
        if cfg!(windows) {
            assert!(dir.join(SEALED).is_file());
            assert!(!dir.join(PLAIN).exists());
            // A restore writes a plain file: it wins and is sealed.
            fs::write(dir.join(PLAIN), r#"{"installationId":"restored-id","BIOMETRIC_KEY":"restored-key"}"#).unwrap();
            let (c, how3) = load_or_create(&dir, "2026-10-13T17:00:00Z").unwrap();
            assert_eq!(how3, How::SealedFromPlain);
            assert_eq!(c.installation_id, "restored-id");
            assert_eq!(c.biometric_key, "restored-key");
            assert!(!dir.join(PLAIN).exists());
            let (d, _) = load_or_create(&dir, "2026-10-14T17:00:00Z").unwrap();
            assert_eq!(d, c);
            // The sealed file is not the secrets in clear.
            let raw = fs::read(dir.join(SEALED)).unwrap();
            assert!(!String::from_utf8_lossy(&raw).contains("restored-key"));
        } else {
            assert!(dir.join(PLAIN).is_file());
        }
        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn seals_for_this_user_only_and_refuses_another_purpose() {
        let sealed = dpapi::seal(b"hello").unwrap();
        assert_ne!(sealed, b"hello");
        assert_eq!(dpapi::unseal(&sealed).unwrap(), b"hello");
        assert!(dpapi::unseal(b"not a dpapi blob").is_err());
    }
}
