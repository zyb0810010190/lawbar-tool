# WORKSPACE-00 — Autonomous Claude Workspace Guardrails

**Status**: Implemented (docs/config only). No code change.
**Date**: 2026-05-20.
**Scope**: project workspace layer enabling Claude (and Codex via cc-suite review/validate role) to drive routine project work under `bypassPermissions` / dangerous mode without per-step prompts, while preserving an absolute hard-stop list.

---

## 1. What was added

### 1.1 `.gitignore`
Reshaped to ignore local Claude/plugin state and secrets without ignoring curated artifacts:

- `.env`, `.env.*` ignored; `.env.example` kept tracked.
- `.cc-suite/` ignored (plugin cache/state).
- `.claude-english-buddy.json` ignored (local english-buddy config).
- `.claude/settings.json` ignored (local machine plugin enablement — previously partially tracked).
- `.claude/settings.local.json` ignored (already was).
- `.claude/tdd-guardian/` (entire dir, not just `state.json`) ignored.
- `.claude/**` is **not** blanket-ignored — curated rules, commands, skills under `.claude/` remain tracked.

### 1.2 `CLAUDE.md`
**Unchanged.** Project convention (`AGENTS.md` §Shared Memory) requires `CLAUDE.md` and `GEMINI.md` to import `AGENTS.md` only. The "always-loaded invariants" requirement from WORKSPACE-00 spec is satisfied via the existing `@AGENTS.md` import; new project-specific invariants live in `.claude/rules/` as path-scoped constraints.

### 1.3 `.claude/rules/` — path-scoped passive constraints
| File | Path scope | Purpose |
|---|---|---|
| `autonomy.md` | `**` | Pre-authorize routine plan/audit/fix/verify/commit; restate hard-stop list. |
| `staging-hygiene.md` | `**` | Explicit-staging discipline; exclude list; cached-diff confirmation; never push. |
| `security-boundary.md` | `services/ocr-worker/**`, `docs/adr/*ssrf*` etc. | SSRF/TLS/DNS/fetcher work must be bounded WI + tests + audit + verify; no silent error-surface drift; sub-WI sign-off ≠ go-live. |
| `client-local-first.md` | `docs/ui/**`, `docs/adr/*client*` etc. | Lock v1 = Mac desktop, local-first, mini-program companion deferred, gateway is not a website; lists forbidden v1 framings. |

### 1.4 `.claude/commands/` — one-shot repeatable commands
| File | Purpose |
|---|---|
| `branch-clean.md` | Read-only diagnostic: branch / HEAD / status; classify dirty entries; decide SAFE / DIRTY-RECOVERABLE / DIRTY-BLOCKING. |
| `commit-gate.md` | Evidence-gated commit with explicit staging, cached-diff print, never-push. Cites required test/audit/verify evidence before staging. |
| `continue-project.md` | Inspect plan corpus, select next unblocked WI, route to skill / commit-gate; stop on hard-stop trigger. |

### 1.5 `.claude/skills/` — multi-step branching workflows
| Skill | Purpose |
|---|---|
| `security-wi-loop` | Plan → review-plan → red tests → implement → tests → audit-fix → verify → sign-off doc → commit-gate. Used for SSRF/TLS/DNS/fetcher/auth/crypto WIs. |
| `client-architecture-reconcile` | Discover conflicting client/gateway/sync docs → detect conflicts → resolve via `plan-client-00.md` D2 + forbidden-framings → minimal doc edits → commit-gate. Docs-only output. |
| `project-autopilot` | End-to-end loop: branch-clean → read plan corpus → select WI → route by WI shape → verify gate → commit-gate → loop until stop condition. |

### 1.6 `dev-memo/workspace-00-plan.md`
This file.

---

## 2. Why each file belongs where it belongs

The ClauDepot workspace model splits durable instructions across four surfaces. The split chosen here:

- **`AGENTS.md` (existing, unchanged content for WORKSPACE-00)** — canonical shared memory imported by `CLAUDE.md` and `GEMINI.md`. Already contains the CC-Suite Autonomous Execution Policy, required loop, stop-and-ask gates. **Always loaded** (small enough for every turn).

- **`CLAUDE.md` (unchanged)** — single-line `@AGENTS.md` import. Project rule forbids direct edits. Treating it as the "short always-loaded invariants" file would duplicate AGENTS.md content.

- **`.claude/rules/`** — *path-scoped* passive constraints. Loaded contextually when files matching the scope are touched. Right surface for:
  - rules that apply broadly but don't need to be in every turn (`autonomy.md`, `staging-hygiene.md` — scoped to `**` but separated from AGENTS.md to keep AGENTS.md focused on policy text and rules focused on operational discipline);
  - rules with narrow path scope (`security-boundary.md`, `client-local-first.md`).

- **`.claude/commands/`** — *one-shot repeatable* operations. Each command runs to completion in a single turn and has a deterministic output. Right surface for `branch-clean`, `commit-gate`, `continue-project`.

- **`.claude/skills/`** — *multi-step workflows with branching*. Each skill has preconditions, ordered steps, decision points, and stop conditions. Right surface for `security-wi-loop`, `client-architecture-reconcile`, `project-autopilot`.

- **`dev-memo/workspace-00-plan.md`** — narrative artifact. Not a runtime instruction; a record of the workspace decision.

Repeated user prompts should *graduate* into commands or skills only after recurring. The three commands and three skills here all match recurring patterns visible in `dev-memo/`, `docs/release/`, and the security WI history — they are not speculative.

---

## 3. What remains local / ignored

The following are intentionally ignored from git and **must never** be staged (see `.claude/rules/staging-hygiene.md`):

- `.env`, `.env.*` — secrets.
- `.cc-suite/` — plugin cache / runtime state.
- `.claude/settings.json`, `.claude/settings.local.json` — local plugin enablement, per-machine.
- `.claude/tdd-guardian/` — tdd-guardian local state.
- `.claude-english-buddy.json` — local english-buddy config.
- `node_modules/`, `dist/`, `coverage/`, `*.tsbuildinfo`.
- `.codex/*` and `.gemini/*` except curated subdirs (preserved from prior `.gitignore` cc-suite block).

Any of these appearing under `git status` after a turn must be classified as **clutter / ignored leak** by `branch-clean` and excluded before commit.

---

## 4. How dangerous mode is constrained

`bypassPermissions` removes the per-tool prompt safety net. The WORKSPACE-00 layer compensates with these constraints, each of which is enforceable from the durable docs above:

1. **Hard-stop list** (`.claude/rules/autonomy.md`) — Claude must still stop before push, deploy, go-live, secrets, auth-provider choice, cloud-vendor choice, irreversible migration, production data, broad destructive delete, global config edit, exposing legal docs externally, new runtime dependency, breaking public API/wire-format/schema/CLI.

2. **Explicit staging** (`.claude/rules/staging-hygiene.md`, `.claude/commands/commit-gate.md`) — never `git add .` / `-A` / `-u`. Always per-path. Always `git diff --cached --name-only` before commit. Exclude list is enumerated.

3. **Never push** — push is on the hard-stop list and forbidden in `commit-gate.md` regardless of branch.

4. **Security-boundary discipline** (`.claude/rules/security-boundary.md`) — security WIs go through the full plan-review → tests → implement → audit → verify → sign-off chain. No silent surface change.

5. **Product-direction lock** (`.claude/rules/client-local-first.md`) — forbidden v1 framings (multi-firm SaaS, browser-first, default-on cloud, WeChat-primary, public HTTP API) cannot be introduced silently.

6. **Sub-WI sign-off ≠ go-live** — `security-boundary.md`, `autonomy.md`, and `project-autopilot/SKILL.md` all restate this. Go-live is hard-stop.

7. **Path scope of rules** — each `.claude/rules/` file declares its `applies-to` glob so it loads only when relevant, keeping the always-loaded surface (CLAUDE.md → AGENTS.md) small.

---

## 5. How future autonomous work should proceed

After WORKSPACE-00 commit lands:

1. `/continue-project` (or invoke `project-autopilot` skill) selects the next unblocked WI from `docs/release/go-live-plan.md`.
2. The selected WI is routed by shape:
   - Security-sensitive → `security-wi-loop`.
   - Client-surface / ADR reconciliation → `client-architecture-reconcile`.
   - General bounded code WI → plan → `/review-plan` (when in scope) → implement → tests → `/audit-fix` → `/verify` → `commit-gate`.
3. Each WI ends with `commit-gate` (explicit staging, cached-diff confirmation, no push).
4. After commit, the autopilot loops to step 1 unless a stop condition fires.

Likely first follow-up WI under the new policy: client-architecture reconciliation across `docs/adr/ocr-ui-gateway-architecture.md`, `docs/ui/ui-gateway-contract-draft.md`, and `dev-memo/case-box-plan.md` against `dev-memo/plan-client-00.md` — exactly the shape `client-architecture-reconcile` was written for. That WI is docs-only and does not require code or test changes; it can run autonomously under the new policy.

---

## 6. Validation performed in this turn

- `git status --short` before/after — confirmed only the intended files moved.
- `git diff --stat` — confirmed no code files changed.
- `.gitignore` greps confirmed `.env` and `.cc-suite` are ignored; `.claude/settings.local.json` is ignored and not staged.
- No secrets present in any added file.

---

## 7. Non-goals (deferred)

- No code change in any `services/**` package.
- No ADR rewrites — only rule + workflow scaffolding.
- No reconciliation of GW-00 vs case-box vs plan-client-00 *yet*. That is the first downstream WI.
- No changes to `AGENTS.md`. Existing policy text already covers the substance.
- No changes to global `~/.claude/**`. Hard-stop.

---

## 8. Commit

Single commit:

```
chore: add autonomous Claude workspace guardrails

- add minimal always-loaded Claude project invariants
- add path-scoped autonomy, staging, security, and client-local-first rules
- add reusable branch-clean, commit-gate, and continue-project commands
- add security WI, client architecture reconciliation, and project autopilot skills
- ignore local Claude/plugin state and secrets
- document dangerous-mode constraints for isolated worktree execution
```

Not pushed.
