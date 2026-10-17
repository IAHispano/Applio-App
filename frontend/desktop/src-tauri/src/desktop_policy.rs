//! Turn off native browser chrome as well as the injected keyboard defaults.
pub const SCRIPT: &str = include_str!("desktop-policy.js");

pub fn apply(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    #[cfg(windows)]
    window.with_webview(|webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Settings3, ICoreWebView2Settings4,
        };
        use windows_core::Interface;
        let result: windows_core::Result<()> = unsafe {
            (|| {
                let settings = webview.controller().CoreWebView2()?.Settings()?;
                settings.SetAreDevToolsEnabled(false)?;
                settings.SetAreDefaultContextMenusEnabled(false)?;
                settings
                    .cast::<ICoreWebView2Settings3>()?
                    .SetAreBrowserAcceleratorKeysEnabled(false)?;
                let autofill = settings.cast::<ICoreWebView2Settings4>()?;
                autofill.SetIsGeneralAutofillEnabled(false)?;
                autofill.SetIsPasswordAutosaveEnabled(false)?;
                Ok(())
            })()
        };
        if let Err(error) = result {
            eprintln!("Could not disable native browser features: {error}");
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
