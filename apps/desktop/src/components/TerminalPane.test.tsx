import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { TerminalPane } from "./TerminalPane";

const mockState = {
  ensurePaneSpawned: vi.fn(async () => {}),
  markPaneTerminalReady: vi.fn(),
  markPaneTerminalNotReady: vi.fn(),
  markPaneExited: vi.fn(),
  updatePaneLastCommand: vi.fn(),
  sendInputFromPane: vi.fn(async () => {}),
  themeId: "apple-dark",
  reduceMotion: false,
  highContrastAssist: false,
};

let selectionValue = "";
let keyHandler: ((event: KeyboardEvent) => boolean) | null = null;
let fitMock: ReturnType<typeof vi.fn>;
let terminalMock: {
  rows: number;
  cols: number;
  options: Record<string, unknown>;
  loadAddon: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  writeln: ReturnType<typeof vi.fn>;
  getSelection: ReturnType<typeof vi.fn>;
  attachCustomKeyEventHandler: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

vi.mock("../store/workspace", () => ({
  useWorkspaceStore: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}));

vi.mock("../lib/tauri", () => ({
  resizePane: vi.fn(async () => {}),
  subscribeToPaneEvents: vi.fn(() => () => {}),
}));

vi.mock("xterm", () => ({
  Terminal: vi.fn(() => terminalMock),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(() => ({ fit: fitMock })),
}));

describe("TerminalPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectionValue = "";
    keyHandler = null;
    fitMock = vi.fn();
    terminalMock = {
      rows: 24,
      cols: 80,
      options: {},
      loadAddon: vi.fn(),
      open: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      write: vi.fn(),
      writeln: vi.fn(),
      getSelection: vi.fn(() => selectionValue),
      attachCustomKeyEventHandler: vi.fn((handler: (event: KeyboardEvent) => boolean) => {
        keyHandler = handler;
      }),
      focus: vi.fn(),
      dispose: vi.fn(),
    };

    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => {}) },
    });
  });

  it("copies selected text on Ctrl+Shift+C and consumes the key event", async () => {
    render(<TerminalPane workspaceId="workspace-1" paneId="pane-1" isActive />);

    await waitFor(() => {
      expect(keyHandler).not.toBeNull();
    });

    selectionValue = "echo hello";
    const preventDefault = vi.fn();
    const handled = keyHandler?.({
      type: "keydown",
      key: "c",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      preventDefault,
    } as unknown as KeyboardEvent);

    expect(handled).toBe(false);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("echo hello");
  });

  it("does not write clipboard when no selection exists", async () => {
    render(<TerminalPane workspaceId="workspace-1" paneId="pane-1" isActive />);

    await waitFor(() => {
      expect(keyHandler).not.toBeNull();
    });

    selectionValue = "";
    const preventDefault = vi.fn();
    const handled = keyHandler?.({
      type: "keydown",
      key: "C",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      preventDefault,
    } as unknown as KeyboardEvent);

    expect(handled).toBe(false);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("passes through non-copy keys", async () => {
    render(<TerminalPane workspaceId="workspace-1" paneId="pane-1" isActive />);

    await waitFor(() => {
      expect(keyHandler).not.toBeNull();
    });

    const preventDefault = vi.fn();
    const handled = keyHandler?.({
      type: "keydown",
      key: "v",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      preventDefault,
    } as unknown as KeyboardEvent);

    expect(handled).toBe(true);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("refits and resizes when an inactive pane becomes active", async () => {
    const tauriApi = await import("../lib/tauri");
    const { rerender } = render(<TerminalPane workspaceId="workspace-1" paneId="pane-1" isActive={false} />);

    await waitFor(() => {
      expect(tauriApi.resizePane).toHaveBeenCalled();
    });

    const baselineCalls = vi.mocked(tauriApi.resizePane).mock.calls.length;
    rerender(<TerminalPane workspaceId="workspace-1" paneId="pane-1" isActive />);

    await waitFor(() => {
      expect(vi.mocked(tauriApi.resizePane).mock.calls.length).toBeGreaterThan(baselineCalls);
    });
  });

  it("focuses xterm when shouldGrabFocus becomes true", async () => {
    const { rerender } = render(
      <TerminalPane workspaceId="workspace-1" paneId="pane-1" isActive shouldGrabFocus={false} />,
    );

    await waitFor(() => {
      expect(terminalMock.open).toHaveBeenCalled();
    });

    rerender(
      <TerminalPane workspaceId="workspace-1" paneId="pane-1" isActive shouldGrabFocus />,
    );

    await waitFor(() => {
      expect(terminalMock.focus).toHaveBeenCalled();
    });
  });
});
