import type { Layout } from "react-grid-layout";

export type PaneStatus = "idle" | "spawning" | "running" | "suspended" | "closed" | "error";

export interface PaneModel {
  id: string;
  title: string;
  cwd: string;
  worktreePath: string;
  shell: string;
  status: PaneStatus;
  lastSubmittedCommand: string;
  error?: string;
}

export type AgentProfileKey = "claude" | "codex" | "gemini" | "cursor" | "opencode";
export type AgentStartupDefaults = Record<AgentProfileKey, string>;

export interface AgentAllocation {
  profile: AgentProfileKey;
  label: string;
  command: string;
  enabled: boolean;
  count: number;
}

export type AppSection = "terminal" | "git" | "worktrees" | "kanban" | "agents" | "prompts" | "settings";
export type LayoutMode = "tiling" | "freeform";
export type ThemeId = "apple-dark" | "apple-light";
export type DensityMode = "comfortable" | "compact";

export interface UiPreferences {
  theme: ThemeId;
  reduceMotion: boolean;
  highContrastAssist: boolean;
  density: DensityMode;
}

export interface WorkspaceRuntime {
  id: string;
  name: string;
  repoRoot: string;
  branch: string;
  worktreePath: string;
  layoutMode: LayoutMode;
  paneCount: number;
  paneOrder: string[];
  panes: Record<string, PaneModel>;
  layouts: Layout[];
  zoomedPaneId: string | null;
  agentAllocation: AgentAllocation[];
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceBootStatus = "idle" | "running" | "paused" | "completed" | "failed" | "canceled";

export interface WorkspaceBootSession {
  workspaceId: string;
  totalAgents: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  status: WorkspaceBootStatus;
  startedAt: string;
  updatedAt: string;
}

export interface SessionState {
  workspaces: WorkspaceRuntime[];
  activeWorkspaceId: string | null;
  activeSection: AppSection;
  echoInput: boolean;
  uiPreferences: UiPreferences;
  agentStartupDefaults?: AgentStartupDefaults;
  discordPresenceEnabled?: boolean;
}

export interface LegacySessionState {
  paneCount: number;
  paneOrder: string[];
  panes: Record<string, PaneModel>;
  layouts: Layout[];
  zoomedPaneId: string | null;
  echoInput: boolean;
  workspaces: WorkspaceTab[];
  activeWorkspaceId: string | null;
}

export interface Snapshot {
  id: string;
  name: string;
  createdAt: string;
  state: SessionState;
}

export interface Blueprint {
  id: string;
  name: string;
  paneCount: number;
  workspacePaths: string[];
  autorunCommands: string[];
  agentAllocation?: AgentAllocation[];
}

export interface PersistedPayload {
  version: number;
  session?: SessionState | LegacySessionState;
  snapshots: Snapshot[];
  blueprints: Blueprint[];
}

export interface SpawnPaneRequest {
  paneId: string;
  cwd?: string;
  shell?: string;
  rows?: number;
  cols?: number;
  initCommand?: string;
  executeInit?: boolean;
}

export interface SpawnPaneResponse {
  paneId: string;
  cwd: string;
  shell: string;
}

export interface WritePaneInputRequest {
  paneId: string;
  data: string;
  execute?: boolean;
}

export interface ResizePaneRequest {
  paneId: string;
  rows: number;
  cols: number;
}

export interface PaneEvent {
  paneId: string;
  kind: "output" | "exit" | "error";
  payload: string;
}

export interface WorkspaceTab {
  id: string;
  repoRoot: string;
  branch: string;
  worktreePath: string;
}

export interface RepoContext {
  isGitRepo: boolean;
  repoRoot: string;
  worktreePath: string;
  branch: string;
}

export type WorktreeCreateMode = "newBranch" | "existingBranch";

export interface WorktreeEntry {
  id: string;
  repoRoot: string;
  branch: string;
  worktreePath: string;
  head: string;
  isMainWorktree: boolean;
  isDetached: boolean;
  isLocked: boolean;
  lockReason?: string;
  isPrunable: boolean;
  pruneReason?: string;
  isDirty: boolean;
}

export interface GitStatusFile {
  path: string;
  code: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export interface GitStatusSnapshot {
  repoRoot: string;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  files: GitStatusFile[];
}

export interface GitDiffResponse {
  path: string;
  staged: boolean;
  patch: string;
}

export interface GitBranchInfo {
  name: string;
  isCurrent: boolean;
  upstream: string | null;
  commit: string;
  subject: string;
}

export interface GitCommandResponse {
  output: string;
}

export interface GitHubUser {
  login: string;
}

export interface GitHubLabel {
  name: string;
  color?: string | null;
}

export interface GitHubPrSummary {
  number: number;
  title: string;
  state: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  updatedAt: string;
  url: string;
  author?: GitHubUser | null;
}

export interface GitHubIssueSummary {
  number: number;
  title: string;
  state: string;
  updatedAt: string;
  url: string;
  author?: GitHubUser | null;
  labels: GitHubLabel[];
  assignees: GitHubUser[];
}

export interface GitHubWorkflowSummary {
  id: number;
  name: string;
  state: string;
  path: string;
}

export interface GitHubRunSummary {
  databaseId: number;
  workflowName: string;
  displayTitle: string;
  status: string;
  conclusion?: string | null;
  event: string;
  headBranch?: string | null;
  headSha?: string | null;
  number?: number | null;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface CreateWorktreeRequest {
  repoRoot: string;
  mode: WorktreeCreateMode;
  branch: string;
  baseRef?: string;
}

export interface RemoveWorktreeRequest {
  repoRoot: string;
  worktreePath: string;
  force: boolean;
  deleteBranch: boolean;
}

export interface RemoveWorktreeResponse {
  worktreePath: string;
  branch: string;
  branchDeleted: boolean;
  warning?: string;
}

export interface PruneWorktreesRequest {
  repoRoot: string;
  dryRun: boolean;
}

export interface PruneWorktreesResponse {
  dryRun: boolean;
  paths: string[];
  output: string;
}

export interface GlobalCommandRequest {
  paneIds: string[];
  command: string;
  execute: boolean;
}

export interface PaneCommandResult {
  paneId: string;
  ok: boolean;
  error?: string;
}

export interface RuntimeStats {
  activePanes: number;
  suspendedPanes: number;
}

export interface GitRepoRequest {
  repoRoot: string;
}

export interface GitDiffRequest extends GitRepoRequest {
  path: string;
  staged: boolean;
}

export interface GitPathsRequest extends GitRepoRequest {
  paths: string[];
}

export interface GitDiscardPathsRequest extends GitPathsRequest {
  force: boolean;
}

export interface GitCommitRequest extends GitRepoRequest {
  message: string;
}

export interface GitCheckoutBranchRequest extends GitRepoRequest {
  branch: string;
}

export interface GitCreateBranchRequest extends GitRepoRequest {
  branch: string;
  baseRef?: string;
  checkout?: boolean;
}

export interface GitDeleteBranchRequest extends GitRepoRequest {
  branch: string;
  force?: boolean;
}

export interface GitHubListRequest extends GitRepoRequest {
  limit?: number;
}

export interface GitHubPrRequest extends GitRepoRequest {
  number: number;
}

export interface GitHubPrCommentRequest extends GitHubPrRequest {
  body: string;
}

export interface GitHubPrMergeRequest extends GitHubPrRequest {
  deleteBranch?: boolean;
}

export interface GitHubIssueRequest extends GitRepoRequest {
  number: number;
}

export interface GitHubIssueCommentRequest extends GitHubIssueRequest {
  body: string;
}

export interface GitHubIssueEditLabelsRequest extends GitHubIssueRequest {
  addLabels: string[];
  removeLabels: string[];
}

export interface GitHubIssueEditAssigneesRequest extends GitHubIssueRequest {
  addAssignees: string[];
  removeAssignees: string[];
}

export interface GitHubRunRequest extends GitRepoRequest {
  runId: number;
}

export interface AutomationWorkspaceSnapshot {
  workspaceId: string;
  name: string;
  repoRoot: string;
  worktreePath: string;
  runtimePaneIds: string[];
}

export interface AutomationReportRequest {
  jobId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export type FrontendAutomationRequest =
  | {
      action: "create_panes";
      jobId: string;
      workspaceId: string;
      paneCount: number;
    }
  | {
      action: "import_worktree";
      jobId: string;
      worktreePath: string;
    };
