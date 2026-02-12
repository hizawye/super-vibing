# Project Status

- Last Updated: 2026-02-12 (workflow-fix-soft-ui-v0.1.5)

- Current progress:
  - Fixed failed `CI`/`Release` runs introduced by Soft UI contract test placement:
    - moved contract test from `apps/desktop/src/styles.soft-ui.test.ts` to `apps/desktop/tests/styles.soft-ui.test.ts`,
    - kept CSS contract assertions while removing Node-dependent files from frontend `tsc --noEmit` scope.
  - Fixed release workflow tauri-action input mismatch:
    - replaced invalid `uploadUpdaterJson` with supported `includeUpdaterJson: true` in `.github/workflows/release.yml`.
  - Bumped release metadata to `0.1.5` for clean tag/version parity:
    - `package.json`,
    - `apps/desktop/package.json`,
    - `apps/desktop/src-tauri/tauri.conf.json`.

- Verification:
  - `pnpm --filter @supervibing/desktop typecheck`
  - `pnpm --filter @supervibing/desktop build`
  - `pnpm --filter @supervibing/desktop test -- run` (44 tests passing)
  - `GITHUB_REF_NAME=v0.1.5 ./scripts/verify-release-version.sh` (parity verified)

- Blockers/Bugs:
  - No local blockers after typecheck/build/test pass.
  - GitHub Actions re-run for `v0.1.5` still required to confirm remote workflow success end-to-end.

- Next immediate starting point:
  - Commit and push workflow/test/version fixes.
  - Push release tag `v0.1.5`.
  - Confirm `CI` and `Release` workflows pass for the new tag.
