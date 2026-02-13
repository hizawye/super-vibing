import { describe, expect, it, vi } from "vitest";
import { createTmuxPrefixController, handleAppKeydown, TMUX_PREFIX_TIMEOUT_MS } from "./App";

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

function baseAppContext() {
  return {
    paletteOpen: false,
    newWorkspaceOpen: false,
    sidebarOpen: false,
    setActiveSection: vi.fn(),
    setSidebarOpen: vi.fn(),
    setPaletteOpen: vi.fn(),
    setNewWorkspaceOpen: vi.fn(),
  };
}

function baseTmuxContext() {
  return {
    activeSection: "terminal" as const,
    activeWorkspace: {
      id: "workspace-main",
      name: "Workspace 1",
      branch: "main",
      worktreePath: "/repo",
      paneCount: 3,
      paneOrder: ["pane-1", "pane-2", "pane-3"],
      layouts: [],
      layoutMode: "freeform" as const,
      zoomedPaneId: null,
      focusedPaneId: "pane-2",
    },
    paletteOpen: false,
    newWorkspaceOpen: false,
    setActiveWorkspacePaneCount: vi.fn(),
    setFocusedPane: vi.fn(),
    moveFocusedPane: vi.fn(),
    resizeFocusedPaneByDelta: vi.fn(),
    toggleActiveWorkspaceZoom: vi.fn(),
  };
}

function createTerminalEditableTarget(): HTMLTextAreaElement {
  const shell = document.createElement("div");
  shell.setAttribute("data-terminal-pane", "true");
  const target = document.createElement("textarea");
  shell.appendChild(target);
  return target;
}

describe("handleAppKeydown", () => {
  it("opens new workspace with Ctrl/Cmd+N", () => {
    const context = baseAppContext();
    const event = createEvent({ key: "n", ctrlKey: true });

    handleAppKeydown(event, context);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(context.setActiveSection).toHaveBeenCalledWith("terminal");
    expect(context.setNewWorkspaceOpen).toHaveBeenCalledWith(true);
  });

  it("opens command palette with Ctrl/Cmd+P", () => {
    const context = baseAppContext();
    const event = createEvent({ key: "p", metaKey: true });

    handleAppKeydown(event, context);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(context.setPaletteOpen).toHaveBeenCalledWith(true);
  });

  it("closes overlays in Escape priority order", () => {
    const paletteContext = { ...baseAppContext(), paletteOpen: true };
    const newWorkspaceContext = { ...baseAppContext(), newWorkspaceOpen: true };
    const sidebarContext = { ...baseAppContext(), sidebarOpen: true };

    handleAppKeydown(createEvent({ key: "Escape" }), paletteContext);
    handleAppKeydown(createEvent({ key: "Escape" }), newWorkspaceContext);
    handleAppKeydown(createEvent({ key: "Escape" }), sidebarContext);

    expect(paletteContext.setPaletteOpen).toHaveBeenCalledWith(false);
    expect(newWorkspaceContext.setNewWorkspaceOpen).toHaveBeenCalledWith(false);
    expect(sidebarContext.setSidebarOpen).toHaveBeenCalledWith(false);
  });

  it("ignores global shortcuts when editable target is focused", () => {
    const context = baseAppContext();
    const input = document.createElement("input");
    const event = createEvent({ key: "n", ctrlKey: true, target: input });

    handleAppKeydown(event, context);

    expect(context.setNewWorkspaceOpen).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("does not consume Ctrl/Cmd+Shift+C at app shortcut layer", () => {
    const context = baseAppContext();
    const event = createEvent({ key: "c", ctrlKey: true, shiftKey: true });

    handleAppKeydown(event, context);

    expect(context.setNewWorkspaceOpen).not.toHaveBeenCalled();
    expect(context.setPaletteOpen).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("handles global shortcuts while terminal pane is focused", () => {
    const context = baseAppContext();
    const event = createEvent({
      key: "p",
      ctrlKey: true,
      target: createTerminalEditableTarget(),
    });

    handleAppKeydown(event, context);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(context.setPaletteOpen).toHaveBeenCalledWith(true);
  });
});

describe("createTmuxPrefixController", () => {
  it("runs split mapping for prefix+% and prefix+\"", () => {
    const context = baseTmuxContext();
    const controller = createTmuxPrefixController();

    const prefix = createEvent({ key: "b", ctrlKey: true, shiftKey: true });
    const splitPercent = createEvent({ key: "%" });
    const splitQuote = createEvent({ key: "\"" });

    expect(controller.handleKeydown(prefix, context)).toBe(true);
    expect(controller.handleKeydown(splitPercent, context)).toBe(true);
    expect(context.setActiveWorkspacePaneCount).toHaveBeenNthCalledWith(1, 4);

    expect(controller.handleKeydown(prefix, context)).toBe(true);
    expect(controller.handleKeydown(splitQuote, context)).toBe(true);
    expect(context.setActiveWorkspacePaneCount).toHaveBeenNthCalledWith(2, 4);
  });

  it("cycles panes with wrap for prefix+n/p/o", () => {
    const context = baseTmuxContext();
    const controller = createTmuxPrefixController();
    const prefix = createEvent({ key: "b", ctrlKey: true, shiftKey: true });

    context.activeWorkspace.focusedPaneId = "pane-3";
    controller.handleKeydown(prefix, context);
    controller.handleKeydown(createEvent({ key: "n" }), context);
    expect(context.setFocusedPane).toHaveBeenNthCalledWith(1, "workspace-main", "pane-1");

    context.activeWorkspace.focusedPaneId = "pane-1";
    controller.handleKeydown(prefix, context);
    controller.handleKeydown(createEvent({ key: "p" }), context);
    expect(context.setFocusedPane).toHaveBeenNthCalledWith(2, "workspace-main", "pane-3");

    context.activeWorkspace.focusedPaneId = "pane-2";
    controller.handleKeydown(prefix, context);
    controller.handleKeydown(createEvent({ key: "o" }), context);
    expect(context.setFocusedPane).toHaveBeenNthCalledWith(3, "workspace-main", "pane-3");
  });

  it("focuses pane index with prefix+digit including 0 -> pane-10", () => {
    const context = baseTmuxContext();
    context.activeWorkspace.paneOrder = Array.from({ length: 10 }, (_, index) => `pane-${index + 1}`);
    const controller = createTmuxPrefixController();

    controller.handleKeydown(createEvent({ key: "b", ctrlKey: true, shiftKey: true }), context);
    controller.handleKeydown(createEvent({ key: "2" }), context);

    controller.handleKeydown(createEvent({ key: "b", ctrlKey: true, shiftKey: true }), context);
    controller.handleKeydown(createEvent({ key: "0" }), context);

    expect(context.setFocusedPane).toHaveBeenNthCalledWith(1, "workspace-main", "pane-2");
    expect(context.setFocusedPane).toHaveBeenNthCalledWith(2, "workspace-main", "pane-10");
  });

  it("maps prefix+Arrow to move and prefix+Alt+Arrow to resize", () => {
    const context = baseTmuxContext();
    const controller = createTmuxPrefixController();

    controller.handleKeydown(createEvent({ key: "b", ctrlKey: true, shiftKey: true }), context);
    controller.handleKeydown(createEvent({ key: "ArrowLeft" }), context);
    expect(context.moveFocusedPane).toHaveBeenCalledWith("workspace-main", "left");

    controller.handleKeydown(createEvent({ key: "b", ctrlKey: true, shiftKey: true }), context);
    controller.handleKeydown(createEvent({ key: "ArrowRight", altKey: true }), context);
    expect(context.resizeFocusedPaneByDelta).toHaveBeenCalledWith("workspace-main", 1, 0);
  });

  it("maps prefix+z and prefix+x/&", () => {
    const context = baseTmuxContext();
    const controller = createTmuxPrefixController();

    controller.handleKeydown(createEvent({ key: "b", ctrlKey: true, shiftKey: true }), context);
    controller.handleKeydown(createEvent({ key: "z" }), context);
    expect(context.toggleActiveWorkspaceZoom).toHaveBeenCalledWith("pane-2");

    controller.handleKeydown(createEvent({ key: "b", ctrlKey: true, shiftKey: true }), context);
    controller.handleKeydown(createEvent({ key: "x" }), context);
    expect(context.setActiveWorkspacePaneCount).toHaveBeenNthCalledWith(1, 2);

    controller.handleKeydown(createEvent({ key: "b", ctrlKey: true, shiftKey: true }), context);
    controller.handleKeydown(createEvent({ key: "&" }), context);
    expect(context.setActiveWorkspacePaneCount).toHaveBeenNthCalledWith(2, 2);
  });

  it("expires armed prefix after timeout", () => {
    vi.useFakeTimers();
    const context = baseTmuxContext();
    const controller = createTmuxPrefixController();

    const armed = controller.handleKeydown(createEvent({ key: "b", ctrlKey: true, shiftKey: true }), context);
    expect(armed).toBe(true);

    vi.advanceTimersByTime(TMUX_PREFIX_TIMEOUT_MS + 1);

    const unhandled = createEvent({ key: "n" });
    expect(controller.handleKeydown(unhandled, context)).toBe(false);
    expect(unhandled.preventDefault).not.toHaveBeenCalled();

    controller.dispose();
    vi.useRealTimers();
  });

  it("does not arm tmux prefix outside terminal context", () => {
    const context = { ...baseTmuxContext(), activeSection: "settings" as const };
    const controller = createTmuxPrefixController();
    const prefix = createEvent({ key: "b", ctrlKey: true, shiftKey: true });

    expect(controller.handleKeydown(prefix, context)).toBe(false);
    expect(prefix.preventDefault).not.toHaveBeenCalled();
  });

  it("does not consume Ctrl+B so shell tmux can receive it", () => {
    const context = baseTmuxContext();
    const controller = createTmuxPrefixController();
    const shellPrefix = createEvent({ key: "b", ctrlKey: true, target: createTerminalEditableTarget() });

    expect(controller.handleKeydown(shellPrefix, context)).toBe(false);
    expect(shellPrefix.preventDefault).not.toHaveBeenCalled();
  });

  it("allows tmux prefix when terminal pane input target is focused", () => {
    const context = baseTmuxContext();
    const controller = createTmuxPrefixController();
    const prefix = createEvent({
      key: "b",
      ctrlKey: true,
      shiftKey: true,
      target: createTerminalEditableTarget(),
    });
    const next = createEvent({
      key: "n",
      target: createTerminalEditableTarget(),
    });

    expect(controller.handleKeydown(prefix, context)).toBe(true);
    expect(controller.handleKeydown(next, context)).toBe(true);
    expect(context.setFocusedPane).toHaveBeenCalledWith("workspace-main", "pane-3");
  });
});
