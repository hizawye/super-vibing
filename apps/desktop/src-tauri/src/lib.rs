use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};
use tauri::{ipc::Channel, State};
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

struct PaneRuntime {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send>>,
}

struct AppState {
    panes: Arc<RwLock<HashMap<String, Arc<PaneRuntime>>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            panes: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpawnPaneRequest {
    pane_id: Option<String>,
    cwd: Option<String>,
    shell: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpawnPaneResponse {
    pane_id: String,
    cwd: String,
    shell: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteInputRequest {
    pane_id: String,
    data: String,
    execute: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResizePaneRequest {
    pane_id: String,
    rows: u16,
    cols: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClosePaneRequest {
    pane_id: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PtyEvent {
    pane_id: String,
    kind: String,
    payload: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateWorktreeRequest {
    repo_root: String,
    branch: String,
    base_branch: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListWorktreesRequest {
    repo_root: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BranchRequest {
    cwd: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspaceTab {
    id: String,
    repo_root: String,
    branch: String,
    worktree_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlobalCommandRequest {
    pane_ids: Vec<String>,
    command: String,
    execute: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PaneCommandResult {
    pane_id: String,
    ok: bool,
    error: Option<String>,
}

#[tauri::command]
fn get_default_cwd() -> Result<String, String> {
    let cwd = env::current_dir().map_err(|err| err.to_string())?;
    Ok(cwd.to_string_lossy().to_string())
}

#[tauri::command]
fn get_current_branch(request: BranchRequest) -> Result<String, String> {
    resolve_branch(&request.cwd)
}

#[tauri::command]
async fn spawn_pane(
    state: State<'_, AppState>,
    request: SpawnPaneRequest,
    output: Channel<PtyEvent>,
) -> Result<SpawnPaneResponse, String> {
    let pane_id = request
        .pane_id
        .unwrap_or_else(|| format!("pane-{}", Uuid::new_v4()));
    let rows = request.rows.unwrap_or(40);
    let cols = request.cols.unwrap_or(120);
    let cwd = normalize_cwd(request.cwd)?;
    let shell = request.shell.unwrap_or_else(default_shell);

    {
        let panes = state.panes.read().await;
        if panes.contains_key(&pane_id) {
            return Err(format!("pane `{pane_id}` already exists"));
        }
    }

    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| format!("failed to open pty: {err}"))?;

    let mut command = CommandBuilder::new(shell.clone());
    command.cwd(PathBuf::from(&cwd));

    let child = pty_pair
        .slave
        .spawn_command(command)
        .map_err(|err| format!("failed to spawn process: {err}"))?;

    let mut reader = pty_pair
        .master
        .try_clone_reader()
        .map_err(|err| format!("failed to clone pty reader: {err}"))?;
    let writer = pty_pair
        .master
        .take_writer()
        .map_err(|err| format!("failed to acquire pty writer: {err}"))?;

    let pane_runtime = Arc::new(PaneRuntime {
        writer: Mutex::new(writer),
        master: Mutex::new(pty_pair.master),
        child: Mutex::new(child),
    });

    {
        let mut panes = state.panes.write().await;
        panes.insert(pane_id.clone(), pane_runtime);
    }

    let pane_registry = Arc::clone(&state.panes);
    let pane_id_for_task = pane_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = output.send(PtyEvent {
                        pane_id: pane_id_for_task.clone(),
                        kind: "exit".to_string(),
                        payload: "eof".to_string(),
                    });
                    break;
                }
                Ok(bytes_read) => {
                    let chunk = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();
                    if output
                        .send(PtyEvent {
                            pane_id: pane_id_for_task.clone(),
                            kind: "output".to_string(),
                            payload: chunk,
                        })
                        .is_err()
                    {
                        break;
                    }
                }
                Err(err) => {
                    let _ = output.send(PtyEvent {
                        pane_id: pane_id_for_task.clone(),
                        kind: "error".to_string(),
                        payload: err.to_string(),
                    });
                    break;
                }
            }
        }

        if let Ok(mut panes) = pane_registry.try_write() {
            panes.remove(&pane_id_for_task);
        }
    });

    Ok(SpawnPaneResponse {
        pane_id,
        cwd,
        shell,
    })
}

#[tauri::command]
async fn write_pane_input(state: State<'_, AppState>, request: WriteInputRequest) -> Result<(), String> {
    let pane = {
        let panes = state.panes.read().await;
        panes
            .get(&request.pane_id)
            .cloned()
            .ok_or_else(|| format!("pane `{}` does not exist", request.pane_id))?
    };

    let mut writer = pane.writer.lock().await;
    writer
        .write_all(request.data.as_bytes())
        .map_err(|err| format!("failed to write input: {err}"))?;
    if request.execute.unwrap_or(false) {
        writer
            .write_all(b"\n")
            .map_err(|err| format!("failed to write newline: {err}"))?;
    }
    writer
        .flush()
        .map_err(|err| format!("failed to flush pane writer: {err}"))?;

    Ok(())
}

#[tauri::command]
async fn resize_pane(state: State<'_, AppState>, request: ResizePaneRequest) -> Result<(), String> {
    let pane = {
        let panes = state.panes.read().await;
        panes
            .get(&request.pane_id)
            .cloned()
            .ok_or_else(|| format!("pane `{}` does not exist", request.pane_id))?
    };

    let master = pane.master.lock().await;
    master
        .resize(PtySize {
            rows: request.rows,
            cols: request.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| format!("failed to resize pty: {err}"))
}

#[tauri::command]
async fn close_pane(state: State<'_, AppState>, request: ClosePaneRequest) -> Result<(), String> {
    let pane = {
        let mut panes = state.panes.write().await;
        panes
            .remove(&request.pane_id)
            .ok_or_else(|| format!("pane `{}` does not exist", request.pane_id))?
    };

    let mut child = pane.child.lock().await;
    child
        .kill()
        .map_err(|err| format!("failed to kill pane process: {err}"))
}

#[tauri::command]
async fn run_global_command(
    state: State<'_, AppState>,
    request: GlobalCommandRequest,
) -> Result<Vec<PaneCommandResult>, String> {
    let mut results = Vec::with_capacity(request.pane_ids.len());

    for pane_id in request.pane_ids {
        let pane = {
            let panes = state.panes.read().await;
            panes.get(&pane_id).cloned()
        };

        let Some(pane) = pane else {
            results.push(PaneCommandResult {
                pane_id,
                ok: false,
                error: Some("pane not found".to_string()),
            });
            continue;
        };

        let mut writer = pane.writer.lock().await;
        let write_result = (|| -> Result<(), String> {
            writer
                .write_all(request.command.as_bytes())
                .map_err(|err| err.to_string())?;
            if request.execute {
                writer.write_all(b"\n").map_err(|err| err.to_string())?;
            }
            writer.flush().map_err(|err| err.to_string())?;
            Ok(())
        })();

        match write_result {
            Ok(()) => results.push(PaneCommandResult {
                pane_id,
                ok: true,
                error: None,
            }),
            Err(err) => results.push(PaneCommandResult {
                pane_id,
                ok: false,
                error: Some(err),
            }),
        }
    }

    Ok(results)
}

#[tauri::command]
fn create_worktree(request: CreateWorktreeRequest) -> Result<WorkspaceTab, String> {
    if request.branch.trim().is_empty() {
        return Err("branch is required".to_string());
    }

    let repo_root = PathBuf::from(&request.repo_root);
    if !repo_root.exists() {
        return Err(format!(
            "repo root does not exist: {}",
            repo_root.to_string_lossy()
        ));
    }

    let worktrees_root = repo_root.join(".worktrees");
    fs::create_dir_all(&worktrees_root)
        .map_err(|err| format!("failed to create worktrees dir: {err}"))?;

    let worktree_path = worktrees_root.join(sanitize_branch_segment(&request.branch));

    let branch_exists = Command::new("git")
        .arg("-C")
        .arg(&request.repo_root)
        .arg("show-ref")
        .arg("--verify")
        .arg("--quiet")
        .arg(format!("refs/heads/{}", request.branch))
        .status()
        .map_err(|err| format!("failed to inspect branches: {err}"))?
        .success();

    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(&request.repo_root)
        .arg("worktree")
        .arg("add");

    if branch_exists {
        command.arg(&worktree_path).arg(&request.branch);
    } else {
        let base_branch = request.base_branch.unwrap_or_else(|| "HEAD".to_string());
        command
            .arg("-b")
            .arg(&request.branch)
            .arg(&worktree_path)
            .arg(base_branch);
    }

    let output = command
        .output()
        .map_err(|err| format!("failed to run git worktree add: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("git worktree add failed: {stderr}"));
    }

    Ok(WorkspaceTab {
        id: Uuid::new_v4().to_string(),
        repo_root: request.repo_root,
        branch: request.branch,
        worktree_path: worktree_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn list_worktrees(request: ListWorktreesRequest) -> Result<Vec<WorkspaceTab>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&request.repo_root)
        .arg("worktree")
        .arg("list")
        .arg("--porcelain")
        .output()
        .map_err(|err| format!("failed to run git worktree list: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("git worktree list failed: {stderr}"));
    }

    let parsed = parse_worktree_porcelain(&String::from_utf8_lossy(&output.stdout), &request.repo_root);
    Ok(parsed)
}

fn parse_worktree_porcelain(stdout: &str, repo_root: &str) -> Vec<WorkspaceTab> {
    let mut tabs = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_branch = String::from("detached");

    for line in stdout.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(prev_path) = current_path.take() {
                tabs.push(WorkspaceTab {
                    id: Uuid::new_v4().to_string(),
                    repo_root: repo_root.to_string(),
                    branch: current_branch.clone(),
                    worktree_path: prev_path,
                });
            }
            current_path = Some(path.to_string());
            current_branch = String::from("detached");
            continue;
        }

        if let Some(branch) = line.strip_prefix("branch refs/heads/") {
            current_branch = branch.to_string();
        }
    }

    if let Some(path) = current_path {
        tabs.push(WorkspaceTab {
            id: Uuid::new_v4().to_string(),
            repo_root: repo_root.to_string(),
            branch: current_branch,
            worktree_path: path,
        });
    }

    tabs
}

fn normalize_cwd(cwd: Option<String>) -> Result<String, String> {
    match cwd {
        Some(cwd) if !cwd.trim().is_empty() => {
            let path = PathBuf::from(cwd);
            if path.exists() {
                Ok(path.to_string_lossy().to_string())
            } else {
                Err(format!("cwd does not exist: {}", path.to_string_lossy()))
            }
        }
        _ => {
            let path = env::current_dir().map_err(|err| err.to_string())?;
            Ok(path.to_string_lossy().to_string())
        }
    }
}

fn default_shell() -> String {
    if cfg!(target_os = "windows") {
        "cmd.exe".to_string()
    } else {
        env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

fn sanitize_branch_segment(branch: &str) -> String {
    branch
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

fn resolve_branch(cwd: &str) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(Path::new(cwd))
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .output()
        .map_err(|err| format!("failed to run git rev-parse: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "not a git repository".to_string()
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_default_cwd,
            get_current_branch,
            spawn_pane,
            write_pane_input,
            resize_pane,
            close_pane,
            run_global_command,
            create_worktree,
            list_worktrees
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
