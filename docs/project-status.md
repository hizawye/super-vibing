# Project Status

- Last Updated: 2026-02-12 (deterministic-pane-spawn)

- Current progress:
  - Implemented root-cause fix for agent startup race in `workspace` store:
    - per-pane in-flight spawn dedupe.
    - pending init command queue persisted across concurrent callers.
    - single conflict retry on `pane already exists`.
    - one-time init command flush after pane reaches `running`.
  - Added regression tests in `apps/desktop/src/store/workspace.test.ts` for concurrent spawn/init and conflict recovery.
  - Verified via `pnpm --filter @supervibing/desktop test -- run src/store/workspace.test.ts` and `pnpm --filter @supervibing/desktop typecheck`.

- Blockers/Bugs:
  - Pending manual UI verification in local Tauri app for real PTY startup flow.

- Next immediate starting point:
  - Run `pnpm --filter @supervibing/desktop tauri:debug`.
  - Create new workspaces with Codex and Claude allocations and confirm each selected pane auto-starts without `ERROR` status.
  - If any pane still fails, capture console + Tauri logs and add targeted repro test.
