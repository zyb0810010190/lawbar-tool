# Project Contract

Single source of truth for Claude Code, Codex CLI, and Gemini CLI. `CLAUDE.md` and
`GEMINI.md` must remain exactly `@AGENTS.md` — do not add prose to them while cc-suite
manages the bridge. Keep this file under 32 KiB (Codex truncates above that). Long
procedures belong in skills, not here; execute the lifecycle with `/workflow`.

## Output language

All output renders in English: code comments, commit messages, reports, prose. Material in
another language is input — translate it to English before acting.

## Operating model

Operate by Work Item. A WI is the unit of authorized change; completing one does not
authorize the next. Every non-trivial WI declares, before editing: scope, source of truth,
allowed files, forbidden files, gates, review path, commit boundary, report.

WI types: PLAN, SOURCE, ASSET, IMPL, TEST, REVIEW, EVIDENCE, CLOSURE, SCAFFOLD, WORKFLOW,
MEMORY, UI. Never mix product changes with scaffold/workflow changes in one WI. A `Type: UI`
WI may enter a governed queue only with a concrete `Design artifact:` reference (enforced by
`check-queue.sh`; see `UI-GATES.md`). Manual or interactive PRs that touch app UI paths must
also carry a concrete `Design artifact:` line in the PR body (enforced by GitHub Actions).
Full UI automation is not enabled yet.

## Source hierarchy

When sources conflict, stop and report — do not choose silently. Precedence:
1. Current explicit user authorization
2. Approved plan or active WI
3. Committed source, spec, and design assets
4. Provenance records
5. Tests and gates
6. Current repository state
7. Prior conversation or memory (advisory only)

Generated local output beats static documentation when they conflict — trust the file a
tool actually produces over any doc describing it, including this one. Record the tool
version and date when this happens.

## Gates and hard stops

Run declared project gates before commit. A WI does not advance past a failing gate unless
the failure is explicitly accepted or its fix is inside the current WI's scope.

Hard stops (halt and report):
- source conflict
- missing required source/spec/asset
- gate failure whose fix is outside scope
- delegated-agent stall, failure, or unavailability
- forbidden or unrelated file touched
- secrets or production-data exposure risk
- weakening a hard stop, gate, or secrets rule without explicit approval
- commit would include unrelated files

## Commit policy

Stage exact paths only. Allowed: `git add <path> <path>` then
`git diff --cached --name-only`. Forbidden without explicit authorization: `git add .`,
`git add -A` (enforced by `block-git-add-all.sh`).

Commit authorization depends on mode:
- **Gated mode** (`AUTO_ADVANCE_MAX=1`): stop before committing unless commit authorization
  is explicit (a `dev-memo/run/human.ack`).
- **Autonomous batch mode** (`AUTO_ADVANCE_MAX`>1): a WI listed in a *governed*
  `dev-memo/run/queue.md` may commit after passing per-WI gates, cc-suite review/audit/verify,
  staged-file verification, and the batch-control checks enforced by `batch-commit-guard.sh`
  (breaker not exceeded, no audit due, no pending risk flag).

**Push is never automatic.** Batch mode may create local commits; it does not push unless
push authorization is explicit. Local commits are revertable; pushed commits are shared
state — keep them separate.

After push, report: commit hash, push output, `git status --short`, `git log --oneline -4`,
exact files committed, next lane status.

## Delegation (bidirectional via cc-suite)

Claude and Codex delegate to each other through two separate MCP transports:

- **Claude → Codex** via the `codex-cli` MCP server (needs the `codex` binary on PATH).
  From Claude: `/audit`, `/implement`, `/review-plan`, `/bug-analyze`, `/verify`,
  `/continue`, `/result`, `/status`, `/preflight`, `/cancel`.
- **Codex → Claude** via the `claude-code` MCP server (claude-octopus, run through
  `npx -y`; reuses the Claude CLI login). From Codex, invoke with `$`: `$claude-review`,
  `$claude-plan`, `$claude-implement`, `$claude-debug`.

`/cc-suite:init` wires both. The Codex→Claude path additionally requires Codex to have
marked the project **trusted** (otherwise `.codex/config.toml` — and thus the `claude-code`
server — silently does not load). `/cc-suite:status` reports exactly what is missing.

Either direction's output is advisory unless that agent is explicitly authorized as the
implementation lane. Delegation calls carry a provenance disclosure, so the receiving agent
evaluates the work with full rigor rather than deferring to it.

No assumed automatic fallback. If a delegated agent stalls, fails, or is unavailable: mark
the lane `DELEGATE-STALLED` / `DELEGATE-FAILED` / `DELEGATE-UNAVAILABLE`, preserve partial
output, continue with the local agent's own review or native gates, and never treat a
failed delegation lane as review clearance.

### Background-invocation discipline (HARNESS_REAP)

Full rule: `.claude/rules/cc-suite.md` §"Background-invocation discipline" (RCA
`dev-memo/ccsuite-path1-rca-01.md`, commit `d3e1cbc`). Non-negotiable:

- **Never** wrap cc-suite / Codex / `codex-runner.mjs` in a Claude Code Bash-tool call with
  `run_in_background: true` — the harness reaper can kill the orchestrating shell before the
  runner writes terminal state, orphaning a `running` job (the HARNESS_REAP failure class).
- **Allowed**: runner foreground (blocks on the JSON envelope) OR the runner's native
  `--background` flag (returns a jobId in <1s; the detached worker survives the session).
- A valid native `--background` call returns a jobId promptly; if none appears, stop and
  diagnose — do not blind-poll the wrapping Bash call.
- Recover an orphan by flipping its `state.json` entry `running` → `failed`, then re-run
  foreground or native `--background` (not direct-MCP — the wrapper is the root cause).

### echo-sleuth continuity (compatible triggers)

Full rule: `.claude/rules/echo-sleuth.md`. echo-sleuth is a memory layer, not a review layer;
it MUST NOT edit product source, stage/commit/push, or bypass cc-suite. Triggers, in WI terms:

- **Before a major WI** (new plan, ADR, RCA, batch start): `/echo-sleuth:recap`, cited in the
  WI's pre-flight.
- **After an RCA WI, before closing it**: `/echo-sleuth:extract`, promoting the lesson into the
  relevant `.claude/rules/*.md` as a permanent anti-pattern / recovery section.
- **Before editing any `.claude/rules/*.md`**: `/echo-sleuth:lessons` or `recall <rule>` to
  surface prior decisions; a new edit supersedes them (recorded) or matches them.
- **At WI boundaries**: `/echo-sleuth:audit` + `/echo-sleuth:dashboard`; resolve staleness by
  updating the rule or `/echo-sleuth:prune`, with the reason in the commit message.

## Autonomy policy (autonomous queued batches)

Chosen posture: **automation executes; the human studies after.** The agent self-advances
through a bounded, pre-authorized queue, commits per WI, and leaves a study/audit trail to
review afterward — rather than approving each WI before commit.

The non-negotiable boundary: **the agent may advance through tasks already in
`dev-memo/run/queue.md`; it may NOT invent the next task.** Generating a queue and executing
a queue are different authorities (see "Queue governance" below). A Codex `PASS` lets a WI
commit and the next *queued* WI begin — it is never authority to create new work.

Modes (`AUTO_ADVANCE_MAX` in `dev-memo/run/config`):
- `1` — gated: stop after every WI (use when learning a new area).
- `3` — canary batch: prove the queue is sound on a small run first.
- `10` — full batch.

Per-WI, always (Layer A): baseline → file-boundary → scoped implement → gates (tests/lint/
typecheck/build; UI gates if UI) → Codex review/audit/verify → exact-path stage → staged-file
check → one commit → append `dev-memo/run/log.md`.

Batch audit (Layer B): after every N commits, run the major audit (see `BATCH-AUDIT.md`)
plus the echo-sleuth study packet. Continue only if the audit passes.

Risk triggers (Layer C) — force an immediate batch audit *before* N, on any of: >5 files in
one WI; >300 net LOC in one WI; a new dependency; a public-API change; any change to auth,
payments, permissions, deployment, storage, migrations, or security files; tests deleted or
weakened; the same file edited in 3 consecutive WIs; any UI gate failure.

Hard stops (halt the whole batch, wait for a human): Codex `FAIL`/stall/unavailability,
gate failure, forbidden-file touch, queue ambiguity, scope conflict, breaker limit reached.
Never treat a stall or missing verdict as a pass — two models agreeing is not independent
verification.

Recoverability is the safety net for study-after-ship: every WI is one revertable commit
logged in `dev-memo/run/log.md`. A bad result that shipped can be `git revert`'d task by
task. This is why the audit trail is mandatory in batch mode, not optional.

## Queue governance

Generating a queue and executing a queue are different authorities. The agent may propose a
queue (a PLAN WI), but a proposed queue is not executable until it passes governance:

1. Codex reviews the proposed queue (`/review-plan`).
2. A queue-lint check confirms every WI has: a concrete scope, declared allowed files,
   declared gates, no forbidden-area touch, no dependency on a later WI, and concrete
   acceptance criteria — no bare "cleanup", "refactor", or "improve".
3. Only after both pass does the queue become authorized for a batch run up to
   `AUTO_ADVANCE_MAX`.

This is the boundary that prevents a closed self-authorizing loop: the agent can suggest
what to do next, but cannot treat its own suggestion as permission to do it.

## Authoring discipline

Hold the nouns; let the model do the verbs — thesis, decisions, and judgment stay human;
drafting, structure, and mechanical edits are model work. Flag, don't silently fix: surface
issues for a decision unless the WI authorizes the fix. Verify every named thing (library,
API, version, command, generated file, tool behavior) against the real artifact before
relying on it.

### Contract-doc integrity (never markdown-autofix the always-loaded contracts)

`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `.claude/rules/*.md` are always-loaded contract docs
(`CLAUDE.md` and `GEMINI.md` import `AGENTS.md` verbatim). Do NOT run markdown autofix, editor
format-on-save, remark, or markdownlint autofix on them: such formatters silently corrupt the
contract — encoding line breaks as numeric HTML character entities, backslash-escaping punctuation,
and emitting stray emphasis runs — which then changes the rules every agent loads. A commit-boundary
guard (`.claude/hooks/block-contract-corruption.sh`) denies a `git add` / `git commit` that would
stage a corrupted contract doc, and `scripts/workflow/check-contract-integrity.sh` runs the same
check standalone (use it as a pre-push / CI gate). Disable editor format-on-save — or add an ignore
rule — for these paths.

## Self-improvement bounds

Improve scaffold/workflow only through a SCAFFOLD, WORKFLOW, or MEMORY WI. Allowed: refine
templates, scripts, the workflow skill, path-scoped `.claude/rules/` (when the need is
real); record friction; propose tooling changes. Not allowed without explicit approval:
weaken a hard stop or gate, broaden file permissions, change secrets policy, make a
delegated agent mandatory, or change deployment/security policy.

## Repo brief — lawbar-tool

Local-first legal-document tool; v1 primary client is the Mac desktop app
(`.claude/rules/client-local-first.md`). Architecture:

- **Contract hub** `docs/contracts/` (incl. `docs/contracts/case-box-contract/`) — the
  vocabulary owner.
- **Services** `services/ocr-worker/`, `services/ocr-persistence/`,
  `services/case-box-persistence/`, `services/ocr-ingestion/`, `services/ocr-review/`.
- **Desktop client** `apps/lawbar-desktop/`.

Node: the contract package and services require **Node 22+** (JSON import attributes); Node 20
is insufficient. `services/ocr-persistence` is pinned to Node 22.x/24.x (`engines` `<26.0.0`)
and runs a `better-sqlite3` ABI smoke check as `pretest`
(`services/ocr-persistence/scripts/abi-smoke.mjs`) so a stale native binding fails as a clear
`[abi-smoke] FAIL`, not an opaque `ERR_DLOPEN_FAILED`. A Node 26 bump is a separate WI.

### Critical invariants (no violation without an ADR + explicit approval)

- **Contract = vocabulary owner. Queue = transport. Persistence = source of truth.**
- **Coordinator owns lifecycle**; the adapter must not own lifecycle.
- Queue dedupe key = `job_id` + canonical submission JSON, not transport metadata.
- `OcrQueueError` codes are stable and class identity is preserved across import paths:
  `dedupe_conflict`, `unknown_receipt`, `stale_receipt`, `lease_expired`, `invalid_claim`.
  **Do not collapse** `unknown_receipt` / `stale_receipt` / `lease_expired`, and do not
  rename/remove codes without an ADR (`.claude/rules/security-boundary.md`).
- No simplifying the queue/persistence split; no FK from queue rows to `ocr_jobs`; no
  read-layer re-sorting that masks persistence bugs.
- **Do not mutate fixtures** without updating BOTH schema and semantic tests.

### Test commands (per package/service)

```
npm --prefix docs/contracts test
npm --prefix docs/contracts/case-box-contract test
npm --prefix services/case-box-persistence test
npm --prefix services/ocr-persistence test
npm --prefix services/ocr-worker test
npm --prefix services/ocr-ingestion test
npm --prefix services/ocr-review test
```

The desktop UI gate is `npm --prefix apps/lawbar-desktop test`, run by
`scripts/workflow/check-gates.sh`.

### Test-environment & governance-sequencing notes

- **Native-module arch after packaging.** `npm --prefix apps/lawbar-desktop run dist`
  rebuilds `better-sqlite3` for the electron-builder `mac.target` arches (`arm64` and
  `x64`), which can leave the host `node_modules` binding on the wrong arch (e.g. x86_64
  on an arm64 host). The dev-Electron tests (`tests/smoke.electron.test.mjs`,
  `tests/main.test.mjs`, `test:ipc-packaged`) then fail with ~30s launch timeouts. A
  `postdist` script restores the host binding automatically via
  `electron-builder install-app-deps`; the manual restore is the same command. `npm test`
  is unaffected (no native rebuild in `pretest`).
- **Never bundle govern with its commit.** Do NOT run `mark-queue-reviewed.sh` /
  `govern-queue.sh` in the SAME Bash tool call as the dependent `git commit`.
  `batch-commit-guard.sh` is a PreToolUse Bash hook: it checks the PRE-refresh governance
  state and denies the WHOLE call before `govern-queue.sh` runs, so `queue.governed` never
  refreshes. Correct order: run mark-reviewed + govern **standalone**, verify the
  content-bound hash, then `git commit` in a **separate** Bash call.

### Project layout

- `.claude/` — skills, agents, rules, hooks, commands. `.agents/skills/` → symlink to
  `.claude/skills/` (Codex scan path). `.codex/`, `.gemini/` — Codex/Gemini bridges.
  `.mcp.json` — shared MCP registrations.
- Write rules/memory to `AGENTS.md` only; `CLAUDE.md` / `GEMINI.md` import it verbatim.

## Evidence-Genie M0 workflow composition

Authoritative decision record: `docs/adr/ADR-evidence-m0-xiaolai-workflow-composition.md` (EVW-00).
Port plan + proposed WI sequence: `dev-memo/plan-batch-casebox-evidence-workflow-port-00.md`.

The Evidence-Genie M0 work composes three layers; higher layers constrain lower ones, and no layer
may weaken an Evidence invariant:

1. **xiaolai workflow substrate** (reusable machinery, reused as-is) — `init-workspace`, `cc-suite`
   (Claude↔Codex broker + stop-review gate), `tdd-guardian`, `docs-guardian`, `loc-guardian`,
   `grill`, `echo-sleuth`. Do NOT hand-roll machinery xiaolai already provides (EVW-00 D1).
2. **Lawbar `.claude` orchestration** (this repo) — `rules/*.md`, hard hooks, the governed queue,
   the autonomy/cc-suite policy, least-privilege agents, and the workflow commands
   (`/feature-workflow`, `/fix-issue`, `/evidence-workflow`, `/evidence-geometry-gate`). It delegates
   generic verbs to layer 1 and specializes them for the domain.
3. **Evidence-Genie M0 domain gates** (most specific; never weakened) — the A0.7 geometry
   classification gate, A1 citation identity, A3 anchor resolution, A8 snapshot integrity/seal
   anti-circularity, A10 export reproducibility, and A1-T9 readable compression. Surfaced as the
   Evidence hard hooks, the future `rules/evidence-genie.md`, and the deterministic-JSON
   `native/evidence-core` harness command surface.

**Guardian-enablement posture (EVW-00 D3).** Enablement is decided per gate by teeth, not turned all
on. `cc-suite` + `echo-sleuth` stay on; `loc-guardian` stays the Lawbar rule (`.claude/rules/loc-guardian.md`),
the plugin off (single LOC authority); `tdd-guardian` is enabled with `blockCommitWithoutFreshGate: true`
for Evidence WIs only; `docs-guardian` / `grill` stay off until a real failure mode bites. The
stop-review gate is armed only if a live Codex CLI login is confirmed, never assumed-pass.

**Stop-grade invariant posture (EVW-00 D4).** The Evidence court-facing invariants get hard
(`exit 2` / `deny`) enforcement, not advisory rules: no Evidence UI before A0.7 is green; citations
single-source (A10-T1 contract / `DocumentPage` only); an `OptimizedDocumentRendition` is never a
citation/anchor basis; snapshot manifest/seal anti-circularity; offline entitlement (no network in
the Evidence surface). A `not_implemented` harness is FAIL, never a pass. A0.7 remains the first real
Evidence architecture gate — nothing builds on it until it is green and its failures classified.
