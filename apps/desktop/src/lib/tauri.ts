import { Channel, invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  AutomationReportRequest,
  AutomationWorkspaceSnapshot,
  CreateWorktreeRequest,
  GitBranchInfo,
  GitCheckoutBranchRequest,
  GitCommandResponse,
  GitCommitRequest,
  GitCreateBranchRequest,
  GitDeleteBranchRequest,
  GitDiffRequest,
  GitDiffResponse,
  GitDiscardPathsRequest,
  GitHubIssueCommentRequest,
  GitHubIssueEditAssigneesRequest,
  GitHubIssueEditLabelsRequest,
  GitHubIssueRequest,
  GitHubIssueSummary,
  GitHubListRequest,
  GitHubPrCommentRequest,
  GitHubPrMergeRequest,
  GitHubPrRequest,
  GitHubPrSummary,
  GitHubRunRequest,
  GitHubRunSummary,
  GitHubWorkflowSummary,
  GitPathsRequest,
  GitRepoRequest,
  GitStatusSnapshot,
  GlobalCommandRequest,
  PaneCommandResult,
  PaneEvent,
  PruneWorktreesRequest,
  PruneWorktreesResponse,
  RemoveWorktreeRequest,
  RemoveWorktreeResponse,
  ResizePaneRequest,
  RepoContext,
  RuntimeStats,
  SpawnPaneRequest,
  SpawnPaneResponse,
  WorktreeEntry,
  WritePaneInputRequest,
} from "../types";

type PaneEventListener = (event: PaneEvent) => void;

const paneListeners = new Map<string, Set<PaneEventListener>>();

function emitPaneEvent(event: PaneEvent): void {
  const listeners = paneListeners.get(event.paneId);
  if (!listeners) {
    return;
  }
  listeners.forEach((listener) => listener(event));
}

export function subscribeToPaneEvents(paneId: string, listener: PaneEventListener): () => void {
  const listeners = paneListeners.get(paneId) ?? new Set<PaneEventListener>();
  listeners.add(listener);
  paneListeners.set(paneId, listeners);

  return () => {
    const active = paneListeners.get(paneId);
    if (!active) {
      return;
    }
    active.delete(listener);
    if (active.size === 0) {
      paneListeners.delete(paneId);
    }
  };
}

export async function getDefaultCwd(): Promise<string> {
  return invoke<string>("get_default_cwd");
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  return invoke<string>("get_current_branch", { request: { cwd } });
}

export async function spawnPane(request: SpawnPaneRequest): Promise<SpawnPaneResponse> {
  const output = new Channel<PaneEvent>((event) => {
    emitPaneEvent(event);
  });

  return invoke<SpawnPaneResponse>("spawn_pane", { request, output });
}

export async function writePaneInput(request: WritePaneInputRequest): Promise<void> {
  await invoke("write_pane_input", { request });
}

export async function resizePane(request: ResizePaneRequest): Promise<void> {
  await invoke("resize_pane", { request });
}

export async function closePane(paneId: string): Promise<void> {
  await invoke("close_pane", { request: { paneId } });
}

export async function suspendPane(paneId: string): Promise<void> {
  await invoke("suspend_pane", { request: { paneId } });
}

export async function resumePane(paneId: string): Promise<void> {
  await invoke("resume_pane", { request: { paneId } });
}

export async function resolveRepoContext(cwd: string): Promise<RepoContext> {
  return invoke<RepoContext>("resolve_repo_context", { request: { cwd } });
}

export async function createWorktree(request: CreateWorktreeRequest): Promise<WorktreeEntry> {
  return invoke<WorktreeEntry>("create_worktree", { request });
}

export async function listWorktrees(repoRoot: string): Promise<WorktreeEntry[]> {
  return invoke<WorktreeEntry[]>("list_worktrees", { request: { repoRoot } });
}

export async function removeWorktree(request: RemoveWorktreeRequest): Promise<RemoveWorktreeResponse> {
  return invoke<RemoveWorktreeResponse>("remove_worktree", { request });
}

export async function pruneWorktrees(request: PruneWorktreesRequest): Promise<PruneWorktreesResponse> {
  return invoke<PruneWorktreesResponse>("prune_worktrees", { request });
}

export async function runGlobalCommand(
  request: GlobalCommandRequest,
): Promise<PaneCommandResult[]> {
  return invoke<PaneCommandResult[]>("run_global_command", { request });
}

export async function getRuntimeStats(): Promise<RuntimeStats> {
  return invoke<RuntimeStats>("get_runtime_stats");
}

export async function restartApp(): Promise<void> {
  await invoke("restart_app");
}

export async function setDiscordPresenceEnabled(enabled: boolean): Promise<void> {
  await invoke("set_discord_presence_enabled", { request: { enabled } });
}

export async function pickDirectory(defaultPath?: string): Promise<string | null> {
  const normalizedDefaultPath = defaultPath?.trim();
  const selection = await openDialog({
    directory: true,
    multiple: false,
    defaultPath: normalizedDefaultPath && normalizedDefaultPath.length > 0
      ? normalizedDefaultPath
      : undefined,
  });

  return typeof selection === "string" ? selection : null;
}

export async function syncAutomationWorkspaces(workspaces: AutomationWorkspaceSnapshot[]): Promise<void> {
  await invoke("sync_automation_workspaces", { request: { workspaces } });
}

export async function reportAutomationResult(request: AutomationReportRequest): Promise<void> {
  await invoke("automation_report", { request });
}

export async function gitStatus(request: GitRepoRequest): Promise<GitStatusSnapshot> {
  return invoke<GitStatusSnapshot>("git_status", { request });
}

export async function gitDiff(request: GitDiffRequest): Promise<GitDiffResponse> {
  return invoke<GitDiffResponse>("git_diff", { request });
}

export async function gitStagePaths(request: GitPathsRequest): Promise<GitCommandResponse> {
  return invoke<GitCommandResponse>("git_stage_paths", { request });
}

export async function gitUnstagePaths(request: GitPathsRequest): Promise<GitCommandResponse> {
  return invoke<GitCommandResponse>("git_unstage_paths", { request });
}

export async function gitDiscardPaths(request: GitDiscardPathsRequest): Promise<GitCommandResponse> {
  return invoke<GitCommandResponse>("git_discard_paths", { request });
}

export async function gitCommit(request: GitCommitRequest): Promise<GitCommandResponse> {
  return invoke<GitCommandResponse>("git_commit", { request });
}

export async function gitFetch(request: GitRepoRequest): Promise<GitCommandResponse> {
  return invoke<GitCommandResponse>("git_fetch", { request });
}

export async function gitPull(request: GitRepoRequest): Promise<GitCommandResponse> {
  return invoke<GitCommandResponse>("git_pull", { request });
}

export async function gitPush(request: GitRepoRequest): Promise<GitCommandResponse> {
  return invoke<GitCommandResponse>("git_push", { request });
}

export async function gitListBranches(request: GitRepoRequest): Promise<GitBranchInfo[]> {
  return invoke<GitBranchInfo[]>("git_list_branches", { request });
}

export async function gitCheckoutBranch(request: GitCheckoutBranchRequest): Promise<GitCommandResponse> {
  return invoke<GitCommandResponse>("git_checkout_branch", { request });
}

export async function gitCreateBranch(request: GitCreateBranchRequest): Promise<GitCommandResponse> {
  return invoke<GitCommandResponse>("git_create_branch", { request });
}

export async function gitDeleteBranch(request: GitDeleteBranchRequest): Promise<GitCommandResponse> {
  return invoke<GitCommandResponse>("git_delete_branch", { request });
}

export async function ghListPrs(request: GitHubListRequest): Promise<GitHubPrSummary[]> {
  return invoke<GitHubPrSummary[]>("gh_list_prs", { request });
}

export async function ghPrDetail(request: GitHubPrRequest): Promise<unknown> {
  return invoke<unknown>("gh_pr_detail", { request });
}

export async function ghPrCheckout(request: GitHubPrRequest): Promise<GitCommandResponse> {
  return invoke<GitCommandResponse>("gh_pr_checkout", { request });
}

export async function ghPrComment(request: GitHubPrCommentRequest): Promise<GitCommandResponse> {
  return invoke<GitCommandResponse>("gh_pr_comment", { request });
}

export async function ghPrMergeSquash(request: GitHubPrMergeRequest): Promise<GitCommandResponse> {
  return invoke<GitCommandResponse>("gh_pr_merge_squash", { request });
}

export async function ghListIssues(request: GitHubListRequest): Promise<GitHubIssueSummary[]> {
  return invoke<GitHubIssueSummary[]>("gh_list_issues", { request });
}

export async function ghIssueDetail(request: GitHubIssueRequest): Promise<unknown> {
  return invoke<unknown>("gh_issue_detail", { request });
}

export async function ghIssueComment(request: GitHubIssueCommentRequest): Promise<GitCommandResponse> {
  return invoke<GitCommandResponse>("gh_issue_comment", { request });
}

export async function ghIssueEditLabels(
  request: GitHubIssueEditLabelsRequest,
): Promise<GitCommandResponse> {
  return invoke<GitCommandResponse>("gh_issue_edit_labels", { request });
}

export async function ghIssueEditAssignees(
  request: GitHubIssueEditAssigneesRequest,
): Promise<GitCommandResponse> {
  return invoke<GitCommandResponse>("gh_issue_edit_assignees", { request });
}

export async function ghListWorkflows(request: GitHubListRequest): Promise<GitHubWorkflowSummary[]> {
  return invoke<GitHubWorkflowSummary[]>("gh_list_workflows", { request });
}

export async function ghListRuns(request: GitHubListRequest): Promise<GitHubRunSummary[]> {
  return invoke<GitHubRunSummary[]>("gh_list_runs", { request });
}

export async function ghRunDetail(request: GitHubRunRequest): Promise<unknown> {
  return invoke<unknown>("gh_run_detail", { request });
}

export async function ghRunRerunFailed(request: GitHubRunRequest): Promise<GitCommandResponse> {
  return invoke<GitCommandResponse>("gh_run_rerun_failed", { request });
}

export async function ghRunCancel(request: GitHubRunRequest): Promise<GitCommandResponse> {
  return invoke<GitCommandResponse>("gh_run_cancel", { request });
}
