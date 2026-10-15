fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "window_action",
            "bridge_command",
            "choose_folder",
            "restart_after_setup",
            "notify_job",
            "set_passthrough_hotkey",
            "report_realtime_state",
            "updater_command",
            "retry_startup",
            "startup_error",
        ]),
    ))
    .expect("failed to build Tauri application");
}
