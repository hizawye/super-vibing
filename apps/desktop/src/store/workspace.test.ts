import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "./workspace";
import type { AgentAllocation, SessionState, SpawnPaneRequest, WorkspaceRuntime } from "../types";
import * as tauriApi from "../lib/tauri";

vi.mock("../lib/tauri", () => ({
  closePane: vi.fn(async () => {}),
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
  statuses: Array<"idle" | "running" | "closed" | "error">,
  cwd = "/repo",
): WorkspaceRuntime {
  const paneOrder = Array.from({ length: paneCount }, (_, index) => `pane-${index + 1}`);

  return {
    id,
    name,
    repoRoot: cwd,
    branch: "main",
    worktreePath: cwd,
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

  useWorkspaceStore.setState({
    initialized: true,
    bootstrapping: false,
    activeSection: overrides.activeSection ?? "terminal",
    paletteOpen: false,
    echoInput: overrides.echoInput ?? false,
    workspaces: overrides.workspaces ?? [baseWorkspace],
    activeWorkspaceId: overrides.activeWorkspaceId ?? baseWorkspace.id,
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

    expect(tauriApi.closePane).toHaveBeenCalledWith("pane-1");

    expect(tauriApi.spawnPane).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        paneId: "pane-1",
      }),
    );
    expect(tauriApi.spawnPane).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        paneId: "pane-2",
      }),
    );
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
      paneId: "pane-1",
      cwd: "/repo",
      shell: "/bin/bash",
    });

    await Promise.all([first, second]);

    expect(tauriApi.spawnPane).toHaveBeenCalledTimes(1);
    expect(tauriApi.writePaneInput).toHaveBeenCalledTimes(1);
    expect(tauriApi.writePaneInput).toHaveBeenCalledWith({
      paneId: "pane-1",
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
      paneId: "pane-1",
      cwd: "/repo",
      shell: "/bin/bash",
    });

    await Promise.all([first, second]);

    expect(tauriApi.writePaneInput).toHaveBeenCalledTimes(1);
    expect(tauriApi.writePaneInput).toHaveBeenCalledWith({
      paneId: "pane-1",
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
        paneId: "pane-1",
        cwd: "/repo",
        shell: "/bin/bash",
      });

    await useWorkspaceStore.getState().ensurePaneSpawned("workspace-main", "pane-1", {
      initCommand: "codex",
      executeInit: true,
    });

    expect(tauriApi.closePane).toHaveBeenCalledWith("pane-1");
    expect(tauriApi.spawnPane).toHaveBeenCalledTimes(2);
    expect(tauriApi.writePaneInput).toHaveBeenCalledWith({
      paneId: "pane-1",
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
});
