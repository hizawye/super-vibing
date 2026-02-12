import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { Layout } from "react-grid-layout";
import { useShallow } from "zustand/react/shallow";
import { PaneGrid } from "./components/PaneGrid";
import { TopChrome, type WorkspaceTabView } from "./components/TopChrome";
import { EmptyStatePage } from "./components/EmptyStatePage";
import type { WorkspaceCreationInput } from "./components/NewWorkspaceModal";
import { useWorkspaceStore } from "./store/workspace";
import { THEME_DEFINITIONS, THEME_IDS } from "./theme/themes";
import type { DensityMode, LayoutMode, ThemeId, WorkspaceBootSession } from "./types";

const SectionMenu = lazy(() =>
  import("./components/SectionMenu").then((module) => ({ default: module.SectionMenu })),
);
const NewWorkspaceModal = lazy(() =>
  import("./components/NewWorkspaceModal").then((module) => ({ default: module.NewWorkspaceModal })),
);
const CommandPalette = lazy(() =>
  import("./components/CommandPalette").then((module) => ({ default: module.CommandPalette })),
);

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

interface ActiveWorkspaceView {
  id: string;
  name: string;
  branch: string;
  worktreePath: string;
  paneCount: number;
  paneOrder: string[];
  layouts: Layout[];
  layoutMode: LayoutMode;
  zoomedPaneId: string | null;
}

const WORKSPACE_TAB_KEY_SEPARATOR = "\u0001";

interface SettingsSectionProps {
  themeId: ThemeId;
  reduceMotion: boolean;
  highContrastAssist: boolean;
  density: DensityMode;
  onThemeChange: (themeId: ThemeId) => void;
  onReduceMotionChange: (enabled: boolean) => void;
  onHighContrastAssistChange: (enabled: boolean) => void;
  onDensityChange: (density: DensityMode) => void;
}

function SettingsSection({
  themeId,
  reduceMotion,
  highContrastAssist,
  density,
  onThemeChange,
  onReduceMotionChange,
  onHighContrastAssistChange,
  onDensityChange,
}: SettingsSectionProps) {
  return (
    <section className="section-surface">
      <header className="section-head">
        <h2>Appearance and Accessibility</h2>
        <p>Choose theme presets and comfort settings for daily workflows.</p>
      </header>

      <div className="settings-shell">
        <section className="settings-block">
          <h3>Theme Presets</h3>
          <p className="settings-caption">Global app style across terminal, menus, and modal surfaces.</p>
          <div className="theme-grid" role="radiogroup" aria-label="Theme presets">
            {THEME_IDS.map((id) => {
              const theme = THEME_DEFINITIONS[id];
              const active = themeId === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`theme-card ${active ? "active" : ""}`}
                  onClick={() => onThemeChange(id)}
                >
                  <span className="theme-card-name">{theme.label}</span>
                  <small className="theme-card-description">{theme.description}</small>
                  <span className="theme-card-swatches" aria-hidden="true">
                    {theme.swatches.map((swatch) => (
                      <span key={swatch} style={{ backgroundColor: swatch }} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="settings-block">
          <h3>Accessibility</h3>
          <div className="settings-toggle-list">
            <label className="check-label">
              <input
                type="checkbox"
                checked={reduceMotion}
                onChange={(event) => onReduceMotionChange(event.currentTarget.checked)}
              />
              Reduce motion
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={highContrastAssist}
                onChange={(event) => onHighContrastAssistChange(event.currentTarget.checked)}
              />
              High contrast assist
            </label>
          </div>
        </section>

        <section className="settings-block">
          <h3>Density</h3>
          <div className="density-toggle" role="group" aria-label="Density">
            <button
              type="button"
              className={`layout-mode-btn ${density === "comfortable" ? "active" : ""}`}
              onClick={() => onDensityChange("comfortable")}
            >
              Comfortable
            </button>
            <button
              type="button"
              className={`layout-mode-btn ${density === "compact" ? "active" : ""}`}
              onClick={() => onDensityChange("compact")}
            >
              Compact
            </button>
          </div>
        </section>

        <section className="settings-block shortcuts-shell">
          <h3>Keyboard Shortcuts</h3>
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
        </section>
      </div>
    </section>
  );
}

function App() {
  const {
    initialized,
    bootstrapping,
    activeSection,
    echoInput,
    paletteOpen,
    activeWorkspaceId,
    themeId,
    reduceMotion,
    highContrastAssist,
    density,
  } = useWorkspaceStore(
    useShallow((state) => ({
      initialized: state.initialized,
      bootstrapping: state.bootstrapping,
      activeSection: state.activeSection,
      echoInput: state.echoInput,
      paletteOpen: state.paletteOpen,
      activeWorkspaceId: state.activeWorkspaceId,
      themeId: state.themeId,
      reduceMotion: state.reduceMotion,
      highContrastAssist: state.highContrastAssist,
      density: state.density,
    })),
  );

  const workspaceTabKeys = useWorkspaceStore(
    useShallow((state) =>
      state.workspaces.map(
        (workspace) =>
          `${workspace.id}${WORKSPACE_TAB_KEY_SEPARATOR}${workspace.name}${WORKSPACE_TAB_KEY_SEPARATOR}${workspace.paneCount}`,
      ),
    ),
  );

  const workspaceTabs = useMemo<WorkspaceTabView[]>(
    () =>
      workspaceTabKeys.map((value) => {
        const [id, name, paneCount] = value.split(WORKSPACE_TAB_KEY_SEPARATOR);
        return {
          id,
          name,
          paneCount: Number(paneCount),
        };
      }),
    [workspaceTabKeys],
  );

  const activeWorkspace = useWorkspaceStore(
    useShallow((state) => {
      if (!state.activeWorkspaceId) {
        return null;
      }
      const workspace = state.workspaces.find((item) => item.id === state.activeWorkspaceId);
      if (!workspace) {
        return null;
      }
      return {
        id: workspace.id,
        name: workspace.name,
        branch: workspace.branch,
        worktreePath: workspace.worktreePath,
        paneCount: workspace.paneCount,
        paneOrder: workspace.paneOrder,
        layouts: workspace.layouts,
        layoutMode: workspace.layoutMode,
        zoomedPaneId: workspace.zoomedPaneId,
      } satisfies ActiveWorkspaceView;
    }),
  );

  const activeWorkspaceBoot = useWorkspaceStore(
    useShallow((state) => {
      if (!state.activeWorkspaceId) {
        return null;
      }
      const session = state.workspaceBootSessions[state.activeWorkspaceId];
      if (!session) {
        return null;
      }
      return {
        workspaceId: session.workspaceId,
        totalAgents: session.totalAgents,
        queued: session.queued,
        running: session.running,
        completed: session.completed,
        failed: session.failed,
        status: session.status,
        startedAt: session.startedAt,
        updatedAt: session.updatedAt,
      } satisfies WorkspaceBootSession;
    }),
  );

  const bootstrap = useWorkspaceStore((state) => state.bootstrap);
  const setActiveSection = useWorkspaceStore((state) => state.setActiveSection);
  const setEchoInput = useWorkspaceStore((state) => state.setEchoInput);
  const setTheme = useWorkspaceStore((state) => state.setTheme);
  const setReduceMotion = useWorkspaceStore((state) => state.setReduceMotion);
  const setHighContrastAssist = useWorkspaceStore((state) => state.setHighContrastAssist);
  const setDensity = useWorkspaceStore((state) => state.setDensity);
  const setPaletteOpen = useWorkspaceStore((state) => state.setPaletteOpen);
  const createWorkspace = useWorkspaceStore((state) => state.createWorkspace);
  const closeWorkspace = useWorkspaceStore((state) => state.closeWorkspace);
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace);
  const setActiveWorkspacePaneCount = useWorkspaceStore((state) => state.setActiveWorkspacePaneCount);
  const setActiveWorkspaceLayoutMode = useWorkspaceStore((state) => state.setActiveWorkspaceLayoutMode);
  const setActiveWorkspaceLayouts = useWorkspaceStore((state) => state.setActiveWorkspaceLayouts);
  const toggleActiveWorkspaceZoom = useWorkspaceStore((state) => state.toggleActiveWorkspaceZoom);
  const saveSnapshot = useWorkspaceStore((state) => state.saveSnapshot);
  const pauseWorkspaceBoot = useWorkspaceStore((state) => state.pauseWorkspaceBoot);
  const resumeWorkspaceBoot = useWorkspaceStore((state) => state.resumeWorkspaceBoot);

  const [menuOpen, setMenuOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = themeId;
    root.dataset.density = density;
    root.classList.toggle("reduce-motion", reduceMotion);
    root.classList.toggle("high-contrast", highContrastAssist);
  }, [density, highContrastAssist, reduceMotion, themeId]);

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
        workspaces={workspaceTabs}
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
              <div className="pane-stepper" role="group" aria-label="Pane count quick controls">
                <button
                  type="button"
                  className="subtle-btn pane-stepper-btn"
                  onClick={() => {
                    void setActiveWorkspacePaneCount(activeWorkspace.paneCount - 1);
                  }}
                  disabled={activeWorkspace.paneCount <= 1}
                  aria-label="Decrease pane count"
                >
                  -
                </button>
                <button
                  type="button"
                  className="subtle-btn pane-stepper-btn"
                  onClick={() => {
                    void setActiveWorkspacePaneCount(activeWorkspace.paneCount + 1);
                  }}
                  disabled={activeWorkspace.paneCount >= 16}
                  aria-label="Increase pane count"
                >
                  +
                </button>
              </div>
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
              <div className="layout-mode-toggle" role="group" aria-label="Layout mode">
                <button
                  type="button"
                  className={`layout-mode-btn ${activeWorkspace.layoutMode === "tiling" ? "active" : ""}`}
                  onClick={() => setActiveWorkspaceLayoutMode("tiling")}
                >
                  Tiling
                </button>
                <button
                  type="button"
                  className={`layout-mode-btn ${activeWorkspace.layoutMode === "freeform" ? "active" : ""}`}
                  onClick={() => setActiveWorkspaceLayoutMode("freeform")}
                >
                  Free-form
                </button>
              </div>
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
              {activeWorkspaceBoot ? (
                <>
                  <span className="compact-label">
                    Boot {activeWorkspaceBoot.completed}/{activeWorkspaceBoot.totalAgents}
                    {activeWorkspaceBoot.failed > 0 ? ` · failed ${activeWorkspaceBoot.failed}` : ""}
                  </span>
                  {activeWorkspaceBoot.status === "running" ? (
                    <button
                      type="button"
                      className="subtle-btn"
                      onClick={() => pauseWorkspaceBoot(activeWorkspace.id)}
                    >
                      Pause boot
                    </button>
                  ) : null}
                  {activeWorkspaceBoot.status === "paused" ? (
                    <button
                      type="button"
                      className="subtle-btn"
                      onClick={() => resumeWorkspaceBoot(activeWorkspace.id)}
                    >
                      Resume boot
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </header>

          <div className="grid-shell">
            <PaneGrid
              workspaceId={activeWorkspace.id}
              paneIds={activeWorkspace.paneOrder}
              layouts={activeWorkspace.layouts}
              layoutMode={activeWorkspace.layoutMode}
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

      {activeSection === "settings" ? (
        <SettingsSection
          themeId={themeId}
          reduceMotion={reduceMotion}
          highContrastAssist={highContrastAssist}
          density={density}
          onThemeChange={setTheme}
          onReduceMotionChange={setReduceMotion}
          onHighContrastAssistChange={setHighContrastAssist}
          onDensityChange={setDensity}
        />
      ) : null}

      <Suspense fallback={null}>
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
      </Suspense>
    </main>
  );
}

export default App;
