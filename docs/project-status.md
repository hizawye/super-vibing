# Project Status

- Last Updated: 2026-02-12 (workspace-reopen-agent-autostart)

- Current progress:
  - Extended agent auto-run to persisted workspace reopen flows:
    - app bootstrap active workspace spawn,
    - workspace tab switching,
    - close active workspace -> activate next,
    - snapshot restore,
    - pane count updates.
  - Centralized workspace spawn orchestration so agent launch plan is reused consistently across creation and reopen paths.
  - Added store regressions for reopen/bootstrap/restore agent auto-run behavior.
  - Verified via `pnpm --filter @supervibing/desktop test -- run src/store/workspace.test.ts` and `pnpm --filter @supervibing/desktop typecheck`.

- Blockers/Bugs:
  - Pending manual Tauri UI verification of restart -> reopen workspace flow in real PTY runtime.

- Next immediate starting point:
  - Run `pnpm --filter @supervibing/desktop tauri:debug`.
  - Create workspace with Codex/Claude allocation, restart app, reopen that workspace, and confirm agent command auto-runs.
  - If any pane still fails on reopen, capture logs and add repro for the specific path.
