// [START] Phase 8 — Code IDE file system commands.
// Project-scoped file I/O for the Code pane. Unlike read_md_file which is
// restricted to .md files, these commands work with any file type but enforce
// that all paths resolve to descendants of the user-selected project root.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

const MAX_FILE_BYTES: u64 = 5_000_000; // 5 MB cap
const MAX_TREE_DEPTH: usize = 10;

// Directories to skip during tree listing — keeps the tree fast and relevant.
const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "__pycache__",
    ".DS_Store",
    ".next",
    ".nuxt",
    "dist",
    "build",
    "target",
    ".venv",
    "venv",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
];

// ── Security helper ─────────────────────────────────────────────────────────

/// Resolve `child` relative to `root` and verify the canonical path is a
/// descendant of `root`. Returns the canonical path or an error.
///
/// [Phase 8.4] When the target file AND any intermediate directories don't
/// exist yet (common case: agent wants to write `src/components/Button.tsx`
/// into a fresh project with only the root), walk up the joined path until
/// we find an existing ancestor, canonicalize THAT, then re-append the
/// still-missing suffix. The caller (write_file / create_file) is
/// responsible for `create_dir_all` on the missing prefix — our job is just
/// to confirm the final path stays under the project root.
fn safe_resolve(root: &str, child: &str) -> Result<PathBuf, String> {
    let root_canon = fs::canonicalize(root)
        .map_err(|e| format!("invalid project root {root}: {e}"))?;
    let joined = root_canon.join(child);
    let resolved = if joined.exists() {
        fs::canonicalize(&joined)
            .map_err(|e| format!("cannot resolve {child}: {e}"))?
    } else {
        let mut existing: PathBuf = joined.clone();
        let mut suffix: Vec<std::ffi::OsString> = Vec::new();
        while !existing.exists() {
            match existing.file_name() {
                Some(name) => suffix.push(name.to_owned()),
                None => return Err(format!("invalid path {child}")),
            }
            existing = match existing.parent() {
                Some(p) => p.to_path_buf(),
                None => return Err(format!("no existing ancestor for {child}")),
            };
        }
        let mut canon = fs::canonicalize(&existing)
            .map_err(|e| format!("cannot resolve ancestor for {child}: {e}"))?;
        for seg in suffix.iter().rev() {
            canon = canon.join(seg);
        }
        canon
    };
    if !resolved.starts_with(&root_canon) {
        return Err(format!("path traversal denied: {child}"));
    }
    Ok(resolved)
}

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct FileTreeNode {
    pub path: String,        // relative to project root
    pub name: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub modified_at: u64,    // epoch ms
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileTreeNode>>,
}

#[derive(Debug, Serialize)]
pub struct FileReadResult {
    pub path: String,
    pub content: String,
    pub size_bytes: u64,
    pub encoding: String, // "utf8" | "base64"
}

// ── Tree builder ─────────────────────────────────────────────────────────────

fn build_tree(dir: &Path, root: &Path, depth: usize) -> Vec<FileTreeNode> {
    if depth > MAX_TREE_DEPTH {
        return vec![];
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return vec![],
    };

    let mut nodes: Vec<FileTreeNode> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/dirs starting with . (except .ovo)
        if name.starts_with('.') && name != ".ovo" {
            continue;
        }
        // Skip known noisy directories
        if path.is_dir() && SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }

        let meta = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let relative = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();

        if meta.is_dir() {
            let children = build_tree(&path, root, depth + 1);
            nodes.push(FileTreeNode {
                path: relative,
                name,
                is_dir: true,
                size_bytes: 0,
                modified_at,
                children: Some(children),
            });
        } else {
            nodes.push(FileTreeNode {
                path: relative,
                name,
                is_dir: false,
                size_bytes: meta.len(),
                modified_at,
                children: None,
            });
        }
    }

    // Sort: directories first, then alphabetical
    nodes.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    nodes
}

// ── Tauri commands ───────────────────────────────────────────────────────────

/// List the file tree under `project_root` recursively (max depth 10).
#[tauri::command]
pub fn code_fs_list_tree(project_root: String) -> Result<Vec<FileTreeNode>, String> {
    let root = fs::canonicalize(&project_root)
        .map_err(|e| format!("invalid project root: {e}"))?;
    if !root.is_dir() {
        return Err(format!("not a directory: {project_root}"));
    }
    Ok(build_tree(&root, &root, 0))
}

/// Read a file under `project_root`. Returns content as UTF-8 or base64.
#[tauri::command]
pub fn code_fs_read_file(
    project_root: String,
    path: String,
) -> Result<FileReadResult, String> {
    let resolved = safe_resolve(&project_root, &path)?;
    if !resolved.is_file() {
        return Err(format!("not a file: {path}"));
    }
    let meta = fs::metadata(&resolved)
        .map_err(|e| format!("cannot stat {path}: {e}"))?;
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!(
            "file too large ({} bytes, max {})",
            meta.len(),
            MAX_FILE_BYTES
        ));
    }

    let bytes = fs::read(&resolved)
        .map_err(|e| format!("cannot read {path}: {e}"))?;

    // Try UTF-8 first; reject binary files (images, compiled, etc.)
    // with an explicit error — Monaco can't edit them anyway.
    let (content, encoding) = match String::from_utf8(bytes) {
        Ok(s) => (s, "utf8".to_string()),
        Err(_) => {
            return Err(format!("binary file cannot be opened as text: {path}"));
        }
    };

    Ok(FileReadResult {
        path,
        content,
        size_bytes: meta.len(),
        encoding,
    })
}

// [START] Phase 5 — Read a file OUTSIDE the current project root.
// Used exclusively for files the user has explicitly attached to the
// agent conversation (the frontend maintains a whitelist and only routes
// whitelisted absolute paths through this command). We don't do scope
// validation here — that's the caller's job — but we still enforce:
//   * absolute path (relative paths would be root-less and ambiguous)
//   * file exists and is regular
//   * size <= MAX_FILE_BYTES (5 MB)
//   * UTF-8 decodable (binary attachments are rejected with a clear error)
// The command is narrow by design so a bug here can't clobber arbitrary
// filesystem state.
/// [START] Phase 5 — Rust-side attachment whitelist.
/// The frontend maintains a list of user-attached file paths and only
/// routes those through this command, but that check is defeated if a
/// renderer bug / XSS lets someone invoke the Tauri command directly
/// with an arbitrary path. We mirror the whitelist in Rust state so
/// nothing reads from disk unless the path was registered via the
/// explicit attachment flow.
use std::sync::Mutex;
pub struct AttachmentWhitelist(pub Mutex<std::collections::HashSet<PathBuf>>);
impl AttachmentWhitelist {
    pub fn new() -> Self {
        Self(Mutex::new(std::collections::HashSet::new()))
    }
}

#[tauri::command]
pub fn attachment_whitelist_register(
    state: tauri::State<'_, AttachmentWhitelist>,
    path: String,
) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() {
        return Err(format!("whitelist requires absolute path: {path}"));
    }
    let canonical = p.canonicalize().map_err(|e| format!("cannot resolve {path}: {e}"))?;
    state.0.lock().map_err(|e| e.to_string())?.insert(canonical);
    Ok(())
}
#[tauri::command]
pub fn attachment_whitelist_clear(
    state: tauri::State<'_, AttachmentWhitelist>,
) -> Result<(), String> {
    state.0.lock().map_err(|e| e.to_string())?.clear();
    Ok(())
}
/// [END]

#[tauri::command]
pub fn code_fs_read_external_file(
    state: tauri::State<'_, AttachmentWhitelist>,
    path: String,
) -> Result<FileReadResult, String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() {
        return Err(format!("external read requires absolute path: {path}"));
    }
    let canonical = p
        .canonicalize()
        .map_err(|e| format!("cannot resolve {path}: {e}"))?;
    // [START] Phase 5 — whitelist gate.
    let whitelist = state.0.lock().map_err(|e| e.to_string())?;
    if !whitelist.contains(&canonical) {
        return Err(format!(
            "path not in attachment whitelist (register via the UI attachment flow first): {path}"
        ));
    }
    drop(whitelist);
    // [END]
    if !canonical.is_file() {
        return Err(format!("not a file: {path}"));
    }
    let meta = fs::metadata(&canonical)
        .map_err(|e| format!("cannot stat {path}: {e}"))?;
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!(
            "file too large ({} bytes, max {})",
            meta.len(),
            MAX_FILE_BYTES
        ));
    }
    let bytes = fs::read(&canonical)
        .map_err(|e| format!("cannot read {path}: {e}"))?;
    let content = match String::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => {
            return Err(format!("binary file cannot be opened as text: {path}"));
        }
    };
    Ok(FileReadResult {
        path,
        content,
        size_bytes: meta.len(),
        encoding: "utf8".to_string(),
    })
}
// [END]

/// Write content to a file under `project_root`. Creates parent dirs.
#[tauri::command]
pub fn code_fs_write_file(
    project_root: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let resolved = safe_resolve(&project_root, &path)?;
    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir failed for {path}: {e}"))?;
    }
    fs::write(&resolved, &content)
        .map_err(|e| format!("write failed for {path}: {e}"))?;
    Ok(())
}

/// Create a new empty file. Errors if it already exists.
#[tauri::command]
pub fn code_fs_create_file(
    project_root: String,
    path: String,
) -> Result<(), String> {
    let resolved = safe_resolve(&project_root, &path)?;
    if resolved.exists() {
        return Err(format!("already exists: {path}"));
    }
    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir failed for {path}: {e}"))?;
    }
    fs::write(&resolved, "")
        .map_err(|e| format!("create failed for {path}: {e}"))?;
    Ok(())
}

/// Rename or move a file/directory within the project root.
#[tauri::command]
pub fn code_fs_rename(
    project_root: String,
    from: String,
    to: String,
) -> Result<(), String> {
    let from_resolved = safe_resolve(&project_root, &from)?;
    let to_resolved = safe_resolve(&project_root, &to)?;
    if !from_resolved.exists() {
        return Err(format!("source not found: {from}"));
    }
    if to_resolved.exists() {
        return Err(format!("destination already exists: {to}"));
    }
    if let Some(parent) = to_resolved.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("mkdir failed for {to}: {e}"))?;
    }
    fs::rename(&from_resolved, &to_resolved)
        .map_err(|e| format!("rename failed: {e}"))?;
    Ok(())
}

/// Delete a file or directory. Non-empty directories require `force = true`.
#[tauri::command]
pub fn code_fs_delete(
    project_root: String,
    path: String,
    force: Option<bool>,
) -> Result<(), String> {
    let resolved = safe_resolve(&project_root, &path)?;
    if !resolved.exists() {
        return Err(format!("not found: {path}"));
    }
    if resolved.is_dir() {
        let is_empty = fs::read_dir(&resolved)
            .map(|mut d| d.next().is_none())
            .unwrap_or(false);
        if !is_empty && !force.unwrap_or(false) {
            return Err(format!("directory not empty: {path} (use force=true)"));
        }
        fs::remove_dir_all(&resolved)
            .map_err(|e| format!("delete dir failed for {path}: {e}"))?;
    } else {
        fs::remove_file(&resolved)
            .map_err(|e| format!("delete file failed for {path}: {e}"))?;
    }
    Ok(())
}

/// Create a directory (with parents).
#[tauri::command]
pub fn code_fs_mkdir(
    project_root: String,
    path: String,
) -> Result<(), String> {
    let resolved = safe_resolve(&project_root, &path)?;
    if resolved.exists() {
        return Err(format!("already exists: {path}"));
    }
    fs::create_dir_all(&resolved)
        .map_err(|e| format!("mkdir failed for {path}: {e}"))?;
    Ok(())
}
// ── Phase 8.3 — Search + exec ────────────────────────────────────────────────

/// [Phase 8.4] Reveal a project-relative path in the OS file manager
/// (Finder on macOS, Explorer on Windows, xdg-open dir on Linux). Used by
/// the file-explorer context menu "Reveal in Finder" action.
#[tauri::command]
pub fn code_fs_reveal(project_root: String, path: String) -> Result<(), String> {
    let resolved = safe_resolve(&project_root, &path)?;
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&resolved)
            .status()
            .map_err(|e| format!("reveal failed: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", resolved.display()))
            .status()
            .map_err(|e| format!("reveal failed: {e}"))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let dir = if resolved.is_dir() {
            resolved.clone()
        } else {
            resolved.parent().unwrap_or(&resolved).to_path_buf()
        };
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .status()
            .map_err(|e| format!("reveal failed: {e}"))?;
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct SearchMatch {
    pub path: String,
    pub line_number: u32,
    pub line_content: String,
}

/// Recursive text search (grep-like) within the project root.
/// Returns up to 500 matches. Skips binary files and SKIP_DIRS.
#[tauri::command]
pub fn code_fs_search(
    project_root: String,
    pattern: String,
    case_sensitive: Option<bool>,
) -> Result<Vec<SearchMatch>, String> {
    let root = fs::canonicalize(&project_root)
        .map_err(|e| format!("invalid project root: {e}"))?;
    let case_sensitive = case_sensitive.unwrap_or(false);
    let pattern_lower = if case_sensitive { pattern.clone() } else { pattern.to_lowercase() };

    let mut matches: Vec<SearchMatch> = Vec::new();
    search_dir(&root, &root, &pattern, &pattern_lower, case_sensitive, &mut matches, 0);
    Ok(matches)
}

fn search_dir(
    dir: &Path,
    root: &Path,
    pattern: &str,
    pattern_lower: &str,
    case_sensitive: bool,
    matches: &mut Vec<SearchMatch>,
    depth: usize,
) {
    const MAX_MATCHES: usize = 500;
    const MAX_SEARCH_DEPTH: usize = 10;

    if depth > MAX_SEARCH_DEPTH || matches.len() >= MAX_MATCHES {
        return;
    }

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        if matches.len() >= MAX_MATCHES {
            return;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if name.starts_with('.') && name != ".ovo" {
            continue;
        }
        if path.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            search_dir(&path, root, pattern, pattern_lower, case_sensitive, matches, depth + 1);
            continue;
        }

        // Skip large files (>1MB) and binary-ish extensions
        let meta = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.len() > 1_000_000 {
            continue;
        }

        let content = match fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => continue, // binary or unreadable
        };

        let relative = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();

        for (i, line) in content.lines().enumerate() {
            if matches.len() >= MAX_MATCHES {
                return;
            }
            let found = if case_sensitive {
                line.contains(pattern)
            } else {
                line.to_lowercase().contains(pattern_lower)
            };
            if found {
                matches.push(SearchMatch {
                    path: relative.clone(),
                    line_number: (i + 1) as u32,
                    line_content: if line.len() > 300 {
                        format!("{}...", &line[..300])
                    } else {
                        line.to_string()
                    },
                });
            }
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ExecResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Run a command in the project directory. The command string is passed
/// to the user's shell via -c so pipes, redirects, etc. work.
/// This is intentionally shell-based — the agent needs full shell
/// semantics (pipes, env expansion) for useful code assistance.
/// Security: scoped to the project_root as cwd; the user already has
/// full shell access via the PTY terminal in the same pane.
// [START] Phase 5 — deny-list for agent shell execution.
// The agent needs shell semantics for legitimate workflows but we reject
// the obvious exfiltration / destruction primitives. The terminal pane
// remains unscoped; deny-list only applies when the model triggers it.
fn is_denied_command(cmd: &str) -> Option<&'static str> {
    let c = cmd.trim().to_lowercase();
    if c.contains("rm -rf") || c.contains("rm -fr")
        || c.contains("rm -r -f") || c.contains("rm  -rf")
    {
        return Some("rm -rf is forbidden from the agent");
    }
    if c.contains("| sh") || c.contains("|sh")
        || c.contains("| bash") || c.contains("|bash")
        || c.contains("| zsh") || c.contains("|zsh")
    {
        return Some("piping network output into a shell is forbidden");
    }
    if c.contains(".ssh/id_") || c.contains(".aws/credentials")
        || c.contains(".gnupg") || c.contains("security find-generic-password")
        || c.contains("security unlock-keychain")
    {
        return Some("reading SSH / cloud credentials is forbidden");
    }
    if c.starts_with("sudo ") || c.starts_with("doas ") {
        return Some("sudo / root escalation is forbidden from the agent");
    }
    if c.contains("launchctl load") || c.contains("launchctl bootstrap")
        || c.contains("/library/launchagents/") || c.contains("/launchdaemons/")
    {
        return Some("installing launch agents / daemons is forbidden");
    }
    if c.contains(":(){ :|:&") || c.contains("dd if=")
        || c.contains("mkfs") || c.contains("diskutil erase")
    {
        return Some("disk-manipulation / fork-bomb commands are forbidden");
    }
    None
}
// [END]

#[tauri::command]
pub async fn code_fs_exec(
    project_root: String,
    command: String,
) -> Result<ExecResult, String> {
    use std::process::Command;

    if let Some(reason) = is_denied_command(&command) {
        return Err(format!("blocked: {reason}"));
    }

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let output = tokio::task::spawn_blocking(move || {
        Command::new(&shell)
            .args(["-c", &command])
            .current_dir(&project_root)
            .output()
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
    .map_err(|e| format!("failed to run command: {e}"))?;

    Ok(ExecResult {
        exit_code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}
// [END] Phase 8 + 8.3
