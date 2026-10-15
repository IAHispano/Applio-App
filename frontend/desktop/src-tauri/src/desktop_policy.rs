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
