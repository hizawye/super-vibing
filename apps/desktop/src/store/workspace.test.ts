import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "./workspace";
import { generateTilingLayouts } from "../lib/tiling";
import type { AgentAllocation, LayoutMode, SessionState, SpawnPaneRequest, WorkspaceRuntime } from "../types";
import * as tauriApi from "../lib/tauri";
import * as persistence from "../lib/persistence";
import { toRuntimePaneId } from "../lib/panes";
import { DEFAULT_THEME_ID } from "../theme/themes";

vi.mock("../lib/tauri", () => ({
  createWorktree: vi.fn(async () => ({
    id: "wt-1",
    repoRoot: "/repo",
    branch: "feature/test",
    worktreePath: "/repo/.worktrees/feature-test",
    head: "abc123",
    isMainWorktree: false,
    isDetached: false,
    isLocked: false,
    isPrunable: false,
    isDirty: false,
  })),
  closePane: vi.fn(async () => {}),
  getCurrentBranch: vi.fn(async () => "main"),
  getDefaultCwd: vi.fn(async () => "/repo"),
  getRuntimeStats: vi.fn(async () => ({ activePanes: 0, suspendedPanes: 0 })),
  listWorktrees: vi.fn(async () => []),
  pruneWorktrees: vi.fn(async () => ({ dryRun: true, paths: [], output: "" })),
  removeWorktree: vi.fn(async () => ({ worktreePath: "/repo/.worktrees/feature-test", branch: "feature/test", branchDeleted: false })),
  resolveRepoContext: vi.fn(async (requestOrCwd?: unknown) => {
    const cwd = typeof requestOrCwd === "string"
      ? requestOrCwd
      : "/repo";
    return {
      isGitRepo: true,
      repoRoot: "/repo",
      worktreePath: cwd,
      branch: "main",
    };
  }),
  resumePane: vi.fn(async () => {}),
  runGlobalCommand: vi.fn(async () => []),
  setDiscordPresenceEnabled: vi.fn(async () => {}),
  syncAutomationWorkspaces: vi.fn(async () => {}),
  spawnPane: vi.fn(async ({ paneId, cwd }: SpawnPaneRequest) => ({
    paneId,
    cwd: cwd ?? "/repo",
    shell: "/bin/bash",
  })),
  suspendPane: vi.fn(async () => {}),
  writePaneInput: vi.fn(async () => {}),
  subscribeToPaneEvents: vi.fn(() => () => {}),
}));

vi.mock("../lib/persistence", () => ({
  loadPersistedPayload: vi.fn(async () => ({
    version: 2,
    snapshots: [],
    blueprints: [],
  })),
  resetPersistedPayload: vi.fn(async () => {}),
  saveBlueprints: vi.fn(async () => {}),
  saveSessionState: vi.fn(async () => {}),
  saveSnapshots: vi.fn(async () => {}),
}));

function allocation(overrides: Partial<AgentAllocation> = {}): AgentAllocation[] {
  const defaults: AgentAllocation[] = [
    { profile: "claude", label: "Claude", command: "claude", enabled: false, count: 0 },
    { profile: "codex", label: "Codex", command: "codex", enabled: false, count: 0 },
    { profile: "gemini", label: "Gemini", command: "gemini", enabled: false, count: 0 },
    { profile: "cursor", label: "Cursor", command: "cursor-agent", enabled: false, count: 0 },
    { profile: "opencode", label: "OpenCode", command: "opencode", enabled: false, count: 0 },
  ];

  if (!overrides.profile) {
    return defaults;
  }

  return defaults.map((item) =>
    item.profile === overrides.profile ? { ...item, ...overrides } : item,
  );
}

function workspace(
  id: string,
  name: string,
  paneCount: number,
  statuses: Array<"idle" | "spawning" | "running" | "suspended" | "closed" | "error">,
  cwd = "/repo",
  layoutMode: LayoutMode = "tiling",
): WorkspaceRuntime {
  const paneOrder = Array.from({ length: paneCount }, (_, index) => `pane-${index + 1}`);

  return {
    id,
    name,
    repoRoot: cwd,
    branch: "main",
    worktreePath: cwd,
    layoutMode,
    paneCount,
    paneOrder,
    panes: Object.fromEntries(
      paneOrder.map((paneId, index) => [
        paneId,
        {
          id: paneId,
          title: paneId,
          cwd,
          worktreePath: cwd,
          shell: "/bin/bash",
          status: statuses[index] ?? "idle",
          lastSubmittedCommand: "",
        },
      ]),
    ),
    layouts: paneOrder.map((paneId, index) => ({
      i: paneId,
      x: (index % 4) * 3,
      y: Math.floor(index / 4) * 3,
      w: 3,
      h: 3,
      minW: 2,
      minH: 2,
    })),
    zoomedPaneId: null,
    agentAllocation: allocation(),
    createdAt: "2026-02-11T10:00:00.000Z",
    updatedAt: "2026-02-11T10:00:00.000Z",
  };
}

function resetStore(overrides: Partial<SessionState> = {}): void {
  const baseWorkspace = workspace("workspace-main", "Workspace 1", 2, ["running", "running"]);
  const workspaces = overrides.workspaces ?? [baseWorkspace];
  const activeWorkspaceId = overrides.activeWorkspaceId ?? workspaces[0]?.id ?? null;
  const discordPresenceEnabled = overrides.discordPresenceEnabled ?? false;
  const uiPreferences = overrides.uiPreferences ?? {
    theme: DEFAULT_THEME_ID,
    reduceMotion: false,
    highContrastAssist: false,
    density: "compact",
  };
  const agentStartupDefaults = overrides.agentStartupDefaults ?? {
    claude: "claude",
    codex: "codex",
    gemini: "gemini",
    cursor: "cursor-agent",
    opencode: "opencode",
  };

  useWorkspaceStore.setState({
    initialized: true,
    bootstrapping: false,
    startupError: null,
    activeSection: overrides.activeSection ?? "terminal",
    paletteOpen: false,
    echoInput: overrides.echoInput ?? false,
    themeId: uiPreferences.theme,
    reduceMotion: uiPreferences.reduceMotion,
    highContrastAssist: uiPreferences.highContrastAssist,
    density: uiPreferences.density,
    agentStartupDefaults,
    discordPresenceEnabled,
    workspaces,
    activeWorkspaceId,
    focusedPaneByWorkspace: Object.fromEntries(
      workspaces.map((item) => [item.id, item.paneOrder[0] ?? null]),
    ),
    focusRequestByWorkspace: Object.fromEntries(
      workspaces.map((item) => [item.id, item.paneOrder[0] ?? null]),
    ),
    terminalReadyPanesByWorkspace: {},
    workspaceBootSessions: {},
    snapshots: [],
    blueprints: [],
    worktreeManager: {
      repoRoot: "/repo",
      loading: false,
      error: null,
      entries: [],
      lastLoadedAt: null,
      lastActionMessage: null,
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function runtimePaneId(workspaceId: string, paneId: string): string {
  return toRuntimePaneId(workspaceId, paneId);
}

describe("workspace store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("clamps active workspace pane count between 1 and 16", async () => {
    await useWorkspaceStore.getState().setActiveWorkspacePaneCount(0);
    let active = useWorkspaceStore.getState().workspaces[0];
    expect(active.paneCount).toBe(1);

    await useWorkspaceStore.getState().setActiveWorkspacePaneCount(99);
    active = useWorkspaceStore.getState().workspaces[0];
    expect(active.paneCount).toBe(16);
    expect(active.paneOrder).toHaveLength(16);
  });

  it("adds a pane and moves focus to it for focused-create flow", async () => {
    await useWorkspaceStore.getState().addPaneToActiveWorkspaceAndFocus();

    const state = useWorkspaceStore.getState();
    const active = state.workspaces[0];
    expect(active.paneCount).toBe(3);
    expect(active.paneOrder).toEqual(["pane-1", "pane-2", "pane-3"]);
    expect(state.focusedPaneByWorkspace["workspace-main"]).toBe("pane-3");
    expect(state.focusRequestByWorkspace["workspace-main"]).toBe("pane-3");
    expect(tauriApi.spawnPane).toHaveBeenCalledWith(
      expect.objectContaining({
        paneId: runtimePaneId("workspace-main", "pane-3"),
      }),
    );
  });

  it("spawns pane using pane-level worktree path when available", async () => {
    const active = workspace("workspace-main", "Workspace 1", 1, ["idle"], "/repo");
    active.panes["pane-1"] = {
      ...active.panes["pane-1"],
      worktreePath: "/repo/.worktrees/feature-pane",
    };

    resetStore({
      workspaces: [active],
      activeWorkspaceId: "workspace-main",
    });

    await useWorkspaceStore.getState().ensurePaneSpawned("workspace-main", "pane-1");

    expect(tauriApi.spawnPane).toHaveBeenCalledWith(
      expect.objectContaining({
        paneId: runtimePaneId("workspace-main", "pane-1"),
        cwd: "/repo/.worktrees/feature-pane",
      }),
    );
  });

  it("creates a new pane bound to a specific worktree", async () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 1, ["running"], "/repo")],
      activeWorkspaceId: "workspace-main",
    });

    const paneId = await useWorkspaceStore
      .getState()
      .createPaneWithWorktree("workspace-main", "/repo/.worktrees/feature-new-pane");

    const active = useWorkspaceStore.getState().workspaces[0];
    expect(paneId).toBe("pane-2");
    expect(active.paneCount).toBe(2);
    expect(active.panes["pane-2"]?.worktreePath).toBe("/repo/.worktrees/feature-new-pane");
    expect(tauriApi.spawnPane).toHaveBeenCalledWith(
      expect.objectContaining({
        paneId: runtimePaneId("workspace-main", "pane-2"),
        cwd: "/repo/.worktrees/feature-new-pane",
      }),
    );
  });

  it("updates idle pane worktree without restarting process", async () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 1, ["idle"], "/repo")],
      activeWorkspaceId: "workspace-main",
    });

    await useWorkspaceStore
      .getState()
      .setPaneWorktree("workspace-main", "pane-1", "/repo/.worktrees/feature-idle");

    const pane = useWorkspaceStore.getState().workspaces[0].panes["pane-1"];
    expect(pane?.worktreePath).toBe("/repo/.worktrees/feature-idle");
    expect(pane?.cwd).toBe("/repo/.worktrees/feature-idle");
    expect(tauriApi.closePane).not.toHaveBeenCalled();
  });

  it("restarts running pane when changing worktree with restart option", async () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 1, ["running"], "/repo")],
      activeWorkspaceId: "workspace-main",
    });

    await useWorkspaceStore.getState().setPaneWorktree(
      "workspace-main",
      "pane-1",
      "/repo/.worktrees/feature-reroot",
      { restartRunning: true },
    );

    expect(tauriApi.closePane).toHaveBeenCalledWith(runtimePaneId("workspace-main", "pane-1"));
    expect(tauriApi.spawnPane).toHaveBeenCalledWith(
      expect.objectContaining({
        paneId: runtimePaneId("workspace-main", "pane-1"),
        cwd: "/repo/.worktrees/feature-reroot",
      }),
    );
    expect(useWorkspaceStore.getState().workspaces[0].panes["pane-1"]?.worktreePath)
      .toBe("/repo/.worktrees/feature-reroot");
  });

  it("defaults missing persisted ui preferences to apple-dark theme settings", async () => {
    const restoredWorkspace = workspace("workspace-main", "Workspace 1", 1, ["idle"]);
    const legacyLikeSession = {
      workspaces: [restoredWorkspace],
      activeWorkspaceId: "workspace-main",
      activeSection: "terminal",
      echoInput: false,
    } as unknown as SessionState;

    vi.mocked(persistence.loadPersistedPayload).mockResolvedValueOnce({
      version: 2,
      session: legacyLikeSession,
      snapshots: [],
      blueprints: [],
    });

    useWorkspaceStore.setState({
      initialized: false,
      bootstrapping: false,
      startupError: null,
      activeSection: "terminal",
      paletteOpen: false,
      echoInput: false,
      themeId: DEFAULT_THEME_ID,
      reduceMotion: false,
      highContrastAssist: false,
      density: "compact",
      agentStartupDefaults: {
        claude: "claude",
        codex: "codex",
        gemini: "gemini",
        cursor: "cursor-agent",
        opencode: "opencode",
      },
      workspaces: [],
      activeWorkspaceId: null,
      focusedPaneByWorkspace: {},
      terminalReadyPanesByWorkspace: {},
      workspaceBootSessions: {},
      snapshots: [],
      blueprints: [],
    });

    await useWorkspaceStore.getState().bootstrap();

    const state = useWorkspaceStore.getState();
    expect(state.themeId).toBe("apple-dark");
    expect(state.reduceMotion).toBe(false);
    expect(state.highContrastAssist).toBe(false);
    expect(state.density).toBe("compact");
    expect(state.discordPresenceEnabled).toBe(false);
  });

  it("stores startup error and exits bootstrap mode when bootstrap fails", async () => {
    vi.mocked(persistence.loadPersistedPayload).mockRejectedValueOnce(new Error("corrupt session"));

    useWorkspaceStore.setState({
      initialized: false,
      bootstrapping: false,
      startupError: null,
      workspaces: [],
      activeWorkspaceId: null,
    });

    await useWorkspaceStore.getState().bootstrap();

    const state = useWorkspaceStore.getState();
    expect(state.initialized).toBe(false);
    expect(state.bootstrapping).toBe(false);
    expect(state.startupError).toContain("corrupt session");
  });

  it("resets persisted state and reboots with default workspace", async () => {
    vi.mocked(persistence.loadPersistedPayload).mockResolvedValueOnce({
      version: 2,
      snapshots: [],
      blueprints: [],
    });

    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 1, ["running"])],
      activeWorkspaceId: "workspace-main",
    });

    await useWorkspaceStore.getState().resetLocalStateAndRebootstrap();

    const state = useWorkspaceStore.getState();
    expect(persistence.resetPersistedPayload).toHaveBeenCalledTimes(1);
    expect(state.initialized).toBe(true);
    expect(state.startupError).toBeNull();
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces[0]?.id).toBe("workspace-main");
  });

  it("persists ui preferences in serialized session state", async () => {
    useWorkspaceStore.getState().setTheme("apple-light");
    useWorkspaceStore.getState().setReduceMotion(true);
    useWorkspaceStore.getState().setHighContrastAssist(true);
    useWorkspaceStore.getState().setDensity("compact");
    await useWorkspaceStore.getState().persistSession();

    expect(persistence.saveSessionState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        uiPreferences: {
          theme: "apple-light",
          reduceMotion: true,
          highContrastAssist: true,
          density: "compact",
        },
      }),
    );
  });

  it("persists discord presence toggle in serialized session state", async () => {
    useWorkspaceStore.getState().setDiscordPresenceEnabled(true);
    await useWorkspaceStore.getState().persistSession();

    expect(persistence.saveSessionState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        discordPresenceEnabled: true,
      }),
    );
  });

  it("keeps discord presence toggle enabled when backend call fails", async () => {
    vi.mocked(tauriApi.setDiscordPresenceEnabled).mockRejectedValueOnce(new Error("discord worker unavailable"));

    useWorkspaceStore.getState().setDiscordPresenceEnabled(true);
    await Promise.resolve();

    expect(useWorkspaceStore.getState().discordPresenceEnabled).toBe(true);
    expect(tauriApi.setDiscordPresenceEnabled).toHaveBeenCalledWith(true);
  });

  it("keeps latest discord presence state during rapid toggles", async () => {
    useWorkspaceStore.getState().setDiscordPresenceEnabled(true);
    useWorkspaceStore.getState().setDiscordPresenceEnabled(false);
    useWorkspaceStore.getState().setDiscordPresenceEnabled(true);
    await Promise.resolve();

    await useWorkspaceStore.getState().persistSession();

    expect(useWorkspaceStore.getState().discordPresenceEnabled).toBe(true);
    expect(tauriApi.setDiscordPresenceEnabled).toHaveBeenLastCalledWith(true);
    expect(persistence.saveSessionState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        discordPresenceEnabled: true,
      }),
    );
  });

  it("persists global agent startup defaults and keeps existing workspaces unchanged", async () => {
    const existing = workspace("workspace-main", "Workspace 1", 1, ["running"]);
    existing.agentAllocation = allocation({ profile: "codex", enabled: true, count: 1 }).map((item) =>
      item.profile === "codex" ? { ...item, command: "codex-old" } : item,
    );

    resetStore({
      workspaces: [existing],
      activeWorkspaceId: "workspace-main",
    });

    useWorkspaceStore.getState().setAgentStartupDefault("codex", "codex --model gpt-5");
    await useWorkspaceStore.getState().persistSession();

    const state = useWorkspaceStore.getState();
    expect(state.agentStartupDefaults.codex).toBe("codex --model gpt-5");
    expect(state.workspaces[0]?.agentAllocation.find((item) => item.profile === "codex")?.command).toBe("codex-old");
    expect(persistence.saveSessionState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        agentStartupDefaults: expect.objectContaining({
          codex: "codex --model gpt-5",
        }),
      }),
    );
  });

  it("uses global startup defaults for newly imported worktrees", async () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 1, ["running"], "/repo")],
      activeWorkspaceId: "workspace-main",
    });

    useWorkspaceStore.getState().setAgentStartupDefault("claude", "claude --print");
    useWorkspaceStore.getState().setAgentStartupDefault("codex", "codex --sandbox read-only");

    await useWorkspaceStore.getState().importWorktreeAsWorkspace("/repo/.worktrees/feature-defaults");

    const createdWorkspace = useWorkspaceStore.getState().workspaces.find(
      (item) => item.worktreePath === "/repo/.worktrees/feature-defaults",
    );

    expect(createdWorkspace).toBeDefined();
    expect(createdWorkspace?.agentAllocation.find((item) => item.profile === "claude")?.command).toBe("claude --print");
    expect(createdWorkspace?.agentAllocation.find((item) => item.profile === "codex")?.command).toBe("codex --sandbox read-only");
  });

  it("rebalances pane layout in tiling mode when pane count changes", async () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 2, ["running", "running"], "/repo", "tiling")],
      activeWorkspaceId: "workspace-main",
    });

    await useWorkspaceStore.getState().setActiveWorkspacePaneCount(3);

    const active = useWorkspaceStore.getState().workspaces[0];
    expect(active.layouts).toEqual(generateTilingLayouts(active.paneOrder));
  });

  it("preserves existing pane positions in free-form mode when increasing pane count", async () => {
    const freeformWorkspace = workspace("workspace-main", "Workspace 1", 2, ["running", "running"], "/repo", "freeform");
    freeformWorkspace.layouts = [
      { i: "pane-1", x: 0, y: 0, w: 6, h: 4, minW: 2, minH: 2 },
      { i: "pane-2", x: 6, y: 0, w: 6, h: 4, minW: 2, minH: 2 },
    ];

    resetStore({
      workspaces: [freeformWorkspace],
      activeWorkspaceId: "workspace-main",
    });

    await useWorkspaceStore.getState().setActiveWorkspacePaneCount(3);

    const active = useWorkspaceStore.getState().workspaces[0];
    expect(active.layouts.find((layout) => layout.i === "pane-1")).toMatchObject({ x: 0, y: 0, w: 6, h: 4 });
    expect(active.layouts.find((layout) => layout.i === "pane-2")).toMatchObject({ x: 6, y: 0, w: 6, h: 4 });
  });

  it("recomputes layout when switching workspace mode to tiling", () => {
    const freeformWorkspace = workspace("workspace-main", "Workspace 1", 3, ["running", "running", "running"], "/repo", "freeform");
    freeformWorkspace.layouts = [
      { i: "pane-1", x: 0, y: 0, w: 12, h: 2, minW: 2, minH: 2 },
      { i: "pane-2", x: 0, y: 2, w: 6, h: 6, minW: 2, minH: 2 },
      { i: "pane-3", x: 6, y: 2, w: 6, h: 6, minW: 2, minH: 2 },
    ];

    resetStore({
      workspaces: [freeformWorkspace],
      activeWorkspaceId: "workspace-main",
    });

    useWorkspaceStore.getState().setActiveWorkspaceLayoutMode("tiling");

    const active = useWorkspaceStore.getState().workspaces[0];
    expect(active.layoutMode).toBe("tiling");
    expect(active.layouts).toEqual(generateTilingLayouts(active.paneOrder));
  });

  it("skips no-op free-form layout updates", () => {
    const freeformWorkspace = workspace("workspace-main", "Workspace 1", 3, ["running", "running", "running"], "/repo", "freeform");
    freeformWorkspace.layouts = [
      { i: "pane-1", x: 0, y: 0, w: 12, h: 2, minW: 2, minH: 2 },
      { i: "pane-2", x: 0, y: 2, w: 6, h: 6, minW: 2, minH: 2 },
      { i: "pane-3", x: 6, y: 2, w: 6, h: 6, minW: 2, minH: 2 },
    ];

    resetStore({
      workspaces: [freeformWorkspace],
      activeWorkspaceId: "workspace-main",
    });

    const beforeWorkspace = useWorkspaceStore.getState().workspaces[0];
    const equivalentLayouts = beforeWorkspace.layouts.map((layout) => ({ ...layout }));

    useWorkspaceStore.getState().setActiveWorkspaceLayouts(equivalentLayouts);

    const afterWorkspace = useWorkspaceStore.getState().workspaces[0];
    expect(afterWorkspace).toBe(beforeWorkspace);
  });

  it("resizes focused pane in free-form mode", () => {
    const freeformWorkspace = workspace("workspace-main", "Workspace 1", 2, ["running", "running"], "/repo", "freeform");
    freeformWorkspace.layouts = [
      { i: "pane-1", x: 0, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
      { i: "pane-2", x: 3, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
    ];

    resetStore({
      workspaces: [freeformWorkspace],
      activeWorkspaceId: "workspace-main",
    });

    useWorkspaceStore.getState().setFocusedPane("workspace-main", "pane-1");
    useWorkspaceStore.getState().resizeFocusedPaneByDelta("workspace-main", 1, -1);

    const active = useWorkspaceStore.getState().workspaces[0];
    expect(active.layouts.find((layout) => layout.i === "pane-1")).toMatchObject({ w: 4, h: 2 });
  });

  it("ignores focused pane resize in tiling mode", () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 2, ["running", "running"], "/repo", "tiling")],
      activeWorkspaceId: "workspace-main",
    });

    const before = useWorkspaceStore.getState().workspaces[0];
    useWorkspaceStore.getState().resizeFocusedPaneByDelta("workspace-main", 1, 1);
    const after = useWorkspaceStore.getState().workspaces[0];

    expect(after.layouts).toEqual(before.layouts);
  });

  it("toggles active workspace zoom idempotently", () => {
    useWorkspaceStore.getState().toggleActiveWorkspaceZoom("pane-1");
    let active = useWorkspaceStore.getState().workspaces[0];
    expect(active.zoomedPaneId).toBe("pane-1");

    useWorkspaceStore.getState().toggleActiveWorkspaceZoom("pane-1");
    active = useWorkspaceStore.getState().workspaces[0];
    expect(active.zoomedPaneId).toBeNull();
  });

  it("moves focused pane by direction and keeps stable when no candidate exists", () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 4, ["running", "running", "running", "running"])],
      activeWorkspaceId: "workspace-main",
    });

    useWorkspaceStore.getState().setFocusedPane("workspace-main", "pane-1");
    useWorkspaceStore.getState().moveFocusedPane("workspace-main", "right");
    let state = useWorkspaceStore.getState();
    expect(state.focusedPaneByWorkspace["workspace-main"]).toBe("pane-2");

    useWorkspaceStore.getState().moveFocusedPane("workspace-main", "up");
    state = useWorkspaceStore.getState();
    expect(state.focusedPaneByWorkspace["workspace-main"]).toBe("pane-2");
  });

  it("tracks focus request target when focused pane changes", () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 3, ["running", "running", "running"])],
      activeWorkspaceId: "workspace-main",
    });

    useWorkspaceStore.getState().setFocusedPane("workspace-main", "pane-2");
    let state = useWorkspaceStore.getState();
    expect(state.focusedPaneByWorkspace["workspace-main"]).toBe("pane-2");
    expect(state.focusRequestByWorkspace["workspace-main"]).toBe("pane-2");

    useWorkspaceStore.getState().moveFocusedPane("workspace-main", "right");
    state = useWorkspaceStore.getState();
    expect(state.focusedPaneByWorkspace["workspace-main"]).toBe("pane-3");
    expect(state.focusRequestByWorkspace["workspace-main"]).toBe("pane-3");
  });

  it("reassigns focus when focused pane is removed by pane-count decrease", async () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 4, ["running", "running", "running", "running"])],
      activeWorkspaceId: "workspace-main",
    });

    useWorkspaceStore.getState().setFocusedPane("workspace-main", "pane-4");
    await useWorkspaceStore.getState().setActiveWorkspacePaneCount(2);

    const state = useWorkspaceStore.getState();
    expect(state.workspaces[0]?.paneOrder).toEqual(["pane-1", "pane-2"]);
    expect(state.focusedPaneByWorkspace["workspace-main"]).toBe("pane-2");
  });

  it("broadcasts input only to running panes when echo mode is on", async () => {
    resetStore({
      echoInput: true,
      workspaces: [workspace("workspace-main", "Workspace 1", 3, ["running", "running", "closed"])],
      activeWorkspaceId: "workspace-main",
    });

    await useWorkspaceStore.getState().sendInputFromPane("workspace-main", "pane-1", "ls");

    expect(tauriApi.writePaneInput).toHaveBeenNthCalledWith(1, {
      paneId: runtimePaneId("workspace-main", "pane-1"),
      data: "ls",
      execute: false,
    });
    expect(tauriApi.writePaneInput).toHaveBeenNthCalledWith(2, {
      paneId: runtimePaneId("workspace-main", "pane-2"),
      data: "ls",
      execute: false,
    });
    expect(tauriApi.writePaneInput).toHaveBeenCalledTimes(2);
  });

  it("creates workspace and maps enabled agents to pane init commands", async () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 1, ["running"])],
      activeWorkspaceId: "workspace-main",
    });

    await useWorkspaceStore.getState().createWorkspace({
      name: "Workspace 2",
      directory: "/repo/.worktrees/feature-ai",
      paneCount: 2,
      agentAllocation: allocation({ profile: "claude", enabled: true, count: 1 }),
    });

    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toHaveLength(2);
    expect(tauriApi.closePane).not.toHaveBeenCalled();

    expect(tauriApi.spawnPane).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        paneId: runtimePaneId(state.activeWorkspaceId ?? "workspace-main", "pane-1"),
      }),
    );
    expect(tauriApi.spawnPane).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        paneId: runtimePaneId(state.activeWorkspaceId ?? "workspace-main", "pane-2"),
      }),
    );
  });

  it("keeps running terminals alive when switching workspaces", async () => {
    const workspaceMain = workspace("workspace-main", "Workspace 1", 2, ["running", "running"]);
    const workspaceTwo = workspace("workspace-two", "Workspace 2", 2, ["running", "running"]);

    resetStore({
      workspaces: [workspaceMain, workspaceTwo],
      activeWorkspaceId: "workspace-main",
    });

    await useWorkspaceStore.getState().setActiveWorkspace("workspace-two");
    await useWorkspaceStore.getState().setActiveWorkspace("workspace-main");

    expect(tauriApi.closePane).not.toHaveBeenCalled();
    expect(tauriApi.spawnPane).not.toHaveBeenCalled();
  });

  it("runs assigned agent command when reopening a workspace tab", async () => {
    const workspaceMain = workspace("workspace-main", "Workspace 1", 1, ["running"]);
    const workspaceTwo = workspace("workspace-two", "Workspace 2", 1, ["idle"]);
    workspaceTwo.agentAllocation = allocation({ profile: "codex", enabled: true, count: 1 });

    resetStore({
      workspaces: [workspaceMain, workspaceTwo],
      activeWorkspaceId: "workspace-main",
    });

    useWorkspaceStore.getState().markPaneTerminalReady("workspace-two", "pane-1");
    await useWorkspaceStore.getState().setActiveWorkspace("workspace-two");

    expect(tauriApi.writePaneInput).toHaveBeenCalledWith({
      paneId: runtimePaneId("workspace-two", "pane-1"),
      data: "codex",
      execute: true,
    });
  });

  it("runs init command for all assigned panes when concurrent spawns mark later panes running", async () => {
    const workspaceMain = workspace("workspace-main", "Workspace 1", 1, ["running"]);
    const workspaceTwo = workspace("workspace-two", "Workspace 2", 4, ["idle", "idle", "idle", "idle"]);
    workspaceTwo.agentAllocation = allocation({ profile: "codex", enabled: true, count: 4 });

    resetStore({
      workspaces: [workspaceMain, workspaceTwo],
      activeWorkspaceId: "workspace-main",
    });
    useWorkspaceStore.getState().markPaneTerminalReady("workspace-two", "pane-1");
    useWorkspaceStore.getState().markPaneTerminalReady("workspace-two", "pane-2");
    useWorkspaceStore.getState().markPaneTerminalReady("workspace-two", "pane-3");
    useWorkspaceStore.getState().markPaneTerminalReady("workspace-two", "pane-4");

    let injected = false;
    vi.mocked(tauriApi.spawnPane).mockImplementation(async ({ paneId, cwd }) => {
      if (paneId === runtimePaneId("workspace-two", "pane-1") && !injected) {
        injected = true;
        await Promise.all([
          useWorkspaceStore.getState().ensurePaneSpawned("workspace-two", "pane-2"),
          useWorkspaceStore.getState().ensurePaneSpawned("workspace-two", "pane-3"),
          useWorkspaceStore.getState().ensurePaneSpawned("workspace-two", "pane-4"),
        ]);
      }

      return {
        paneId,
        cwd: cwd ?? "/repo",
        shell: "/bin/bash",
      };
    });

    await useWorkspaceStore.getState().setActiveWorkspace("workspace-two");

    await vi.waitFor(() => {
      expect(tauriApi.writePaneInput).toHaveBeenCalledTimes(4);
    });
    expect(tauriApi.writePaneInput).toHaveBeenCalledWith({
      paneId: runtimePaneId("workspace-two", "pane-1"),
      data: "codex",
      execute: true,
    });
    expect(tauriApi.writePaneInput).toHaveBeenCalledWith({
      paneId: runtimePaneId("workspace-two", "pane-2"),
      data: "codex",
      execute: true,
    });
    expect(tauriApi.writePaneInput).toHaveBeenCalledWith({
      paneId: runtimePaneId("workspace-two", "pane-3"),
      data: "codex",
      execute: true,
    });
    expect(tauriApi.writePaneInput).toHaveBeenCalledWith({
      paneId: runtimePaneId("workspace-two", "pane-4"),
      data: "codex",
      execute: true,
    });
  });

  it("does not re-run init for panes already running at activation start", async () => {
    const workspaceMain = workspace("workspace-main", "Workspace 1", 1, ["running"]);
    const workspaceTwo = workspace("workspace-two", "Workspace 2", 2, ["running", "idle"]);
    workspaceTwo.agentAllocation = allocation({ profile: "codex", enabled: true, count: 2 });

    resetStore({
      workspaces: [workspaceMain, workspaceTwo],
      activeWorkspaceId: "workspace-main",
    });

    useWorkspaceStore.getState().markPaneTerminalReady("workspace-two", "pane-2");
    await useWorkspaceStore.getState().setActiveWorkspace("workspace-two");

    await vi.waitFor(() => {
      expect(tauriApi.writePaneInput).toHaveBeenCalledTimes(1);
    });
    expect(tauriApi.writePaneInput).toHaveBeenCalledWith({
      paneId: runtimePaneId("workspace-two", "pane-2"),
      data: "codex",
      execute: true,
    });
  });

  it("runs assigned agent command after bootstrap from persisted session", async () => {
    const restoredWorkspace = workspace("workspace-main", "Workspace 1", 1, ["idle"]);
    restoredWorkspace.agentAllocation = allocation({ profile: "claude", enabled: true, count: 1 });

    vi.mocked(persistence.loadPersistedPayload).mockResolvedValueOnce({
      version: 2,
      session: {
        workspaces: [restoredWorkspace],
        activeWorkspaceId: "workspace-main",
        activeSection: "terminal",
        echoInput: false,
        uiPreferences: {
          theme: "apple-dark",
          reduceMotion: false,
          highContrastAssist: false,
          density: "comfortable",
        },
      },
      snapshots: [],
      blueprints: [],
    });

    useWorkspaceStore.setState({
      initialized: false,
      bootstrapping: false,
      activeSection: "terminal",
      paletteOpen: false,
      echoInput: false,
      themeId: DEFAULT_THEME_ID,
      reduceMotion: false,
      highContrastAssist: false,
      density: "comfortable",
      agentStartupDefaults: {
        claude: "claude",
        codex: "codex",
        gemini: "gemini",
        cursor: "cursor-agent",
        opencode: "opencode",
      },
      workspaces: [],
      activeWorkspaceId: null,
      focusedPaneByWorkspace: {},
      terminalReadyPanesByWorkspace: {},
      workspaceBootSessions: {},
      snapshots: [],
      blueprints: [],
    });

    await useWorkspaceStore.getState().bootstrap();
    useWorkspaceStore.getState().markPaneTerminalReady("workspace-main", "pane-1");

    await vi.waitFor(() => {
      expect(tauriApi.writePaneInput).toHaveBeenCalledWith({
        paneId: runtimePaneId("workspace-main", "pane-1"),
        data: "claude",
        execute: true,
      });
    });
  });

  it("defaults layout mode to tiling for persisted sessions missing layoutMode", async () => {
    const restoredWorkspace = workspace("workspace-main", "Workspace 1", 2, ["idle", "idle"]);
    const legacyLikeWorkspace = { ...restoredWorkspace } as Record<string, unknown>;
    delete legacyLikeWorkspace.layoutMode;

    vi.mocked(persistence.loadPersistedPayload).mockResolvedValueOnce({
      version: 2,
      session: {
        workspaces: [legacyLikeWorkspace],
        activeWorkspaceId: "workspace-main",
        activeSection: "terminal",
        echoInput: false,
        uiPreferences: {
          theme: "apple-dark",
          reduceMotion: false,
          highContrastAssist: false,
          density: "comfortable",
        },
      } as unknown as SessionState,
      snapshots: [],
      blueprints: [],
    });

    useWorkspaceStore.setState({
      initialized: false,
      bootstrapping: false,
      activeSection: "terminal",
      paletteOpen: false,
      echoInput: false,
      themeId: DEFAULT_THEME_ID,
      reduceMotion: false,
      highContrastAssist: false,
      density: "comfortable",
      agentStartupDefaults: {
        claude: "claude",
        codex: "codex",
        gemini: "gemini",
        cursor: "cursor-agent",
        opencode: "opencode",
      },
      workspaces: [],
      activeWorkspaceId: null,
      focusedPaneByWorkspace: {},
      terminalReadyPanesByWorkspace: {},
      workspaceBootSessions: {},
      snapshots: [],
      blueprints: [],
    });

    await useWorkspaceStore.getState().bootstrap();

    const active = useWorkspaceStore.getState().workspaces[0];
    expect(active.layoutMode).toBe("tiling");
    expect(active.layouts).toEqual(generateTilingLayouts(active.paneOrder));
  });

  it("dedupes concurrent spawn calls and runs init command once", async () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 1, ["idle"])],
      activeWorkspaceId: "workspace-main",
    });

    const gate = deferred<{ paneId: string; cwd: string; shell: string }>();
    vi.mocked(tauriApi.spawnPane).mockImplementationOnce(async () => gate.promise);

    const first = useWorkspaceStore.getState().ensurePaneSpawned("workspace-main", "pane-1", {
      initCommand: "codex",
      executeInit: true,
    });
    const second = useWorkspaceStore.getState().ensurePaneSpawned("workspace-main", "pane-1");

    expect(tauriApi.spawnPane).toHaveBeenCalledTimes(1);

    useWorkspaceStore.getState().markPaneTerminalReady("workspace-main", "pane-1");
    gate.resolve({
      paneId: runtimePaneId("workspace-main", "pane-1"),
      cwd: "/repo",
      shell: "/bin/bash",
    });

    await Promise.all([first, second]);

    expect(tauriApi.spawnPane).toHaveBeenCalledTimes(1);
    expect(tauriApi.writePaneInput).toHaveBeenCalledTimes(1);
    expect(tauriApi.writePaneInput).toHaveBeenCalledWith({
      paneId: runtimePaneId("workspace-main", "pane-1"),
      data: "codex",
      execute: true,
    });
    expect(useWorkspaceStore.getState().workspaces[0].panes["pane-1"]?.status).toBe("running");
  });

  it("keeps init command when second caller adds it during in-flight spawn", async () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 1, ["idle"])],
      activeWorkspaceId: "workspace-main",
    });

    const gate = deferred<{ paneId: string; cwd: string; shell: string }>();
    vi.mocked(tauriApi.spawnPane).mockImplementationOnce(async () => gate.promise);

    const first = useWorkspaceStore.getState().ensurePaneSpawned("workspace-main", "pane-1");
    const second = useWorkspaceStore.getState().ensurePaneSpawned("workspace-main", "pane-1", {
      initCommand: "claude",
      executeInit: true,
    });

    expect(tauriApi.spawnPane).toHaveBeenCalledTimes(1);

    useWorkspaceStore.getState().markPaneTerminalReady("workspace-main", "pane-1");
    gate.resolve({
      paneId: runtimePaneId("workspace-main", "pane-1"),
      cwd: "/repo",
      shell: "/bin/bash",
    });

    await Promise.all([first, second]);

    expect(tauriApi.writePaneInput).toHaveBeenCalledTimes(1);
    expect(tauriApi.writePaneInput).toHaveBeenCalledWith({
      paneId: runtimePaneId("workspace-main", "pane-1"),
      data: "claude",
      execute: true,
    });
  });

  it("retries once on pane-already-exists conflicts", async () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 1, ["idle"])],
      activeWorkspaceId: "workspace-main",
    });

    vi.mocked(tauriApi.spawnPane)
      .mockRejectedValueOnce(new Error("conflict error: pane `pane-1` already exists"))
      .mockResolvedValueOnce({
        paneId: runtimePaneId("workspace-main", "pane-1"),
        cwd: "/repo",
        shell: "/bin/bash",
      });

    const ensure = useWorkspaceStore.getState().ensurePaneSpawned("workspace-main", "pane-1", {
      initCommand: "codex",
      executeInit: true,
    });
    useWorkspaceStore.getState().markPaneTerminalReady("workspace-main", "pane-1");
    await ensure;

    expect(tauriApi.closePane).toHaveBeenCalledWith(runtimePaneId("workspace-main", "pane-1"));
    expect(tauriApi.spawnPane).toHaveBeenCalledTimes(2);
    expect(tauriApi.writePaneInput).toHaveBeenCalledWith({
      paneId: runtimePaneId("workspace-main", "pane-1"),
      data: "codex",
      execute: true,
    });
    expect(useWorkspaceStore.getState().workspaces[0].panes["pane-1"]?.status).toBe("running");
  });

  it("sets error state for non-conflict spawn failures", async () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 1, ["idle"])],
      activeWorkspaceId: "workspace-main",
    });

    vi.mocked(tauriApi.spawnPane).mockRejectedValueOnce(new Error("spawn failed"));

    await useWorkspaceStore.getState().ensurePaneSpawned("workspace-main", "pane-1", {
      initCommand: "codex",
      executeInit: true,
    });

    const pane = useWorkspaceStore.getState().workspaces[0].panes["pane-1"];
    expect(pane?.status).toBe("error");
    expect(pane?.error).toContain("spawn failed");
  });

  it("waits for terminal-ready signal before flushing init command", async () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 1, ["idle"])],
      activeWorkspaceId: "workspace-main",
    });

    await useWorkspaceStore.getState().ensurePaneSpawned("workspace-main", "pane-1", {
      initCommand: "codex",
      executeInit: true,
    });

    expect(tauriApi.writePaneInput).not.toHaveBeenCalled();

    useWorkspaceStore.getState().markPaneTerminalReady("workspace-main", "pane-1");

    await vi.waitFor(() => {
      expect(tauriApi.writePaneInput).toHaveBeenCalledWith({
        paneId: runtimePaneId("workspace-main", "pane-1"),
        data: "codex",
        execute: true,
      });
    });
  });

  it("resumes a suspended pane without respawning", async () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 1, ["running"])],
      activeWorkspaceId: "workspace-main",
    });
    useWorkspaceStore.setState((state) => ({
      workspaces: state.workspaces.map((item) => ({
        ...item,
        panes: {
          ...item.panes,
          "pane-1": {
            ...item.panes["pane-1"],
            status: "suspended",
          },
        },
      })),
    }));

    await useWorkspaceStore.getState().ensurePaneSpawned("workspace-main", "pane-1");

    expect(tauriApi.resumePane).toHaveBeenCalledWith(runtimePaneId("workspace-main", "pane-1"));
    expect(tauriApi.spawnPane).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().workspaces[0].panes["pane-1"]?.status).toBe("running");
  });

  it("batches rapid pane input writes per target pane", async () => {
    resetStore({
      echoInput: false,
      workspaces: [workspace("workspace-main", "Workspace 1", 1, ["running"])],
      activeWorkspaceId: "workspace-main",
    });

    await Promise.all([
      useWorkspaceStore.getState().sendInputFromPane("workspace-main", "pane-1", "c"),
      useWorkspaceStore.getState().sendInputFromPane("workspace-main", "pane-1", "d"),
    ]);

    expect(tauriApi.writePaneInput).toHaveBeenCalledTimes(1);
    expect(tauriApi.writePaneInput).toHaveBeenCalledWith({
      paneId: runtimePaneId("workspace-main", "pane-1"),
      data: "cd",
      execute: false,
    });
  });

  it("maps global command runtime pane ids back to logical pane ids", async () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 2, ["running", "running"])],
      activeWorkspaceId: "workspace-main",
    });

    vi.mocked(tauriApi.runGlobalCommand).mockResolvedValueOnce([
      { paneId: runtimePaneId("workspace-main", "pane-1"), ok: true },
      { paneId: runtimePaneId("workspace-main", "pane-2"), ok: true },
    ]);

    const result = await useWorkspaceStore.getState().runGlobalCommand("pwd", true);

    expect(tauriApi.runGlobalCommand).toHaveBeenCalledWith({
      paneIds: [
        runtimePaneId("workspace-main", "pane-1"),
        runtimePaneId("workspace-main", "pane-2"),
      ],
      command: "pwd",
      execute: true,
    });
    expect(result).toEqual([
      { paneId: "pane-1", ok: true },
      { paneId: "pane-2", ok: true },
    ]);
  });

  it("saves and restores snapshot session state", async () => {
    await useWorkspaceStore.getState().saveSnapshot("snapshot-1");

    const snapshot = useWorkspaceStore.getState().snapshots[0];
    expect(snapshot.name).toBe("snapshot-1");

    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 1, ["idle"])],
      activeWorkspaceId: "workspace-main",
      echoInput: false,
    });

    useWorkspaceStore.setState({ snapshots: [snapshot] });
    await useWorkspaceStore.getState().restoreSnapshot(snapshot.id);

    const state = useWorkspaceStore.getState();
    expect(state.workspaces[0].paneCount).toBe(2);
    expect(state.activeWorkspaceId).toBe("workspace-main");
  });

  it("runs assigned agent command when restoring snapshot", async () => {
    const restoredWorkspace = workspace("workspace-main", "Workspace 1", 1, ["idle"]);
    restoredWorkspace.agentAllocation = allocation({ profile: "codex", enabled: true, count: 1 });

    resetStore({
      workspaces: [workspace("workspace-source", "Workspace Source", 1, ["running"])],
      activeWorkspaceId: "workspace-source",
    });

    useWorkspaceStore.setState({
      snapshots: [
        {
          id: "snapshot-agent",
          name: "snapshot-agent",
          createdAt: "2026-02-12T10:00:00.000Z",
          state: {
            workspaces: [restoredWorkspace],
            activeWorkspaceId: "workspace-main",
            activeSection: "terminal",
            echoInput: false,
            uiPreferences: {
              theme: "apple-dark",
              reduceMotion: false,
              highContrastAssist: false,
              density: "comfortable",
            },
          },
        },
      ],
    });

    await useWorkspaceStore.getState().restoreSnapshot("snapshot-agent");
    useWorkspaceStore.getState().markPaneTerminalReady("workspace-main", "pane-1");

    await vi.waitFor(() => {
      expect(tauriApi.writePaneInput).toHaveBeenCalledWith({
        paneId: runtimePaneId("workspace-main", "pane-1"),
        data: "codex",
        execute: true,
      });
    });
  });

  it("refreshes worktree manager entries for active repository", async () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 1, ["running"], "/repo")],
      activeWorkspaceId: "workspace-main",
    });

    vi.mocked(tauriApi.listWorktrees).mockResolvedValueOnce([
      {
        id: "wt-1",
        repoRoot: "/repo",
        branch: "feature/auth",
        worktreePath: "/repo/.worktrees/feature-auth",
        head: "abc123",
        isMainWorktree: false,
        isDetached: false,
        isLocked: false,
        isPrunable: false,
        isDirty: false,
      },
    ]);

    await useWorkspaceStore.getState().refreshWorktrees();

    const state = useWorkspaceStore.getState();
    expect(tauriApi.listWorktrees).toHaveBeenCalledWith("/repo");
    expect(state.worktreeManager.repoRoot).toBe("/repo");
    expect(state.worktreeManager.entries).toHaveLength(1);
    expect(state.worktreeManager.entries[0]?.branch).toBe("feature/auth");
  });

  it("imports an existing worktree by switching instead of creating duplicate workspace", async () => {
    resetStore({
      workspaces: [
        workspace("workspace-main", "Workspace 1", 1, ["running"], "/repo"),
        workspace("workspace-auth", "Workspace Auth", 1, ["running"], "/repo/.worktrees/feature-auth"),
      ],
      activeWorkspaceId: "workspace-main",
    });

    await useWorkspaceStore.getState().importWorktreeAsWorkspace("/repo/.worktrees/feature-auth");

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("workspace-auth");
  });

  it("creates managed worktree without opening workspace when openAfterCreate is false", async () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 1, ["running"], "/repo")],
      activeWorkspaceId: "workspace-main",
    });
    useWorkspaceStore.setState((state) => ({
      worktreeManager: {
        ...state.worktreeManager,
        repoRoot: "/repo",
      },
    }));

    await useWorkspaceStore.getState().createManagedWorktree({
      mode: "newBranch",
      branch: "feature/no-open",
      openAfterCreate: false,
    });

    expect(tauriApi.createWorktree).toHaveBeenCalledWith({
      repoRoot: "/repo",
      mode: "newBranch",
      branch: "feature/no-open",
      baseRef: undefined,
    });
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
  });

  it("removes managed worktree after closing matching open workspace tabs", async () => {
    resetStore({
      workspaces: [
        workspace("workspace-main", "Workspace 1", 1, ["running"], "/repo"),
        workspace("workspace-auth", "Workspace Auth", 1, ["running"], "/repo/.worktrees/feature-auth"),
      ],
      activeWorkspaceId: "workspace-main",
    });
    useWorkspaceStore.setState((state) => ({
      worktreeManager: {
        ...state.worktreeManager,
        repoRoot: "/repo",
      },
    }));

    await useWorkspaceStore.getState().removeManagedWorktree({
      worktreePath: "/repo/.worktrees/feature-auth",
      force: false,
      deleteBranch: false,
    });

    expect(tauriApi.removeWorktree).toHaveBeenCalledWith({
      repoRoot: "/repo",
      worktreePath: "/repo/.worktrees/feature-auth",
      force: false,
      deleteBranch: false,
    });
    expect(useWorkspaceStore.getState().workspaces.map((item) => item.id)).not.toContain("workspace-auth");
  });

  it("blocks worktree removal when it is the only open workspace", async () => {
    resetStore({
      workspaces: [workspace("workspace-main", "Workspace 1", 1, ["running"], "/repo")],
      activeWorkspaceId: "workspace-main",
    });
    useWorkspaceStore.setState((state) => ({
      worktreeManager: {
        ...state.worktreeManager,
        repoRoot: "/repo",
      },
    }));

    await expect(
      useWorkspaceStore.getState().removeManagedWorktree({
        worktreePath: "/repo",
        force: false,
        deleteBranch: false,
      }),
    ).rejects.toThrow("Cannot remove the only open workspace worktree.");
    expect(tauriApi.removeWorktree).not.toHaveBeenCalled();
  });
});
