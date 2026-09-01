use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String, // "file" or "folder"
    pub size: u64,
    pub modified: String,
}

/// List directory contents. Returns JSON string.
pub fn list_dir(path: &str) -> Result<String, String> {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    let mut entries: Vec<FileEntry> = Vec::new();
    let read = std::fs::read_dir(dir).map_err(|e| format!("Read dir: {e}"))?;

    for entry in read.flatten() {
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        let kind = if meta.is_dir() { "folder" } else { "file" };
        let size = if meta.is_file() { meta.len() } else { 0 };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| {
                let dur = t.duration_since(std::time::UNIX_EPOCH).ok()?;
                let secs = dur.as_secs();
                // Simple date formatting
                Some(format!("{}", secs))
            })
            .unwrap_or_default();

        entries.push(FileEntry {
            name,
            kind: kind.to_string(),
            size,
            modified,
        });
    }

    // Sort: folders first, then alphabetical
    entries.sort_by(|a, b| {
        let ord = b.kind.cmp(&a.kind); // "folder" > "file"
        if ord == std::cmp::Ordering::Equal {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        } else {
            ord
        }
    });

    serde_json::to_string(&entries).map_err(|e| format!("Serialize: {e}"))
}

/// Read file contents as base64.
pub fn read_file_b64(path: &str) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Read: {e}"))?;
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &bytes,
    ))
}
