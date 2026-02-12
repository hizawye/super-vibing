import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "./workspace";
import { generateTilingLayouts } from "../lib/tiling";
import type { AgentAllocation, LayoutMode, SessionState, SpawnPaneRequest, WorkspaceRuntime } from "../types";
import * as tauriApi from "../lib/tauri";
import * as persistence from "../lib/persistence";
import { toRuntimePaneId } from "../lib/panes";
import { DEFAULT_THEME_ID } from "../theme/themes";

vi.mock("../lib/tauri", () => ({
  closePane: vi.fn(async () => {}),
  getCurrentBranch: vi.fn(async () => "main"),
  getDefaultCwd: vi.fn(async () => "/repo"),
  getRuntimeStats: vi.fn(async () => ({ activePanes: 0, suspendedPanes: 0 })),
  resumePane: vi.fn(async () => {}),
  runGlobalCommand: vi.fn(async () => []),
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
  const uiPreferences = overrides.uiPreferences ?? {
    theme: DEFAULT_THEME_ID,
    reduceMotion: false,
    highContrastAssist: false,
    density: "comfortable",
  };

  useWorkspaceStore.setState({
    initialized: true,
    bootstrapping: false,
    activeSection: overrides.activeSection ?? "terminal",
    paletteOpen: false,
    echoInput: overrides.echoInput ?? false,
    themeId: uiPreferences.theme,
    reduceMotion: uiPreferences.reduceMotion,
    highContrastAssist: uiPreferences.highContrastAssist,
    density: uiPreferences.density,
    workspaces: overrides.workspaces ?? [baseWorkspace],
    activeWorkspaceId: overrides.activeWorkspaceId ?? baseWorkspace.id,
    workspaceBootSessions: {},
    snapshots: [],
    blueprints: [],
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
      activeSection: "terminal",
      paletteOpen: false,
      echoInput: false,
      themeId: DEFAULT_THEME_ID,
      reduceMotion: false,
      highContrastAssist: false,
      density: "comfortable",
      workspaces: [],
      activeWorkspaceId: null,
      workspaceBootSessions: {},
      snapshots: [],
      blueprints: [],
    });

    await useWorkspaceStore.getState().bootstrap();

    const state = useWorkspaceStore.getState();
    expect(state.themeId).toBe("apple-dark");
    expect(state.reduceMotion).toBe(false);
    expect(state.highContrastAssist).toBe(false);
    expect(state.density).toBe("comfortable");
  });

  it("persists ui preferences in serialized session state", async () => {
    useWorkspaceStore.getState().setTheme("nord");
    useWorkspaceStore.getState().setReduceMotion(true);
    useWorkspaceStore.getState().setHighContrastAssist(true);
    useWorkspaceStore.getState().setDensity("compact");
    await useWorkspaceStore.getState().persistSession();

    expect(persistence.saveSessionState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        uiPreferences: {
          theme: "nord",
          reduceMotion: true,
          highContrastAssist: true,
          density: "compact",
        },
      }),
    );
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

  it("toggles active workspace zoom idempotently", () => {
    useWorkspaceStore.getState().toggleActiveWorkspaceZoom("pane-1");
    let active = useWorkspaceStore.getState().workspaces[0];
    expect(active.zoomedPaneId).toBe("pane-1");

    useWorkspaceStore.getState().toggleActiveWorkspaceZoom("pane-1");
    active = useWorkspaceStore.getState().workspaces[0];
    expect(active.zoomedPaneId).toBeNull();
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
      workspaces: [],
      activeWorkspaceId: null,
      workspaceBootSessions: {},
      snapshots: [],
      blueprints: [],
    });

    await useWorkspaceStore.getState().bootstrap();

    expect(tauriApi.writePaneInput).toHaveBeenCalledWith({
      paneId: runtimePaneId("workspace-main", "pane-1"),
      data: "claude",
      execute: true,
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
      workspaces: [],
      activeWorkspaceId: null,
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

    await useWorkspaceStore.getState().ensurePaneSpawned("workspace-main", "pane-1", {
      initCommand: "codex",
      executeInit: true,
    });

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

    expect(tauriApi.writePaneInput).toHaveBeenCalledWith({
      paneId: runtimePaneId("workspace-main", "pane-1"),
      data: "codex",
      execute: true,
    });
  });
});
