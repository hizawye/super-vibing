# Project Status

- Last Updated: 2026-02-12 (updater-version-parity-0.1.3)

- Current progress:
  - Root-caused non-working `Check for updates` behavior to release metadata drift:
    - GitHub `latest.json` was served from `v0.1.2` assets but reported `version: 0.1.0`,
    - updater therefore treated installed `0.1.0` as current.
  - Implemented release parity guardrails:
    - added `scripts/verify-release-version.sh`,
    - validates tag format (`vX.Y.Z`) and strict equality with `apps/desktop/src-tauri/tauri.conf.json` version,
    - release workflow now runs guard before publish and installs `jq`.
  - Aligned version metadata to `0.1.3`:
    - `apps/desktop/src-tauri/tauri.conf.json`,
    - `apps/desktop/package.json`,
    - root `package.json`.
  - Improved updater UX in Settings:
    - added updater error normalization for network/signature/metadata parse failures,
    - `Check for updates` now surfaces actionable messages instead of generic failure text.
  - Added frontend tests for updater behavior in Settings section.

- Verification:
  - `pnpm --filter @supervibing/desktop test -- run`
  - `GITHUB_REF_NAME=v0.1.3 ./scripts/verify-release-version.sh`
  - Negative parity check confirms mismatch fails as expected:
    - `GITHUB_REF_NAME=v0.1.2 ./scripts/verify-release-version.sh` -> mismatch error

- Blockers/Bugs:
  - Corrective release tag `v0.1.3` is not published yet.
  - Until `v0.1.3` release artifacts exist, older installs may still report up-to-date due to stale published metadata.

- Next immediate starting point:
  - Commit and push updater parity changes.
  - Create and push tag `v0.1.3`.
  - Confirm published `latest.json` now reports `"version": "0.1.3"` and retest in-app updater flow from an older build.
