# Project Status

- Last Updated: 2026-02-12 (persistent-workspace-terminals)

- Current progress:
  - Implemented persistent terminals across workspace tab switching (no close+respawn on each switch).
  - Namespaced backend pane IDs as `${workspaceId}::${paneId}` for spawn/write/resize/close/event/global-command paths to prevent cross-workspace ID collisions.
  - Kept logical pane IDs in UI/state while mapping backend command results back from runtime IDs.
  - Added regressions:
    - switching workspaces does not close or respawn already-running panes.
    - global command calls use runtime pane IDs and return logical pane IDs.
  - Added store regressions:
    - 4-pane concurrent reopen scenario now initializes all panes.
    - panes already running at activation start do not get reinitialized.
  - Verified via `pnpm --filter @supervibing/desktop test -- run src/store/workspace.test.ts` and `pnpm --filter @supervibing/desktop typecheck`.

- Blockers/Bugs:
  - Pending manual Tauri verification for long-lived inactive workspace terminals under memory load.

- Next immediate starting point:
  - Run `pnpm --filter @supervibing/desktop tauri:debug`.
  - Create two workspaces, run long commands in both, switch tabs repeatedly, confirm sessions persist without respawn.
  - Restart app and verify only active workspace auto-spawns initially; inactive workspaces spawn on first open.
