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

/// The embedded UI is application code; browser permission bubbles add no useful
/// choice here. OS microphone privacy still applies independently of this policy.
pub fn permission_response(
    url: Option<&tauri::Url>,
    kind: tauri::webview::PermissionKind,
) -> tauri::webview::PermissionResponse {
    use tauri::webview::{PermissionKind, PermissionResponse};
    if url.is_some_and(|url| url.origin().ascii_serialization() == "http://127.0.0.1:3000")
        && matches!(
            kind,
            PermissionKind::Microphone
                | PermissionKind::AutomaticDownloads
                | PermissionKind::Autoplay
        )
    {
        PermissionResponse::Allow
    } else {
        PermissionResponse::Deny
    }
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
    fn startup_error_page_only_receives_retry_permissions_in_the_main_window() {
        let desktop: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/desktop.json")).unwrap();
        let startup: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/startup.json")).unwrap();
        assert_eq!(desktop["local"], false);
        assert_eq!(startup["windows"], serde_json::json!(["main"]));
        assert_eq!(startup["local"], true);
        assert_eq!(
            startup["permissions"],
            serde_json::json!(["core:event:default", "allow-startup"])
        );
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            config["app"]["security"]["capabilities"],
            serde_json::json!(["desktop", "startup"])
        );
    }

    #[test]
    fn app_permissions_do_not_prompt_or_extend_to_tensorboard_and_remote_pages() {
        use tauri::webview::{PermissionKind, PermissionResponse};
        let app: tauri::Url = "http://127.0.0.1:3000/realtime".parse().unwrap();
        for kind in [
            PermissionKind::Microphone,
            PermissionKind::AutomaticDownloads,
            PermissionKind::Autoplay,
        ] {
            assert_eq!(
                permission_response(Some(&app), kind),
                PermissionResponse::Allow
            );
        }
        for kind in [
            PermissionKind::Camera,
            PermissionKind::Geolocation,
            PermissionKind::FileSystemAccess,
            PermissionKind::ClipboardRead,
            PermissionKind::Notifications,
            PermissionKind::Other,
        ] {
            assert_eq!(
                permission_response(Some(&app), kind),
                PermissionResponse::Deny
            );
        }
        for origin in [
            "http://127.0.0.1:6007/",
            "http://localhost:3000/",
            "https://example.com/",
            "http://127.0.0.1.example.com:3000/",
            "about:blank",
        ] {
            let url: tauri::Url = origin.parse().unwrap();
            assert_eq!(
                permission_response(Some(&url), PermissionKind::Microphone),
                PermissionResponse::Deny,
                "{origin}"
            );
            assert_eq!(
                permission_response(Some(&url), PermissionKind::AutomaticDownloads),
                PermissionResponse::Deny,
                "{origin}"
            );
        }
        assert_eq!(
            permission_response(None, PermissionKind::Microphone),
            PermissionResponse::Deny
        );
    }

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
