# Project Status

- Last Updated: 2026-02-12 (memory-first-runtime-cleanup)

- Current progress:
  - Completed memory-first cleanup and bottleneck pass:
    - inactive workspace auto-suspend reduced to `120s` (`workspace.ts`),
    - terminal scrollback capped to `400` lines per pane (`TerminalPane.tsx`),
    - PTY reader moved to named bounded-stack threads in Rust runtime with rollback on thread spawn failure (`src-tauri/src/lib.rs`).
  - Reduced idle frontend overhead:
    - `CommandPalette` and `NewWorkspaceModal` now mount only while open.
  - Reduced unnecessary state churn:
    - `setActiveWorkspaceLayouts` now ignores equivalent freeform layouts.
  - Removed dead code/artifacts:
    - deleted `src/components/SectionMenu.tsx` and `src/App.css`,
    - removed related `section-menu` CSS selectors/rules.

- Verification:
  - `pnpm --filter @supervibing/desktop test -- run`
  - `pnpm --filter @supervibing/desktop typecheck`
  - `pnpm --filter @supervibing/desktop build`
  - `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`

- Blockers/Bugs:
  - No build/test blockers.
  - Manual runtime verification still recommended for high-load memory behavior at 6 workspaces x 8 panes.

- Next immediate starting point:
  - Run `pnpm --filter @supervibing/desktop tauri:debug` and validate memory reclaim after 120s inactive workspace idle.
  - If needed, tune suspend delay (120s/60s) or scrollback depth (400/800) based on real-session behavior.
