import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "./CommandPalette";
import { useWorkspaceStore } from "../store/workspace";
import type { AgentAllocation, WorkspaceRuntime } from "../types";

function defaultAllocation(): AgentAllocation[] {
  return [
    { profile: "claude", label: "Claude", command: "claude", enabled: false, count: 0 },
    { profile: "codex", label: "Codex", command: "codex", enabled: false, count: 0 },
    { profile: "gemini", label: "Gemini", command: "gemini", enabled: false, count: 0 },
    { profile: "cursor", label: "Cursor", command: "cursor-agent", enabled: false, count: 0 },
    { profile: "opencode", label: "OpenCode", command: "opencode", enabled: false, count: 0 },
  ];
}

function workspace(id: string, name: string, branch: string, path: string): WorkspaceRuntime {
  return {
    id,
    name,
    repoRoot: path,
    branch,
    worktreePath: path,
    layoutMode: "tiling",
    paneCount: 1,
    paneOrder: ["pane-1"],
    panes: {
      "pane-1": {
        id: "pane-1",
        title: "pane-1",
        cwd: path,
        worktreePath: path,
        shell: "/bin/bash",
        status: "running",
        lastSubmittedCommand: "",
      },
    },
    layouts: [{ i: "pane-1", x: 0, y: 0, w: 3, h: 3, minW: 2, minH: 2 }],
    zoomedPaneId: null,
    agentAllocation: defaultAllocation(),
    createdAt: "2026-02-11T10:00:00.000Z",
    updatedAt: "2026-02-11T10:00:00.000Z",
  };
}

describe("CommandPalette", () => {
  const onClose = vi.fn();
  const onOpenWorkspaceModal = vi.fn();

  const setActiveWorkspace = vi.fn(async () => {});
  const setActiveWorkspacePaneCount = vi.fn(async () => {});
  const setEchoInput = vi.fn(() => {});
  const setActiveSection = vi.fn(() => {});
  const saveSnapshot = vi.fn(async () => {});
  const restoreSnapshot = vi.fn(async () => {});
  const runGlobalCommand = vi.fn(async () => []);
  const openWorktreeManager = vi.fn(async () => {});
  const refreshWorktrees = vi.fn(async () => {});
  const importWorktreeAsWorkspace = vi.fn(async () => {});

  beforeEach(() => {
    vi.clearAllMocks();

    useWorkspaceStore.setState({
      workspaces: [
        workspace("workspace-1", "Workspace 1", "main", "/repo"),
        workspace("workspace-2", "Workspace 2", "feature/login", "/repo/.worktrees/feature-login"),
      ],
      activeWorkspaceId: "workspace-1",
      snapshots: [
        {
          id: "snap-1",
          name: "Morning",
          createdAt: "2026-02-11T10:00:00.000Z",
          state: {
            workspaces: [workspace("workspace-1", "Workspace 1", "main", "/repo")],
            activeWorkspaceId: "workspace-1",
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
      echoInput: false,
      worktreeManager: {
        repoRoot: "/repo",
        loading: false,
        error: null,
        entries: [],
        lastLoadedAt: null,
        lastActionMessage: null,
      },
      setActiveWorkspace,
      setActiveWorkspacePaneCount,
      setEchoInput,
      setActiveSection,
      saveSnapshot,
      restoreSnapshot,
      runGlobalCommand,
      openWorktreeManager,
      refreshWorktrees,
      importWorktreeAsWorkspace,
    });
  });

  it("filters entries by query", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={onClose} onOpenWorkspaceModal={onOpenWorkspaceModal} />);

    await user.type(screen.getByPlaceholderText("Search actions, or type >command"), "feature/login");

    expect(screen.getByText("Switch to Workspace 2")).toBeInTheDocument();
    expect(screen.queryByText("Switch to Workspace 1")).not.toBeInTheDocument();
  });

  it("switches workspace from a palette action", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={onClose} onOpenWorkspaceModal={onOpenWorkspaceModal} />);

    await user.click(screen.getByText("Switch to Workspace 2"));

    expect(setActiveWorkspace).toHaveBeenCalledWith("workspace-2");
    expect(onClose).toHaveBeenCalled();
  });

  it("runs typed command when query uses > prefix", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={onClose} onOpenWorkspaceModal={onOpenWorkspaceModal} />);

    await user.type(screen.getByPlaceholderText("Search actions, or type >command"), ">pnpm lint");
    await user.click(screen.getByText("Run pnpm lint"));

    expect(runGlobalCommand).toHaveBeenCalledWith("pnpm lint", true);
    expect(onClose).toHaveBeenCalled();
  });

  it("restores snapshot from palette", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={onClose} onOpenWorkspaceModal={onOpenWorkspaceModal} />);

    await user.type(screen.getByPlaceholderText("Search actions, or type >command"), "morning");
    await user.click(screen.getByText("Restore Morning"));

    expect(restoreSnapshot).toHaveBeenCalledWith("snap-1");
    expect(onClose).toHaveBeenCalled();
  });

  it("opens worktree manager from palette action", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={onClose} onOpenWorkspaceModal={onOpenWorkspaceModal} />);

    await user.click(screen.getByText("Open worktree manager"));

    expect(openWorktreeManager).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
