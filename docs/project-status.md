# Project Status

- Last Updated: 2026-02-12 (pane-term-normalization)

- Current progress:
  - Implemented backend pane terminal env normalization in `apps/desktop/src-tauri/src/lib.rs`:
    - added `resolve_pane_term` helper,
    - `spawn_pane` now sets `TERM` explicitly on the spawned PTY command,
    - missing/empty/`dumb` -> `xterm-256color`,
    - valid non-empty values are preserved.
  - Added backend unit tests for `resolve_pane_term` covering:
    - missing/empty values,
    - case-insensitive `dumb`,
    - preservation of valid values (`screen-256color`, `xterm-kitty`).

- Verification:
  - `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`

- Blockers/Bugs:
  - None in local backend validation.
  - Manual app-level smoke test still pending to confirm pane startup UX in packaged/runtime environments.

- Next immediate starting point:
  - Run desktop app smoke test with agent pane startup (Codex/Starship):
    - confirm warning about `TERM=dumb` no longer appears,
    - confirm Codex interactive TUI starts without degraded terminal warning.
