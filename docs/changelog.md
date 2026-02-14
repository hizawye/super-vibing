# Changelog

## [2026-02-14] - shadcn Compact Refresh (Dark/Light + Token-Native Styling)
### Changed
- Converted shared `@supervibing/ui` primitives to token-native shadcn styling and removed primitive reliance on desktop legacy class skins.
- Reduced theme scope to two supported presets (`apple-dark`, `apple-light`) and set default density to `compact`.
- Rebuilt `apps/desktop/src/styles.css` as a compact structural stylesheet for layout/pane orchestration instead of a full legacy skin layer.

### Removed
- Removed legacy “Soft UI Minimalism 2.0” override contract from desktop CSS.
- Removed old style-contract assertions tied to soft-ui marker blocks and replaced them with shadcn compact contract checks.

### Verification
- `pnpm --filter @supervibing/desktop typecheck`
- `pnpm --filter @supervibing/desktop test -- run`
- `pnpm --filter @supervibing/desktop build`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`

## [2026-02-13] - Git Control Center (lazygit/gitui-style)
### Added
- Added a new sidebar `Git` section with keyboard-first 3-pane workflow (`Status`, `Branches`, `Worktrees`, `PRs`, `Issues`, `Actions`).
- Added dedicated git view store state (`active panel`, `focus zone`, `per-panel cursor`) in `apps/desktop/src/store/gitView.ts`.
- Added confirmation modal for destructive git/GitHub actions in `apps/desktop/src/components/git/GitActionConfirmModal.tsx`.

### Changed
- Extended frontend Tauri bridge and shared types to include local git and GitHub command contracts.
- Extended command palette with direct Git-section jump actions (`Git`, `PRs`, `Actions`).

### Backend
- Added local git command APIs in Tauri backend:
  - `git_status`, `git_diff`, `git_stage_paths`, `git_unstage_paths`, `git_discard_paths`,
  - `git_commit`, `git_fetch`, `git_pull`, `git_push`,
  - `git_list_branches`, `git_checkout_branch`, `git_create_branch`, `git_delete_branch`.
- Added GitHub command APIs using `gh`:
  - PRs: `gh_list_prs`, `gh_pr_detail`, `gh_pr_checkout`, `gh_pr_comment`, `gh_pr_merge_squash`,
  - Issues: `gh_list_issues`, `gh_issue_detail`, `gh_issue_comment`, `gh_issue_edit_labels`, `gh_issue_edit_assignees`,
  - Actions: `gh_list_workflows`, `gh_list_runs`, `gh_run_detail`, `gh_run_rerun_failed`, `gh_run_cancel`.

## [2026-02-13] - tmux `Prefix + C` Focuses New Pane
### Changed
- Added a dedicated focused-create action for `Ctrl+B` then `c` so pane creation moves cursor/focus to the new pane.
- Kept `%` and `"` mappings on existing pane-count behavior to avoid changing split semantics.

### Added
- Added shortcut and store regression coverage for `prefix+c` focus-follow behavior.

## [2026-02-13] - Discord Presence Stability Hardening
### Changed
- Replaced backend Discord IPC crate with `discord-rich-presence` to support broader runtime path probing and `discord-ipc-0..9` discovery.
- Moved `set_discord_presence_enabled` backend behavior to a queue-driven worker model so settings toggles return immediately.

### Fixed
- Fixed app freeze risk when enabling Discord presence by removing synchronous RPC/socket work from Tauri command handling.
- Improved reliability when Discord is open but not using IPC slot `0`.

## [2026-02-13] - Discord Rich Presence Toggle
### Added
- Added a global Discord Rich Presence toggle in Settings.
- Presence shows minimal status (“SuperVibing / Working”) with a baked-in App ID and optional env override.
### Fixed
- Normalized presence state on snapshot restore to avoid typecheck issues.

## [2026-02-13] - One-Pane tmux Close Now Closes Workspace
### Changed
- Updated tmux `Prefix + X` and `Prefix + &` behavior:
  - if active workspace has more than one pane, behavior stays the same (decrement pane count),
  - if active workspace has exactly one pane, the active workspace close path is triggered.

### Added
- Added shortcut test coverage for one-pane close behavior on both `x` and `&`.

## [2026-02-13] - tmux Pane Focus Now Follows Cursor
### Fixed
- Fixed pane navigation focus drift where tmux-style pane movement changed highlighted pane but left terminal cursor/input focus behind.
- Added a store-level focus request signal and terminal focus handoff so `Ctrl+B` pane movement keeps active cursor aligned with focused pane.

### Added
- Added regression coverage for pane focus-follow behavior across workspace store, pane grid routing, and terminal focus side effects.

## [2026-02-13] - Pane-Scoped Worktrees + tmux `Prefix + W` Creator
### Added
- Added pane-level worktree binding (`PaneModel.worktreePath`) with store actions for:
  - creating a new pane bound to a selected worktree,
  - reassigning an existing pane to another worktree.
- Added floating `NewPaneModal` flow for:
  - selecting from discovered worktrees,
  - creating a new branch worktree inline, then creating/rebinding pane.
- Added pane header worktree metadata + contextual `Worktree` action in `PaneGrid`.

### Changed
- Pane spawn cwd now resolves from pane-level worktree path (fallback to workspace path for legacy/session defaults).
- Added tmux mapping `Ctrl+B` then `W` to open pane worktree creator.
- Updated global `Escape` overlay handling to include pane creator close path.

### Fixed
- Added frontend package dependency `@tauri-apps/plugin-dialog` to match existing dialog helper imports and unblock typecheck/test resolution.

## [2026-02-13] - tmux App Prefix Rebound to Ctrl+B
### Changed
- Rebound SuperVibing pane keyboard prefix from `Ctrl+Shift+B` back to `Ctrl+B`.
- Updated tmux prefix tests and shortcut docs to match plain `Ctrl+B` behavior in terminal and non-terminal shortcut scopes.

## [2026-02-13] - Release Tag Guard and v0.1.13 Recovery Path
### Added
- Added `scripts/create-release-tag.sh` and root pnpm command `release:tag` to enforce clean-state release tagging.

### Changed
- Release flow now codifies a guarded sequence:
  - `pnpm run release:prepare -- X.Y.Z`,
  - commit version parity changes,
  - `pnpm run release:tag -- X.Y.Z`,
  - push tag to trigger release workflow.

## [2026-02-13] - Automation Bridge Dynamic Bind and CLI Port Auto-Discovery
### Added
- Added backend env override `SUPERVIBING_AUTOMATION_BIND` for preferred automation bridge bind (`host:port`).

### Changed
- Automation bridge bind is no longer fixed to one port:
  - preferred bind is `SUPERVIBING_AUTOMATION_BIND` or default `127.0.0.1:47631`,
  - if preferred port is occupied, backend scans `127.0.0.1:47631..47641` and binds first available port.
- `GET /v1/health` now reports the runtime-selected bind address.
- SuperVibing automation CLI now auto-probes `127.0.0.1:47631..47641` when using implicit default URL and `47631` is unavailable.

## [2026-02-13] - tmux Passthrough and App Prefix Rebind
### Changed
- Rebound SuperVibing pane keyboard prefix from `Ctrl+B` to `Ctrl+Shift+B` to avoid conflicting with shell tmux defaults.
- Updated keyboard event wiring to listen in capture phase for more reliable app-prefix handling across terminal internals.
- Updated settings shortcut copy to reflect the new pane-control prefix.

### Fixed
- Fixed real tmux shortcut flow in terminal panes by allowing raw `Ctrl+B` to pass through to the running shell process.

## [2026-02-12] - Release Workflow Parity Hardening and v0.1.11 Recovery
### Added
- Added `scripts/prepare-release-version.sh` and root pnpm command `release:prepare` to update release versions in all app manifests (`package.json`, `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json`) in one step.
- Added root pnpm command `release:verify` for local/CI parity checks.

### Changed
- Strengthened `scripts/verify-release-version.sh` to enforce parity across all three manifest version sources (not only Tauri config).
- Improved release parity failure output with explicit detected-version diagnostics and direct remediation command hints.
- Updated release workflow parity step to use `pnpm run release:verify -- <tag>` for consistent local/CI behavior.

### Fixed
- Fixed failed `v0.1.11` release parity by aligning all release manifest versions to `0.1.11`.

## [2026-02-12] - Agent Startup Defaults, Terminal Shortcut Scope, and Automation Hardening
### Added
- Added global per-agent startup command defaults (`claude`, `codex`, `gemini`, `cursor`, `opencode`) in Settings and persisted session state.
- Added optional automation bearer-token auth via `SUPERVIBING_AUTOMATION_TOKEN`.
- Added Rust automation validation/retention coverage tests (auth parsing, payload validation, completed-job pruning behavior).

### Changed
- New workspace/import flows now seed agent command defaults from settings-managed startup defaults.
- App/tmux shortcut gating now allows terminal-focused xterm input scope while preserving editable-input protections in regular forms.
- Automation command submission now validates request payloads before queueing and returns more specific HTTP status codes (`401`, `409`, `429`).
- Automation job store now prunes old completed jobs to maintain bounded in-memory retention.

### Fixed
- Fixed keyboard shortcuts failing when cursor was inside an active terminal pane.
- Hardened worktree UX regressions with additional tests for create-without-open and remove-with-open-workspace flows.

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

## [2026-02-14] - shadcn/ui Shared Package Migration (Pass 1)
### Added
- Added shared `@supervibing/ui` package in `packages/ui` with shadcn-style primitives and exported token stylesheet (`@supervibing/ui/styles.css`).
- Added Radix-backed dialog/tabs/checkbox/switch/scroll primitives plus common UI utility exports (`cn`, badge/card/button/input surface).
- Added desktop wiring for shared package consumption (`workspace:*` dependency, Tailwind content scan, main stylesheet import).

### Changed
- Migrated key desktop surfaces to shared primitives:
  - navigation/chrome (`AppSidebar`, `TopChrome`),
  - command and modal surfaces (`CommandPalette`, `NewWorkspaceModal`, `NewPaneModal`, git confirm modal),
  - worktree and git control center interaction UI (`WorktreeManagerSection`, `GitSection` toolbar/list/detail controls),
  - pane header controls and utility surfaces (`PaneGrid`, `EmptyStatePage`, `StartupCrashScreen`).

### Verification
- `pnpm --filter @supervibing/desktop typecheck`
- `pnpm --filter @supervibing/desktop test -- run src/components/AppSidebar.test.tsx src/components/CommandPalette.test.tsx src/components/NewWorkspaceModal.test.tsx src/components/NewPaneModal.test.tsx src/components/PaneGrid.test.tsx`
- `pnpm --filter @supervibing/desktop build`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`

## [2026-02-14] - shadcn/ui Control Surface Completion (Pass 2)
### Changed
- Completed remaining desktop control migration in `apps/desktop/src/App.tsx`:
  - settings controls now use shared `@supervibing/ui` components,
  - terminal toolbar controls now use shared button/badge primitives,
  - pane-reassignment restart confirmation now uses `AlertDialog`.
- Replaced prompt-driven Git workflows in `apps/desktop/src/components/GitSection.tsx` with dialog-based actions for:
  - commit message entry,
  - branch checkout/create/delete,
  - PR checkout/squash/comment,
  - issue comment/labels/assignees edits.

### Removed
- Removed browser-native interaction flows from desktop TSX:
  - no `window.prompt`,
  - no `window.confirm`.
- Removed dead CSS selectors tied to retired overlay/group-title/native-input styling paths.

### Verification
- `pnpm --filter @supervibing/desktop typecheck`
- `pnpm --filter @supervibing/desktop test -- run src/App.settings-updater.test.tsx src/App.shortcuts.test.ts src/components/CommandPalette.test.tsx src/components/NewWorkspaceModal.test.tsx src/components/NewPaneModal.test.tsx src/components/PaneGrid.test.tsx`
- `pnpm --filter @supervibing/desktop build`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`

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
