# Project Status

- Last Updated: 2026-02-12 (release-v0.1.8-terminal-ready-gate)

- Current progress:
  - Reproduced Codex startup failure in terminal context:
    - exact error: `Error: The cursor position could not be read within a normal duration`.
    - confirmed CLI emits cursor-position query (`ESC[6n`) and fails when terminal response path is not ready.
  - Implemented terminal-readiness gate for agent auto-launch:
    - added runtime `terminalReadyPanesByWorkspace` state plus readiness waiters in `apps/desktop/src/store/workspace.ts`,
    - gated pending init flush + boot queue command dispatch on pane readiness,
    - added store actions `markPaneTerminalReady` and `markPaneTerminalNotReady`,
    - wired `TerminalPane` mount/unmount lifecycle to mark readiness in `apps/desktop/src/components/TerminalPane.tsx`,
    - cleared readiness state on pane/workspace removal and snapshot/bootstrap resets.
  - Added regressions in `apps/desktop/src/store/workspace.test.ts`:
    - new test asserting init commands wait for terminal-ready signal,
    - updated reopen/bootstrap/snapshot and spawn/init tests for readiness-gated behavior.
  - Bumped release parity metadata to `0.1.8`:
    - `package.json`,
    - `apps/desktop/package.json`,
    - `apps/desktop/src-tauri/tauri.conf.json`.

- Verification:
  - `pnpm --filter @supervibing/desktop typecheck` ✅
  - `pnpm --filter @supervibing/desktop test -- --run src/store/workspace.test.ts` ✅
    - all desktop tests passed in this run (58/58).
  - `./scripts/verify-release-version.sh v0.1.8` ✅

- Blockers/Bugs:
  - None currently identified for this fix path.

- Next immediate starting point:
  - Push `main`.
  - Create and push tag `v0.1.8`.
  - Verify `CI` and `Release` workflow completion.
