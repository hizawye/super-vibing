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
- Global agent startup defaults (`agentStartupDefaults`) are persisted in session state and used for new workspace/import allocation defaults.
- Store actions coordinate spawn/close/broadcast/worktree and session persistence.
- React 19 selector stability rule:
  - avoid nested derived arrays/objects inside `useShallow` object selectors,
  - prefer split selectors (`core object` + `derived array`) or derive with `useMemo` after selection.

## UI model
- Grid engine: `react-grid-layout`, supporting 1..16 panes.
- Zoom mode: pane-level maximize/restore on double-click.
- Terminal rendering: Xterm.js + fit addon per pane component.
- Keyboard model:
  - global app shortcuts remain available (`Ctrl/Cmd+N`, `Ctrl/Cmd+P`, `Escape`),
  - tmux-style pane shortcuts are handled by a frontend prefix controller (`Ctrl+B`, 1000ms armed timeout),
  - inside xterm pane scope, app prefix handling remains active so pane commands are consistent with terminal-focus and non-terminal-focus flows,
  - shortcut eligibility explicitly treats xterm pane scope as terminal-first,
  - prefix mappings route to pane count/focus/zoom/resize actions, with resize gated to `freeform` layout mode.

## Git manager
- `resolve_repo_context` resolves canonical repo/worktree context for a cwd and gracefully reports non-git paths.
- `create_worktree` supports `newBranch` and `existingBranch` modes and returns enriched worktree metadata.
- `list_worktrees` exposes porcelain-parsed worktree state with lock/prune/dirty/main flags.
- `remove_worktree` enforces safe removal semantics (main-worktree guard, optional force and branch delete).
- `prune_worktrees` supports dry-run and apply cleanup paths.
- Top app bar displays active branch/worktree context.

## Automation bridge
- Rust backend starts a local-only HTTP listener with deterministic bind fallback:
  - preferred bind from `SUPERVIBING_AUTOMATION_BIND` (default `127.0.0.1:47631`),
  - on port collision, scans `127.0.0.1:47631..47641` and binds first available port.
- API surface:
  - `GET /v1/health`,
  - `GET /v1/workspaces`,
  - `POST /v1/commands`,
  - `GET /v1/jobs/:jobId`.
- Request surface hardening:
  - validates command payloads before queueing (`workspaceId`, pane count range, branch/command guards),
  - queue pressure returns `429` when capacity is exceeded,
  - optional bearer-token auth is enforced when `SUPERVIBING_AUTOMATION_TOKEN` is set.
- Commands are queued and processed by a background worker with persisted in-memory job state (`queued/running/succeeded/failed`).
- Completed automation jobs are retention-pruned to keep in-memory job history bounded.
- Frontend remains source-of-truth for open workspace/pane runtime mapping and syncs snapshots through `sync_automation_workspaces`.
- Backend dispatches UI-bound actions (`create_panes`, `import_worktree`) through Tauri events (`automation:request`) and waits for explicit frontend ack (`automation_report`) with timeout handling.

## Persistence
- Tauri plugin-store (`@tauri-apps/plugin-store` + `tauri-plugin-store`) stores:
  - last session state,
  - named snapshots,
  - quick-launch blueprints.
  - global agent startup defaults.
- Store reset path uses plugin-store `reset()` + `save()` to recover from corrupt startup state.

## Startup resilience
- App root is wrapped in a render error boundary (`StartupErrorBoundary`) and logs startup failures to console (`[startup]` prefix).
- Workspace bootstrap in Zustand is fail-safe:
  - startup errors are captured in `startupError`,
  - boot flag is always cleared on failure,
  - UI renders a recovery surface with `Retry` and `Reset local data`.
- Recovery action `resetLocalStateAndRebootstrap` clears persisted local state and re-runs bootstrap from defaults.

## Linux WebKit diagnostics
- For renderer flash/black-screen incidents, validate startup with:
  - `pnpm tauri:debug`,
  - `WEBKIT_DISABLE_DMABUF_RENDERER=1 pnpm tauri:debug`,
  - `WEBKIT_DISABLE_COMPOSITING_MODE=1 pnpm tauri:debug`.
- If env-var launch recovers rendering, classify as compositor/GPU host issue; otherwise treat as app startup/runtime failure.

## Validation and CI
- Frontend test harness: Vitest + Testing Library + jsdom (`apps/desktop/vitest.config.ts`).
- Rust unit tests validate parser/sanitizer/cwd helpers.
- CI (`.github/workflows/ci.yml`) runs frontend typecheck/tests/build and rust check/tests on push/PR.
- Release workflow (`.github/workflows/release.yml`) enforces strict tag/version parity before publish.
- Release parity gate validates all version sources (`package.json`, `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json`) and fails fast on drift.
- Release preparation is codified through pnpm scripts:
  - `pnpm run release:prepare -- X.Y.Z` to atomically bump all version sources,
  - `pnpm run release:tag -- X.Y.Z` to block tag creation unless repo state is parity-clean and ready,
  - `pnpm run release:verify -- vX.Y.Z` to validate parity before tagging/push.
