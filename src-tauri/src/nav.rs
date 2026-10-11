//! Where FITRON's window may go. FITRON itself (the server on 127.0.0.1 and the shell's own start-up page) opens inside
//! the window; a website (WhatsApp chats, Razorpay, FITRON's support pages) and email or phone links open in the
//! computer's own browser or mail program; anything else is refused.

use url::Url;

#[derive(Debug, PartialEq)]
pub enum Go {
    /// Open in FITRON's window.
    Inside,
    /// Hand to the computer's default program.
    Outside,
    /// Refuse.
    Nowhere,
}

/// `port` is the FITRON server's (0 before it has started).
pub fn decide(url: &Url, port: u16) -> Go {
    match url.scheme() {
        // The start-up page bundled with the shell: tauri://localhost (Linux, macOS), http://tauri.localhost (Windows).
        "tauri" if url.host_str() == Some("localhost") => Go::Inside,
        "http" if url.host_str() == Some("tauri.localhost") => Go::Inside,
        "http" if port != 0 && url.port() == Some(port) && matches!(url.host_str(), Some("127.0.0.1") | Some("localhost")) => Go::Inside,
        // A file FITRON made in the page (a CSV or a PDF) has FITRON's own address inside.
        "blob" => match Url::parse(url.path()) {
            Ok(inner) if inner.scheme() == "http" => decide(&inner, port),
            _ => Go::Nowhere,
        },
        "about" if url.as_str() == "about:blank" => Go::Inside,
        "https" | "mailto" | "tel" => Go::Outside,
        _ => Go::Nowhere,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str, port: u16) -> Go {
        decide(&Url::parse(s).unwrap(), port)
    }

    #[test]
    fn fitron_opens_inside() {
        assert_eq!(at("http://127.0.0.1:51234/dashboard", 51234), Go::Inside);
        assert_eq!(at("http://localhost:51234/invoices/abc/pdf", 51234), Go::Inside);
        assert_eq!(at("tauri://localhost/index.html", 0), Go::Inside);
        assert_eq!(at("http://tauri.localhost/index.html", 0), Go::Inside);
        assert_eq!(at("blob:http://127.0.0.1:51234/6f1c2a", 51234), Go::Inside);
        assert_eq!(at("about:blank", 51234), Go::Inside);
    }

    #[test]
    fn another_program_on_this_computer_is_not_fitron() {
        assert_eq!(at("http://127.0.0.1:8080/", 51234), Go::Nowhere);
        assert_eq!(at("http://127.0.0.1:51234/", 0), Go::Nowhere);
        assert_eq!(at("blob:http://127.0.0.1:8080/6f1c2a", 51234), Go::Nowhere);
        assert_eq!(at("http://192.168.1.5:51234/", 51234), Go::Nowhere);
    }

    #[test]
    fn websites_mail_and_phone_open_outside() {
        assert_eq!(at("https://wa.me/919876543210?text=hi", 51234), Go::Outside);
        assert_eq!(at("https://fitron.in/contact", 51234), Go::Outside);
        assert_eq!(at("mailto:support@fitron.in", 51234), Go::Outside);
        assert_eq!(at("tel:+919876543210", 51234), Go::Outside);
    }

    #[test]
    fn everything_else_is_refused() {
        for s in ["http://example.com/", "file:///C:/Windows/System32/", "javascript:alert(1)", "data:text/html,hi", "ftp://example.com/", "ms-settings:privacy"] {
            assert_eq!(at(s, 51234), Go::Nowhere, "{s}");
        }
    }
}
