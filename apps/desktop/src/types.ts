import type { Layout } from "react-grid-layout";

export type PaneStatus = "idle" | "spawning" | "running" | "suspended" | "closed" | "error";

export interface PaneModel {
  id: string;
  title: string;
  cwd: string;
  shell: string;
  status: PaneStatus;
  lastSubmittedCommand: string;
  error?: string;
}

export type AgentProfileKey = "claude" | "codex" | "gemini" | "cursor" | "opencode";

export interface AgentAllocation {
  profile: AgentProfileKey;
  label: string;
  command: string;
  enabled: boolean;
  count: number;
}

export type AppSection = "terminal" | "kanban" | "agents" | "prompts" | "settings";
export type LayoutMode = "tiling" | "freeform";
export type ThemeId = "apple-dark" | "apple-light" | "graphite" | "midnight" | "solarized" | "nord";
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

export interface CreateWorktreeRequest {
  repoRoot: string;
  branch: string;
  baseBranch?: string;
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
