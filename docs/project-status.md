# Project Status

- Last Updated: 2026-02-12 (multi-pane-reopen-init-race-fix)

- Current progress:
  - Fixed reopen race where only pane-1 received Codex/Claude init command.
  - Updated `spawnWorkspacePanes` to decide init delivery from activation-start pane statuses (snapshot), not live per-iteration status.
  - Ensured all assigned panes still receive init even if they become `running` due to concurrent mount-driven spawns.
  - Added store regressions:
    - 4-pane concurrent reopen scenario now initializes all panes.
    - panes already running at activation start do not get reinitialized.
  - Verified via `pnpm --filter @supervibing/desktop test -- run src/store/workspace.test.ts` and `pnpm --filter @supervibing/desktop typecheck`.

- Blockers/Bugs:
  - Pending manual Tauri verification for restart/reopen with 4+ pane allocations.

- Next immediate starting point:
  - Run `pnpm --filter @supervibing/desktop tauri:debug`.
  - Create 4-pane Codex workspace, restart app, reopen workspace, confirm all panes auto-launch.
  - If any pane still fails on reopen, capture logs and add repro for the specific path.
