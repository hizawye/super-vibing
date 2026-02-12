import { useEffect, useRef } from "react";
import type { Terminal } from "xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { toRuntimePaneId } from "../lib/panes";
import { resizePane, subscribeToPaneEvents } from "../lib/tauri";
import { useWorkspaceStore } from "../store/workspace";

interface TerminalPaneProps {
  workspaceId: string;
  paneId: string;
}

const PROMPTABLE_INPUT_REGEX = /^[\x20-\x7E]$/;

export function TerminalPane({ workspaceId, paneId }: TerminalPaneProps) {
  const runtimePaneId = toRuntimePaneId(workspaceId, paneId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputBufferRef = useRef("");

  const pane = useWorkspaceStore((state) => {
    const workspace = state.workspaces.find((item) => item.id === workspaceId);
    return workspace?.panes[paneId];
  });
  const ensurePaneSpawned = useWorkspaceStore((state) => state.ensurePaneSpawned);
  const markPaneExited = useWorkspaceStore((state) => state.markPaneExited);
  const updatePaneLastCommand = useWorkspaceStore((state) => state.updatePaneLastCommand);
  const sendInputFromPane = useWorkspaceStore((state) => state.sendInputFromPane);

  useEffect(() => {
    void ensurePaneSpawned(workspaceId, paneId);
  }, [ensurePaneSpawned, paneId, workspaceId]);

  useEffect(() => {
    if (!containerRef.current || terminalRef.current) {
      return;
    }

    let isActive = true;
    let resizeObserver: ResizeObserver | null = null;
    let disposeInput: { dispose: () => void } | null = null;
    let unsubscribe: (() => void) | null = null;
    let terminal: Terminal | null = null;

    const startTerminal = async (): Promise<void> => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("xterm"),
        import("@xterm/addon-fit"),
      ]);

      if (!isActive || !containerRef.current || terminalRef.current) {
        return;
      }

      terminal = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        fontSize: 13,
        theme: {
          background: "#0b1120",
          foreground: "#d9e1ff",
          cursor: "#f8fafc",
          selectionBackground: "#1d4ed8",
          black: "#0b1120",
          red: "#ef4444",
          green: "#22c55e",
          yellow: "#eab308",
          blue: "#3b82f6",
          magenta: "#ec4899",
          cyan: "#06b6d4",
          white: "#e5e7eb",
          brightBlack: "#334155",
          brightRed: "#fb7185",
          brightGreen: "#4ade80",
          brightYellow: "#facc15",
          brightBlue: "#60a5fa",
          brightMagenta: "#f472b6",
          brightCyan: "#22d3ee",
          brightWhite: "#f8fafc",
        },
      });

      const fitAddon: FitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);
      fitAddon.fit();

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      const resizeToBackend = async (): Promise<void> => {
        fitAddon.fit();
        if (terminal && terminal.rows > 0 && terminal.cols > 0) {
          try {
            await resizePane({
              paneId: runtimePaneId,
              rows: terminal.rows,
              cols: terminal.cols,
            });
          } catch {
            // ignore resize races while pane is still spawning
          }
        }
      };

      resizeObserver = new ResizeObserver(() => {
        void resizeToBackend();
      });
      resizeObserver.observe(containerRef.current);

      disposeInput = terminal.onData((data) => {
        void sendInputFromPane(workspaceId, paneId, data);

        if (data === "\r") {
          const command = inputBufferRef.current.trim();
          if (command.length > 0) {
            updatePaneLastCommand(workspaceId, paneId, command);
          }
          inputBufferRef.current = "";
          return;
        }

        if (data === "\u007f") {
          inputBufferRef.current = inputBufferRef.current.slice(0, -1);
          return;
        }

        if (PROMPTABLE_INPUT_REGEX.test(data)) {
          inputBufferRef.current += data;
        }
      });

      unsubscribe = subscribeToPaneEvents(runtimePaneId, (event) => {
        if (!terminalRef.current) {
          return;
        }

        if (event.kind === "output") {
          terminalRef.current.write(event.payload);
          return;
        }

        if (event.kind === "error") {
          terminalRef.current.writeln(`\r\n[super-vibing] ${event.payload}`);
          markPaneExited(workspaceId, paneId, event.payload);
          return;
        }

        if (event.kind === "exit") {
          markPaneExited(workspaceId, paneId);
        }
      });

      void resizeToBackend();
    };

    void startTerminal();

    return () => {
      isActive = false;
      unsubscribe?.();
      disposeInput?.dispose();
      resizeObserver?.disconnect();
      terminal?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [markPaneExited, paneId, runtimePaneId, sendInputFromPane, updatePaneLastCommand, workspaceId]);

  return (
    <div className="terminal-shell">
      <div className="terminal-meta">
        <span>{pane?.title ?? paneId}</span>
        <span className="terminal-status">{pane?.status ?? "idle"}</span>
      </div>
      <div className="terminal-body" ref={containerRef} />
    </div>
  );
}
