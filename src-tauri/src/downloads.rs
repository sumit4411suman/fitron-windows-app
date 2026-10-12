//! Files FITRON's pages download: an invoice or receipt PDF, a CSV or Excel export, a backup. WebView2 saves each in the
//! user's Downloads folder (renaming it if the name is taken); the shell then says so, with the file's name and folder,
//! and offers to open it or show it in its folder. Only FITRON's own pages may download: a file from anywhere else is
//! refused.

use std::path::Path;

use tauri::webview::DownloadEvent;
use tauri::{AppHandle, Manager, Url};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};
use tauri_plugin_opener::OpenerExt;

use crate::nav::{self, Go};
use crate::Shell;

const OPEN: &str = "Open";
const SHOW: &str = "Show in folder";
const CLOSE: &str = "Close";

/// A download FITRON allows: from its own server on this computer, or a file one of its pages made (blob:).
pub fn allowed(url: &Url, port: u16) -> bool {
    match url.scheme() {
        // The start-up page bundled with the shell has nothing to download.
        "http" if url.host_str() == Some("tauri.localhost") => false,
        "http" | "blob" => matches!(nav::decide(url, port), Go::Inside),
        _ => false,
    }
}

/// The file's name and the folder it is in, as the message shows them.
pub fn describe(path: &Path) -> (String, String) {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string());
    let folder = path.parent().map(|p| p.display().to_string()).unwrap_or_default();
    (name, folder)
}

fn log(app: &AppHandle, s: &str) {
    app.state::<Shell>().log.line(s);
}

/// The webview's download hook. Returns whether the download may go ahead.
pub fn handle(app: &AppHandle, port: u16, event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { url, destination } => {
            if !allowed(&url, port) {
                log(app, &format!("refused a download from a {} address", url.scheme()));
                return false;
            }
            log(app, &format!("download started: {}", describe(destination).0));
            true
        }
        DownloadEvent::Finished { path, success, .. } => {
            match (success, path) {
                (true, Some(path)) => saved(app, path),
                (true, None) => {
                    log(app, "download finished");
                    app.dialog().message("The file was saved in your Downloads folder.").title("Downloaded").kind(MessageDialogKind::Info).show(|_| {});
                }
                (false, _) => {
                    log(app, "download did not finish");
                    app.dialog().message("The download did not finish, so the file was not saved. Try again.").title("Download").kind(MessageDialogKind::Warning).show(|_| {});
                }
            }
            true
        }
        _ => true,
    }
}

fn saved(app: &AppHandle, path: std::path::PathBuf) {
    let (name, folder) = describe(&path);
    log(app, &format!("download saved: {name}"));
    let handle = app.clone();
    app.dialog()
        .message(format!("{name}\n\nSaved in {folder}"))
        .title("Downloaded")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::YesNoCancelCustom(OPEN.into(), SHOW.into(), CLOSE.into()))
        .show_with_result(move |answer| {
            let pressed = match answer {
                MessageDialogResult::Custom(label) => label,
                MessageDialogResult::Yes => OPEN.into(),
                MessageDialogResult::No => SHOW.into(),
                _ => return,
            };
            let done = if pressed == OPEN {
                handle.opener().open_path(path.display().to_string(), None::<&str>)
            } else if pressed == SHOW {
                handle.opener().reveal_item_in_dir(&path)
            } else {
                return;
            };
            if let Err(e) = done {
                log(&handle, &format!("could not open the downloaded file: {e}"));
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(s: &str, port: u16) -> bool {
        allowed(&Url::parse(s).unwrap(), port)
    }

    #[test]
    fn only_fitrons_own_pages_may_download() {
        assert!(ok("http://127.0.0.1:4242/invoices/abc/pdf", 4242));
        assert!(ok("blob:http://127.0.0.1:4242/0b1c2d3e-aaaa-bbbb-cccc-000000000000", 4242));
        assert!(!ok("http://127.0.0.1:9999/invoices/abc/pdf", 4242), "another program on this computer");
        assert!(!ok("https://example.com/setup.exe", 4242), "a website");
        assert!(!ok("http://tauri.localhost/index.html", 4242), "the start-up page");
        assert!(!ok("data:application/pdf;base64,AAAA", 4242));
        assert!(!ok("blob:https://example.com/0b1c2d3e", 4242));
    }

    #[test]
    fn says_the_files_name_and_folder() {
        let (name, folder) = describe(Path::new("/home/a/Downloads/INV-2026-00012.pdf"));
        assert_eq!(name, "INV-2026-00012.pdf");
        assert_eq!(folder, "/home/a/Downloads");
    }
}
