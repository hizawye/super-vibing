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
