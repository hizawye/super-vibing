import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import type { Layout } from "react-grid-layout";
import { listen } from "@tauri-apps/api/event";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Checkbox,
  Input,
} from "@supervibing/ui";
import { useShallow } from "zustand/react/shallow";
import { AppSidebar, type WorkspaceNavView } from "./components/AppSidebar";
import { EmptyStatePage } from "./components/EmptyStatePage";
import { GitSection } from "./components/GitSection";
import { PaneGrid } from "./components/PaneGrid";
import { StartupCrashScreen } from "./components/StartupCrashScreen";
import { TopChrome } from "./components/TopChrome";
import { WorktreeManagerSection } from "./components/WorktreeManagerSection";
import type { WorkspaceCreationInput } from "./components/NewWorkspaceModal";
import type { PaneWorktreeModalSubmitInput } from "./components/NewPaneModal";
import {
  checkForPendingUpdate,
  closePendingUpdate,
  formatUpdaterError,
  installPendingUpdate,
  restartToApplyUpdate,
  updatesSupported,
  type PendingAppUpdate,
} from "./lib/updater";
import { reportAutomationResult } from "./lib/tauri";
import {
  getAgentDefaults,
  getAgentProfileOptions,
  useWorkspaceStore,
} from "./store/workspace";
import { THEME_DEFINITIONS, THEME_IDS } from "./theme/themes";
import type {
  AgentProfileKey,
  AgentStartupDefaults,
  AppSection,
  DensityMode,
  FrontendAutomationRequest,
  LayoutMode,
  PaneStatus,
  ThemeId,
  WorkspaceBootSession,
} from "./types";

const NewWorkspaceModal = lazy(() =>
  import("./components/NewWorkspaceModal").then((module) => ({ default: module.NewWorkspaceModal })),
);
const CommandPalette = lazy(() =>
  import("./components/CommandPalette").then((module) => ({ default: module.CommandPalette })),
);
const NewPaneModal = lazy(() =>
  import("./components/NewPaneModal").then((module) => ({ default: module.NewPaneModal })),
);

const SHORTCUT_GROUPS = [
  {
    title: "Workspaces",
    shortcuts: [
      ["New workspace", "Ctrl/Cmd + N"],
      ["Open command palette", "Ctrl/Cmd + P"],
    ],
  },
  {
    title: "tmux Core",
    shortcuts: [
      ["Prefix", "Ctrl + B"],
      ["Split pane", "Prefix + % or \""],
      ["Worktree pane creator", "Prefix + W"],
      ["Next/prev workspace", "Prefix + ) / ("],
      ["Next/prev pane", "Prefix + N / P / O"],
      ["Focus by index", "Prefix + 0..9"],
      ["Move focus", "Prefix + Arrow"],
      ["Resize (freeform)", "Prefix + Alt + Arrow"],
      ["Zoom pane", "Prefix + Z"],
      ["Close pane", "Prefix + X or &"],
    ],
  },
  {
    title: "Git Section",
    shortcuts: [
      ["Move selection", "J / K"],
      ["Open default action", "Enter"],
      ["Refresh active panel", "R"],
      ["Stage/unstage file", "S"],
      ["Show file diff", "D"],
      ["Commit staged changes", "C"],
      ["Branch / PR / Issue menus", "B / P / I"],
      ["Jump to actions", "A"],
      ["Destructive action", "X"],
    ],
  },
] as const;

interface ActiveWorkspaceView {
  id: string;
  name: string;
  branch: string;
  worktreePath: string;
  paneCount: number;
  paneOrder: string[];
  paneMetaById: Record<string, { title: string; worktreePath: string; status: PaneStatus }>;
  layouts: Layout[];
  layoutMode: LayoutMode;
  zoomedPaneId: string | null;
  focusedPaneId: string | null;
  focusRequestPaneId: string | null;
}

interface TerminalWorkspaceView extends ActiveWorkspaceView {}

const WORKSPACE_NAV_KEY_SEPARATOR = "\u0001";
const LOCKED_SECTIONS: AppSection[] = ["kanban", "agents", "prompts"];
const TERMINAL_SHORTCUT_SCOPE_SELECTOR = "[data-terminal-pane=\"true\"]";
const AGENT_PROFILE_OPTIONS = getAgentProfileOptions();
type UpdateStatus = "idle" | "checking" | "available" | "installing" | "installed" | "upToDate" | "error";
type WorkspaceStoreState = ReturnType<typeof useWorkspaceStore.getState>;

interface PaneCreatorTarget {
  workspaceId: string;
  paneId?: string;
}

interface PendingPaneWorktreeConfirm {
  workspaceId: string;
  paneId: string;
  worktreePath: string;
}

function isTerminalShortcutScope(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest(TERMINAL_SHORTCUT_SCOPE_SELECTOR));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    return !isTerminalShortcutScope(target);
  }

  return target.isContentEditable && !isTerminalShortcutScope(target);
}

interface AppShortcutContext {
  paletteOpen: boolean;
  newWorkspaceOpen: boolean;
  paneCreatorOpen: boolean;
  sidebarOpen: boolean;
  setActiveSection: (section: AppSection) => void;
  setSidebarOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setNewWorkspaceOpen: (open: boolean) => void;
  setPaneCreatorOpen: (open: boolean) => void;
}

interface TmuxShortcutContext {
  activeSection: AppSection;
  activeWorkspace: ActiveWorkspaceView | null;
  activeWorkspaceId: string | null;
  workspaceOrder: string[];
  paletteOpen: boolean;
  newWorkspaceOpen: boolean;
  paneCreatorOpen: boolean;
  openPaneCreator: () => void;
  setActiveWorkspace: (workspaceId: string) => Promise<void> | void;
  closeWorkspace: (workspaceId: string) => Promise<void> | void;
  setActiveWorkspacePaneCount: (count: number) => void;
  addPaneToActiveWorkspaceAndFocus: () => void;
  setFocusedPane: (workspaceId: string, paneId: string) => void;
  moveFocusedPane: (workspaceId: string, direction: "left" | "right" | "up" | "down") => void;
  resizeFocusedPaneByDelta: (workspaceId: string, dx: number, dy: number) => void;
  toggleActiveWorkspaceZoom: (paneId: string) => void;
}

export const TMUX_PREFIX_TIMEOUT_MS = 1000;

function isTmuxEligibleContext(context: TmuxShortcutContext): boolean {
  return context.activeSection === "terminal"
    && Boolean(context.activeWorkspace)
    && !context.paletteOpen
    && !context.newWorkspaceOpen
    && !context.paneCreatorOpen;
}

function isTmuxPrefixKey(event: KeyboardEvent): boolean {
  return event.ctrlKey
    && !event.metaKey
    && !event.altKey
    && event.key.toLowerCase() === "b";
}

function resolveFocusedPaneId(workspace: ActiveWorkspaceView): string | null {
  return workspace.focusedPaneId ?? workspace.paneOrder[0] ?? null;
}

function cyclePaneId(paneOrder: string[], focusedPaneId: string | null, delta: number): string | null {
  if (paneOrder.length === 0) {
    return null;
  }

  const currentIndex = focusedPaneId ? paneOrder.indexOf(focusedPaneId) : -1;
  const baseIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (baseIndex + delta + paneOrder.length) % paneOrder.length;
  return paneOrder[nextIndex] ?? null;
}

function cycleWorkspaceId(workspaceOrder: string[], activeWorkspaceId: string | null, delta: number): string | null {
  if (workspaceOrder.length === 0) {
    return null;
  }

  const currentIndex = activeWorkspaceId ? workspaceOrder.indexOf(activeWorkspaceId) : -1;
  const baseIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (baseIndex + delta + workspaceOrder.length) % workspaceOrder.length;
  return workspaceOrder[nextIndex] ?? null;
}

function paneIndexFromTmuxKey(key: string): number | null {
  if (!/^[0-9]$/.test(key)) {
    return null;
  }

  const value = Number(key);
  if (value === 0) {
    return 9;
  }

  return value - 1;
}

function directionForArrowKey(key: string): "left" | "right" | "up" | "down" | null {
  if (key === "ArrowLeft") {
    return "left";
  }
  if (key === "ArrowRight") {
    return "right";
  }
  if (key === "ArrowUp") {
    return "up";
  }
  if (key === "ArrowDown") {
    return "down";
  }
  return null;
}

function resizeDeltaForArrowKey(key: string): { dx: number; dy: number } | null {
  if (key === "ArrowLeft") {
    return { dx: -1, dy: 0 };
  }
  if (key === "ArrowRight") {
    return { dx: 1, dy: 0 };
  }
  if (key === "ArrowUp") {
    return { dx: 0, dy: -1 };
  }
  if (key === "ArrowDown") {
    return { dx: 0, dy: 1 };
  }
  return null;
}

function isPaneRunningLike(status: PaneStatus): boolean {
  return status === "running" || status === "suspended" || status === "spawning";
}

export function handleTmuxPrefixedKey(event: KeyboardEvent, context: TmuxShortcutContext): boolean {
  const workspace = context.activeWorkspace;
  if (!workspace) {
    return false;
  }

  event.preventDefault();

  const focusedPaneId = resolveFocusedPaneId(workspace);
  const key = event.key;
  const keyLower = key.toLowerCase();

  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    const resize = resizeDeltaForArrowKey(key);
    if (resize) {
      context.resizeFocusedPaneByDelta(workspace.id, resize.dx, resize.dy);
    }
    return true;
  }

  if (event.ctrlKey || event.metaKey) {
    return true;
  }

  if (key === "%" || key === "\"") {
    context.setActiveWorkspacePaneCount(workspace.paneCount + 1);
    return true;
  }

  if (keyLower === "c") {
    context.addPaneToActiveWorkspaceAndFocus();
    return true;
  }

  if (keyLower === "w") {
    context.openPaneCreator();
    return true;
  }

  if (keyLower === "x" || key === "&") {
    if (workspace.paneCount <= 1) {
      void context.closeWorkspace(workspace.id);
      return true;
    }
    context.setActiveWorkspacePaneCount(workspace.paneCount - 1);
    return true;
  }

  if (keyLower === "z" && focusedPaneId) {
    context.toggleActiveWorkspaceZoom(focusedPaneId);
    return true;
  }

  if (key === "(" || key === ")") {
    const delta = key === ")" ? 1 : -1;
    const nextWorkspaceId = cycleWorkspaceId(context.workspaceOrder, context.activeWorkspaceId, delta);
    if (nextWorkspaceId && nextWorkspaceId !== context.activeWorkspaceId) {
      void context.setActiveWorkspace(nextWorkspaceId);
    }
    return true;
  }

  if (keyLower === "n" || keyLower === "o") {
    const nextPaneId = cyclePaneId(workspace.paneOrder, focusedPaneId, 1);
    if (nextPaneId) {
      context.setFocusedPane(workspace.id, nextPaneId);
    }
    return true;
  }

  if (keyLower === "p") {
    const previousPaneId = cyclePaneId(workspace.paneOrder, focusedPaneId, -1);
    if (previousPaneId) {
      context.setFocusedPane(workspace.id, previousPaneId);
    }
    return true;
  }

  const paneIndex = paneIndexFromTmuxKey(key);
  if (paneIndex !== null) {
    const paneId = workspace.paneOrder[paneIndex];
    if (paneId) {
      context.setFocusedPane(workspace.id, paneId);
    }
    return true;
  }

  const direction = directionForArrowKey(key);
  if (direction) {
    context.moveFocusedPane(workspace.id, direction);
    return true;
  }

  return true;
}

export function createTmuxPrefixController(timeoutMs = TMUX_PREFIX_TIMEOUT_MS) {
  let armed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const disarm = (): void => {
    armed = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const arm = (): void => {
    disarm();
    armed = true;
    timer = setTimeout(() => {
      armed = false;
      timer = null;
    }, timeoutMs);
  };

  return {
    handleKeydown: (event: KeyboardEvent, context: TmuxShortcutContext): boolean => {
      if (isEditableTarget(event.target)) {
        return false;
      }

      if (isTmuxPrefixKey(event)) {
        if (!isTmuxEligibleContext(context)) {
          return false;
        }
        event.preventDefault();
        arm();
        return true;
      }

      if (!armed) {
        return false;
      }

      disarm();
      if (!isTmuxEligibleContext(context)) {
        event.preventDefault();
        return true;
      }

      return handleTmuxPrefixedKey(event, context);
    },
    dispose: (): void => {
      disarm();
    },
  };
}

export function handleAppKeydown(event: KeyboardEvent, context: AppShortcutContext): void {
  if (isEditableTarget(event.target)) {
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
    event.preventDefault();
    context.setActiveSection("terminal");
    context.setSidebarOpen(false);
    context.setPaletteOpen(false);
    context.setPaneCreatorOpen(false);
    context.setNewWorkspaceOpen(true);
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
    event.preventDefault();
    context.setSidebarOpen(false);
    context.setPaneCreatorOpen(false);
    context.setNewWorkspaceOpen(false);
    context.setPaletteOpen(true);
    return;
  }

  if (event.key === "Escape") {
    if (context.paletteOpen) {
      event.preventDefault();
      context.setPaletteOpen(false);
      return;
    }

    if (context.newWorkspaceOpen) {
      event.preventDefault();
      context.setNewWorkspaceOpen(false);
      return;
    }

    if (context.paneCreatorOpen) {
      event.preventDefault();
      context.setPaneCreatorOpen(false);
      return;
    }

    if (context.sidebarOpen) {
      event.preventDefault();
      context.setSidebarOpen(false);
    }
  }
}

interface UpdateUiState {
  status: UpdateStatus;
  message: string;
}

interface SettingsSectionProps {
  themeId: ThemeId;
  reduceMotion: boolean;
  highContrastAssist: boolean;
  density: DensityMode;
  agentStartupDefaults: AgentStartupDefaults;
  discordPresenceEnabled: boolean;
  onThemeChange: (themeId: ThemeId) => void;
  onReduceMotionChange: (enabled: boolean) => void;
  onHighContrastAssistChange: (enabled: boolean) => void;
  onDensityChange: (density: DensityMode) => void;
  onDiscordPresenceEnabledChange: (enabled: boolean) => void;
  onAgentStartupDefaultChange: (profile: AgentProfileKey, command: string) => void;
  onResetAgentStartupDefaults: () => void;
}

export function selectWorktreeManagerCore(state: WorkspaceStoreState) {
  return {
    repoRoot: state.worktreeManager.repoRoot,
    loading: state.worktreeManager.loading,
    error: state.worktreeManager.error,
    entries: state.worktreeManager.entries,
    lastLoadedAt: state.worktreeManager.lastLoadedAt,
    lastActionMessage: state.worktreeManager.lastActionMessage,
  };
}

export function selectOpenWorkspacePaths(state: WorkspaceStoreState): string[] {
  return state.workspaces.map((workspace) => workspace.worktreePath);
}

export function SettingsSection({
  themeId,
  reduceMotion,
  highContrastAssist,
  density,
  agentStartupDefaults,
  discordPresenceEnabled,
  onThemeChange,
  onReduceMotionChange,
  onHighContrastAssistChange,
  onDensityChange,
  onDiscordPresenceEnabledChange,
  onAgentStartupDefaultChange,
  onResetAgentStartupDefaults,
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
                <Button
                  key={id}
                  type="button"
                  variant="subtle"
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
                </Button>
              );
            })}
          </div>
        </section>

        <section className="settings-block">
          <h3>Accessibility</h3>
          <div className="settings-toggle-list">
            <label className="check-label">
              <Checkbox
                checked={reduceMotion}
                onCheckedChange={(checked) => onReduceMotionChange(checked === true)}
              />
              Reduce motion
            </label>
            <label className="check-label">
              <Checkbox
                checked={highContrastAssist}
                onCheckedChange={(checked) => onHighContrastAssistChange(checked === true)}
              />
              High contrast assist
            </label>
          </div>
        </section>

        <section className="settings-block">
          <h3>Discord Rich Presence</h3>
          <p className="settings-caption">Show SuperVibing as an active app in Discord.</p>
          <div className="settings-toggle-list">
            <label className="check-label">
              <Checkbox
                checked={discordPresenceEnabled}
                onCheckedChange={(checked) => onDiscordPresenceEnabledChange(checked === true)}
              />
              Show activity in Discord
            </label>
          </div>
        </section>

        <section className="settings-block">
          <h3>Density</h3>
          <div className="density-toggle" role="group" aria-label="Density">
            <Button
              type="button"
              variant="subtle"
              className={`layout-mode-btn ${density === "comfortable" ? "active" : ""}`}
              onClick={() => onDensityChange("comfortable")}
            >
              Comfortable
            </Button>
            <Button
              type="button"
              variant="subtle"
              className={`layout-mode-btn ${density === "compact" ? "active" : ""}`}
              onClick={() => onDensityChange("compact")}
            >
              Compact
            </Button>
          </div>
        </section>

        <section className="settings-block">
          <h3>Agent Startup Commands</h3>
          <p className="settings-caption">Defaults used for new workspace allocations.</p>
          <div className="settings-toggle-list">
            {AGENT_PROFILE_OPTIONS.map((agent) => (
              <div key={agent.profile} className="settings-agent-row">
                <label className="input-label" htmlFor={`agent-default-${agent.profile}`}>
                  {agent.label}
                </label>
                <Input
                  id={`agent-default-${agent.profile}`}
                  className="text-input"
                  value={agentStartupDefaults[agent.profile]}
                  onChange={(event) => {
                    onAgentStartupDefaultChange(agent.profile, event.currentTarget.value);
                  }}
                />
              </div>
            ))}
          </div>
          <div className="settings-inline-actions">
            <Button type="button" variant="subtle" className="subtle-btn" onClick={onResetAgentStartupDefaults}>
              Reset defaults
            </Button>
          </div>
        </section>

        <section className="settings-block">
          <h3>App Updates</h3>
          <p className="settings-caption">Check for signed GitHub releases and install updates in place.</p>

          <div className="settings-inline-actions">
            <Button
              type="button"
              variant="subtle"
              className="subtle-btn"
              onClick={() => {
                void handleCheckForUpdates();
              }}
              disabled={updateUi.status === "checking" || updateUi.status === "installing"}
            >
              {updateUi.status === "checking" ? "Checking..." : "Check for updates"}
            </Button>

            {updateUi.status === "available" && pendingUpdate ? (
              <>
                <Button
                  type="button"
                  variant="primary"
                  className="primary-btn"
                  onClick={() => {
                    void handleInstallUpdate();
                  }}
                >
                  Install update
                </Button>
                <Button
                  type="button"
                  variant="subtle"
                  className="subtle-btn"
                  onClick={() => {
                    void handleDismissUpdate();
                  }}
                >
                  Not now
                </Button>
              </>
            ) : null}

            {updateUi.status === "installed" ? (
              <Button
                type="button"
                variant="primary"
                className="primary-btn"
                onClick={() => {
                  void handleRestartNow();
                }}
              >
                Restart now
              </Button>
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
                    <Badge><kbd>{keys}</kbd></Badge>
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
    startupError,
    activeSection,
    paletteOpen,
    activeWorkspaceId,
    themeId,
    reduceMotion,
    highContrastAssist,
    density,
    agentStartupDefaults,
    discordPresenceEnabled,
  } = useWorkspaceStore(
    useShallow((state) => ({
      initialized: state.initialized,
      bootstrapping: state.bootstrapping,
      startupError: state.startupError,
      activeSection: state.activeSection,
      paletteOpen: state.paletteOpen,
      activeWorkspaceId: state.activeWorkspaceId,
      themeId: state.themeId,
      reduceMotion: state.reduceMotion,
      highContrastAssist: state.highContrastAssist,
      density: state.density,
      agentStartupDefaults: state.agentStartupDefaults,
      discordPresenceEnabled: state.discordPresenceEnabled,
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

  const { workspaceRuntimes, focusedPaneByWorkspace, focusRequestByWorkspace } = useWorkspaceStore(
    useShallow((state) => ({
      workspaceRuntimes: state.workspaces,
      focusedPaneByWorkspace: state.focusedPaneByWorkspace,
      focusRequestByWorkspace: state.focusRequestByWorkspace,
    })),
  );
  const terminalWorkspaces = useMemo<TerminalWorkspaceView[]>(
    () =>
      workspaceRuntimes.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        branch: workspace.branch,
        worktreePath: workspace.worktreePath,
        paneCount: workspace.paneCount,
        paneOrder: workspace.paneOrder,
        paneMetaById: Object.fromEntries(
          workspace.paneOrder.map((paneId) => [
            paneId,
            {
              title: workspace.panes[paneId]?.title ?? paneId,
              worktreePath: workspace.panes[paneId]?.worktreePath ?? workspace.worktreePath,
              status: workspace.panes[paneId]?.status ?? "idle",
            },
          ]),
        ),
        layouts: workspace.layouts,
        layoutMode: workspace.layoutMode,
        zoomedPaneId: workspace.zoomedPaneId,
        focusedPaneId:
          focusedPaneByWorkspace[workspace.id]
          ?? workspace.zoomedPaneId
          ?? workspace.paneOrder[0]
          ?? null,
        focusRequestPaneId:
          focusRequestByWorkspace[workspace.id]
          ?? focusedPaneByWorkspace[workspace.id]
          ?? workspace.zoomedPaneId
          ?? workspace.paneOrder[0]
          ?? null,
      })),
    [focusRequestByWorkspace, focusedPaneByWorkspace, workspaceRuntimes],
  );
  const activeWorkspace = useMemo<ActiveWorkspaceView | null>(
    () => terminalWorkspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, terminalWorkspaces],
  );
  const activeWorkspaceRuntime = useMemo(
    () => workspaceRuntimes.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaceRuntimes],
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

  const worktreeManager = useWorkspaceStore(useShallow(selectWorktreeManagerCore));
  const openWorkspacePaths = useWorkspaceStore(useShallow(selectOpenWorkspacePaths));

  const bootstrap = useWorkspaceStore((state) => state.bootstrap);
  const clearStartupError = useWorkspaceStore((state) => state.clearStartupError);
  const resetLocalStateAndRebootstrap = useWorkspaceStore((state) => state.resetLocalStateAndRebootstrap);
  const setActiveSection = useWorkspaceStore((state) => state.setActiveSection);
  const setTheme = useWorkspaceStore((state) => state.setTheme);
  const setReduceMotion = useWorkspaceStore((state) => state.setReduceMotion);
  const setHighContrastAssist = useWorkspaceStore((state) => state.setHighContrastAssist);
  const setDensity = useWorkspaceStore((state) => state.setDensity);
  const setDiscordPresenceEnabled = useWorkspaceStore((state) => state.setDiscordPresenceEnabled);
  const setAgentStartupDefault = useWorkspaceStore((state) => state.setAgentStartupDefault);
  const resetAgentStartupDefaults = useWorkspaceStore((state) => state.resetAgentStartupDefaults);
  const setPaletteOpen = useWorkspaceStore((state) => state.setPaletteOpen);
  const createWorkspace = useWorkspaceStore((state) => state.createWorkspace);
  const closeWorkspace = useWorkspaceStore((state) => state.closeWorkspace);
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace);
  const setActiveWorkspacePaneCount = useWorkspaceStore((state) => state.setActiveWorkspacePaneCount);
  const addPaneToActiveWorkspaceAndFocus = useWorkspaceStore((state) => state.addPaneToActiveWorkspaceAndFocus);
  const createPaneWithWorktree = useWorkspaceStore((state) => state.createPaneWithWorktree);
  const setPaneWorktree = useWorkspaceStore((state) => state.setPaneWorktree);
  const setActiveWorkspaceLayoutMode = useWorkspaceStore((state) => state.setActiveWorkspaceLayoutMode);
  const setActiveWorkspaceLayouts = useWorkspaceStore((state) => state.setActiveWorkspaceLayouts);
  const toggleActiveWorkspaceZoom = useWorkspaceStore((state) => state.toggleActiveWorkspaceZoom);
  const setFocusedPane = useWorkspaceStore((state) => state.setFocusedPane);
  const moveFocusedPane = useWorkspaceStore((state) => state.moveFocusedPane);
  const resizeFocusedPaneByDelta = useWorkspaceStore((state) => state.resizeFocusedPaneByDelta);
  const pauseWorkspaceBoot = useWorkspaceStore((state) => state.pauseWorkspaceBoot);
  const resumeWorkspaceBoot = useWorkspaceStore((state) => state.resumeWorkspaceBoot);
  const openWorktreeManager = useWorkspaceStore((state) => state.openWorktreeManager);
  const refreshWorktrees = useWorkspaceStore((state) => state.refreshWorktrees);
  const createWorktreeForWorkspace = useWorkspaceStore((state) => state.createWorktreeForWorkspace);
  const createManagedWorktree = useWorkspaceStore((state) => state.createManagedWorktree);
  const importWorktreeAsWorkspace = useWorkspaceStore((state) => state.importWorktreeAsWorkspace);
  const removeManagedWorktree = useWorkspaceStore((state) => state.removeManagedWorktree);
  const pruneManagedWorktrees = useWorkspaceStore((state) => state.pruneManagedWorktrees);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [paneCreatorTarget, setPaneCreatorTarget] = useState<PaneCreatorTarget | null>(null);
  const [pendingPaneWorktreeConfirm, setPendingPaneWorktreeConfirm] = useState<PendingPaneWorktreeConfirm | null>(null);
  const agentDefaults = useMemo(
    () => getAgentDefaults(agentStartupDefaults),
    [agentStartupDefaults],
  );
  const paneCreatorOpen = paneCreatorTarget !== null;

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

  const openPaneCreator = useCallback((paneId?: string) => {
    if (!activeWorkspace) {
      return;
    }

    setActiveSection("terminal");
    setSidebarOpen(false);
    setPaletteOpen(false);
    setNewWorkspaceOpen(false);
    setPaneCreatorTarget({
      workspaceId: activeWorkspace.id,
      paneId,
    });
    void refreshWorktrees();
  }, [activeWorkspace, refreshWorktrees, setActiveSection, setPaletteOpen]);

  useEffect(() => {
    const tmuxController = createTmuxPrefixController();

    const listener = (event: KeyboardEvent) => {
      if (
        tmuxController.handleKeydown(event, {
          activeSection,
          activeWorkspace,
          activeWorkspaceId,
          workspaceOrder: terminalWorkspaces.map((workspace) => workspace.id),
          paletteOpen,
          newWorkspaceOpen,
          paneCreatorOpen,
          openPaneCreator: () => openPaneCreator(),
          setActiveWorkspace,
          closeWorkspace,
          setActiveWorkspacePaneCount: (count) => {
            void setActiveWorkspacePaneCount(count);
          },
          addPaneToActiveWorkspaceAndFocus: () => {
            void addPaneToActiveWorkspaceAndFocus();
          },
          setFocusedPane,
          moveFocusedPane,
          resizeFocusedPaneByDelta,
          toggleActiveWorkspaceZoom,
        })
      ) {
        return;
      }

      handleAppKeydown(event, {
        paletteOpen,
        newWorkspaceOpen,
        paneCreatorOpen,
        sidebarOpen,
        setActiveSection,
        setSidebarOpen,
        setPaletteOpen,
        setNewWorkspaceOpen,
        setPaneCreatorOpen: (open) => {
          if (!open) {
            setPaneCreatorTarget(null);
          }
        },
      });
    };

    window.addEventListener("keydown", listener, true);
    return () => {
      window.removeEventListener("keydown", listener, true);
      tmuxController.dispose();
    };
  }, [
    activeSection,
    activeWorkspace,
    activeWorkspaceId,
    moveFocusedPane,
    newWorkspaceOpen,
    paneCreatorOpen,
    paletteOpen,
    openPaneCreator,
    refreshWorktrees,
    resizeFocusedPaneByDelta,
    addPaneToActiveWorkspaceAndFocus,
    setActiveWorkspace,
    setActiveSection,
    setActiveWorkspacePaneCount,
    setFocusedPane,
    setPaletteOpen,
    sidebarOpen,
    terminalWorkspaces,
    toggleActiveWorkspaceZoom,
  ]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<FrontendAutomationRequest>("automation:request", async (event) => {
      const payload = event.payload;

      try {
        if (payload.action === "create_panes") {
          await setActiveWorkspace(payload.workspaceId);
          await setActiveWorkspacePaneCount(payload.paneCount);
          await reportAutomationResult({
            jobId: payload.jobId,
            ok: true,
            result: {
              workspaceId: payload.workspaceId,
              paneCount: payload.paneCount,
            },
          });
          return;
        }

        if (payload.action === "import_worktree") {
          await importWorktreeAsWorkspace(payload.worktreePath);
          await reportAutomationResult({
            jobId: payload.jobId,
            ok: true,
            result: {
              worktreePath: payload.worktreePath,
            },
          });
        }
      } catch (error) {
        await reportAutomationResult({
          jobId: payload.jobId,
          ok: false,
          error: String(error),
        });
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      unlisten?.();
    };
  }, [
    importWorktreeAsWorkspace,
    setActiveWorkspace,
    setActiveWorkspacePaneCount,
  ]);

  const openWorkspaceModal = () => {
    setActiveSection("terminal");
    setSidebarOpen(false);
    setPaletteOpen(false);
    setPaneCreatorTarget(null);
    setNewWorkspaceOpen(true);
  };

  const openCommandPalette = () => {
    setSidebarOpen(false);
    setPaneCreatorTarget(null);
    setNewWorkspaceOpen(false);
    setPaletteOpen(true);
  };

  const paneCreatorWorkspace = useMemo(
    () =>
      paneCreatorTarget
        ? workspaceRuntimes.find((workspace) => workspace.id === paneCreatorTarget.workspaceId) ?? null
        : null,
    [paneCreatorTarget, workspaceRuntimes],
  );

  const paneCreatorPane = useMemo(() => {
    if (!paneCreatorTarget?.paneId || !paneCreatorWorkspace) {
      return null;
    }

    return paneCreatorWorkspace.panes[paneCreatorTarget.paneId] ?? null;
  }, [paneCreatorTarget, paneCreatorWorkspace]);

  const handlePaneCreatorSubmit = async (input: PaneWorktreeModalSubmitInput): Promise<void> => {
    const target = paneCreatorTarget;
    if (!target) {
      return;
    }

    let worktreePath = input.worktreePath;
    if (input.mode === "create") {
      const created = await createWorktreeForWorkspace(target.workspaceId, {
        mode: "newBranch",
        branch: input.branch,
        baseRef: input.baseRef,
      });
      worktreePath = created.worktreePath;
    }

    if (target.paneId) {
      const latestWorkspace = useWorkspaceStore.getState().workspaces.find((workspace) => workspace.id === target.workspaceId);
      const latestPane = latestWorkspace?.panes[target.paneId];
      const restartNeeded = latestPane ? isPaneRunningLike(latestPane.status) : false;

      if (restartNeeded) {
        setPendingPaneWorktreeConfirm({
          workspaceId: target.workspaceId,
          paneId: target.paneId,
          worktreePath,
        });
        return;
      }

      await setPaneWorktree(target.workspaceId, target.paneId, worktreePath, {
        restartRunning: restartNeeded,
      });
    } else {
      await createPaneWithWorktree(target.workspaceId, worktreePath);
    }

    setPaneCreatorTarget(null);
  };

  const terminalControls =
    activeSection === "terminal" && activeWorkspace ? (
      <div className="terminal-controls">
        <Badge className="compact-label">Panes {activeWorkspace.paneCount}</Badge>
        <div className="pane-stepper" role="group" aria-label="Pane count quick controls">
          <Button
            type="button"
            variant="subtle"
            className="subtle-btn pane-stepper-btn"
            onClick={() => {
              void setActiveWorkspacePaneCount(activeWorkspace.paneCount - 1);
            }}
            disabled={activeWorkspace.paneCount <= 1}
            aria-label="Decrease pane count"
          >
            -
          </Button>
          <Button
            type="button"
            variant="subtle"
            className="subtle-btn pane-stepper-btn"
            onClick={() => {
              void setActiveWorkspacePaneCount(activeWorkspace.paneCount + 1);
            }}
            disabled={activeWorkspace.paneCount >= 16}
            aria-label="Increase pane count"
          >
            +
          </Button>
        </div>
        <Button
          type="button"
          variant="subtle"
          className="subtle-btn"
          onClick={() => openPaneCreator()}
        >
          New Worktree Pane
        </Button>
        <div className="layout-mode-toggle" role="group" aria-label="Layout mode">
          <Button
            type="button"
            variant="subtle"
            className={`layout-mode-btn ${activeWorkspace.layoutMode === "tiling" ? "active" : ""}`}
            onClick={() => setActiveWorkspaceLayoutMode("tiling")}
          >
            Tiling
          </Button>
          <Button
            type="button"
            variant="subtle"
            className={`layout-mode-btn ${activeWorkspace.layoutMode === "freeform" ? "active" : ""}`}
            onClick={() => setActiveWorkspaceLayoutMode("freeform")}
          >
            Free-form
          </Button>
        </div>
        {activeWorkspaceBoot ? (
          <>
            <Badge className="compact-label">
              Boot {activeWorkspaceBoot.completed}/{activeWorkspaceBoot.totalAgents}
              {activeWorkspaceBoot.failed > 0 ? ` · failed ${activeWorkspaceBoot.failed}` : ""}
            </Badge>
            {activeWorkspaceBoot.status === "running" ? (
              <Button
                type="button"
                variant="subtle"
                className="subtle-btn"
                onClick={() => pauseWorkspaceBoot(activeWorkspace.id)}
              >
                Pause boot
              </Button>
            ) : null}
            {activeWorkspaceBoot.status === "paused" ? (
              <Button
                type="button"
                variant="subtle"
                className="subtle-btn"
                onClick={() => resumeWorkspaceBoot(activeWorkspace.id)}
              >
                Resume boot
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
    ) : null;

  const terminalSubtitle = null;

  if (startupError) {
    return (
      <main className="app-shell app-loading">
        <StartupCrashScreen
          title="Startup failed"
          message="SuperVibing hit an error during startup. You can retry or reset local app state."
          details={startupError}
          onRetry={() => {
            clearStartupError();
            void bootstrap();
          }}
          onResetLocalData={() => {
            void resetLocalStateAndRebootstrap();
          }}
        />
      </main>
    );
  }

  if (!initialized || bootstrapping) {
    return (
      <main className="app-shell app-loading">
        <p>Bootstrapping workspace...</p>
      </main>
    );
  }

  const isTerminalSection = activeSection === "terminal";
  const openWorktreePathKeys = new Set(
    openWorkspacePaths.map((path) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()),
  );

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
            if (section === "worktrees") {
              void openWorktreeManager();
            } else {
              setActiveSection(section);
            }
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

          {terminalWorkspaces.length > 0 ? (
            <section
              className="section-surface section-surface--body terminal-surface"
              hidden={!isTerminalSection}
              aria-hidden={!isTerminalSection}
            >
              <div className="grid-shell workspace-grid-stack">
                {terminalWorkspaces.map((workspace) => (
                  <div
                    key={workspace.id}
                    className={`workspace-grid-panel ${workspace.id === activeWorkspaceId ? "is-active" : ""}`}
                    aria-hidden={workspace.id !== activeWorkspaceId}
                  >
                    <PaneGrid
                      workspaceId={workspace.id}
                      isActive={isTerminalSection && workspace.id === activeWorkspaceId}
                      paneIds={workspace.paneOrder}
                      paneMetaById={workspace.paneMetaById}
                      layouts={workspace.layouts}
                      layoutMode={workspace.layoutMode}
                      zoomedPaneId={workspace.zoomedPaneId}
                      focusedPaneId={workspace.focusedPaneId}
                      focusRequestPaneId={workspace.focusRequestPaneId}
                      onLayoutsChange={(next) => {
                        if (workspace.id === activeWorkspaceId) {
                          setActiveWorkspaceLayouts(next);
                        }
                      }}
                      onToggleZoom={(paneId) => {
                        if (workspace.id === activeWorkspaceId) {
                          toggleActiveWorkspaceZoom(paneId);
                        }
                      }}
                      onPaneFocus={(paneId) => {
                        if (workspace.id === activeWorkspaceId) {
                          setFocusedPane(workspace.id, paneId);
                        }
                      }}
                      onRequestPaneWorktreeChange={(paneId) => {
                        if (workspace.id !== activeWorkspaceId) {
                          return;
                        }
                        openPaneCreator(paneId);
                      }}
                    />
                  </div>
                ))}
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

          {activeSection === "git" ? (
            <GitSection
              active={activeSection === "git"}
              repoRoot={activeWorkspaceRuntime?.repoRoot ?? null}
              branch={activeWorkspace?.branch ?? null}
              worktreePath={activeWorkspace?.worktreePath ?? null}
              worktreeEntries={worktreeManager.entries}
              onRefreshWorktrees={refreshWorktrees}
              onImportWorktree={importWorktreeAsWorkspace}
              onOpenWorktreeManager={() => {
                void openWorktreeManager();
              }}
            />
          ) : null}

          {activeSection === "worktrees" ? (
            <WorktreeManagerSection
              repoRoot={worktreeManager.repoRoot}
              loading={worktreeManager.loading}
              error={worktreeManager.error}
              entries={worktreeManager.entries}
              lastLoadedAt={worktreeManager.lastLoadedAt}
              lastActionMessage={worktreeManager.lastActionMessage}
              onRefresh={refreshWorktrees}
              onCreate={createManagedWorktree}
              onImport={importWorktreeAsWorkspace}
              onRemove={removeManagedWorktree}
              onPrune={pruneManagedWorktrees}
              isWorktreeOpen={(worktreePath) =>
                openWorktreePathKeys.has(
                  worktreePath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase(),
                )
              }
            />
          ) : null}

          {activeSection === "settings" ? (
            <SettingsSection
              themeId={themeId}
              reduceMotion={reduceMotion}
              highContrastAssist={highContrastAssist}
              density={density}
              agentStartupDefaults={agentStartupDefaults}
              discordPresenceEnabled={discordPresenceEnabled}
              onThemeChange={setTheme}
              onReduceMotionChange={setReduceMotion}
              onHighContrastAssistChange={setHighContrastAssist}
              onDensityChange={setDensity}
              onDiscordPresenceEnabledChange={setDiscordPresenceEnabled}
              onAgentStartupDefaultChange={setAgentStartupDefault}
              onResetAgentStartupDefaults={resetAgentStartupDefaults}
            />
          ) : null}
        </div>
      </div>

      <Suspense fallback={null}>
        {paneCreatorOpen ? (
          <NewPaneModal
            open={paneCreatorOpen}
            mode={paneCreatorTarget?.paneId ? "reassign" : "create"}
            repoRoot={worktreeManager.repoRoot}
            entries={worktreeManager.entries}
            loading={worktreeManager.loading}
            error={worktreeManager.error}
            initialWorktreePath={paneCreatorPane?.worktreePath ?? paneCreatorWorkspace?.worktreePath ?? ""}
            paneId={paneCreatorTarget?.paneId ?? null}
            onClose={() => setPaneCreatorTarget(null)}
            onRefresh={refreshWorktrees}
            onSubmit={(input) => {
              void handlePaneCreatorSubmit(input);
            }}
          />
        ) : null}

        {newWorkspaceOpen ? (
          <NewWorkspaceModal
            open={newWorkspaceOpen}
            defaultDirectory={activeWorkspace?.worktreePath ?? ""}
            agentDefaults={agentDefaults}
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

      <AlertDialog
        open={pendingPaneWorktreeConfirm !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingPaneWorktreeConfirm(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart Pane to Apply Worktree</AlertDialogTitle>
            <AlertDialogDescription>
              This pane is running. Applying a new worktree will restart the pane. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const pending = pendingPaneWorktreeConfirm;
                if (!pending) {
                  return;
                }

                void setPaneWorktree(pending.workspaceId, pending.paneId, pending.worktreePath, {
                  restartRunning: true,
                }).then(() => {
                  setPaneCreatorTarget(null);
                }).finally(() => {
                  setPendingPaneWorktreeConfirm(null);
                });
              }}
            >
              Restart and apply
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

export default App;
