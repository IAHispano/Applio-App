use std::{fs, io::Write, path::Path, sync::Mutex};

static WRITER: Mutex<()> = Mutex::new(());

/// Keep native startup and service failures available in installed GUI builds,
/// where stderr may have no attached console. Bound logs to two 2 MB files.
pub fn write(config: &Path, message: &str) {
    let _guard = WRITER.lock().unwrap_or_else(|error| error.into_inner());
    let result = (|| -> std::io::Result<()> {
        let directory = config.join("app-logs");
        fs::create_dir_all(&directory)?;
        let log = directory.join("launcher.log");
        if fs::metadata(&log).is_ok_and(|metadata| metadata.len() >= 2 * 1024 * 1024) {
            let previous = directory.join("launcher.previous.log");
            if previous.exists() {
                fs::remove_file(&previous)?;
            }
            fs::rename(&log, previous)?;
        }
        let mut file = fs::OpenOptions::new().create(true).append(true).open(log)?;
        writeln!(file, "{} {message}", applio_api::jobs::timestamp())?;
        file.flush()
    })();
    if let Err(error) = result {
        eprintln!("Could not write launcher log: {error}; {message}");
    }
}
