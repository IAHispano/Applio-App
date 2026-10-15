//! Turn off native browser chrome as well as the injected keyboard defaults.
pub const SCRIPT: &str = include_str!("desktop-policy.js");

pub fn apply(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    #[cfg(windows)]
    window.with_webview(|webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows_core::Interface;
        let result: windows_core::Result<()> = unsafe {
            (|| {
                let settings = webview.controller().CoreWebView2()?.Settings()?;
                settings.SetAreDevToolsEnabled(false)?;
                settings.SetAreDefaultContextMenusEnabled(false)?;
                settings
                    .cast::<ICoreWebView2Settings3>()?
                    .SetAreBrowserAcceleratorKeysEnabled(false)?;
                Ok(())
            })()
        };
        if let Err(error) = result {
            eprintln!("Could not disable native browser commands: {error}");
        }
    })?;
    #[cfg(not(windows))]
    let _ = window;
    Ok(())
}

/// WebKit applies navigation policy to subframes too. TensorBoard runs on its
/// own loopback origin; permitting its frame does not grant native capabilities.
pub fn navigation_allowed(url: &tauri::Url, tensorboard_port: u16) -> bool {
    url.as_str() == "about:blank"
        || url.scheme() == "tauri"
        || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
        || url.origin().ascii_serialization() == "http://127.0.0.1:3000"
        || (url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.port_or_known_default() == Some(tensorboard_port))
}

#[cfg(test)]
mod checks {
    use super::*;

    #[test]
    fn tensorboard_frames_are_allowed_without_opening_unrelated_origins() {
        for url in [
            "about:blank",
            "tauri://localhost/index.html",
            "http://tauri.localhost/",
            "http://127.0.0.1:3000/tensorboard",
            "http://127.0.0.1:6007/",
            "http://127.0.0.1:6007/#scalars",
        ] {
            assert!(navigation_allowed(&url.parse().unwrap(), 6007), "{url}");
        }
        for url in [
            "http://127.0.0.1:8000/",
            "http://127.0.0.1:6006/",
            "http://localhost:6007/",
            "https://127.0.0.1:6007/",
            "http://127.0.0.1.example.com:6007/",
            "https://example.com/",
            "file:///etc/passwd",
        ] {
            assert!(!navigation_allowed(&url.parse().unwrap(), 6007), "{url}");
        }
        assert!(navigation_allowed(
            &"http://127.0.0.1:45678/".parse().unwrap(),
            45678
        ));
        assert!(!navigation_allowed(
            &"http://127.0.0.1:6007/".parse().unwrap(),
            45678
        ));
        let capabilities: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/desktop.json")).unwrap();
        assert_eq!(
            capabilities["remote"]["urls"],
            serde_json::json!(["http://127.0.0.1:3000/*"])
        );
    }
}
