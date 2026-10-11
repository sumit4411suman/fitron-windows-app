//! `logs\shell.log`: what the shell did (start, port, ready, stop), for FITRON support. Nothing about the gym.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone)]
pub struct ShellLog(Arc<Mutex<Option<File>>>);

impl ShellLog {
    /// Appends to the log, started afresh past 1 MB. A log that cannot be opened is not a reason to stop FITRON.
    pub fn open(file: &Path) -> ShellLog {
        if fs::metadata(file).map(|m| m.len() > 1024 * 1024).unwrap_or(false) {
            let _ = fs::rename(file, file.with_extension("1.log"));
        }
        ShellLog(Arc::new(Mutex::new(OpenOptions::new().create(true).append(true).open(file).ok())))
    }

    pub fn line(&self, text: &str) {
        if let Ok(mut f) = self.0.lock() {
            if let Some(f) = f.as_mut() {
                let _ = writeln!(f, "{} {}", utc_now(), text);
                let _ = f.flush();
            }
        }
    }
}

fn utc_now() -> String {
    let s = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    utc(s)
}

/// Seconds since 1970 as `YYYY-MM-DDTHH:MM:SSZ` (days to a civil date by Howard Hinnant's method).
pub fn utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_utc_times() {
        assert_eq!(utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(utc(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(utc(1_791_676_800 + 3_723), "2026-10-11T01:02:03Z");
    }
}
