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

## [2026-02-12] - Persistent Terminals Across Workspace Switching
**Context:** Users expected VS Code-like behavior where switching workspace tabs keeps terminal sessions alive instead of killing and respawning them.
**Decision:** Stop closing active workspace panes on tab switch and namespace backend pane IDs as `${workspaceId}::${paneId}` so multiple workspaces can keep `pane-1`/`pane-2` alive concurrently without collisions.
**Rationale:** Preserves interactive session state across workspace switches while avoiding backend `pane already exists` conflicts caused by shared logical pane IDs.
**Consequences:** Runtime memory/CPU can grow with the number of open workspaces; input/event/backend operations now use runtime pane IDs and map results back to logical pane IDs for UI consistency.
**Alternatives Considered:** Keep only active workspace alive (current behavior) and bounded LRU keep-alive.

## [2026-02-12] - Performance-First Lifecycle Hardening
**Context:** Before adding more features, the workspace runtime needed stronger scalability controls for pane fan-out, persistence write pressure, and background workspace resource usage.
**Decision:** Introduce performance guardrails in both frontend store and backend runtime:
- backend commands for pane suspend/resume plus runtime stats,
- frontend idle auto-suspend timers for inactive workspaces,
- bounded pane spawn concurrency,
- debounced session persistence with explicit critical flushes,
- per-pane input micro-batching to reduce write amplification.
**Rationale:** Keeps terminal UX responsive as pane/workspace counts increase while avoiding aggressive close+respawn churn.
**Consequences:** Lifecycle logic is more stateful (`spawning`/`suspended`, timers, buffered input, persistence queue) but behavior is deterministic and test-covered.
**Alternatives Considered:** Keep all panes always running, persist on every mutation, and retain sequential pane spawn on workspace activation.

## [2026-02-12] - Staggered Workspace Boot Queue for Multi-Agent Freeze Mitigation
**Context:** Creating a workspace with ~6 agents could still freeze the app/system due to clustered CLI startups and heavy synchronous startup churn.
**Decision:** Shift agent startup to a dedicated background boot queue:
- run at max 3 parallel starts with staggered dispatch,
- retry failed starts once with backoff,
- adaptively reduce concurrency to 2 under sustained pressure (slow/failing starts),
- expose boot session progress and pause/resume controls in UI.
**Rationale:** Preserves high overall startup throughput while preventing all-at-once process spikes that lock the desktop.
**Consequences:** Agent startup is now asynchronous relative to workspace creation; boot state is explicitly tracked in store and not persisted as session state.
**Alternatives Considered:** Keep all-at-once startup, force manual agent startup only, or reduce to strict serial startup.

## [2026-02-12] - Per-Workspace Tiling Layout Mode with Deterministic Rebalancing
**Context:** The terminal pane UX used a free-form drag grid, which made multi-pane sessions feel scattered and inconsistent when adding/removing panes.
**Decision:** Introduce per-workspace `layoutMode` (`tiling` default, `freeform` optional) and implement a deterministic near-square row-major tiling engine that auto-rebalances on pane count changes; disable manual drag/resize while in tiling mode.
**Rationale:** Provides predictable pane geometry and better space usage for agent terminals, while retaining an escape hatch for users who want manual free-form adjustments.
**Consequences:** Session schema now includes `layoutMode`; legacy persisted sessions require migration defaulting to `tiling`; UI adds explicit mode toggle and quick pane step controls.
**Alternatives Considered:** Tiling-only without fallback, focus-based split model, and keeping free-form behavior with light auto-arrange only.

## [2026-02-12] - Terminal Render Hot-Path Batching and Selector Narrowing
**Context:** Even after startup queueing improvements, heavy terminal output and broad UI subscriptions could still create perceptible lag during multi-agent boot and noisy command streams.
**Decision:** Optimize terminal/UI hot paths without changing behavior:
- batch PTY output writes to xterm via per-pane frame-buffer flushing,
- debounce resize-to-backend calls from `ResizeObserver`,
- narrow `App` store subscriptions using `useShallow` and metadata-only selectors,
- remove app-level pane-title fanout and resolve pane titles at pane-level render points.
**Rationale:** Reduces main-thread churn and avoids unnecessary top-level rerenders while preserving existing workspace lifecycle semantics.
**Consequences:** Slightly more terminal component statefulness (output buffer + raf/timer management), but lower UI pressure under bursty output.
**Alternatives Considered:** Backend-side output coalescing only, and deeper store refactor into dedicated slices in one large pass.

## [2026-02-12] - Palette-Only Global Command Entry and Dynamic Grid Height Fit
**Context:** Inline global command controls duplicated command palette behavior and reduced usable terminal area; at higher pane counts some panes visually clipped below hidden viewport bounds.
**Decision:** Remove inline terminal command row and keep global command execution in command palette only; compute `PaneGrid` row height dynamically from container height and layout row count.
**Rationale:** Simplifies terminal surface UX and ensures pane grid consumes available vertical space without hidden overflow at dense layouts.
**Consequences:** Terminal header + grid now occupy the full section; row heights are responsive to window height and layout density instead of fixed `110px`.
**Alternatives Considered:** Keeping inline run bar with compact styling, or enabling section scroll for clipped panes.

## [2026-02-12] - Global Flat UI Pass (Square Geometry + Compact Spacing)
**Context:** The interface looked over-boxed with repeated rounded card treatments, and pane density made the app feel visually noisy.
**Decision:** Apply a global flat visual pass:
- remove rounded corners from core surfaces and controls,
- collapse major shell/card spacing,
- keep pane tiles edge-to-edge by setting grid margin to zero,
- flatten nested card backgrounds to simpler line-based framing.
**Rationale:** Reduces visual clutter, aligns with terminal-first tooling aesthetics, and makes pane-heavy layouts feel cleaner.
**Consequences:** UI is denser and more rigid; visual hierarchy now relies more on separators, typography, and color contrast than card silhouettes.
**Alternatives Considered:** Pane-only styling changes, and keeping rounded cards with lighter shadows/gaps.

## [2026-02-12] - Brutalist Monochrome Refinement
**Context:** After flattening geometry and spacing, the UI still had decorative gradients/blur/shadow that diluted the intended hard-edged style.
**Decision:** Apply a second-pass brutalist refinement:
- move core surfaces to solid monochrome backgrounds,
- standardize borders/separators to a narrow line palette,
- flatten secondary controls to transparent backgrounds,
- remove overlay blur and heavy modal shadows.
**Rationale:** Produces a stricter, cleaner visual language with less ornament and clearer structural hierarchy.
**Consequences:** The app feels more utilitarian and dense; interaction emphasis depends more on contrast and line rhythm.
**Alternatives Considered:** Keep gradients while only removing curvature, and use stronger shadows to separate sections.

## [2026-02-12] - Brutalist Contrast Tuning
**Context:** The monochrome pass reduced visual noise, but some controls/states became too subtle under dense terminal layouts.
**Decision:** Raise contrast for interaction-critical elements:
- stronger borders on secondary controls/list rows,
- brighter active-state backgrounds for tabs/menu/palette/layout selectors,
- clearer active/inactive tab text separation,
- slightly brighter label/meta text.
**Rationale:** Preserve the flat/brutalist aesthetic without sacrificing scanability and state clarity.
**Consequences:** Slightly higher visual intensity; interaction states are now easier to identify at a glance.
**Alternatives Considered:** Reintroducing shadows/blur, and reverting to gradient-heavy surfaces.

## [2026-02-12] - Global Preset Theming and Accessibility State
**Context:** The UI was locked to one brutalist dark style and Settings lacked appearance controls, making it impossible to switch to broader user-preferred looks.
**Decision:** Introduce a tokenized global theme system with persisted UI preferences:
- 6 built-in presets (`apple-dark`, `apple-light`, `graphite`, `midnight`, `solarized`, `nord`),
- global accessibility/density flags (`reduceMotion`, `highContrastAssist`, `density`),
- dedicated `theme/themes.ts` definitions including xterm terminal palette mapping,
- root-level theme application through `data-theme`, `data-density`, and modifier classes from app state.
**Rationale:** Gives immediate user-facing visual customization while keeping one coherent design system and minimizing per-component theming complexity.
**Consequences:** Session schema now includes `uiPreferences`; store/tests/persistence path required migration-safe defaults and additional coverage.
**Alternatives Considered:** Per-workspace themes, custom theme editor in v1, and style-only CSS tweaks without persisted state.
