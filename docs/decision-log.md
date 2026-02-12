# Decision Log

- 2026-02-10: Initialized Codex agent environment with docs-first workflow and pnpm monorepo direction.
- 2026-02-10: Selected custom monorepo bootstrap (`apps/desktop`) instead of single-package scaffold.
- 2026-02-10: Standardized pane layout on `react-grid-layout` for drag/resize and zoom overlay behavior.
- 2026-02-10: Implemented PTY output streaming through Tauri Channels with reader loop on tokio blocking runtime pool.
- 2026-02-10: Chose Tauri plugin-store JSON persistence for session snapshots and quick-launch blueprints.
- 2026-02-10: Captured "last command" at frontend Enter-submit boundary rather than shell-history scraping.

## [2026-02-11] - Test Stack and CI Baseline
**Context:** The core orchestrator features are in place but lacked automated regression coverage and branch protection checks.
**Decision:** Standardize frontend tests on Vitest + Testing Library and add GitHub Actions CI jobs for frontend and Rust validation.
**Rationale:** This balances fast iteration on UI/store logic with direct backend command validation before feature expansion.
**Consequences:** CI now requires test dependencies and stable npm registry access; lockfile and dependency health become part of delivery quality.
**Alternatives Considered:** Playwright-heavy only, Rust-only testing, and local-only checks without CI.

## [2026-02-11] - PTY Error and Lifecycle Hardening
**Context:** PTY command paths needed clearer failure surfaces and stronger pane lifecycle guarantees under concurrent actions.
**Decision:** Add categorized backend error formatting, bounded PTY read chunk size, duplicate spawn race guard, and guaranteed async pane cleanup.
**Rationale:** Reduces ambiguous failures and prevents stale pane registry state under high churn.
**Consequences:** Slightly more backend complexity, but simpler debugging and safer command behavior.
**Alternatives Considered:** Keep ad-hoc string errors and rely on UI-side retries only.

## [2026-02-11] - Verification Execution Path
**Context:** Local sandbox networking could not resolve npm registry, blocking dependency install and frontend verification.
**Decision:** Execute install and tauri smoke validation outside sandbox limits, then keep lockfile changes tracked in git.
**Rationale:** Produces a fully verified, reproducible dependency graph while preserving strict local checks.
**Consequences:** Validation run requires elevated command path in restricted environments.
**Alternatives Considered:** Deferring validation to CI only.

## [2026-02-11] - Workspace-Centric Shell and Ctrl/Cmd+P Palette
**Context:** SuperVibing needed BridgeSpace-inspired UX flow while keeping terminal orchestration as the core behavior.
**Decision:** Move to a workspace-centric UI shell (top tab chrome, section menu, modal workspace creation with AI allocation) and preserve command palette as a VS Code-style unified launcher on `Ctrl/Cmd+P`.
**Rationale:** This keeps high-frequency actions keyboard-first, reduces clutter from legacy control panels, and aligns visual/interaction flow with the reference product.
**Consequences:** Store/session model migrated from single global pane state to per-workspace runtimes; tests were updated to cover new flows; backend spawn supports optional init command execution.
**Alternatives Considered:** Removing command palette entirely, keeping old control-grid layout with style-only changes, and implementing near-pixel clone without adapting behavior.

## [2026-02-11] - CI Rust Job Linux Dependency Provisioning
**Context:** GitHub Actions `rust` job failed on Ubuntu due to missing `glib/gobject/gio` system libraries required by Tauri crates during `cargo check`.
**Decision:** Add explicit `apt-get` install step in `.github/workflows/ci.yml` for Tauri Linux build dependencies before Rust compilation.
**Rationale:** Aligns CI environment with required native libs so Rust checks/tests can run reliably on hosted runners.
**Consequences:** Slightly longer rust job startup time; significantly more stable CI for Linux targets.
**Alternatives Considered:** Setting `PKG_CONFIG_PATH` only, skipping rust CI on Linux, or moving checks to containerized custom image.

## [2026-02-12] - Frontend Bundle Segmentation
**Context:** The desktop frontend build emitted a >500 kB chunk warning and loaded heavy terminal/grid modules upfront.
**Decision:** Split vendor chunks in Vite (react/grid/terminal/tauri), lazy-load secondary UI overlays, and dynamically import xterm runtime in `TerminalPane`.
**Rationale:** Reduces initial bundle size and defers heavy dependencies until needed, improving startup performance.
**Consequences:** Additional chunks generated; terminal initialization now awaits async module load; build output now has multiple sub-300 kB chunks.
**Alternatives Considered:** Keeping a single bundle and only adjusting `chunkSizeWarningLimit`.

## [2026-02-12] - Agent Auto-Launch Reliability
**Context:** New workspace agent panes sometimes failed to auto-run their init command even when the CLI was available on PATH.
**Decision:** Re-issue agent init commands from the frontend after `spawnPane` completes with a short delay, instead of relying solely on backend init writes.
**Rationale:** Ensures the shell is ready to accept the command; avoids dropped writes during early PTY startup.
**Consequences:** Slight delay before agent starts; backend init support remains unused but available.
**Alternatives Considered:** Using a first-output trigger, or relying only on backend init writes.

## [2026-02-12] - Deterministic Pane Spawn and Init Command Delivery
**Context:** Codex/Claude launches were still intermittently failing when creating new workspaces due to concurrent `ensurePaneSpawned` calls from workspace creation and pane mount lifecycle.
**Decision:** Add per-pane in-flight spawn deduplication, persist pending init commands across concurrent callers, flush init command exactly once after running state, and retry once on `pane already exists` conflicts.
**Rationale:** Removes timing-dependent behavior and prevents command-loss when spawn callers race.
**Consequences:** Store logic is more stateful (`spawnInFlight` + `pendingPaneInit`) but startup behavior is deterministic and test-covered.
**Alternatives Considered:** Increasing fixed delays, relying on backend init write only, and removing pane-mount spawn checks.

## [2026-02-12] - Reopen Workspace Agent Auto-Run
**Context:** Agent commands launched correctly on workspace creation but did not auto-run after app restart when reopening persisted workspaces.
**Decision:** Reuse the workspace launch plan (`agentAllocation` + `paneOrder`) for all workspace activation paths (bootstrap, switch, close->next active, pane count changes, snapshot restore), not just creation.
**Rationale:** Keeps agent startup behavior consistent whenever panes are respawned for an active workspace.
**Consequences:** Reopening a workspace now reissues assigned agent commands in mapped panes; behavior is covered with store tests for reopen/boot/restore flows.
**Alternatives Considered:** Auto-run only on initial creation, or adding separate persisted per-pane command fields.

## [2026-02-12] - Multi-Pane Reopen Init Race Fix
**Context:** On reopen, only the first pane often launched Codex/Claude while other assigned panes stayed at shell prompt.
**Decision:** In `spawnWorkspacePanes`, compute init eligibility from pane statuses captured at activation start (status snapshot), then pass init options for all panes that were initially non-running.
**Rationale:** Prevents concurrent mount-triggered spawns from flipping later panes to `running` before loop iteration and accidentally skipping init.
**Consequences:** All assigned panes receive exactly one init command even under concurrent spawn timing; added regressions for the 4-pane race and no-rerun-on-initially-running panes.
**Alternatives Considered:** Forcing sequential spawn locks at UI level, and always reissuing init regardless of initial pane status.
