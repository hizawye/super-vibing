# Changelog

## [2026-02-12] - React Selector Stability Fix for Startup Loop
### Fixed
- Fixed a React 19 external-store rerender loop risk by removing nested derived arrays from a `useShallow` object selector in `apps/desktop/src/App.tsx`.
- Split selector logic into `selectWorktreeManagerCore` and `selectOpenWorkspacePaths` so snapshot comparisons remain stable.

### Added
- Added selector regression tests in `apps/desktop/src/App.selectors.test.ts` to document and guard against the prior unstable selector shape.

## [2026-02-12] - Startup Crash Recovery and Black-Screen Diagnostics
### Added
- Added `StartupErrorBoundary` fallback around app root render to surface render-time crashes with recovery actions.
- Added `StartupCrashScreen` with `Retry`, `Reset local data`, and optional error detail view.
- Added store startup failure state (`startupError`) and recovery actions (`clearStartupError`, `resetLocalStateAndRebootstrap`).
- Added persistence reset helper (`resetPersistedPayload`) using plugin-store reset/save flow.
- Added startup regression tests for boundary fallback and persistence reset behavior.

### Changed
- Hardened workspace bootstrap to always clear bootstrapping state and capture initialization errors instead of leaving a black/blank UI.
- Added startup error logging hooks for window `error` and `unhandledrejection` events.
- Updated architecture/project status docs with Linux WebKit compositor diagnostics.

## [2026-02-12] - Terminal UX and tmux Core Shortcut Refresh
### Added
- Added tmux-style core pane shortcut layer with `Ctrl+B` prefix and mapped pane actions (`%`, `"`, `c`, `n`, `p`, `o`, `0..9`, arrows, `z`, `x`, `&`, `Alt+Arrow`).
- Added focused-pane keyboard resize support for freeform layouts through store action `resizeFocusedPaneByDelta`.
- Added regression coverage for tmux prefix behavior/timeouts and focused-pane resize behavior.

### Changed
- Updated Settings shortcut documentation to reflect tmux core bindings and global app shortcut split.
- Updated workspace terminal render lifecycle to perform staged refit/resize on startup and active-visibility transitions.

### Fixed
- Fixed terminal copy behavior by handling `Ctrl+Shift+C` inside pane terminals and copying selected output to clipboard.
- Fixed first-render terminal glyph spacing drift in new/hidden workspace panes by forcing post-mount and fonts-ready refits.

## [2026-02-11] - Testing and Hardening Pass
### Added
- Added Vitest + Testing Library + jsdom test harness for the desktop frontend.
- Added frontend tests for workspace store behavior, command palette actions, and pane grid zoom/layout interactions.
- Added Rust unit tests for branch sanitization, worktree parsing, and cwd normalization.
- Added GitHub Actions CI workflow for frontend and Rust checks.

### Changed
- Hardened backend command error responses with categorized error messages.
- Improved PTY pane spawn lifecycle to avoid duplicate-pane races and guarantee async registry cleanup.
- Bounded PTY read buffer size for predictable stream chunking.
- Updated `pnpm-lock.yaml` after successful dependency resolution for the frontend test stack.

## Unreleased
- Added pnpm monorepo scaffold with Tauri v2 desktop app.
- Implemented Rust PTY bridge using `portable-pty` with non-blocking tokio runtime worker for stream reads.
- Added Tauri command surface for pane lifecycle, broadcast command dispatch, and git worktree management.
- Added local automation bridge API so external CLI clients can queue app commands (`create_panes`, `create_worktree`, `create_branch`, `run_command`) and poll job status.
- Rebuilt frontend with React + Tailwind + Xterm.js dynamic pane manager (1-16 panes, drag/resize, zoom).
- Added workspace tabs, branch/worktree context bar, command palette, echo-input mode.
- Added session snapshots and quick-launch blueprints persisted through Tauri plugin-store.
- Fixed updater release version drift by aligning app version metadata to `0.1.3`.
- Added release guard script `scripts/verify-release-version.sh` and wired it into CI release workflow.
- Improved Settings updater error feedback for network/signature/metadata failures.
- Added Settings updater tests for up-to-date and failed-check states.
- Added sidebar-first Worktree Manager with backend lifecycle commands (`resolve/create/list/remove/prune`), store orchestration, and command palette worktree actions.
