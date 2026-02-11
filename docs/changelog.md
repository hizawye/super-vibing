# Changelog

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

## Unreleased
- Added pnpm monorepo scaffold with Tauri v2 desktop app.
- Implemented Rust PTY bridge using `portable-pty` with non-blocking tokio runtime worker for stream reads.
- Added Tauri command surface for pane lifecycle, broadcast command dispatch, and git worktree management.
- Rebuilt frontend with React + Tailwind + Xterm.js dynamic pane manager (1-16 panes, drag/resize, zoom).
- Added workspace tabs, branch/worktree context bar, command palette, echo-input mode.
- Added session snapshots and quick-launch blueprints persisted through Tauri plugin-store.
