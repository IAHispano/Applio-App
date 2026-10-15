fn main() {
    let manifest = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let font = manifest.join("../../../assets/fonts/Syne-Variable.ttf");
    let destination = manifest.join("../ui/Syne-Variable.ttf");
    println!("cargo:rerun-if-changed={}", font.display());
    let bytes = std::fs::read(font).expect("missing Applio splash font");
    if std::fs::read(&destination).ok().as_deref() != Some(bytes.as_slice()) {
        std::fs::write(destination, bytes).expect("could not stage Applio splash font");
    }
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
