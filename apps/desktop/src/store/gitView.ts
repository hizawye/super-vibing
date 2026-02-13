import { create } from "zustand";

export type GitPanelId = "status" | "branches" | "worktrees" | "prs" | "issues" | "actions";
export type GitFocusZone = "tabs" | "list" | "detail";

const GIT_PANELS: GitPanelId[] = ["status", "branches", "worktrees", "prs", "issues", "actions"];
const GIT_FOCUS_ZONES: GitFocusZone[] = ["tabs", "list", "detail"];

export interface GitViewState {
  activePanel: GitPanelId;
  focusZone: GitFocusZone;
  cursorByPanel: Record<GitPanelId, number>;
  setActivePanel: (panel: GitPanelId) => void;
  setFocusZone: (zone: GitFocusZone) => void;
  cycleFocusZone: () => void;
  moveCursor: (panel: GitPanelId, delta: number, total: number) => void;
  setCursor: (panel: GitPanelId, index: number) => void;
}

const defaultCursorByPanel = (): Record<GitPanelId, number> => ({
  status: 0,
  branches: 0,
  worktrees: 0,
  prs: 0,
  issues: 0,
  actions: 0,
});

function clampCursor(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(total - 1, value));
}

export const useGitViewStore = create<GitViewState>((set, get) => ({
  activePanel: "status",
  focusZone: "list",
  cursorByPanel: defaultCursorByPanel(),
  setActivePanel: (panel) => {
    if (!GIT_PANELS.includes(panel)) {
      return;
    }
    set({ activePanel: panel });
  },
  setFocusZone: (zone) => {
    if (!GIT_FOCUS_ZONES.includes(zone)) {
      return;
    }
    set({ focusZone: zone });
  },
  cycleFocusZone: () => {
    const current = get().focusZone;
    const index = GIT_FOCUS_ZONES.indexOf(current);
    const next = GIT_FOCUS_ZONES[(index + 1) % GIT_FOCUS_ZONES.length] ?? "list";
    set({ focusZone: next });
  },
  moveCursor: (panel, delta, total) => {
    set((state) => {
      const current = state.cursorByPanel[panel] ?? 0;
      return {
        cursorByPanel: {
          ...state.cursorByPanel,
          [panel]: clampCursor(current + delta, total),
        },
      };
    });
  },
  setCursor: (panel, index) => {
    set((state) => ({
      cursorByPanel: {
        ...state.cursorByPanel,
        [panel]: Math.max(0, index),
      },
    }));
  },
}));
