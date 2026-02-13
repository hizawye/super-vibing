import { create } from "zustand";
import type { Layout } from "react-grid-layout";
import { findDirectionalPaneTarget, type PaneMoveDirection } from "../lib/pane-focus";
import {
  createWorktree as createWorktreeApi,
  closePane,
  getCurrentBranch,
  getDefaultCwd,
  listWorktrees,
  pruneWorktrees,
  removeWorktree,
  resolveRepoContext,
  resumePane,
  runGlobalCommand,
  setDiscordPresenceEnabled as setDiscordPresenceEnabledApi,
  syncAutomationWorkspaces,
  spawnPane,
  suspendPane,
  writePaneInput,
} from "../lib/tauri";
import { toRuntimePaneId } from "../lib/panes";
import { generateTilingLayouts } from "../lib/tiling";
import {
  loadPersistedPayload,
  resetPersistedPayload,
  saveBlueprints,
  saveSessionState,
  saveSnapshots,
} from "../lib/persistence";
import { DEFAULT_THEME_ID, isThemeId } from "../theme/themes";
import type {
  AgentAllocation,
  AgentProfileKey,
  AgentStartupDefaults,
  AppSection,
  Blueprint,
  DensityMode,
  LayoutMode,
  LegacySessionState,
  PaneCommandResult,
  PaneModel,
  RepoContext,
  SessionState,
  Snapshot,
  ThemeId,
  UiPreferences,
  AutomationWorkspaceSnapshot,
  WorktreeCreateMode,
  WorktreeEntry,
  WorkspaceBootSession,
  WorkspaceRuntime,
} from "../types";

interface CreateWorkspaceInput {
  name?: string;
  directory: string;
  paneCount: number;
  agentAllocation: AgentAllocation[];
}

interface PaneSpawnOptions {
  initCommand?: string;
  executeInit?: boolean;
}

interface WorkspaceBootOptions {
  eligiblePaneIds?: string[];
}

interface WorktreeManagerState {
  repoRoot: string | null;
  loading: boolean;
  error: string | null;
  entries: WorktreeEntry[];
  lastLoadedAt: string | null;
  lastActionMessage: string | null;
}

interface ManagedWorktreeCreateInput {
  mode: WorktreeCreateMode;
  branch: string;
  baseRef?: string;
  openAfterCreate?: boolean;
}

interface ManagedWorktreeRemoveInput {
  worktreePath: string;
  force: boolean;
  deleteBranch: boolean;
}

interface PaneWorktreeCreateInput {
  mode: WorktreeCreateMode;
  branch: string;
  baseRef?: string;
}

interface WorkspaceStore {
  initialized: boolean;
  bootstrapping: boolean;
  startupError: string | null;
  activeSection: AppSection;
  paletteOpen: boolean;
  echoInput: boolean;
  themeId: ThemeId;
  reduceMotion: boolean;
  highContrastAssist: boolean;
  density: DensityMode;
  agentStartupDefaults: AgentStartupDefaults;
  discordPresenceEnabled: boolean;
  workspaces: WorkspaceRuntime[];
  activeWorkspaceId: string | null;
  focusedPaneByWorkspace: Record<string, string | null>;
  focusRequestByWorkspace: Record<string, string | null>;
  terminalReadyPanesByWorkspace: Record<string, Record<string, true>>;
  workspaceBootSessions: Record<string, WorkspaceBootSession>;
  snapshots: Snapshot[];
  blueprints: Blueprint[];
  worktreeManager: WorktreeManagerState;

  bootstrap: () => Promise<void>;
  clearStartupError: () => void;
  resetLocalStateAndRebootstrap: () => Promise<void>;
  setActiveSection: (section: AppSection) => void;
  setPaletteOpen: (open: boolean) => void;
  setEchoInput: (enabled: boolean) => void;
  setTheme: (themeId: ThemeId) => void;
  setReduceMotion: (enabled: boolean) => void;
  setHighContrastAssist: (enabled: boolean) => void;
  setDensity: (density: DensityMode) => void;
  setAgentStartupDefault: (profile: AgentProfileKey, command: string) => void;
  resetAgentStartupDefaults: () => void;
  setDiscordPresenceEnabled: (enabled: boolean) => void;
  createWorkspace: (input: CreateWorkspaceInput) => Promise<void>;
  closeWorkspace: (workspaceId: string) => Promise<void>;
  setActiveWorkspace: (workspaceId: string) => Promise<void>;
  setActiveWorkspacePaneCount: (count: number) => Promise<void>;
  addPaneToActiveWorkspaceAndFocus: () => Promise<void>;
  createPaneWithWorktree: (workspaceId: string, worktreePath: string) => Promise<string>;
  setPaneWorktree: (
    workspaceId: string,
    paneId: string,
    worktreePath: string,
    options?: { restartRunning?: boolean },
  ) => Promise<void>;
  startWorkspaceBoot: (workspaceId: string, options?: WorkspaceBootOptions) => Promise<void>;
  pauseWorkspaceBoot: (workspaceId: string) => void;
  resumeWorkspaceBoot: (workspaceId: string) => void;
  cancelWorkspaceBoot: (workspaceId: string) => void;
  markPaneTerminalReady: (workspaceId: string, paneId: string) => void;
  markPaneTerminalNotReady: (workspaceId: string, paneId: string) => void;
  ensurePaneSpawned: (workspaceId: string, paneId: string, options?: PaneSpawnOptions) => Promise<void>;
  markPaneExited: (workspaceId: string, paneId: string, error?: string) => void;
  updatePaneLastCommand: (workspaceId: string, paneId: string, command: string) => void;
  sendInputFromPane: (workspaceId: string, sourcePaneId: string, data: string) => Promise<void>;
  setActiveWorkspaceLayoutMode: (mode: LayoutMode) => void;
  setActiveWorkspaceLayouts: (layouts: Layout[]) => void;
  toggleActiveWorkspaceZoom: (paneId: string) => void;
  requestPaneTerminalFocus: (workspaceId: string, paneId: string) => void;
  setFocusedPane: (workspaceId: string, paneId: string) => void;
  moveFocusedPane: (workspaceId: string, direction: PaneMoveDirection) => void;
  resizeFocusedPaneByDelta: (workspaceId: string, dx: number, dy: number) => void;
  runGlobalCommand: (command: string, execute: boolean) => Promise<PaneCommandResult[]>;
  saveSnapshot: (name: string) => Promise<void>;
  restoreSnapshot: (snapshotId: string) => Promise<void>;
  createBlueprint: (name: string, workspacePaths: string[], autorunCommands: string[]) => Promise<void>;
  launchBlueprint: (blueprintId: string) => Promise<void>;
  openWorktreeManager: () => Promise<void>;
  refreshWorktrees: () => Promise<void>;
  createWorktreeForWorkspace: (workspaceId: string, input: PaneWorktreeCreateInput) => Promise<WorktreeEntry>;
  createManagedWorktree: (input: ManagedWorktreeCreateInput) => Promise<void>;
  importWorktreeAsWorkspace: (worktreePath: string) => Promise<void>;
  removeManagedWorktree: (input: ManagedWorktreeRemoveInput) => Promise<void>;
  pruneManagedWorktrees: (dryRun: boolean) => Promise<void>;
  persistSession: () => Promise<void>;
}

const MAX_PANES = 16;
const MIN_PANES = 1;
const GRID_COLS = 12;
const SPAWN_CONCURRENCY_LIMIT = 4;
const PERSIST_DEBOUNCE_MS = 400;
// Keep inactive workspaces alive longer before reclaiming PTY/runtime memory.
const INACTIVE_WORKSPACE_SUSPEND_MS = 10 * 60 * 1000;
const INPUT_BATCH_MS = 16;
const AGENT_BOOT_PARALLELISM = 3;
const AGENT_BOOT_STAGGER_MS = 150;
const AGENT_BOOT_RETRY_LIMIT = 1;
const AGENT_BOOT_RETRY_BACKOFF_MS = 300;

const AGENT_PROFILE_CONFIG: Array<{ profile: AgentProfileKey; label: string; command: string }> = [
  { profile: "claude", label: "Claude", command: "claude" },
  { profile: "codex", label: "Codex", command: "codex" },
  { profile: "gemini", label: "Gemini", command: "gemini" },
  { profile: "cursor", label: "Cursor", command: "cursor-agent" },
  { profile: "opencode", label: "OpenCode", command: "opencode" },
];

const AGENT_PROFILE_DEFAULTS: AgentStartupDefaults = AGENT_PROFILE_CONFIG.reduce<AgentStartupDefaults>(
  (acc, item) => {
    acc[item.profile] = item.command;
    return acc;
  },
  {
    claude: "claude",
    codex: "codex",
    gemini: "gemini",
    cursor: "cursor-agent",
    opencode: "opencode",
  },
);

function defaultUiPreferences(): UiPreferences {
  return {
    theme: DEFAULT_THEME_ID,
    reduceMotion: false,
    highContrastAssist: false,
    density: "comfortable",
  };
}

function defaultAgentStartupDefaults(): AgentStartupDefaults {
  return { ...AGENT_PROFILE_DEFAULTS };
}

function sanitizeDiscordPresenceEnabled(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

async function applyDiscordPresenceEnabled(enabled: boolean): Promise<void> {
  try {
    await setDiscordPresenceEnabledApi(enabled);
  } catch {
    // Non-fatal: presence requires desktop runtime and optional env config.
  }
}

function formatStartupError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0) {
      return message;
    }
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }

  return "Failed to initialize SuperVibing.";
}

function sanitizeUiPreferences(preferences?: Partial<UiPreferences> | null): UiPreferences {
  const defaults = defaultUiPreferences();
  const theme = preferences?.theme;
  const density = preferences?.density;

  return {
    theme: theme && isThemeId(theme) ? theme : defaults.theme,
    reduceMotion: typeof preferences?.reduceMotion === "boolean" ? preferences.reduceMotion : defaults.reduceMotion,
    highContrastAssist:
      typeof preferences?.highContrastAssist === "boolean"
        ? preferences.highContrastAssist
        : defaults.highContrastAssist,
    density: density === "compact" || density === "comfortable" ? density : defaults.density,
  };
}

function sanitizeAgentStartupDefaults(
  defaults?: Partial<AgentStartupDefaults> | null,
): AgentStartupDefaults {
  const normalized = defaultAgentStartupDefaults();
  AGENT_PROFILE_CONFIG.forEach(({ profile }) => {
    const value = defaults?.[profile];
    if (typeof value !== "string") {
      return;
    }

    const command = value.trim();
    normalized[profile] = command.length > 0 ? command : AGENT_PROFILE_DEFAULTS[profile];
  });

  return normalized;
}

function defaultWorktreeManagerState(): WorktreeManagerState {
  return {
    repoRoot: null,
    loading: false,
    error: null,
    entries: [],
    lastLoadedAt: null,
    lastActionMessage: null,
  };
}

function normalizePathKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function buildAutomationWorkspaceSnapshots(workspaces: WorkspaceRuntime[]): AutomationWorkspaceSnapshot[] {
  return workspaces.map((workspace) => ({
    workspaceId: workspace.id,
    name: workspace.name,
    repoRoot: workspace.repoRoot,
    worktreePath: workspace.worktreePath,
    runtimePaneIds: workspace.paneOrder
      .filter((paneId) => {
        const status = workspace.panes[paneId]?.status;
        return status === "running" || status === "spawning" || status === "suspended";
      })
      .map((paneId) => toRuntimePaneId(workspace.id, paneId)),
  }));
}

async function syncAutomationRegistry(getState: () => WorkspaceStore): Promise<void> {
  const state = getState();
  await syncAutomationWorkspaces(buildAutomationWorkspaceSnapshots(state.workspaces));
}

function enqueueAutomationSync(getState: () => WorkspaceStore): void {
  void syncAutomationRegistry(getState).catch(() => {
    // best effort sync to backend automation bridge
  });
}

async function resolveRepoContextSafe(cwd: string): Promise<RepoContext> {
  try {
    return await resolveRepoContext(cwd);
  } catch {
    let branch = "not-a-repo";
    try {
      branch = await getCurrentBranch(cwd);
    } catch {
      branch = "not-a-repo";
    }

    return {
      isGitRepo: false,
      repoRoot: cwd,
      worktreePath: cwd,
      branch,
    };
  }
}

interface PendingPaneInit {
  command: string;
  execute: boolean;
}

const spawnInFlight = new Map<string, Promise<void>>();
const pendingPaneInit = new Map<string, PendingPaneInit>();
const workspaceSuspendTimers = new Map<string, ReturnType<typeof setTimeout>>();
const paneInputBuffers = new Map<string, string>();
const paneInputTimers = new Map<string, ReturnType<typeof setTimeout>>();
const paneInputFlushes = new Map<string, Promise<void>>();
const paneTerminalReadyWaiters = new Map<string, Set<() => void>>();
const workspaceBootInFlight = new Map<string, Promise<void>>();
const workspaceBootControllers = new Map<string, WorkspaceBootController>();
const spawnSlotWaiters: Array<() => void> = [];
let activeSpawnSlots = 0;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistQueue: Promise<void> = Promise.resolve();

type WorkspaceSetState = (
  updater: Partial<WorkspaceStore> | ((state: WorkspaceStore) => Partial<WorkspaceStore>),
) => void;

interface WorkspaceBootController {
  paused: boolean;
  canceled: boolean;
  maxParallel: number;
  pressureStrikeCount: number;
  waiters: Array<() => void>;
}

function paneRuntimeKey(workspaceId: string, paneId: string): string {
  return `${workspaceId}:${paneId}`;
}

function isPaneTerminalReady(
  state: Pick<WorkspaceStore, "terminalReadyPanesByWorkspace">,
  workspaceId: string,
  paneId: string,
): boolean {
  return Boolean(state.terminalReadyPanesByWorkspace[workspaceId]?.[paneId]);
}

function wakePaneTerminalReadyWaiters(workspaceId: string, paneId: string): void {
  const key = paneRuntimeKey(workspaceId, paneId);
  const waiters = paneTerminalReadyWaiters.get(key);
  if (!waiters) {
    return;
  }
  paneTerminalReadyWaiters.delete(key);
  waiters.forEach((wake) => wake());
}

function clearPaneTerminalReadyWaiters(workspaceId: string, paneId: string): void {
  paneTerminalReadyWaiters.delete(paneRuntimeKey(workspaceId, paneId));
}

function clearPaneTerminalReadyWaitersForWorkspace(workspaceId: string): void {
  const prefix = `${workspaceId}:`;
  Array.from(paneTerminalReadyWaiters.keys()).forEach((key) => {
    if (key.startsWith(prefix)) {
      paneTerminalReadyWaiters.delete(key);
    }
  });
}

async function waitForPaneTerminalReady(
  getState: () => WorkspaceStore,
  workspaceId: string,
  paneId: string,
  timeoutMs = 3000,
): Promise<void> {
  if (isPaneTerminalReady(getState(), workspaceId, paneId)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const key = paneRuntimeKey(workspaceId, paneId);
    const waiters = paneTerminalReadyWaiters.get(key) ?? new Set<() => void>();
    paneTerminalReadyWaiters.set(key, waiters);

    let finished = false;
    const complete = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      const active = paneTerminalReadyWaiters.get(key);
      active?.delete(complete);
      if (active && active.size === 0) {
        paneTerminalReadyWaiters.delete(key);
      }
      resolve();
    };

    const timer = setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;
      const active = paneTerminalReadyWaiters.get(key);
      active?.delete(complete);
      if (active && active.size === 0) {
        paneTerminalReadyWaiters.delete(key);
      }
      reject(new Error("terminal not ready for interactive launch"));
    }, timeoutMs);

    waiters.add(complete);
  });
}

function isAlreadyExistsError(error: unknown): boolean {
  return String(error).toLowerCase().includes("already exists");
}

function queuePendingPaneInit(workspaceId: string, paneId: string, options?: PaneSpawnOptions): void {
  const command = options?.initCommand?.trim();
  if (!command) {
    return;
  }

  const key = paneRuntimeKey(workspaceId, paneId);
  const previous = pendingPaneInit.get(key);
  pendingPaneInit.set(key, {
    command,
    execute: Boolean(options?.executeInit) || (previous?.command === command ? previous.execute : false),
  });
}

function clearPendingPaneInit(workspaceId: string, paneId: string): void {
  pendingPaneInit.delete(paneRuntimeKey(workspaceId, paneId));
}

function clearPendingPaneInitForWorkspace(workspaceId: string): void {
  const prefix = `${workspaceId}:`;
  Array.from(pendingPaneInit.keys()).forEach((key) => {
    if (key.startsWith(prefix)) {
      pendingPaneInit.delete(key);
    }
  });
}

function clearAllPendingPaneInit(): void {
  pendingPaneInit.clear();
}

function clearSuspendTimer(workspaceId: string): void {
  const timer = workspaceSuspendTimers.get(workspaceId);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  workspaceSuspendTimers.delete(workspaceId);
}

function clearAllSuspendTimers(): void {
  Array.from(workspaceSuspendTimers.keys()).forEach((workspaceId) => clearSuspendTimer(workspaceId));
}

function enqueuePersist(getState: () => WorkspaceStore): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushPersist(getState).catch(() => {
      // best effort for debounced persist operations
    });
  }, PERSIST_DEBOUNCE_MS);
}

async function flushPersist(getState: () => WorkspaceStore): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }

  const payload = serializeSessionState(getState());
  persistQueue = persistQueue
    .catch(() => {
      // recover queue chain after prior persistence failures
    })
    .then(async () => {
      await saveSessionState(payload);
    });

  await persistQueue;
}

function queuePaneInput(runtimePaneId: string, data: string): Promise<void> {
  const buffered = paneInputBuffers.get(runtimePaneId) ?? "";
  if (data.length > 0) {
    paneInputBuffers.set(runtimePaneId, buffered + data);
  }

  const inProgress = paneInputFlushes.get(runtimePaneId);
  if (inProgress) {
    return inProgress;
  }

  const flush = new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      paneInputTimers.delete(runtimePaneId);
      resolve();
    }, INPUT_BATCH_MS);
    paneInputTimers.set(runtimePaneId, timer);
  })
    .then(async () => {
      const chunk = paneInputBuffers.get(runtimePaneId) ?? "";
      paneInputBuffers.delete(runtimePaneId);
      if (chunk.length === 0) {
        return;
      }

      await writePaneInput({
        paneId: runtimePaneId,
        data: chunk,
        execute: false,
      });
    })
    .finally(() => {
      paneInputFlushes.delete(runtimePaneId);
      if ((paneInputBuffers.get(runtimePaneId)?.length ?? 0) > 0) {
        void queuePaneInput(runtimePaneId, "");
      }
    });

  paneInputFlushes.set(runtimePaneId, flush);
  return flush;
}

function clearWorkspacePaneInputBuffers(workspaceId: string): void {
  const prefix = `${workspaceId}::`;
  Array.from(paneInputTimers.keys()).forEach((runtimePaneId) => {
    if (!runtimePaneId.startsWith(prefix)) {
      return;
    }
    const timer = paneInputTimers.get(runtimePaneId);
    if (timer) {
      clearTimeout(timer);
    }
    paneInputTimers.delete(runtimePaneId);
    paneInputBuffers.delete(runtimePaneId);
    paneInputFlushes.delete(runtimePaneId);
  });
}

function clearPaneInputBuffers(workspaceId: string, paneId: string): void {
  const runtimePaneId = toRuntimePaneId(workspaceId, paneId);
  const timer = paneInputTimers.get(runtimePaneId);
  if (timer) {
    clearTimeout(timer);
  }
  paneInputTimers.delete(runtimePaneId);
  paneInputBuffers.delete(runtimePaneId);
  paneInputFlushes.delete(runtimePaneId);
}

async function withConcurrency<T>(
  items: T[],
  limit: number,
  iteratee: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await iteratee(items[index] as T);
    }
  });

  await Promise.all(workers);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withSpawnSlot<T>(task: () => Promise<T>): Promise<T> {
  while (activeSpawnSlots >= SPAWN_CONCURRENCY_LIMIT) {
    await new Promise<void>((resolve) => {
      spawnSlotWaiters.push(resolve);
    });
  }

  activeSpawnSlots += 1;
  try {
    return await task();
  } finally {
    activeSpawnSlots = Math.max(0, activeSpawnSlots - 1);
    const waiter = spawnSlotWaiters.shift();
    waiter?.();
  }
}

function createBootSession(workspaceId: string, totalAgents: number): WorkspaceBootSession {
  const timestamp = new Date().toISOString();
  return {
    workspaceId,
    totalAgents,
    queued: totalAgents,
    running: 0,
    completed: 0,
    failed: 0,
    status: totalAgents > 0 ? "running" : "completed",
    startedAt: timestamp,
    updatedAt: timestamp,
  };
}

function updateWorkspaceBootSession(
  setState: WorkspaceSetState,
  workspaceId: string,
  updater: (session: WorkspaceBootSession) => WorkspaceBootSession,
): void {
  setState((state) => {
    const current = state.workspaceBootSessions[workspaceId];
    if (!current) {
      return {};
    }

    const next = updater(current);
    return {
      workspaceBootSessions: {
        ...state.workspaceBootSessions,
        [workspaceId]: next,
      },
    };
  });
}

function setWorkspaceBootSession(setState: WorkspaceSetState, session: WorkspaceBootSession): void {
  setState((state) => ({
    workspaceBootSessions: {
      ...state.workspaceBootSessions,
      [session.workspaceId]: session,
    },
  }));
}

function removeWorkspaceBootSession(setState: WorkspaceSetState, workspaceId: string): void {
  setState((state) => {
    if (!state.workspaceBootSessions[workspaceId]) {
      return {};
    }
    const next = { ...state.workspaceBootSessions };
    delete next[workspaceId];
    return { workspaceBootSessions: next };
  });
}

function clearAllWorkspaceBoot(setState: WorkspaceSetState): void {
  workspaceBootControllers.forEach((controller) => {
    controller.canceled = true;
    controller.paused = false;
    wakeBootController(controller);
  });
  workspaceBootControllers.clear();
  workspaceBootInFlight.clear();
  setState({ workspaceBootSessions: {} });
}

function getBootController(workspaceId: string): WorkspaceBootController {
  const existing = workspaceBootControllers.get(workspaceId);
  if (existing) {
    return existing;
  }

  const controller: WorkspaceBootController = {
    paused: false,
    canceled: false,
    maxParallel: AGENT_BOOT_PARALLELISM,
    pressureStrikeCount: 0,
    waiters: [],
  };
  workspaceBootControllers.set(workspaceId, controller);
  return controller;
}

function wakeBootController(controller: WorkspaceBootController): void {
  const waiters = controller.waiters.splice(0);
  waiters.forEach((wake) => wake());
}

async function waitForBootResume(controller: WorkspaceBootController): Promise<void> {
  while (controller.paused && !controller.canceled) {
    await new Promise<void>((resolve) => controller.waiters.push(resolve));
  }
}

async function flushPendingPaneInit(
  getState: () => WorkspaceStore,
  workspaceId: string,
  paneId: string,
): Promise<void> {
  const key = paneRuntimeKey(workspaceId, paneId);
  const pending = pendingPaneInit.get(key);
  if (!pending) {
    return;
  }

  const state = getState();
  if (state.activeWorkspaceId !== workspaceId) {
    return;
  }

  const workspace = state.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) {
    return;
  }

  const pane = workspace.panes[paneId];
  if (!pane || pane.status !== "running") {
    return;
  }
  if (!isPaneTerminalReady(state, workspaceId, paneId)) {
    return;
  }

  try {
    await writePaneInput({
      paneId: toRuntimePaneId(workspaceId, paneId),
      data: pending.command,
      execute: pending.execute,
    });
    pendingPaneInit.delete(key);
  } catch {
    // retry on subsequent spawn/ensure attempts
  }
}

async function spawnPaneWithConflictRetry(
  runtimePaneId: string,
  cwd: string,
): Promise<Awaited<ReturnType<typeof spawnPane>>> {
  try {
    return await spawnPane({
      paneId: runtimePaneId,
      cwd,
    });
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }

    try {
      await closePane(runtimePaneId);
    } catch {
      // best effort cleanup before a single retry
    }

    return spawnPane({
      paneId: runtimePaneId,
      cwd,
    });
  }
}

function clampPaneCount(value: number): number {
  return Math.max(MIN_PANES, Math.min(MAX_PANES, value));
}

function paneIdAt(index: number): string {
  return `pane-${index + 1}`;
}

function createPaneModel(args: {
  id: string;
  title?: string;
  cwd?: string;
  worktreePath?: string;
  shell?: string;
}): PaneModel {
  const worktreePath = args.worktreePath ?? args.cwd ?? "";
  return {
    id: args.id,
    title: args.title ?? args.id,
    cwd: args.cwd ?? "",
    worktreePath,
    shell: args.shell ?? "",
    status: "idle",
    lastSubmittedCommand: "",
  };
}

function generateFreeformLayouts(paneOrder: string[], existing: Layout[] = []): Layout[] {
  const existingById = new Map(existing.map((layout) => [layout.i, layout]));
  return paneOrder.map((paneId, index) => {
    const previous = existingById.get(paneId);
    if (previous) {
      return previous;
    }

    const x = (index % 4) * 3;
    const y = Math.floor(index / 4) * 3;
    return {
      i: paneId,
      x,
      y,
      w: 3,
      h: 3,
      minW: 2,
      minH: 2,
    };
  });
}

function isLayoutMode(value: unknown): value is LayoutMode {
  return value === "tiling" || value === "freeform";
}

function resolveWorkspaceLayouts(paneOrder: string[], layoutMode: LayoutMode, existing: Layout[] = []): Layout[] {
  if (layoutMode === "tiling") {
    return generateTilingLayouts(paneOrder);
  }
  return generateFreeformLayouts(paneOrder, existing);
}

function areLayoutsEquivalent(current: Layout[], next: Layout[]): boolean {
  if (current.length !== next.length) {
    return false;
  }

  for (let index = 0; index < current.length; index += 1) {
    const a = current[index];
    const b = next[index];
    if (!a || !b) {
      return false;
    }

    if (a.i !== b.i || a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h) {
      return false;
    }

    if (
      a.minW !== b.minW
      || a.maxW !== b.maxW
      || a.minH !== b.minH
      || a.maxH !== b.maxH
      || a.static !== b.static
      || a.isDraggable !== b.isDraggable
      || a.isResizable !== b.isResizable
      || a.isBounded !== b.isBounded
    ) {
      return false;
    }
  }

  return true;
}

function toIdlePanes(panes: Record<string, PaneModel>): Record<string, PaneModel> {
  const next: Record<string, PaneModel> = {};
  Object.entries(panes).forEach(([id, pane]) => {
    const worktreePath = pane.worktreePath?.trim().length ? pane.worktreePath : pane.cwd;
    next[id] = {
      ...pane,
      worktreePath: worktreePath ?? "",
      status: "idle",
      error: undefined,
    };
  });
  return next;
}

function defaultAgentAllocation(agentStartupDefaults = defaultAgentStartupDefaults()): AgentAllocation[] {
  return AGENT_PROFILE_CONFIG.map((item) => ({
    profile: item.profile,
    label: item.label,
    command: agentStartupDefaults[item.profile],
    enabled: false,
    count: 0,
  }));
}

function normalizeAgentAllocation(
  input: AgentAllocation[] | undefined,
  agentStartupDefaults: AgentStartupDefaults,
): AgentAllocation[] {
  const byProfile = new Map((input ?? []).map((item) => [item.profile, item]));
  return AGENT_PROFILE_CONFIG.map((base) => {
    const existing = byProfile.get(base.profile);
    const command = existing?.command?.trim();
    return {
      profile: base.profile,
      label: existing?.label ?? base.label,
      command: command && command.length > 0 ? command : agentStartupDefaults[base.profile],
      enabled: existing?.enabled ?? false,
      count: Math.max(0, Math.min(MAX_PANES, existing?.count ?? 0)),
    };
  });
}

function createWorkspaceRuntime(args: {
  id: string;
  name: string;
  directory: string;
  repoRoot?: string;
  worktreePath?: string;
  branch: string;
  layoutMode?: LayoutMode;
  paneCount: number;
  agentAllocation?: AgentAllocation[];
  agentStartupDefaults?: AgentStartupDefaults;
  createdAt?: string;
  paneOrder?: string[];
  panes?: Record<string, PaneModel>;
  layouts?: Layout[];
  zoomedPaneId?: string | null;
}): WorkspaceRuntime {
  const layoutMode = args.layoutMode ?? "tiling";
  const paneCount = clampPaneCount(args.paneCount);
  const paneOrder = args.paneOrder ?? Array.from({ length: paneCount }, (_, index) => paneIdAt(index));
  const defaultPaneWorktreePath = args.worktreePath ?? args.directory;
  const panes = args.panes
    ? { ...args.panes }
    : paneOrder.reduce<Record<string, PaneModel>>((acc, paneId) => {
      acc[paneId] = createPaneModel({
        id: paneId,
        worktreePath: defaultPaneWorktreePath,
      });
      return acc;
    }, {});

  paneOrder.forEach((paneId) => {
    const pane = panes[paneId];
    if (!pane) {
      panes[paneId] = createPaneModel({
        id: paneId,
        worktreePath: defaultPaneWorktreePath,
      });
      return;
    }

    const normalizedPath = pane.worktreePath?.trim() || pane.cwd?.trim() || defaultPaneWorktreePath;
    panes[paneId] = {
      ...pane,
      cwd: pane.cwd?.trim().length ? pane.cwd : normalizedPath,
      worktreePath: normalizedPath,
    };
  });

  const timestamp = args.createdAt ?? new Date().toISOString();

  return {
    id: args.id,
    name: args.name,
    repoRoot: args.repoRoot ?? args.directory,
    branch: args.branch,
    worktreePath: args.worktreePath ?? args.directory,
    layoutMode,
    paneCount,
    paneOrder,
    panes,
    layouts: resolveWorkspaceLayouts(paneOrder, layoutMode, args.layouts ?? []),
    zoomedPaneId:
      args.zoomedPaneId && paneOrder.includes(args.zoomedPaneId)
        ? args.zoomedPaneId
        : null,
    agentAllocation: normalizeAgentAllocation(
      args.agentAllocation,
      args.agentStartupDefaults ?? defaultAgentStartupDefaults(),
    ),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function withWorkspaceUpdated(
  workspaces: WorkspaceRuntime[],
  workspaceId: string,
  updater: (workspace: WorkspaceRuntime) => WorkspaceRuntime,
): WorkspaceRuntime[] {
  return workspaces.map((workspace) => (workspace.id === workspaceId ? updater(workspace) : workspace));
}

function activeWorkspaceOf(state: Pick<WorkspaceStore, "workspaces" | "activeWorkspaceId">): WorkspaceRuntime | null {
  if (!state.activeWorkspaceId) {
    return null;
  }
  return state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ?? null;
}

function resolveFocusedPaneId(workspace: WorkspaceRuntime, preferredPaneId?: string | null): string | null {
  if (preferredPaneId && workspace.paneOrder.includes(preferredPaneId)) {
    return preferredPaneId;
  }

  if (workspace.zoomedPaneId && workspace.paneOrder.includes(workspace.zoomedPaneId)) {
    return workspace.zoomedPaneId;
  }

  return workspace.paneOrder[0] ?? null;
}

function buildFocusedPaneMap(workspaces: WorkspaceRuntime[]): Record<string, string | null> {
  return Object.fromEntries(
    workspaces.map((workspace) => [workspace.id, resolveFocusedPaneId(workspace)]),
  );
}

function buildFocusRequestMap(workspaces: WorkspaceRuntime[]): Record<string, string | null> {
  return Object.fromEntries(
    workspaces.map((workspace) => [workspace.id, resolveFocusedPaneId(workspace)]),
  );
}

function serializeSessionState(state: WorkspaceStore): SessionState {
  return {
    workspaces: state.workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
    activeSection: state.activeSection,
    echoInput: state.echoInput,
    discordPresenceEnabled: state.discordPresenceEnabled,
    uiPreferences: {
      theme: state.themeId,
      reduceMotion: state.reduceMotion,
      highContrastAssist: state.highContrastAssist,
      density: state.density,
    },
    agentStartupDefaults: state.agentStartupDefaults,
  };
}

function isLegacySessionState(session: SessionState | LegacySessionState): session is LegacySessionState {
  return "paneCount" in session;
}

function migrateLegacySession(session: LegacySessionState): SessionState {
  const agentStartupDefaults = defaultAgentStartupDefaults();
  const paneCount = clampPaneCount(session.paneCount);
  const paneOrder = session.paneOrder.slice(0, paneCount);
  const normalizedOrder = paneOrder.length > 0 ? paneOrder : [paneIdAt(0)];
  const migratedWorkspaces = (session.workspaces.length > 0 ? session.workspaces : [
    {
      id: "workspace-main",
      repoRoot: ".",
      branch: "not-a-repo",
      worktreePath: ".",
    },
  ]).map((workspace) =>
    createWorkspaceRuntime({
      id: workspace.id,
      name: workspace.branch,
      directory: workspace.worktreePath,
      repoRoot: workspace.repoRoot,
      worktreePath: workspace.worktreePath,
      branch: workspace.branch,
      layoutMode: "tiling",
      paneCount,
      paneOrder: normalizedOrder,
      panes: toIdlePanes(session.panes),
      layouts: session.layouts,
      zoomedPaneId: session.zoomedPaneId,
      agentAllocation: defaultAgentAllocation(agentStartupDefaults),
      agentStartupDefaults,
    }),
  );

  return {
    workspaces: migratedWorkspaces,
    activeWorkspaceId: session.activeWorkspaceId ?? migratedWorkspaces[0]?.id ?? null,
    activeSection: "terminal",
    echoInput: session.echoInput,
    discordPresenceEnabled: false,
    uiPreferences: defaultUiPreferences(),
    agentStartupDefaults,
  };
}

function sanitizeSession(session: SessionState): SessionState {
  const agentStartupDefaults = sanitizeAgentStartupDefaults(session.agentStartupDefaults);
  const workspaces = session.workspaces.map((workspace) => {
    const paneCount = clampPaneCount(workspace.paneCount);
    const paneOrder = workspace.paneOrder.slice(0, paneCount);
    const normalizedOrder = paneOrder.length > 0 ? paneOrder : [paneIdAt(0)];
    const panes = toIdlePanes(workspace.panes ?? {});
    const workspaceDefaultPath = workspace.worktreePath;

    normalizedOrder.forEach((paneId) => {
      if (!panes[paneId]) {
        panes[paneId] = createPaneModel({
          id: paneId,
          worktreePath: workspaceDefaultPath,
        });
        return;
      }

      const pane = panes[paneId];
      const worktreePath = pane.worktreePath?.trim() || pane.cwd?.trim() || workspaceDefaultPath;
      panes[paneId] = {
        ...pane,
        worktreePath,
      };
    });

    return createWorkspaceRuntime({
      id: workspace.id,
      name: workspace.name,
      directory: workspace.worktreePath,
      repoRoot: workspace.repoRoot,
      worktreePath: workspace.worktreePath,
      branch: workspace.branch,
      layoutMode: isLayoutMode(workspace.layoutMode) ? workspace.layoutMode : "tiling",
      paneCount,
      paneOrder: normalizedOrder,
      panes,
      layouts: workspace.layouts,
      zoomedPaneId: workspace.zoomedPaneId,
      agentAllocation: workspace.agentAllocation,
      agentStartupDefaults,
      createdAt: workspace.createdAt,
    });
  });

  return {
    workspaces,
    activeWorkspaceId: workspaces.some((workspace) => workspace.id === session.activeWorkspaceId)
      ? session.activeWorkspaceId
      : workspaces[0]?.id ?? null,
    activeSection: session.activeSection,
    echoInput: session.echoInput,
    discordPresenceEnabled: sanitizeDiscordPresenceEnabled(session.discordPresenceEnabled),
    uiPreferences: sanitizeUiPreferences(session.uiPreferences),
    agentStartupDefaults,
  };
}

async function closeRunningPanes(workspace: WorkspaceRuntime): Promise<void> {
  const runningPaneIds = workspace.paneOrder.filter((paneId) => {
    const status = workspace.panes[paneId]?.status;
    return status === "running" || status === "suspended" || status === "spawning";
  });
  await Promise.all(
    runningPaneIds.map(async (paneId) => {
      try {
        await closePane(toRuntimePaneId(workspace.id, paneId));
      } catch {
        // best effort cleanup when switching contexts
      }
    }),
  );
}

async function suspendWorkspacePanes(
  getState: () => WorkspaceStore,
  setState: WorkspaceSetState,
  workspaceId: string,
): Promise<void> {
  const state = getState();
  if (state.activeWorkspaceId === workspaceId) {
    return;
  }

  const workspace = state.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) {
    return;
  }

  const runningPaneIds = workspace.paneOrder.filter((paneId) => workspace.panes[paneId]?.status === "running");
  if (runningPaneIds.length === 0) {
    return;
  }

  const suspendedPaneIds = await Promise.all(
    runningPaneIds.map(async (paneId) => {
      try {
        await suspendPane(toRuntimePaneId(workspaceId, paneId));
        return paneId;
      } catch {
        return null;
      }
    }),
  );
  const suspended = new Set(suspendedPaneIds.filter(Boolean) as string[]);
  if (suspended.size === 0) {
    return;
  }

  setState((current) => ({
    workspaces: withWorkspaceUpdated(current.workspaces, workspaceId, (target) => {
      const panes: Record<string, PaneModel> = { ...target.panes };
      suspended.forEach((paneId) => {
        const pane = panes[paneId];
        if (!pane) {
          return;
        }
        panes[paneId] = {
          ...pane,
          status: "suspended",
          error: undefined,
        };
      });

      return {
        ...target,
        panes,
        updatedAt: new Date().toISOString(),
      };
    }),
  }));
  enqueuePersist(getState);
}

function scheduleWorkspaceSuspend(
  getState: () => WorkspaceStore,
  setState: WorkspaceSetState,
  workspaceId: string,
): void {
  clearSuspendTimer(workspaceId);
  const timer = setTimeout(() => {
    workspaceSuspendTimers.delete(workspaceId);
    void suspendWorkspacePanes(getState, setState, workspaceId);
  }, INACTIVE_WORKSPACE_SUSPEND_MS);
  workspaceSuspendTimers.set(workspaceId, timer);
}

async function resumeWorkspacePanes(
  getState: () => WorkspaceStore,
  setState: WorkspaceSetState,
  workspaceId: string,
): Promise<void> {
  clearSuspendTimer(workspaceId);

  const state = getState();
  const workspace = state.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) {
    return;
  }

  const suspendedPaneIds = workspace.paneOrder.filter((paneId) => workspace.panes[paneId]?.status === "suspended");
  if (suspendedPaneIds.length === 0) {
    return;
  }

  const resumedPaneIds = await Promise.all(
    suspendedPaneIds.map(async (paneId) => {
      const runtimePaneId = toRuntimePaneId(workspaceId, paneId);
      try {
        await resumePane(runtimePaneId);
        return paneId;
      } catch {
        return null;
      }
    }),
  );
  const resumed = new Set(resumedPaneIds.filter(Boolean) as string[]);
  if (resumed.size === 0) {
    return;
  }

  setState((current) => ({
    workspaces: withWorkspaceUpdated(current.workspaces, workspaceId, (target) => {
      const panes: Record<string, PaneModel> = { ...target.panes };
      resumed.forEach((paneId) => {
        const pane = panes[paneId];
        if (!pane) {
          return;
        }
        panes[paneId] = {
          ...pane,
          status: "running",
          error: undefined,
        };
      });

      return {
        ...target,
        panes,
        updatedAt: new Date().toISOString(),
      };
    }),
  }));
  enqueuePersist(getState);
}

function buildLaunchPlan(
  paneOrder: string[],
  agentAllocation: AgentAllocation[],
): Map<string, { title: string; command: string }> {
  const launches: Array<{ title: string; command: string }> = [];
  agentAllocation.forEach((agent) => {
    if (!agent.enabled || agent.count <= 0 || !agent.command.trim()) {
      return;
    }
    for (let i = 0; i < agent.count; i += 1) {
      launches.push({
        title: agent.label,
        command: agent.command.trim(),
      });
    }
  });

  const plan = new Map<string, { title: string; command: string }>();
  paneOrder.forEach((paneId, index) => {
    const launch = launches[index];
    if (launch) {
      plan.set(paneId, launch);
    }
  });
  return plan;
}

function applyLaunchTitles(
  workspace: WorkspaceRuntime,
  launchPlan: Map<string, { title: string; command: string }>,
): WorkspaceRuntime {
  const nextPanes: Record<string, PaneModel> = {};
  workspace.paneOrder.forEach((paneId) => {
    const pane = workspace.panes[paneId] ?? createPaneModel({
      id: paneId,
      worktreePath: workspace.worktreePath,
    });
    const launch = launchPlan.get(paneId);
    nextPanes[paneId] = {
      ...pane,
      title: launch?.title ?? paneId,
    };
  });

  return {
    ...workspace,
    panes: nextPanes,
    updatedAt: new Date().toISOString(),
  };
}

function collectEligibleLaunchPaneIds(workspace: WorkspaceRuntime): string[] {
  const launchPlan = buildLaunchPlan(workspace.paneOrder, workspace.agentAllocation);
  return workspace.paneOrder.filter((paneId) => {
    if (!launchPlan.has(paneId)) {
      return false;
    }
    const status = workspace.panes[paneId]?.status;
    return status !== "running" && status !== "suspended";
  });
}

async function spawnWorkspacePanes(
  getState: () => WorkspaceStore,
  workspaceId: string,
  withAgentInit: boolean,
): Promise<void> {
  const workspace = getState().workspaces.find((item) => item.id === workspaceId);
  if (!workspace) {
    return;
  }

  const launchPlan = withAgentInit ? buildLaunchPlan(workspace.paneOrder, workspace.agentAllocation) : undefined;
  const initialStatuses = new Map(
    workspace.paneOrder.map((paneId) => [paneId, workspace.panes[paneId]?.status ?? "idle"]),
  );

  await withConcurrency(workspace.paneOrder, SPAWN_CONCURRENCY_LIMIT, async (paneId) => {
    const latest = getState();
    const latestWorkspace = latest.workspaces.find((item) => item.id === workspaceId);
    if (!latestWorkspace) {
      return;
    }

    const launch = launchPlan?.get(paneId);
    const initialStatus = initialStatuses.get(paneId);
    const shouldInit = Boolean(
      launch && initialStatus !== "running" && initialStatus !== "suspended",
    );

    await latest.ensurePaneSpawned(
      workspaceId,
      paneId,
      shouldInit
        ? {
            initCommand: launch?.command,
            executeInit: true,
          }
        : undefined,
    );
  });
}

interface AgentBootTask {
  paneId: string;
  command: string;
}

async function runWorkspaceBootQueue(
  getState: () => WorkspaceStore,
  setState: WorkspaceSetState,
  workspaceId: string,
  options?: WorkspaceBootOptions,
): Promise<void> {
  const workspace = getState().workspaces.find((item) => item.id === workspaceId);
  if (!workspace) {
    removeWorkspaceBootSession(setState, workspaceId);
    return;
  }

  const launchPlan = buildLaunchPlan(workspace.paneOrder, workspace.agentAllocation);
  const eligiblePaneIds = options?.eligiblePaneIds ? new Set(options.eligiblePaneIds) : null;
  const tasks: AgentBootTask[] = workspace.paneOrder
    .map((paneId) => {
      if (eligiblePaneIds && !eligiblePaneIds.has(paneId)) {
        return null;
      }
      const launch = launchPlan.get(paneId);
      if (!launch) {
        return null;
      }
      return {
        paneId,
        command: launch.command,
      };
    })
    .filter((task): task is AgentBootTask => Boolean(task));

  setWorkspaceBootSession(setState, createBootSession(workspaceId, tasks.length));

  if (tasks.length === 0) {
    updateWorkspaceBootSession(setState, workspaceId, (session) => ({
      ...session,
      status: "completed",
      queued: 0,
      updatedAt: new Date().toISOString(),
    }));
    return;
  }

  const controller = getBootController(workspaceId);
  controller.canceled = false;
  controller.paused = false;
  controller.maxParallel = AGENT_BOOT_PARALLELISM;
  controller.pressureStrikeCount = 0;

  let nextIndex = 0;
  let completed = 0;
  let failed = 0;
  const inFlight = new Set<Promise<void>>();

  const refreshSession = (statusOverride?: WorkspaceBootSession["status"]): void => {
    updateWorkspaceBootSession(setState, workspaceId, (session) => ({
      ...session,
      status: statusOverride ?? (controller.paused ? "paused" : "running"),
      queued: Math.max(0, tasks.length - nextIndex),
      running: inFlight.size,
      completed,
      failed,
      updatedAt: new Date().toISOString(),
    }));
  };

  const startTask = (task: AgentBootTask): Promise<void> => {
    const taskPromise = (async () => {
      await waitForBootResume(controller);
      if (controller.canceled) {
        return;
      }

      const startedAt = Date.now();
      let success = false;
      let lastError: unknown = null;

      for (let attempt = 0; attempt <= AGENT_BOOT_RETRY_LIMIT; attempt += 1) {
        try {
          await getState().ensurePaneSpawned(workspaceId, task.paneId);
          await waitForPaneTerminalReady(getState, workspaceId, task.paneId);
          await writePaneInput({
            paneId: toRuntimePaneId(workspaceId, task.paneId),
            data: task.command,
            execute: true,
          });
          success = true;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < AGENT_BOOT_RETRY_LIMIT) {
            await sleep(AGENT_BOOT_RETRY_BACKOFF_MS * (attempt + 1));
          }
        }
      }

      const elapsedMs = Date.now() - startedAt;
      if (!success || elapsedMs >= 5000) {
        controller.pressureStrikeCount += 1;
      } else {
        controller.pressureStrikeCount = 0;
      }

      if (controller.pressureStrikeCount >= 3) {
        controller.maxParallel = 2;
      }

      if (success) {
        completed += 1;
        setState((state) => ({
          workspaces: withWorkspaceUpdated(state.workspaces, workspaceId, (target) => {
            const pane = target.panes[task.paneId];
            if (!pane) {
              return target;
            }
            return {
              ...target,
              panes: {
                ...target.panes,
                [task.paneId]: {
                  ...pane,
                  status: "running",
                  lastSubmittedCommand: task.command,
                  error: undefined,
                },
              },
            };
          }),
        }));
        return;
      }

      failed += 1;
      if (lastError) {
        setState((state) => ({
          workspaces: withWorkspaceUpdated(state.workspaces, workspaceId, (target) => {
            const pane = target.panes[task.paneId];
            if (!pane) {
              return target;
            }
            return {
              ...target,
              panes: {
                ...target.panes,
                [task.paneId]: {
                  ...pane,
                  status: "error",
                  error: String(lastError),
                },
              },
            };
          }),
        }));
      }
    })().finally(() => {
      inFlight.delete(taskPromise);
      refreshSession();
    });

    inFlight.add(taskPromise);
    refreshSession();
    return taskPromise;
  };

  refreshSession("running");

  while ((nextIndex < tasks.length || inFlight.size > 0) && !controller.canceled) {
    await waitForBootResume(controller);
    if (controller.canceled) {
      break;
    }

    while (
      !controller.canceled
      && !controller.paused
      && nextIndex < tasks.length
      && inFlight.size < controller.maxParallel
    ) {
      const task = tasks[nextIndex];
      nextIndex += 1;
      refreshSession();
      startTask(task);

      if (nextIndex < tasks.length) {
        await sleep(AGENT_BOOT_STAGGER_MS);
      }
    }

    if (inFlight.size > 0) {
      await Promise.race(Array.from(inFlight));
    }
  }

  refreshSession(controller.canceled ? "canceled" : failed > 0 ? "failed" : "completed");
  workspaceBootControllers.delete(workspaceId);
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  initialized: false,
  bootstrapping: false,
  startupError: null,
  activeSection: "terminal",
  paletteOpen: false,
  echoInput: false,
  themeId: DEFAULT_THEME_ID,
  reduceMotion: false,
  highContrastAssist: false,
  density: "comfortable",
  agentStartupDefaults: defaultAgentStartupDefaults(),
  discordPresenceEnabled: false,
  workspaces: [],
  activeWorkspaceId: null,
  focusedPaneByWorkspace: {},
  focusRequestByWorkspace: {},
  terminalReadyPanesByWorkspace: {},
  workspaceBootSessions: {},
  snapshots: [],
  blueprints: [],
  worktreeManager: defaultWorktreeManagerState(),

  bootstrap: async () => {
    const current = get();
    if (current.initialized || current.bootstrapping) {
      return;
    }

    clearAllPendingPaneInit();
    clearAllSuspendTimers();
    clearAllWorkspaceBoot(set);
    paneTerminalReadyWaiters.clear();

    set({
      bootstrapping: true,
      startupError: null,
    });

    try {
      const persisted = await loadPersistedPayload();
      const persistedSession = persisted.session;

      let session: SessionState | null = null;
      if (persistedSession) {
        session = isLegacySessionState(persistedSession)
          ? migrateLegacySession(persistedSession)
          : sanitizeSession(persistedSession);
      }

      if (!session || session.workspaces.length === 0) {
        const agentStartupDefaults = defaultAgentStartupDefaults();
        const cwd = await getDefaultCwd();
        const context = await resolveRepoContextSafe(cwd);

        const workspace = createWorkspaceRuntime({
          id: "workspace-main",
          name: "Workspace 1",
          directory: context.worktreePath,
          repoRoot: context.repoRoot,
          worktreePath: context.worktreePath,
          branch: context.branch,
          paneCount: 1,
          agentStartupDefaults,
        });

        session = {
          workspaces: [workspace],
          activeWorkspaceId: workspace.id,
          activeSection: "terminal",
          echoInput: false,
          discordPresenceEnabled: false,
          uiPreferences: defaultUiPreferences(),
          agentStartupDefaults,
        };
      }

      set({
        activeSection: session.activeSection,
        echoInput: session.echoInput,
        discordPresenceEnabled: sanitizeDiscordPresenceEnabled(session.discordPresenceEnabled),
        themeId: session.uiPreferences.theme,
        reduceMotion: session.uiPreferences.reduceMotion,
        highContrastAssist: session.uiPreferences.highContrastAssist,
        density: session.uiPreferences.density,
        agentStartupDefaults: sanitizeAgentStartupDefaults(session.agentStartupDefaults),
        workspaces: session.workspaces,
        activeWorkspaceId: session.activeWorkspaceId,
        focusedPaneByWorkspace: buildFocusedPaneMap(session.workspaces),
        focusRequestByWorkspace: buildFocusRequestMap(session.workspaces),
        terminalReadyPanesByWorkspace: {},
        snapshots: persisted.snapshots,
        blueprints: persisted.blueprints,
        worktreeManager: defaultWorktreeManagerState(),
        initialized: true,
        bootstrapping: false,
        startupError: null,
      });
      void applyDiscordPresenceEnabled(sanitizeDiscordPresenceEnabled(session.discordPresenceEnabled));
      enqueueAutomationSync(get);

      const activeWorkspace = activeWorkspaceOf(get());
      if (activeWorkspace) {
        clearSuspendTimer(activeWorkspace.id);
        await spawnWorkspacePanes(get, activeWorkspace.id, false);
        get().resumeWorkspaceBoot(activeWorkspace.id);
        void get().startWorkspaceBoot(activeWorkspace.id, {
          eligiblePaneIds: collectEligibleLaunchPaneIds(activeWorkspace),
        });
        void get().refreshWorktrees();
      }

      await flushPersist(get);
    } catch (error) {
      set({
        initialized: false,
        bootstrapping: false,
        startupError: formatStartupError(error),
      });
    }
  },

  clearStartupError: () => {
    set({ startupError: null });
  },

  resetLocalStateAndRebootstrap: async () => {
    clearAllPendingPaneInit();
    clearAllSuspendTimers();
    clearAllWorkspaceBoot(set);
    spawnInFlight.clear();
    paneTerminalReadyWaiters.clear();
    paneInputBuffers.clear();
    paneInputFlushes.clear();
    paneInputTimers.forEach((timer) => clearTimeout(timer));
    paneInputTimers.clear();

    await resetPersistedPayload();
    set({
      initialized: false,
      bootstrapping: false,
      startupError: null,
      activeSection: "terminal",
      paletteOpen: false,
      echoInput: false,
      themeId: DEFAULT_THEME_ID,
      reduceMotion: false,
      highContrastAssist: false,
      density: "comfortable",
      agentStartupDefaults: defaultAgentStartupDefaults(),
      discordPresenceEnabled: false,
      workspaces: [],
      activeWorkspaceId: null,
      focusedPaneByWorkspace: {},
      focusRequestByWorkspace: {},
      terminalReadyPanesByWorkspace: {},
      workspaceBootSessions: {},
      snapshots: [],
      blueprints: [],
      worktreeManager: defaultWorktreeManagerState(),
    });

    await get().bootstrap();
  },

  setActiveSection: (section: AppSection) => {
    set({ activeSection: section });
    enqueuePersist(get);
  },

  setPaletteOpen: (open: boolean) => {
    set({ paletteOpen: open });
  },

  setEchoInput: (enabled: boolean) => {
    set({ echoInput: enabled });
    enqueuePersist(get);
  },

  setTheme: (themeId: ThemeId) => {
    set({ themeId });
    enqueuePersist(get);
  },

  setReduceMotion: (enabled: boolean) => {
    set({ reduceMotion: enabled });
    enqueuePersist(get);
  },

  setHighContrastAssist: (enabled: boolean) => {
    set({ highContrastAssist: enabled });
    enqueuePersist(get);
  },

  setDensity: (density: DensityMode) => {
    set({ density });
    enqueuePersist(get);
  },

  setDiscordPresenceEnabled: (enabled: boolean) => {
    set({ discordPresenceEnabled: enabled });
    enqueuePersist(get);
    void applyDiscordPresenceEnabled(enabled);
  },

  setAgentStartupDefault: (profile: AgentProfileKey, command: string) => {
    const trimmed = command.trim();
    set((state) => ({
      agentStartupDefaults: {
        ...state.agentStartupDefaults,
        [profile]: trimmed.length > 0 ? trimmed : AGENT_PROFILE_DEFAULTS[profile],
      },
    }));
    enqueuePersist(get);
  },

  resetAgentStartupDefaults: () => {
    set({ agentStartupDefaults: defaultAgentStartupDefaults() });
    enqueuePersist(get);
  },

  createWorkspace: async (input: CreateWorkspaceInput) => {
    const directory = input.directory.trim() || (await getDefaultCwd());
    const context = await resolveRepoContextSafe(directory);

    const workspaceId = `workspace-${crypto.randomUUID()}`;
    const name = input.name?.trim() || `Workspace ${get().workspaces.length + 1}`;
    const previousActiveId = get().activeWorkspaceId;

    let nextWorkspace = createWorkspaceRuntime({
      id: workspaceId,
      name,
      directory: context.worktreePath,
      repoRoot: context.repoRoot,
      worktreePath: context.worktreePath,
      branch: context.branch,
      paneCount: input.paneCount,
      agentAllocation: input.agentAllocation,
      agentStartupDefaults: get().agentStartupDefaults,
    });

    const launchPlan = buildLaunchPlan(nextWorkspace.paneOrder, nextWorkspace.agentAllocation);
    nextWorkspace = applyLaunchTitles(nextWorkspace, launchPlan);

    set((state) => ({
      activeSection: "terminal",
      workspaces: [...state.workspaces, nextWorkspace],
      activeWorkspaceId: nextWorkspace.id,
      focusedPaneByWorkspace: {
        ...state.focusedPaneByWorkspace,
        [nextWorkspace.id]: resolveFocusedPaneId(nextWorkspace),
      },
      focusRequestByWorkspace: {
        ...state.focusRequestByWorkspace,
        [nextWorkspace.id]: resolveFocusedPaneId(nextWorkspace),
      },
    }));
    enqueueAutomationSync(get);

    clearSuspendTimer(nextWorkspace.id);
    if (previousActiveId && previousActiveId !== nextWorkspace.id) {
      get().pauseWorkspaceBoot(previousActiveId);
      scheduleWorkspaceSuspend(get, set, previousActiveId);
    }

    void (async () => {
      await resumeWorkspacePanes(get, set, nextWorkspace.id);
      await spawnWorkspacePanes(get, nextWorkspace.id, false);
      await get().startWorkspaceBoot(nextWorkspace.id, {
        eligiblePaneIds: collectEligibleLaunchPaneIds(nextWorkspace),
      });
      await get().refreshWorktrees();
    })();

    await flushPersist(get);
  },

  closeWorkspace: async (workspaceId: string) => {
    const state = get();
    if (state.workspaces.length <= 1) {
      return;
    }

    const workspace = state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      return;
    }

    const closingActive = workspaceId === state.activeWorkspaceId;
    clearSuspendTimer(workspaceId);
    get().cancelWorkspaceBoot(workspaceId);
    await closeRunningPanes(workspace);
    clearPendingPaneInitForWorkspace(workspaceId);
    clearWorkspacePaneInputBuffers(workspaceId);
    clearPaneTerminalReadyWaitersForWorkspace(workspaceId);

    const remaining = state.workspaces.filter((item) => item.id !== workspaceId);
    const nextActiveId = closingActive ? remaining[0]?.id ?? null : state.activeWorkspaceId;
    const nextActiveWorkspaceSnapshot = nextActiveId
      ? remaining.find((workspace) => workspace.id === nextActiveId)
      : undefined;

    set((current) => {
      const focusedPaneByWorkspace = Object.fromEntries(
        Object.entries(current.focusedPaneByWorkspace).filter(([workspaceKey]) => workspaceKey !== workspaceId),
      );
      const focusRequestByWorkspace = Object.fromEntries(
        Object.entries(current.focusRequestByWorkspace).filter(([workspaceKey]) => workspaceKey !== workspaceId),
      );
      if (nextActiveWorkspaceSnapshot && nextActiveId) {
        focusedPaneByWorkspace[nextActiveId] = resolveFocusedPaneId(
          nextActiveWorkspaceSnapshot,
          focusedPaneByWorkspace[nextActiveId],
        );
        focusRequestByWorkspace[nextActiveId] = resolveFocusedPaneId(
          nextActiveWorkspaceSnapshot,
          focusRequestByWorkspace[nextActiveId],
        );
      }

      return {
        workspaces: remaining,
        activeWorkspaceId: nextActiveId,
        focusedPaneByWorkspace,
        focusRequestByWorkspace,
        terminalReadyPanesByWorkspace: Object.fromEntries(
          Object.entries(current.terminalReadyPanesByWorkspace).filter(([workspaceKey]) => workspaceKey !== workspaceId),
        ),
      };
    });
    enqueueAutomationSync(get);

    if (closingActive && nextActiveId) {
      clearSuspendTimer(nextActiveId);
      await resumeWorkspacePanes(get, set, nextActiveId);
      await spawnWorkspacePanes(get, nextActiveId, false);
      get().resumeWorkspaceBoot(nextActiveId);
      void get().startWorkspaceBoot(nextActiveId, {
        eligiblePaneIds: nextActiveWorkspaceSnapshot
          ? collectEligibleLaunchPaneIds(nextActiveWorkspaceSnapshot)
          : undefined,
      });
      await get().refreshWorktrees();
    }

    await flushPersist(get);
  },

  setActiveWorkspace: async (workspaceId: string) => {
    const state = get();
    if (state.activeWorkspaceId === workspaceId) {
      const target = state.workspaces.find((workspace) => workspace.id === workspaceId);
      if (target) {
        set((current) => ({
          focusedPaneByWorkspace: {
            ...current.focusedPaneByWorkspace,
            [workspaceId]: resolveFocusedPaneId(target, current.focusedPaneByWorkspace[workspaceId]),
          },
          focusRequestByWorkspace: {
            ...current.focusRequestByWorkspace,
            [workspaceId]: resolveFocusedPaneId(target, current.focusRequestByWorkspace[workspaceId]),
          },
        }));
      }
      clearSuspendTimer(workspaceId);
      get().resumeWorkspaceBoot(workspaceId);
      void get().refreshWorktrees();
      return;
    }

    const target = state.workspaces.find((workspace) => workspace.id === workspaceId);
    if (!target) {
      return;
    }

    const previousActiveId = state.activeWorkspaceId;
    set((current) => ({
      activeWorkspaceId: workspaceId,
      activeSection: "terminal",
      focusedPaneByWorkspace: {
        ...current.focusedPaneByWorkspace,
        [workspaceId]: resolveFocusedPaneId(target, current.focusedPaneByWorkspace[workspaceId]),
      },
      focusRequestByWorkspace: {
        ...current.focusRequestByWorkspace,
        [workspaceId]: resolveFocusedPaneId(target, current.focusRequestByWorkspace[workspaceId]),
      },
    }));

    clearSuspendTimer(workspaceId);
    await resumeWorkspacePanes(get, set, workspaceId);
    await spawnWorkspacePanes(get, target.id, false);
    get().resumeWorkspaceBoot(target.id);
    void get().startWorkspaceBoot(target.id, {
      eligiblePaneIds: collectEligibleLaunchPaneIds(target),
    });

    if (previousActiveId && previousActiveId !== workspaceId) {
      get().pauseWorkspaceBoot(previousActiveId);
      scheduleWorkspaceSuspend(get, set, previousActiveId);
    }

    await get().refreshWorktrees();
    await flushPersist(get);
  },

  setActiveWorkspacePaneCount: async (requestedCount: number) => {
    const state = get();
    const activeWorkspace = activeWorkspaceOf(state);
    if (!activeWorkspace) {
      return;
    }

    const paneCount = clampPaneCount(requestedCount);
    if (paneCount === activeWorkspace.paneCount) {
      return;
    }

    const nextPaneOrder = Array.from({ length: paneCount }, (_, index) => paneIdAt(index));
    const nextPanes: Record<string, PaneModel> = { ...activeWorkspace.panes };

    nextPaneOrder.forEach((paneId) => {
      if (!nextPanes[paneId]) {
        nextPanes[paneId] = createPaneModel({
          id: paneId,
          worktreePath: activeWorkspace.worktreePath,
        });
      }
    });

    const removedPaneIds = activeWorkspace.paneOrder.filter((paneId) => !nextPaneOrder.includes(paneId));
    await Promise.all(
      removedPaneIds.map(async (paneId) => {
        const status = activeWorkspace.panes[paneId]?.status;
        if (status === "running" || status === "suspended" || status === "spawning") {
          try {
            await closePane(toRuntimePaneId(activeWorkspace.id, paneId));
          } catch {
            // best effort close while resizing pane count
          }
        }
      }),
    );

    removedPaneIds.forEach((paneId) => {
      delete nextPanes[paneId];
      clearPendingPaneInit(activeWorkspace.id, paneId);
      clearPaneTerminalReadyWaiters(activeWorkspace.id, paneId);
      const runtimePaneId = toRuntimePaneId(activeWorkspace.id, paneId);
      const timer = paneInputTimers.get(runtimePaneId);
      if (timer) {
        clearTimeout(timer);
      }
      paneInputTimers.delete(runtimePaneId);
      paneInputBuffers.delete(runtimePaneId);
      paneInputFlushes.delete(runtimePaneId);
    });

    set((current) => {
      const currentFocusedPane = current.focusedPaneByWorkspace[activeWorkspace.id];
      const previousIndex = activeWorkspace.paneOrder.indexOf(currentFocusedPane ?? "");
      const fallbackIndex = previousIndex >= 0
        ? Math.min(previousIndex, Math.max(0, nextPaneOrder.length - 1))
        : 0;
      const focusedPaneId = nextPaneOrder.includes(currentFocusedPane ?? "")
        ? currentFocusedPane
        : nextPaneOrder[fallbackIndex] ?? null;

      return {
        focusedPaneByWorkspace: {
          ...current.focusedPaneByWorkspace,
          [activeWorkspace.id]: focusedPaneId,
        },
        focusRequestByWorkspace: {
          ...current.focusRequestByWorkspace,
          [activeWorkspace.id]: focusedPaneId,
        },
        terminalReadyPanesByWorkspace: {
          ...current.terminalReadyPanesByWorkspace,
          [activeWorkspace.id]: Object.fromEntries(
            Object.entries(current.terminalReadyPanesByWorkspace[activeWorkspace.id] ?? {}).filter(
              ([paneId]) => nextPaneOrder.includes(paneId),
            ),
          ),
        },
        workspaces: withWorkspaceUpdated(current.workspaces, activeWorkspace.id, (workspace) => ({
          ...workspace,
          paneCount,
          paneOrder: nextPaneOrder,
          panes: nextPanes,
          layouts: resolveWorkspaceLayouts(nextPaneOrder, workspace.layoutMode, workspace.layouts),
          zoomedPaneId:
            workspace.zoomedPaneId && nextPaneOrder.includes(workspace.zoomedPaneId)
              ? workspace.zoomedPaneId
              : null,
          updatedAt: new Date().toISOString(),
        })),
      };
    });
    enqueueAutomationSync(get);

    const workspaceAfterResize = activeWorkspaceOf(get());
    const eligiblePaneIds = workspaceAfterResize
      ? collectEligibleLaunchPaneIds(workspaceAfterResize)
      : undefined;

    await spawnWorkspacePanes(get, activeWorkspace.id, false);
    void get().startWorkspaceBoot(activeWorkspace.id, { eligiblePaneIds });

    await flushPersist(get);
  },

  addPaneToActiveWorkspaceAndFocus: async () => {
    const state = get();
    const activeWorkspace = activeWorkspaceOf(state);
    if (!activeWorkspace || activeWorkspace.paneCount >= MAX_PANES) {
      return;
    }

    const newPaneId = paneIdAt(activeWorkspace.paneCount);
    await get().setActiveWorkspacePaneCount(activeWorkspace.paneCount + 1);
    get().setFocusedPane(activeWorkspace.id, newPaneId);
  },

  createPaneWithWorktree: async (workspaceId: string, worktreePath: string) => {
    const normalizedPath = worktreePath.trim();
    if (normalizedPath.length === 0) {
      throw new Error("Worktree path is required.");
    }

    const state = get();
    const workspace = state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found.");
    }

    if (workspace.paneCount >= MAX_PANES) {
      throw new Error(`Cannot create more than ${MAX_PANES} panes in one workspace.`);
    }

    const paneId = paneIdAt(workspace.paneCount);
    const nextPaneOrder = [...workspace.paneOrder, paneId];

    set((current) => ({
      focusedPaneByWorkspace: {
        ...current.focusedPaneByWorkspace,
        [workspaceId]: paneId,
      },
      focusRequestByWorkspace: {
        ...current.focusRequestByWorkspace,
        [workspaceId]: paneId,
      },
      workspaces: withWorkspaceUpdated(current.workspaces, workspaceId, (target) => ({
        ...target,
        paneCount: nextPaneOrder.length,
        paneOrder: nextPaneOrder,
        panes: {
          ...target.panes,
          [paneId]: createPaneModel({
            id: paneId,
            worktreePath: normalizedPath,
            cwd: normalizedPath,
          }),
        },
        layouts: resolveWorkspaceLayouts(nextPaneOrder, target.layoutMode, target.layouts),
        updatedAt: new Date().toISOString(),
      })),
    }));
    enqueueAutomationSync(get);

    if (get().activeWorkspaceId === workspaceId) {
      await get().ensurePaneSpawned(workspaceId, paneId);
    }

    await flushPersist(get);
    return paneId;
  },

  setPaneWorktree: async (
    workspaceId: string,
    paneId: string,
    worktreePath: string,
    options?: { restartRunning?: boolean },
  ) => {
    const normalizedPath = worktreePath.trim();
    if (normalizedPath.length === 0) {
      throw new Error("Worktree path is required.");
    }

    const state = get();
    const workspace = state.workspaces.find((item) => item.id === workspaceId);
    const pane = workspace?.panes[paneId];
    if (!workspace || !pane) {
      throw new Error("Pane not found.");
    }

    const shouldRestart = Boolean(
      options?.restartRunning
      && (pane.status === "running" || pane.status === "suspended" || pane.status === "spawning"),
    );

    set((current) => {
      const workspaceReady = current.terminalReadyPanesByWorkspace[workspaceId] ?? {};
      const nextWorkspaceReady = { ...workspaceReady };
      if (shouldRestart) {
        delete nextWorkspaceReady[paneId];
      }

      const nextReadyByWorkspace = { ...current.terminalReadyPanesByWorkspace };
      if (Object.keys(nextWorkspaceReady).length === 0) {
        delete nextReadyByWorkspace[workspaceId];
      } else {
        nextReadyByWorkspace[workspaceId] = nextWorkspaceReady;
      }

      return {
        terminalReadyPanesByWorkspace: nextReadyByWorkspace,
        workspaces: withWorkspaceUpdated(current.workspaces, workspaceId, (target) => {
          const targetPane = target.panes[paneId];
          if (!targetPane) {
            return target;
          }
          return {
            ...target,
            panes: {
              ...target.panes,
              [paneId]: {
                ...targetPane,
                worktreePath: normalizedPath,
                cwd:
                  targetPane.status === "running"
                  || targetPane.status === "suspended"
                  || targetPane.status === "spawning"
                    ? targetPane.cwd
                    : normalizedPath,
              },
            },
            updatedAt: new Date().toISOString(),
          };
        }),
      };
    });

    if (!shouldRestart) {
      await flushPersist(get);
      return;
    }

    clearPendingPaneInit(workspaceId, paneId);
    clearPaneTerminalReadyWaiters(workspaceId, paneId);
    clearPaneInputBuffers(workspaceId, paneId);

    try {
      await closePane(toRuntimePaneId(workspaceId, paneId));
    } catch {
      // best effort close before respawn in new worktree
    }

    set((current) => ({
      workspaces: withWorkspaceUpdated(current.workspaces, workspaceId, (target) => {
        const targetPane = target.panes[paneId];
        if (!targetPane) {
          return target;
        }
        return {
          ...target,
          panes: {
            ...target.panes,
            [paneId]: {
              ...targetPane,
              cwd: normalizedPath,
              status: "idle",
              error: undefined,
            },
          },
          updatedAt: new Date().toISOString(),
        };
      }),
    }));

    if (get().activeWorkspaceId === workspaceId) {
      await get().ensurePaneSpawned(workspaceId, paneId);
    }

    await flushPersist(get);
  },

  startWorkspaceBoot: async (workspaceId: string, options?: WorkspaceBootOptions) => {
    const inFlight = workspaceBootInFlight.get(workspaceId);
    if (inFlight) {
      return inFlight;
    }

    const task = runWorkspaceBootQueue(get, set, workspaceId, options)
      .catch(() => {
        updateWorkspaceBootSession(set, workspaceId, (session) => ({
          ...session,
          status: "failed",
          running: 0,
          queued: 0,
          updatedAt: new Date().toISOString(),
        }));
      })
      .finally(() => {
        workspaceBootInFlight.delete(workspaceId);
      });

    workspaceBootInFlight.set(workspaceId, task);
    return task;
  },

  pauseWorkspaceBoot: (workspaceId: string) => {
    const controller = workspaceBootControllers.get(workspaceId);
    if (!controller || controller.canceled) {
      return;
    }
    controller.paused = true;
    updateWorkspaceBootSession(set, workspaceId, (session) => ({
      ...session,
      status: "paused",
      updatedAt: new Date().toISOString(),
    }));
  },

  resumeWorkspaceBoot: (workspaceId: string) => {
    const controller = workspaceBootControllers.get(workspaceId);
    if (!controller || controller.canceled) {
      return;
    }
    controller.paused = false;
    wakeBootController(controller);
    updateWorkspaceBootSession(set, workspaceId, (session) => ({
      ...session,
      status: "running",
      updatedAt: new Date().toISOString(),
    }));
  },

  cancelWorkspaceBoot: (workspaceId: string) => {
    const controller = workspaceBootControllers.get(workspaceId);
    if (controller) {
      controller.canceled = true;
      controller.paused = false;
      wakeBootController(controller);
      workspaceBootControllers.delete(workspaceId);
    }
    workspaceBootInFlight.delete(workspaceId);
    removeWorkspaceBootSession(set, workspaceId);
  },

  markPaneTerminalReady: (workspaceId: string, paneId: string) => {
    set((state) => ({
      terminalReadyPanesByWorkspace: {
        ...state.terminalReadyPanesByWorkspace,
        [workspaceId]: {
          ...(state.terminalReadyPanesByWorkspace[workspaceId] ?? {}),
          [paneId]: true,
        },
      },
    }));
    wakePaneTerminalReadyWaiters(workspaceId, paneId);
    void flushPendingPaneInit(get, workspaceId, paneId);
  },

  markPaneTerminalNotReady: (workspaceId: string, paneId: string) => {
    clearPaneTerminalReadyWaiters(workspaceId, paneId);
    set((state) => {
      const workspaceReadyPanes = state.terminalReadyPanesByWorkspace[workspaceId];
      if (!workspaceReadyPanes?.[paneId]) {
        return {};
      }

      const nextWorkspaceReadyPanes = { ...workspaceReadyPanes };
      delete nextWorkspaceReadyPanes[paneId];

      const nextReadyByWorkspace = { ...state.terminalReadyPanesByWorkspace };
      if (Object.keys(nextWorkspaceReadyPanes).length === 0) {
        delete nextReadyByWorkspace[workspaceId];
      } else {
        nextReadyByWorkspace[workspaceId] = nextWorkspaceReadyPanes;
      }

      return {
        terminalReadyPanesByWorkspace: nextReadyByWorkspace,
      };
    });
  },

  ensurePaneSpawned: async (workspaceId: string, paneId: string, options?: PaneSpawnOptions) => {
    const state = get();
    if (state.activeWorkspaceId !== workspaceId) {
      return;
    }

    const workspace = state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      return;
    }

    const pane = workspace.panes[paneId];
    if (!pane) {
      return;
    }

    queuePendingPaneInit(workspaceId, paneId, options);
    if (pane.status === "running") {
      await flushPendingPaneInit(get, workspaceId, paneId);
      return;
    }
    if (pane.status === "suspended") {
      try {
        await resumePane(toRuntimePaneId(workspaceId, paneId));
        set((current) => ({
          workspaces: withWorkspaceUpdated(current.workspaces, workspaceId, (target) => {
            const currentPane = target.panes[paneId];
            if (!currentPane) {
              return target;
            }
            return {
              ...target,
              panes: {
                ...target.panes,
                [paneId]: {
                  ...currentPane,
                  status: "running",
                  error: undefined,
                },
              },
            };
          }),
        }));
        await flushPendingPaneInit(get, workspaceId, paneId);
        return;
      } catch {
        // fall back to respawn path below
      }
    }

    const key = paneRuntimeKey(workspaceId, paneId);
    const inFlight = spawnInFlight.get(key);
    if (inFlight) {
      await inFlight;
      await flushPendingPaneInit(get, workspaceId, paneId);
      return;
    }

    const spawnTask = (async () => {
      const latest = get();
      if (latest.activeWorkspaceId !== workspaceId) {
        return;
      }

      const targetWorkspace = latest.workspaces.find((item) => item.id === workspaceId);
      if (!targetWorkspace) {
        return;
      }

      const targetPane = targetWorkspace.panes[paneId];
      if (!targetPane) {
        return;
      }

      if (targetPane.status === "running") {
        await flushPendingPaneInit(get, workspaceId, paneId);
        return;
      }

      set((current) => ({
        workspaces: withWorkspaceUpdated(current.workspaces, workspaceId, (target) => {
          const currentPane = target.panes[paneId];
          if (!currentPane) {
            return target;
          }
          return {
            ...target,
            panes: {
              ...target.panes,
              [paneId]: {
                ...currentPane,
                status: "spawning",
                error: undefined,
              },
            },
          };
        }),
      }));

      try {
        const response = await withSpawnSlot(async () =>
          spawnPaneWithConflictRetry(
            toRuntimePaneId(workspaceId, paneId),
            targetPane.worktreePath || targetWorkspace.worktreePath,
          ),
        );

        set((current) => ({
          workspaces: withWorkspaceUpdated(current.workspaces, workspaceId, (target) => {
            const currentPane = target.panes[paneId];
            if (!currentPane) {
              return target;
            }
            return {
              ...target,
              panes: {
                ...target.panes,
                [paneId]: {
                  ...currentPane,
                  cwd: response.cwd,
                  shell: response.shell,
                  status: "running",
                  error: undefined,
                },
              },
            };
          }),
        }));

        await flushPendingPaneInit(get, workspaceId, paneId);
      } catch (error) {
        set((current) => ({
          workspaces: withWorkspaceUpdated(current.workspaces, workspaceId, (target) => {
            const currentPane = target.panes[paneId];
            if (!currentPane) {
              return target;
            }
            return {
              ...target,
              panes: {
                ...target.panes,
                [paneId]: {
                  ...currentPane,
                  status: "error",
                  error: String(error),
                },
              },
            };
          }),
        }));
      }
    })();

    spawnInFlight.set(key, spawnTask);
    try {
      await spawnTask;
    } finally {
      spawnInFlight.delete(key);
    }
    enqueueAutomationSync(get);
  },

  markPaneExited: (workspaceId: string, paneId: string, error?: string) => {
    clearPaneTerminalReadyWaiters(workspaceId, paneId);
    set((state) => ({
      terminalReadyPanesByWorkspace: {
        ...state.terminalReadyPanesByWorkspace,
        [workspaceId]: Object.fromEntries(
          Object.entries(state.terminalReadyPanesByWorkspace[workspaceId] ?? {}).filter(
            ([readyPaneId]) => readyPaneId !== paneId,
          ),
        ),
      },
      workspaces: withWorkspaceUpdated(state.workspaces, workspaceId, (workspace) => {
        const pane = workspace.panes[paneId];
        if (!pane) {
          return workspace;
        }
        return {
          ...workspace,
          panes: {
            ...workspace.panes,
            [paneId]: {
              ...pane,
              status: "closed",
              error,
            },
          },
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    enqueueAutomationSync(get);
    enqueuePersist(get);
  },

  updatePaneLastCommand: (workspaceId: string, paneId: string, command: string) => {
    set((state) => ({
      workspaces: withWorkspaceUpdated(state.workspaces, workspaceId, (workspace) => {
        const pane = workspace.panes[paneId];
        if (!pane) {
          return workspace;
        }
        return {
          ...workspace,
          panes: {
            ...workspace.panes,
            [paneId]: {
              ...pane,
              lastSubmittedCommand: command,
            },
          },
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    enqueuePersist(get);
  },

  sendInputFromPane: async (workspaceId: string, sourcePaneId: string, data: string) => {
    const state = get();
    if (workspaceId !== state.activeWorkspaceId) {
      return;
    }

    const workspace = activeWorkspaceOf(state);
    if (!workspace) {
      return;
    }

    const targetPaneIds = state.echoInput
      ? workspace.paneOrder.filter((paneId) => workspace.panes[paneId]?.status === "running")
      : [sourcePaneId];

    await Promise.all(
      targetPaneIds.map((paneId) =>
        queuePaneInput(toRuntimePaneId(workspaceId, paneId), data),
      ),
    );
  },

  setActiveWorkspaceLayoutMode: (mode: LayoutMode) => {
    const activeWorkspace = activeWorkspaceOf(get());
    if (!activeWorkspace || activeWorkspace.layoutMode === mode) {
      return;
    }

    set((state) => ({
      workspaces: withWorkspaceUpdated(state.workspaces, activeWorkspace.id, (workspace) => ({
        ...workspace,
        layoutMode: mode,
        layouts: resolveWorkspaceLayouts(workspace.paneOrder, mode, workspace.layouts),
        updatedAt: new Date().toISOString(),
      })),
    }));
    enqueuePersist(get);
  },

  setActiveWorkspaceLayouts: (layouts: Layout[]) => {
    const activeWorkspace = activeWorkspaceOf(get());
    if (!activeWorkspace || activeWorkspace.layoutMode !== "freeform") {
      return;
    }
    if (areLayoutsEquivalent(activeWorkspace.layouts, layouts)) {
      return;
    }

    set((state) => ({
      workspaces: withWorkspaceUpdated(state.workspaces, activeWorkspace.id, (workspace) => ({
        ...workspace,
        layouts,
        updatedAt: new Date().toISOString(),
      })),
    }));
    enqueuePersist(get);
  },

  toggleActiveWorkspaceZoom: (paneId: string) => {
    const activeWorkspace = activeWorkspaceOf(get());
    if (!activeWorkspace) {
      return;
    }

    set((state) => ({
      focusedPaneByWorkspace: {
        ...state.focusedPaneByWorkspace,
        [activeWorkspace.id]: paneId,
      },
      focusRequestByWorkspace: {
        ...state.focusRequestByWorkspace,
        [activeWorkspace.id]: paneId,
      },
      workspaces: withWorkspaceUpdated(state.workspaces, activeWorkspace.id, (workspace) => ({
        ...workspace,
        zoomedPaneId: workspace.zoomedPaneId === paneId ? null : paneId,
        updatedAt: new Date().toISOString(),
      })),
    }));
    enqueuePersist(get);
  },

  requestPaneTerminalFocus: (workspaceId: string, paneId: string) => {
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspace || !workspace.paneOrder.includes(paneId)) {
      return;
    }

    set((state) => ({
      focusRequestByWorkspace: {
        ...state.focusRequestByWorkspace,
        [workspaceId]: paneId,
      },
    }));
  },

  setFocusedPane: (workspaceId: string, paneId: string) => {
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspace || !workspace.paneOrder.includes(paneId)) {
      return;
    }

    set((state) => ({
      focusedPaneByWorkspace: {
        ...state.focusedPaneByWorkspace,
        [workspaceId]: paneId,
      },
      focusRequestByWorkspace: {
        ...state.focusRequestByWorkspace,
        [workspaceId]: paneId,
      },
    }));
  },

  moveFocusedPane: (workspaceId: string, direction: PaneMoveDirection) => {
    const state = get();
    const workspace = state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      return;
    }

    const focusedPaneId = resolveFocusedPaneId(workspace, state.focusedPaneByWorkspace[workspaceId]);
    if (!focusedPaneId) {
      return;
    }

    const nextPaneId = findDirectionalPaneTarget(workspace.paneOrder, workspace.layouts, focusedPaneId, direction);
    if (!nextPaneId || nextPaneId === focusedPaneId) {
      return;
    }

    set((current) => ({
      focusedPaneByWorkspace: {
        ...current.focusedPaneByWorkspace,
        [workspaceId]: nextPaneId,
      },
      focusRequestByWorkspace: {
        ...current.focusRequestByWorkspace,
        [workspaceId]: nextPaneId,
      },
    }));
  },

  resizeFocusedPaneByDelta: (workspaceId: string, dx: number, dy: number) => {
    if (dx === 0 && dy === 0) {
      return;
    }

    const state = get();
    const workspace = state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace || workspace.layoutMode !== "freeform") {
      return;
    }

    const focusedPaneId = resolveFocusedPaneId(workspace, state.focusedPaneByWorkspace[workspaceId]);
    if (!focusedPaneId) {
      return;
    }

    const targetLayout = workspace.layouts.find((layout) => layout.i === focusedPaneId);
    if (!targetLayout) {
      return;
    }

    const minW = targetLayout.minW ?? 1;
    const minH = targetLayout.minH ?? 1;
    const maxW = Math.min(targetLayout.maxW ?? GRID_COLS, Math.max(minW, GRID_COLS - targetLayout.x));
    const maxH = Math.max(minH, targetLayout.maxH ?? Number.MAX_SAFE_INTEGER);
    const nextW = Math.max(minW, Math.min(maxW, targetLayout.w + dx));
    const nextH = Math.max(minH, Math.min(maxH, targetLayout.h + dy));

    if (nextW === targetLayout.w && nextH === targetLayout.h) {
      return;
    }

    set((current) => ({
      workspaces: withWorkspaceUpdated(current.workspaces, workspaceId, (item) => ({
        ...item,
        layouts: item.layouts.map((layout) =>
          layout.i === focusedPaneId
            ? {
              ...layout,
              w: nextW,
              h: nextH,
            }
            : layout
        ),
        updatedAt: new Date().toISOString(),
      })),
    }));
    enqueuePersist(get);
  },

  runGlobalCommand: async (command: string, execute: boolean) => {
    const workspace = activeWorkspaceOf(get());
    if (!workspace || command.trim().length === 0) {
      return [];
    }

    const paneIds = workspace.paneOrder.filter((paneId) => workspace.panes[paneId]?.status === "running");
    if (paneIds.length === 0) {
      return [];
    }

    const runtimeToPane = new Map(paneIds.map((paneId) => [toRuntimePaneId(workspace.id, paneId), paneId]));
    const results = await runGlobalCommand({
      paneIds: Array.from(runtimeToPane.keys()),
      command,
      execute,
    });
    return results.map((result) => ({
      ...result,
      paneId: runtimeToPane.get(result.paneId) ?? result.paneId,
    }));
  },

  saveSnapshot: async (name: string) => {
    const state = get();
    const snapshot: Snapshot = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      state: serializeSessionState(state),
    };

    const snapshots = [snapshot, ...state.snapshots].slice(0, 25);
    set({ snapshots });
    await saveSnapshots(snapshots);
    await flushPersist(get);
  },

  restoreSnapshot: async (snapshotId: string) => {
    const state = get();
    const snapshot = state.snapshots.find((item) => item.id === snapshotId);
    if (!snapshot) {
      return;
    }

    const activeWorkspace = activeWorkspaceOf(state);
    if (activeWorkspace) {
      await closeRunningPanes(activeWorkspace);
    }
    clearAllPendingPaneInit();
    clearAllSuspendTimers();
    clearAllWorkspaceBoot(set);
    state.workspaces.forEach((workspace) => clearWorkspacePaneInputBuffers(workspace.id));

    const restored = sanitizeSession(snapshot.state);
    const discordPresenceEnabled = sanitizeDiscordPresenceEnabled(restored.discordPresenceEnabled);

    set({
      workspaces: restored.workspaces,
      activeWorkspaceId: restored.activeWorkspaceId,
      focusedPaneByWorkspace: buildFocusedPaneMap(restored.workspaces),
      focusRequestByWorkspace: buildFocusRequestMap(restored.workspaces),
      terminalReadyPanesByWorkspace: {},
      activeSection: restored.activeSection,
      echoInput: restored.echoInput,
      discordPresenceEnabled,
      themeId: restored.uiPreferences.theme,
      reduceMotion: restored.uiPreferences.reduceMotion,
      highContrastAssist: restored.uiPreferences.highContrastAssist,
      density: restored.uiPreferences.density,
      workspaceBootSessions: {},
      worktreeManager: defaultWorktreeManagerState(),
    });
    void applyDiscordPresenceEnabled(discordPresenceEnabled);
    enqueueAutomationSync(get);

    const nextActiveWorkspace = activeWorkspaceOf(get());
    if (nextActiveWorkspace) {
      clearSuspendTimer(nextActiveWorkspace.id);
      await resumeWorkspacePanes(get, set, nextActiveWorkspace.id);
      await spawnWorkspacePanes(get, nextActiveWorkspace.id, false);
      get().resumeWorkspaceBoot(nextActiveWorkspace.id);
      void get().startWorkspaceBoot(nextActiveWorkspace.id, {
        eligiblePaneIds: collectEligibleLaunchPaneIds(nextActiveWorkspace),
      });
      await get().refreshWorktrees();
    }

    await flushPersist(get);
  },

  createBlueprint: async (name: string, workspacePaths: string[], autorunCommands: string[]) => {
    const state = get();
    const activeWorkspace = activeWorkspaceOf(state);
    const blueprint: Blueprint = {
      id: crypto.randomUUID(),
      name,
      paneCount: activeWorkspace?.paneCount ?? 1,
      workspacePaths,
      autorunCommands,
      agentAllocation: activeWorkspace?.agentAllocation,
    };

    const blueprints = [blueprint, ...state.blueprints].slice(0, 25);
    set({ blueprints });
    await saveBlueprints(blueprints);
    enqueuePersist(get);
  },

  launchBlueprint: async (blueprintId: string) => {
    const state = get();
    const blueprint = state.blueprints.find((item) => item.id === blueprintId);
    if (!blueprint) {
      return;
    }

    if (blueprint.workspacePaths.length > 0) {
      const targetPath = blueprint.workspacePaths[0];
      const existing = state.workspaces.find((workspace) => workspace.worktreePath === targetPath);

      if (existing) {
        await get().setActiveWorkspace(existing.id);
      } else {
        await get().createWorkspace({
          name: `Workspace ${get().workspaces.length + 1}`,
          directory: targetPath,
          paneCount: blueprint.paneCount,
          agentAllocation: normalizeAgentAllocation(blueprint.agentAllocation, get().agentStartupDefaults),
        });
      }
    }

    await get().setActiveWorkspacePaneCount(blueprint.paneCount);

    for (const command of blueprint.autorunCommands) {
      await get().runGlobalCommand(command, true);
    }

    await flushPersist(get);
  },

  openWorktreeManager: async () => {
    set({ activeSection: "worktrees" });
    await get().refreshWorktrees();
    enqueuePersist(get);
  },

  refreshWorktrees: async () => {
    const state = get();
    const activeWorkspace = activeWorkspaceOf(state);
    if (!activeWorkspace) {
      set((current) => ({
        worktreeManager: {
          ...current.worktreeManager,
          repoRoot: null,
          loading: false,
          error: "No active workspace.",
          entries: [],
          lastActionMessage: null,
        },
      }));
      return;
    }

    const context = await resolveRepoContextSafe(activeWorkspace.worktreePath);
    if (!context.isGitRepo) {
      set({
        worktreeManager: {
          repoRoot: null,
          loading: false,
          error: "Active workspace is not a git repository.",
          entries: [],
          lastLoadedAt: new Date().toISOString(),
          lastActionMessage: null,
        },
      });
      return;
    }

    set((current) => ({
      worktreeManager: {
        ...current.worktreeManager,
        repoRoot: context.repoRoot,
        loading: true,
        error: null,
      },
    }));

    try {
      const entries = await listWorktrees(context.repoRoot);
      set((current) => ({
        worktreeManager: {
          ...current.worktreeManager,
          repoRoot: context.repoRoot,
          loading: false,
          error: null,
          entries,
          lastLoadedAt: new Date().toISOString(),
        },
      }));
    } catch (error) {
      set((current) => ({
        worktreeManager: {
          ...current.worktreeManager,
          repoRoot: context.repoRoot,
          loading: false,
          error: String(error),
          entries: [],
          lastLoadedAt: new Date().toISOString(),
        },
      }));
    }
  },

  createWorktreeForWorkspace: async (workspaceId: string, input: PaneWorktreeCreateInput) => {
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found.");
    }

    const context = await resolveRepoContextSafe(workspace.worktreePath);
    if (!context.isGitRepo) {
      throw new Error("Active workspace is not a git repository.");
    }

    const entry = await createWorktreeApi({
      repoRoot: context.repoRoot,
      mode: input.mode,
      branch: input.branch,
      baseRef: input.baseRef,
    });

    if (get().activeWorkspaceId === workspaceId) {
      await get().refreshWorktrees();
    }
    set((current) => ({
      worktreeManager: {
        ...current.worktreeManager,
        lastActionMessage: `Created worktree ${entry.worktreePath}`,
      },
    }));

    return entry;
  },

  createManagedWorktree: async (input: ManagedWorktreeCreateInput) => {
    const state = get();
    const repoRoot = state.worktreeManager.repoRoot;
    if (!repoRoot) {
      await get().refreshWorktrees();
    }
    const effectiveRepoRoot = get().worktreeManager.repoRoot;
    if (!effectiveRepoRoot) {
      throw new Error("No git repository available for worktree creation.");
    }

    const entry = await createWorktreeApi({
      repoRoot: effectiveRepoRoot,
      mode: input.mode,
      branch: input.branch,
      baseRef: input.baseRef,
    });

    await get().refreshWorktrees();
    set((current) => ({
      worktreeManager: {
        ...current.worktreeManager,
        lastActionMessage: `Created worktree ${entry.worktreePath}`,
      },
    }));

    if (input.openAfterCreate !== false) {
      await get().importWorktreeAsWorkspace(entry.worktreePath);
    }
  },

  importWorktreeAsWorkspace: async (worktreePath: string) => {
    const targetKey = normalizePathKey(worktreePath);
    const existing = get().workspaces.find(
      (workspace) => normalizePathKey(workspace.worktreePath) === targetKey,
    );
    if (existing) {
      await get().setActiveWorkspace(existing.id);
      return;
    }

    await get().createWorkspace({
      name: "",
      directory: worktreePath,
      paneCount: 1,
      agentAllocation: defaultAgentAllocation(get().agentStartupDefaults),
    });
  },

  removeManagedWorktree: async (input: ManagedWorktreeRemoveInput) => {
    const state = get();
    const repoRoot = state.worktreeManager.repoRoot;
    if (!repoRoot) {
      throw new Error("No git repository selected.");
    }

    const targetKey = normalizePathKey(input.worktreePath);
    const openMatches = state.workspaces.filter(
      (workspace) => normalizePathKey(workspace.worktreePath) === targetKey,
    );
    if (openMatches.length > 0 && state.workspaces.length <= openMatches.length) {
      throw new Error("Cannot remove the only open workspace worktree.");
    }

    for (const workspace of openMatches) {
      await get().closeWorkspace(workspace.id);
    }

    const response = await removeWorktree({
      repoRoot,
      worktreePath: input.worktreePath,
      force: input.force,
      deleteBranch: input.deleteBranch,
    });

    await get().refreshWorktrees();
    set((current) => ({
      worktreeManager: {
        ...current.worktreeManager,
        lastActionMessage: response.warning
          ? `Removed worktree with warning: ${response.warning}`
          : `Removed worktree ${response.worktreePath}`,
      },
    }));
  },

  pruneManagedWorktrees: async (dryRun: boolean) => {
    const repoRoot = get().worktreeManager.repoRoot;
    if (!repoRoot) {
      throw new Error("No git repository selected.");
    }

    const result = await pruneWorktrees({ repoRoot, dryRun });
    await get().refreshWorktrees();
    set((current) => ({
      worktreeManager: {
        ...current.worktreeManager,
        lastActionMessage: dryRun
          ? `Dry-run prune found ${result.paths.length} paths`
          : `Pruned ${result.paths.length} paths`,
      },
    }));
  },

  persistSession: async () => {
    await flushPersist(get);
  },
}));

export function getAgentDefaults(agentStartupDefaults?: AgentStartupDefaults): AgentAllocation[] {
  return defaultAgentAllocation(agentStartupDefaults ?? defaultAgentStartupDefaults());
}

export function getAgentStartupDefaultCommands(): AgentStartupDefaults {
  return defaultAgentStartupDefaults();
}

export function getAgentProfileOptions(): Array<{ profile: AgentProfileKey; label: string }> {
  return AGENT_PROFILE_CONFIG.map(({ profile, label }) => ({ profile, label }));
}
