import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "./workspace";
import type { CreateWorktreeRequest, PaneModel, SnapshotState, SpawnPaneRequest, WorkspaceTab } from "../types";
import * as tauriApi from "../lib/tauri";

vi.mock("../lib/tauri", () => ({
  closePane: vi.fn(async () => {}),
  createWorktree: vi.fn(async ({ repoRoot, branch }: CreateWorktreeRequest) => ({
    id: "workspace-created",
    repoRoot,
    branch,
    worktreePath: `${repoRoot}/.worktrees/${branch}`,
  })),
  getCurrentBranch: vi.fn(async () => "main"),
  getDefaultCwd: vi.fn(async () => "/repo"),
  runGlobalCommand: vi.fn(async () => []),
  spawnPane: vi.fn(async ({ paneId, cwd }: SpawnPaneRequest) => ({
    paneId,
    cwd: cwd ?? "/repo",
    shell: "/bin/bash",
  })),
  writePaneInput: vi.fn(async () => {}),
  subscribeToPaneEvents: vi.fn(() => () => {}),
}));

vi.mock("../lib/persistence", () => ({
  loadPersistedPayload: vi.fn(async () => ({
    version: 1,
    snapshots: [],
    blueprints: [],
  })),
  saveBlueprints: vi.fn(async () => {}),
  saveSessionState: vi.fn(async () => {}),
  saveSnapshots: vi.fn(async () => {}),
}));

function pane(id: string, status: PaneModel["status"] = "idle"): PaneModel {
  return {
    id,
    title: id,
    cwd: "/repo",
    shell: "/bin/bash",
    status,
    lastSubmittedCommand: "",
  };
}

function baseWorkspace(): WorkspaceTab {
  return {
    id: "workspace-main",
    repoRoot: "/repo",
    branch: "main",
    worktreePath: "/repo",
  };
}

function resetStore(stateOverrides: Partial<SnapshotState> = {}): void {
  const paneOrder = stateOverrides.paneOrder ?? ["pane-1"];
  const panes =
    stateOverrides.panes ??
    paneOrder.reduce<Record<string, PaneModel>>((acc, paneId) => {
      acc[paneId] = pane(paneId);
      return acc;
    }, {});

  useWorkspaceStore.setState({
    initialized: true,
    bootstrapping: false,
    paneCount: stateOverrides.paneCount ?? paneOrder.length,
    paneOrder,
    panes,
    layouts:
      stateOverrides.layouts ??
      paneOrder.map((paneId, index) => ({
        i: paneId,
        x: index * 3,
        y: 0,
        w: 3,
        h: 3,
        minW: 2,
        minH: 2,
      })),
    zoomedPaneId: stateOverrides.zoomedPaneId ?? null,
    echoInput: stateOverrides.echoInput ?? false,
    workspaces: stateOverrides.workspaces ?? [baseWorkspace()],
    activeWorkspaceId: stateOverrides.activeWorkspaceId ?? "workspace-main",
    snapshots: [],
    blueprints: [],
    paletteOpen: false,
  });
}

describe("workspace store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("clamps pane count between 1 and 16", async () => {
    await useWorkspaceStore.getState().setPaneCount(0);
    expect(useWorkspaceStore.getState().paneCount).toBe(1);

    await useWorkspaceStore.getState().setPaneCount(99);
    expect(useWorkspaceStore.getState().paneCount).toBe(16);
    expect(useWorkspaceStore.getState().paneOrder).toHaveLength(16);
  });

  it("toggles zoom state idempotently", () => {
    useWorkspaceStore.getState().toggleZoom("pane-1");
    expect(useWorkspaceStore.getState().zoomedPaneId).toBe("pane-1");

    useWorkspaceStore.getState().toggleZoom("pane-1");
    expect(useWorkspaceStore.getState().zoomedPaneId).toBeNull();
  });

  it("broadcasts input only to running panes when echo mode is on", async () => {
    resetStore({
      paneOrder: ["pane-1", "pane-2", "pane-3"],
      panes: {
        "pane-1": pane("pane-1", "running"),
        "pane-2": pane("pane-2", "running"),
        "pane-3": pane("pane-3", "closed"),
      },
      echoInput: true,
      paneCount: 3,
    });

    await useWorkspaceStore.getState().sendInputFromPane("pane-1", "ls");

    expect(tauriApi.writePaneInput).toHaveBeenNthCalledWith(1, {
      paneId: "pane-1",
      data: "ls",
      execute: false,
    });
    expect(tauriApi.writePaneInput).toHaveBeenNthCalledWith(2, {
      paneId: "pane-2",
      data: "ls",
      execute: false,
    });
    expect(tauriApi.writePaneInput).toHaveBeenCalledTimes(2);
  });

  it("saves and restores snapshot state", async () => {
    resetStore({
      paneOrder: ["pane-1", "pane-2"],
      panes: {
        "pane-1": pane("pane-1", "running"),
        "pane-2": pane("pane-2", "running"),
      },
      paneCount: 2,
      zoomedPaneId: "pane-2",
      echoInput: true,
    });

    await useWorkspaceStore.getState().saveSnapshot("snapshot-1");
    const snapshot = useWorkspaceStore.getState().snapshots[0];
    expect(snapshot.name).toBe("snapshot-1");

    resetStore({
      paneOrder: ["pane-1"],
      panes: { "pane-1": pane("pane-1") },
      paneCount: 1,
      zoomedPaneId: null,
      echoInput: false,
    });

    useWorkspaceStore.setState({ snapshots: [snapshot] });
    await useWorkspaceStore.getState().restoreSnapshot(snapshot.id);

    const state = useWorkspaceStore.getState();
    expect(state.paneCount).toBe(2);
    expect(state.zoomedPaneId).toBe("pane-2");
    expect(state.echoInput).toBe(true);
  });

  it("launches blueprint, creates missing workspaces, and runs autorun commands", async () => {
    resetStore({
      paneOrder: ["pane-1"],
      panes: { "pane-1": pane("pane-1", "running") },
      paneCount: 1,
    });
    useWorkspaceStore.setState({
      blueprints: [
        {
          id: "bp-1",
          name: "Daily",
          paneCount: 2,
          workspacePaths: ["/repo/a", "/repo/b"],
          autorunCommands: ["pnpm test", "cargo check"],
        },
      ],
    });

    await useWorkspaceStore.getState().launchBlueprint("bp-1");
    const state = useWorkspaceStore.getState();

    expect(state.paneCount).toBe(2);
    expect(state.workspaces.some((item) => item.worktreePath === "/repo/a")).toBe(true);
    expect(state.workspaces.some((item) => item.worktreePath === "/repo/b")).toBe(true);
    expect(tauriApi.runGlobalCommand).toHaveBeenCalledTimes(2);
    expect(tauriApi.runGlobalCommand).toHaveBeenNthCalledWith(1, {
      paneIds: ["pane-1", "pane-2"],
      command: "pnpm test",
      execute: true,
    });
  });
});
