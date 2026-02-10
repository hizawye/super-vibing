import type { Layout } from "react-grid-layout";

export type PaneStatus = "idle" | "running" | "closed" | "error";

export interface PaneModel {
  id: string;
  title: string;
  cwd: string;
  shell: string;
  status: PaneStatus;
  lastSubmittedCommand: string;
  error?: string;
}

export interface SpawnPaneRequest {
  paneId: string;
  cwd?: string;
  shell?: string;
  rows?: number;
  cols?: number;
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

export interface SnapshotState {
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
  state: SnapshotState;
}

export interface Blueprint {
  id: string;
  name: string;
  paneCount: number;
  workspacePaths: string[];
  autorunCommands: string[];
}

export interface PersistedPayload {
  version: number;
  session?: SnapshotState;
  snapshots: Snapshot[];
  blueprints: Blueprint[];
}
