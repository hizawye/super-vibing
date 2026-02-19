import type {
  AutomationWorkspaceSnapshot,
  GitBranchInfo,
  GitCommandResponse,
  GitDiffResponse,
  GitHubIssueSummary,
  GitHubPrSummary,
  GitHubRunSummary,
  GitHubWorkflowSummary,
  GitStatusSnapshot,
  KanbanRunLogsRequest,
  KanbanRunLogsResponse,
  KanbanTask,
  KanbanTaskRun,
  PaneCommandResult,
  PaneEvent,
  PruneWorktreesResponse,
  RepoContext,
  RuntimeStats,
  SpawnPaneRequest,
  SpawnPaneResponse,
  WorktreeEntry,
  WritePaneInputRequest,
} from "../types";

interface E2ePaneRuntime {
  paneId: string;
  cwd: string;
  shell: string;
  suspended: boolean;
}

interface E2eKanbanState {
  tasks: Map<string, KanbanTask>;
  runs: Map<string, KanbanTaskRun>;
  activeRunByPaneId: Record<string, string>;
  runLogs: Record<string, string>;
  sequenceByRunId: Record<string, number>;
}

interface E2eState {
  panes: Map<string, E2ePaneRuntime>;
  worktrees: Map<string, WorktreeEntry>;
  branchByPath: Map<string, string>;
  automationWorkspaces: AutomationWorkspaceSnapshot[];
  kanban: E2eKanbanState;
  runCounter: number;
  worktreeCounter: number;
}

const MAIN_REPO_ROOT = "/repo";
const MAIN_WORKTREE_PATH = "/repo";
const MAX_KANBAN_LOG_CHARS = 64 * 1024;

const state: E2eState = createDefaultState();

function createDefaultState(): E2eState {
  const mainWorktree: WorktreeEntry = {
    id: "wt-main",
    repoRoot: MAIN_REPO_ROOT,
    branch: "main",
    worktreePath: MAIN_WORKTREE_PATH,
    head: "e2e-head",
    isMainWorktree: true,
    isDetached: false,
    isLocked: false,
    isPrunable: false,
    isDirty: false,
  };

  return {
    panes: new Map(),
    worktrees: new Map([[normalizePath(mainWorktree.worktreePath), mainWorktree]]),
    branchByPath: new Map([[normalizePath(MAIN_WORKTREE_PATH), "main"]]),
    automationWorkspaces: [],
    kanban: {
      tasks: new Map(),
      runs: new Map(),
      activeRunByPaneId: {},
      runLogs: {},
      sequenceByRunId: {},
    },
    runCounter: 0,
    worktreeCounter: 1,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
}

function safeBranchSegment(branch: string): string {
  return branch.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "branch";
}

function runtimePaneAlias(workspaceId: string, paneId: string): string {
  return `${workspaceId}::${paneId}`;
}

function paneLogicalId(paneId: string): string {
  const separator = paneId.indexOf("::");
  return separator >= 0 ? paneId.slice(separator + 2) : paneId;
}

function paneWorkspaceId(paneId: string): string | null {
  const separator = paneId.indexOf("::");
  return separator >= 0 ? paneId.slice(0, separator) : null;
}

function appendRunLog(runId: string, chunk: string): void {
  if (!chunk) {
    return;
  }
  const previous = state.kanban.runLogs[runId] ?? "";
  const next = `${previous}${chunk}`;
  state.kanban.runLogs[runId] = next.length > MAX_KANBAN_LOG_CHARS
    ? next.slice(-MAX_KANBAN_LOG_CHARS)
    : next;
}

function ensurePaneRuntime(request: SpawnPaneRequest): E2ePaneRuntime {
  const current = state.panes.get(request.paneId);
  if (current) {
    return current;
  }

  const pane: E2ePaneRuntime = {
    paneId: request.paneId,
    cwd: request.cwd?.trim() || MAIN_WORKTREE_PATH,
    shell: request.shell?.trim() || "/bin/bash",
    suspended: false,
  };
  state.panes.set(request.paneId, pane);
  return pane;
}

function addKanbanRunAliases(run: KanbanTaskRun): void {
  state.kanban.activeRunByPaneId[run.paneId] = run.id;
  state.kanban.activeRunByPaneId[runtimePaneAlias(run.workspaceId, run.paneId)] = run.id;
}

function clearKanbanRunAliases(run: KanbanTaskRun): void {
  for (const [paneId, runId] of Object.entries(state.kanban.activeRunByPaneId)) {
    if (runId === run.id) {
      delete state.kanban.activeRunByPaneId[paneId];
    }
  }

  delete state.kanban.activeRunByPaneId[run.paneId];
  delete state.kanban.activeRunByPaneId[runtimePaneAlias(run.workspaceId, run.paneId)];
}

function applyKanbanSnapshot(tasks: KanbanTask[], runs: KanbanTaskRun[]): void {
  state.kanban.tasks = new Map(tasks.map((task) => [task.id, { ...task }]));
  state.kanban.runs = new Map(runs.map((run) => [run.id, { ...run }]));
  state.kanban.activeRunByPaneId = {};
  for (const run of runs) {
    if (run.status === "running") {
      addKanbanRunAliases(run);
    }
    if (!(run.id in state.kanban.runLogs)) {
      state.kanban.runLogs[run.id] = "";
    }
  }
}

function sortedRuns(): KanbanTaskRun[] {
  return Array.from(state.kanban.runs.values()).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

function sortedTasks(): KanbanTask[] {
  return Array.from(state.kanban.tasks.values()).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function resolveBranch(path: string): string {
  const normalized = normalizePath(path);
  return state.branchByPath.get(normalized) ?? "main";
}

function resolveRepo(cwd: string): RepoContext {
  const normalized = normalizePath(cwd || MAIN_WORKTREE_PATH);
  return {
    isGitRepo: true,
    repoRoot: MAIN_REPO_ROOT,
    worktreePath: normalized,
    branch: resolveBranch(normalized),
  };
}

function runById(runId: string): KanbanTaskRun {
  const run = state.kanban.runs.get(runId);
  if (!run) {
    throw new Error(`kanban run '${runId}' not found`);
  }
  return run;
}

function defaultGitCommandResponse(output = "ok"): GitCommandResponse {
  return { output };
}

function defaultGitStatus(repoRoot: string): GitStatusSnapshot {
  return {
    repoRoot,
    branch: resolveBranch(repoRoot),
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    files: [],
  };
}

export function isE2eRuntime(): boolean {
  return import.meta.env.VITE_E2E === "1";
}

export async function e2eSpawnPane(
  request: SpawnPaneRequest,
  emitPaneEvent: (event: PaneEvent) => void,
): Promise<SpawnPaneResponse> {
  const pane = ensurePaneRuntime(request);

  if (request.initCommand && request.initCommand.trim().length > 0) {
    emitPaneEvent({
      paneId: request.paneId,
      kind: "output",
      payload: `$ ${request.initCommand.trim()}\n`,
    });
  }

  return {
    paneId: pane.paneId,
    cwd: pane.cwd,
    shell: pane.shell,
  };
}

export function e2ePickDirectory(defaultPath?: string): string {
  const normalized = defaultPath?.trim();
  return normalized && normalized.length > 0 ? normalized : MAIN_WORKTREE_PATH;
}

export async function e2eInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const request = (args?.request ?? {}) as Record<string, unknown>;

  switch (command) {
    case "get_default_cwd":
      return MAIN_WORKTREE_PATH as T;

    case "get_current_branch":
      return resolveBranch(String(request.cwd ?? MAIN_WORKTREE_PATH)) as T;

    case "write_pane_input": {
      const input = request as unknown as WritePaneInputRequest;
      const paneId = String(input.paneId);
      const pane = state.panes.get(paneId) ?? ensurePaneRuntime({ paneId });
      pane.cwd = pane.cwd || MAIN_WORKTREE_PATH;
      const logicalPaneId = paneLogicalId(paneId);
      const workspaceId = paneWorkspaceId(paneId);
      const activeRunId = state.kanban.activeRunByPaneId[paneId] ?? state.kanban.activeRunByPaneId[logicalPaneId];
      if (activeRunId) {
        const prompt = input.execute ? "$ " : "";
        appendRunLog(activeRunId, `${prompt}${input.data}${input.execute ? "\n" : ""}`);
      }
      if (workspaceId && activeRunId) {
        const run = runById(activeRunId);
        state.kanban.activeRunByPaneId[runtimePaneAlias(workspaceId, logicalPaneId)] = run.id;
      }
      return undefined as T;
    }

    case "resize_pane":
      return undefined as T;

    case "close_pane": {
      const paneId = String(request.paneId ?? "");
      state.panes.delete(paneId);
      return undefined as T;
    }

    case "suspend_pane": {
      const paneId = String(request.paneId ?? "");
      const pane = state.panes.get(paneId);
      if (pane) {
        pane.suspended = true;
      }
      return undefined as T;
    }

    case "resume_pane": {
      const paneId = String(request.paneId ?? "");
      const pane = state.panes.get(paneId);
      if (pane) {
        pane.suspended = false;
      }
      return undefined as T;
    }

    case "resolve_repo_context":
      return resolveRepo(String(request.cwd ?? MAIN_WORKTREE_PATH)) as T;

    case "create_worktree": {
      const branch = String(request.branch ?? "feature-e2e");
      const segment = safeBranchSegment(branch);
      const worktreePath = `${MAIN_REPO_ROOT}/.worktrees/${segment}`;
      const entry: WorktreeEntry = {
        id: `wt-${state.worktreeCounter++}`,
        repoRoot: MAIN_REPO_ROOT,
        branch,
        worktreePath,
        head: "e2e-head",
        isMainWorktree: false,
        isDetached: false,
        isLocked: false,
        isPrunable: false,
        isDirty: false,
      };
      state.worktrees.set(normalizePath(worktreePath), entry);
      state.branchByPath.set(normalizePath(worktreePath), branch);
      return entry as T;
    }

    case "list_worktrees":
      return Array.from(state.worktrees.values()) as T;

    case "remove_worktree": {
      const worktreePath = normalizePath(String(request.worktreePath ?? ""));
      const entry = state.worktrees.get(worktreePath);
      if (!entry) {
        throw new Error(`worktree '${worktreePath}' not found`);
      }
      state.worktrees.delete(worktreePath);
      state.branchByPath.delete(worktreePath);
      return {
        worktreePath: entry.worktreePath,
        branch: entry.branch,
        branchDeleted: Boolean(request.deleteBranch),
      } as T;
    }

    case "prune_worktrees": {
      const response: PruneWorktreesResponse = {
        dryRun: Boolean(request.dryRun),
        paths: [],
        output: "",
      };
      return response as T;
    }

    case "run_global_command": {
      const paneIds = Array.isArray(request.paneIds) ? request.paneIds.map(String) : [];
      const results: PaneCommandResult[] = paneIds.map((paneId) => ({ paneId, ok: true }));
      return results as T;
    }

    case "get_runtime_stats": {
      const activePanes = Array.from(state.panes.values()).filter((pane) => !pane.suspended).length;
      const suspendedPanes = Array.from(state.panes.values()).filter((pane) => pane.suspended).length;
      const runtimeStats: RuntimeStats = { activePanes, suspendedPanes };
      return runtimeStats as T;
    }

    case "restart_app":
      return undefined as T;

    case "set_discord_presence_enabled":
      return undefined as T;

    case "sync_automation_workspaces":
      state.automationWorkspaces = Array.isArray(request.workspaces)
        ? (request.workspaces as AutomationWorkspaceSnapshot[]).map((workspace) => ({ ...workspace }))
        : [];
      return undefined as T;

    case "automation_report":
      return undefined as T;

    case "sync_kanban_state":
      applyKanbanSnapshot(
        Array.isArray(request.tasks) ? (request.tasks as KanbanTask[]) : [],
        Array.isArray(request.runs) ? (request.runs as KanbanTaskRun[]) : [],
      );
      return undefined as T;

    case "kanban_start_run": {
      const taskId = String(request.taskId ?? "");
      const task = state.kanban.tasks.get(taskId);
      if (!task) {
        throw new Error(`kanban task '${taskId}' not found`);
      }

      for (const runId of Object.values(state.kanban.activeRunByPaneId)) {
        const active = state.kanban.runs.get(runId);
        if (active && (active.taskId === task.id || active.paneId === task.paneId)) {
          throw new Error("a kanban run is already active for this task or pane");
        }
      }

      const run: KanbanTaskRun = {
        id: `kanban-run-${++state.runCounter}`,
        taskId: task.id,
        workspaceId: task.workspaceId,
        paneId: task.paneId,
        command: task.command,
        status: "running",
        startedAt: nowIso(),
        finishedAt: null,
        error: null,
        createdBranch: null,
        createdWorktreePath: null,
      };
      state.kanban.runs.set(run.id, run);
      addKanbanRunAliases(run);
      appendRunLog(run.id, `[${run.startedAt}] run started\n`);
      return run as T;
    }

    case "kanban_complete_run": {
      const runId = String(request.runId ?? "");
      const status = String(request.status ?? "failed") as KanbanTaskRun["status"];
      const previous = runById(runId);
      const run: KanbanTaskRun = {
        ...previous,
        status: status === "running" ? "failed" : status,
        finishedAt: nowIso(),
        error: request.error ? String(request.error) : null,
      };
      state.kanban.runs.set(runId, run);
      clearKanbanRunAliases(run);
      appendRunLog(runId, `[${run.finishedAt}] run ${run.status}${run.error ? `: ${run.error}` : ""}\n`);
      return run as T;
    }

    case "kanban_run_logs": {
      const logRequest = request as unknown as KanbanRunLogsRequest;
      const runId = String(logRequest.runId ?? "");
      const run = runById(runId);
      const cursor = Math.max(0, Number(logRequest.cursor ?? 0));
      const limit = Math.max(1, Number(logRequest.limit ?? 8192));
      const text = state.kanban.runLogs[runId] ?? "";
      const nextCursor = Math.min(text.length, cursor + limit);
      const chunk = text.slice(cursor, nextCursor);
      const sequence = (state.kanban.sequenceByRunId[runId] ?? 0) + 1;
      state.kanban.sequenceByRunId[runId] = sequence;
      const response: KanbanRunLogsResponse = {
        runId,
        nextCursor,
        done: run.status !== "running" && nextCursor >= text.length,
        chunks: chunk.length > 0
          ? [
              {
                sequence,
                runId,
                paneId: run.paneId,
                timestamp: nowIso(),
                chunk,
              },
            ]
          : [],
      };
      return response as T;
    }

    case "kanban_state_snapshot":
      return {
        tasks: sortedTasks(),
        runs: sortedRuns(),
        activeRunByPaneId: { ...state.kanban.activeRunByPaneId },
      } as T;

    case "git_status":
      return defaultGitStatus(String(request.repoRoot ?? MAIN_REPO_ROOT)) as T;

    case "git_diff":
      return {
        path: String(request.path ?? ""),
        staged: Boolean(request.staged),
        patch: "",
      } as GitDiffResponse as T;

    case "git_stage_paths":
    case "git_unstage_paths":
    case "git_discard_paths":
    case "git_commit":
    case "git_fetch":
    case "git_pull":
    case "git_push":
    case "git_checkout_branch":
    case "git_create_branch":
    case "git_delete_branch":
    case "gh_pr_checkout":
    case "gh_pr_comment":
    case "gh_pr_merge_squash":
    case "gh_issue_comment":
    case "gh_issue_edit_labels":
    case "gh_issue_edit_assignees":
    case "gh_run_rerun_failed":
    case "gh_run_cancel":
      return defaultGitCommandResponse() as T;

    case "git_list_branches": {
      const repoRoot = String(request.repoRoot ?? MAIN_REPO_ROOT);
      const branch = resolveBranch(repoRoot);
      const branches: GitBranchInfo[] = [
        {
          name: branch,
          isCurrent: true,
          upstream: `origin/${branch}`,
          commit: "e2e-commit",
          subject: "E2E branch",
        },
        {
          name: "main",
          isCurrent: branch === "main",
          upstream: "origin/main",
          commit: "e2e-main",
          subject: "Main branch",
        },
      ];
      return branches as T;
    }

    case "gh_list_prs":
      return [] as GitHubPrSummary[] as T;

    case "gh_pr_detail":
      return {} as T;

    case "gh_list_issues":
      return [] as GitHubIssueSummary[] as T;

    case "gh_issue_detail":
      return {} as T;

    case "gh_list_workflows":
      return [] as GitHubWorkflowSummary[] as T;

    case "gh_list_runs":
      return [] as GitHubRunSummary[] as T;

    case "gh_run_detail":
      return {} as T;

    default:
      throw new Error(`unsupported e2e tauri command '${command}'`);
  }
}
