# Architecture

SuperVibing is a desktop workspace orchestrator built with Tauri v2.

## Runtime split
- Rust backend (`apps/desktop/src-tauri/src/lib.rs`) owns PTY lifecycle, pane I/O, and git worktree automation.
- React frontend (`apps/desktop/src`) owns pane layout/rendering, command UX, and persistence orchestration.

## PTY bridge
- `spawn_pane` opens native PTY via `portable-pty`.
- PTY output streams to frontend through Tauri `Channel<PtyEvent>`.
- PTY reads run in `tauri::async_runtime::spawn_blocking` (tokio-backed runtime thread pool).
- Frontend writes input through `write_pane_input` and resize through `resize_pane`.

## Hardening model
- Backend command errors are normalized by typed error categories (`validation`, `conflict`, `not found`, `pty`, `git`, `system`).
- Duplicate pane spawn is race-safe: insertion is checked under write-lock before registry update.
- PTY reader cleanup always schedules pane-registry removal through async runtime cleanup.
- PTY output uses bounded read chunks (`PTY_READ_BUFFER_BYTES`) for predictable stream payload size.

## State model
- Zustand store (`src/store/workspace.ts`) stores pane count/order/layouts, pane metadata, workspace tabs, and UI modes.
- Store actions coordinate spawn/close/broadcast/worktree and session persistence.

## UI model
- Grid engine: `react-grid-layout`, supporting 1..16 panes.
- Zoom mode: pane-level maximize/restore on double-click.
- Terminal rendering: Xterm.js + fit addon per pane component.

## Git manager
- `create_worktree` shells out to `git worktree add` and returns new workspace tab metadata.
- `list_worktrees` exposes porcelain-parsed worktree state.
- Top app bar displays active branch/worktree context.

## Persistence
- Tauri plugin-store (`@tauri-apps/plugin-store` + `tauri-plugin-store`) stores:
  - last session state,
  - named snapshots,
  - quick-launch blueprints.

## Validation and CI
- Frontend test harness: Vitest + Testing Library + jsdom (`apps/desktop/vitest.config.ts`).
- Rust unit tests validate parser/sanitizer/cwd helpers.
- CI (`.github/workflows/ci.yml`) runs frontend typecheck/tests/build and rust check/tests on push/PR.
