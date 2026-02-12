use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env, fmt, fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::{ipc::Channel, State};
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

const PTY_READ_BUFFER_BYTES: usize = 4096;
const PTY_READER_STACK_BYTES: usize = 256 * 1024;

#[derive(Debug)]
enum AppError {
    Validation(String),
    Conflict(String),
    NotFound(String),
    Pty(String),
    Git(String),
    System(String),
}

impl AppError {
    fn validation(message: impl Into<String>) -> Self {
        Self::Validation(message.into())
    }

    fn conflict(message: impl Into<String>) -> Self {
        Self::Conflict(message.into())
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound(message.into())
    }

    fn pty(message: impl Into<String>) -> Self {
        Self::Pty(message.into())
    }

    fn git(message: impl Into<String>) -> Self {
        Self::Git(message.into())
    }

    fn system(message: impl Into<String>) -> Self {
        Self::System(message.into())
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Validation(message) => write!(f, "validation error: {message}"),
            Self::Conflict(message) => write!(f, "conflict error: {message}"),
            Self::NotFound(message) => write!(f, "not found error: {message}"),
            Self::Pty(message) => write!(f, "pty error: {message}"),
            Self::Git(message) => write!(f, "git error: {message}"),
            Self::System(message) => write!(f, "system error: {message}"),
        }
    }
}

struct PaneRuntime {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send>>,
    suspended: AtomicBool,
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
    init_command: Option<String>,
    execute_init: Option<bool>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SuspendPaneRequest {
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStats {
    active_panes: usize,
    suspended_panes: usize,
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

    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| AppError::pty(format!("failed to open pty: {err}")).to_string())?;

    let mut command = CommandBuilder::new(shell.clone());
    command.cwd(PathBuf::from(&cwd));

    let child = pty_pair
        .slave
        .spawn_command(command)
        .map_err(|err| AppError::pty(format!("failed to spawn process: {err}")).to_string())?;

    let mut reader = pty_pair
        .master
        .try_clone_reader()
        .map_err(|err| AppError::pty(format!("failed to clone pty reader: {err}")).to_string())?;
    let mut writer = pty_pair
        .master
        .take_writer()
        .map_err(|err| AppError::pty(format!("failed to acquire pty writer: {err}")).to_string())?;

    if let Some(init_command) = request
        .init_command
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        writer.write_all(init_command.as_bytes()).map_err(|err| {
            AppError::pty(format!("failed to write initial command: {err}")).to_string()
        })?;
        if request.execute_init.unwrap_or(false) {
            writer.write_all(b"\n").map_err(|err| {
                AppError::pty(format!("failed to write initial command newline: {err}")).to_string()
            })?;
        }
        writer.flush().map_err(|err| {
            AppError::pty(format!("failed to flush initial pane command: {err}")).to_string()
        })?;
    }

    let pane_runtime = Arc::new(PaneRuntime {
        writer: Mutex::new(writer),
        master: Mutex::new(pty_pair.master),
        child: Mutex::new(child),
        suspended: AtomicBool::new(false),
    });

    let inserted = {
        let mut panes = state.panes.write().await;
        if panes.contains_key(&pane_id) {
            false
        } else {
            panes.insert(pane_id.clone(), Arc::clone(&pane_runtime));
            true
        }
    };
    if !inserted {
        let mut child = pane_runtime.child.lock().await;
        let _ = child.kill();
        return Err(AppError::conflict(format!("pane `{pane_id}` already exists")).to_string());
    }

    let pane_registry = Arc::clone(&state.panes);
    let pane_id_for_task = pane_id.clone();
    let reader_thread = std::thread::Builder::new()
        .name(format!("pane-reader-{pane_id_for_task}"))
        .stack_size(PTY_READER_STACK_BYTES)
        .spawn(move || {
            let mut buffer = [0_u8; PTY_READ_BUFFER_BYTES];
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

            let cleanup_registry = Arc::clone(&pane_registry);
            let cleanup_pane_id = pane_id_for_task.clone();
            tauri::async_runtime::spawn(async move {
                let mut panes = cleanup_registry.write().await;
                panes.remove(&cleanup_pane_id);
            });
        });

    if let Err(err) = reader_thread {
        {
            let mut panes = state.panes.write().await;
            panes.remove(&pane_id);
        }

        let mut child = pane_runtime.child.lock().await;
        let _ = child.kill();
        return Err(
            AppError::system(format!("failed to spawn pane reader thread: {err}")).to_string(),
        );
    }

    Ok(SpawnPaneResponse {
        pane_id,
        cwd,
        shell,
    })
}

#[tauri::command]
async fn write_pane_input(
    state: State<'_, AppState>,
    request: WriteInputRequest,
) -> Result<(), String> {
    let pane = {
        let panes = state.panes.read().await;
        panes.get(&request.pane_id).cloned().ok_or_else(|| {
            AppError::not_found(format!("pane `{}` does not exist", request.pane_id)).to_string()
        })?
    };

    let mut writer = pane.writer.lock().await;
    writer
        .write_all(request.data.as_bytes())
        .map_err(|err| AppError::pty(format!("failed to write input: {err}")).to_string())?;
    if request.execute.unwrap_or(false) {
        writer
            .write_all(b"\n")
            .map_err(|err| AppError::pty(format!("failed to write newline: {err}")).to_string())?;
    }
    writer
        .flush()
        .map_err(|err| AppError::pty(format!("failed to flush pane writer: {err}")).to_string())?;

    Ok(())
}

#[tauri::command]
async fn resize_pane(state: State<'_, AppState>, request: ResizePaneRequest) -> Result<(), String> {
    let pane = {
        let panes = state.panes.read().await;
        panes.get(&request.pane_id).cloned().ok_or_else(|| {
            AppError::not_found(format!("pane `{}` does not exist", request.pane_id)).to_string()
        })?
    };

    let master = pane.master.lock().await;
    master
        .resize(PtySize {
            rows: request.rows,
            cols: request.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| AppError::pty(format!("failed to resize pty: {err}")).to_string())
}

#[tauri::command]
async fn close_pane(state: State<'_, AppState>, request: ClosePaneRequest) -> Result<(), String> {
    let pane = {
        let mut panes = state.panes.write().await;
        panes.remove(&request.pane_id).ok_or_else(|| {
            AppError::not_found(format!("pane `{}` does not exist", request.pane_id)).to_string()
        })?
    };

    let mut child = pane.child.lock().await;
    child
        .kill()
        .map_err(|err| AppError::pty(format!("failed to kill pane process: {err}")).to_string())
}

#[cfg(unix)]
fn signal_process(pid: u32, signal: i32) -> Result<(), String> {
    let status = unsafe { libc::kill(pid as libc::pid_t, signal) };
    if status == 0 {
        Ok(())
    } else {
        Err(AppError::system(format!(
            "failed to signal process {pid}: {}",
            std::io::Error::last_os_error()
        ))
        .to_string())
    }
}

#[tauri::command]
async fn suspend_pane(
    state: State<'_, AppState>,
    request: SuspendPaneRequest,
) -> Result<(), String> {
    let pane = {
        let panes = state.panes.read().await;
        panes.get(&request.pane_id).cloned().ok_or_else(|| {
            AppError::not_found(format!("pane `{}` does not exist", request.pane_id)).to_string()
        })?
    };

    let pid = {
        let child = pane.child.lock().await;
        child.process_id().ok_or_else(|| {
            AppError::system(format!("pane `{}` has no process id", request.pane_id)).to_string()
        })?
    };

    #[cfg(unix)]
    {
        signal_process(pid, libc::SIGSTOP)?;
    }
    #[cfg(not(unix))]
    {
        return Err(AppError::system("suspend is not supported on this platform").to_string());
    }

    pane.suspended.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
async fn resume_pane(
    state: State<'_, AppState>,
    request: SuspendPaneRequest,
) -> Result<(), String> {
    let pane = {
        let panes = state.panes.read().await;
        panes.get(&request.pane_id).cloned().ok_or_else(|| {
            AppError::not_found(format!("pane `{}` does not exist", request.pane_id)).to_string()
        })?
    };

    let pid = {
        let child = pane.child.lock().await;
        child.process_id().ok_or_else(|| {
            AppError::system(format!("pane `{}` has no process id", request.pane_id)).to_string()
        })?
    };

    #[cfg(unix)]
    {
        signal_process(pid, libc::SIGCONT)?;
    }
    #[cfg(not(unix))]
    {
        return Err(AppError::system("resume is not supported on this platform").to_string());
    }

    pane.suspended.store(false, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
async fn get_runtime_stats(state: State<'_, AppState>) -> Result<RuntimeStats, String> {
    let panes = state.panes.read().await;
    let suspended_panes = panes
        .values()
        .filter(|pane| pane.suspended.load(Ordering::Relaxed))
        .count();
    Ok(RuntimeStats {
        active_panes: panes.len(),
        suspended_panes,
    })
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.request_restart();
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

        if pane.suspended.load(Ordering::Relaxed) {
            results.push(PaneCommandResult {
                pane_id,
                ok: false,
                error: Some("pane is suspended".to_string()),
            });
            continue;
        }

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
        return Err(AppError::validation("branch is required").to_string());
    }

    let repo_root = PathBuf::from(&request.repo_root);
    if !repo_root.exists() {
        return Err(AppError::validation(format!(
            "repo root does not exist: {}",
            repo_root.to_string_lossy()
        ))
        .to_string());
    }

    let worktrees_root = repo_root.join(".worktrees");
    fs::create_dir_all(&worktrees_root).map_err(|err| {
        AppError::system(format!("failed to create worktrees dir: {err}")).to_string()
    })?;

    let worktree_path = worktrees_root.join(sanitize_branch_segment(&request.branch));

    let branch_exists = Command::new("git")
        .arg("-C")
        .arg(&request.repo_root)
        .arg("show-ref")
        .arg("--verify")
        .arg("--quiet")
        .arg(format!("refs/heads/{}", request.branch))
        .status()
        .map_err(|err| AppError::git(format!("failed to inspect branches: {err}")).to_string())?
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

    let output = command.output().map_err(|err| {
        AppError::git(format!("failed to run git worktree add: {err}")).to_string()
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::git(format!("git worktree add failed: {stderr}")).to_string());
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
        .map_err(|err| {
            AppError::git(format!("failed to run git worktree list: {err}")).to_string()
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::git(format!("git worktree list failed: {stderr}")).to_string());
    }

    let parsed =
        parse_worktree_porcelain(&String::from_utf8_lossy(&output.stdout), &request.repo_root);
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_branch_segment_replaces_invalid_characters() {
        let sanitized = sanitize_branch_segment("feature/abc@123");
        assert_eq!(sanitized, "feature-abc-123");
    }

    #[test]
    fn parse_worktree_porcelain_parses_branch_and_detached_entries() {
        let input = "\
worktree /repo
HEAD abc123
branch refs/heads/main

worktree /repo/.worktrees/feature-abc
HEAD def456
detached
";

        let tabs = parse_worktree_porcelain(input, "/repo");
        assert_eq!(tabs.len(), 2);
        assert_eq!(tabs[0].worktree_path, "/repo");
        assert_eq!(tabs[0].branch, "main");
        assert_eq!(tabs[1].worktree_path, "/repo/.worktrees/feature-abc");
        assert_eq!(tabs[1].branch, "detached");
    }

    #[test]
    fn normalize_cwd_rejects_missing_path() {
        let missing = format!("/tmp/super-vibing-missing-{}", Uuid::new_v4());
        let err = normalize_cwd(Some(missing)).expect_err("missing path should fail");
        assert!(err.contains("cwd does not exist"));
    }

    #[test]
    fn normalize_cwd_accepts_existing_path() {
        let dir = std::env::temp_dir().join(format!("super-vibing-cwd-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("create temp dir");

        let resolved = normalize_cwd(Some(dir.to_string_lossy().to_string())).expect("valid cwd");
        assert_eq!(resolved, dir.to_string_lossy().to_string());

        fs::remove_dir_all(&dir).expect("cleanup temp dir");
    }
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_default_cwd,
            get_current_branch,
            spawn_pane,
            write_pane_input,
            resize_pane,
            close_pane,
            suspend_pane,
            resume_pane,
            run_global_command,
            get_runtime_stats,
            restart_app,
            create_worktree,
            list_worktrees
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
