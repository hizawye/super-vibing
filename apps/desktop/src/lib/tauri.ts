import { Channel, invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { e2eInvoke, e2ePickDirectory, e2eSpawnPane, isE2eRuntime } from "./tauri-e2e";
import type {
  AutomationReportRequest,
  AutomationWorkspaceSnapshot,
  KanbanCompleteRunRequest,
  KanbanRunLogsRequest,
  KanbanRunLogsResponse,
  KanbanStartRunRequest,
  KanbanStateSnapshot,
  KanbanTaskRun,
  SyncKanbanStateRequest,
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
const E2E_RUNTIME = isE2eRuntime();

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (E2E_RUNTIME) {
    return e2eInvoke<T>(command, args);
  }

  return invoke<T>(command, args);
}

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
  return invokeCommand<string>("get_default_cwd");
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  return invokeCommand<string>("get_current_branch", { request: { cwd } });
}

export async function spawnPane(request: SpawnPaneRequest): Promise<SpawnPaneResponse> {
  if (E2E_RUNTIME) {
    return e2eSpawnPane(request, emitPaneEvent);
  }

  const output = new Channel<PaneEvent>((event) => {
    emitPaneEvent(event);
  });

  return invokeCommand<SpawnPaneResponse>("spawn_pane", { request, output });
}

export async function writePaneInput(request: WritePaneInputRequest): Promise<void> {
  await invokeCommand("write_pane_input", { request });
}

export async function resizePane(request: ResizePaneRequest): Promise<void> {
  await invokeCommand("resize_pane", { request });
}

export async function closePane(paneId: string): Promise<void> {
  await invokeCommand("close_pane", { request: { paneId } });
}

export async function suspendPane(paneId: string): Promise<void> {
  await invokeCommand("suspend_pane", { request: { paneId } });
}

export async function resumePane(paneId: string): Promise<void> {
  await invokeCommand("resume_pane", { request: { paneId } });
}

export async function resolveRepoContext(cwd: string): Promise<RepoContext> {
  return invokeCommand<RepoContext>("resolve_repo_context", { request: { cwd } });
}

export async function createWorktree(request: CreateWorktreeRequest): Promise<WorktreeEntry> {
  return invokeCommand<WorktreeEntry>("create_worktree", { request });
}

export async function listWorktrees(repoRoot: string): Promise<WorktreeEntry[]> {
  return invokeCommand<WorktreeEntry[]>("list_worktrees", { request: { repoRoot } });
}

export async function removeWorktree(request: RemoveWorktreeRequest): Promise<RemoveWorktreeResponse> {
  return invokeCommand<RemoveWorktreeResponse>("remove_worktree", { request });
}

export async function pruneWorktrees(request: PruneWorktreesRequest): Promise<PruneWorktreesResponse> {
  return invokeCommand<PruneWorktreesResponse>("prune_worktrees", { request });
}

export async function runGlobalCommand(
  request: GlobalCommandRequest,
): Promise<PaneCommandResult[]> {
  return invokeCommand<PaneCommandResult[]>("run_global_command", { request });
}

export async function getRuntimeStats(): Promise<RuntimeStats> {
  return invokeCommand<RuntimeStats>("get_runtime_stats");
}

export async function restartApp(): Promise<void> {
  await invokeCommand("restart_app");
}

export async function setDiscordPresenceEnabled(enabled: boolean): Promise<void> {
  await invokeCommand("set_discord_presence_enabled", { request: { enabled } });
}

export async function pickDirectory(defaultPath?: string): Promise<string | null> {
  if (E2E_RUNTIME) {
    return e2ePickDirectory(defaultPath);
  }

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
  await invokeCommand("sync_automation_workspaces", { request: { workspaces } });
}

export async function reportAutomationResult(request: AutomationReportRequest): Promise<void> {
  await invokeCommand("automation_report", { request });
}

export async function syncKanbanState(request: SyncKanbanStateRequest): Promise<void> {
  await invokeCommand("sync_kanban_state", { request });
}

export async function startKanbanRun(request: KanbanStartRunRequest): Promise<KanbanTaskRun> {
  return invokeCommand<KanbanTaskRun>("kanban_start_run", { request });
}

export async function completeKanbanRun(request: KanbanCompleteRunRequest): Promise<KanbanTaskRun> {
  return invokeCommand<KanbanTaskRun>("kanban_complete_run", { request });
}

export async function getKanbanRunLogs(request: KanbanRunLogsRequest): Promise<KanbanRunLogsResponse> {
  return invokeCommand<KanbanRunLogsResponse>("kanban_run_logs", { request });
}

export async function getKanbanState(): Promise<KanbanStateSnapshot> {
  return invokeCommand<KanbanStateSnapshot>("kanban_state_snapshot");
}

export async function gitStatus(request: GitRepoRequest): Promise<GitStatusSnapshot> {
  return invokeCommand<GitStatusSnapshot>("git_status", { request });
}

export async function gitDiff(request: GitDiffRequest): Promise<GitDiffResponse> {
  return invokeCommand<GitDiffResponse>("git_diff", { request });
}

export async function gitStagePaths(request: GitPathsRequest): Promise<GitCommandResponse> {
  return invokeCommand<GitCommandResponse>("git_stage_paths", { request });
}

export async function gitUnstagePaths(request: GitPathsRequest): Promise<GitCommandResponse> {
  return invokeCommand<GitCommandResponse>("git_unstage_paths", { request });
}

export async function gitDiscardPaths(request: GitDiscardPathsRequest): Promise<GitCommandResponse> {
  return invokeCommand<GitCommandResponse>("git_discard_paths", { request });
}

export async function gitCommit(request: GitCommitRequest): Promise<GitCommandResponse> {
  return invokeCommand<GitCommandResponse>("git_commit", { request });
}

export async function gitFetch(request: GitRepoRequest): Promise<GitCommandResponse> {
  return invokeCommand<GitCommandResponse>("git_fetch", { request });
}

export async function gitPull(request: GitRepoRequest): Promise<GitCommandResponse> {
  return invokeCommand<GitCommandResponse>("git_pull", { request });
}

export async function gitPush(request: GitRepoRequest): Promise<GitCommandResponse> {
  return invokeCommand<GitCommandResponse>("git_push", { request });
}

export async function gitListBranches(request: GitRepoRequest): Promise<GitBranchInfo[]> {
  return invokeCommand<GitBranchInfo[]>("git_list_branches", { request });
}

export async function gitCheckoutBranch(request: GitCheckoutBranchRequest): Promise<GitCommandResponse> {
  return invokeCommand<GitCommandResponse>("git_checkout_branch", { request });
}

export async function gitCreateBranch(request: GitCreateBranchRequest): Promise<GitCommandResponse> {
  return invokeCommand<GitCommandResponse>("git_create_branch", { request });
}

export async function gitDeleteBranch(request: GitDeleteBranchRequest): Promise<GitCommandResponse> {
  return invokeCommand<GitCommandResponse>("git_delete_branch", { request });
}

export async function ghListPrs(request: GitHubListRequest): Promise<GitHubPrSummary[]> {
  return invokeCommand<GitHubPrSummary[]>("gh_list_prs", { request });
}

export async function ghPrDetail(request: GitHubPrRequest): Promise<unknown> {
  return invokeCommand<unknown>("gh_pr_detail", { request });
}

export async function ghPrCheckout(request: GitHubPrRequest): Promise<GitCommandResponse> {
  return invokeCommand<GitCommandResponse>("gh_pr_checkout", { request });
}

export async function ghPrComment(request: GitHubPrCommentRequest): Promise<GitCommandResponse> {
  return invokeCommand<GitCommandResponse>("gh_pr_comment", { request });
}

export async function ghPrMergeSquash(request: GitHubPrMergeRequest): Promise<GitCommandResponse> {
  return invokeCommand<GitCommandResponse>("gh_pr_merge_squash", { request });
}

export async function ghListIssues(request: GitHubListRequest): Promise<GitHubIssueSummary[]> {
  return invokeCommand<GitHubIssueSummary[]>("gh_list_issues", { request });
}

export async function ghIssueDetail(request: GitHubIssueRequest): Promise<unknown> {
  return invokeCommand<unknown>("gh_issue_detail", { request });
}

export async function ghIssueComment(request: GitHubIssueCommentRequest): Promise<GitCommandResponse> {
  return invokeCommand<GitCommandResponse>("gh_issue_comment", { request });
}

export async function ghIssueEditLabels(
  request: GitHubIssueEditLabelsRequest,
): Promise<GitCommandResponse> {
  return invokeCommand<GitCommandResponse>("gh_issue_edit_labels", { request });
}

export async function ghIssueEditAssignees(
  request: GitHubIssueEditAssigneesRequest,
): Promise<GitCommandResponse> {
  return invokeCommand<GitCommandResponse>("gh_issue_edit_assignees", { request });
}

export async function ghListWorkflows(request: GitHubListRequest): Promise<GitHubWorkflowSummary[]> {
  return invokeCommand<GitHubWorkflowSummary[]>("gh_list_workflows", { request });
}

export async function ghListRuns(request: GitHubListRequest): Promise<GitHubRunSummary[]> {
  return invokeCommand<GitHubRunSummary[]>("gh_list_runs", { request });
}

export async function ghRunDetail(request: GitHubRunRequest): Promise<unknown> {
  return invokeCommand<unknown>("gh_run_detail", { request });
}

export async function ghRunRerunFailed(request: GitHubRunRequest): Promise<GitCommandResponse> {
  return invokeCommand<GitCommandResponse>("gh_run_rerun_failed", { request });
}

export async function ghRunCancel(request: GitHubRunRequest): Promise<GitCommandResponse> {
  return invokeCommand<GitCommandResponse>("gh_run_cancel", { request });
}
