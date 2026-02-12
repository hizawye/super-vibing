# Project Status

- Last Updated: 2026-02-12 (agent-auto-launch)

- Current progress:
  - Reissued agent init commands after `spawnPane` to improve workspace auto-launch reliability.
  - Backend init support remains available, but frontend now delays the write to avoid early PTY drops.

- Blockers/Bugs:
  - Pending manual verification that Codex starts in new workspace panes after the delay.

- Next immediate starting point:
  - Run `pnpm tauri:debug` and create a workspace with Codex allocation to confirm auto-launch.
  - If still failing, switch to first-output trigger and add a retry strategy.
