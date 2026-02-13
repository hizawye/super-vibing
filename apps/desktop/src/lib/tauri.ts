import { Channel, invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  AutomationReportRequest,
  AutomationWorkspaceSnapshot,
  CreateWorktreeRequest,
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
