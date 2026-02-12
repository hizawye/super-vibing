import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  CreateWorktreeRequest,
  GlobalCommandRequest,
  PaneCommandResult,
  PaneEvent,
  ResizePaneRequest,
  RuntimeStats,
  SpawnPaneRequest,
  SpawnPaneResponse,
  WorkspaceTab,
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

export async function createWorktree(request: CreateWorktreeRequest): Promise<WorkspaceTab> {
  return invoke<WorkspaceTab>("create_worktree", { request });
}

export async function listWorktrees(repoRoot: string): Promise<WorkspaceTab[]> {
  return invoke<WorkspaceTab[]>("list_worktrees", { request: { repoRoot } });
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
