use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env, fmt, fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Component, Path, PathBuf},
    process::{Command, Output},
    sync::{
        atomic::AtomicUsize,
        atomic::{AtomicBool, Ordering},
        mpsc as std_mpsc, Arc, Mutex as StdMutex, RwLock as StdRwLock,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, AppHandle, Emitter, State};
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};
use uuid::Uuid;

const PTY_READ_BUFFER_BYTES: usize = 4096;
const PTY_READER_STACK_BYTES: usize = 256 * 1024;
const AUTOMATION_HTTP_BIND_ENV: &str = "SUPERVIBING_AUTOMATION_BIND";
const AUTOMATION_DEFAULT_HOST: &str = "127.0.0.1";
const AUTOMATION_DEFAULT_PORT: u16 = 47631;
const AUTOMATION_FALLBACK_PORT_END: u16 = 47641;
const AUTOMATION_HTTP_MAX_BODY_BYTES: usize = 64 * 1024;
const AUTOMATION_QUEUE_MAX: usize = 200;
const AUTOMATION_FRONTEND_TIMEOUT_MS: u64 = 20_000;
const AUTOMATION_COMPLETED_JOB_RETENTION_MAX: usize = 500;
const AUTOMATION_MAX_COMMAND_BYTES: usize = 16 * 1024;
const COMMAND_OUTPUT_MAX_BYTES: usize = 256 * 1024;
const GITHUB_LIST_LIMIT_DEFAULT: u16 = 30;
const GITHUB_LIST_LIMIT_MAX: u16 = 100;
const DISCORD_APP_ID_ENV: &str = "SUPERVIBING_DISCORD_APP_ID";
const DISCORD_DEFAULT_APP_ID: u64 = 1471970767083405549;
const DISCORD_PRESENCE_DETAILS: &str = "SuperVibing";
const DISCORD_PRESENCE_STATE: &str = "Working";
const DISCORD_RETRY_INTERVAL: Duration = Duration::from_secs(5);
const DISCORD_HEALTHCHECK_INTERVAL: Duration = Duration::from_secs(30);
const DISCORD_WORKER_POLL_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Debug)]
struct HttpError {
    status_code: u16,
    message: String,
}

impl HttpError {
    fn new(status_code: u16, message: impl Into<String>) -> Self {
        Self {
            status_code,
            message: message.into(),
        }
    }
}

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscordPresenceRequest {
    enabled: bool,
}

#[derive(Debug, Clone, Copy)]
enum DiscordPresenceCommand {
    SetEnabled(bool),
}

impl DiscordPresenceCommand {
    fn enabled(self) -> bool {
        match self {
            Self::SetEnabled(enabled) => enabled,
        }
    }
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
#[serde(
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    tag = "action"
)]
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
    selected_bind: StdRwLock<String>,
    queued_jobs: AtomicUsize,
    queue_tx: mpsc::UnboundedSender<QueuedAutomationJob>,
    pending_frontend: StdMutex<HashMap<String, oneshot::Sender<FrontendAutomationAck>>>,
}

impl AutomationState {
    fn new(queue_tx: mpsc::UnboundedSender<QueuedAutomationJob>) -> Self {
        Self {
            jobs: StdRwLock::new(HashMap::new()),
            workspace_registry: StdRwLock::new(HashMap::new()),
            selected_bind: StdRwLock::new(default_automation_bind()),
            queued_jobs: AtomicUsize::new(0),
            queue_tx,
            pending_frontend: StdMutex::new(HashMap::new()),
        }
    }
}

struct DiscordPresenceState {
    command_tx: std_mpsc::Sender<DiscordPresenceCommand>,
}

impl DiscordPresenceState {
    fn new(command_tx: std_mpsc::Sender<DiscordPresenceCommand>) -> Self {
        Self { command_tx }
    }
}

struct AppState {
    panes: Arc<RwLock<HashMap<String, Arc<PaneRuntime>>>>,
    automation: Arc<AutomationState>,
    discord_presence: Arc<DiscordPresenceState>,
}

impl AppState {
    fn new() -> (
        Self,
        mpsc::UnboundedReceiver<QueuedAutomationJob>,
        std_mpsc::Receiver<DiscordPresenceCommand>,
    ) {
        let (queue_tx, queue_rx) = mpsc::unbounded_channel();
        let (discord_tx, discord_rx) = std_mpsc::channel();
        let state = Self {
            panes: Arc::new(RwLock::new(HashMap::new())),
            automation: Arc::new(AutomationState::new(queue_tx)),
            discord_presence: Arc::new(DiscordPresenceState::new(discord_tx)),
        };

        (state, queue_rx, discord_rx)
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitRepoRequest {
    repo_root: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitDiffRequest {
    repo_root: String,
    path: String,
    staged: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitPathsRequest {
    repo_root: String,
    paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitDiscardPathsRequest {
    repo_root: String,
    paths: Vec<String>,
    force: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCommitRequest {
    repo_root: String,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCheckoutBranchRequest {
    repo_root: String,
    branch: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCreateBranchRequest {
    repo_root: String,
    branch: String,
    base_ref: Option<String>,
    checkout: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitDeleteBranchRequest {
    repo_root: String,
    branch: String,
    force: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitCommandResponse {
    output: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitDiffResponse {
    path: String,
    staged: bool,
    patch: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitStatusFile {
    path: String,
    code: String,
    staged: bool,
    unstaged: bool,
    untracked: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitStatusResponse {
    repo_root: String,
    branch: String,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    staged_count: u32,
    unstaged_count: u32,
    untracked_count: u32,
    files: Vec<GitStatusFile>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitBranchEntry {
    name: String,
    is_current: bool,
    upstream: Option<String>,
    commit: String,
    subject: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitHubListRequest {
    repo_root: String,
    limit: Option<u16>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitHubPrRequest {
    repo_root: String,
    number: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitHubPrCommentRequest {
    repo_root: String,
    number: u64,
    body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitHubPrMergeRequest {
    repo_root: String,
    number: u64,
    delete_branch: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitHubIssueRequest {
    repo_root: String,
    number: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitHubIssueCommentRequest {
    repo_root: String,
    number: u64,
    body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitHubIssueEditLabelsRequest {
    repo_root: String,
    number: u64,
    add_labels: Vec<String>,
    remove_labels: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitHubIssueEditAssigneesRequest {
    repo_root: String,
    number: u64,
    add_assignees: Vec<String>,
    remove_assignees: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitHubRunRequest {
    repo_root: String,
    run_id: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitHubUser {
    login: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitHubLabel {
    name: String,
    color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitHubPrSummary {
    number: u64,
    title: String,
    state: String,
    head_ref_name: String,
    base_ref_name: String,
    is_draft: bool,
    updated_at: String,
    url: String,
    author: Option<GitHubUser>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitHubIssueSummary {
    number: u64,
    title: String,
    state: String,
    updated_at: String,
    url: String,
    author: Option<GitHubUser>,
    labels: Vec<GitHubLabel>,
    assignees: Vec<GitHubUser>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitHubWorkflowSummary {
    id: u64,
    name: String,
    state: String,
    path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitHubRunSummary {
    database_id: u64,
    workflow_name: String,
    display_title: String,
    status: String,
    conclusion: Option<String>,
    event: String,
    head_branch: Option<String>,
    head_sha: Option<String>,
    number: Option<u64>,
    created_at: String,
    updated_at: String,
    url: String,
}

fn clamp_github_list_limit(value: Option<u16>) -> u16 {
    let requested = value.unwrap_or(GITHUB_LIST_LIMIT_DEFAULT);
    requested.clamp(1, GITHUB_LIST_LIMIT_MAX)
}

fn normalize_command_text(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes).trim().to_string();
    if text.len() <= COMMAND_OUTPUT_MAX_BYTES {
        return text;
    }

    let mut truncated = text
        .chars()
        .take(COMMAND_OUTPUT_MAX_BYTES)
        .collect::<String>();
    truncated.push_str("\n...[truncated]");
    truncated
}

fn command_error_output(output: &Output) -> String {
    let stderr = normalize_command_text(&output.stderr);
    if !stderr.is_empty() {
        return stderr;
    }

    let stdout = normalize_command_text(&output.stdout);
    if !stdout.is_empty() {
        return stdout;
    }

    "command failed".to_string()
}

fn validate_repo_root(repo_root: &str) -> Result<String, String> {
    let trimmed = repo_root.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("repoRoot is required").to_string());
    }

    let path = PathBuf::from(trimmed);
    if !path.exists() {
        return Err(AppError::validation("repo root does not exist").to_string());
    }
    if !path.is_dir() {
        return Err(AppError::validation("repo root must be a directory").to_string());
    }

    Ok(normalize_existing_path(&path))
}

fn validate_repo_paths(paths: &[String]) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Err(AppError::validation("at least one path is required").to_string());
    }

    let mut normalized = Vec::with_capacity(paths.len());
    for raw in paths {
        let value = raw.trim();
        if value.is_empty() {
            return Err(AppError::validation("path cannot be empty").to_string());
        }

        let path = Path::new(value);
        if path.is_absolute() {
            return Err(AppError::validation("absolute paths are not allowed").to_string());
        }

        if path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            return Err(AppError::validation("path traversal is not allowed").to_string());
        }

        normalized.push(value.to_string());
    }

    Ok(normalized)
}

fn run_git_command(repo_root: &str, args: &[&str], context: &str) -> Result<Output, String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(repo_root);
    args.iter().for_each(|arg| {
        command.arg(arg);
    });

    command
        .output()
        .map_err(|err| AppError::git(format!("{context}: {err}")).to_string())
}

fn run_gh_command(repo_root: &str, args: &[&str], context: &str) -> Result<Output, String> {
    let mut command = Command::new("gh");
    command.current_dir(repo_root);
    args.iter().for_each(|arg| {
        command.arg(arg);
    });

    command.output().map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            AppError::system("GitHub CLI (`gh`) is not installed".to_string()).to_string()
        } else {
            AppError::system(format!("{context}: {err}")).to_string()
        }
    })
}

fn parse_branch_header(line: &str) -> (String, Option<String>, u32, u32) {
    let header = line.strip_prefix("## ").unwrap_or(line).trim();
    let mut branch = header.to_string();
    let mut upstream = None;
    let mut ahead = 0_u32;
    let mut behind = 0_u32;

    if let Some((left, right)) = header.split_once("...") {
        branch = left.trim().to_string();
        let (upstream_part, tracking_part) = match right.split_once(" [") {
            Some((upstream_raw, tracking_raw)) => (
                upstream_raw.trim(),
                Some(tracking_raw.trim_end_matches(']').trim()),
            ),
            None => (right.trim(), None),
        };

        if !upstream_part.is_empty() {
            upstream = Some(upstream_part.to_string());
        }

        if let Some(tracking_part) = tracking_part {
            tracking_part.split(',').for_each(|piece| {
                let token = piece.trim();
                if let Some(value) = token.strip_prefix("ahead ") {
                    ahead = value.trim().parse::<u32>().unwrap_or(0);
                } else if let Some(value) = token.strip_prefix("behind ") {
                    behind = value.trim().parse::<u32>().unwrap_or(0);
                }
            });
        }
    } else if let Some((left, _tracking_part)) = header.split_once(" [") {
        branch = left.trim().to_string();
    }

    (branch, upstream, ahead, behind)
}

fn parse_status_file_line(line: &str) -> Option<GitStatusFile> {
    if line.len() < 3 {
        return None;
    }

    if let Some(path) = line.strip_prefix("?? ") {
        return Some(GitStatusFile {
            path: path.trim().to_string(),
            code: "??".to_string(),
            staged: false,
            unstaged: false,
            untracked: true,
        });
    }

    let code = line.get(0..2)?.to_string();
    let x = code.chars().next().unwrap_or(' ');
    let y = code.chars().nth(1).unwrap_or(' ');
    let path_segment = line.get(3..)?.trim();
    let path = path_segment
        .split_once(" -> ")
        .map(|(_, target)| target.trim())
        .unwrap_or(path_segment)
        .to_string();

    Some(GitStatusFile {
        path,
        code,
        staged: x != ' ' && x != '?',
        unstaged: y != ' ',
        untracked: false,
    })
}

fn response_from_output(output: &Output, fallback: &str) -> GitCommandResponse {
    let stderr = normalize_command_text(&output.stderr);
    if !stderr.is_empty() {
        return GitCommandResponse { output: stderr };
    }

    let stdout = normalize_command_text(&output.stdout);
    if !stdout.is_empty() {
        return GitCommandResponse { output: stdout };
    }

    GitCommandResponse {
        output: fallback.to_string(),
    }
}

fn run_gh_json(repo_root: &str, args: &[&str], context: &str) -> Result<serde_json::Value, String> {
    let output = run_gh_command(repo_root, args, context)?;
    if !output.status.success() {
        return Err(AppError::git(format!("{context}: {}", command_error_output(&output))).to_string());
    }

    let stdout = normalize_command_text(&output.stdout);
    if stdout.is_empty() {
        return Ok(serde_json::json!([]));
    }

    serde_json::from_str::<serde_json::Value>(&stdout)
        .map_err(|err| AppError::system(format!("{context}: failed to parse json output: {err}")).to_string())
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0)
}

fn default_automation_bind() -> String {
    format!("{AUTOMATION_DEFAULT_HOST}:{AUTOMATION_DEFAULT_PORT}")
}

fn parse_automation_bind(value: &str) -> Result<(String, u16), String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("bind value is empty".to_string());
    }

    let (host, port) = value
        .rsplit_once(':')
        .ok_or_else(|| format!("expected host:port, received `{value}`"))?;
    if host.is_empty() {
        return Err("bind host is empty".to_string());
    }
    if host != "127.0.0.1" && host != "localhost" {
        return Err(format!(
            "bind host must be localhost-only (`127.0.0.1` or `localhost`), received `{host}`"
        ));
    }

    let port: u16 = port
        .parse()
        .map_err(|_| format!("bind port must be a valid u16, received `{port}`"))?;
    if port == 0 {
        return Err("bind port must be greater than 0".to_string());
    }

    Ok((host.to_string(), port))
}

fn configured_automation_bind() -> (String, u16) {
    let configured = env::var(AUTOMATION_HTTP_BIND_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let Some(configured) = configured else {
        return (AUTOMATION_DEFAULT_HOST.to_string(), AUTOMATION_DEFAULT_PORT);
    };

    match parse_automation_bind(&configured) {
        Ok(parsed) => parsed,
        Err(err) => {
            eprintln!(
                "automation bridge invalid {AUTOMATION_HTTP_BIND_ENV} `{configured}`: {err}; using {}",
                default_automation_bind()
            );
            (AUTOMATION_DEFAULT_HOST.to_string(), AUTOMATION_DEFAULT_PORT)
        }
    }
}

fn fallback_automation_bind_candidates(host: &str, preferred_port: u16) -> Vec<String> {
    (AUTOMATION_DEFAULT_PORT..=AUTOMATION_FALLBACK_PORT_END)
        .filter(|port| *port != preferred_port)
        .map(|port| format!("{host}:{port}"))
        .collect()
}

fn bind_automation_listener(
    host: &str,
    preferred_port: u16,
) -> Result<(TcpListener, String, bool), String> {
    let preferred_addr = format!("{host}:{preferred_port}");
    match TcpListener::bind(&preferred_addr) {
        Ok(listener) => return Ok((listener, preferred_addr, false)),
        Err(err) if err.kind() == std::io::ErrorKind::AddrInUse => {
            eprintln!("automation bridge preferred bind in use on {preferred_addr}: {err}");
        }
        Err(err) => {
            return Err(format!(
                "automation bridge bind failed on {preferred_addr}: {err}"
            ));
        }
    }

    let mut last_error = String::new();
    for candidate in fallback_automation_bind_candidates(host, preferred_port) {
        match TcpListener::bind(&candidate) {
            Ok(listener) => return Ok((listener, candidate, true)),
            Err(err) if err.kind() == std::io::ErrorKind::AddrInUse => {
                last_error = err.to_string();
                continue;
            }
            Err(err) => {
                return Err(format!(
                    "automation bridge bind failed on {candidate}: {err}"
                ));
            }
        }
    }

    let scan = format!("{host}:{AUTOMATION_DEFAULT_PORT}-{host}:{AUTOMATION_FALLBACK_PORT_END}");
    if last_error.is_empty() {
        Err(format!(
            "automation bridge bind failed: no available address in fallback scan {scan}"
        ))
    } else {
        Err(format!(
            "automation bridge bind failed: no available address in fallback scan {scan} ({last_error})"
        ))
    }
}

fn current_automation_bind(automation: &Arc<AutomationState>) -> String {
    automation
        .selected_bind
        .read()
        .map(|value| value.clone())
        .unwrap_or_else(|_| default_automation_bind())
}

fn configured_automation_token() -> Option<String> {
    env::var("SUPERVIBING_AUTOMATION_TOKEN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn parse_bearer_token(authorization_header: Option<&str>) -> Option<&str> {
    authorization_header
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn authorize_automation_request(
    expected_token: Option<&str>,
    authorization_header: Option<&str>,
) -> Result<(), HttpError> {
    let Some(expected_token) = expected_token else {
        return Ok(());
    };

    let provided = parse_bearer_token(authorization_header)
        .ok_or_else(|| HttpError::new(401, "missing automation bearer token"))?;

    if provided != expected_token {
        return Err(HttpError::new(401, "invalid automation bearer token"));
    }

    Ok(())
}

fn validate_external_command_request(
    automation: &Arc<AutomationState>,
    request: &ExternalCommandRequest,
) -> Result<(), HttpError> {
    let resolve_workspace = |workspace_id: &str| -> Result<AutomationWorkspaceSnapshot, HttpError> {
        if workspace_id.trim().is_empty() {
            return Err(HttpError::new(400, "workspaceId is required"));
        }

        workspace_for_automation(automation, workspace_id).map_err(|error| match error {
            AppError::NotFound(message) => HttpError::new(404, message),
            _ => HttpError::new(500, error.to_string()),
        })
    };

    match request {
        ExternalCommandRequest::CreatePanes {
            workspace_id,
            pane_count,
        } => {
            let _ = resolve_workspace(workspace_id)?;
            if *pane_count < 1 || *pane_count > 16 {
                return Err(HttpError::new(
                    400,
                    format!("paneCount must be between 1 and 16, received {pane_count}"),
                ));
            }
        }
        ExternalCommandRequest::CreateWorktree {
            workspace_id,
            branch,
            ..
        } => {
            let _ = resolve_workspace(workspace_id)?;
            if branch.trim().is_empty() {
                return Err(HttpError::new(400, "branch is required"));
            }
        }
        ExternalCommandRequest::CreateBranch {
            workspace_id,
            branch,
            ..
        } => {
            let _ = resolve_workspace(workspace_id)?;
            if branch.trim().is_empty() {
                return Err(HttpError::new(400, "branch is required"));
            }
        }
        ExternalCommandRequest::RunCommand {
            workspace_id,
            command,
            ..
        } => {
            let workspace = resolve_workspace(workspace_id)?;
            if workspace.runtime_pane_ids.is_empty() {
                return Err(HttpError::new(
                    409,
                    "workspace has no active panes to run commands",
                ));
            }
            let command = command.trim();
            if command.is_empty() {
                return Err(HttpError::new(400, "command is required"));
            }
            if command.len() > AUTOMATION_MAX_COMMAND_BYTES {
                return Err(HttpError::new(
                    400,
                    format!(
                        "command is too large (max {} bytes)",
                        AUTOMATION_MAX_COMMAND_BYTES
                    ),
                ));
            }
        }
    }

    Ok(())
}

fn queue_automation_job(
    automation: &Arc<AutomationState>,
    request: ExternalCommandRequest,
) -> Result<SubmitCommandResponse, HttpError> {
    if automation.queued_jobs.load(Ordering::Relaxed) >= AUTOMATION_QUEUE_MAX {
        return Err(HttpError::new(429, "automation queue is full"));
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
            .map_err(|_| HttpError::new(500, "automation job store lock poisoned"))?;
        jobs.insert(job_id.clone(), job);
    }

    automation.queued_jobs.fetch_add(1, Ordering::Relaxed);
    if let Err(err) = automation.queue_tx.send(QueuedAutomationJob {
        job_id: job_id.clone(),
        request,
    }) {
        automation.queued_jobs.fetch_sub(1, Ordering::Relaxed);
        let mut jobs = automation
            .jobs
            .write()
            .map_err(|_| HttpError::new(500, "automation job store lock poisoned"))?;
        jobs.remove(&job_id);
        return Err(HttpError::new(
            500,
            format!("failed to enqueue automation job: {err}"),
        ));
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

fn prune_completed_jobs_with_limit(automation: &Arc<AutomationState>, limit: usize) {
    if let Ok(mut jobs) = automation.jobs.write() {
        let mut completed = jobs
            .iter()
            .filter_map(|(job_id, job)| {
                if matches!(
                    job.status,
                    AutomationJobStatus::Succeeded | AutomationJobStatus::Failed
                ) {
                    Some((
                        job_id.clone(),
                        job.finished_at_ms.unwrap_or(job.created_at_ms),
                    ))
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();

        if completed.len() <= limit {
            return;
        }

        completed.sort_by_key(|(_, finished_at)| *finished_at);
        let remove_count = completed.len().saturating_sub(limit);
        completed
            .into_iter()
            .take(remove_count)
            .for_each(|(job_id, _)| {
                jobs.remove(&job_id);
            });
    }
}

fn prune_completed_jobs(automation: &Arc<AutomationState>) {
    prune_completed_jobs_with_limit(automation, AUTOMATION_COMPLETED_JOB_RETENTION_MAX);
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
            if matches!(
                status,
                AutomationJobStatus::Succeeded | AutomationJobStatus::Failed
            ) {
                job.finished_at_ms = Some(now_millis());
            }
            job.result = result;
            job.error = error;
        }
    }

    if matches!(
        status,
        AutomationJobStatus::Succeeded | AutomationJobStatus::Failed
    ) {
        prune_completed_jobs(automation);
    }
}

fn workspace_for_automation(
    automation: &Arc<AutomationState>,
    workspace_id: &str,
) -> Result<AutomationWorkspaceSnapshot, AppError> {
    let registry = automation
        .workspace_registry
        .read()
        .map_err(|_| AppError::system("workspace registry lock poisoned".to_string()))?;
    registry
        .get(workspace_id)
        .cloned()
        .ok_or_else(|| AppError::not_found(format!("workspace `{workspace_id}` is not open")))
}

fn start_automation_http_server(automation: Arc<AutomationState>) {
    thread::spawn(move || {
        let (host, preferred_port) = configured_automation_bind();
        let preferred_bind = format!("{host}:{preferred_port}");
        let (listener, selected_bind, used_fallback) =
            match bind_automation_listener(&host, preferred_port) {
                Ok(result) => result,
                Err(err) => {
                    eprintln!("{err}");
                    return;
                }
            };
        if let Ok(mut bind) = automation.selected_bind.write() {
            *bind = selected_bind.clone();
        }
        if used_fallback {
            eprintln!(
                "automation bridge listening on {selected_bind} (preferred {preferred_bind} was unavailable)"
            );
        } else {
            eprintln!("automation bridge listening on {selected_bind}");
        }

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
        .map_err(|err| {
            AppError::system(format!("failed to set read timeout: {err}")).to_string()
        })?;

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

    let headers = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_string()))
        .collect::<HashMap<_, _>>();
    let authorization_header = headers.get("authorization").map(String::as_str);
    let auth_token = configured_automation_token();
    if let Err(error) = authorize_automation_request(auth_token.as_deref(), authorization_header) {
        return write_http_json(
            &mut stream,
            error.status_code,
            &serde_json::json!({ "error": error.message }),
        );
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > AUTOMATION_HTTP_MAX_BODY_BYTES {
        return write_http_json(
            &mut stream,
            413,
            &serde_json::json!({ "error": "request body too large" }),
        );
    }

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
                bind: current_automation_bind(automation),
                queued_jobs: automation.queued_jobs.load(Ordering::Relaxed),
            }),
        ),
        ("GET", "/v1/workspaces") => {
            let workspaces = match automation.workspace_registry.read() {
                Ok(registry) => registry.values().cloned().collect::<Vec<_>>(),
                Err(_) => {
                    return write_http_json(
                        &mut stream,
                        500,
                        &serde_json::json!({ "error": "workspace registry lock poisoned" }),
                    )
                }
            };
            write_http_json(
                &mut stream,
                200,
                &serde_json::json!({ "workspaces": workspaces }),
            )
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
            if let Err(error) = validate_external_command_request(automation, &request) {
                return write_http_json(
                    &mut stream,
                    error.status_code,
                    &serde_json::json!({ "error": error.message }),
                );
            }
            match queue_automation_job(automation, request) {
                Ok(response) => write_http_json(&mut stream, 202, &serde_json::json!(response)),
                Err(error) => write_http_json(
                    &mut stream,
                    error.status_code,
                    &serde_json::json!({ "error": error.message }),
                ),
            }
        }
        _ if method == "GET" && path.starts_with("/v1/jobs/") => {
            let job_id = path.trim_start_matches("/v1/jobs/");
            if job_id.trim().is_empty() {
                return write_http_json(
                    &mut stream,
                    400,
                    &serde_json::json!({ "error": "job id is required" }),
                );
            }
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

fn write_http_json(
    stream: &mut TcpStream,
    status_code: u16,
    value: &serde_json::Value,
) -> Result<(), String> {
    let status_text = match status_code {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        409 => "Conflict",
        413 => "Payload Too Large",
        429 => "Too Many Requests",
        _ => "Internal Server Error",
    };
    let body = serde_json::to_string(value).map_err(|err| {
        AppError::system(format!("failed to serialize response: {err}")).to_string()
    })?;
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
        return Err(
            AppError::system(format!("failed to emit automation request: {err}")).to_string(),
        );
    }

    let outcome =
        tokio::time::timeout(Duration::from_millis(AUTOMATION_FRONTEND_TIMEOUT_MS), rx).await;

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
        Ok(outcome
            .result
            .unwrap_or_else(|| serde_json::json!({ "ok": true })))
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
        .map_err(|err| {
            AppError::git(format!("failed to validate branch name: {err}")).to_string()
        })?;
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

    let output = command.output().map_err(|err| {
        AppError::git(format!("failed to run git branch command: {err}")).to_string()
    })?;
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
            let _workspace = workspace_for_automation(automation, &workspace_id)
                .map_err(|err| err.to_string())?;
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
            let workspace = workspace_for_automation(automation, &workspace_id)
                .map_err(|err| err.to_string())?;
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

            serde_json::to_value(entry).map_err(|err| {
                AppError::system(format!("failed to serialize worktree result: {err}")).to_string()
            })
        }
        ExternalCommandRequest::CreateBranch {
            workspace_id,
            branch,
            base_ref,
            checkout,
        } => {
            let workspace = workspace_for_automation(automation, &workspace_id)
                .map_err(|err| err.to_string())?;
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
            let workspace = workspace_for_automation(automation, &workspace_id)
                .map_err(|err| err.to_string())?;
            let results = run_command_on_panes(
                Arc::clone(pane_registry),
                workspace.runtime_pane_ids,
                &command,
                execute.unwrap_or(true),
            )
            .await;

            serde_json::to_value(results).map_err(|err| {
                AppError::system(format!("failed to serialize command result: {err}")).to_string()
            })
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

fn parse_discord_app_id(raw: Option<&str>) -> String {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DISCORD_DEFAULT_APP_ID)
        .to_string()
}

fn resolve_discord_app_id() -> String {
    parse_discord_app_id(env::var(DISCORD_APP_ID_ENV).ok().as_deref())
}

fn set_discord_activity(client: &mut DiscordIpcClient) -> bool {
    client
        .set_activity(
            activity::Activity::new()
                .details(DISCORD_PRESENCE_DETAILS)
                .state(DISCORD_PRESENCE_STATE),
        )
        .is_ok()
}

fn clear_discord_activity(client: &mut Option<DiscordIpcClient>) {
    if let Some(active) = client.as_mut() {
        let _ = active.clear_activity();
        let _ = active.close();
    }

    *client = None;
}

fn apply_latest_discord_presence_command(
    first: DiscordPresenceCommand,
    receiver: &std_mpsc::Receiver<DiscordPresenceCommand>,
) -> bool {
    let mut enabled = first.enabled();
    while let Ok(command) = receiver.try_recv() {
        enabled = command.enabled();
    }
    enabled
}

fn start_discord_presence_worker(receiver: std_mpsc::Receiver<DiscordPresenceCommand>) {
    thread::spawn(move || {
        let app_id = resolve_discord_app_id();
        let mut desired_enabled = false;
        let mut client: Option<DiscordIpcClient> = None;
        let mut next_retry_at = Instant::now();
        let mut next_healthcheck_at = Instant::now();

        loop {
            match receiver.recv_timeout(DISCORD_WORKER_POLL_INTERVAL) {
                Ok(first_command) => {
                    desired_enabled =
                        apply_latest_discord_presence_command(first_command, &receiver);
                    if !desired_enabled {
                        clear_discord_activity(&mut client);
                        continue;
                    }

                    // Retry immediately when settings turn presence on.
                    next_retry_at = Instant::now();
                }
                Err(std_mpsc::RecvTimeoutError::Timeout) => {}
                Err(std_mpsc::RecvTimeoutError::Disconnected) => {
                    clear_discord_activity(&mut client);
                    break;
                }
            }

            if !desired_enabled {
                continue;
            }

            let now = Instant::now();
            if client.is_none() {
                if now < next_retry_at {
                    continue;
                }

                let mut next_client = DiscordIpcClient::new(app_id.as_str());
                match next_client.connect() {
                    Ok(()) => {
                        if set_discord_activity(&mut next_client) {
                            next_healthcheck_at = Instant::now() + DISCORD_HEALTHCHECK_INTERVAL;
                            client = Some(next_client);
                        } else {
                            next_retry_at = Instant::now() + DISCORD_RETRY_INTERVAL;
                        }
                    }
                    Err(_) => {
                        next_retry_at = Instant::now() + DISCORD_RETRY_INTERVAL;
                    }
                }
                continue;
            }

            if now >= next_healthcheck_at {
                let healthy = client.as_mut().map(set_discord_activity).unwrap_or(false);
                if healthy {
                    next_healthcheck_at = Instant::now() + DISCORD_HEALTHCHECK_INTERVAL;
                } else {
                    clear_discord_activity(&mut client);
                    next_retry_at = Instant::now() + DISCORD_RETRY_INTERVAL;
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
fn set_discord_presence_enabled(
    state: State<'_, AppState>,
    request: DiscordPresenceRequest,
) -> Result<(), String> {
    state
        .discord_presence
        .command_tx
        .send(DiscordPresenceCommand::SetEnabled(request.enabled))
        .map_err(|_| AppError::system("discord presence worker unavailable").to_string())
}

#[tauri::command]
async fn run_global_command(
    state: State<'_, AppState>,
    request: GlobalCommandRequest,
) -> Result<Vec<PaneCommandResult>, String> {
    Ok(run_command_on_panes(
        Arc::clone(&state.panes),
        request.pane_ids,
        &request.command,
        request.execute,
    )
    .await)
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
    let sender = pending.remove(&request.job_id).ok_or_else(|| {
        AppError::not_found(format!(
            "pending automation job `{}` not found",
            request.job_id
        ))
        .to_string()
    })?;
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
        return Err(AppError::validation(format!(
            "cwd does not exist: {}",
            cwd_path.to_string_lossy()
        ))
        .to_string());
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
        .map_err(|err| {
            AppError::git(format!("failed to validate branch name: {err}")).to_string()
        })?;
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
        .find(|entry| {
            normalize_existing_path(Path::new(&entry.worktree_path)) == normalized_worktree_path
        })
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
            AppError::conflict("worktree has uncommitted changes; retry with force=true")
                .to_string(),
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

    let remove_output = remove_cmd.output().map_err(|err| {
        AppError::git(format!("failed to run git worktree remove: {err}")).to_string()
    })?;
    if !remove_output.status.success() {
        let stderr = String::from_utf8_lossy(&remove_output.stderr)
            .trim()
            .to_string();
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
                AppError::git(format!("failed to delete branch {}: {err}", target.branch))
                    .to_string()
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

    let output = command.output().map_err(|err| {
        AppError::git(format!("failed to run git worktree prune: {err}")).to_string()
    })?;

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

#[tauri::command]
fn git_status(request: GitRepoRequest) -> Result<GitStatusResponse, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let output = run_git_command(
        &repo_root,
        &["status", "--porcelain", "--branch"],
        "failed to run git status",
    )?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }

    let stdout = normalize_command_text(&output.stdout);
    let mut branch = "detached".to_string();
    let mut upstream = None;
    let mut ahead = 0_u32;
    let mut behind = 0_u32;
    let mut files = Vec::new();

    for line in stdout.lines() {
        if line.starts_with("## ") {
            let (next_branch, next_upstream, next_ahead, next_behind) = parse_branch_header(line);
            branch = next_branch;
            upstream = next_upstream;
            ahead = next_ahead;
            behind = next_behind;
            continue;
        }

        if let Some(file) = parse_status_file_line(line) {
            files.push(file);
        }
    }

    let staged_count = files.iter().filter(|item| item.staged).count() as u32;
    let unstaged_count = files.iter().filter(|item| item.unstaged).count() as u32;
    let untracked_count = files.iter().filter(|item| item.untracked).count() as u32;

    Ok(GitStatusResponse {
        repo_root,
        branch,
        upstream,
        ahead,
        behind,
        staged_count,
        unstaged_count,
        untracked_count,
        files,
    })
}

#[tauri::command]
fn git_diff(request: GitDiffRequest) -> Result<GitDiffResponse, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let path = validate_repo_paths(&vec![request.path.clone()])?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::validation("path is required").to_string())?;

    let mut command = Command::new("git");
    command.arg("-C").arg(&repo_root).arg("diff");
    if request.staged {
        command.arg("--cached");
    }
    command.arg("--").arg(&path);

    let output = command
        .output()
        .map_err(|err| AppError::git(format!("failed to run git diff: {err}")).to_string())?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }

    Ok(GitDiffResponse {
        path,
        staged: request.staged,
        patch: normalize_command_text(&output.stdout),
    })
}

#[tauri::command]
fn git_stage_paths(request: GitPathsRequest) -> Result<GitCommandResponse, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let paths = validate_repo_paths(&request.paths)?;

    let mut command = Command::new("git");
    command.arg("-C").arg(&repo_root).arg("add").arg("--");
    paths.iter().for_each(|path| {
        command.arg(path);
    });

    let output = command
        .output()
        .map_err(|err| AppError::git(format!("failed to run git add: {err}")).to_string())?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }

    Ok(response_from_output(
        &output,
        &format!("staged {} path(s)", paths.len()),
    ))
}

#[tauri::command]
fn git_unstage_paths(request: GitPathsRequest) -> Result<GitCommandResponse, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let paths = validate_repo_paths(&request.paths)?;

    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(&repo_root)
        .arg("restore")
        .arg("--staged")
        .arg("--");
    paths.iter().for_each(|path| {
        command.arg(path);
    });

    let output = command
        .output()
        .map_err(|err| AppError::git(format!("failed to run git restore --staged: {err}")).to_string())?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }

    Ok(response_from_output(
        &output,
        &format!("unstaged {} path(s)", paths.len()),
    ))
}

#[tauri::command]
fn git_discard_paths(request: GitDiscardPathsRequest) -> Result<GitCommandResponse, String> {
    if !request.force {
        return Err(AppError::validation("force=true is required to discard changes").to_string());
    }

    let repo_root = validate_repo_root(&request.repo_root)?;
    let paths = validate_repo_paths(&request.paths)?;

    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(&repo_root)
        .arg("restore")
        .arg("--worktree")
        .arg("--source=HEAD")
        .arg("--");
    paths.iter().for_each(|path| {
        command.arg(path);
    });

    let output = command
        .output()
        .map_err(|err| AppError::git(format!("failed to run git restore: {err}")).to_string())?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }

    Ok(response_from_output(
        &output,
        &format!("discarded changes for {} path(s)", paths.len()),
    ))
}

#[tauri::command]
fn git_commit(request: GitCommitRequest) -> Result<GitCommandResponse, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let message = request.message.trim();
    if message.is_empty() {
        return Err(AppError::validation("commit message is required").to_string());
    }

    let output = run_git_command(
        &repo_root,
        &["commit", "-m", message],
        "failed to run git commit",
    )?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }

    Ok(response_from_output(&output, "commit created"))
}

#[tauri::command]
fn git_fetch(request: GitRepoRequest) -> Result<GitCommandResponse, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let output = run_git_command(&repo_root, &["fetch", "--all", "--prune"], "failed to run git fetch")?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }
    Ok(response_from_output(&output, "fetch completed"))
}

#[tauri::command]
fn git_pull(request: GitRepoRequest) -> Result<GitCommandResponse, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let output = run_git_command(&repo_root, &["pull", "--ff-only"], "failed to run git pull")?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }
    Ok(response_from_output(&output, "pull completed"))
}

#[tauri::command]
fn git_push(request: GitRepoRequest) -> Result<GitCommandResponse, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let output = run_git_command(&repo_root, &["push"], "failed to run git push")?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }
    Ok(response_from_output(&output, "push completed"))
}

#[tauri::command]
fn git_list_branches(request: GitRepoRequest) -> Result<Vec<GitBranchEntry>, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let current = run_git_command(
        &repo_root,
        &["symbolic-ref", "--quiet", "--short", "HEAD"],
        "failed to inspect current branch",
    )
    .ok()
    .filter(|output| output.status.success())
    .map(|output| normalize_command_text(&output.stdout))
    .unwrap_or_default();

    let output = run_git_command(
        &repo_root,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)\t%(upstream:short)\t%(objectname:short)\t%(subject)",
            "refs/heads",
        ],
        "failed to list branches",
    )?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }

    let mut branches = Vec::new();
    for line in normalize_command_text(&output.stdout).lines() {
        let mut parts = line.split('\t');
        let name = parts.next().unwrap_or("").trim();
        if name.is_empty() {
            continue;
        }
        let upstream = parts
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let commit = parts.next().unwrap_or("").trim().to_string();
        let subject = parts.next().unwrap_or("").trim().to_string();

        branches.push(GitBranchEntry {
            name: name.to_string(),
            is_current: !current.is_empty() && current == name,
            upstream,
            commit,
            subject,
        });
    }

    Ok(branches)
}

#[tauri::command]
fn git_checkout_branch(request: GitCheckoutBranchRequest) -> Result<GitCommandResponse, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let branch = request.branch.trim();
    if branch.is_empty() {
        return Err(AppError::validation("branch is required").to_string());
    }

    let output = run_git_command(
        &repo_root,
        &["checkout", branch],
        "failed to run git checkout",
    )?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }
    Ok(response_from_output(
        &output,
        &format!("checked out {branch}"),
    ))
}

#[tauri::command]
fn git_create_branch(request: GitCreateBranchRequest) -> Result<GitCommandResponse, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let branch = request.branch.trim();
    if branch.is_empty() {
        return Err(AppError::validation("branch is required").to_string());
    }

    let branch_check = run_git_command(
        &repo_root,
        &["check-ref-format", "--branch", branch],
        "failed to validate branch name",
    )?;
    if !branch_check.status.success() {
        return Err(AppError::validation(format!("invalid branch name: {branch}")).to_string());
    }

    let checkout = request.checkout.unwrap_or(true);
    let base_ref = request.base_ref.as_deref().map(str::trim).filter(|value| !value.is_empty());

    let output = if checkout {
        match base_ref {
            Some(base_ref) => run_git_command(
                &repo_root,
                &["checkout", "-b", branch, base_ref],
                "failed to create and checkout branch",
            )?,
            None => run_git_command(
                &repo_root,
                &["checkout", "-b", branch],
                "failed to create and checkout branch",
            )?,
        }
    } else {
        match base_ref {
            Some(base_ref) => run_git_command(
                &repo_root,
                &["branch", branch, base_ref],
                "failed to create branch",
            )?,
            None => run_git_command(&repo_root, &["branch", branch], "failed to create branch")?,
        }
    };

    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }

    Ok(response_from_output(
        &output,
        &format!("created branch {branch}"),
    ))
}

#[tauri::command]
fn git_delete_branch(request: GitDeleteBranchRequest) -> Result<GitCommandResponse, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let branch = request.branch.trim();
    if branch.is_empty() {
        return Err(AppError::validation("branch is required").to_string());
    }

    let flag = if request.force.unwrap_or(false) {
        "-D"
    } else {
        "-d"
    };
    let output = run_git_command(
        &repo_root,
        &["branch", flag, branch],
        "failed to delete branch",
    )?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }

    Ok(response_from_output(
        &output,
        &format!("deleted branch {branch}"),
    ))
}

#[tauri::command]
fn gh_list_prs(request: GitHubListRequest) -> Result<Vec<GitHubPrSummary>, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let limit = clamp_github_list_limit(request.limit);
    let limit_arg = limit.to_string();
    let value = run_gh_json(
        &repo_root,
        &[
            "pr",
            "list",
            "--limit",
            limit_arg.as_str(),
            "--json",
            "number,title,state,headRefName,baseRefName,isDraft,updatedAt,url,author",
        ],
        "failed to list pull requests",
    )?;
    serde_json::from_value(value)
        .map_err(|err| AppError::system(format!("failed to parse pull request list: {err}")).to_string())
}

#[tauri::command]
fn gh_pr_detail(request: GitHubPrRequest) -> Result<serde_json::Value, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let number = request.number.to_string();
    run_gh_json(
        &repo_root,
        &[
            "pr",
            "view",
            number.as_str(),
            "--json",
            "number,title,body,state,headRefName,baseRefName,isDraft,updatedAt,url,author,labels,assignees,reviewDecision,mergeStateStatus",
        ],
        "failed to load pull request details",
    )
}

#[tauri::command]
fn gh_pr_checkout(request: GitHubPrRequest) -> Result<GitCommandResponse, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let number = request.number.to_string();
    let output = run_gh_command(
        &repo_root,
        &["pr", "checkout", number.as_str()],
        "failed to checkout pull request",
    )?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }
    Ok(response_from_output(
        &output,
        &format!("checked out PR #{}", request.number),
    ))
}

#[tauri::command]
fn gh_pr_comment(request: GitHubPrCommentRequest) -> Result<GitCommandResponse, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let body = request.body.trim();
    if body.is_empty() {
        return Err(AppError::validation("comment body is required").to_string());
    }

    let number = request.number.to_string();
    let output = run_gh_command(
        &repo_root,
        &["pr", "comment", number.as_str(), "--body", body],
        "failed to comment on pull request",
    )?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }
    Ok(response_from_output(&output, "comment posted"))
}

#[tauri::command]
fn gh_pr_merge_squash(request: GitHubPrMergeRequest) -> Result<GitCommandResponse, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let number = request.number.to_string();
    let mut command = Command::new("gh");
    command
        .current_dir(&repo_root)
        .arg("pr")
        .arg("merge")
        .arg(number)
        .arg("--squash");
    if request.delete_branch.unwrap_or(false) {
        command.arg("--delete-branch");
    }

    let output = command.output().map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            AppError::system("GitHub CLI (`gh`) is not installed".to_string()).to_string()
        } else {
            AppError::system(format!("failed to merge pull request: {err}")).to_string()
        }
    })?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }
    Ok(response_from_output(&output, "pull request merged"))
}

#[tauri::command]
fn gh_list_issues(request: GitHubListRequest) -> Result<Vec<GitHubIssueSummary>, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let limit = clamp_github_list_limit(request.limit);
    let limit_arg = limit.to_string();
    let value = run_gh_json(
        &repo_root,
        &[
            "issue",
            "list",
            "--limit",
            limit_arg.as_str(),
            "--json",
            "number,title,state,updatedAt,url,author,labels,assignees",
        ],
        "failed to list issues",
    )?;
    serde_json::from_value(value)
        .map_err(|err| AppError::system(format!("failed to parse issue list: {err}")).to_string())
}

#[tauri::command]
fn gh_issue_detail(request: GitHubIssueRequest) -> Result<serde_json::Value, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let number = request.number.to_string();
    run_gh_json(
        &repo_root,
        &[
            "issue",
            "view",
            number.as_str(),
            "--json",
            "number,title,body,state,updatedAt,url,author,labels,assignees,comments",
        ],
        "failed to load issue details",
    )
}

#[tauri::command]
fn gh_issue_comment(request: GitHubIssueCommentRequest) -> Result<GitCommandResponse, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let body = request.body.trim();
    if body.is_empty() {
        return Err(AppError::validation("comment body is required").to_string());
    }

    let number = request.number.to_string();
    let output = run_gh_command(
        &repo_root,
        &["issue", "comment", number.as_str(), "--body", body],
        "failed to comment on issue",
    )?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }
    Ok(response_from_output(&output, "comment posted"))
}

#[tauri::command]
fn gh_issue_edit_labels(request: GitHubIssueEditLabelsRequest) -> Result<GitCommandResponse, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    if request.add_labels.is_empty() && request.remove_labels.is_empty() {
        return Err(AppError::validation("at least one label update is required").to_string());
    }

    let mut command = Command::new("gh");
    command
        .current_dir(&repo_root)
        .arg("issue")
        .arg("edit")
        .arg(request.number.to_string());
    request.add_labels.iter().for_each(|label| {
        command.arg("--add-label").arg(label);
    });
    request.remove_labels.iter().for_each(|label| {
        command.arg("--remove-label").arg(label);
    });

    let output = command.output().map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            AppError::system("GitHub CLI (`gh`) is not installed".to_string()).to_string()
        } else {
            AppError::system(format!("failed to edit issue labels: {err}")).to_string()
        }
    })?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }
    Ok(response_from_output(&output, "issue labels updated"))
}

#[tauri::command]
fn gh_issue_edit_assignees(
    request: GitHubIssueEditAssigneesRequest,
) -> Result<GitCommandResponse, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    if request.add_assignees.is_empty() && request.remove_assignees.is_empty() {
        return Err(AppError::validation("at least one assignee update is required").to_string());
    }

    let mut command = Command::new("gh");
    command
        .current_dir(&repo_root)
        .arg("issue")
        .arg("edit")
        .arg(request.number.to_string());
    request.add_assignees.iter().for_each(|assignee| {
        command.arg("--add-assignee").arg(assignee);
    });
    request.remove_assignees.iter().for_each(|assignee| {
        command.arg("--remove-assignee").arg(assignee);
    });

    let output = command.output().map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            AppError::system("GitHub CLI (`gh`) is not installed".to_string()).to_string()
        } else {
            AppError::system(format!("failed to edit issue assignees: {err}")).to_string()
        }
    })?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }
    Ok(response_from_output(&output, "issue assignees updated"))
}

#[tauri::command]
fn gh_list_workflows(request: GitHubListRequest) -> Result<Vec<GitHubWorkflowSummary>, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let limit = clamp_github_list_limit(request.limit);
    let limit_arg = limit.to_string();
    let value = run_gh_json(
        &repo_root,
        &[
            "workflow",
            "list",
            "--limit",
            limit_arg.as_str(),
            "--json",
            "id,name,state,path",
        ],
        "failed to list workflows",
    )?;
    serde_json::from_value(value)
        .map_err(|err| AppError::system(format!("failed to parse workflow list: {err}")).to_string())
}

#[tauri::command]
fn gh_list_runs(request: GitHubListRequest) -> Result<Vec<GitHubRunSummary>, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let limit = clamp_github_list_limit(request.limit);
    let limit_arg = limit.to_string();
    let value = run_gh_json(
        &repo_root,
        &[
            "run",
            "list",
            "--limit",
            limit_arg.as_str(),
            "--json",
            "databaseId,workflowName,displayTitle,status,conclusion,event,headBranch,headSha,number,createdAt,updatedAt,url",
        ],
        "failed to list workflow runs",
    )?;
    serde_json::from_value(value)
        .map_err(|err| AppError::system(format!("failed to parse run list: {err}")).to_string())
}

#[tauri::command]
fn gh_run_detail(request: GitHubRunRequest) -> Result<serde_json::Value, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let run_id = request.run_id.to_string();
    run_gh_json(
        &repo_root,
        &[
            "run",
            "view",
            run_id.as_str(),
            "--json",
            "databaseId,workflowName,displayTitle,status,conclusion,event,headBranch,headSha,number,createdAt,updatedAt,url,jobs",
        ],
        "failed to load run details",
    )
}

#[tauri::command]
fn gh_run_rerun_failed(request: GitHubRunRequest) -> Result<GitCommandResponse, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let run_id = request.run_id.to_string();
    let output = run_gh_command(
        &repo_root,
        &["run", "rerun", run_id.as_str(), "--failed"],
        "failed to rerun workflow run",
    )?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }
    Ok(response_from_output(&output, "run rerun requested"))
}

#[tauri::command]
fn gh_run_cancel(request: GitHubRunRequest) -> Result<GitCommandResponse, String> {
    let repo_root = validate_repo_root(&request.repo_root)?;
    let run_id = request.run_id.to_string();
    let output = run_gh_command(
        &repo_root,
        &["run", "cancel", run_id.as_str()],
        "failed to cancel workflow run",
    )?;
    if !output.status.success() {
        return Err(AppError::git(command_error_output(&output)).to_string());
    }
    Ok(response_from_output(&output, "run cancel requested"))
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
        Ok(data) if data.status.success() => {
            !String::from_utf8_lossy(&data.stdout).trim().is_empty()
        }
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
        assert_eq!(
            path.to_string_lossy(),
            root.join("feature-a-3").to_string_lossy()
        );

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
        assert_eq!(
            resolve_pane_term(Some("screen-256color")),
            "screen-256color"
        );
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

        assert_eq!(
            value.get("action").and_then(|v| v.as_str()),
            Some("create_panes")
        );
        assert_eq!(value.get("jobId").and_then(|v| v.as_str()), Some("job-1"));
        assert_eq!(
            value.get("workspaceId").and_then(|v| v.as_str()),
            Some("workspace-main")
        );
        assert_eq!(value.get("paneCount").and_then(|v| v.as_u64()), Some(3));
    }

    #[test]
    fn parse_bearer_token_extracts_token_value() {
        assert_eq!(parse_bearer_token(Some("Bearer abc123")), Some("abc123"));
        assert_eq!(
            parse_bearer_token(Some("Bearer   abc123   ")),
            Some("abc123")
        );
        assert_eq!(parse_bearer_token(Some("Token abc123")), None);
        assert_eq!(parse_bearer_token(None), None);
    }

    #[test]
    fn parse_automation_bind_accepts_localhost_values() {
        assert_eq!(
            parse_automation_bind("127.0.0.1:47631").expect("parse ipv4 bind"),
            ("127.0.0.1".to_string(), 47631)
        );
        assert_eq!(
            parse_automation_bind("localhost:47640").expect("parse localhost bind"),
            ("localhost".to_string(), 47640)
        );
    }

    #[test]
    fn parse_automation_bind_rejects_invalid_values() {
        assert!(parse_automation_bind("").is_err());
        assert!(parse_automation_bind("47631").is_err());
        assert!(parse_automation_bind("0.0.0.0:47631").is_err());
        assert!(parse_automation_bind("127.0.0.1:0").is_err());
        assert!(parse_automation_bind("127.0.0.1:not-a-port").is_err());
    }

    #[test]
    fn parse_discord_app_id_uses_numeric_override() {
        assert_eq!(parse_discord_app_id(Some("1234567890")), "1234567890");
        assert_eq!(parse_discord_app_id(Some(" 1234567890 ")), "1234567890");
    }

    #[test]
    fn parse_discord_app_id_defaults_on_missing_or_invalid_values() {
        let expected = DISCORD_DEFAULT_APP_ID.to_string();
        assert_eq!(parse_discord_app_id(None), expected);
        assert_eq!(parse_discord_app_id(Some("")), expected);
        assert_eq!(parse_discord_app_id(Some("   ")), expected);
        assert_eq!(parse_discord_app_id(Some("not-a-number")), expected);
    }

    #[test]
    fn apply_latest_discord_presence_command_keeps_last_toggle() {
        let (tx, rx) = std_mpsc::channel();
        tx.send(DiscordPresenceCommand::SetEnabled(true))
            .expect("send first command");
        tx.send(DiscordPresenceCommand::SetEnabled(false))
            .expect("send second command");
        tx.send(DiscordPresenceCommand::SetEnabled(true))
            .expect("send third command");

        let first = rx.recv().expect("receive first command");
        let enabled = apply_latest_discord_presence_command(first, &rx);
        assert!(enabled);
    }

    #[test]
    fn fallback_automation_bind_candidates_are_deterministic() {
        let candidates = fallback_automation_bind_candidates("127.0.0.1", AUTOMATION_DEFAULT_PORT);
        assert_eq!(
            candidates.first().map(String::as_str),
            Some("127.0.0.1:47632")
        );
        assert_eq!(
            candidates.last().map(String::as_str),
            Some("127.0.0.1:47641")
        );
        assert_eq!(
            candidates.len(),
            (AUTOMATION_FALLBACK_PORT_END - AUTOMATION_DEFAULT_PORT) as usize
        );
    }

    #[test]
    fn authorize_automation_request_allows_missing_configured_token() {
        let result = authorize_automation_request(None, None);
        assert!(result.is_ok());
    }

    #[test]
    fn authorize_automation_request_rejects_missing_or_invalid_token() {
        let missing =
            authorize_automation_request(Some("secret"), None).expect_err("missing header");
        assert_eq!(missing.status_code, 401);

        let wrong = authorize_automation_request(Some("secret"), Some("Bearer nope"))
            .expect_err("wrong token");
        assert_eq!(wrong.status_code, 401);

        let ok = authorize_automation_request(Some("secret"), Some("Bearer secret"));
        assert!(ok.is_ok());
    }

    #[test]
    fn current_automation_bind_reads_runtime_selected_bind() {
        let (state, _receiver, _discord_receiver) = AppState::new();
        {
            let mut bind = state
                .automation
                .selected_bind
                .write()
                .expect("selected bind write");
            *bind = "127.0.0.1:47640".to_string();
        }

        assert_eq!(
            current_automation_bind(&state.automation),
            "127.0.0.1:47640".to_string()
        );
    }

    #[test]
    fn validate_external_command_request_rejects_invalid_payloads() {
        let (state, _receiver, _discord_receiver) = AppState::new();
        let automation = Arc::clone(&state.automation);

        let missing_workspace = validate_external_command_request(
            &automation,
            &ExternalCommandRequest::CreatePanes {
                workspace_id: "workspace-main".to_string(),
                pane_count: 2,
            },
        )
        .expect_err("missing workspace should fail");
        assert_eq!(missing_workspace.status_code, 404);

        {
            let mut registry = automation
                .workspace_registry
                .write()
                .expect("workspace registry write");
            registry.insert(
                "workspace-main".to_string(),
                AutomationWorkspaceSnapshot {
                    workspace_id: "workspace-main".to_string(),
                    name: "Main".to_string(),
                    repo_root: "/repo".to_string(),
                    worktree_path: "/repo".to_string(),
                    runtime_pane_ids: vec!["workspace-main::pane-1".to_string()],
                },
            );
        }

        let invalid_pane_count = validate_external_command_request(
            &automation,
            &ExternalCommandRequest::CreatePanes {
                workspace_id: "workspace-main".to_string(),
                pane_count: 0,
            },
        )
        .expect_err("pane_count=0 should fail");
        assert_eq!(invalid_pane_count.status_code, 400);

        let empty_command = validate_external_command_request(
            &automation,
            &ExternalCommandRequest::RunCommand {
                workspace_id: "workspace-main".to_string(),
                command: "   ".to_string(),
                execute: Some(true),
            },
        )
        .expect_err("empty command should fail");
        assert_eq!(empty_command.status_code, 400);
    }

    #[test]
    fn prune_completed_jobs_with_limit_keeps_running_jobs_and_newest_completed() {
        let (state, _receiver, _discord_receiver) = AppState::new();
        let automation = Arc::clone(&state.automation);

        {
            let mut jobs = automation.jobs.write().expect("jobs lock");
            jobs.insert(
                "running".to_string(),
                AutomationJobRecord {
                    job_id: "running".to_string(),
                    status: AutomationJobStatus::Running,
                    request: ExternalCommandRequest::RunCommand {
                        workspace_id: "workspace-main".to_string(),
                        command: "echo 1".to_string(),
                        execute: Some(true),
                    },
                    result: None,
                    error: None,
                    created_at_ms: 1,
                    started_at_ms: Some(2),
                    finished_at_ms: None,
                },
            );
            jobs.insert(
                "done-1".to_string(),
                AutomationJobRecord {
                    job_id: "done-1".to_string(),
                    status: AutomationJobStatus::Succeeded,
                    request: ExternalCommandRequest::RunCommand {
                        workspace_id: "workspace-main".to_string(),
                        command: "echo 2".to_string(),
                        execute: Some(true),
                    },
                    result: None,
                    error: None,
                    created_at_ms: 10,
                    started_at_ms: Some(11),
                    finished_at_ms: Some(12),
                },
            );
            jobs.insert(
                "done-2".to_string(),
                AutomationJobRecord {
                    job_id: "done-2".to_string(),
                    status: AutomationJobStatus::Failed,
                    request: ExternalCommandRequest::RunCommand {
                        workspace_id: "workspace-main".to_string(),
                        command: "echo 3".to_string(),
                        execute: Some(true),
                    },
                    result: None,
                    error: Some("x".to_string()),
                    created_at_ms: 20,
                    started_at_ms: Some(21),
                    finished_at_ms: Some(22),
                },
            );
            jobs.insert(
                "done-3".to_string(),
                AutomationJobRecord {
                    job_id: "done-3".to_string(),
                    status: AutomationJobStatus::Succeeded,
                    request: ExternalCommandRequest::RunCommand {
                        workspace_id: "workspace-main".to_string(),
                        command: "echo 4".to_string(),
                        execute: Some(true),
                    },
                    result: None,
                    error: None,
                    created_at_ms: 30,
                    started_at_ms: Some(31),
                    finished_at_ms: Some(32),
                },
            );
        }

        prune_completed_jobs_with_limit(&automation, 2);

        let jobs = automation.jobs.read().expect("jobs read lock");
        assert!(jobs.contains_key("running"));
        assert!(!jobs.contains_key("done-1"));
        assert!(jobs.contains_key("done-2"));
        assert!(jobs.contains_key("done-3"));
    }

    #[test]
    fn parse_branch_header_reads_upstream_and_tracking_counts() {
        let (branch, upstream, ahead, behind) =
            parse_branch_header("## feat/git-ui...origin/feat/git-ui [ahead 2, behind 1]");
        assert_eq!(branch, "feat/git-ui");
        assert_eq!(upstream.as_deref(), Some("origin/feat/git-ui"));
        assert_eq!(ahead, 2);
        assert_eq!(behind, 1);
    }

    #[test]
    fn parse_status_file_line_parses_untracked_and_modified_entries() {
        let untracked = parse_status_file_line("?? src/new-file.ts").expect("parse untracked");
        assert!(untracked.untracked);
        assert!(!untracked.staged);
        assert!(!untracked.unstaged);

        let mixed = parse_status_file_line("MM src/app.ts").expect("parse modified");
        assert!(mixed.staged);
        assert!(mixed.unstaged);
        assert_eq!(mixed.code, "MM");
    }

    #[test]
    fn validate_repo_paths_rejects_absolute_and_parent_segments() {
        assert!(validate_repo_paths(&vec!["src/app.ts".to_string()]).is_ok());
        assert!(validate_repo_paths(&vec!["/etc/passwd".to_string()]).is_err());
        assert!(validate_repo_paths(&vec!["../oops".to_string()]).is_err());
    }

    #[test]
    fn clamp_github_list_limit_bounds_values() {
        assert_eq!(clamp_github_list_limit(None), GITHUB_LIST_LIMIT_DEFAULT);
        assert_eq!(clamp_github_list_limit(Some(0)), 1);
        assert_eq!(clamp_github_list_limit(Some(5)), 5);
        assert_eq!(
            clamp_github_list_limit(Some(GITHUB_LIST_LIMIT_MAX + 10)),
            GITHUB_LIST_LIMIT_MAX
        );
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
    let (app_state, queue_receiver, discord_presence_receiver) = AppState::new();
    let pane_registry = Arc::clone(&app_state.panes);
    let automation_state = Arc::clone(&app_state.automation);
    let queue_receiver = Arc::new(StdMutex::new(Some(queue_receiver)));
    let discord_presence_receiver = Arc::new(StdMutex::new(Some(discord_presence_receiver)));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(app_state)
        .setup({
            let pane_registry = Arc::clone(&pane_registry);
            let automation_state = Arc::clone(&automation_state);
            let queue_receiver = Arc::clone(&queue_receiver);
            let discord_presence_receiver = Arc::clone(&discord_presence_receiver);
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
                if let Ok(mut guard) = discord_presence_receiver.lock() {
                    if let Some(receiver) = guard.take() {
                        start_discord_presence_worker(receiver);
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
            set_discord_presence_enabled,
            sync_automation_workspaces,
            automation_report,
            resolve_repo_context,
            git_status,
            git_diff,
            git_stage_paths,
            git_unstage_paths,
            git_discard_paths,
            git_commit,
            git_fetch,
            git_pull,
            git_push,
            git_list_branches,
            git_checkout_branch,
            git_create_branch,
            git_delete_branch,
            gh_list_prs,
            gh_pr_detail,
            gh_pr_checkout,
            gh_pr_comment,
            gh_pr_merge_squash,
            gh_list_issues,
            gh_issue_detail,
            gh_issue_comment,
            gh_issue_edit_labels,
            gh_issue_edit_assignees,
            gh_list_workflows,
            gh_list_runs,
            gh_run_detail,
            gh_run_rerun_failed,
            gh_run_cancel,
            create_worktree,
            list_worktrees,
            remove_worktree,
            prune_worktrees
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
