import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceStore } from "../store/workspace";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenWorkspaceModal: () => void;
}

interface PaletteEntry {
  id: string;
  section: string;
  label: string;
  description?: string;
  keywords: string;
  run: () => Promise<void>;
}

const PANE_PRESETS = [1, 2, 4, 6, 8, 10, 12, 14, 16] as const;

const QUICK_COMMANDS = ["npm test", "cargo check", "pnpm build"] as const;

export function CommandPalette({ open, onClose, onOpenWorkspaceModal }: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [runningId, setRunningId] = useState<string | null>(null);

  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const snapshots = useWorkspaceStore((state) => state.snapshots);
  const echoInput = useWorkspaceStore((state) => state.echoInput);
  const worktreeManager = useWorkspaceStore((state) => state.worktreeManager);

  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace);
  const setActiveWorkspacePaneCount = useWorkspaceStore((state) => state.setActiveWorkspacePaneCount);
  const setEchoInput = useWorkspaceStore((state) => state.setEchoInput);
  const setActiveSection = useWorkspaceStore((state) => state.setActiveSection);
  const saveSnapshot = useWorkspaceStore((state) => state.saveSnapshot);
  const restoreSnapshot = useWorkspaceStore((state) => state.restoreSnapshot);
  const runGlobalCommand = useWorkspaceStore((state) => state.runGlobalCommand);
  const openWorktreeManager = useWorkspaceStore((state) => state.openWorktreeManager);
  const refreshWorktrees = useWorkspaceStore((state) => state.refreshWorktrees);
  const importWorktreeAsWorkspace = useWorkspaceStore((state) => state.importWorktreeAsWorkspace);

  const entries = useMemo<PaletteEntry[]>(() => {
    const workspaceEntries = workspaces.map((workspace) => ({
      id: `workspace-${workspace.id}`,
      section: "Workspaces",
      label: `Switch to ${workspace.name}`,
      description: `${workspace.branch} · ${workspace.worktreePath}`,
      keywords: `${workspace.name} ${workspace.branch} ${workspace.worktreePath}`,
      run: async () => {
        await setActiveWorkspace(workspace.id);
      },
    }));

    const paneEntries = PANE_PRESETS.map((count) => ({
      id: `pane-count-${count}`,
      section: "Pane Actions",
      label: `Set ${count} panes`,
      description: "Apply pane layout count to active workspace",
      keywords: `pane layout ${count}`,
      run: async () => {
        await setActiveWorkspacePaneCount(count);
      },
    }));

    const snapshotEntries = snapshots.slice(0, 8).map((snapshot) => ({
      id: `snapshot-${snapshot.id}`,
      section: "Snapshots",
      label: `Restore ${snapshot.name}`,
      description: new Date(snapshot.createdAt).toLocaleString(),
      keywords: `${snapshot.name} snapshot restore`,
      run: async () => {
        await restoreSnapshot(snapshot.id);
      },
    }));

    const quickCommandEntries = QUICK_COMMANDS.map((command) => ({
      id: `quick-command-${command}`,
      section: "Global Commands",
      label: `Run ${command}`,
      description: "Execute command in all running panes",
      keywords: `command run ${command}`,
      run: async () => {
        await runGlobalCommand(command, true);
      },
    }));

    const openWorkspaceKeys = new Set(
      workspaces.map((workspace) => workspace.worktreePath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()),
    );
    const worktreeEntries = worktreeManager.entries.slice(0, 30).map((entry) => {
      const key = entry.worktreePath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
      const isOpen = openWorkspaceKeys.has(key);
      return {
        id: `worktree-${entry.worktreePath}`,
        section: "Worktrees",
        label: `${isOpen ? "Switch to" : "Open"} ${entry.branch}`,
        description: entry.worktreePath,
        keywords: `${entry.branch} ${entry.worktreePath} worktree`,
        run: async () => {
          await importWorktreeAsWorkspace(entry.worktreePath);
        },
      };
    });

    return [
      {
        id: "action-open-workspace-modal",
        section: "Workspaces",
        label: "Create new workspace",
        description: "Open workspace setup modal",
        keywords: "workspace new create",
        run: async () => {
          setActiveSection("terminal");
          onOpenWorkspaceModal();
        },
      },
      {
        id: "action-open-worktree-manager",
        section: "Worktrees",
        label: "Open worktree manager",
        description: "Open create/import/remove/prune controls",
        keywords: "worktree manager section",
        run: async () => {
          await openWorktreeManager();
        },
      },
      {
        id: "action-refresh-worktrees",
        section: "Worktrees",
        label: "Refresh worktrees",
        description: "Reload worktree list for active repository",
        keywords: "worktree refresh sync",
        run: async () => {
          await refreshWorktrees();
        },
      },
      {
        id: "action-create-worktree",
        section: "Worktrees",
        label: "Create worktree",
        description: "Open manager and use create form",
        keywords: "worktree create branch",
        run: async () => {
          await openWorktreeManager();
        },
      },
      ...worktreeEntries,
      ...workspaceEntries,
      ...paneEntries,
      {
        id: "action-toggle-echo",
        section: "Pane Actions",
        label: echoInput ? "Disable echo input" : "Enable echo input",
        description: "Mirror typing across running panes",
        keywords: "echo input toggle",
        run: async () => {
          setEchoInput(!echoInput);
        },
      },
      {
        id: "action-save-snapshot",
        section: "Snapshots",
        label: "Save snapshot",
        description: "Persist current workspace state",
        keywords: "snapshot save",
        run: async () => {
          const fallback = `Snapshot ${new Date().toLocaleString()}`;
          await saveSnapshot(fallback);
        },
      },
      ...snapshotEntries,
      ...quickCommandEntries,
    ];
  }, [
    echoInput,
    onOpenWorkspaceModal,
    openWorktreeManager,
    importWorktreeAsWorkspace,
    refreshWorktrees,
    restoreSnapshot,
    runGlobalCommand,
    saveSnapshot,
    setActiveSection,
    setActiveWorkspace,
    setActiveWorkspacePaneCount,
    setEchoInput,
    snapshots,
    worktreeManager.entries,
    workspaces,
  ]);

  const commandText = query.trim().startsWith(">") ? query.trim().slice(1).trim() : "";

  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized.startsWith(">")) {
      if (commandText.length === 0) {
        return [] as PaletteEntry[];
      }

      return [
        {
          id: `typed-command-${commandText}`,
          section: "Global Commands",
          label: `Run ${commandText}`,
          description: "Execute in all running panes",
          keywords: `command ${commandText}`,
          run: async () => {
            await runGlobalCommand(commandText, true);
          },
        },
      ];
    }

    if (!normalized) {
      return entries;
    }

    return entries.filter((entry) => {
      const haystack = `${entry.label} ${entry.description ?? ""} ${entry.keywords} ${entry.section}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [commandText, entries, query, runGlobalCommand]);

  const rows = useMemo(() => {
    const output: Array<{ type: "section"; id: string; label: string } | { type: "entry"; id: string; index: number; entry: PaletteEntry }> = [];
    let currentSection = "";

    filteredEntries.forEach((entry, index) => {
      if (entry.section !== currentSection) {
        currentSection = entry.section;
        output.push({
          type: "section",
          id: `section-${entry.section}-${index}`,
          label: entry.section,
        });
      }

      output.push({
        type: "entry",
        id: entry.id,
        index,
        entry,
      });
    });

    return output;
  }, [filteredEntries]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSelectedIndex(0);
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (selectedIndex > filteredEntries.length - 1) {
      setSelectedIndex(Math.max(0, filteredEntries.length - 1));
    }
  }, [filteredEntries.length, selectedIndex]);

  const runEntry = async (entry: PaletteEntry): Promise<void> => {
    setRunningId(entry.id);
    try {
      await entry.run();
      onClose();
    } finally {
      setRunningId(null);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="palette-overlay" role="presentation" onClick={onClose}>
      <div className="palette-modal" role="dialog" aria-label="Command palette" onClick={(event) => event.stopPropagation()}>
        <div className="palette-head">
          <h2>Command Palette</h2>
          <span>{activeWorkspaceId ? "workspace active" : "no workspace"}</span>
        </div>

        <input
          ref={inputRef}
          className="text-input palette-input"
          placeholder="Search actions, or type >command"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelectedIndex((current) => Math.min(current + 1, Math.max(0, filteredEntries.length - 1)));
              return;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelectedIndex((current) => Math.max(0, current - 1));
              return;
            }

            if (event.key === "Enter") {
              event.preventDefault();
              const candidate = filteredEntries[selectedIndex];
              if (candidate) {
                void runEntry(candidate);
              }
              return;
            }

            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        />

        <div className="palette-list" role="listbox" aria-label="Palette results">
          {commandText.length === 0 && query.trim().startsWith(">") ? (
            <div className="palette-empty">Type a command after &gt; to run it in all panes.</div>
          ) : null}

          {filteredEntries.length === 0 && !(query.trim().startsWith(">") && commandText.length === 0) ? (
            <div className="palette-empty">No matching actions.</div>
          ) : null}

          {rows.map((row) => {
            if (row.type === "section") {
              return (
                <p key={row.id} className="palette-group-title">
                  {row.label}
                </p>
              );
            }

            const active = row.index === selectedIndex;
            const loading = runningId === row.entry.id;

            return (
              <button
                key={row.id}
                type="button"
                className={`palette-item ${active ? "active" : ""}`}
                onMouseEnter={() => setSelectedIndex(row.index)}
                onClick={() => {
                  void runEntry(row.entry);
                }}
                disabled={loading}
              >
                <span>{row.entry.label}</span>
                {row.entry.description ? <small>{row.entry.description}</small> : null}
              </button>
            );
          })}
        </div>

        <div className="palette-footer">
          <span>Enter run</span>
          <span>Arrow keys navigate</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
