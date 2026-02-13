import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewPaneModal } from "./NewPaneModal";

describe("NewPaneModal", () => {
  it("submits selected existing worktree", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {});
    const onRefresh = vi.fn(async () => {});

    render(
      <NewPaneModal
        open
        mode="create"
        repoRoot="/repo"
        entries={[
          {
            id: "main",
            repoRoot: "/repo",
            branch: "main",
            worktreePath: "/repo",
            head: "abc",
            isMainWorktree: true,
            isDetached: false,
            isLocked: false,
            isPrunable: false,
            isDirty: false,
          },
          {
            id: "feature",
            repoRoot: "/repo",
            branch: "feature/w",
            worktreePath: "/repo/.worktrees/feature-w",
            head: "def",
            isMainWorktree: false,
            isDetached: false,
            isLocked: false,
            isPrunable: false,
            isDirty: false,
          },
        ]}
        loading={false}
        error={null}
        initialWorktreePath="/repo/.worktrees/feature-w"
        paneId={null}
        onClose={vi.fn()}
        onRefresh={onRefresh}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create Pane" }));

    expect(onSubmit).toHaveBeenCalledWith({
      mode: "existing",
      worktreePath: "/repo/.worktrees/feature-w",
      branch: "",
      baseRef: "HEAD",
    });
  });

  it("submits create mode branch and base ref", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {});

    render(
      <NewPaneModal
        open
        mode="create"
        repoRoot="/repo"
        entries={[]}
        loading={false}
        error={null}
        initialWorktreePath="/repo"
        paneId={null}
        onClose={vi.fn()}
        onRefresh={vi.fn(async () => {})}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create Branch Worktree" }));
    await user.type(screen.getByLabelText("Branch"), "feature/new-pane");
    await user.clear(screen.getByLabelText("Base Ref"));
    await user.type(screen.getByLabelText("Base Ref"), "main");

    await user.click(screen.getByRole("button", { name: "Create Pane" }));

    expect(onSubmit).toHaveBeenCalledWith({
      mode: "create",
      worktreePath: "/repo",
      branch: "feature/new-pane",
      baseRef: "main",
    });
  });
});
