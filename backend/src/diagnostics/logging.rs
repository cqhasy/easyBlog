use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::Path,
    sync::{Mutex, OnceLock},
};

static LOG_FILE: OnceLock<Mutex<File>> = OnceLock::new();

pub fn init_logging(data_dir: &Path) {
    let log_dir = data_dir.join("logs");
    if fs::create_dir_all(&log_dir).is_err() {
        return;
    }
    let Ok(file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("easyblog.log"))
    else {
        return;
    };
    let _ = LOG_FILE.set(Mutex::new(file));
}

pub fn info(component: &str, message: impl AsRef<str>) {
    write("INFO", component, message.as_ref());
}

pub fn error(component: &str, message: impl AsRef<str>) {
    write("ERROR", component, message.as_ref());
}

fn write(level: &str, component: &str, message: &str) {
    let entry = format!(
        "{} [{}] [{}] {}",
        chrono::Utc::now().to_rfc3339(),
        level,
        component,
        message
    );
    eprintln!("{entry}");
    if let Some(file) = LOG_FILE.get() {
        if let Ok(mut file) = file.lock() {
            let _ = writeln!(file, "{entry}");
        }
    }
}
