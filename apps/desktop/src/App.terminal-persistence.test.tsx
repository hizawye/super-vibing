import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

const { paneMountSpy, paneUnmountSpy, mockStoreState, useWorkspaceStoreMock } = vi.hoisted(() => {
  const paneMountSpy = vi.fn();
  const paneUnmountSpy = vi.fn();

  const mockStoreState = {
    initialized: true,
    bootstrapping: false,
    startupError: null as string | null,
    activeSection: "terminal",
    paletteOpen: false,
    activeWorkspaceId: "workspace-1",
    themeId: "apple-dark",
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
    workspaces: [
      {
        id: "workspace-1",
        name: "Workspace 1",
        repoRoot: "/repo",
        branch: "main",
        worktreePath: "/repo",
        layoutMode: "tiling",
        paneCount: 1,
        paneOrder: ["pane-1"],
        panes: {},
        layouts: [],
        zoomedPaneId: null,
        agentAllocation: [],
        createdAt: "2026-02-13T00:00:00.000Z",
        updatedAt: "2026-02-13T00:00:00.000Z",
      },
    ],
    focusedPaneByWorkspace: {
      "workspace-1": "pane-1",
    },
    focusRequestByWorkspace: {
      "workspace-1": "pane-1",
    },
    workspaceBootSessions: {},
    worktreeManager: {
      repoRoot: null,
      loading: false,
      error: null,
      entries: [],
      lastLoadedAt: null,
      lastActionMessage: null,
    },
    bootstrap: vi.fn(async () => {}),
    clearStartupError: vi.fn(),
    resetLocalStateAndRebootstrap: vi.fn(async () => {}),
    setActiveSection: vi.fn(),
    setTheme: vi.fn(),
    setReduceMotion: vi.fn(),
    setHighContrastAssist: vi.fn(),
    setDensity: vi.fn(),
    setAgentStartupDefault: vi.fn(),
    resetAgentStartupDefaults: vi.fn(),
    setPaletteOpen: vi.fn(),
    createWorkspace: vi.fn(async () => {}),
    closeWorkspace: vi.fn(async () => {}),
    setActiveWorkspace: vi.fn(async () => {}),
    setActiveWorkspacePaneCount: vi.fn(async () => {}),
    addPaneToActiveWorkspaceAndFocus: vi.fn(async () => {}),
    createPaneWithWorktree: vi.fn(async () => "pane-2"),
    setPaneWorktree: vi.fn(async () => {}),
    setActiveWorkspaceLayoutMode: vi.fn(),
    setActiveWorkspaceLayouts: vi.fn(),
    toggleActiveWorkspaceZoom: vi.fn(),
    requestPaneTerminalFocus: vi.fn(),
    setFocusedPane: vi.fn(),
    moveFocusedPane: vi.fn(),
    resizeFocusedPaneByDelta: vi.fn(),
    pauseWorkspaceBoot: vi.fn(),
    resumeWorkspaceBoot: vi.fn(),
    openWorktreeManager: vi.fn(async () => {}),
    refreshWorktrees: vi.fn(async () => {}),
    createWorktreeForWorkspace: vi.fn(async () => ({
      id: "wt-1",
      repoRoot: "/repo",
      branch: "feature/test",
      worktreePath: "/repo/.worktrees/feature-test",
      head: "abc",
      isMainWorktree: false,
      isDetached: false,
      isLocked: false,
      isPrunable: false,
      isDirty: false,
    })),
    createManagedWorktree: vi.fn(async () => {}),
    importWorktreeAsWorkspace: vi.fn(async () => {}),
    removeManagedWorktree: vi.fn(async () => {}),
    pruneManagedWorktrees: vi.fn(async () => {}),
  };

  const useWorkspaceStoreMock = ((selector: (state: typeof mockStoreState) => unknown) =>
    selector(mockStoreState)) as ((selector: (state: typeof mockStoreState) => unknown) => unknown) & {
    getState: () => typeof mockStoreState;
  };
  useWorkspaceStoreMock.getState = () => mockStoreState;

  return {
    paneMountSpy,
    paneUnmountSpy,
    mockStoreState,
    useWorkspaceStoreMock,
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("./lib/tauri", () => ({
  reportAutomationResult: vi.fn(async () => {}),
}));

vi.mock("./lib/updater", () => ({
  updatesSupported: vi.fn(() => false),
  checkForPendingUpdate: vi.fn(async () => null),
  closePendingUpdate: vi.fn(async () => {}),
  formatUpdaterError: vi.fn((error: unknown, fallback: string) => `${fallback} ${String(error)}`.trim()),
  installPendingUpdate: vi.fn(async () => {}),
  restartToApplyUpdate: vi.fn(async () => {}),
}));

vi.mock("./store/workspace", () => ({
  useWorkspaceStore: useWorkspaceStoreMock,
  getAgentDefaults: vi.fn(() => []),
  getAgentProfileOptions: vi.fn(() => [
    { profile: "claude", label: "Claude" },
    { profile: "codex", label: "Codex" },
    { profile: "gemini", label: "Gemini" },
    { profile: "cursor", label: "Cursor" },
    { profile: "opencode", label: "OpenCode" },
  ]),
}));

vi.mock("./components/PaneGrid", () => ({
  PaneGrid: ({ workspaceId, isActive }: { workspaceId: string; isActive: boolean }) => {
    React.useEffect(() => {
      paneMountSpy(workspaceId);
      return () => {
        paneUnmountSpy(workspaceId);
      };
    }, [workspaceId]);

    return <div data-testid={`pane-grid-${workspaceId}`} data-active={String(isActive)} />;
  },
}));

describe("App terminal persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState.activeSection = "terminal";
  });

  it("keeps pane grids mounted while visiting settings", () => {
    const { container, rerender } = render(<App />);

    const initialPaneGrid = screen.getByTestId("pane-grid-workspace-1");
    expect(initialPaneGrid).toHaveAttribute("data-active", "true");
    expect(paneMountSpy).toHaveBeenCalledTimes(1);
    expect(paneUnmountSpy).not.toHaveBeenCalled();
    expect(container.querySelector(".terminal-surface")).not.toHaveAttribute("hidden");

    mockStoreState.activeSection = "settings";
    rerender(<App />);

    const settingsPaneGrid = screen.getByTestId("pane-grid-workspace-1");
    expect(settingsPaneGrid).toBe(initialPaneGrid);
    expect(settingsPaneGrid).toHaveAttribute("data-active", "false");
    expect(paneUnmountSpy).not.toHaveBeenCalled();
    expect(container.querySelector(".terminal-surface")).toHaveAttribute("hidden");
    expect(screen.getByText("Appearance and Accessibility")).toBeInTheDocument();

    mockStoreState.activeSection = "terminal";
    rerender(<App />);

    const finalPaneGrid = screen.getByTestId("pane-grid-workspace-1");
    expect(finalPaneGrid).toBe(initialPaneGrid);
    expect(finalPaneGrid).toHaveAttribute("data-active", "true");
    expect(paneUnmountSpy).not.toHaveBeenCalled();
    expect(container.querySelector(".terminal-surface")).not.toHaveAttribute("hidden");
  });
});
