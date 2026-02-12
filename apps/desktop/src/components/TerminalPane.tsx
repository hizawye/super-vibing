import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Terminal } from "xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { toRuntimePaneId } from "../lib/panes";
import { resizePane, subscribeToPaneEvents } from "../lib/tauri";
import { useWorkspaceStore } from "../store/workspace";
import { resolveTerminalTheme } from "../theme/themes";

interface TerminalPaneProps {
  workspaceId: string;
  paneId: string;
}

const PROMPTABLE_INPUT_REGEX = /^[\x20-\x7E]$/;
const OUTPUT_FLUSH_THRESHOLD_BYTES = 32 * 1024;
const RESIZE_DEBOUNCE_MS = 50;

interface PaneView {
  title: string;
  status: string;
}

export function TerminalPane({ workspaceId, paneId }: TerminalPaneProps) {
  const runtimePaneId = toRuntimePaneId(workspaceId, paneId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputBufferRef = useRef("");
  const outputBufferRef = useRef("");
  const outputFlushRafRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);

  const pane = useWorkspaceStore(
    useShallow((state) => {
      const workspace = state.workspaces.find((item) => item.id === workspaceId);
      const current = workspace?.panes[paneId];
      return {
        title: current?.title ?? paneId,
        status: current?.status ?? "idle",
      } satisfies PaneView;
    }),
  );
  const ensurePaneSpawned = useWorkspaceStore((state) => state.ensurePaneSpawned);
  const markPaneExited = useWorkspaceStore((state) => state.markPaneExited);
  const updatePaneLastCommand = useWorkspaceStore((state) => state.updatePaneLastCommand);
  const sendInputFromPane = useWorkspaceStore((state) => state.sendInputFromPane);
  const themeId = useWorkspaceStore((state) => state.themeId);
  const reduceMotion = useWorkspaceStore((state) => state.reduceMotion);
  const highContrastAssist = useWorkspaceStore((state) => state.highContrastAssist);

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
        cursorBlink: !reduceMotion,
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        fontSize: 13,
        theme: resolveTerminalTheme(themeId, highContrastAssist),
      });

      const fitAddon: FitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);
      fitAddon.fit();

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      const flushBufferedOutput = (): void => {
        const currentTerminal = terminalRef.current;
        if (!currentTerminal) {
          outputBufferRef.current = "";
          return;
        }

        if (!outputBufferRef.current) {
          return;
        }

        currentTerminal.write(outputBufferRef.current);
        outputBufferRef.current = "";
      };

      const scheduleOutputFlush = (): void => {
        if (outputFlushRafRef.current !== null) {
          return;
        }

        outputFlushRafRef.current = window.requestAnimationFrame(() => {
          outputFlushRafRef.current = null;
          flushBufferedOutput();
        });
      };

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

      const scheduleResizeToBackend = (): void => {
        if (resizeTimerRef.current !== null) {
          window.clearTimeout(resizeTimerRef.current);
        }

        resizeTimerRef.current = window.setTimeout(() => {
          resizeTimerRef.current = null;
          void resizeToBackend();
        }, RESIZE_DEBOUNCE_MS);
      };

      resizeObserver = new ResizeObserver(() => {
        scheduleResizeToBackend();
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
          outputBufferRef.current += event.payload;
          if (outputBufferRef.current.length >= OUTPUT_FLUSH_THRESHOLD_BYTES) {
            if (outputFlushRafRef.current !== null) {
              window.cancelAnimationFrame(outputFlushRafRef.current);
              outputFlushRafRef.current = null;
            }
            flushBufferedOutput();
            return;
          }

          scheduleOutputFlush();
          return;
        }

        if (event.kind === "error") {
          flushBufferedOutput();
          terminalRef.current.writeln(`\r\n[super-vibing] ${event.payload}`);
          markPaneExited(workspaceId, paneId, event.payload);
          return;
        }

        if (event.kind === "exit") {
          flushBufferedOutput();
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
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
      if (outputFlushRafRef.current !== null) {
        window.cancelAnimationFrame(outputFlushRafRef.current);
      }
      outputFlushRafRef.current = null;
      outputBufferRef.current = "";
      resizeObserver?.disconnect();
      terminal?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [
    markPaneExited,
    paneId,
    runtimePaneId,
    sendInputFromPane,
    updatePaneLastCommand,
    workspaceId,
  ]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.theme = resolveTerminalTheme(themeId, highContrastAssist);
    terminal.options.cursorBlink = !reduceMotion;
  }, [highContrastAssist, reduceMotion, themeId]);

  return (
    <div className="terminal-shell">
      <div className="terminal-meta">
        <span>{pane.title}</span>
        <span className="terminal-status">{pane.status}</span>
      </div>
      <div className="terminal-body" ref={containerRef} />
    </div>
  );
}
