# Project Status

- Last Updated: 2026-02-12 (release-ci-and-in-app-updater)

- Current progress:
  - Added GitHub Release workflow for tag-based publishing (`v*.*.*`) on Linux runners:
    - new workflow: `.github/workflows/release.yml`,
    - validates required signing secrets before build,
    - builds + publishes release artifacts via `tauri-apps/tauri-action@v1` and uploads updater JSON.
  - Wired Tauri updater stack end-to-end:
    - added Rust plugin dependency and app plugin registration,
    - enabled updater artifacts in `tauri.conf.json`,
    - configured GitHub updater endpoint + public key,
    - granted `updater:default` capability.
  - Added Settings-based update flow in desktop UI:
    - `Check for updates`,
    - install prompt when update is available,
    - install progress and status messaging,
    - `Restart now` action after successful install.
  - Added frontend updater helper module and backend restart command bridge.

- Verification:
  - `pnpm --filter @supervibing/desktop typecheck`
  - `pnpm --filter @supervibing/desktop test -- run`
  - `pnpm --filter @supervibing/desktop build`
  - `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`

- Blockers/Bugs:
  - None in local validation.
  - GitHub repository secrets are still required for release signing to succeed:
    - `TAURI_SIGNING_PRIVATE_KEY`
    - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

- Next immediate starting point:
  - Add the two signing secrets in GitHub repo settings and push a `v*.*.*` tag to validate the release pipeline end-to-end.
  - Run a packaged app update smoke test from Settings (`Check for updates` -> `Install update` -> `Restart now`).
