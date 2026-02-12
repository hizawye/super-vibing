import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { Layout } from "react-grid-layout";
import { useShallow } from "zustand/react/shallow";
import { AppSidebar, type WorkspaceNavView } from "./components/AppSidebar";
import { EmptyStatePage } from "./components/EmptyStatePage";
import { PaneGrid } from "./components/PaneGrid";
import { TopChrome } from "./components/TopChrome";
import type { WorkspaceCreationInput } from "./components/NewWorkspaceModal";
import {
  checkForPendingUpdate,
  closePendingUpdate,
  formatUpdaterError,
  installPendingUpdate,
  restartToApplyUpdate,
  updatesSupported,
  type PendingAppUpdate,
} from "./lib/updater";
import { useWorkspaceStore } from "./store/workspace";
import { THEME_DEFINITIONS, THEME_IDS } from "./theme/themes";
import type { AppSection, DensityMode, LayoutMode, ThemeId, WorkspaceBootSession } from "./types";

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
      ["New workspace", "Ctrl/Cmd + N"],
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

const WORKSPACE_NAV_KEY_SEPARATOR = "\u0001";
const LOCKED_SECTIONS: AppSection[] = ["kanban", "agents", "prompts"];
type UpdateStatus = "idle" | "checking" | "available" | "installing" | "installed" | "upToDate" | "error";

interface UpdateUiState {
  status: UpdateStatus;
  message: string;
}

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

export function SettingsSection({
  themeId,
  reduceMotion,
  highContrastAssist,
  density,
  onThemeChange,
  onReduceMotionChange,
  onHighContrastAssistChange,
  onDensityChange,
}: SettingsSectionProps) {
  const canUseUpdater = useMemo(() => updatesSupported(), []);
  const [pendingUpdate, setPendingUpdate] = useState<PendingAppUpdate | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [updateUi, setUpdateUi] = useState<UpdateUiState>({
    status: "idle",
    message: canUseUpdater ? "Ready to check for updates." : "Update checks are available in the desktop app only.",
  });

  useEffect(() => {
    return () => {
      void closePendingUpdate(pendingUpdate);
    };
  }, [pendingUpdate]);

  const handleCheckForUpdates = async () => {
    if (!canUseUpdater) {
      setUpdateUi({
        status: "error",
        message: "Update checks are available in the desktop app only.",
      });
      return;
    }

    setUpdateUi({ status: "checking", message: "Checking for updates..." });
    setDownloadProgress(null);

    try {
      const nextUpdate = await checkForPendingUpdate();
      await closePendingUpdate(pendingUpdate);
      setPendingUpdate(null);

      if (!nextUpdate) {
        setUpdateUi({
          status: "upToDate",
          message: "You're on the latest version.",
        });
        return;
      }

      setPendingUpdate(nextUpdate);
      setUpdateUi({
        status: "available",
        message: `Version ${nextUpdate.version} is available (current ${nextUpdate.currentVersion}). Install now?`,
      });
    } catch (error) {
      setUpdateUi({
        status: "error",
        message: formatUpdaterError(error, "Failed to check for updates."),
      });
    }
  };

  const handleInstallUpdate = async () => {
    if (!pendingUpdate) {
      return;
    }

    const update = pendingUpdate;
    let downloadedBytes = 0;
    let totalBytes: number | undefined;

    setDownloadProgress(0);
    setUpdateUi({
      status: "installing",
      message: `Installing version ${update.version}...`,
    });

    try {
      await installPendingUpdate(update, (event) => {
        if (event.event === "Started") {
          downloadedBytes = 0;
          totalBytes = event.data.contentLength;
          setDownloadProgress(totalBytes && totalBytes > 0 ? 0 : null);
          return;
        }

        if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes && totalBytes > 0) {
            const progress = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
            setDownloadProgress(progress);
          }
          return;
        }

        if (event.event === "Finished") {
          setDownloadProgress(100);
        }
      });

      await closePendingUpdate(update);
      setPendingUpdate(null);
      setUpdateUi({
        status: "installed",
        message: `Update ${update.version} installed. Restart now to apply it.`,
      });
    } catch (error) {
      setUpdateUi({
        status: "error",
        message: formatUpdaterError(error, "Failed to install the update."),
      });
    }
  };

  const handleDismissUpdate = async () => {
    await closePendingUpdate(pendingUpdate);
    setPendingUpdate(null);
    setDownloadProgress(null);
    setUpdateUi({
      status: "idle",
      message: "Update dismissed. Check again any time.",
    });
  };

  const handleRestartNow = async () => {
    setUpdateUi({
      status: "installed",
      message: "Restarting app to complete update...",
    });

    try {
      await restartToApplyUpdate();
    } catch (error) {
      setUpdateUi({
        status: "error",
        message: formatUpdaterError(error, "Unable to restart automatically."),
      });
    }
  };

  return (
    <section className="section-surface section-surface--headed">
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

        <section className="settings-block">
          <h3>App Updates</h3>
          <p className="settings-caption">Check for signed GitHub releases and install updates in place.</p>

          <div className="settings-inline-actions">
            <button
              type="button"
              className="subtle-btn"
              onClick={() => {
                void handleCheckForUpdates();
              }}
              disabled={updateUi.status === "checking" || updateUi.status === "installing"}
            >
              {updateUi.status === "checking" ? "Checking..." : "Check for updates"}
            </button>

            {updateUi.status === "available" && pendingUpdate ? (
              <>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => {
                    void handleInstallUpdate();
                  }}
                >
                  Install update
                </button>
                <button
                  type="button"
                  className="subtle-btn"
                  onClick={() => {
                    void handleDismissUpdate();
                  }}
                >
                  Not now
                </button>
              </>
            ) : null}

            {updateUi.status === "installed" ? (
              <button
                type="button"
                className="primary-btn"
                onClick={() => {
                  void handleRestartNow();
                }}
              >
                Restart now
              </button>
            ) : null}
          </div>

          <p className={`settings-caption update-feedback ${updateUi.status === "error" ? "error" : ""}`}>
            {updateUi.message}
          </p>
          {updateUi.status === "installing" && downloadProgress !== null ? (
            <p className="settings-caption update-feedback">Download {downloadProgress}%</p>
          ) : null}
          {updateUi.status === "available" && pendingUpdate?.body ? (
            <p className="settings-caption update-feedback">{pendingUpdate.body}</p>
          ) : null}
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
      paletteOpen: state.paletteOpen,
      activeWorkspaceId: state.activeWorkspaceId,
      themeId: state.themeId,
      reduceMotion: state.reduceMotion,
      highContrastAssist: state.highContrastAssist,
      density: state.density,
    })),
  );

  const workspaceNavKeys = useWorkspaceStore(
    useShallow((state) =>
      state.workspaces.map(
        (workspace) =>
          `${workspace.id}${WORKSPACE_NAV_KEY_SEPARATOR}${workspace.name}${WORKSPACE_NAV_KEY_SEPARATOR}${workspace.paneCount}`,
      ),
    ),
  );

  const workspaceNav = useMemo<WorkspaceNavView[]>(
    () =>
      workspaceNavKeys.map((value) => {
        const [id, name, paneCount] = value.split(WORKSPACE_NAV_KEY_SEPARATOR);
        return {
          id,
          name,
          paneCount: Number(paneCount),
        };
      }),
    [workspaceNavKeys],
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
  const pauseWorkspaceBoot = useWorkspaceStore((state) => state.pauseWorkspaceBoot);
  const resumeWorkspaceBoot = useWorkspaceStore((state) => state.resumeWorkspaceBoot);

  const [sidebarOpen, setSidebarOpen] = useState(false);
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
        setActiveSection("terminal");
        setSidebarOpen(false);
        setPaletteOpen(false);
        setNewWorkspaceOpen(true);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setSidebarOpen(false);
        setNewWorkspaceOpen(false);
        setPaletteOpen(true);
        return;
      }

      if (event.key === "Escape") {
        if (paletteOpen) {
          event.preventDefault();
          setPaletteOpen(false);
          return;
        }

        if (newWorkspaceOpen) {
          event.preventDefault();
          setNewWorkspaceOpen(false);
          return;
        }

        if (sidebarOpen) {
          event.preventDefault();
          setSidebarOpen(false);
        }
      }
    };

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [newWorkspaceOpen, paletteOpen, setActiveSection, setPaletteOpen, sidebarOpen]);

  const openWorkspaceModal = () => {
    setActiveSection("terminal");
    setSidebarOpen(false);
    setPaletteOpen(false);
    setNewWorkspaceOpen(true);
  };

  const openCommandPalette = () => {
    setSidebarOpen(false);
    setNewWorkspaceOpen(false);
    setPaletteOpen(true);
  };

  const terminalControls =
    activeSection === "terminal" && activeWorkspace ? (
      <div className="terminal-controls">
        <span className="compact-label">Panes {activeWorkspace.paneCount}</span>
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
    ) : null;

  const terminalSubtitle = null;

  if (!initialized || bootstrapping) {
    return (
      <main className="app-shell app-loading">
        <p>Bootstrapping workspace...</p>
      </main>
    );
  }

  const isTerminalSection = activeSection === "terminal";

  return (
    <main className={`app-shell ${isTerminalSection ? "app-shell-terminal" : ""}`}>
      <div className="app-layout">
        <AppSidebar
          open={sidebarOpen}
          activeSection={activeSection}
          workspaces={workspaceNav}
          activeWorkspaceId={activeWorkspaceId}
          onClose={() => setSidebarOpen(false)}
          onSelectSection={(section) => {
            if (LOCKED_SECTIONS.includes(section)) {
              return;
            }
            setActiveSection(section);
            setSidebarOpen(false);
          }}
          onSelectWorkspace={(workspaceId) => {
            setActiveSection("terminal");
            void setActiveWorkspace(workspaceId);
            setSidebarOpen(false);
          }}
          onCloseWorkspace={(workspaceId) => {
            void closeWorkspace(workspaceId);
          }}
          onCreateWorkspace={openWorkspaceModal}
        />

        <div className={`app-main ${isTerminalSection ? "app-main-terminal" : ""}`}>
          <TopChrome
            activeSection={activeSection}
            activeWorkspaceName={activeWorkspace?.name ?? null}
            terminalTitle={activeWorkspace?.name ?? null}
            terminalSubtitle={terminalSubtitle}
            terminalControls={terminalControls}
            onToggleSidebar={() => setSidebarOpen((current) => !current)}
            onOpenCommandPalette={openCommandPalette}
          />

          {activeSection === "terminal" && activeWorkspace ? (
            <section className="section-surface section-surface--body terminal-surface">
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
              onAction={openWorkspaceModal}
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
        </div>
      </div>

      <Suspense fallback={null}>
        {newWorkspaceOpen ? (
          <NewWorkspaceModal
            open={newWorkspaceOpen}
            defaultDirectory={activeWorkspace?.worktreePath ?? ""}
            onClose={() => setNewWorkspaceOpen(false)}
            onSubmit={(input: WorkspaceCreationInput) => {
              void createWorkspace(input);
            }}
          />
        ) : null}

        {paletteOpen ? (
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            onOpenWorkspaceModal={openWorkspaceModal}
          />
        ) : null}
      </Suspense>
    </main>
  );
}

export default App;
