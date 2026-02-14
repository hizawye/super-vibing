import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@supervibing/ui";
import { useWorkspaceStore } from "../store/workspace";
import { useGitViewStore } from "../store/gitView";

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
  const setGitPanel = useGitViewStore((state) => state.setActivePanel);
  const setGitFocusZone = useGitViewStore((state) => state.setFocusZone);

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
        id: "action-open-git",
        section: "Git",
        label: "Open git control center",
        description: "Status, branches, PRs, issues, and actions",
        keywords: "git status branches prs issues actions",
        run: async () => {
          setActiveSection("git");
          setGitPanel("status");
          setGitFocusZone("list");
        },
      },
      {
        id: "action-open-git-prs",
        section: "Git",
        label: "Open git PR list",
        description: "Jump directly to pull requests",
        keywords: "git prs pull requests",
        run: async () => {
          setActiveSection("git");
          setGitPanel("prs");
          setGitFocusZone("list");
        },
      },
      {
        id: "action-open-git-actions",
        section: "Git",
        label: "Open git actions runs",
        description: "Jump directly to workflow runs",
        keywords: "git actions workflows runs",
        run: async () => {
          setActiveSection("git");
          setGitPanel("actions");
          setGitFocusZone("list");
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
    setGitFocusZone,
    setGitPanel,
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

  const groupedRows = useMemo(() => {
    const groups = new Map<string, PaletteEntry[]>();
    filteredEntries.forEach((entry) => {
      const current = groups.get(entry.section) ?? [];
      current.push(entry);
      groups.set(entry.section, current);
    });
    return Array.from(groups.entries());
  }, [filteredEntries]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const runEntry = async (entry: PaletteEntry): Promise<void> => {
    setRunningId(entry.id);
    try {
      await entry.run();
      onClose();
    } finally {
      setRunningId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) {
        onClose();
      }
    }}
    >
      <DialogContent className="palette-modal" aria-label="Command palette">
        <DialogHeader className="palette-head">
          <DialogTitle>Command Palette</DialogTitle>
          <DialogDescription className="settings-caption">Search actions and run workspace commands.</DialogDescription>
          {activeWorkspaceId ? <Badge>workspace active</Badge> : <Badge>no workspace</Badge>}
        </DialogHeader>

        <Command className="border border-[var(--line-soft)]">
          <CommandInput
            ref={inputRef}
            className="palette-input"
            placeholder="Search actions, or type >command"
            value={query}
            onValueChange={setQuery}
          />

          <CommandList className="palette-list" role="listbox" aria-label="Palette results">
            {commandText.length === 0 && query.trim().startsWith(">") ? (
              <div className="palette-empty">Type a command after &gt; to run it in all panes.</div>
            ) : null}

            {filteredEntries.length === 0 && !(query.trim().startsWith(">") && commandText.length === 0) ? (
              <CommandEmpty className="palette-empty">No matching actions.</CommandEmpty>
            ) : null}

            {groupedRows.map(([section, sectionEntries]) => (
              <CommandGroup key={section} heading={section}>
                {sectionEntries.map((entry) => {
                  const loading = runningId === entry.id;
                  return (
                    <CommandItem
                      key={entry.id}
                      className="palette-item"
                      value={`${entry.label} ${entry.description ?? ""} ${entry.keywords} ${entry.section}`}
                      disabled={loading}
                      onSelect={() => {
                        void runEntry(entry);
                      }}
                    >
                      <span>{entry.label}</span>
                      {entry.description ? <small>{entry.description}</small> : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>

        <div className="palette-footer">
          <span>Enter run</span>
          <span>Arrow keys navigate</span>
          <span>Esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
