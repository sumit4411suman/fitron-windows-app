//! The local FITRON server: the Next.js production server run by the Node.js runtime that ships inside FITRON (the
//! customer never installs Node.js). It listens on 127.0.0.1 only, on a port picked when FITRON opens, and stops when
//! FITRON closes: the shell closes the server's standard input and the server stops itself cleanly
//! (src/lib/runtime/local-shutdown.ts). On Windows the server also sits in a job object that ends it if the shell ever
//! ends without saying so.

use std::collections::hash_map::RandomState;
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::hash::{BuildHasher, Hasher};
use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

/// Where everything the server needs is.
#[derive(Clone, Debug)]
pub struct Launch {
    /// The Node.js runtime shipped beside the FITRON program.
    pub node: PathBuf,
    /// The server: `server.js`, `.next`, `node_modules`, `public`, `prisma/local-migrations`.
    pub server_dir: PathBuf,
    /// The gym's data folder (`%LOCALAPPDATA%\FITRON`).
    pub data_root: PathBuf,
}

pub struct Server {
    child: Child,
    #[cfg(windows)]
    _job: Option<job::Job>,
}

/// A port nobody is using on 127.0.0.1, chosen by Windows. Never another address: FITRON is not reachable from the
/// network.
pub fn free_port() -> io::Result<u16> {
    let l = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))?;
    Ok(l.local_addr()?.port())
}

/// A secret shared by the shell and the server it starts, for the shell's own requests (an update's backup). Random,
/// never shown, never written down; a new one each time FITRON opens.
pub fn new_token() -> String {
    let mut b = [0u8; 32];
    getrandom::fill(&mut b).expect("Windows could not provide random numbers");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// A new id for one start of the server. It is not a secret: it only lets the shell tell its own server's answer apart
/// from another program that might have taken the port.
pub fn new_instance_id() -> String {
    let a = RandomState::new().build_hasher().finish();
    let mut h = RandomState::new().build_hasher();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    h.write_u128(now ^ u128::from(std::process::id()));
    format!("{a:016x}{:016x}", h.finish())
}

/// Variables of the computer that must not reach the server: they would change how it runs (NODE_OPTIONS can load
/// code into it), or point it at another database or folder. FITRON sets its own below.
pub fn removed_variable(name: &str) -> bool {
    let n = name.to_ascii_uppercase();
    n.starts_with("FITRON_")
        || n.starts_with("NODE_OPTIONS")
        || n == "NODE_PATH"
        || n == "NODE_ENV"
        || n.starts_with("NEXT_")
        || n.starts_with("__NEXT")
        || n == "DATABASE_URL"
        || n == "STORAGE_DIR"
        || n == "PORT"
        || n == "HOSTNAME"
        || n == "CSP_MODE"
}

/// The server's settings: the Local Edition, the data folder, 127.0.0.1 and the port, production mode.
pub fn server_variables(l: &Launch, port: u16, instance: &str, token: &str) -> Vec<(&'static str, OsString)> {
    vec![
        ("FITRON_SHELL_TOKEN", token.into()),
        ("FITRON_EDITION", "local".into()),
        ("FITRON_SHELL", "1".into()),
        ("FITRON_INSTANCE", instance.into()),
        ("FITRON_DATA_DIR", l.data_root.clone().into_os_string()),
        ("FITRON_MIGRATIONS_DIR", l.server_dir.join("prisma").join("local-migrations").into_os_string()),
        ("NODE_ENV", "production".into()),
        ("NEXT_TELEMETRY_DISABLED", "1".into()),
        ("CSP_MODE", "enforce".into()),
        ("HOSTNAME", "127.0.0.1".into()),
        ("PORT", port.to_string().into()),
    ]
}

/// The server's own log, `logs\server.log`, started afresh when it passes 5 MB (the previous one is kept as
/// `server.1.log`).
fn server_log(data_root: &Path) -> io::Result<File> {
    let dir = data_root.join("logs");
    fs::create_dir_all(&dir)?;
    let file = dir.join("server.log");
    if fs::metadata(&file).map(|m| m.len() > 5 * 1024 * 1024).unwrap_or(false) {
        let _ = fs::rename(&file, dir.join("server.1.log"));
    }
    OpenOptions::new().create(true).append(true).open(file)
}

pub fn spawn(l: &Launch, port: u16, instance: &str, token: &str) -> io::Result<Server> {
    let log = server_log(&l.data_root)?;
    let mut cmd = Command::new(&l.node);
    cmd.arg(l.server_dir.join("server.js"))
        .current_dir(&l.server_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::from(log.try_clone()?))
        .stderr(Stdio::from(log));
    for (name, _) in std::env::vars_os() {
        if name.to_str().map(removed_variable).unwrap_or(false) {
            cmd.env_remove(&name);
        }
    }
    for (name, value) in server_variables(l, port, instance, token) {
        cmd.env(name, value);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No console window for the server.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let child = cmd.spawn()?;
    #[cfg(windows)]
    let _job = job::Job::kill_on_close(&child).ok();
    Ok(Server {
        child,
        #[cfg(windows)]
        _job,
    })
}

impl Server {
    /// The server's exit, if it has ended.
    pub fn exited(&mut self) -> Option<ExitStatus> {
        self.child.try_wait().ok().flatten()
    }

    /// Asks the server to stop by closing its standard input, waits up to `wait` for it to finish, and ends it only if
    /// it is still running then. Says which happened, for the log.
    pub fn stop(&mut self, wait: Duration) -> String {
        if let Some(status) = self.exited() {
            return format!("server had already stopped ({status})");
        }
        drop(self.child.stdin.take());
        let until = Instant::now() + wait;
        while Instant::now() < until {
            if let Some(status) = self.exited() {
                return format!("server stopped cleanly ({status})");
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
        format!("server did not stop within {} s and was ended", wait.as_secs())
    }
}

/// What the health check said.
#[derive(Debug, PartialEq)]
pub enum Health {
    /// Ours, and ready.
    Ready { version: String },
    /// Ours, and it cannot become ready (the database could not be updated).
    Failed(String),
    /// Not answering yet, still starting, or not ours.
    NotYet,
}

/// Reads `/api/health` once: `{ ok, edition, version, instance, error? }`.
pub fn check_health(port: u16, instance: &str) -> Health {
    match get(port, "/api/health") {
        Ok(body) => read_health(&body, instance),
        Err(_) => Health::NotYet,
    }
}

pub fn read_health(body: &str, instance: &str) -> Health {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(body) else { return Health::NotYet };
    if v["edition"] != "local" || v["instance"] != instance {
        return Health::NotYet;
    }
    if v["ok"] == true {
        return Health::Ready { version: v["version"].as_str().unwrap_or("").to_string() };
    }
    match (v["error"].as_str(), v["detail"].as_str()) {
        (Some("Starting") | None, _) => Health::NotYet,
        // The server's own sentence for the desk, when it has one (a database that could not be updated).
        (Some(_), Some(detail)) => Health::Failed(detail.to_string()),
        (Some("Database migration failed"), None) => Health::Failed("FITRON could not update its database to this version. Nothing was changed: the database is as it was before.".into()),
        (Some(e), None) => Health::Failed(format!("The FITRON server reported: {e}.")),
    }
}

/// One plain HTTP request to the server on 127.0.0.1, returning the body.
fn get(port: u16, path: &str) -> io::Result<String> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(1))?;
    s.set_read_timeout(Some(Duration::from_secs(3)))?;
    s.set_write_timeout(Some(Duration::from_secs(3)))?;
    write!(s, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n")?;
    let mut raw = Vec::new();
    s.read_to_end(&mut raw)?;
    body_of(&String::from_utf8_lossy(&raw)).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "not an HTTP answer"))
}

/// One request from the shell to its own server, with the shell's secret. Returns the body of the answer.
pub fn post(port: u16, path: &str, token: &str, body: &str, timeout: Duration) -> io::Result<String> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(2))?;
    s.set_read_timeout(Some(timeout))?;
    s.set_write_timeout(Some(Duration::from_secs(10)))?;
    write!(
        s,
        "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Fitron-Shell: {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )?;
    let mut raw = Vec::new();
    s.read_to_end(&mut raw)?;
    body_of(&String::from_utf8_lossy(&raw)).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "not an HTTP answer"))
}

/// The body of an HTTP/1.1 answer, with chunked transfer decoded.
pub fn body_of(raw: &str) -> Option<String> {
    let (head, body) = raw.split_once("\r\n\r\n")?;
    if !head.starts_with("HTTP/1.") {
        return None;
    }
    let chunked = head.lines().any(|l| {
        let l = l.to_ascii_lowercase();
        l.starts_with("transfer-encoding:") && l.contains("chunked")
    });
    if !chunked {
        return Some(body.to_string());
    }
    let mut out = String::new();
    let mut rest = body;
    loop {
        let (size, after) = rest.split_once("\r\n")?;
        let n = usize::from_str_radix(size.split(';').next()?.trim(), 16).ok()?;
        if n == 0 {
            return Some(out);
        }
        out.push_str(after.get(..n)?);
        rest = after.get(n..)?.strip_prefix("\r\n")?;
    }
}

/// The last lines of the server's log, to explain a start that failed.
pub fn log_tail(data_root: &Path, lines: usize) -> String {
    let text = fs::read_to_string(data_root.join("logs").join("server.log")).unwrap_or_default();
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

#[cfg(windows)]
mod job {
    //! A Windows job object that ends the server when the shell's handle to it closes, which Windows does when the
    //! shell ends in any way. A normal close never relies on it: the server has already stopped by then.
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    pub struct Job(HANDLE);
    // The handle is only closed, once, on drop.
    unsafe impl Send for Job {}

    impl Job {
        pub fn kill_on_close(child: &Child) -> std::io::Result<Job> {
            unsafe {
                let h = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if h.is_null() {
                    return Err(std::io::Error::last_os_error());
                }
                let job = Job(h);
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
                if SetInformationJobObject(h, JobObjectExtendedLimitInformation, &info as *const _ as *const _, size) == 0 {
                    return Err(std::io::Error::last_os_error());
                }
                if AssignProcessToJobObject(h, child.as_raw_handle() as HANDLE) == 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(job)
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_a_free_port_on_this_computer_only() {
        let p = free_port().unwrap();
        assert!(p > 0);
        // Free: it can be taken again on 127.0.0.1.
        TcpListener::bind(("127.0.0.1", p)).unwrap();
    }

    #[test]
    fn shell_secrets_are_long_and_new_each_time() {
        let a = new_token();
        assert_eq!(a.len(), 64);
        assert_ne!(a, new_token());
    }

    #[test]
    fn instance_ids_differ() {
        let a = new_instance_id();
        assert_eq!(a.len(), 32);
        assert_ne!(a, new_instance_id());
    }

    #[test]
    fn keeps_out_what_would_change_the_server() {
        for n in ["NODE_OPTIONS", "node_options", "NODE_PATH", "FITRON_LOCAL_ALLOW_SIGNUP", "FITRON_DATA_DIR", "DATABASE_URL", "STORAGE_DIR", "PORT", "HOSTNAME", "NEXT_PUBLIC_X", "CSP_MODE", "NODE_ENV"] {
            assert!(removed_variable(n), "{n}");
        }
        for n in ["PATH", "SystemRoot", "TEMP", "LOCALAPPDATA", "USERPROFILE", "NODE_EXTRA_CA_CERTS", "SMTP_HOST"] {
            assert!(!removed_variable(n), "{n}");
        }
    }

    #[test]
    fn starts_the_server_on_127_0_0_1_in_the_local_edition() {
        let l = Launch { node: "node".into(), server_dir: PathBuf::from("srv"), data_root: PathBuf::from("data") };
        let v: std::collections::HashMap<_, _> = server_variables(&l, 51234, "abc", "secret").into_iter().collect();
        assert_eq!(v["HOSTNAME"], "127.0.0.1");
        assert_eq!(v["PORT"], "51234");
        assert_eq!(v["FITRON_EDITION"], "local");
        assert_eq!(v["FITRON_SHELL"], "1");
        assert_eq!(v["FITRON_INSTANCE"], "abc");
        assert_eq!(v["FITRON_SHELL_TOKEN"], "secret");
        assert_eq!(v["FITRON_DATA_DIR"], "data");
        assert_eq!(PathBuf::from(&v["FITRON_MIGRATIONS_DIR"]), PathBuf::from("srv").join("prisma").join("local-migrations"));
        assert!(!v.contains_key("FITRON_LOCAL_ALLOW_SIGNUP"));
    }

    #[test]
    fn reads_the_health_check() {
        let ok = r#"{"ok":true,"edition":"local","version":"1.0.0","instance":"abc"}"#;
        assert_eq!(read_health(ok, "abc"), Health::Ready { version: "1.0.0".into() });
        // Another server's answer, or the Cloud Edition's, is not ours.
        assert_eq!(read_health(ok, "xyz"), Health::NotYet);
        assert_eq!(read_health(r#"{"ok":true,"edition":"cloud","instance":"abc"}"#, "abc"), Health::NotYet);
        assert_eq!(read_health(r#"{"ok":false,"edition":"local","instance":"abc","error":"Starting"}"#, "abc"), Health::NotYet);
        assert!(matches!(read_health(r#"{"ok":false,"edition":"local","instance":"abc","error":"Database migration failed"}"#, "abc"), Health::Failed(m) if m.contains("could not update its database")));
        assert_eq!(
            read_health(r#"{"ok":false,"edition":"local","instance":"abc","error":"Database migration failed","detail":"Put back from backup X."}"#, "abc"),
            Health::Failed("Put back from backup X.".into())
        );
        assert_eq!(read_health("<html>", "abc"), Health::NotYet);
    }

    #[test]
    fn reads_plain_and_chunked_answers() {
        assert_eq!(body_of("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}").as_deref(), Some("{}"));
        let chunked = "HTTP/1.1 503 Service Unavailable\r\nTransfer-Encoding: chunked\r\n\r\n5\r\n{\"a\":\r\n3\r\n12}\r\n0\r\n\r\n";
        assert_eq!(body_of(chunked).as_deref(), Some("{\"a\":12}"));
        assert_eq!(body_of("SSH-2.0-OpenSSH\r\n\r\n"), None);
    }

    #[test]
    fn health_of_a_port_nobody_answers_is_not_yet() {
        let p = free_port().unwrap();
        assert_eq!(check_health(p, "abc"), Health::NotYet);
    }
}
