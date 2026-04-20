// [START] Phase 8.2 — Git CLI wrapper commands.
// Shells out to the git binary for correctness and compatibility.
// All commands run with cwd = project_root.

use std::process::Command;

use serde::Serialize;

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct GitStatusFile {
    pub path: String,
    pub status: String,    // "M", "A", "D", "?", "R", etc.
    pub staged: bool,
}

#[derive(Debug, Serialize)]
pub struct GitStatusResult {
    pub branch: String,
    pub ahead: i32,
    pub behind: i32,
    pub files: Vec<GitStatusFile>,
}

#[derive(Debug, Serialize)]
pub struct GitLogEntry {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Serialize)]
pub struct GitBranch {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn run_git(project_root: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(project_root)
        .output()
        .map_err(|e| format!("git exec failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() {
            return Err(stderr);
        }
        return Err(format!("git exited with code {:?}", output.status.code()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// ── Tauri commands ───────────────────────────────────────────────────────────

/// Get git status (branch info + changed files).
#[tauri::command]
pub fn git_status(project_root: String) -> Result<GitStatusResult, String> {
    let raw = run_git(&project_root, &["status", "--porcelain=v1", "--branch", "-u"])?;
    let mut branch = String::new();
    let mut ahead = 0i32;
    let mut behind = 0i32;
    let mut files: Vec<GitStatusFile> = Vec::new();

    for line in raw.lines() {
        if line.starts_with("## ") {
            // ## main...origin/main [ahead 1, behind 2]
            let rest = &line[3..];
            let branch_part = rest.split("...").next().unwrap_or(rest);
            branch = branch_part.split(' ').next().unwrap_or(branch_part).to_string();
            if let Some(bracket) = rest.find('[') {
                let info = &rest[bracket..];
                if let Some(a) = info.find("ahead ") {
                    let num_str: String = info[a + 6..].chars().take_while(|c| c.is_ascii_digit()).collect();
                    ahead = num_str.parse().unwrap_or(0);
                }
                if let Some(b) = info.find("behind ") {
                    let num_str: String = info[b + 7..].chars().take_while(|c| c.is_ascii_digit()).collect();
                    behind = num_str.parse().unwrap_or(0);
                }
            }
            continue;
        }
        if line.len() < 4 {
            continue;
        }
        let index_status = line.chars().nth(0).unwrap_or(' ');
        let worktree_status = line.chars().nth(1).unwrap_or(' ');
        let path = line[3..].to_string();

        // Staged changes (index column)
        if index_status != ' ' && index_status != '?' {
            files.push(GitStatusFile {
                path: path.clone(),
                status: index_status.to_string(),
                staged: true,
            });
        }
        // Unstaged changes (worktree column)
        if worktree_status != ' ' {
            let st = if index_status == '?' { "?" } else { &worktree_status.to_string() };
            files.push(GitStatusFile {
                path,
                status: st.to_string(),
                staged: false,
            });
        }
    }

    Ok(GitStatusResult { branch, ahead, behind, files })
}

/// Get diff (optionally staged, optionally for a specific path).
#[tauri::command]
pub fn git_diff(
    project_root: String,
    path: Option<String>,
    staged: Option<bool>,
) -> Result<String, String> {
    let mut args = vec!["diff"];
    if staged.unwrap_or(false) {
        args.push("--staged");
    }
    if let Some(ref p) = path {
        args.push("--");
        args.push(p);
    }
    run_git(&project_root, &args)
}

/// Get recent commit log.
#[tauri::command]
pub fn git_log(
    project_root: String,
    limit: Option<u32>,
) -> Result<Vec<GitLogEntry>, String> {
    let n = limit.unwrap_or(50).min(200);
    let format_str = "%H|%h|%s|%an|%ad";
    let n_str = format!("-{n}");
    let raw = run_git(
        &project_root,
        &["log", &n_str, &format!("--format={format_str}"), "--date=short"],
    )?;

    let entries: Vec<GitLogEntry> = raw
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(5, '|').collect();
            if parts.len() < 5 {
                return None;
            }
            Some(GitLogEntry {
                hash: parts[0].to_string(),
                short_hash: parts[1].to_string(),
                message: parts[2].to_string(),
                author: parts[3].to_string(),
                date: parts[4].to_string(),
            })
        })
        .collect();

    Ok(entries)
}

/// Stage + commit all changes.
#[tauri::command]
pub fn git_commit(
    project_root: String,
    message: String,
) -> Result<String, String> {
    run_git(&project_root, &["add", "-A"])?;
    let output = run_git(&project_root, &["commit", "-m", &message])?;
    // Extract commit hash from first line
    let hash = output
        .lines()
        .next()
        .unwrap_or("")
        .split_whitespace()
        .nth(1)
        .unwrap_or("")
        .trim_matches(|c| c == '[' || c == ']')
        .to_string();
    Ok(hash)
}

/// List all branches (local + remote).
#[tauri::command]
pub fn git_branch_list(project_root: String) -> Result<Vec<GitBranch>, String> {
    let raw = run_git(&project_root, &["branch", "-a", "--no-color"])?;
    let branches: Vec<GitBranch> = raw
        .lines()
        .filter(|l| !l.contains("HEAD detached") && !l.contains("->"))
        .map(|line| {
            let is_current = line.starts_with('*');
            let name = line.trim_start_matches('*').trim().to_string();
            let is_remote = name.starts_with("remotes/");
            GitBranch {
                name: if is_remote {
                    name.trim_start_matches("remotes/").to_string()
                } else {
                    name
                },
                is_current,
                is_remote,
            }
        })
        .collect();
    Ok(branches)
}

/// Checkout a branch.
#[tauri::command]
pub fn git_checkout(
    project_root: String,
    branch: String,
) -> Result<(), String> {
    run_git(&project_root, &["checkout", &branch])?;
    Ok(())
}

/// Stage a specific file.
#[tauri::command]
pub fn git_stage(
    project_root: String,
    path: String,
) -> Result<(), String> {
    run_git(&project_root, &["add", &path])?;
    Ok(())
}

/// Unstage a specific file.
#[tauri::command]
pub fn git_unstage(
    project_root: String,
    path: String,
) -> Result<(), String> {
    run_git(&project_root, &["restore", "--staged", &path])?;
    Ok(())
}
// [END] Phase 8.2
