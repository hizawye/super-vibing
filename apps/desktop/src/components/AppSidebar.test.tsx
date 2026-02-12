import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppSidebar } from "./AppSidebar";

describe("AppSidebar", () => {
  const onClose = vi.fn();
  const onSelectSection = vi.fn();
  const onSelectWorkspace = vi.fn();
  const onCloseWorkspace = vi.fn();
  const onCreateWorkspace = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prevents selection for locked teaser sections", async () => {
    const user = userEvent.setup();
    render(
      <AppSidebar
        open={false}
        activeSection="terminal"
        workspaces={[
          { id: "workspace-1", name: "Core", paneCount: 4 },
          { id: "workspace-2", name: "Infra", paneCount: 2 },
        ]}
        activeWorkspaceId="workspace-1"
        onClose={onClose}
        onSelectSection={onSelectSection}
        onSelectWorkspace={onSelectWorkspace}
        onCloseWorkspace={onCloseWorkspace}
        onCreateWorkspace={onCreateWorkspace}
      />,
    );

    const lockedItem = screen.getByRole("button", { name: /Kanban/i });
    expect(lockedItem).toHaveAttribute("aria-disabled", "true");

    await user.click(lockedItem);

    expect(onSelectSection).not.toHaveBeenCalled();
  });

  it("routes section and workspace actions", async () => {
    const user = userEvent.setup();
    render(
      <AppSidebar
        open={false}
        activeSection="terminal"
        workspaces={[
          { id: "workspace-1", name: "Core", paneCount: 4 },
          { id: "workspace-2", name: "Infra", paneCount: 2 },
        ]}
        activeWorkspaceId="workspace-1"
        onClose={onClose}
        onSelectSection={onSelectSection}
        onSelectWorkspace={onSelectWorkspace}
        onCloseWorkspace={onCloseWorkspace}
        onCreateWorkspace={onCreateWorkspace}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(onSelectSection).toHaveBeenCalledWith("settings");

    await user.click(screen.getByRole("button", { name: /new workspace/i }));
    expect(onCreateWorkspace).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Infra 2" }));
    expect(onSelectWorkspace).toHaveBeenCalledWith("workspace-2");

    await user.click(screen.getByRole("button", { name: "Close Core" }));
    expect(onCloseWorkspace).toHaveBeenCalledWith("workspace-1");
  });
});
