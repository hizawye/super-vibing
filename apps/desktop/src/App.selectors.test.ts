import { describe, expect, it } from "vitest";
import { shallow } from "zustand/shallow";
import { selectOpenWorkspacePaths, selectWorktreeManagerCore } from "./App";

const baseState = {
  worktreeManager: {
    repoRoot: "/repo",
    loading: false,
    error: null,
    entries: [],
    lastLoadedAt: null,
    lastActionMessage: null,
  },
  workspaces: [
    {
      worktreePath: "/repo",
    },
    {
      worktreePath: "/repo/.worktrees/feature-a",
    },
  ],
};

describe("App selectors", () => {
  it("keeps worktree manager selector shallow-stable for unchanged state", () => {
    const first = selectWorktreeManagerCore(baseState as never);
    const second = selectWorktreeManagerCore(baseState as never);
    expect(shallow(first, second)).toBe(true);
  });

  it("keeps open-workspace-paths selector shallow-stable for unchanged state", () => {
    const first = selectOpenWorkspacePaths(baseState as never);
    const second = selectOpenWorkspacePaths(baseState as never);
    expect(shallow(first, second)).toBe(true);
  });

  it("documents prior unstable combined selector shape", () => {
    const unstableSelector = (state: typeof baseState) => ({
      ...selectWorktreeManagerCore(state as never),
      openWorkspacePaths: selectOpenWorkspacePaths(state as never),
    });

    const first = unstableSelector(baseState);
    const second = unstableSelector(baseState);
    expect(shallow(first, second)).toBe(false);
  });
});
