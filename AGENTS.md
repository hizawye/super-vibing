# Project: SuperVibing

autonomous: true

## Mission
Build and maintain a production-grade Tauri desktop orchestrator with strict engineering rigor, clear docs memory, and deterministic verification.

## Repo Map
- `apps/desktop/src` - React + TypeScript frontend shell, workspace/pane UX, state wiring.
- `apps/desktop/src-tauri/src/lib.rs` - Rust backend, PTY lifecycle, automation bridge, git/github command surfaces.
- `packages/ui` - shared UI primitives and token contract.
- `docs/` - project memory and architecture source of truth.
- `scripts/` - release/version workflow automation.

## Tech Stack
- Core: Rust + Tauri v2, React, TypeScript, Zustand.
- UI: Tailwind + shared `@supervibing/ui` primitives + Radix foundations.
- Terminal: Xterm.js + `@xterm/addon-fit`.
- Layout: `react-grid-layout`.
- Tooling: pnpm workspace + Vite + Cargo.
- Tests: Vitest + Testing Library + Rust unit tests.

## Session Start (Mandatory)
1. Read `docs/project-status.md` and `docs/decision-log.md`.
2. Read `docs/architecture.md` when working on architecture, state model, backend interfaces, routing, or performance behavior.
3. Check local tree state with `git status --short` before edits.
4. Restore current constraints from `docs/tech-stack.md` and recent entries in `docs/changelog.md`.

## Planning and Decision Protocol
Apply this sequence for any non-trivial change:
1. Understand current behavior by reading relevant code, tests, and docs.
2. Design from first principles and list 2-3 viable approaches.
3. Choose one approach explicitly and record rationale.
4. Implement the smallest coherent change set.
5. Verify with strict checks (see verification gates).
6. Update docs memory and commit in phases.

### Unresolved Questions Block
Every non-trivial plan or design note must end with:
- `### Unresolved Questions`
- list blocking questions, or `None.`

## Strategic Question Policy
Ask questions only when one of these is true:
- ambiguity can cause major rework,
- decision changes core architecture/domain behavior,
- security/data-loss/compliance risk is involved.

Otherwise choose the best default, implement, and log the assumption in `docs/decision-log.md`.

## Implementation Standards (Non-Negotiable)
- Keep diffs small, reviewable, and style-consistent.
- Avoid broad refactors unless required for correctness.
- No `any`, no ignored lint/type/test failures.
- Preserve existing architecture boundaries:
  - frontend state in store slices,
  - backend process/runtime concerns in Rust backend,
  - shared visual primitives in `packages/ui`.
- For frontend updates, preserve accessibility, keyboard flow, and responsive behavior.
- For backend updates, preserve typed error semantics and predictable lifecycle cleanup.

## Verification Gates (Mandatory)
Run relevant checks before each implementation/testing/docs commit phase.

### Frontend-only changes
- `pnpm --filter @supervibing/desktop typecheck`
- `pnpm --filter @supervibing/desktop test -- run <affected tests>`

### Backend (`src-tauri`) changes
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` (when behavior or logic changed)

### Cross-cutting changes
- frontend gates + backend gates
- `pnpm --filter @supervibing/desktop build` when UI/runtime integration changed

### Release/version changes
- `pnpm run release:prepare -- X.Y.Z`
- `pnpm run release:verify -- vX.Y.Z`
- `pnpm run release:tag -- X.Y.Z` (only on clean parity-ready tree)

## Memory and Docs Engine (Always Active)
Maintain and keep accurate:
- `docs/project-status.md` - progress, blockers, immediate next step.
- `docs/decision-log.md` - dated decisions, rationale, alternatives.
- `docs/architecture.md` - architecture and interface evolution.
- `docs/tech-stack.md` - active stack and rationale.
- `docs/changelog.md` - human-readable change history.

### Docs Update Order (Required)
1. `docs/decision-log.md` (new decisions/assumptions first)
2. `docs/architecture.md` (if architecture/interface changed)
3. `docs/project-status.md` (current state and next action)
4. `docs/changelog.md` (user-facing summary)
5. `docs/tech-stack.md` (only when stack/tooling materially changed)

## Mandatory Multi-Phase Commit Protocol
Commit frequently at logical boundaries.

1. Design phase:
   - `docs: <brief architecture/plan note>`
2. Implementation phase:
   - `feat(scope): ...` / `fix(scope): ...` / `refactor(scope): ...`
3. Testing and polish phase:
   - `test(scope): ...` or `chore(scope): ...`
4. Docs sync phase:
   - `docs: sync project state`

Rules:
- Commits must be atomic and meaningful.
- Append commit hash + summary into `docs/decision-log.md` after each phase commit.
- Do not rewrite history unless explicitly requested.

## Safety Rules
- Never run destructive git commands (`reset --hard`, `checkout --`, force-rewrite) unless explicitly requested.
- Never revert unrelated user changes.
- If unexpected modifications appear during work, stop and ask before proceeding.
- Never perform destructive bootstrap on existing repos.

## Slash Commands
- `/status` -> `cat docs/project-status.md`
- `/context` -> `cat docs/project-status.md docs/decision-log.md docs/architecture.md`
- `/decisions` -> `tail -n 40 docs/decision-log.md`
- `/design` -> `cat docs/architecture.md`
- `/last` -> `git log --oneline -10`

## Skills Policy
- If user names a skill or task clearly matches a known skill, load that skill and follow it.
- Use the minimum set of skills needed; state selected skill(s) and order when multiple apply.
- If a skill is missing or blocked, state it briefly and use the best fallback.

## Definition of Done
- Behavior implemented and locally verified with required gates.
- Docs memory updated in required order.
- Phase commits created with conventional messages.
- No unresolved blockers left undocumented in `docs/project-status.md`.
