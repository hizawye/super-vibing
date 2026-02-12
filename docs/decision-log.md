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

## [2026-02-12] - Navigation IA Shift to Sidebar + Mobile Drawer
**Context:** Navigation hierarchy in top chrome mixed section switching, workspace switching, and utility actions in one row, which reduced scan clarity and made mobile behavior brittle.
**Decision:** Move primary navigation to a dedicated left sidebar with desktop persistence and mobile off-canvas behavior:
- section navigation in sidebar with `Terminal` + `Settings` enabled,
- `Kanban`, `Agents`, `Prompts` kept visible as locked `PRO` teasers,
- workspace list/actions (`switch`, `add`, `close`) moved into sidebar panel,
- top chrome simplified to contextual heading + command palette launcher + mobile nav toggle,
- section menu overlay removed from runtime flow.
**Rationale:** Improves information hierarchy and task navigation speed while preserving existing workspace flows and keyboard shortcuts.
**Consequences:** Top chrome component contract changed, app layout moved to two-column shell, and CSS gained sidebar/drawer primitives with overlay-priority keyboard close handling.
**Alternatives Considered:** Keep top-bar navigation with visual-only refresh, or expose all sections as clickable placeholders.

## [2026-02-12] - Sidebar Default Visibility Changed to Hidden Drawer
**Context:** Persistent desktop sidebar consumed space when not actively navigating and did not match user preference for a hideable side menu.
**Decision:** Make sidebar hidden by default at all breakpoints and open it only on demand via the nav toggle.
- drawer behavior now applies globally (desktop + mobile),
- `app-layout` content uses a single main column,
- sidebar closes via backdrop, close button, `Esc`, and selection flows.
**Rationale:** Keeps maximum canvas area for terminal work while preserving full navigation access when needed.
**Consequences:** Navigation now behaves consistently as an overlay drawer rather than persistent rail.
**Alternatives Considered:** Keep persistent desktop rail with a collapse mode.

## [2026-02-12] - Floating Midnight UI System (Soft-Surface Global Restyle)
**Context:** After enabling drawer navigation, the app still felt overly rigid with repeated hard-edged rectangular cards and strong borders across panes, settings, and overlays.
**Decision:** Apply a cohesive soft-surface visual system aligned with reference UI direction:
- floating drawer and top chrome with subtle glass-like depth,
- mixed-radius geometry and low-contrast separators instead of heavy outlines,
- active-state emphasis via glow/fill accents rather than border-only highlighting,
- global restyle coverage across navigation, pane cards, settings blocks, command palette, and workspace modal.
**Rationale:** Improves visual hierarchy and perceived polish while preserving terminal density and existing interaction behavior.
**Consequences:** Styling primitives shifted from border-dominant framing to layered surfaces/shadows; control classes now rely on shared soft tokens for consistency.
**Alternatives Considered:** Restricting changes to navigation only, and maintaining existing rigid cards with minor border tweaks.

## [2026-02-12] - Terminal Header Controls Realigned Next to Workspace Title
**Context:** Terminal controls were placed as a separate sibling block under/away from the workspace title, making the header feel detached and less like the target reference.
**Decision:** Restructure terminal header into two rows:
- top row: workspace title + full controls cluster inline,
- second row: branch/path metadata line.
Responsive behavior keeps inline layout on desktop and stacks controls below title on narrow screens.
**Rationale:** Tightens information hierarchy and keeps primary controls visually anchored to the active workspace identity.
**Consequences:** `App.tsx` terminal header markup now uses dedicated title/subtitle row wrappers; `styles.css` includes matching layout rules for desktop/mobile wrapping.
**Alternatives Considered:** Keeping the old split-block header and only adjusting spacing/alignment values.

## [2026-02-12] - Terminal Header Moved Into Top Chrome
**Context:** The terminal header strip still occupied vertical space below the top chrome, even after alignment fixes. The desired layout was to pull workspace controls into the top chrome area.
**Decision:** Move the terminal header contents (workspace name, controls, branch/path) into the top chrome:
- `TopChrome` now accepts terminal-specific title, subtitle, and control slots.
- the terminal section no longer renders a dedicated header block.
- the top chrome renders a second subtitle line for the branch/path while keeping controls on the top row.
**Rationale:** Compresses vertical chrome, aligns with the reference layout, and keeps primary controls co-located with the workspace identity.
**Consequences:** Top chrome layout is now variant-aware; terminal controls can overflow horizontally on desktop and wrap on smaller screens.
**Alternatives Considered:** Keeping a separate header strip and reducing its height only.

## [2026-02-12] - Simplified Top Chrome for Terminal View
**Context:** The top chrome still felt busy after moving terminal controls into it, with extra labels and actions competing for space.
**Decision:** Simplify terminal view chrome:
- remove the section chip,
- hide the command palette button,
- keep only nav toggle, workspace name, and inline terminal controls.
Branch/path subtitle line is hidden for the minimal terminal chrome.
**Rationale:** Prioritizes workspace identity and direct controls, reducing visual noise in the main working view.
**Consequences:** Command palette is no longer visible in terminal chrome (still accessible via shortcut), and branch/path line is no longer shown.
**Alternatives Considered:** Keeping an icon-only command palette button or leaving the subtitle line intact.

## [2026-02-12] - Button-Only Pane Controls
**Context:** The terminal header still used multiple input controls (range slider and echo checkbox), which felt heavy compared to the desired minimal toolbar.
**Decision:** Remove the range slider and echo checkbox from the terminal controls and keep pane changes via +/- buttons only. Also remove the save snapshot button from the chrome.
**Rationale:** Keeps the toolbar button-focused and reduces visual clutter without removing core controls.
**Consequences:** Pane count is adjusted only via +/- buttons; echo input toggle and snapshot action are no longer visible in the terminal chrome (still available via command palette).
**Alternatives Considered:** Keeping the slider as a compact control or replacing it with preset buttons.

## [2026-02-12] - Borderless Minimalist Visual System
**Context:** The interface still relied on nested cards, borders, and container surfaces, which contradicted the requested borderless minimalist aesthetic.
**Decision:** Apply a global borderless minimal pass:
- remove borders and heavy container backgrounds,
- use whitespace and typography as the primary structure,
- shift to a cool graphite monochrome palette,
- keep only minimal shadows where depth is necessary.
**Rationale:** Produces an open, airy, floating layout while improving typographic hierarchy.
**Consequences:** Most UI surfaces now render as transparent layers; separation is driven by spacing, typography, and subtle hover backgrounds instead of lines.
**Alternatives Considered:** Only removing borders on primary surfaces while leaving cards intact.

## [2026-02-12] - Borderless Minimalism Rebalanced for Visibility
**Context:** The initial minimalist pass removed too much surface contrast, reducing content visibility and perceived structure.
**Decision:** Restore surface backgrounds and text contrast while keeping borders removed:
- keep background fills on major surfaces (chrome, sidebar, panes, modals),
- reduce padding rather than removing it entirely,
- maintain minimal shadows only where depth helps.
**Rationale:** Preserves the minimalist, airy feel without flattening content into invisibility.
**Consequences:** The UI regains clarity and contrast while retaining the borderless aesthetic.
**Alternatives Considered:** Reintroducing borders on key containers.

## [2026-02-12] - Single-Layer Minimalism (Unified Canvas)
**Context:** Even after borderless passes, the interface still felt multi-layered due to wrapper/card surfaces and subtle panel containment.
**Decision:** Enforce single-layer minimalism across the main app:
- header, sidebar, and terminal share the exact same canvas background,
- remove wrapper/card geometry from content regions,
- rely on alignment and whitespace for structure,
- introduce pane spacing via grid margins instead of card borders.
Modal/palette readability kept via a faint translucent overlay panel.
**Rationale:** Aligns strictly with the single-layer directive while preserving interaction clarity for overlays.
**Consequences:** Main interface appears as one continuous canvas; visual grouping now comes from spacing, typography, and alignment.
**Alternatives Considered:** Keeping subtle surface tints on top chrome/sidebar.

## [2026-02-12] - Removed Pane Labels and Zoom Buttons
**Context:** Pane chrome still showed visible labels/actions (`Codex`, `Zoom`, `RUNNING`) that conflicted with the requested minimal single-layer UI.
**Decision:** Remove visible pane label/status/action text from pane regions:
- `PaneGrid` now renders a slim, textless pane handle used for drag (freeform) and double-click zoom toggle,
- zoom restore uses handle double-click instead of a `Restore` button,
- `TerminalPane` no longer renders the metadata row (title/status) above terminal output.
**Rationale:** Keeps pane interactions intact while eliminating redundant UI text and chrome noise.
**Consequences:** Pane state/actions are less explicit visually but layout is cleaner and aligned with the requested aesthetic.
**Alternatives Considered:** Keeping icon-only zoom/status indicators.

## [2026-02-12] - Edge-to-Edge Terminal Pane Density with 1px Dividers
**Context:** Pane area still lost usable space due to shell gaps and pane grid margins, and panes looked visually detached when pane count increased.
**Decision:** Increase pane density for terminal view:
- terminal section now uses edge-to-edge layout spacing with terminal-only shell gap reduction,
- pane grid spacing changed to `1px` with `containerPadding={0,0}`,
- divider effect comes from grid background with panes touching each other separated by thin 1px lines,
- zoomed pane view removes extra outer padding to preserve maximum usable area.
**Rationale:** Maximizes working terminal area while keeping panes visually grouped and readable at high pane counts.
**Consequences:** Terminal canvas becomes more compact and efficient; non-terminal sections keep existing spacing rhythm.
**Alternatives Considered:** Keeping 12px pane spacing and using pane borders only.

## [2026-02-12] - Memory-First Runtime Cleanup and Bottleneck Pass
**Context:** With multi-workspace/multi-pane usage, memory pressure became the primary pain point and the codebase still carried idle subscriptions, dead UI artifacts, and avoidable state churn.
**Decision:** Apply low-risk performance cleanup focused on memory and runtime overhead:
- reduce inactive workspace auto-suspend delay to `120s`,
- set terminal scrollback depth to `400` lines per pane,
- move PTY reader from generic `spawn_blocking` pool to named bounded-stack threads (`256 KiB`) and handle reader-thread spawn failure with explicit pane rollback,
- skip mounting `CommandPalette` and `NewWorkspaceModal` while closed,
- deduplicate no-op freeform layout updates to avoid unnecessary state writes/persistence,
- remove dead `SectionMenu` component and stale `App.css`, plus related `section-menu` CSS.
**Rationale:** Reclaims memory earlier, lowers idle render/subscription cost, and trims unnecessary UI/runtime overhead without changing product behavior.
**Consequences:** Inactive workspaces suspend sooner; terminal panes retain less scrollback history; code surface is smaller and easier to maintain.
**Alternatives Considered:** Aggressive lifecycle changes (auto-closing inactive panes) and large store architecture rewrites.

## [2026-02-12] - Tag-Driven GitHub Releases with In-App Updater Controls
**Context:** The desktop app needed a production release path on GitHub plus a user-facing way to check/install updates from Settings.
**Decision:** Implement a signed updater pipeline and app-side update controls:
- added `.github/workflows/release.yml` triggered by `v*.*.*` tags on Linux,
- enforced presence of `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in CI,
- enabled `bundle.createUpdaterArtifacts` and configured updater endpoint/public key,
- registered `tauri-plugin-updater` in Rust and granted `updater:default` capability,
- added Settings “App Updates” flow (`check` -> `install` prompt -> `restart now`).
**Rationale:** Establishes a reproducible signed-release workflow while giving end users a direct in-app update path.
**Consequences:** Release publishing now depends on signing secrets and matching updater keypair; Settings now includes update lifecycle state management.
**Alternatives Considered:** Manual GitHub uploads without updater metadata and external-only update instructions.

## [2026-02-12] - Normalize Pane `TERM` When Host Environment Is `dumb`
**Context:** Agent CLIs launched in workspace panes inherited `TERM=dumb` from the app process, causing startup warnings and disabling interactive TUI features (notably Codex and Starship).
**Decision:** Normalize pane terminal type only when invalid:
- in backend `spawn_pane`, resolve `TERM` from process env and set command env explicitly,
- map missing/empty/`dumb` values to `xterm-256color`,
- preserve all other non-empty terminal values unchanged,
- add unit tests for normalization behavior.
**Rationale:** Restores interactive terminal behavior without overriding valid custom terminal settings.
**Consequences:** Pane processes now start with a usable terminal type even when the host launcher provides `TERM=dumb`; custom `TERM` values remain compatible.
**Alternatives Considered:** Forcing `xterm-256color` always and documenting a user-only environment workaround.
