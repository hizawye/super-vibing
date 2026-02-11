import { useEffect, useMemo, useState } from "react";
import { PaneGrid } from "./components/PaneGrid";
import { TopChrome } from "./components/TopChrome";
import { SectionMenu } from "./components/SectionMenu";
import { NewWorkspaceModal, type WorkspaceCreationInput } from "./components/NewWorkspaceModal";
import { EmptyStatePage } from "./components/EmptyStatePage";
import { CommandPalette } from "./components/CommandPalette";
import { useWorkspaceStore } from "./store/workspace";

const SHORTCUT_GROUPS = [
  {
    title: "Workspaces",
    shortcuts: [
      ["New workspace tab", "Ctrl/Cmd + N"],
      ["Next workspace", "Ctrl/Cmd + ]"],
      ["Previous workspace", "Ctrl/Cmd + ["],
      ["Close workspace", "Ctrl/Cmd + W"],
    ],
  },
  {
    title: "Panes",
    shortcuts: [
      ["Increase pane layout", "Ctrl/Cmd + Shift + ]"],
      ["Decrease pane layout", "Ctrl/Cmd + Shift + ["],
      ["Zoom pane", "Double-click pane header"],
      ["Run command in all panes", "Ctrl/Cmd + Enter"],
    ],
  },
  {
    title: "Launcher",
    shortcuts: [["Open command palette", "Ctrl/Cmd + P"]],
  },
] as const;

function SettingsSection() {
  return (
    <section className="section-surface">
      <header className="section-head">
        <h2>Keyboard Shortcuts</h2>
        <p>Reference frequently used shortcuts for workspace and pane actions.</p>
      </header>

      <div className="shortcuts-shell">
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title} className="shortcuts-group">
            <h3>{group.title}</h3>
            <div className="shortcut-list">
              {group.shortcuts.map(([label, keys]) => (
                <div key={label} className="shortcut-row">
                  <span>{label}</span>
                  <kbd>{keys}</kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function App() {
  const initialized = useWorkspaceStore((state) => state.initialized);
  const bootstrapping = useWorkspaceStore((state) => state.bootstrapping);
  const activeSection = useWorkspaceStore((state) => state.activeSection);
  const echoInput = useWorkspaceStore((state) => state.echoInput);
  const paletteOpen = useWorkspaceStore((state) => state.paletteOpen);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);

  const bootstrap = useWorkspaceStore((state) => state.bootstrap);
  const setActiveSection = useWorkspaceStore((state) => state.setActiveSection);
  const setEchoInput = useWorkspaceStore((state) => state.setEchoInput);
  const setPaletteOpen = useWorkspaceStore((state) => state.setPaletteOpen);
  const createWorkspace = useWorkspaceStore((state) => state.createWorkspace);
  const closeWorkspace = useWorkspaceStore((state) => state.closeWorkspace);
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace);
  const setActiveWorkspacePaneCount = useWorkspaceStore((state) => state.setActiveWorkspacePaneCount);
  const setActiveWorkspaceLayouts = useWorkspaceStore((state) => state.setActiveWorkspaceLayouts);
  const toggleActiveWorkspaceZoom = useWorkspaceStore((state) => state.toggleActiveWorkspaceZoom);
  const runGlobalCommand = useWorkspaceStore((state) => state.runGlobalCommand);
  const saveSnapshot = useWorkspaceStore((state) => state.saveSnapshot);

  const [menuOpen, setMenuOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [globalCommand, setGlobalCommand] = useState("");
  const [executeCommand, setExecuteCommand] = useState(true);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );

  const paneTitles = useMemo(() => {
    if (!activeWorkspace) {
      return {};
    }
    return Object.fromEntries(
      activeWorkspace.paneOrder.map((paneId) => [paneId, activeWorkspace.panes[paneId]?.title ?? paneId]),
    );
  }, [activeWorkspace]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setPaletteOpen(false);
        setNewWorkspaceOpen(true);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setMenuOpen(false);
        setNewWorkspaceOpen(false);
        setPaletteOpen(true);
        return;
      }

      if (event.key === "Escape") {
        setMenuOpen(false);
        setNewWorkspaceOpen(false);
        setPaletteOpen(false);
      }
    };

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [setPaletteOpen]);

  if (!initialized || bootstrapping) {
    return (
      <main className="app-shell app-loading">
        <p>Bootstrapping workspace...</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <TopChrome
        activeSection={activeSection}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSectionButtonClick={() => setMenuOpen((current) => !current)}
        onSelectWorkspace={(workspaceId) => {
          void setActiveWorkspace(workspaceId);
        }}
        onCloseWorkspace={(workspaceId) => {
          void closeWorkspace(workspaceId);
        }}
        onOpenWorkspaceModal={() => setNewWorkspaceOpen(true)}
        onOpenSettings={() => setActiveSection("settings")}
      />

      {activeSection === "terminal" && activeWorkspace ? (
        <section className="section-surface terminal-surface">
          <header className="terminal-head">
            <div className="terminal-context">
              <h2>{activeWorkspace.name}</h2>
              <p>
                {activeWorkspace.branch} · <code>{activeWorkspace.worktreePath}</code>
              </p>
            </div>

            <div className="terminal-controls">
              <label className="compact-label" htmlFor="pane-count">
                Panes {activeWorkspace.paneCount}
              </label>
              <input
                id="pane-count"
                type="range"
                min={1}
                max={16}
                value={activeWorkspace.paneCount}
                onChange={(event) => {
                  void setActiveWorkspacePaneCount(Number(event.currentTarget.value));
                }}
              />
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={echoInput}
                  onChange={(event) => setEchoInput(event.currentTarget.checked)}
                />
                Echo input
              </label>
              <button
                type="button"
                className="subtle-btn"
                onClick={() => {
                  const fallback = `Snapshot ${new Date().toLocaleString()}`;
                  void saveSnapshot(fallback);
                }}
              >
                Save snapshot
              </button>
            </div>
          </header>

          <div className="command-row">
            <input
              className="text-input"
              placeholder="Run in all panes"
              value={globalCommand}
              onChange={(event) => setGlobalCommand(event.currentTarget.value)}
            />
            <label className="check-label">
              <input
                type="checkbox"
                checked={executeCommand}
                onChange={(event) => setExecuteCommand(event.currentTarget.checked)}
              />
              Execute
            </label>
            <button
              type="button"
              className="primary-btn"
              onClick={() => {
                void runGlobalCommand(globalCommand, executeCommand);
                setGlobalCommand("");
              }}
            >
              Run
            </button>
          </div>

          <div className="grid-shell">
            <PaneGrid
              workspaceId={activeWorkspace.id}
              paneIds={activeWorkspace.paneOrder}
              paneTitles={paneTitles}
              layouts={activeWorkspace.layouts}
              zoomedPaneId={activeWorkspace.zoomedPaneId}
              onLayoutsChange={(next) => setActiveWorkspaceLayouts(next)}
              onToggleZoom={toggleActiveWorkspaceZoom}
            />
          </div>
        </section>
      ) : null}

      {activeSection === "terminal" && !activeWorkspace ? (
        <EmptyStatePage
          title="No workspaces"
          subtitle="Create your first workspace to start multiplexing agent terminals."
          actionLabel="Create Workspace"
          onAction={() => setNewWorkspaceOpen(true)}
        />
      ) : null}

      {activeSection === "kanban" ? (
        <EmptyStatePage
          title="Kanban Board"
          subtitle="Track branch tasks through todo, in-progress, review, and done stages."
          actionLabel="New Task"
        />
      ) : null}

      {activeSection === "agents" ? (
        <EmptyStatePage
          title="Agents"
          subtitle="No agents configured yet. Define agent defaults in workspace creation."
          actionLabel="Create Agent"
        />
      ) : null}

      {activeSection === "prompts" ? (
        <EmptyStatePage
          title="Prompts"
          subtitle="Store reusable prompt templates and route them to selected panes."
          actionLabel="New Prompt"
        />
      ) : null}

      {activeSection === "settings" ? <SettingsSection /> : null}

      <SectionMenu
        open={menuOpen}
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        onClose={() => setMenuOpen(false)}
      />

      <NewWorkspaceModal
        open={newWorkspaceOpen}
        defaultDirectory={activeWorkspace?.worktreePath ?? ""}
        onClose={() => setNewWorkspaceOpen(false)}
        onSubmit={(input: WorkspaceCreationInput) => {
          void createWorkspace(input);
        }}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenWorkspaceModal={() => {
          setPaletteOpen(false);
          setNewWorkspaceOpen(true);
        }}
      />
    </main>
  );
}

export default App;
