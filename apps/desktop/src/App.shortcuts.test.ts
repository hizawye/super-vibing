import { describe, expect, it, vi } from "vitest";
import { handleAppKeydown } from "./App";

function createEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: "",
    code: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

function baseContext() {
  return {
    activeSection: "terminal" as const,
    activeWorkspace: {
      id: "workspace-main",
      name: "Workspace 1",
      branch: "main",
      worktreePath: "/repo",
      paneCount: 2,
      paneOrder: ["pane-1", "pane-2"],
      layouts: [],
      layoutMode: "tiling" as const,
      zoomedPaneId: null,
      focusedPaneId: "pane-2",
    },
    paletteOpen: false,
    newWorkspaceOpen: false,
    sidebarOpen: false,
    setActiveSection: vi.fn(),
    setSidebarOpen: vi.fn(),
    setPaletteOpen: vi.fn(),
    setNewWorkspaceOpen: vi.fn(),
    setActiveWorkspacePaneCount: vi.fn(),
    moveFocusedPane: vi.fn(),
    toggleActiveWorkspaceZoom: vi.fn(),
  };
}

describe("handleAppKeydown", () => {
  it("moves focused pane with Ctrl/Cmd+Alt+Arrow", () => {
    const context = baseContext();
    const event = createEvent({ key: "ArrowLeft", ctrlKey: true, altKey: true });

    handleAppKeydown(event, context);

    expect(context.moveFocusedPane).toHaveBeenCalledWith("workspace-main", "left");
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("adjusts pane count with Ctrl/Cmd+Shift+[ and ]", () => {
    const context = baseContext();
    const decrease = createEvent({ code: "BracketLeft", ctrlKey: true, shiftKey: true });
    const increase = createEvent({ code: "BracketRight", ctrlKey: true, shiftKey: true });

    handleAppKeydown(decrease, context);
    handleAppKeydown(increase, context);

    expect(context.setActiveWorkspacePaneCount).toHaveBeenNthCalledWith(1, 1);
    expect(context.setActiveWorkspacePaneCount).toHaveBeenNthCalledWith(2, 3);
  });

  it("zooms focused pane with Ctrl/Cmd+Alt+Enter", () => {
    const context = baseContext();
    const event = createEvent({ key: "Enter", ctrlKey: true, altKey: true });

    handleAppKeydown(event, context);

    expect(context.toggleActiveWorkspaceZoom).toHaveBeenCalledWith("pane-2");
  });

  it("ignores pane shortcuts when an editable target is focused", () => {
    const context = baseContext();
    const input = document.createElement("input");
    const event = createEvent({
      key: "ArrowDown",
      ctrlKey: true,
      altKey: true,
      target: input,
    });

    handleAppKeydown(event, context);

    expect(context.moveFocusedPane).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
