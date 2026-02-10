import { create } from "zustand";
import type { Layout } from "react-grid-layout";
import {
  closePane as closePaneCommand,
  createWorktree as createWorktreeCommand,
  getCurrentBranch,
  getDefaultCwd,
  runGlobalCommand,
  spawnPane,
  writePaneInput,
} from "../lib/tauri";
import {
  loadPersistedPayload,
  saveBlueprints,
  saveSessionState,
  saveSnapshots,
} from "../lib/persistence";
import type {
  Blueprint,
  PaneCommandResult,
  PaneModel,
  Snapshot,
  SnapshotState,
  WorkspaceTab,
} from "../types";

interface WorkspaceStore {
  initialized: boolean;
  bootstrapping: boolean;
  paneCount: number;
  paneOrder: string[];
  panes: Record<string, PaneModel>;
  layouts: Layout[];
  zoomedPaneId: string | null;
  echoInput: boolean;
  workspaces: WorkspaceTab[];
  activeWorkspaceId: string | null;
  snapshots: Snapshot[];
  blueprints: Blueprint[];
  paletteOpen: boolean;

  bootstrap: () => Promise<void>;
  setPaneCount: (count: number) => Promise<void>;
  ensurePaneSpawned: (paneId: string) => Promise<void>;
  markPaneExited: (paneId: string, error?: string) => void;
  updatePaneLastCommand: (paneId: string, command: string) => void;
  sendInputFromPane: (paneId: string, data: string) => Promise<void>;
  setLayouts: (layouts: Layout[]) => void;
  toggleZoom: (paneId: string) => void;
  setEchoInput: (enabled: boolean) => void;
  createWorktree: (repoRoot: string, branch: string, baseBranch?: string) => Promise<void>;
  setActiveWorkspace: (workspaceId: string) => Promise<void>;
  setPaletteOpen: (open: boolean) => void;
  runGlobalCommand: (command: string, execute: boolean) => Promise<PaneCommandResult[]>;
  saveSnapshot: (name: string) => Promise<void>;
  restoreSnapshot: (snapshotId: string) => Promise<void>;
  createBlueprint: (name: string, workspacePaths: string[], autorunCommands: string[]) => Promise<void>;
  launchBlueprint: (blueprintId: string) => Promise<void>;
  persistSession: () => Promise<void>;
}

const MAX_PANES = 16;
const MIN_PANES = 1;

function clampPaneCount(value: number): number {
  return Math.max(MIN_PANES, Math.min(MAX_PANES, value));
}

function paneIdAt(index: number): string {
  return `pane-${index + 1}`;
}

function createPaneModel(id: string, cwd = "", shell = ""): PaneModel {
  return {
    id,
    title: id,
    cwd,
    shell,
    status: "idle",
    lastSubmittedCommand: "",
  };
}

function generateDefaultLayouts(paneOrder: string[], existing: Layout[] = []): Layout[] {
  const existingById = new Map(existing.map((layout) => [layout.i, layout]));
  return paneOrder.map((paneId, index) => {
    const previous = existingById.get(paneId);
    if (previous) {
      return previous;
    }

    const x = (index % 4) * 3;
    const y = Math.floor(index / 4) * 3;
    return {
      i: paneId,
      x,
      y,
      w: 3,
      h: 3,
      minW: 2,
      minH: 2,
    };
  });
}

function serializeSnapshotState(state: WorkspaceStore): SnapshotState {
  return {
    paneCount: state.paneCount,
    paneOrder: state.paneOrder,
    panes: state.panes,
    layouts: state.layouts,
    zoomedPaneId: state.zoomedPaneId,
    echoInput: state.echoInput,
    workspaces: state.workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
  };
}

function toIdlePanes(panes: Record<string, PaneModel>): Record<string, PaneModel> {
  const next: Record<string, PaneModel> = {};
  Object.entries(panes).forEach(([id, pane]) => {
    next[id] = {
      ...pane,
      status: "idle",
      error: undefined,
    };
  });
  return next;
}

async function closeAllRunningPanes(state: WorkspaceStore): Promise<void> {
  const runningPaneIds = state.paneOrder.filter((paneId) => state.panes[paneId]?.status === "running");
  await Promise.all(
    runningPaneIds.map(async (paneId) => {
      try {
        await closePaneCommand(paneId);
      } catch {
        // ignore best-effort shutdown failures during workspace/snapshot transition
      }
    }),
  );
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  initialized: false,
  bootstrapping: false,
  paneCount: 1,
  paneOrder: [paneIdAt(0)],
  panes: {
    [paneIdAt(0)]: createPaneModel(paneIdAt(0)),
  },
  layouts: generateDefaultLayouts([paneIdAt(0)]),
  zoomedPaneId: null,
  echoInput: false,
  workspaces: [],
  activeWorkspaceId: null,
  snapshots: [],
  blueprints: [],
  paletteOpen: false,

  bootstrap: async () => {
    const { initialized, bootstrapping } = get();
    if (initialized || bootstrapping) {
      return;
    }

    set({ bootstrapping: true });

    const persisted = await loadPersistedPayload();
    const persistedSession = persisted.session;

    let workspaces: WorkspaceTab[] = [];
    let activeWorkspaceId: string | null = null;
    let paneCount = 1;
    let paneOrder = [paneIdAt(0)];
    let panes: Record<string, PaneModel> = {
      [paneIdAt(0)]: createPaneModel(paneIdAt(0)),
    };
    let layouts = generateDefaultLayouts(paneOrder);
    let zoomedPaneId: string | null = null;
    let echoInput = false;

    if (persistedSession) {
      paneCount = clampPaneCount(persistedSession.paneCount);
      paneOrder = persistedSession.paneOrder.slice(0, paneCount);
      if (paneOrder.length === 0) {
        paneOrder = [paneIdAt(0)];
      }
      panes = toIdlePanes(persistedSession.panes);
      paneOrder.forEach((paneId) => {
        if (!panes[paneId]) {
          panes[paneId] = createPaneModel(paneId);
        }
      });
      layouts = generateDefaultLayouts(paneOrder, persistedSession.layouts);
      zoomedPaneId =
        persistedSession.zoomedPaneId && paneOrder.includes(persistedSession.zoomedPaneId)
          ? persistedSession.zoomedPaneId
          : null;
      echoInput = persistedSession.echoInput;
      workspaces = persistedSession.workspaces;
      activeWorkspaceId = persistedSession.activeWorkspaceId;
    }

    if (workspaces.length === 0) {
      const cwd = await getDefaultCwd();
      let branch = "detached";
      try {
        branch = await getCurrentBranch(cwd);
      } catch {
        branch = "not-a-repo";
      }

      workspaces = [
        {
          id: "workspace-main",
          repoRoot: cwd,
          branch,
          worktreePath: cwd,
        },
      ];
      activeWorkspaceId = workspaces[0].id;
    }

    set({
      paneCount,
      paneOrder,
      panes,
      layouts,
      zoomedPaneId,
      echoInput,
      workspaces,
      activeWorkspaceId,
      snapshots: persisted.snapshots,
      blueprints: persisted.blueprints,
      initialized: true,
      bootstrapping: false,
    });

    for (const paneId of get().paneOrder) {
      await get().ensurePaneSpawned(paneId);
    }

    await get().persistSession();
  },

  setPaneCount: async (requestedCount: number) => {
    const count = clampPaneCount(requestedCount);
    const current = get();
    if (count === current.paneCount) {
      return;
    }

    const nextPaneOrder = Array.from({ length: count }, (_, index) => paneIdAt(index));
    const nextPanes: Record<string, PaneModel> = { ...current.panes };

    nextPaneOrder.forEach((paneId) => {
      if (!nextPanes[paneId]) {
        nextPanes[paneId] = createPaneModel(paneId);
      }
    });

    const removedPaneIds = current.paneOrder.filter((paneId) => !nextPaneOrder.includes(paneId));
    await Promise.all(
      removedPaneIds.map(async (paneId) => {
        if (current.panes[paneId]?.status === "running") {
          try {
            await closePaneCommand(paneId);
          } catch {
            // ignore best effort close while shrinking pane count
          }
        }
      }),
    );

    removedPaneIds.forEach((paneId) => {
      delete nextPanes[paneId];
    });

    const zoomedPaneId =
      current.zoomedPaneId && nextPaneOrder.includes(current.zoomedPaneId)
        ? current.zoomedPaneId
        : null;

    set({
      paneCount: count,
      paneOrder: nextPaneOrder,
      panes: nextPanes,
      layouts: generateDefaultLayouts(nextPaneOrder, current.layouts),
      zoomedPaneId,
    });

    for (const paneId of nextPaneOrder) {
      await get().ensurePaneSpawned(paneId);
    }

    await get().persistSession();
  },

  ensurePaneSpawned: async (paneId: string) => {
    const state = get();
    const pane = state.panes[paneId];
    if (!pane || pane.status === "running") {
      return;
    }

    const activeWorkspace = state.workspaces.find(
      (workspace) => workspace.id === state.activeWorkspaceId,
    );

    set((current) => ({
      panes: {
        ...current.panes,
        [paneId]: {
          ...current.panes[paneId],
          status: "idle",
          error: undefined,
        },
      },
    }));

    try {
      const response = await spawnPane({
        paneId,
        cwd: activeWorkspace?.worktreePath,
      });

      set((current) => ({
        panes: {
          ...current.panes,
          [paneId]: {
            ...current.panes[paneId],
            cwd: response.cwd,
            shell: response.shell,
            title: paneId,
            status: "running",
            error: undefined,
          },
        },
      }));
    } catch (error) {
      set((current) => ({
        panes: {
          ...current.panes,
          [paneId]: {
            ...current.panes[paneId],
            status: "error",
            error: String(error),
          },
        },
      }));
    }
  },

  markPaneExited: (paneId: string, error?: string) => {
    set((state) => {
      const pane = state.panes[paneId];
      if (!pane) {
        return state;
      }
      return {
        panes: {
          ...state.panes,
          [paneId]: {
            ...pane,
            status: "closed",
            error,
          },
        },
      };
    });
    void get().persistSession();
  },

  updatePaneLastCommand: (paneId: string, command: string) => {
    set((state) => {
      const pane = state.panes[paneId];
      if (!pane) {
        return state;
      }
      return {
        panes: {
          ...state.panes,
          [paneId]: {
            ...pane,
            lastSubmittedCommand: command,
          },
        },
      };
    });
    void get().persistSession();
  },

  sendInputFromPane: async (sourcePaneId: string, data: string) => {
    const state = get();
    const targetPaneIds = state.echoInput
      ? state.paneOrder.filter((paneId) => state.panes[paneId]?.status === "running")
      : [sourcePaneId];

    await Promise.all(
      targetPaneIds.map((paneId) =>
        writePaneInput({
          paneId,
          data,
          execute: false,
        }),
      ),
    );
  },

  setLayouts: (layouts: Layout[]) => {
    set({ layouts });
    void get().persistSession();
  },

  toggleZoom: (paneId: string) => {
    set((state) => ({
      zoomedPaneId: state.zoomedPaneId === paneId ? null : paneId,
    }));
    void get().persistSession();
  },

  setEchoInput: (enabled: boolean) => {
    set({ echoInput: enabled });
    void get().persistSession();
  },

  createWorktree: async (repoRoot: string, branch: string, baseBranch?: string) => {
    const tab = await createWorktreeCommand({ repoRoot, branch, baseBranch });
    set((state) => ({
      workspaces: [...state.workspaces, tab],
      activeWorkspaceId: tab.id,
    }));

    const current = get();
    await closeAllRunningPanes(current);
    set((state) => ({
      panes: toIdlePanes(state.panes),
    }));

    for (const paneId of get().paneOrder) {
      await get().ensurePaneSpawned(paneId);
    }

    await get().persistSession();
  },

  setActiveWorkspace: async (workspaceId: string) => {
    const current = get();
    if (current.activeWorkspaceId === workspaceId) {
      return;
    }

    await closeAllRunningPanes(current);

    set((state) => ({
      activeWorkspaceId: workspaceId,
      panes: toIdlePanes(state.panes),
    }));

    for (const paneId of get().paneOrder) {
      await get().ensurePaneSpawned(paneId);
    }

    await get().persistSession();
  },

  setPaletteOpen: (open: boolean) => {
    set({ paletteOpen: open });
  },

  runGlobalCommand: async (command: string, execute: boolean) => {
    const state = get();
    const paneIds = state.paneOrder.filter((paneId) => state.panes[paneId]?.status === "running");
    if (paneIds.length === 0 || command.trim().length === 0) {
      return [];
    }

    return runGlobalCommand({
      paneIds,
      command,
      execute,
    });
  },

  saveSnapshot: async (name: string) => {
    const state = get();
    const snapshot: Snapshot = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      state: serializeSnapshotState(state),
    };

    const snapshots = [snapshot, ...state.snapshots].slice(0, 25);
    set({ snapshots });
    await saveSnapshots(snapshots);
    await get().persistSession();
  },

  restoreSnapshot: async (snapshotId: string) => {
    const state = get();
    const snapshot = state.snapshots.find((item) => item.id === snapshotId);
    if (!snapshot) {
      return;
    }

    await closeAllRunningPanes(state);

    const paneCount = clampPaneCount(snapshot.state.paneCount);
    const paneOrder = snapshot.state.paneOrder.slice(0, paneCount);
    const panes = toIdlePanes(snapshot.state.panes);
    paneOrder.forEach((paneId) => {
      if (!panes[paneId]) {
        panes[paneId] = createPaneModel(paneId);
      }
    });

    set({
      paneCount,
      paneOrder,
      panes,
      layouts: generateDefaultLayouts(paneOrder, snapshot.state.layouts),
      zoomedPaneId: snapshot.state.zoomedPaneId,
      echoInput: snapshot.state.echoInput,
      workspaces: snapshot.state.workspaces,
      activeWorkspaceId: snapshot.state.activeWorkspaceId,
    });

    for (const paneId of paneOrder) {
      await get().ensurePaneSpawned(paneId);
    }

    await get().persistSession();
  },

  createBlueprint: async (name: string, workspacePaths: string[], autorunCommands: string[]) => {
    const state = get();
    const blueprint: Blueprint = {
      id: crypto.randomUUID(),
      name,
      paneCount: state.paneCount,
      workspacePaths,
      autorunCommands,
    };

    const blueprints = [blueprint, ...state.blueprints].slice(0, 25);
    set({ blueprints });
    await saveBlueprints(blueprints);
  },

  launchBlueprint: async (blueprintId: string) => {
    const state = get();
    const blueprint = state.blueprints.find((item) => item.id === blueprintId);
    if (!blueprint) {
      return;
    }

    await get().setPaneCount(blueprint.paneCount);

    for (let index = 0; index < blueprint.workspacePaths.length; index += 1) {
      const workspacePath = blueprint.workspacePaths[index];
      const existing = get().workspaces.find((item) => item.worktreePath === workspacePath);
      if (existing) {
        continue;
      }

      let branch = "detached";
      try {
        branch = await getCurrentBranch(workspacePath);
      } catch {
        branch = "not-a-repo";
      }

      const workspace: WorkspaceTab = {
        id: `workspace-${crypto.randomUUID()}`,
        repoRoot: workspacePath,
        branch,
        worktreePath: workspacePath,
      };

      set((current) => ({
        workspaces: [...current.workspaces, workspace],
      }));
    }

    const targetWorkspace = get().workspaces.find(
      (item) => item.worktreePath === blueprint.workspacePaths[0],
    );
    if (targetWorkspace) {
      await get().setActiveWorkspace(targetWorkspace.id);
    }

    for (const command of blueprint.autorunCommands) {
      await get().runGlobalCommand(command, true);
    }

    await get().persistSession();
  },

  persistSession: async () => {
    const state = get();
    await saveSessionState(serializeSnapshotState(state));
  },
}));
