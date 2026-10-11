//! Safe updates (Phase 18, docs/local-windows/UPDATES.md).
//!
//!   new version → download → verify (FITRON's signature) → back up the gym's data → install → (new FITRON starts)
//!   → migrate the database after a safety backup → verify the database → open FITRON
//!
//! Only the shell talks to the update server, and it sends nothing but what any download sends (this program's version
//! and Windows' architecture in the address). The address and FITRON's public key are built into a release
//! (FITRON_UPDATE_URL, FITRON_UPDATE_PUBKEY); a build without them never looks for updates. An update that is not
//! signed by FITRON's key, or that claims a version its signature does not carry, is refused.

use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

use crate::Shell;

/// Where FITRON looks for updates, and the key their signatures must verify with. Set when a release is built.
pub const UPDATE_URL: Option<&str> = option_env!("FITRON_UPDATE_URL");
pub const UPDATE_PUBKEY: Option<&str> = option_env!("FITRON_UPDATE_PUBKEY");

pub fn configured() -> Option<(&'static str, &'static str)> {
    match (UPDATE_URL, UPDATE_PUBKEY) {
        (Some(u), Some(k)) if u.starts_with("https://") && !k.trim().is_empty() => Some((u, k)),
        _ => None,
    }
}

const FIRST_CHECK: Duration = Duration::from_secs(60);
const EVERY: Duration = Duration::from_secs(12 * 60 * 60);

/// Looks for an update a minute after FITRON is ready, then every 12 hours while it is open.
pub fn watch(app: AppHandle) {
    let Some((url, _)) = configured() else {
        log(&app, "updates: not configured in this build");
        return;
    };
    let Ok(endpoint) = url.parse() else {
        log(&app, "updates: the update address in this build is not valid");
        return;
    };
    tauri::async_runtime::spawn(async move {
        tokio_sleep(FIRST_CHECK).await;
        loop {
            check_once(&app, &endpoint).await;
            tokio_sleep(EVERY).await;
        }
    });
}

async fn tokio_sleep(d: Duration) {
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        std::thread::sleep(d);
        let _ = tx.send(());
    });
    let _ = tauri::async_runtime::spawn_blocking(move || rx.recv()).await;
}

fn log(app: &AppHandle, s: &str) {
    app.state::<Shell>().log.line(s);
}

async fn check_once(app: &AppHandle, endpoint: &tauri::Url) {
    let stopping = app.clone();
    let updater = match app
        .updater_builder()
        .endpoints(vec![endpoint.clone()])
        // The installer replaces the program once FITRON has exited: stop the server cleanly first.
        .map(|b| b.on_before_exit(move || crate::stop_server(&stopping)))
        .and_then(|b| b.build())
    {
        Ok(u) => u,
        Err(e) => return log(app, &format!("updates: {e}")),
    };
    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => return log(app, "updates: FITRON is up to date"),
        // Offline or the server is away: try again later, say nothing to the desk.
        Err(e) => return log(app, &format!("updates: could not check ({e})")),
    };
    log(app, &format!("updates: {} available (this is {})", update.version, update.current_version));
    let notes = update.body.clone().filter(|b| !b.trim().is_empty()).map(|b| format!("\n\nWhat is new:\n{}", b.trim())).unwrap_or_default();
    let yes = app
        .dialog()
        .message(format!(
            "FITRON {} is available. This computer has {}.{}\n\nBefore updating, FITRON backs up the gym's data. Then it closes, updates and opens again, in about a minute. Everything saved is kept.",
            update.version, update.current_version, notes
        ))
        .title("Update FITRON")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom("Install now".into(), "Later".into()))
        .blocking_show();
    if !yes {
        return log(app, "updates: later");
    }
    let bytes = match update.download(|_, _| {}, || {}).await {
        Ok(b) => b,
        Err(e) => {
            log(app, &format!("updates: download or verification failed ({e})"));
            return tell(app, "The update could not be downloaded, or it is not signed by FITRON, so it was not installed. Nothing has changed.");
        }
    };
    log(app, &format!("updates: {} downloaded and verified", update.version));
    match backup(app, &format!("Before updating to FITRON {}", update.version)) {
        Ok(name) => log(app, &format!("updates: data backed up ({name})")),
        Err(e) => {
            log(app, &format!("updates: backup failed, not updating ({e})"));
            return tell(app, "FITRON could not back up the gym's data, so it did not update. Nothing has changed. Make a backup in Settings › Backup, then try again.");
        }
    }
    // Windows: the installer takes over from here; FITRON's server is stopped cleanly first (on_before_exit).
    if let Err(e) = update.install(bytes) {
        log(app, &format!("updates: the installer did not start ({e})"));
        tell(app, "The update could not be started. Nothing has changed.");
    }
}

fn tell(app: &AppHandle, text: &str) {
    app.dialog().message(text).title("Update FITRON").kind(MessageDialogKind::Warning).blocking_show();
}

/// Asks this FITRON's server for a safety backup of the gym's data, over the shell's own channel.
fn backup(app: &AppHandle, reason: &str) -> Result<String, String> {
    let shell = app.state::<Shell>();
    let port = shell.port.load(Ordering::SeqCst);
    if port == 0 {
        return Err("the server is not running".into());
    }
    let body = serde_json::json!({ "reason": reason }).to_string();
    let answer = crate::server::post(port, "/api/local/shell/backup", &shell.token, &body, Duration::from_secs(600)).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&answer).map_err(|_| format!("unexpected answer: {answer}"))?;
    match (v["ok"].as_bool(), v["name"].as_str()) {
        (Some(true), Some(name)) => Ok(name.to_string()),
        _ => Err(v["error"].as_str().unwrap_or("no backup was made").to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_build_without_an_update_address_and_key_never_looks() {
        // This test build has neither.
        if UPDATE_URL.is_none() || UPDATE_PUBKEY.is_none() {
            assert!(configured().is_none());
        }
    }
}
