import { create } from "zustand";
import type { Layout } from "react-grid-layout";
import { closePane, getCurrentBranch, getDefaultCwd, runGlobalCommand, spawnPane, writePaneInput } from "../lib/tauri";
import { loadPersistedPayload, saveBlueprints, saveSessionState, saveSnapshots } from "../lib/persistence";
import type {
  AgentAllocation,
  AgentProfileKey,
  AppSection,
  Blueprint,
  LegacySessionState,
  PaneCommandResult,
  PaneModel,
  SessionState,
  Snapshot,
  WorkspaceRuntime,
} from "../types";

interface CreateWorkspaceInput {
  name?: string;
  directory: string;
  paneCount: number;
  agentAllocation: AgentAllocation[];
}

interface PaneSpawnOptions {
  initCommand?: string;
  executeInit?: boolean;
}

interface WorkspaceStore {
  initialized: boolean;
  bootstrapping: boolean;
  activeSection: AppSection;
  paletteOpen: boolean;
  echoInput: boolean;
  workspaces: WorkspaceRuntime[];
  activeWorkspaceId: string | null;
  snapshots: Snapshot[];
  blueprints: Blueprint[];

  bootstrap: () => Promise<void>;
  setActiveSection: (section: AppSection) => void;
  setPaletteOpen: (open: boolean) => void;
  setEchoInput: (enabled: boolean) => void;
  createWorkspace: (input: CreateWorkspaceInput) => Promise<void>;
  closeWorkspace: (workspaceId: string) => Promise<void>;
  setActiveWorkspace: (workspaceId: string) => Promise<void>;
  setActiveWorkspacePaneCount: (count: number) => Promise<void>;
  ensurePaneSpawned: (workspaceId: string, paneId: string, options?: PaneSpawnOptions) => Promise<void>;
  markPaneExited: (workspaceId: string, paneId: string, error?: string) => void;
  updatePaneLastCommand: (workspaceId: string, paneId: string, command: string) => void;
  sendInputFromPane: (workspaceId: string, sourcePaneId: string, data: string) => Promise<void>;
  setActiveWorkspaceLayouts: (layouts: Layout[]) => void;
  toggleActiveWorkspaceZoom: (paneId: string) => void;
  runGlobalCommand: (command: string, execute: boolean) => Promise<PaneCommandResult[]>;
  saveSnapshot: (name: string) => Promise<void>;
  restoreSnapshot: (snapshotId: string) => Promise<void>;
  createBlueprint: (name: string, workspacePaths: string[], autorunCommands: string[]) => Promise<void>;
  launchBlueprint: (blueprintId: string) => Promise<void>;
  persistSession: () => Promise<void>;
}

const MAX_PANES = 16;
const MIN_PANES = 1;

const AGENT_PROFILE_CONFIG: Array<{ profile: AgentProfileKey; label: string; command: string }> = [
  { profile: "claude", label: "Claude", command: "claude" },
  { profile: "codex", label: "Codex", command: "codex" },
  { profile: "gemini", label: "Gemini", command: "gemini" },
  { profile: "cursor", label: "Cursor", command: "cursor-agent" },
  { profile: "opencode", label: "OpenCode", command: "opencode" },
];

function clampPaneCount(value: number): number {
  return Math.max(MIN_PANES, Math.min(MAX_PANES, value));
}

function paneIdAt(index: number): string {
  return `pane-${index + 1}`;
}

function createPaneModel(id: string, title = id, cwd = "", shell = ""): PaneModel {
  return {
    id,
    title,
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

function defaultAgentAllocation(): AgentAllocation[] {
  return AGENT_PROFILE_CONFIG.map((item) => ({
    profile: item.profile,
    label: item.label,
    command: item.command,
    enabled: false,
    count: 0,
  }));
}

function normalizeAgentAllocation(input?: AgentAllocation[]): AgentAllocation[] {
  const byProfile = new Map((input ?? []).map((item) => [item.profile, item]));
  return AGENT_PROFILE_CONFIG.map((base) => {
    const existing = byProfile.get(base.profile);
    return {
      profile: base.profile,
      label: existing?.label ?? base.label,
      command: existing?.command ?? base.command,
      enabled: existing?.enabled ?? false,
      count: Math.max(0, Math.min(MAX_PANES, existing?.count ?? 0)),
    };
  });
}

function createWorkspaceRuntime(args: {
  id: string;
  name: string;
  directory: string;
  branch: string;
  paneCount: number;
  agentAllocation?: AgentAllocation[];
  createdAt?: string;
  paneOrder?: string[];
  panes?: Record<string, PaneModel>;
  layouts?: Layout[];
  zoomedPaneId?: string | null;
}): WorkspaceRuntime {
  const paneCount = clampPaneCount(args.paneCount);
  const paneOrder = args.paneOrder ?? Array.from({ length: paneCount }, (_, index) => paneIdAt(index));
  const panes = args.panes
    ? { ...args.panes }
    : paneOrder.reduce<Record<string, PaneModel>>((acc, paneId) => {
      acc[paneId] = createPaneModel(paneId);
      return acc;
    }, {});

  paneOrder.forEach((paneId) => {
    if (!panes[paneId]) {
      panes[paneId] = createPaneModel(paneId);
    }
  });

  const timestamp = args.createdAt ?? new Date().toISOString();

  return {
    id: args.id,
    name: args.name,
    repoRoot: args.directory,
    branch: args.branch,
    worktreePath: args.directory,
    paneCount,
    paneOrder,
    panes,
    layouts: generateDefaultLayouts(paneOrder, args.layouts ?? []),
    zoomedPaneId:
      args.zoomedPaneId && paneOrder.includes(args.zoomedPaneId)
        ? args.zoomedPaneId
        : null,
    agentAllocation: normalizeAgentAllocation(args.agentAllocation),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function withWorkspaceUpdated(
  workspaces: WorkspaceRuntime[],
  workspaceId: string,
  updater: (workspace: WorkspaceRuntime) => WorkspaceRuntime,
): WorkspaceRuntime[] {
  return workspaces.map((workspace) => (workspace.id === workspaceId ? updater(workspace) : workspace));
}

function activeWorkspaceOf(state: Pick<WorkspaceStore, "workspaces" | "activeWorkspaceId">): WorkspaceRuntime | null {
  if (!state.activeWorkspaceId) {
    return null;
  }
  return state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ?? null;
}

function serializeSessionState(state: WorkspaceStore): SessionState {
  return {
    workspaces: state.workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
    activeSection: state.activeSection,
    echoInput: state.echoInput,
  };
}

function isLegacySessionState(session: SessionState | LegacySessionState): session is LegacySessionState {
  return "paneCount" in session;
}

function migrateLegacySession(session: LegacySessionState): SessionState {
  const paneCount = clampPaneCount(session.paneCount);
  const paneOrder = session.paneOrder.slice(0, paneCount);
  const normalizedOrder = paneOrder.length > 0 ? paneOrder : [paneIdAt(0)];
  const migratedWorkspaces = (session.workspaces.length > 0 ? session.workspaces : [
    {
      id: "workspace-main",
      repoRoot: ".",
      branch: "not-a-repo",
      worktreePath: ".",
    },
  ]).map((workspace) =>
    createWorkspaceRuntime({
      id: workspace.id,
      name: workspace.branch,
      directory: workspace.worktreePath,
      branch: workspace.branch,
      paneCount,
      paneOrder: normalizedOrder,
      panes: toIdlePanes(session.panes),
      layouts: session.layouts,
      zoomedPaneId: session.zoomedPaneId,
      agentAllocation: defaultAgentAllocation(),
    }),
  );

  return {
    workspaces: migratedWorkspaces,
    activeWorkspaceId: session.activeWorkspaceId ?? migratedWorkspaces[0]?.id ?? null,
    activeSection: "terminal",
    echoInput: session.echoInput,
  };
}

function sanitizeSession(session: SessionState): SessionState {
  const workspaces = session.workspaces.map((workspace) => {
    const paneCount = clampPaneCount(workspace.paneCount);
    const paneOrder = workspace.paneOrder.slice(0, paneCount);
    const normalizedOrder = paneOrder.length > 0 ? paneOrder : [paneIdAt(0)];
    const panes = toIdlePanes(workspace.panes ?? {});

    normalizedOrder.forEach((paneId) => {
      if (!panes[paneId]) {
        panes[paneId] = createPaneModel(paneId);
      }
    });

    return createWorkspaceRuntime({
      id: workspace.id,
      name: workspace.name,
      directory: workspace.worktreePath,
      branch: workspace.branch,
      paneCount,
      paneOrder: normalizedOrder,
      panes,
      layouts: workspace.layouts,
      zoomedPaneId: workspace.zoomedPaneId,
      agentAllocation: workspace.agentAllocation,
      createdAt: workspace.createdAt,
    });
  });

  return {
    workspaces,
    activeWorkspaceId: workspaces.some((workspace) => workspace.id === session.activeWorkspaceId)
      ? session.activeWorkspaceId
      : workspaces[0]?.id ?? null,
    activeSection: session.activeSection,
    echoInput: session.echoInput,
  };
}

async function closeRunningPanes(workspace: WorkspaceRuntime): Promise<void> {
  const runningPaneIds = workspace.paneOrder.filter((paneId) => workspace.panes[paneId]?.status === "running");
  await Promise.all(
    runningPaneIds.map(async (paneId) => {
      try {
        await closePane(paneId);
      } catch {
        // best effort cleanup when switching contexts
      }
    }),
  );
}

function buildLaunchPlan(
  paneOrder: string[],
  agentAllocation: AgentAllocation[],
): Map<string, { title: string; command: string }> {
  const launches: Array<{ title: string; command: string }> = [];
  agentAllocation.forEach((agent) => {
    if (!agent.enabled || agent.count <= 0 || !agent.command.trim()) {
      return;
    }
    for (let i = 0; i < agent.count; i += 1) {
      launches.push({
        title: agent.label,
        command: agent.command.trim(),
      });
    }
  });

  const plan = new Map<string, { title: string; command: string }>();
  paneOrder.forEach((paneId, index) => {
    const launch = launches[index];
    if (launch) {
      plan.set(paneId, launch);
    }
  });
  return plan;
}

function applyLaunchTitles(
  workspace: WorkspaceRuntime,
  launchPlan: Map<string, { title: string; command: string }>,
): WorkspaceRuntime {
  const nextPanes: Record<string, PaneModel> = {};
  workspace.paneOrder.forEach((paneId) => {
    const pane = workspace.panes[paneId] ?? createPaneModel(paneId);
    const launch = launchPlan.get(paneId);
    nextPanes[paneId] = {
      ...pane,
      title: launch?.title ?? paneId,
    };
  });

  return {
    ...workspace,
    panes: nextPanes,
    updatedAt: new Date().toISOString(),
  };
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  initialized: false,
  bootstrapping: false,
  activeSection: "terminal",
  paletteOpen: false,
  echoInput: false,
  workspaces: [],
  activeWorkspaceId: null,
  snapshots: [],
  blueprints: [],

  bootstrap: async () => {
    const current = get();
    if (current.initialized || current.bootstrapping) {
      return;
    }

    set({ bootstrapping: true });

    const persisted = await loadPersistedPayload();
    const persistedSession = persisted.session;

    let session: SessionState | null = null;
    if (persistedSession) {
      session = isLegacySessionState(persistedSession)
        ? migrateLegacySession(persistedSession)
        : sanitizeSession(persistedSession);
    }

    if (!session || session.workspaces.length === 0) {
      const cwd = await getDefaultCwd();
      let branch = "not-a-repo";
      try {
        branch = await getCurrentBranch(cwd);
      } catch {
        branch = "not-a-repo";
      }

      const workspace = createWorkspaceRuntime({
        id: "workspace-main",
        name: "Workspace 1",
        directory: cwd,
        branch,
        paneCount: 1,
      });

      session = {
        workspaces: [workspace],
        activeWorkspaceId: workspace.id,
        activeSection: "terminal",
        echoInput: false,
      };
    }

    set({
      activeSection: session.activeSection,
      echoInput: session.echoInput,
      workspaces: session.workspaces,
      activeWorkspaceId: session.activeWorkspaceId,
      snapshots: persisted.snapshots,
      blueprints: persisted.blueprints,
      initialized: true,
      bootstrapping: false,
    });

    const activeWorkspace = activeWorkspaceOf(get());
    if (activeWorkspace) {
      for (const paneId of activeWorkspace.paneOrder) {
        await get().ensurePaneSpawned(activeWorkspace.id, paneId);
      }
    }

    await get().persistSession();
  },

  setActiveSection: (section: AppSection) => {
    set({ activeSection: section });
    void get().persistSession();
  },

  setPaletteOpen: (open: boolean) => {
    set({ paletteOpen: open });
  },

  setEchoInput: (enabled: boolean) => {
    set({ echoInput: enabled });
    void get().persistSession();
  },

  createWorkspace: async (input: CreateWorkspaceInput) => {
    const directory = input.directory.trim() || (await getDefaultCwd());
    let branch = "not-a-repo";
    try {
      branch = await getCurrentBranch(directory);
    } catch {
      branch = "not-a-repo";
    }

    const workspaceId = `workspace-${crypto.randomUUID()}`;
    const name = input.name?.trim() || `Workspace ${get().workspaces.length + 1}`;

    let nextWorkspace = createWorkspaceRuntime({
      id: workspaceId,
      name,
      directory,
      branch,
      paneCount: input.paneCount,
      agentAllocation: input.agentAllocation,
    });

    const launchPlan = buildLaunchPlan(nextWorkspace.paneOrder, nextWorkspace.agentAllocation);
    nextWorkspace = applyLaunchTitles(nextWorkspace, launchPlan);

    const activeWorkspace = activeWorkspaceOf(get());
    if (activeWorkspace) {
      await closeRunningPanes(activeWorkspace);
    }

    set((state) => ({
      activeSection: "terminal",
      workspaces: [
        ...state.workspaces.map((workspace) =>
          workspace.id === activeWorkspace?.id
            ? {
                ...workspace,
                panes: toIdlePanes(workspace.panes),
                updatedAt: new Date().toISOString(),
              }
            : workspace,
        ),
        nextWorkspace,
      ],
      activeWorkspaceId: nextWorkspace.id,
    }));

    for (const paneId of nextWorkspace.paneOrder) {
      const launch = launchPlan.get(paneId);
      await get().ensurePaneSpawned(nextWorkspace.id, paneId, {
        initCommand: launch?.command,
        executeInit: Boolean(launch),
      });
    }

    await get().persistSession();
  },

  closeWorkspace: async (workspaceId: string) => {
    const state = get();
    if (state.workspaces.length <= 1) {
      return;
    }

    const workspace = state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      return;
    }

    const closingActive = workspaceId === state.activeWorkspaceId;
    if (closingActive) {
      await closeRunningPanes(workspace);
    }

    const remaining = state.workspaces.filter((item) => item.id !== workspaceId);
    const nextActiveId = closingActive ? remaining[0]?.id ?? null : state.activeWorkspaceId;

    set({
      workspaces: remaining,
      activeWorkspaceId: nextActiveId,
    });

    if (closingActive && nextActiveId) {
      const nextWorkspace = get().workspaces.find((item) => item.id === nextActiveId);
      if (nextWorkspace) {
        for (const paneId of nextWorkspace.paneOrder) {
          await get().ensurePaneSpawned(nextWorkspace.id, paneId);
        }
      }
    }

    await get().persistSession();
  },

  setActiveWorkspace: async (workspaceId: string) => {
    const state = get();
    if (state.activeWorkspaceId === workspaceId) {
      return;
    }

    const target = state.workspaces.find((workspace) => workspace.id === workspaceId);
    if (!target) {
      return;
    }

    const currentActive = activeWorkspaceOf(state);
    if (currentActive) {
      await closeRunningPanes(currentActive);
    }

    set((previous) => ({
      activeWorkspaceId: workspaceId,
      activeSection: "terminal",
      workspaces: previous.workspaces.map((workspace) =>
        workspace.id === currentActive?.id
          ? {
              ...workspace,
              panes: toIdlePanes(workspace.panes),
              updatedAt: new Date().toISOString(),
            }
          : workspace,
      ),
    }));

    for (const paneId of target.paneOrder) {
      await get().ensurePaneSpawned(target.id, paneId);
    }

    await get().persistSession();
  },

  setActiveWorkspacePaneCount: async (requestedCount: number) => {
    const state = get();
    const activeWorkspace = activeWorkspaceOf(state);
    if (!activeWorkspace) {
      return;
    }

    const paneCount = clampPaneCount(requestedCount);
    if (paneCount === activeWorkspace.paneCount) {
      return;
    }

    const nextPaneOrder = Array.from({ length: paneCount }, (_, index) => paneIdAt(index));
    const nextPanes: Record<string, PaneModel> = { ...activeWorkspace.panes };

    nextPaneOrder.forEach((paneId) => {
      if (!nextPanes[paneId]) {
        nextPanes[paneId] = createPaneModel(paneId);
      }
    });

    const removedPaneIds = activeWorkspace.paneOrder.filter((paneId) => !nextPaneOrder.includes(paneId));
    await Promise.all(
      removedPaneIds.map(async (paneId) => {
        if (activeWorkspace.panes[paneId]?.status === "running") {
          try {
            await closePane(paneId);
          } catch {
            // best effort close while resizing pane count
          }
        }
      }),
    );

    removedPaneIds.forEach((paneId) => {
      delete nextPanes[paneId];
    });

    set((current) => ({
      workspaces: withWorkspaceUpdated(current.workspaces, activeWorkspace.id, (workspace) => ({
        ...workspace,
        paneCount,
        paneOrder: nextPaneOrder,
        panes: nextPanes,
        layouts: generateDefaultLayouts(nextPaneOrder, workspace.layouts),
        zoomedPaneId:
          workspace.zoomedPaneId && nextPaneOrder.includes(workspace.zoomedPaneId)
            ? workspace.zoomedPaneId
            : null,
        updatedAt: new Date().toISOString(),
      })),
    }));

    for (const paneId of nextPaneOrder) {
      await get().ensurePaneSpawned(activeWorkspace.id, paneId);
    }

    await get().persistSession();
  },

  ensurePaneSpawned: async (workspaceId: string, paneId: string, options?: PaneSpawnOptions) => {
    const state = get();
    if (state.activeWorkspaceId !== workspaceId) {
      return;
    }

    const workspace = state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      return;
    }

    const pane = workspace.panes[paneId];
    if (!pane || pane.status === "running") {
      return;
    }

    set((current) => ({
      workspaces: withWorkspaceUpdated(current.workspaces, workspaceId, (target) => {
        const currentPane = target.panes[paneId];
        if (!currentPane) {
          return target;
        }
        return {
          ...target,
          panes: {
            ...target.panes,
            [paneId]: {
              ...currentPane,
              status: "idle",
              error: undefined,
            },
          },
        };
      }),
    }));

    try {
      const response = await spawnPane({
        paneId,
        cwd: workspace.worktreePath,
      });

      set((current) => ({
        workspaces: withWorkspaceUpdated(current.workspaces, workspaceId, (target) => {
          const currentPane = target.panes[paneId];
          if (!currentPane) {
            return target;
          }
          return {
            ...target,
            panes: {
              ...target.panes,
              [paneId]: {
                ...currentPane,
                cwd: response.cwd,
                shell: response.shell,
                status: "running",
                error: undefined,
              },
            },
          };
        }),
      }));

      if (options?.initCommand && options.executeInit) {
        const initCommand = options.initCommand;
        setTimeout(() => {
          void writePaneInput({
            paneId,
            data: initCommand,
            execute: true,
          });
        }, 150);
      }
    } catch (error) {
      set((current) => ({
        workspaces: withWorkspaceUpdated(current.workspaces, workspaceId, (target) => {
          const currentPane = target.panes[paneId];
          if (!currentPane) {
            return target;
          }
          return {
            ...target,
            panes: {
              ...target.panes,
              [paneId]: {
                ...currentPane,
                status: "error",
                error: String(error),
              },
            },
          };
        }),
      }));
    }
  },

  markPaneExited: (workspaceId: string, paneId: string, error?: string) => {
    set((state) => ({
      workspaces: withWorkspaceUpdated(state.workspaces, workspaceId, (workspace) => {
        const pane = workspace.panes[paneId];
        if (!pane) {
          return workspace;
        }
        return {
          ...workspace,
          panes: {
            ...workspace.panes,
            [paneId]: {
              ...pane,
              status: "closed",
              error,
            },
          },
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    void get().persistSession();
  },

  updatePaneLastCommand: (workspaceId: string, paneId: string, command: string) => {
    set((state) => ({
      workspaces: withWorkspaceUpdated(state.workspaces, workspaceId, (workspace) => {
        const pane = workspace.panes[paneId];
        if (!pane) {
          return workspace;
        }
        return {
          ...workspace,
          panes: {
            ...workspace.panes,
            [paneId]: {
              ...pane,
              lastSubmittedCommand: command,
            },
          },
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    void get().persistSession();
  },

  sendInputFromPane: async (workspaceId: string, sourcePaneId: string, data: string) => {
    const state = get();
    if (workspaceId !== state.activeWorkspaceId) {
      return;
    }

    const workspace = activeWorkspaceOf(state);
    if (!workspace) {
      return;
    }

    const targetPaneIds = state.echoInput
      ? workspace.paneOrder.filter((paneId) => workspace.panes[paneId]?.status === "running")
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

  setActiveWorkspaceLayouts: (layouts: Layout[]) => {
    const activeWorkspace = activeWorkspaceOf(get());
    if (!activeWorkspace) {
      return;
    }

    set((state) => ({
      workspaces: withWorkspaceUpdated(state.workspaces, activeWorkspace.id, (workspace) => ({
        ...workspace,
        layouts,
        updatedAt: new Date().toISOString(),
      })),
    }));
    void get().persistSession();
  },

  toggleActiveWorkspaceZoom: (paneId: string) => {
    const activeWorkspace = activeWorkspaceOf(get());
    if (!activeWorkspace) {
      return;
    }

    set((state) => ({
      workspaces: withWorkspaceUpdated(state.workspaces, activeWorkspace.id, (workspace) => ({
        ...workspace,
        zoomedPaneId: workspace.zoomedPaneId === paneId ? null : paneId,
        updatedAt: new Date().toISOString(),
      })),
    }));
    void get().persistSession();
  },

  runGlobalCommand: async (command: string, execute: boolean) => {
    const workspace = activeWorkspaceOf(get());
    if (!workspace || command.trim().length === 0) {
      return [];
    }

    const paneIds = workspace.paneOrder.filter((paneId) => workspace.panes[paneId]?.status === "running");
    if (paneIds.length === 0) {
      return [];
    }

    return runGlobalCommand({ paneIds, command, execute });
  },

  saveSnapshot: async (name: string) => {
    const state = get();
    const snapshot: Snapshot = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      state: serializeSessionState(state),
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

    const activeWorkspace = activeWorkspaceOf(state);
    if (activeWorkspace) {
      await closeRunningPanes(activeWorkspace);
    }

    const restored = sanitizeSession(snapshot.state);

    set({
      workspaces: restored.workspaces,
      activeWorkspaceId: restored.activeWorkspaceId,
      activeSection: restored.activeSection,
      echoInput: restored.echoInput,
    });

    const nextActiveWorkspace = activeWorkspaceOf(get());
    if (nextActiveWorkspace) {
      for (const paneId of nextActiveWorkspace.paneOrder) {
        await get().ensurePaneSpawned(nextActiveWorkspace.id, paneId);
      }
    }

    await get().persistSession();
  },

  createBlueprint: async (name: string, workspacePaths: string[], autorunCommands: string[]) => {
    const state = get();
    const activeWorkspace = activeWorkspaceOf(state);
    const blueprint: Blueprint = {
      id: crypto.randomUUID(),
      name,
      paneCount: activeWorkspace?.paneCount ?? 1,
      workspacePaths,
      autorunCommands,
      agentAllocation: activeWorkspace?.agentAllocation,
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

    if (blueprint.workspacePaths.length > 0) {
      const targetPath = blueprint.workspacePaths[0];
      const existing = state.workspaces.find((workspace) => workspace.worktreePath === targetPath);

      if (existing) {
        await get().setActiveWorkspace(existing.id);
      } else {
        await get().createWorkspace({
          name: `Workspace ${get().workspaces.length + 1}`,
          directory: targetPath,
          paneCount: blueprint.paneCount,
          agentAllocation: normalizeAgentAllocation(blueprint.agentAllocation),
        });
      }
    }

    await get().setActiveWorkspacePaneCount(blueprint.paneCount);

    for (const command of blueprint.autorunCommands) {
      await get().runGlobalCommand(command, true);
    }

    await get().persistSession();
  },

  persistSession: async () => {
    const state = get();
    await saveSessionState(serializeSessionState(state));
  },
}));

export function getAgentDefaults(): AgentAllocation[] {
  return defaultAgentAllocation();
}
