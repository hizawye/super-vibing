use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env, fmt, fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        atomic::AtomicUsize,
        Mutex as StdMutex, RwLock as StdRwLock,
        Arc,
    },
    thread,
    time::Duration,
};
use tauri::{ipc::Channel, AppHandle, Emitter, State};
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};
use uuid::Uuid;

const PTY_READ_BUFFER_BYTES: usize = 4096;
const PTY_READER_STACK_BYTES: usize = 256 * 1024;
const AUTOMATION_HTTP_BIND: &str = "127.0.0.1:47631";
const AUTOMATION_HTTP_MAX_BODY_BYTES: usize = 64 * 1024;
const AUTOMATION_QUEUE_MAX: usize = 200;
const AUTOMATION_FRONTEND_TIMEOUT_MS: u64 = 20_000;

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

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
enum AutomationJobStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AutomationWorkspaceSnapshot {
    workspace_id: String,
    name: String,
    repo_root: String,
    worktree_path: String,
    runtime_pane_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncAutomationWorkspacesRequest {
    workspaces: Vec<AutomationWorkspaceSnapshot>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case", tag = "action")]
enum ExternalCommandRequest {
    CreatePanes {
        workspace_id: String,
        pane_count: u16,
    },
    CreateWorktree {
        workspace_id: String,
        mode: WorktreeCreateMode,
        branch: String,
        base_ref: Option<String>,
        open_after_create: Option<bool>,
    },
    CreateBranch {
        workspace_id: String,
        branch: String,
        base_ref: Option<String>,
        checkout: Option<bool>,
    },
    RunCommand {
        workspace_id: String,
        command: String,
        execute: Option<bool>,
    },
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AutomationJobRecord {
    job_id: String,
    status: AutomationJobStatus,
    request: ExternalCommandRequest,
    result: Option<serde_json::Value>,
    error: Option<String>,
    created_at_ms: u128,
    started_at_ms: Option<u128>,
    finished_at_ms: Option<u128>,
}

#[derive(Debug)]
struct QueuedAutomationJob {
    job_id: String,
    request: ExternalCommandRequest,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FrontendAutomationAck {
    job_id: String,
    ok: bool,
    result: Option<serde_json::Value>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutomationReportRequest {
    job_id: String,
    ok: bool,
    result: Option<serde_json::Value>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AutomationHealthResponse {
    status: String,
    bind: String,
    queued_jobs: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubmitCommandResponse {
    job_id: String,
    status: AutomationJobStatus,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case", rename_all_fields = "camelCase", tag = "action")]
enum FrontendAutomationRequest {
    CreatePanes {
        job_id: String,
        workspace_id: String,
        pane_count: u16,
    },
    ImportWorktree {
        job_id: String,
        worktree_path: String,
    },
}

impl FrontendAutomationRequest {
    fn job_id(&self) -> &str {
        match self {
            Self::CreatePanes { job_id, .. } => job_id,
            Self::ImportWorktree { job_id, .. } => job_id,
        }
    }
}

struct AutomationState {
    jobs: StdRwLock<HashMap<String, AutomationJobRecord>>,
    workspace_registry: StdRwLock<HashMap<String, AutomationWorkspaceSnapshot>>,
    queued_jobs: AtomicUsize,
    queue_tx: mpsc::UnboundedSender<QueuedAutomationJob>,
    pending_frontend: StdMutex<HashMap<String, oneshot::Sender<FrontendAutomationAck>>>,
}

impl AutomationState {
    fn new(queue_tx: mpsc::UnboundedSender<QueuedAutomationJob>) -> Self {
        Self {
            jobs: StdRwLock::new(HashMap::new()),
            workspace_registry: StdRwLock::new(HashMap::new()),
            queued_jobs: AtomicUsize::new(0),
            queue_tx,
            pending_frontend: StdMutex::new(HashMap::new()),
        }
    }
}

struct AppState {
    panes: Arc<RwLock<HashMap<String, Arc<PaneRuntime>>>>,
    automation: Arc<AutomationState>,
}

impl AppState {
    fn new() -> (Self, mpsc::UnboundedReceiver<QueuedAutomationJob>) {
        let (queue_tx, queue_rx) = mpsc::unbounded_channel();
        let state = Self {
            panes: Arc::new(RwLock::new(HashMap::new())),
            automation: Arc::new(AutomationState::new(queue_tx)),
        };

        (state, queue_rx)
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
    mode: WorktreeCreateMode,
    branch: String,
    base_ref: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListWorktreesRequest {
    repo_root: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveRepoContextRequest {
    cwd: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RepoContext {
    is_git_repo: bool,
    repo_root: String,
    worktree_path: String,
    branch: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
enum WorktreeCreateMode {
    NewBranch,
    ExistingBranch,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoveWorktreeRequest {
    repo_root: String,
    worktree_path: String,
    force: bool,
    delete_branch: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoveWorktreeResponse {
    worktree_path: String,
    branch: String,
    branch_deleted: bool,
    warning: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PruneWorktreesRequest {
    repo_root: String,
    dry_run: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PruneWorktreesResponse {
    dry_run: bool,
    paths: Vec<String>,
    output: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BranchRequest {
    cwd: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorktreeEntry {
    id: String,
    repo_root: String,
    branch: String,
    worktree_path: String,
    head: String,
    is_main_worktree: bool,
    is_detached: bool,
    is_locked: bool,
    lock_reason: Option<String>,
    is_prunable: bool,
    prune_reason: Option<String>,
    is_dirty: bool,
}

#[derive(Debug, Clone)]
struct ParsedWorktreeEntry {
    branch: String,
    worktree_path: String,
    head: String,
    is_detached: bool,
    is_locked: bool,
    lock_reason: Option<String>,
    is_prunable: bool,
    prune_reason: Option<String>,
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

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0)
}

fn queue_automation_job(
    automation: &Arc<AutomationState>,
    request: ExternalCommandRequest,
) -> Result<SubmitCommandResponse, String> {
    if automation.queued_jobs.load(Ordering::Relaxed) >= AUTOMATION_QUEUE_MAX {
        return Err(AppError::conflict("automation queue is full").to_string());
    }

    let job_id = Uuid::new_v4().to_string();
    let job = AutomationJobRecord {
        job_id: job_id.clone(),
        status: AutomationJobStatus::Queued,
        request: request.clone(),
        result: None,
        error: None,
        created_at_ms: now_millis(),
        started_at_ms: None,
        finished_at_ms: None,
    };

    {
        let mut jobs = automation
            .jobs
            .write()
            .map_err(|_| AppError::system("automation job store lock poisoned").to_string())?;
        jobs.insert(job_id.clone(), job);
    }

    automation.queued_jobs.fetch_add(1, Ordering::Relaxed);
    if let Err(err) = automation
        .queue_tx
        .send(QueuedAutomationJob {
            job_id: job_id.clone(),
            request,
        })
    {
        automation.queued_jobs.fetch_sub(1, Ordering::Relaxed);
        let mut jobs = automation
            .jobs
            .write()
            .map_err(|_| AppError::system("automation job store lock poisoned").to_string())?;
        jobs.remove(&job_id);
        return Err(AppError::system(format!("failed to enqueue automation job: {err}")).to_string());
    }

    Ok(SubmitCommandResponse {
        job_id,
        status: AutomationJobStatus::Queued,
    })
}

fn get_automation_job(
    automation: &Arc<AutomationState>,
    job_id: &str,
) -> Result<Option<AutomationJobRecord>, String> {
    let jobs = automation
        .jobs
        .read()
        .map_err(|_| AppError::system("automation job store lock poisoned").to_string())?;
    Ok(jobs.get(job_id).cloned())
}

fn update_job_status(
    automation: &Arc<AutomationState>,
    job_id: &str,
    status: AutomationJobStatus,
    result: Option<serde_json::Value>,
    error: Option<String>,
) {
    if let Ok(mut jobs) = automation.jobs.write() {
        if let Some(job) = jobs.get_mut(job_id) {
            job.status = status.clone();
            if matches!(status, AutomationJobStatus::Running) {
                job.started_at_ms = Some(now_millis());
            }
            if matches!(status, AutomationJobStatus::Succeeded | AutomationJobStatus::Failed) {
                job.finished_at_ms = Some(now_millis());
            }
            job.result = result;
            job.error = error;
        }
    }
}

fn workspace_for_automation(
    automation: &Arc<AutomationState>,
    workspace_id: &str,
) -> Result<AutomationWorkspaceSnapshot, String> {
    let registry = automation
        .workspace_registry
        .read()
        .map_err(|_| AppError::system("workspace registry lock poisoned").to_string())?;
    registry
        .get(workspace_id)
        .cloned()
        .ok_or_else(|| AppError::not_found(format!("workspace `{workspace_id}` is not open")).to_string())
}

fn start_automation_http_server(automation: Arc<AutomationState>) {
    thread::spawn(move || {
        let listener = match TcpListener::bind(AUTOMATION_HTTP_BIND) {
            Ok(listener) => listener,
            Err(err) => {
                eprintln!("automation bridge bind failed on {AUTOMATION_HTTP_BIND}: {err}");
                return;
            }
        };

        for stream in listener.incoming() {
            let Ok(stream) = stream else {
                continue;
            };
            if let Err(err) = handle_automation_http_connection(stream, &automation) {
                eprintln!("automation bridge request error: {err}");
            }
        }
    });
}

fn handle_automation_http_connection(
    mut stream: TcpStream,
    automation: &Arc<AutomationState>,
) -> Result<(), String> {
    stream
        .set_read_timeout(Some(Duration::from_millis(1500)))
        .map_err(|err| AppError::system(format!("failed to set read timeout: {err}")).to_string())?;

    let mut request_bytes = Vec::new();
    let mut buffer = [0_u8; 2048];
    loop {
        let bytes_read = match stream.read(&mut buffer) {
            Ok(bytes_read) => bytes_read,
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => 0,
            Err(err) if err.kind() == std::io::ErrorKind::TimedOut => 0,
            Err(err) => {
                return Err(AppError::system(format!("failed to read request: {err}")).to_string())
            }
        };

        if bytes_read == 0 {
            break;
        }
        request_bytes.extend_from_slice(&buffer[..bytes_read]);
        if request_bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if request_bytes.len() > AUTOMATION_HTTP_MAX_BODY_BYTES {
            return write_http_json(
                &mut stream,
                413,
                &serde_json::json!({ "error": "request too large" }),
            );
        }
    }

    if request_bytes.is_empty() {
        return write_http_json(
            &mut stream,
            400,
            &serde_json::json!({ "error": "empty request" }),
        );
    }

    let header_end = request_bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
        .ok_or_else(|| AppError::validation("invalid HTTP request").to_string())?;
    let head = String::from_utf8_lossy(&request_bytes[..header_end]).to_string();
    let mut lines = head.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| AppError::validation("missing request line").to_string())?;
    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return write_http_json(
            &mut stream,
            400,
            &serde_json::json!({ "error": "invalid request line" }),
        );
    }
    let method = parts[0];
    let path = parts[1];

    let content_length = lines
        .filter_map(|line| line.split_once(':'))
        .find_map(|(name, value)| {
            if name.eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);

    let mut body = request_bytes[header_end..].to_vec();
    while body.len() < content_length {
        let bytes_read = stream
            .read(&mut buffer)
            .map_err(|err| AppError::system(format!("failed to read body: {err}")).to_string())?;
        if bytes_read == 0 {
            break;
        }
        body.extend_from_slice(&buffer[..bytes_read]);
        if body.len() > AUTOMATION_HTTP_MAX_BODY_BYTES {
            return write_http_json(
                &mut stream,
                413,
                &serde_json::json!({ "error": "request body too large" }),
            );
        }
    }

    match (method, path) {
        ("GET", "/v1/health") => write_http_json(
            &mut stream,
            200,
            &serde_json::json!(AutomationHealthResponse {
                status: "ok".to_string(),
                bind: AUTOMATION_HTTP_BIND.to_string(),
                queued_jobs: automation.queued_jobs.load(Ordering::Relaxed),
            }),
        ),
        ("GET", "/v1/workspaces") => {
            let workspaces = automation
                .workspace_registry
                .read()
                .map_err(|_| AppError::system("workspace registry lock poisoned").to_string())?
                .values()
                .cloned()
                .collect::<Vec<_>>();
            write_http_json(&mut stream, 200, &serde_json::json!({ "workspaces": workspaces }))
        }
        ("POST", "/v1/commands") => {
            let request: ExternalCommandRequest = match serde_json::from_slice(&body) {
                Ok(request) => request,
                Err(err) => {
                    return write_http_json(
                        &mut stream,
                        400,
                        &serde_json::json!({ "error": format!("invalid command payload: {err}") }),
                    )
                }
            };
            match queue_automation_job(automation, request) {
                Ok(response) => write_http_json(&mut stream, 202, &serde_json::json!(response)),
                Err(err) => write_http_json(&mut stream, 400, &serde_json::json!({ "error": err })),
            }
        }
        _ if method == "GET" && path.starts_with("/v1/jobs/") => {
            let job_id = path.trim_start_matches("/v1/jobs/");
            let job = get_automation_job(automation, job_id)?;
            match job {
                Some(job) => write_http_json(&mut stream, 200, &serde_json::json!(job)),
                None => write_http_json(
                    &mut stream,
                    404,
                    &serde_json::json!({ "error": "job not found" }),
                ),
            }
        }
        _ => write_http_json(
            &mut stream,
            404,
            &serde_json::json!({ "error": "not found" }),
        ),
    }
}

fn write_http_json(stream: &mut TcpStream, status_code: u16, value: &serde_json::Value) -> Result<(), String> {
    let status_text = match status_code {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        404 => "Not Found",
        413 => "Payload Too Large",
        _ => "Internal Server Error",
    };
    let body = serde_json::to_string(value)
        .map_err(|err| AppError::system(format!("failed to serialize response: {err}")).to_string())?;
    let response = format!(
        "HTTP/1.1 {status_code} {status_text}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|err| AppError::system(format!("failed to write response: {err}")).to_string())
}

async fn run_command_on_panes(
    pane_registry: Arc<RwLock<HashMap<String, Arc<PaneRuntime>>>>,
    pane_ids: Vec<String>,
    command: &str,
    execute: bool,
) -> Vec<PaneCommandResult> {
    let mut results = Vec::with_capacity(pane_ids.len());
    for pane_id in pane_ids {
        let pane = {
            let panes = pane_registry.read().await;
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
                .write_all(command.as_bytes())
                .map_err(|err| err.to_string())?;
            if execute {
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

    results
}

async fn dispatch_frontend_automation(
    app_handle: &AppHandle,
    automation: &Arc<AutomationState>,
    request: FrontendAutomationRequest,
) -> Result<serde_json::Value, String> {
    let job_id = request.job_id().to_string();
    let (tx, rx) = oneshot::channel::<FrontendAutomationAck>();
    {
        let mut pending = automation
            .pending_frontend
            .lock()
            .map_err(|_| AppError::system("frontend automation ack lock poisoned").to_string())?;
        pending.insert(job_id.clone(), tx);
    }

    if let Err(err) = app_handle.emit("automation:request", request) {
        if let Ok(mut pending) = automation.pending_frontend.lock() {
            pending.remove(&job_id);
        }
        return Err(AppError::system(format!("failed to emit automation request: {err}")).to_string());
    }

    let outcome = tokio::time::timeout(Duration::from_millis(AUTOMATION_FRONTEND_TIMEOUT_MS), rx).await;

    {
        let mut pending = automation
            .pending_frontend
            .lock()
            .map_err(|_| AppError::system("frontend automation ack lock poisoned").to_string())?;
        pending.remove(&job_id);
    }

    let outcome = outcome
        .map_err(|_| AppError::system("frontend automation request timed out").to_string())?
        .map_err(|_| AppError::system("frontend automation response channel closed").to_string())?;

    if outcome.ok {
        Ok(outcome.result.unwrap_or_else(|| serde_json::json!({ "ok": true })))
    } else {
        Err(outcome
            .error
            .unwrap_or_else(|| "frontend automation failed".to_string()))
    }
}

fn create_branch_for_workspace(
    workspace: &AutomationWorkspaceSnapshot,
    branch: &str,
    base_ref: Option<&str>,
    checkout: bool,
) -> Result<serde_json::Value, String> {
    if branch.trim().is_empty() {
        return Err(AppError::validation("branch is required").to_string());
    }

    let branch_check = Command::new("git")
        .arg("-C")
        .arg(&workspace.worktree_path)
        .arg("check-ref-format")
        .arg("--branch")
        .arg(branch)
        .status()
        .map_err(|err| AppError::git(format!("failed to validate branch name: {err}")).to_string())?;
    if !branch_check.success() {
        return Err(AppError::validation(format!("invalid branch name: {branch}")).to_string());
    }

    let exists = Command::new("git")
        .arg("-C")
        .arg(&workspace.repo_root)
        .arg("show-ref")
        .arg("--verify")
        .arg("--quiet")
        .arg(format!("refs/heads/{branch}"))
        .status()
        .map_err(|err| AppError::git(format!("failed to inspect branch refs: {err}")).to_string())?
        .success();

    let mut command = Command::new("git");
    command.arg("-C").arg(&workspace.worktree_path);

    if checkout {
        if exists {
            command.arg("checkout").arg(branch);
        } else {
            command
                .arg("checkout")
                .arg("-b")
                .arg(branch)
                .arg(base_ref.unwrap_or("HEAD"));
        }
    } else if exists {
        return Ok(serde_json::json!({
            "branch": branch,
            "created": false,
            "checkedOut": false,
            "message": "branch already exists"
        }));
    } else {
        command
            .arg("branch")
            .arg(branch)
            .arg(base_ref.unwrap_or("HEAD"));
    }

    let output = command
        .output()
        .map_err(|err| AppError::git(format!("failed to run git branch command: {err}")).to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::git(format!("git branch command failed: {stderr}")).to_string());
    }

    Ok(serde_json::json!({
        "branch": branch,
        "created": !exists,
        "checkedOut": checkout
    }))
}

async fn process_external_command(
    app_handle: &AppHandle,
    pane_registry: &Arc<RwLock<HashMap<String, Arc<PaneRuntime>>>>,
    automation: &Arc<AutomationState>,
    job_id: &str,
    request: ExternalCommandRequest,
) -> Result<serde_json::Value, String> {
    match request {
        ExternalCommandRequest::CreatePanes {
            workspace_id,
            pane_count,
        } => {
            let _workspace = workspace_for_automation(automation, &workspace_id)?;
            dispatch_frontend_automation(
                app_handle,
                automation,
                FrontendAutomationRequest::CreatePanes {
                    job_id: job_id.to_string(),
                    workspace_id,
                    pane_count,
                },
            )
            .await
        }
        ExternalCommandRequest::CreateWorktree {
            workspace_id,
            mode,
            branch,
            base_ref,
            open_after_create,
        } => {
            let workspace = workspace_for_automation(automation, &workspace_id)?;
            let entry = create_worktree(CreateWorktreeRequest {
                repo_root: workspace.repo_root.clone(),
                mode,
                branch,
                base_ref,
            })?;

            if open_after_create.unwrap_or(true) {
                let _ = dispatch_frontend_automation(
                    app_handle,
                    automation,
                    FrontendAutomationRequest::ImportWorktree {
                        job_id: job_id.to_string(),
                        worktree_path: entry.worktree_path.clone(),
                    },
                )
                .await?;
            }

            serde_json::to_value(entry)
                .map_err(|err| AppError::system(format!("failed to serialize worktree result: {err}")).to_string())
        }
        ExternalCommandRequest::CreateBranch {
            workspace_id,
            branch,
            base_ref,
            checkout,
        } => {
            let workspace = workspace_for_automation(automation, &workspace_id)?;
            create_branch_for_workspace(
                &workspace,
                &branch,
                base_ref.as_deref(),
                checkout.unwrap_or(true),
            )
        }
        ExternalCommandRequest::RunCommand {
            workspace_id,
            command,
            execute,
        } => {
            let workspace = workspace_for_automation(automation, &workspace_id)?;
            let results = run_command_on_panes(
                Arc::clone(pane_registry),
                workspace.runtime_pane_ids,
                &command,
                execute.unwrap_or(true),
            )
            .await;

            serde_json::to_value(results)
                .map_err(|err| AppError::system(format!("failed to serialize command result: {err}")).to_string())
        }
    }
}

fn start_automation_worker(
    app_handle: AppHandle,
    pane_registry: Arc<RwLock<HashMap<String, Arc<PaneRuntime>>>>,
    automation: Arc<AutomationState>,
    mut receiver: mpsc::UnboundedReceiver<QueuedAutomationJob>,
) {
    tauri::async_runtime::spawn(async move {
        while let Some(job) = receiver.recv().await {
            automation.queued_jobs.fetch_sub(1, Ordering::Relaxed);
            update_job_status(
                &automation,
                &job.job_id,
                AutomationJobStatus::Running,
                None,
                None,
            );

            let outcome = process_external_command(
                &app_handle,
                &pane_registry,
                &automation,
                &job.job_id,
                job.request,
            )
            .await;
            match outcome {
                Ok(result) => {
                    update_job_status(
                        &automation,
                        &job.job_id,
                        AutomationJobStatus::Succeeded,
                        Some(result),
                        None,
                    );
                }
                Err(error) => {
                    update_job_status(
                        &automation,
                        &job.job_id,
                        AutomationJobStatus::Failed,
                        None,
                        Some(error),
                    );
                }
            }
        }
    });
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
    let resolved_term = resolve_pane_term(env::var("TERM").ok().as_deref());
    command.env("TERM", resolved_term);

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
    Ok(
        run_command_on_panes(
            Arc::clone(&state.panes),
            request.pane_ids,
            &request.command,
            request.execute,
        )
        .await,
    )
}

#[tauri::command]
fn sync_automation_workspaces(
    state: State<'_, AppState>,
    request: SyncAutomationWorkspacesRequest,
) -> Result<(), String> {
    let mut registry = state
        .automation
        .workspace_registry
        .write()
        .map_err(|_| AppError::system("workspace registry lock poisoned").to_string())?;
    registry.clear();
    request.workspaces.into_iter().for_each(|workspace| {
        registry.insert(workspace.workspace_id.clone(), workspace);
    });
    Ok(())
}

#[tauri::command]
fn automation_report(
    state: State<'_, AppState>,
    request: AutomationReportRequest,
) -> Result<(), String> {
    let mut pending = state
        .automation
        .pending_frontend
        .lock()
        .map_err(|_| AppError::system("frontend automation ack lock poisoned").to_string())?;
    let sender = pending
        .remove(&request.job_id)
        .ok_or_else(|| AppError::not_found(format!("pending automation job `{}` not found", request.job_id)).to_string())?;
    sender
        .send(FrontendAutomationAck {
            job_id: request.job_id,
            ok: request.ok,
            result: request.result,
            error: request.error,
        })
        .map_err(|_| AppError::system("failed to deliver frontend automation ack").to_string())
}

#[tauri::command]
fn resolve_repo_context(request: ResolveRepoContextRequest) -> Result<RepoContext, String> {
    let cwd = request.cwd.trim();
    if cwd.is_empty() {
        return Err(AppError::validation("cwd is required").to_string());
    }

    let cwd_path = PathBuf::from(cwd);
    if !cwd_path.exists() {
        return Err(
            AppError::validation(format!("cwd does not exist: {}", cwd_path.to_string_lossy()))
                .to_string(),
        );
    }

    let normalized_cwd = normalize_existing_path(&cwd_path);
    let repo_root_output = Command::new("git")
        .arg("-C")
        .arg(&normalized_cwd)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .output()
        .map_err(|err| AppError::git(format!("failed to inspect repo root: {err}")).to_string())?;

    if !repo_root_output.status.success() {
        return Ok(RepoContext {
            is_git_repo: false,
            repo_root: normalized_cwd.clone(),
            worktree_path: normalized_cwd,
            branch: "not-a-repo".to_string(),
        });
    }

    let repo_root = String::from_utf8_lossy(&repo_root_output.stdout)
        .trim()
        .to_string();
    let branch = resolve_branch(&normalized_cwd).unwrap_or_else(|_| "detached".to_string());

    Ok(RepoContext {
        is_git_repo: true,
        repo_root: normalize_existing_path(Path::new(&repo_root)),
        worktree_path: normalized_cwd,
        branch,
    })
}

#[tauri::command]
fn create_worktree(request: CreateWorktreeRequest) -> Result<WorktreeEntry, String> {
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

    let branch = request.branch.trim();
    let branch_check = Command::new("git")
        .arg("-C")
        .arg(&request.repo_root)
        .arg("check-ref-format")
        .arg("--branch")
        .arg(branch)
        .status()
        .map_err(|err| AppError::git(format!("failed to validate branch name: {err}")).to_string())?;
    if !branch_check.success() {
        return Err(AppError::validation(format!("invalid branch name: {branch}")).to_string());
    }

    let worktrees_root = repo_root.join(".worktrees");
    fs::create_dir_all(&worktrees_root).map_err(|err| {
        AppError::system(format!("failed to create worktrees dir: {err}")).to_string()
    })?;

    let worktree_path =
        next_available_worktree_path(&worktrees_root, &sanitize_branch_segment(branch));
    let normalized_worktree_path = normalize_existing_path(&worktree_path);

    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(&request.repo_root)
        .arg("worktree")
        .arg("add");

    match request.mode {
        WorktreeCreateMode::NewBranch => {
            let base_ref = request.base_ref.unwrap_or_else(|| "HEAD".to_string());
            command
                .arg("-b")
                .arg(branch)
                .arg(&worktree_path)
                .arg(base_ref);
        }
        WorktreeCreateMode::ExistingBranch => {
            command.arg(&worktree_path).arg(branch);
        }
    }

    let output = command.output().map_err(|err| {
        AppError::git(format!("failed to run git worktree add: {err}")).to_string()
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::git(format!("git worktree add failed: {stderr}")).to_string());
    }

    let entries = list_worktrees_internal(&request.repo_root)?;
    entries
        .into_iter()
        .find(|entry| normalize_existing_path(Path::new(&entry.worktree_path)) == normalized_worktree_path)
        .ok_or_else(|| {
            AppError::system("created worktree but failed to load metadata".to_string()).to_string()
        })
}

#[tauri::command]
fn list_worktrees(request: ListWorktreesRequest) -> Result<Vec<WorktreeEntry>, String> {
    list_worktrees_internal(&request.repo_root)
}

#[tauri::command]
fn remove_worktree(request: RemoveWorktreeRequest) -> Result<RemoveWorktreeResponse, String> {
    let repo_root = PathBuf::from(&request.repo_root);
    if !repo_root.exists() {
        return Err(AppError::validation("repo root does not exist").to_string());
    }

    let target_path = normalize_existing_path(Path::new(&request.worktree_path));
    let entries = list_worktrees_internal(&request.repo_root)?;
    let target = entries
        .iter()
        .find(|entry| normalize_existing_path(Path::new(&entry.worktree_path)) == target_path)
        .ok_or_else(|| AppError::not_found("worktree not found").to_string())?;

    if target.is_main_worktree {
        return Err(AppError::conflict("cannot remove main worktree").to_string());
    }
    if target.is_dirty && !request.force {
        return Err(
            AppError::conflict("worktree has uncommitted changes; retry with force=true").to_string(),
        );
    }

    let mut remove_cmd = Command::new("git");
    remove_cmd
        .arg("-C")
        .arg(&request.repo_root)
        .arg("worktree")
        .arg("remove");
    if request.force {
        remove_cmd.arg("--force");
    }
    remove_cmd.arg(&target.worktree_path);

    let remove_output = remove_cmd
        .output()
        .map_err(|err| AppError::git(format!("failed to run git worktree remove: {err}")).to_string())?;
    if !remove_output.status.success() {
        let stderr = String::from_utf8_lossy(&remove_output.stderr).trim().to_string();
        return Err(AppError::git(format!("git worktree remove failed: {stderr}")).to_string());
    }

    let mut branch_deleted = false;
    let mut warning = None;
    if request.delete_branch {
        if target.is_detached {
            warning = Some("cannot delete branch for detached worktree".to_string());
        } else if target.branch == "main" {
            warning = Some("refused to delete protected branch: main".to_string());
        } else {
            let mut branch_cmd = Command::new("git");
            branch_cmd
                .arg("-C")
                .arg(&request.repo_root)
                .arg("branch")
                .arg(if request.force { "-D" } else { "-d" })
                .arg(&target.branch);
            let branch_output = branch_cmd.output().map_err(|err| {
                AppError::git(format!("failed to delete branch {}: {err}", target.branch)).to_string()
            })?;
            if branch_output.status.success() {
                branch_deleted = true;
            } else {
                warning = Some(
                    String::from_utf8_lossy(&branch_output.stderr)
                        .trim()
                        .to_string(),
                );
            }
        }
    }

    Ok(RemoveWorktreeResponse {
        worktree_path: target.worktree_path.clone(),
        branch: target.branch.clone(),
        branch_deleted,
        warning,
    })
}

#[tauri::command]
fn prune_worktrees(request: PruneWorktreesRequest) -> Result<PruneWorktreesResponse, String> {
    let repo_root = PathBuf::from(&request.repo_root);
    if !repo_root.exists() {
        return Err(AppError::validation("repo root does not exist").to_string());
    }

    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(&request.repo_root)
        .arg("worktree")
        .arg("prune");
    if request.dry_run {
        command.arg("--dry-run");
    }
    command.arg("--verbose");

    let output = command
        .output()
        .map_err(|err| AppError::git(format!("failed to run git worktree prune: {err}")).to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::git(format!("git worktree prune failed: {stderr}")).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let combined_output = if stderr.is_empty() {
        stdout
    } else if stdout.is_empty() {
        stderr
    } else {
        format!("{stdout}\n{stderr}")
    };
    Ok(PruneWorktreesResponse {
        dry_run: request.dry_run,
        paths: extract_paths_from_prune_output(&combined_output),
        output: combined_output,
    })
}

fn list_worktrees_internal(repo_root: &str) -> Result<Vec<WorktreeEntry>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
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

    let normalized_root = normalize_existing_path(Path::new(repo_root));
    let parsed = parse_worktree_porcelain(&String::from_utf8_lossy(&output.stdout));
    Ok(parsed
        .into_iter()
        .map(|entry| {
            let normalized_path = normalize_existing_path(Path::new(&entry.worktree_path));
            WorktreeEntry {
                id: Uuid::new_v4().to_string(),
                repo_root: normalized_root.clone(),
                branch: entry.branch,
                worktree_path: normalized_path.clone(),
                head: entry.head,
                is_main_worktree: normalized_path == normalized_root,
                is_detached: entry.is_detached,
                is_locked: entry.is_locked,
                lock_reason: entry.lock_reason,
                is_prunable: entry.is_prunable,
                prune_reason: entry.prune_reason,
                is_dirty: is_worktree_dirty(&normalized_path),
            }
        })
        .collect())
}

fn is_worktree_dirty(worktree_path: &str) -> bool {
    let output = Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .arg("status")
        .arg("--porcelain")
        .output();
    match output {
        Ok(data) if data.status.success() => !String::from_utf8_lossy(&data.stdout).trim().is_empty(),
        _ => false,
    }
}

fn normalize_existing_path(path: &Path) -> String {
    fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string()
}

fn next_available_worktree_path(worktrees_root: &Path, branch_segment: &str) -> PathBuf {
    let mut candidate = worktrees_root.join(branch_segment);
    if !candidate.exists() {
        return candidate;
    }

    for suffix in 2..1000 {
        candidate = worktrees_root.join(format!("{branch_segment}-{suffix}"));
        if !candidate.exists() {
            return candidate;
        }
    }

    worktrees_root.join(format!("{branch_segment}-{}", Uuid::new_v4()))
}

fn extract_paths_from_prune_output(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .filter_map(|line| {
            if line.starts_with('/') {
                return Some(line.trim().to_string());
            }

            let index = line.find(" /")?;
            Some(line[index + 1..].trim().to_string())
        })
        .collect()
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

        let entries = parse_worktree_porcelain(input);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].worktree_path, "/repo");
        assert_eq!(entries[0].branch, "main");
        assert_eq!(entries[0].head, "abc123");
        assert!(!entries[0].is_detached);
        assert_eq!(entries[1].worktree_path, "/repo/.worktrees/feature-abc");
        assert_eq!(entries[1].branch, "detached");
        assert_eq!(entries[1].head, "def456");
        assert!(entries[1].is_detached);
    }

    #[test]
    fn parse_worktree_porcelain_parses_lock_and_prunable_flags() {
        let input = "\
worktree /repo/.worktrees/feature-locked
HEAD aaaaaa1
branch refs/heads/feature/locked
locked reason-for-lock
prunable stale path
";

        let entries = parse_worktree_porcelain(input);
        assert_eq!(entries.len(), 1);
        assert!(entries[0].is_locked);
        assert_eq!(entries[0].lock_reason.as_deref(), Some("reason-for-lock"));
        assert!(entries[0].is_prunable);
        assert_eq!(entries[0].prune_reason.as_deref(), Some("stale path"));
    }

    #[test]
    fn next_available_worktree_path_adds_suffix_for_collision() {
        let root = std::env::temp_dir().join(format!("super-vibing-worktrees-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("feature-a")).expect("create first candidate");
        fs::create_dir_all(root.join("feature-a-2")).expect("create second candidate");

        let path = next_available_worktree_path(&root, "feature-a");
        assert_eq!(path.to_string_lossy(), root.join("feature-a-3").to_string_lossy());

        fs::remove_dir_all(root).expect("cleanup temp dir");
    }

    #[test]
    fn extract_paths_from_prune_output_reads_absolute_segments() {
        let output = "Removing worktrees/foo\nPruning /repo/.worktrees/feature-a";
        let paths = extract_paths_from_prune_output(output);
        assert_eq!(paths, vec!["/repo/.worktrees/feature-a".to_string()]);
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

    #[test]
    fn resolve_pane_term_defaults_when_missing_or_empty() {
        assert_eq!(resolve_pane_term(None), "xterm-256color");
        assert_eq!(resolve_pane_term(Some("")), "xterm-256color");
        assert_eq!(resolve_pane_term(Some("   ")), "xterm-256color");
    }

    #[test]
    fn resolve_pane_term_replaces_dumb_case_insensitively() {
        assert_eq!(resolve_pane_term(Some("dumb")), "xterm-256color");
        assert_eq!(resolve_pane_term(Some("DUMB")), "xterm-256color");
        assert_eq!(resolve_pane_term(Some(" dumb ")), "xterm-256color");
    }

    #[test]
    fn resolve_pane_term_preserves_valid_values() {
        assert_eq!(resolve_pane_term(Some("screen-256color")), "screen-256color");
        assert_eq!(resolve_pane_term(Some("xterm-kitty")), "xterm-kitty");
    }

    #[test]
    fn frontend_automation_request_serializes_camel_case_fields() {
        let request = FrontendAutomationRequest::CreatePanes {
            job_id: "job-1".to_string(),
            workspace_id: "workspace-main".to_string(),
            pane_count: 3,
        };
        let value = serde_json::to_value(request).expect("serialize request");

        assert_eq!(value.get("action").and_then(|v| v.as_str()), Some("create_panes"));
        assert_eq!(value.get("jobId").and_then(|v| v.as_str()), Some("job-1"));
        assert_eq!(
            value.get("workspaceId").and_then(|v| v.as_str()),
            Some("workspace-main")
        );
        assert_eq!(value.get("paneCount").and_then(|v| v.as_u64()), Some(3));
    }
}

fn parse_worktree_porcelain(stdout: &str) -> Vec<ParsedWorktreeEntry> {
    let mut entries = Vec::new();
    let mut current: Option<ParsedWorktreeEntry> = None;

    for line in stdout.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(prev) = current.take() {
                entries.push(prev);
            }
            current = Some(ParsedWorktreeEntry {
                branch: "detached".to_string(),
                worktree_path: path.to_string(),
                head: String::new(),
                is_detached: false,
                is_locked: false,
                lock_reason: None,
                is_prunable: false,
                prune_reason: None,
            });
            continue;
        }

        let Some(entry) = current.as_mut() else {
            continue;
        };

        if let Some(head) = line.strip_prefix("HEAD ") {
            entry.head = head.to_string();
            continue;
        }
        if let Some(branch) = line.strip_prefix("branch refs/heads/") {
            entry.branch = branch.to_string();
            entry.is_detached = false;
            continue;
        }
        if line == "detached" {
            entry.branch = "detached".to_string();
            entry.is_detached = true;
            continue;
        }
        if let Some(reason) = line.strip_prefix("locked") {
            entry.is_locked = true;
            let value = reason.trim();
            if !value.is_empty() {
                entry.lock_reason = Some(value.to_string());
            }
            continue;
        }
        if let Some(reason) = line.strip_prefix("prunable") {
            entry.is_prunable = true;
            let value = reason.trim();
            if !value.is_empty() {
                entry.prune_reason = Some(value.to_string());
            }
        }
    }

    if let Some(prev) = current {
        entries.push(prev);
    }

    entries
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

fn resolve_pane_term(current: Option<&str>) -> String {
    let Some(value) = current.map(str::trim).filter(|value| !value.is_empty()) else {
        return "xterm-256color".to_string();
    };

    if value.eq_ignore_ascii_case("dumb") {
        return "xterm-256color".to_string();
    }

    value.to_string()
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
    let (app_state, queue_receiver) = AppState::new();
    let pane_registry = Arc::clone(&app_state.panes);
    let automation_state = Arc::clone(&app_state.automation);
    let queue_receiver = Arc::new(StdMutex::new(Some(queue_receiver)));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(app_state)
        .setup({
            let pane_registry = Arc::clone(&pane_registry);
            let automation_state = Arc::clone(&automation_state);
            let queue_receiver = Arc::clone(&queue_receiver);
            move |app| {
                if let Ok(mut guard) = queue_receiver.lock() {
                    if let Some(receiver) = guard.take() {
                        start_automation_worker(
                            app.handle().clone(),
                            Arc::clone(&pane_registry),
                            Arc::clone(&automation_state),
                            receiver,
                        );
                    }
                }
                start_automation_http_server(Arc::clone(&automation_state));
                Ok(())
            }
        })
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
            sync_automation_workspaces,
            automation_report,
            resolve_repo_context,
            create_worktree,
            list_worktrees,
            remove_worktree,
            prune_worktrees
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
