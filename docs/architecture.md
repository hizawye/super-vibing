# Architecture

SuperVibing is a desktop orchestrator built as a Tauri v2 app.

- Rust backend manages PTY lifecycle, pane I/O streaming, and Git worktree commands.
- React frontend renders pane grids, workspace tabs, and command UX.
- Zustand stores pane/layout/workspace state.
- Plugin store persists snapshots and quick-launch blueprints.
