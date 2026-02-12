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

## [2026-02-12] - Enforce Release Tag/Version Parity For Updater Reliability
**Context:** The in-app `Check for updates` flow appeared broken because published updater metadata (`latest.json`) reported version `0.1.0` while release tag `v0.1.2` existed. Clients on `0.1.0` therefore saw no newer version.
**Decision:** Make release version parity explicit and enforceable:
- bump app version metadata to `0.1.3` (`tauri.conf.json`, desktop `package.json`, workspace `package.json`),
- add `scripts/verify-release-version.sh` to require `GITHUB_REF_NAME` tag format `vX.Y.Z` and exact match with Tauri config version,
- run the guard in release workflow before publish,
- improve updater error messaging so network/signature/metadata issues are surfaced in Settings.
**Rationale:** Prevents silent metadata drift between tags and shipped updater manifests while making user-visible updater failures actionable.
**Consequences:** Tag pushes fail fast when version metadata is stale; future releases keep updater JSON version aligned with tag semantics.
**Alternatives Considered:** Manual release checklist without enforcement and tag-only derivation with runtime mutation.

## [2026-02-12] - Soft UI (Minimalism 2.0) Frontend Redesign
**Context:** The current UI still used hard 1px borders, chrome/pane wrappers, and dense card segmentation that conflicted with a softer open-canvas direction.
**Decision:** Shift the desktop frontend to Soft UI Minimalism 2.0:
- remove hard border/stroke segmentation from primary surfaces and controls in override layer,
- use subtle elevation (`canvas` + ~2% lighter panes) as the primary pane/section separator,
- define structural spacing at `24px` for layout openness,
- make top chrome borderless and separate it from content using only slight tint (`--chrome-tint`),
- keep all existing theme presets and remap them to the same elevation model,
- preserve discoverability with hover-reveal fills/shadows and focus-visible glow.
**Rationale:** Produces a cleaner Notion-like open layout while keeping panes and controls scannable without reintroducing hard edges.
**Consequences:** Visual hierarchy now depends on tone, spacing, and shadow; style regressions are guarded by `styles.soft-ui.test.ts`.
**Alternatives Considered:** Keeping single-layer fully flat styling and keeping prior border-based pane delineation.

## [2026-02-12] - CI/Release Fix for Soft UI Contract Test and Tauri Action Input
**Context:** After tagging `v0.1.4`, both `CI` and `Release` workflows failed: frontend typecheck/build included a Node-dependent test under `src/`, and release logged an unsupported tauri-action input.
**Decision:** Stabilize workflow compatibility with two changes:
- moved Soft UI CSS contract test from `apps/desktop/src/styles.soft-ui.test.ts` to `apps/desktop/tests/styles.soft-ui.test.ts` so browser-focused `tsc --noEmit` does not typecheck Node globals/modules used only in tests,
- removed unsupported `uploadUpdaterJson` input and set supported `includeUpdaterJson: true` in `.github/workflows/release.yml`,
- bumped app/release metadata to `0.1.5` for a clean replacement tag.
**Rationale:** Keeps strict frontend type boundaries intact, preserves deterministic CSS contract checks, and aligns release workflow inputs with the current `tauri-apps/tauri-action@v0.6.0` schema.
**Consequences:** Typecheck/build no longer fail on Node test APIs; release workflow avoids invalid-input warning and remains updater-artifact enabled.
**Alternatives Considered:** Adding Node typings to frontend tsconfig and excluding all `*.test.ts` from typecheck.

## [2026-02-12] - Section Variant Layout Model for Full-Height Terminal Panes
**Context:** Terminal panes were not consistently filling the available area below top chrome because the shared `.section-surface` enforced a headed two-row grid even for body-only terminal sections.
**Decision:** Split section layout semantics into explicit variants and keep `.section-surface` as visual shell only:
- added `.section-surface--headed` (`grid-template-rows: auto minmax(0, 1fr)`),
- added `.section-surface--body` (`grid-template-rows: minmax(0, 1fr)`),
- switched terminal view to body variant and headed views (Settings/EmptyState) to headed variant,
- added a contract test to lock the new layout semantics and class usage.
**Rationale:** Makes section structure explicit, fixes terminal full-height behavior, and prevents future regressions from implicit grid assumptions.
**Consequences:** Any new `section-surface` usage must choose headed vs body variant intentionally; layout behavior is now more predictable across views.
**Alternatives Considered:** Terminal-only CSS override without refactoring shared section semantics.

## [2026-02-12] - tmux-Style Pane Keyboard Navigation and Focus State
**Context:** Pane shortcuts listed in Settings were partially unimplemented, and there was no keyboard-targeted pane focus model to support tmux-like navigation.
**Decision:** Add direct-chord pane shortcuts and runtime focus tracking:
- implemented `Ctrl/Cmd + Alt + Arrow` directional pane focus movement using layout-aware nearest-candidate selection,
- implemented `Ctrl/Cmd + Shift + ]` / `Ctrl/Cmd + Shift + [` pane count adjustments,
- implemented `Ctrl/Cmd + Alt + Enter` zoom toggle for the currently focused pane,
- introduced runtime-only `focusedPaneByWorkspace` store state with actions to set/move focus and reconcile focus on workspace switch, pane count changes, close, and snapshot restore,
- added subtle `.pane-card.is-focused` visual treatment and pane focus capture via pane header/terminal pointer interaction,
- added focused-pane algorithm/unit coverage and keyboard shortcut tests.
**Rationale:** Makes pane-heavy workflows keyboard-first without introducing prefix-state complexity while keeping focus behavior deterministic across layout mutations.
**Consequences:** Pane interaction now depends on explicit focused-pane state; shortcut docs now match actual bindings; no persistence schema changes.
**Alternatives Considered:** Full tmux prefix emulation (`Ctrl+B` sequences) and non-directional linear pane cycling.

## [2026-02-12] - Release Recovery by Enforcing Tag/Version Parity After v0.1.6 Failure
**Context:** The `Release` workflow for tag `v0.1.6` failed at parity validation because repository app version metadata still referenced `0.1.5`.
**Decision:** Bump all release version sources to `0.1.7` and publish a new tag instead of rewriting the failed `v0.1.6` tag:
- updated `apps/desktop/src-tauri/tauri.conf.json` version to `0.1.7`,
- updated `apps/desktop/package.json` version to `0.1.7`,
- updated workspace root `package.json` version to `0.1.7`.
**Rationale:** Preserves immutable release history while satisfying the guarded release invariant (`tag == tauri version`).
**Consequences:** `v0.1.6` remains failed/historical; subsequent release should use `v0.1.7` and pass parity gate.
**Alternatives Considered:** Deleting/re-pointing remote `v0.1.6` tag.

## [2026-02-12] - Gate Agent Auto-Launch on Terminal Readiness
**Context:** On app restart, Codex auto-launch in pane terminals could fail with `The cursor position could not be read within a normal duration` because command execution started before frontend terminal mount/listener readiness.
**Decision:** Introduce runtime terminal-readiness gating in workspace orchestration:
- track per-workspace/pane readiness in store runtime state,
- add explicit `markPaneTerminalReady` / `markPaneTerminalNotReady` lifecycle actions from `TerminalPane`,
- block pending init flushes and boot-queue command writes until ready (with bounded wait + existing retry path),
- clear readiness metadata on pane/workspace teardown and snapshot/bootstrap resets.
**Rationale:** Prevents interactive CLI startup races without disabling agent auto-launch behavior.
**Consequences:** Agent init commands are delayed until pane terminal is mounted; startup sequencing is slightly more stateful but deterministic and test-covered.
**Alternatives Considered:** Fixed startup delays and disabling auto-launch after reopen.

## [2026-02-12] - Release Version Bump to v0.1.8 for Terminal-Ready Launch Fix
**Context:** The repository already had tag `v0.1.7`; shipping the terminal-ready launch fix required a new parity-safe release tag.
**Decision:** Bump release metadata from `0.1.7` to `0.1.8` across:
- root `package.json`,
- `apps/desktop/package.json`,
- `apps/desktop/src-tauri/tauri.conf.json`.
Ran parity guard: `./scripts/verify-release-version.sh v0.1.8`.
**Rationale:** Keeps release history immutable and preserves enforced tag/version updater parity.
**Consequences:** Next release tag should be `v0.1.8` for this fix set.
**Alternatives Considered:** Reusing existing `v0.1.7` tag.

## [2026-02-12] - Sharp Pane Edges in Grid and Zoom Views
**Context:** Pane corners remained rounded in the active Soft UI override layer, which conflicted with the requested sharp pane geometry.
**Decision:** Normalize pane corners to square for pane-specific surfaces:
- set `.pane-card` border radius to `0` in both base and Soft UI override layers,
- set `.layout .react-grid-item.react-grid-placeholder` border radius to `0` in both base and Soft UI override layers,
- add a style contract assertion in `apps/desktop/tests/styles.soft-ui.test.ts` to lock sharp pane/placeholder corners.
**Rationale:** Ensures pane edges are visually sharp in normal grid and zoomed states without broad restyling of non-pane UI surfaces.
**Consequences:** Pane cards and drag placeholders are now consistently square; other UI elements keep their existing radius styling.
**Alternatives Considered:** Changing only `.pane-card` and leaving placeholder radius rounded.

## [2026-02-12] - Worktree Manager System (Create, Import, Remove, Prune)
**Context:** Existing worktree support only exposed `create_worktree` and `list_worktrees` backend commands, with no first-class lifecycle management in the app UI/store and no startup-safe discovery/import flow.
**Decision:** Implement a sidebar-first Worktree Manager with palette hooks and expanded backend command surface:
- added backend commands `resolve_repo_context`, `remove_worktree`, and `prune_worktrees`,
- upgraded `create_worktree` and `list_worktrees` responses to richer metadata (head/main/detached/locked/prunable/dirty),
- introduced store-managed worktree lifecycle actions (`openWorktreeManager`, `refreshWorktrees`, `createManagedWorktree`, `importWorktreeAsWorkspace`, `removeManagedWorktree`, `pruneManagedWorktrees`),
- added new `Worktrees` app section and dedicated manager component for safe create/import/remove/prune UX,
- integrated command palette with worktree manager actions and discovered worktree open/switch entries.
**Rationale:** Makes worktree operations explicit, safe, and workflow-native while preserving manual cleanup control and avoiding automatic workspace fan-out.
**Consequences:** Store/runtime flow is more stateful with per-repo manager state; backend now performs additional git metadata checks; UI gains a new section and action surface.
**Alternatives Considered:** Palette-only worktree actions, backend-only API expansion, and auto-opening all discovered worktrees on startup.

## [2026-02-12] - Local Automation Bridge for External CLI Control
**Context:** External orchestrators need to command SuperVibing directly (create panes/worktrees/branches and send commands) without coupling to internal frontend store APIs.
**Decision:** Add a localhost automation bridge with async job processing and frontend event handoff:
- start a local HTTP server at `127.0.0.1:47631` in the Tauri backend,
- expose `GET /v1/health`, `GET /v1/workspaces`, `POST /v1/commands`, `GET /v1/jobs/:jobId`,
- queue submitted commands and process them in a background worker with tracked job lifecycle (`queued`, `running`, `succeeded`, `failed`),
- add frontend-backend handshake (`automation:request` event + `automation_report` command) for UI-owned actions such as pane-count changes and worktree import,
- sync open workspace/pane runtime snapshots from Zustand to backend (`sync_automation_workspaces`) so external jobs can target stable workspace IDs.
**Rationale:** Provides a clear, language-agnostic automation surface for other local apps while preserving existing Tauri command boundaries and frontend ownership of workspace orchestration.
**Consequences:** App now hosts a local command endpoint and maintains transient automation job/workspace registries in memory; external clients must poll job status for completion outcomes.
**Alternatives Considered:** Direct IPC-only plugin integration, filesystem queue polling, and exposing raw internal Tauri command names to third-party callers.

## [2026-02-12] - Global Codex Skill for SuperVibing Automation Commands
**Context:** After adding the local automation bridge, users still needed a reusable Codex-side interface for issuing commands from CLI or other orchestrators without repeatedly hand-writing `curl` payloads and polling logic.
**Decision:** Create a global user-scope skill at `~/.codex/skills/supervibing-automation` with:
- `SKILL.md` usage guide and command recipes,
- `scripts/supervibing_automation.py` wrapper CLI for `health`, `workspaces`, `job`, `create-panes`, `create-worktree`, `create-branch`, and `run-command`,
- default submit-and-wait behavior with optional `--no-wait`,
- explicit health-check-only lifecycle (no app auto-start),
- `agents/openai.yaml` metadata for skill discovery.
**Rationale:** Standardizes how Codex and terminal callers invoke the bridge, reduces payload errors, and makes job handling deterministic.
**Consequences:** Automation usage is now script-driven and consistent across sessions; runtime success still depends on the desktop app being active and serving `127.0.0.1:47631`.
**Alternatives Considered:** Raw `curl` snippets only and repo-local-only skill distribution.

## [2026-02-12] - Extend Inactive Workspace Lifetime Before Auto-Suspend
**Context:** Inactive workspace panes were suspending after `120s`, which was too aggressive for context switching workflows and made workspaces feel short-lived.
**Decision:** Increase `INACTIVE_WORKSPACE_SUSPEND_MS` in `apps/desktop/src/store/workspace.ts` from `120 * 1000` to `10 * 60 * 1000` (10 minutes).
**Rationale:** Keeps workspace terminals active longer while still retaining eventual memory reclamation via auto-suspend.
**Consequences:** Higher short-term runtime memory usage when many workspaces are left inactive; fewer unnecessary suspend/resume cycles.
**Alternatives Considered:** Disabling auto-suspend entirely and making suspend timeout user-configurable in Settings.

## [2026-02-12] - Preserve Terminal Buffers When Switching Workspaces
**Context:** Switching between workspaces remounted `TerminalPane` components, which disposed xterm instances and visually cleared terminal history on return.
**Decision:** Keep per-workspace terminal grids mounted while in Terminal section:
- render a stacked `PaneGrid` per workspace in `apps/desktop/src/App.tsx`,
- hide inactive workspace grids via CSS (`workspace-grid-panel`) instead of unmounting,
- gate grid callbacks so only the active workspace can mutate layouts/zoom/focus.
**Rationale:** Preserves xterm in-memory buffer and viewport state across workspace switches without changing backend PTY ownership.
**Consequences:** Slightly higher frontend memory/DOM footprint while multiple workspaces are open; terminal state remains stable when switching tabs.
**Alternatives Considered:** Replaying buffered backend output on remount and disabling workspace switching unmount behavior at the store layer.

## [2026-02-12] - Add Terminal Copy Shortcut + Active-Visibility Refit
**Context:** Inside pane terminals, `Ctrl+Shift+C` did not copy selected output reliably, and newly created workspaces could render terminal glyphs with incorrect spacing until a later pane/layout change triggered a refit.
**Decision:** Update frontend terminal runtime behavior:
- add xterm custom key handling in `apps/desktop/src/components/TerminalPane.tsx` to consume `Ctrl+Shift+C` and copy current selection to the clipboard,
- keep empty-selection behavior as a no-op (do not emit terminal input),
- add multi-stage terminal refit/resize on startup (immediate + next frame + fonts-ready),
- pass active workspace visibility state (`isActive`) from `App.tsx` through `PaneGrid.tsx` to `TerminalPane.tsx`,
- trigger a refit/resize when a pane transitions from inactive to active visibility.
**Rationale:** Ensures expected terminal copy ergonomics and removes first-render font/cell measurement drift caused by hidden-pane initialization timing.
**Consequences:** Slightly more frontend resize calls during pane startup/activation; no backend API changes.
**Alternatives Considered:** Handling copy only at global app keydown layer, and relying solely on `ResizeObserver` without explicit activation-triggered refit.

## [2026-02-12] - Add tmux Prefix Shortcut Layer for Pane Control
**Context:** Pane shortcuts used custom `Ctrl/Cmd+Alt` bindings that did not match tmux muscle-memory flows requested by users.
**Decision:** Introduce a tmux-style prefix controller in `apps/desktop/src/App.tsx`:
- add `Ctrl+B` prefix handling with a `1000ms` armed timeout,
- map core prefixed commands to pane operations:
  - split/add pane: `%`, `"`, `c`,
  - cycle/focus pane: `n`, `p`, `o`, `0..9`,
  - directional focus: arrow keys,
  - zoom toggle: `z`,
  - close/decrease pane count: `x`, `&`,
  - freeform resize: `Alt+Arrow`,
- keep existing global app shortcuts (`Ctrl/Cmd+N`, `Ctrl/Cmd+P`, `Escape` overlays),
- add store action `resizeFocusedPaneByDelta` in `apps/desktop/src/store/workspace.ts` for keyboard-driven focused-pane resize in freeform mode only,
- update shortcut documentation surfaced in Settings and add regression coverage in `App.shortcuts.test.ts` and `workspace.test.ts`.
**Rationale:** Aligns pane keyboard workflow with tmux defaults while preserving existing global app navigation ergonomics.
**Consequences:** Non-tmux pane shortcuts are removed from global handler; tmux prefix state is now part of keyboard event flow.
**Alternatives Considered:** Keeping legacy pane shortcuts in parallel, and implementing full tmux command/copy-mode emulation in one pass.

## [2026-02-12] - Startup Crash Recovery + Local State Reset Path
**Context:** App launch could flash and end in a black screen when startup or render failed, leaving users without an in-app recovery path.
**Decision:** Add layered startup resilience in frontend/store:
- wrap root render with `StartupErrorBoundary` and recovery fallback UI,
- add startup failure capture in workspace bootstrap (`startupError` with bootstrap `try/catch`),
- add local-state recovery action `resetLocalStateAndRebootstrap`,
- add persistence reset API in `src/lib/persistence.ts` using plugin-store `reset()` + `save()`,
- log startup `error`/`unhandledrejection` events with `[startup]` prefix for debugging.
**Rationale:** Ensures startup failures are visible and recoverable without terminal intervention, while preserving quick retry and actionable diagnostics.
**Consequences:** Startup flow now has explicit failure states and reset affordances; local reset may clear saved session/snapshot/blueprint state by design.
**Alternatives Considered:** Silent auto-reset, log-only failure handling, and relying solely on external debug tooling.

## [2026-02-12] - React 19 Selector Stability Hardening for Zustand Subscriptions
**Context:** Browser console showed React external-store stack traces (`getRootForUpdatedFiber`, `forceStoreRerender`, `updateStoreInstance`) and occasional black-screen startup behavior, indicating unstable selector outputs in `useSyncExternalStore` subscription flow.
**Decision:** Refactor `App.tsx` selector wiring to remove nested derived arrays from `useShallow` object selectors:
- extract `selectWorktreeManagerCore` for stable worktree-manager fields,
- extract `selectOpenWorkspacePaths` as an independent selector,
- stop returning `openWorkspacePaths: state.workspaces.map(...)` inside the `worktreeManager` object selector.
Added regression tests in `apps/desktop/src/App.selectors.test.ts` to document and prevent the prior unstable selector shape.
**Rationale:** React 19 is stricter about snapshot stability; separating derived arrays from object selectors avoids false-positive selection changes and rerender thrashing.
**Consequences:** App store subscriptions are more deterministic under frequent updates; selector intent is explicit and test-covered.
**Alternatives Considered:** Keeping existing selector shape and suppressing runtime noise, or downgrading React instead of fixing selector semantics.
