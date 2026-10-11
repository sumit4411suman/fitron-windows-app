//! FITRON Gym Accounting for Windows: the desktop shell.
//!
//! 1. Start, one copy per Windows user (a second start brings the open window forward).
//! 2. Resolve the data folder: `%LOCALAPPDATA%\FITRON`, never the program folder.
//! 3. Start the local FITRON server (src/server.rs) on 127.0.0.1 and a free port.
//! 4. Wait for its health check to say it is ready.
//! 5. Open FITRON in the window.
//! 6. When FITRON closes, stop the server cleanly.
//!
//! The window shows FITRON's own pages from 127.0.0.1 and has no access to the shell: no Tauri commands are exposed to
//! it (there are no capabilities), so a page cannot reach files, programs or settings through the shell.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod nav;
mod server;
mod shell_log;

use std::path::PathBuf;
use std::sync::atomic::{AtomicU16, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use crate::nav::Go;
use crate::server::{Health, Launch, Server};
use crate::shell_log::ShellLog;

const TITLE: &str = "FITRON Gym Accounting";
/// The first start after an update applies database migrations (after a safety backup), which can take a while on a
/// large gym.
const START_TIMEOUT: Duration = Duration::from_secs(300);
/// The server waits up to 8 s for a backup or job already running, then writes its WAL into the database file.
const STOP_TIMEOUT: Duration = Duration::from_secs(15);

struct Shell {
    server: Mutex<Option<Server>>,
    port: Arc<AtomicU16>,
    log: ShellLog,
    data_root: PathBuf,
    /// Held while FITRON is open (see setup).
    _lock: std::fs::File,
}

/// The data folder. FITRON_DATA_DIR is for testing the shell; on a customer's computer it is the user's own
/// `%LOCALAPPDATA%\FITRON` (`~/.local/share/FITRON` on Linux), the same rule as src/lib/runtime/paths.ts.
fn data_root(app: &AppHandle) -> tauri::Result<PathBuf> {
    if let Some(given) = std::env::var_os("FITRON_DATA_DIR").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(given));
    }
    Ok(app.path().local_data_dir()?.join("FITRON"))
}

/// The Node.js runtime and the server, both installed with FITRON. The runtime sits beside the FITRON program
/// (`fitron-node.exe`); the server in its resources (`server\`).
fn launch(app: &AppHandle, data_root: PathBuf) -> Result<Launch, String> {
    // Windows can name these folders `\\?\C:\...`, which Node.js cannot resolve its script from: plain paths only.
    let exe = dunce::simplified(&std::env::current_exe().map_err(|e| e.to_string())?).to_path_buf();
    let dir = exe.parent().ok_or("FITRON's program folder could not be found.")?;
    let node = dir.join(if cfg!(windows) { "fitron-node.exe" } else { "fitron-node" });
    let server_dir = dunce::simplified(&app.path().resource_dir().map_err(|e| e.to_string())?).join("server");
    let data_root = dunce::simplified(&data_root).to_path_buf();
    if !node.is_file() {
        return Err(format!("A part of FITRON is missing ({}). Install FITRON again; your data is kept.", node.display()));
    }
    if !server_dir.join("server.js").is_file() {
        return Err(format!("A part of FITRON is missing ({}). Install FITRON again; your data is kept.", server_dir.join("server.js").display()));
    }
    Ok(Launch { node, server_dir, data_root })
}

/// What FITRON's window and any window it opens may show (src/nav.rs). A website opens in the computer's browser.
fn guarded<'a>(builder: WebviewWindowBuilder<'a, tauri::Wry, AppHandle>, app: &AppHandle, port: Arc<AtomicU16>) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    let (nav_app, nav_port) = (app.clone(), port.clone());
    let (new_app, new_port) = (app.clone(), port);
    builder
        .on_navigation(move |url| match nav::decide(url, nav_port.load(Ordering::SeqCst)) {
            Go::Inside => true,
            Go::Outside => {
                outside(&nav_app, url);
                false
            }
            Go::Nowhere => {
                log_of(&nav_app).line(&format!("refused to open {}", url.scheme()));
                false
            }
        })
        .on_new_window(move |url, features| match nav::decide(&url, new_port.load(Ordering::SeqCst)) {
            // A FITRON page asked for its own window (an invoice PDF, a member's document).
            Go::Inside => match open_inside(&new_app, url, features) {
                Ok(window) => NewWindowResponse::Create { window },
                Err(e) => {
                    log_of(&new_app).line(&format!("could not open a window: {e}"));
                    NewWindowResponse::Deny
                }
            },
            Go::Outside => {
                outside(&new_app, &url);
                NewWindowResponse::Deny
            }
            Go::Nowhere => NewWindowResponse::Deny,
        })
}

static WINDOWS: AtomicUsize = AtomicUsize::new(0);

fn open_inside(app: &AppHandle, url: Url, features: tauri::webview::NewWindowFeatures) -> tauri::Result<WebviewWindow> {
    let label = format!("page-{}", WINDOWS.fetch_add(1, Ordering::SeqCst));
    let port = app.state::<Shell>().port.clone();
    let b = WebviewWindowBuilder::new(app, label, WebviewUrl::External(url)).title(TITLE).window_features(features).on_document_title_changed(|w, title| {
        let _ = w.set_title(if title.is_empty() { TITLE } else { &title });
    });
    guarded(b, app, port).build()
}

fn outside(app: &AppHandle, url: &Url) {
    if let Err(e) = app.opener().open_url(url.as_str(), None::<&str>) {
        log_of(app).line(&format!("could not open a {} link: {e}", url.scheme()));
    }
}

fn log_of(app: &AppHandle) -> ShellLog {
    app.state::<Shell>().log.clone()
}

/// Starts the server and opens FITRON in the window, or says on the start-up page why it could not.
fn start(app: AppHandle, window: WebviewWindow) {
    let shell = app.state::<Shell>();
    let log = shell.log.clone();
    let failed = |reason: String| {
        log.line(&format!("start failed: {reason}"));
        let log_file = shell.data_root.join("logs").join("server.log");
        let js = format!(
            "window.fitronStartFailed && window.fitronStartFailed({}, {})",
            serde_json::to_string(&reason).unwrap_or_default(),
            serde_json::to_string(&log_file.display().to_string()).unwrap_or_default()
        );
        let _ = window.eval(js);
    };
    let l = match launch(&app, shell.data_root.clone()) {
        Ok(l) => l,
        Err(e) => return failed(e),
    };
    // A port taken between choosing it and the server opening it: try another.
    for attempt in 1..=3 {
        let port = match server::free_port() {
            Ok(p) => p,
            Err(e) => return failed(format!("No free port on this computer ({e}).")),
        };
        let instance = server::new_instance_id();
        let srv = match server::spawn(&l, port, &instance) {
            Ok(s) => s,
            Err(e) => return failed(format!("The FITRON server could not be started ({e}).")),
        };
        log.line(&format!("server starting on 127.0.0.1:{port} (attempt {attempt})"));
        *shell.server.lock().unwrap() = Some(srv);
        let began = Instant::now();
        let outcome = loop {
            if let Some(status) = shell.server.lock().unwrap().as_mut().and_then(|s| s.exited()) {
                break Err(format!("The FITRON server stopped while starting ({status})."));
            }
            match server::check_health(port, &instance) {
                Health::Ready { version } => break Ok(version),
                Health::Failed(e) if e == "Database migration failed" => {
                    break Err("FITRON could not update its database to this version. Nothing was changed: the database is as it was before.".into())
                }
                Health::Failed(e) => break Err(format!("The FITRON server reported: {e}.")),
                Health::NotYet => {}
            }
            if began.elapsed() > START_TIMEOUT {
                break Err(format!("The FITRON server did not become ready within {} minutes.", START_TIMEOUT.as_secs() / 60));
            }
            std::thread::sleep(Duration::from_millis(200));
        };
        match outcome {
            Ok(version) => {
                shell.port.store(port, Ordering::SeqCst);
                let url = format!("http://127.0.0.1:{port}/login");
                log.line(&format!("ready: FITRON {version} at http://127.0.0.1:{port} after {} ms", began.elapsed().as_millis()));
                match url.parse() {
                    Ok(u) => {
                        if let Err(e) = window.navigate(u) {
                            failed(format!("FITRON's window could not open the server ({e})."));
                        }
                    }
                    Err(e) => failed(format!("Bad address {url} ({e}).")),
                }
                return;
            }
            Err(reason) => {
                let tail = server::log_tail(&shell.data_root, 20);
                log.line(&format!("{reason}\n--- server.log ---\n{tail}"));
                if let Some(mut s) = shell.server.lock().unwrap().take() {
                    log.line(&s.stop(Duration::from_secs(5)));
                }
                if attempt < 3 && tail.contains("EADDRINUSE") {
                    continue;
                }
                return failed(reason);
            }
        }
    }
}

fn main() {
    let port = Arc::new(AtomicU16::new(0));
    let app = tauri::Builder::default()
        // One FITRON per Windows user: a second start brings the open window forward instead of starting a second
        // server on the same database.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        // Used by the shell itself to open websites in the computer's browser; pages cannot call it (no capabilities).
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let handle = app.handle().clone();
            let root = data_root(&handle)?;
            std::fs::create_dir_all(root.join("logs"))?;
            // One FITRON per data folder, whatever the single-instance check above could do (it needs a desktop
            // message bus on Linux): two servers on one database must never happen. Windows releases the lock when this
            // program ends in any way.
            let lock = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(root.join("fitron.lock"))?;
            if lock.try_lock().is_err() {
                ShellLog::open(&root.join("logs").join("shell.log")).line("another FITRON is already open with this data folder; not starting a second");
                std::process::exit(0);
            }
            let log = ShellLog::open(&root.join("logs").join("shell.log"));
            log.line(&format!("FITRON {} starting; data folder {}", handle.package_info().version, root.display()));
            app.manage(Shell { server: Mutex::new(None), port: port.clone(), log, data_root: root, _lock: lock });
            let b = WebviewWindowBuilder::new(&handle, "main", WebviewUrl::App("index.html".into()))
                .title(TITLE)
                .inner_size(1280.0, 800.0)
                .min_inner_size(1024.0, 640.0)
                .maximized(true);
            let window = guarded(b, &handle, port.clone()).build()?;
            std::thread::spawn(move || start(handle, window));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("FITRON could not open its window");
    app.run(|app, event| {
        if let RunEvent::Exit = event {
            let shell = app.state::<Shell>();
            let taken = shell.server.lock().map(|mut s| s.take()).unwrap_or(None);
            if let Some(mut s) = taken {
                shell.log.line(&s.stop(STOP_TIMEOUT));
            }
            shell.log.line("FITRON closed");
        }
    });
}
