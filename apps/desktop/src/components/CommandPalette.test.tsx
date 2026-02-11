import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "./CommandPalette";
import { useWorkspaceStore } from "../store/workspace";

describe("CommandPalette", () => {
  const onClose = vi.fn();
  const setActiveWorkspace = vi.fn(async () => {});
  const restoreSnapshot = vi.fn(async () => {});
  const runGlobalCommand = vi.fn(async () => []);

  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      paletteOpen: true,
      workspaces: [
        {
          id: "workspace-1",
          repoRoot: "/repo",
          branch: "main",
          worktreePath: "/repo",
        },
        {
          id: "workspace-2",
          repoRoot: "/repo",
          branch: "feature/login",
          worktreePath: "/repo/.worktrees/feature-login",
        },
      ],
      activeWorkspaceId: "workspace-1",
      snapshots: [
        {
          id: "snap-1",
          name: "Morning",
          createdAt: "2026-02-11T10:00:00.000Z",
          state: {
            paneCount: 1,
            paneOrder: ["pane-1"],
            panes: {
              "pane-1": {
                id: "pane-1",
                title: "pane-1",
                cwd: "/repo",
                shell: "/bin/bash",
                status: "running",
                lastSubmittedCommand: "",
              },
            },
            layouts: [{ i: "pane-1", x: 0, y: 0, w: 3, h: 3, minW: 2, minH: 2 }],
            zoomedPaneId: null,
            echoInput: false,
            workspaces: [],
            activeWorkspaceId: null,
          },
        },
      ],
      setActiveWorkspace,
      restoreSnapshot,
      runGlobalCommand,
    });
  });

  it("filters workspace list by query", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={onClose} />);

    await user.type(screen.getByPlaceholderText("Filter workspaces"), "feature");
    expect(screen.getByText("feature/login")).toBeInTheDocument();
    expect(screen.queryByText("main")).not.toBeInTheDocument();
  });

  it("dispatches workspace switch and closes palette", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={onClose} />);

    await user.click(screen.getByText("feature/login"));
    expect(setActiveWorkspace).toHaveBeenCalledWith("workspace-2");
    expect(onClose).toHaveBeenCalled();
  });

  it("runs global command with execute toggle", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={onClose} />);

    await user.type(screen.getByPlaceholderText("npm test"), "pnpm lint");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Run" }));

    expect(runGlobalCommand).toHaveBeenCalledWith("pnpm lint", false);
    expect(onClose).toHaveBeenCalled();
  });

  it("restores snapshot and closes palette", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={onClose} />);

    await user.click(screen.getByText("Morning"));
    expect(restoreSnapshot).toHaveBeenCalledWith("snap-1");
    expect(onClose).toHaveBeenCalled();
  });
});
