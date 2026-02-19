import type {
  AutomationWorkspaceSnapshot,
  GitBranchInfo,
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

const E2E_DEFAULT_CWD = "/tmp/super-vibing-e2e";
const MAIN_REPO_ROOT = `${E2E_DEFAULT_CWD}/repo`;
const MAIN_WORKTREE_PATH = MAIN_REPO_ROOT;
const FEATURE_WORKTREE_PATH = `${MAIN_REPO_ROOT}/worktrees/feature-visual-regression`;
const FIX_WORKTREE_PATH = `${MAIN_REPO_ROOT}/worktrees/fix-ci-annotations`;
const PRUNABLE_WORKTREE_PATH = `${MAIN_REPO_ROOT}/worktrees/wip-prune-me`;
const MAX_KANBAN_LOG_CHARS = 64 * 1024;

const INITIAL_WORKTREES: WorktreeEntry[] = [
  {
    id: "wt-main",
    repoRoot: MAIN_REPO_ROOT,
    branch: "main",
    worktreePath: MAIN_WORKTREE_PATH,
    head: "9f3b1f2",
    isMainWorktree: true,
    isDetached: false,
    isLocked: false,
    isPrunable: false,
    isDirty: false,
  },
  {
    id: "wt-feature",
    repoRoot: MAIN_REPO_ROOT,
    branch: "feature/visual-regression",
    worktreePath: FEATURE_WORKTREE_PATH,
    head: "20bfad1",
    isMainWorktree: false,
    isDetached: false,
    isLocked: false,
    isPrunable: false,
    isDirty: true,
  },
  {
    id: "wt-fix",
    repoRoot: MAIN_REPO_ROOT,
    branch: "fix/ci-annotations",
    worktreePath: FIX_WORKTREE_PATH,
    head: "bcde901",
    isMainWorktree: false,
    isDetached: false,
    isLocked: true,
    lockReason: "rebasing",
    isPrunable: false,
    isDirty: false,
  },
  {
    id: "wt-prunable",
    repoRoot: MAIN_REPO_ROOT,
    branch: "wip/prune-me",
    worktreePath: PRUNABLE_WORKTREE_PATH,
    head: "7ac13ef",
    isMainWorktree: false,
    isDetached: false,
    isLocked: false,
    isPrunable: true,
    pruneReason: "no branch",
    isDirty: false,
  },
];

const E2E_GIT_STATUS_FILES: GitStatusSnapshot["files"] = [
  { path: "apps/desktop/src/lib/tauri.ts", code: "M", staged: true, unstaged: false, untracked: false },
  { path: "tests/visual/shell-regression.spec.ts", code: "A", staged: true, unstaged: false, untracked: false },
  { path: "docs/project-status.md", code: "M", staged: false, unstaged: true, untracked: false },
  { path: "apps/desktop/src/styles.css", code: "M", staged: false, unstaged: true, untracked: false },
  { path: "tests/visual/theme-regression.spec.ts-snapshots", code: "??", staged: false, unstaged: false, untracked: true },
];

const E2E_GIT_BRANCHES: GitBranchInfo[] = [
  {
    name: "main",
    isCurrent: true,
    upstream: "origin/main",
    commit: "9f3b1f2",
    subject: "feat(ui): stabilize compact shadcn baseline",
  },
  {
    name: "feature/visual-regression",
    isCurrent: false,
    upstream: "origin/feature/visual-regression",
    commit: "20bfad1",
    subject: "test(visual): add settings screenshots",
  },
  {
    name: "fix/ci-annotations",
    isCurrent: false,
    upstream: "origin/fix/ci-annotations",
    commit: "bcde901",
    subject: "ci: upload playwright report on failure",
  },
];

const E2E_GITHUB_PRS: GitHubPrSummary[] = [
  {
    number: 418,
    title: "Add deterministic shell visual snapshots",
    state: "OPEN",
    headRefName: "feature/visual-regression",
    baseRefName: "main",
    isDraft: false,
    updatedAt: "2026-02-19T11:40:00Z",
    url: "https://example.com/super-vibing/pull/418",
    author: { login: "nagara" },
  },
  {
    number: 417,
    title: "Harden E2E runtime fallback paths",
    state: "OPEN",
    headRefName: "fix/ci-annotations",
    baseRefName: "main",
    isDraft: true,
    updatedAt: "2026-02-19T10:12:00Z",
    url: "https://example.com/super-vibing/pull/417",
    author: { login: "buildbot" },
  },
];

const E2E_GITHUB_ISSUES: GitHubIssueSummary[] = [
  {
    number: 291,
    title: "Terminal pane header overflows at narrow widths",
    state: "OPEN",
    updatedAt: "2026-02-19T09:22:00Z",
    url: "https://example.com/super-vibing/issues/291",
    author: { login: "qa-team" },
    labels: [{ name: "ui" }, { name: "accessibility" }],
    assignees: [{ login: "nagara" }],
  },
  {
    number: 288,
    title: "Worktree sync should retry once on transient git errors",
    state: "OPEN",
    updatedAt: "2026-02-18T19:05:00Z",
    url: "https://example.com/super-vibing/issues/288",
    author: { login: "ops" },
    labels: [{ name: "reliability" }],
    assignees: [],
  },
];

const E2E_GITHUB_WORKFLOWS: GitHubWorkflowSummary[] = [
  { id: 1001, name: "CI", state: "active", path: ".github/workflows/ci.yml" },
  { id: 1002, name: "Release", state: "active", path: ".github/workflows/release.yml" },
];

const E2E_GITHUB_RUNS: GitHubRunSummary[] = [
  {
    databaseId: 55102,
    workflowName: "CI",
    displayTitle: "test: visual baselines",
    status: "completed",
    conclusion: "success",
    event: "push",
    headBranch: "feature/visual-regression",
    headSha: "20bfad1",
    number: 812,
    createdAt: "2026-02-19T11:00:00Z",
    updatedAt: "2026-02-19T11:05:00Z",
    url: "https://example.com/super-vibing/actions/runs/55102",
  },
  {
    databaseId: 55101,
    workflowName: "Release",
    displayTitle: "release v0.1.23",
    status: "completed",
    conclusion: "success",
    event: "workflow_dispatch",
    headBranch: "main",
    headSha: "9f3b1f2",
    number: 244,
    createdAt: "2026-02-19T07:15:00Z",
    updatedAt: "2026-02-19T07:21:00Z",
    url: "https://example.com/super-vibing/actions/runs/55101",
  },
];

const state: E2eState = createDefaultState();

function createDefaultState(): E2eState {
  const worktrees = INITIAL_WORKTREES.map((entry) => ({ ...entry }));
  const worktreePairs = worktrees.map((entry) => [normalizePath(entry.worktreePath), entry] as const);
  const branchPairs = worktrees.map((entry) => [normalizePath(entry.worktreePath), entry.branch] as const);

  return {
    panes: new Map(),
    worktrees: new Map(worktreePairs),
    branchByPath: new Map(branchPairs),
    automationWorkspaces: [],
    kanban: {
      tasks: new Map(),
      runs: new Map(),
      activeRunByPaneId: {},
      runLogs: {},
      sequenceByRunId: {},
    },
    runCounter: 0,
    worktreeCounter: worktrees.length + 1,
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

function defaultGitStatus(repoRoot: string): GitStatusSnapshot {
  return {
    repoRoot,
    branch: resolveBranch(MAIN_WORKTREE_PATH),
    upstream: "origin/main",
    ahead: 2,
    behind: 0,
    stagedCount: 2,
    unstagedCount: 2,
    untrackedCount: 1,
    files: E2E_GIT_STATUS_FILES.map((file) => ({ ...file })),
  };
}

export function isE2eRuntime(): boolean {
  return import.meta.env.VITE_E2E === "1";
}

export async function e2eSpawnPane(
  request: SpawnPaneRequest,
  emitPaneEvent: (event: PaneEvent) => void,
): Promise<SpawnPaneResponse> {
  const existed = state.panes.has(request.paneId);
  const pane = ensurePaneRuntime(request);

  if (request.initCommand && request.initCommand.trim().length > 0) {
    emitPaneEvent({
      paneId: request.paneId,
      kind: "output",
      payload: `$ ${request.initCommand.trim()}\n`,
    });
  }
  if (!existed) {
    emitPaneEvent({
      paneId: request.paneId,
      kind: "output",
      payload: ["super-vibing e2e terminal", `cwd: ${pane.cwd}`, "$ "].join("\r\n"),
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
  return normalized && normalized.length > 0 ? normalized : E2E_DEFAULT_CWD;
}

export async function e2eInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const request = (args?.request ?? {}) as Record<string, unknown>;

  switch (command) {
    case "get_default_cwd":
      return E2E_DEFAULT_CWD as T;

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
      const worktreePath = `${MAIN_REPO_ROOT}/worktrees/${segment}`;
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
      const pruneTargets = Array.from(state.worktrees.values()).filter((entry) => entry.isPrunable);
      if (!Boolean(request.dryRun)) {
        for (const target of pruneTargets) {
          const normalized = normalizePath(target.worktreePath);
          state.worktrees.delete(normalized);
          state.branchByPath.delete(normalized);
        }
      }
      const response: PruneWorktreesResponse = {
        dryRun: Boolean(request.dryRun),
        paths: pruneTargets.map((entry) => entry.worktreePath),
        output: pruneTargets.length === 0
          ? "No prunable worktrees found."
          : Boolean(request.dryRun)
            ? `Would prune ${pruneTargets.map((entry) => entry.worktreePath).join(", ")}`
            : `Pruned ${pruneTargets.map((entry) => entry.worktreePath).join(", ")}`,
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
        patch: [
          `diff --git a/${String(request.path ?? "")} b/${String(request.path ?? "")}`,
          `--- a/${String(request.path ?? "")}`,
          `+++ b/${String(request.path ?? "")}`,
          "@@ -1,3 +1,5 @@",
          " import { defineConfig } from \"@playwright/test\";",
          "+const visualMode = \"compact\";",
          "+// e2e mock patch preview",
        ].join("\n"),
      } as GitDiffResponse as T;

    case "git_stage_paths":
      return {
        output: `staged ${Array.isArray(request.paths) ? request.paths.map(String).join(", ") || "selection" : "selection"}`,
      } as T;

    case "git_unstage_paths":
      return {
        output: `unstaged ${Array.isArray(request.paths) ? request.paths.map(String).join(", ") || "selection" : "selection"}`,
      } as T;

    case "git_discard_paths":
      return {
        output: `discarded ${Array.isArray(request.paths) ? request.paths.map(String).join(", ") || "selection" : "selection"}${Boolean(request.force) ? " (forced)" : ""}`,
      } as T;

    case "git_commit":
      return {
        output: `committed in ${String(request.repoRoot ?? MAIN_REPO_ROOT)}: ${String(request.message ?? "")}`,
      } as T;

    case "git_fetch":
      return {
        output: `fetched origin for ${String(request.repoRoot ?? MAIN_REPO_ROOT)}`,
      } as T;

    case "git_pull":
      return {
        output: `already up to date for ${String(request.repoRoot ?? MAIN_REPO_ROOT)}`,
      } as T;

    case "git_push":
      return {
        output: `pushed main -> origin/main (${String(request.repoRoot ?? MAIN_REPO_ROOT)})`,
      } as T;

    case "git_checkout_branch":
      return {
        output: `switched to branch ${String(request.branch ?? "main")}`,
      } as T;

    case "git_create_branch":
      return {
        output: `created branch ${String(request.branch ?? "feature/e2e")}${Boolean(request.checkout) ? " and checked out" : ""}`,
      } as T;

    case "git_delete_branch":
      return {
        output: `deleted branch ${String(request.branch ?? "feature/e2e")}${Boolean(request.force) ? " (forced)" : ""}`,
      } as T;

    case "gh_pr_checkout":
      return {
        output: `checked out PR #${String(request.number ?? "")}`,
      } as T;

    case "gh_pr_comment":
      return {
        output: `commented on PR #${String(request.number ?? "")}`,
      } as T;

    case "gh_pr_merge_squash":
      return {
        output: `squash-merged PR #${String(request.number ?? "")}${Boolean(request.deleteBranch) ? " and deleted branch" : ""}`,
      } as T;

    case "gh_issue_comment":
      return {
        output: `commented on issue #${String(request.number ?? "")}`,
      } as T;

    case "gh_issue_edit_labels":
      return {
        output: `updated labels on issue #${String(request.number ?? "")}`,
      } as T;

    case "gh_issue_edit_assignees":
      return {
        output: `updated assignees on issue #${String(request.number ?? "")}`,
      } as T;

    case "gh_run_rerun_failed":
      return {
        output: `reran failed jobs for run ${String(request.runId ?? "")}`,
      } as T;

    case "gh_run_cancel":
      return {
        output: `canceled run ${String(request.runId ?? "")}`,
      } as T;

    case "git_list_branches": {
      const currentBranch = resolveBranch(String(request.repoRoot ?? MAIN_WORKTREE_PATH));
      const branches = E2E_GIT_BRANCHES.map((branch) => ({
        ...branch,
        isCurrent: branch.name === currentBranch,
      }));
      return branches as T;
    }

    case "gh_list_prs":
      return E2E_GITHUB_PRS.slice(0, Number(request.limit ?? E2E_GITHUB_PRS.length)) as T;

    case "gh_pr_detail":
      return {
        number: Number(request.number ?? 0),
        title: `PR #${Number(request.number ?? 0)} detail`,
        checks: [
          { name: "typecheck", status: "success" },
          { name: "unit", status: "success" },
          { name: "visual", status: "success" },
        ],
        filesChanged: 7,
      } as T;

    case "gh_list_issues":
      return E2E_GITHUB_ISSUES.slice(0, Number(request.limit ?? E2E_GITHUB_ISSUES.length)) as T;

    case "gh_issue_detail":
      return {
        number: Number(request.number ?? 0),
        title: `Issue #${Number(request.number ?? 0)} detail`,
        state: "OPEN",
        body: "Synthetic issue body for visual-regression browser mode.",
      } as T;

    case "gh_list_workflows":
      return E2E_GITHUB_WORKFLOWS.slice(0, Number(request.limit ?? E2E_GITHUB_WORKFLOWS.length)) as T;

    case "gh_list_runs":
      return E2E_GITHUB_RUNS.slice(0, Number(request.limit ?? E2E_GITHUB_RUNS.length)) as T;

    case "gh_run_detail":
      return {
        databaseId: Number(request.runId ?? 0),
        jobs: [
          { name: "frontend", conclusion: "success" },
          { name: "rust", conclusion: "success" },
          { name: "visual", conclusion: "success" },
        ],
      } as T;

    default:
      throw new Error(`unsupported e2e tauri command '${command}'`);
  }
}
