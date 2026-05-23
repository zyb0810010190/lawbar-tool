# Go-Live Plan

> **⚠ RECONCILIATION REQUIRED — this plan is NOT the current go-live readiness source of truth.**
>
> This plan was authored when the project's v1 framing was OCR-pipeline-as-product with case-box layer DEFERRED. The product direction has since pivoted: the case-box layer is now the v1 core product (Phase B SQLite implementation complete at `98446aa`), and the OCR pipeline is one supporting input. The v1 client is a Mac desktop application for a single lawyer, local-first, per `docs/product/project-requirements-brief.md` (status READY revision 5).
>
> As a result, this file's WI list (WI-00..WI-13) is partially obsolete and partially in-scope:
>
> - **8 WIs are SHIPPED** (WI-01..WI-03d via `docs/release/wi-03-security-signoff.md` commit chain `f96be47..ce3f287`; WI-09a scaffolds present).
> - **2 WIs are still in-scope unchanged** (WI-00 preflight, WI-00b preflight evidence).
> - **3 WIs need reframing for the Mac-client product** (WI-09b operator runbook, WI-10 fail-closed probe, WI-12 test matrix).
> - **4 WIs are status-unverified against current code** (WI-04, WI-05, WI-06, WI-07).
> - **4 WIs conflict with brief §20** (WI-11a..d — "Document text-extraction engine choice" is post-v1 STOP-AND-ASK per brief).
> - **1 WI is deferred** (WI-08, unchanged).
> - **1 WI is superseded** (WI-13 → go-live readiness blueprint gate #21 / WI #15 is the canonical successor).
>
> Most of the **21 readiness gates** required for v1 are NOT covered by this file at all (Mac-client surface, distribution + signing, 律师法 compliance, supply-chain posture, telemetry policy, backup + recovery, LICENSE + privacy notice, data-export certification, etc.).
>
> Until this banner is removed by a subsequent amendment WI, treat the documents below as the canonical go-live readiness sources:
>
> 1. **Go-Live Readiness Blueprint** — `dev-memo/plan-go-live-readiness-00.md` (status READY at commit `1b92c58` on `origin/main`). Enumerates the **21 readiness gates** + the **23 STOP-AND-ASK items** that gate v1.
> 2. **Legacy Reconciliation Report** — `dev-memo/plan-go-live-plan-reconcile-00.md` (status READY at commit `546fb09` on `origin/main`). Per-WI mapping of THIS file against the current state; proposes 8 amendment WIs (this banner is amendment WI #1).
>
> **Hard-stop posture**: go-live readiness still requires explicit user authorization for every item in `.claude/rules/autonomy.md` §"Hard-stop list" and brief §20. Phase B SQLite implementation completion does NOT imply go-live readiness.

## Autonomous Choice Policy

For routine execution choices, cc-suite must not ask the user to pick among options. It must choose the safest optimal path and continue.

Default choices:
- Choose the next executable WI with all predecessors satisfied.
- Use background cc-suite jobs for long review, audit, and validation.
- Use Claude writes / Codex validates unless the WI explicitly authorizes Codex writing.
- Use `/audit-fix` when fixes are allowed.
- Use `/audit` only for read-only or no-fix scopes.
- Use `/review-plan` before risky implementation.
- Use the smallest bounded change that satisfies the WI.
- Open bounded sub-WIs instead of expanding scope.

Stop and ask only when:
- production deployment or release publication is involved;
- secrets, credentials, billing, external accounts, or auth/authorization are involved;
- destructive commands or data deletion are involved;
- new runtime dependencies are required;
- public API, wire-format, schema, CLI, migration, persistence, or queue lifecycle approval is required;
- real fixtures or waivers are required from the user;
- no safe path forward exists.

If an action is blocked by a Stop-and-Ask gate, take the safest non-mutating preparatory action first. Pause only if no safe preparatory action exists.

## Cross-Cutting Policies That Apply To Every WI

User-authorized Codex-writes WIs: [] by default. The user may fill this list in the plan-acceptance turn for autonomous WIs, or authorize a specific Codex-writes Stop-and-ask WI in the current turn.

AGENTS.md required loop, verbatim:

> For each work item:
>
> 1. `/review-plan` before implementation when the change affects architecture, security, contracts, persistence, queue lifecycle, or multiple packages.
> 2. `/implement` for one bounded work item.
> 3. Run relevant local tests.
> 4. `/verify` after implementation.
> 5. `/audit` or `/audit-fix` on the changed scope.
> 6. Repeat until verification and audit pass.
> 7. Summarize changed files, tests run, remaining risks, and next recommended work item.

AGENTS.md stop-and-ask gates, verbatim:

> Stop and ask the user before:
> - Production deployment or release publication.
> - Database migrations on real data.
> - Secret, credential, billing, auth, authorization, or external account changes.
> - New runtime dependencies.
> - Public API, wire-format, schema, or CLI breaking changes.
> - Security-sensitive rewrites, including SSRF, TLS, DNS, crypto, auth, tenant isolation, or sandboxing.
> - Large cross-service refactors.
> - Deleting data, deleting files not clearly generated, or destructive shell commands.
> - Creating Git commits, tags, branches, or pushes unless explicitly authorized in the current task.

AGENTS.md mutation policy, verbatim:

> Codex-side tools are reviewers by default.
>
> Codex must not write code, modify files, create branches, apply patches, or mutate repo/task state unless the user explicitly authorizes implementation in the current turn.

AGENTS.md go-live rule, verbatim:

> The project is not ready to go live until:
> - All planned work items are complete.
> - All package tests pass.
> - Full audit has no unresolved Critical/High findings.
> - Security, migration, persistence, queue, contract, and API risks have been explicitly cleared.
> - A final go-live readiness report is produced.

Cross-cutting extension: any WI that adds or changes a schema column, public CLI flag, public API contract, wire-format field, persistence/queue lifecycle invariant, SSRF boundary, TLS boundary, DNS boundary, crypto/auth boundary, or release verdict is Stop-and-ask regardless of risk level.

Default ownership for implementation WIs is "Claude writes, Codex validates." Codex-writes ownership requires explicit user authorization recorded either in the plan-acceptance turn for autonomous WIs or in the current turn for Stop-and-ask WIs. The plan must list which WIs the user has authorized for Codex writes; otherwise default is Claude writes.

No WI may reference or write a release-doc path before WI-09a creates the release-doc scaffolds. Release-doc paths include `docs/release/ocr-worker-runbook.md`, `docs/release/operator-checklist.md`, `docs/release/test-and-audit-report.md`, `docs/release/go-live-readiness-report.md`, and `docs/release/go-live-plan.md`.

A WI is blocked until all listed predecessors are complete. Complete means verified, audited, and all acceptance criteria met. The autonomous loop must check predecessor status before starting any WI.

A WI tagged `Pause-pending-user-input` cannot proceed autonomously. The loop pauses, surfaces the question via the Stop-and-ask template, and resumes only after the user provides the required input.

Do not mutate `CLAUDE.md` or `GEMINI.md`; shared instructions and durable memory go only to `AGENTS.md`.

Node 22.x LTS is the pinned release line for final go-live evidence. Every test, audit, verify, and readiness-report invocation must capture `node --version` beside command output.

Any touched package must pass its package test command:

- `npm --prefix docs/contracts test`
- `npm --prefix services/ocr-persistence test`
- `npm --prefix services/ocr-worker test`
- `npm --prefix services/ocr-ingestion test`
- `npm --prefix services/ocr-review test`

## Branch, Commit, And Evidence Policy

Commits: by default, no `git commit`, `git tag`, `git push`, or `git branch` is created during the loop. Each WI's changes accumulate in the working tree. The user must explicitly authorize commits, for example "commit WI-XX" or "commit and continue", for any commit to happen. This implements the AGENTS.md stop-and-ask gate: "Creating Git commits, tags, branches, or pushes unless explicitly authorized in the current task."

Before starting WI-N, capture a WI baseline snapshot for the files in that WI's likely-file allowlist and any already-changed release docs it may touch:

- Create `.cc-suite/` if missing.
- Run `git diff <files> > .cc-suite/<wi-id>-baseline.patch`.
- If the working tree already contains cumulative accepted changes from prior WIs, this baseline patch is the reference that protects those earlier edits.
- After WI-N work, run `git diff <files> > .cc-suite/<wi-id>-after.patch`.
- Derive `.cc-suite/<wi-id>-current.patch` as the contribution made after the baseline. If a tool cannot derive it mechanically, the validator must inspect the two patches and save an explicit WI-only patch before rollback is permitted.

Rollback when uncommitted: do not use wholesale `git restore <files>` against files that may contain prior WI contributions. Revert only WI-N's contribution by applying the inverse of `.cc-suite/<wi-id>-current.patch` with `git apply -R .cc-suite/<wi-id>-current.patch`. If patch inversion fails, quarantine the WI and stop for manual review rather than erasing cumulative release-doc edits.

Rollback when committed: revert via `git revert <SHA>`. Because that creates a new commit, it also requires explicit user authorization.

Evidence in WI-13: the proof artifact is one of: commit SHA when the user authorized a commit, or working-tree diff hash using `git diff <files> | sha256sum` on Linux or `git diff <files> | shasum -a 256` on macOS when no commit exists. WI-13 must also list the per-WI `.cc-suite/<wi-id>-baseline.patch`, `.cc-suite/<wi-id>-after.patch`, and `.cc-suite/<wi-id>-current.patch` artifacts for completed, rolled-back, or quarantined WIs. Both commit and diff-hash forms count.

Branch policy: v1 ships from `main` unless the user explicitly authorizes a release branch. No branch creation happens in the autonomous loop.

## Validation Protocol

"Codex writes, Claude validates" means:

1. Codex writes the change with project context, constrained to the WI's "Likely files" allowlist and only if the WI is listed in User-authorized Codex-writes WIs or the current turn explicitly authorizes it.
2. Codex runs `git status --short` plus `git diff --stat` and confirms zero files outside the allowlist.
3. Codex reads each changed file end-to-end against the WI's acceptance criteria and records pass/fail per criterion.
4. Codex runs the WI's "Tests to run" locally and observes pass.
5. Codex runs the project-invariant checklist: contract vs queue vs persistence ownership, queue dedupe key, OcrQueueError code stability, OcrQueueError class identity, coordinator lifecycle ownership, no queue/persistence collapse, no collapse of `unknown_receipt` / `stale_receipt` / `lease_expired`, no FK from queue rows to `ocr_jobs`, no read-layer resorting that masks persistence bugs, no fixture mutation without schema and semantic tests, and Node 22+ for contract work.
6. Codex records evidence: file list reviewed, acceptance criteria pass/fail per item, tests passed with full count, invariants checked, time spent.
7. Then `/cc-suite:verify WI-XX` runs Claude adversarial verify on the changed scope.
8. Then `/cc-suite:audit` runs Claude adversarial audit on the changed scope.
9. Findings from `/verify` or `/audit` are either fixed in the same loop or escalated to a follow-up WI before this WI is marked complete.

"Claude writes, Codex validates" means:

1. Claude writes the change with project context, constrained to the WI's "Likely files" allowlist.
2. Claude runs `git status --short` plus `git diff --stat` and confirms zero files outside the allowlist.
3. Claude reads each changed file end-to-end against the WI's acceptance criteria and records pass/fail per criterion.
4. Claude runs the WI's "Tests to run" locally and observes pass.
5. Claude runs the project-invariant checklist: contract vs queue vs persistence ownership, queue dedupe key, OcrQueueError code stability, OcrQueueError class identity, coordinator lifecycle ownership, no queue/persistence collapse, no collapse of `unknown_receipt` / `stale_receipt` / `lease_expired`, no FK from queue rows to `ocr_jobs`, no read-layer resorting that masks persistence bugs, no fixture mutation without schema and semantic tests, and Node 22+ for contract work.
6. Claude records evidence: file list reviewed, acceptance criteria pass/fail per item, tests passed with full count, invariants checked, time spent.
7. Then `/cc-suite:verify WI-XX` runs Codex adversarial verify on the changed scope.
8. Then `/cc-suite:audit` runs Codex adversarial audit on the changed scope.
9. Findings from `/verify` or `/audit` are either fixed in the same loop or escalated to a follow-up WI before this WI is marked complete.

## Stop-and-Ask Approval Template

Before any Stop-and-ask WI begins, present:

Stop-and-ask approval required for WI-XX
- Risk: <one-line summary of why this gate triggered>
- AGENTS.md gate: <quote the relevant policy clause>
- Files/contracts affected: <exact paths, schema versions, public-API surfaces>
- Options: <bulleted list of approaches with one-line tradeoffs>
- Recommended path: <option name + one-sentence rationale>
- User approval needed: <yes/no/option-X>

The user must respond with one of: "approved as recommended" / "approved with option X" / "rejected - alternative <description>" / "defer this WI." No work begins on the WI until that response.

Pre-filled facts citing repo state, such as schema version, package versions, and file paths, must be re-read before presentation. If the cited fact has changed since this plan was last edited, regenerate the options before asking the user.

Pre-fill for WI-05:

Before presenting this prompt, re-read `services/ocr-persistence/src/sqlite/schema.ts` for the current `CURRENT_SCHEMA_VERSION`. If it is not `3`, regenerate option A/B.

Stop-and-ask approval required for WI-05
- Risk: monotonic CAS pending-retry write may require SQLite schema v4 + migration
- AGENTS.md gate: "Public API, wire-format, schema, or CLI breaking changes"
- Files/contracts affected: services/ocr-persistence/src/sqlite/schema.ts (CURRENT_SCHEMA_VERSION=3 after runtime recheck), services/ocr-persistence/src/sqlite/SqliteOcrPersistence.ts, services/ocr-persistence/src/inMemoryRepo.ts
- Options:
  - A: Keep schema v3 (pending_retry_submission_json TEXT only); implement CAS via SELECT-then-conditional-UPDATE inside an explicit transaction. This is production-safe only if WI-05 produces executable proof of single-coordinator-per-job-id: either a test demonstrating the race window does not occur under v1 deployment posture, or a deployment-config check that fails if more than one coordinator can run for the same job ID.
  - B: Bump to schema v4 with a generated `pending_retry_attempt INTEGER` column. CAS via `UPDATE ... WHERE pending_retry_attempt < ?`. Adds migration but eliminates the JSON-only race.
- Recommended path: B if v1 deployment posture admits >1 concurrent coordinator; A only if the single-coordinator-per-job-id proof is executable and included in WI-05 evidence.
- User approval needed: pick A or B

Pre-fill for WI-11a:

Stop-and-ask approval required for WI-11a
- Risk: v1 ships without real legal-document quality evidence unless real fixtures are supplied
- AGENTS.md gate: "Database migrations on real data" (analogous: introduces real-data fixtures) + "Public API, wire-format, schema, or CLI breaking changes" (fixture manifest schema)
- Files/contracts affected: services/ocr-worker-bakeoff/fixtures/manifest.json, services/ocr-worker-bakeoff/fixtures/real/*, docs/adr/ocr-engine-bakeoff-step-11a-1.md
- Options:
  - A: Supply >=2 redacted real Chinese-pleading fixtures (recommended for production-grade evidence)
  - B: Sign synthetic-only waiver (faster, but external validity claim disclaimed)
- Recommended path: A if real fixtures available; B with explicit residual-risk acceptance otherwise
- User approval needed: pick A (and supply fixtures), or B (and confirm waiver text)

## Failure, Rollback, And Quarantine Protocol

A failed WI is any WI where audit finds Critical/High that cannot be fixed in the same loop, verify returns FAIL, or cross-package tests fail.

Response:

1. Capture `.cc-suite/<wi-id>-after.patch` and derive `.cc-suite/<wi-id>-current.patch` against `.cc-suite/<wi-id>-baseline.patch`.
2. Revert only the WI's specific uncommitted contribution with `git apply -R .cc-suite/<wi-id>-current.patch`; if committed with user authorization, use `git revert <SHA>` only after new user authorization.
3. Reopen the WI as a new sub-WI with the failure cause stated.
4. Do not proceed to subsequent WIs that depend on it.
5. Record the rollback/quarantine event, baseline patch, after patch, current patch, and rollback result in the WI evidence and later in WI-13's readiness report.

## Sequence Rationale

This plan uses Option B for the WI-00 vs WI-09a ordering conflict: WI-00 is a preflight check with no file writes, WI-09a creates release-doc scaffolds, then WI-00b records preflight evidence into those scaffolds. This preserves the requirement that preflight happens before scaffolding while also enforcing the no-release-doc-write-before-scaffold rule.

WI-01 precedes production HTTPS work because ADR-11D.2-A gates the rewrite on a standalone TLS proof-of-concept. WI-02t creates the executable SSRF/TLS test spec before seam and transport code land. WI-02 and WI-03 remain Stop-and-ask because they touch SSRF, DNS, and TLS.

WI-04 depends on WI-03d and WI-09a because the final sub-WI of the WI-03 split closes the DNS-pinning boundary that WI-04 documents. WI-05 and WI-06 address ADR-11G operational gaps. WI-07 makes retry/dead-letter behavior operable for v1. WI-08 stays deferred because it is behavior-preserving refactor work.

WI-09b fills operator docs after recovery and observability choices are known; if WI-06 is deferred, WI-09b drafts the manual-recovery residual-risk language itself for later WI-13 inclusion instead of depending on WI-13. WI-10 verifies production fail-closed posture after the checklist exists. WI-11a through WI-11d separate fixture decision, harness validity, measurement execution, and final engine verdict. WI-11d has branch-conditional predecessors so the synthetic-only-waiver branch can still reach a verdict, and it depends on WI-10 so the engine verdict matches production fail-closed configuration. WI-12 and WI-13 are final evidence and readiness gates.

## v1 Bucket Definitions

- v1-blocking: incomplete means v1 is not ready.
- v1-blocking-conditional: v1-blocking on one branch, deferrable on another; WI evidence must record which branch applies.
- v1-required-but-deferrable: should land for v1, but may defer with explicit risk acceptance in WI-13.
- v1-deferred: out of v1.

## v1-Blocking Map

| WI | Bucket | Justification |
|---|---|---|
| WI-00 | v1-blocking | The autonomous loop depends on cc-suite/Codex compatibility, Node evidence, CVE triage, scope control, and rollback discipline. |
| WI-09a | v1-blocking | Release-doc stubs must exist before dependent operator-facing WIs write release docs. |
| WI-00b | v1-blocking | Preflight evidence must be recorded after scaffolds exist. |
| WI-01 | v1-blocking | Required TLS proof before SSRF-sensitive HTTPS rewrite. |
| WI-02t | v1-blocking | Test spec defines the SSRF/TLS security boundary before implementation. |
| WI-02 | v1-blocking | Passes vetted DNS answers through the fetcher seam; required to close SSRF gap. |
| WI-03a | v1-blocking | Transport core: `node:https.request` with custom lookup + per-request CA; locks `makeNodeHttpsRequestTransport` factory + export. |
| WI-03b | v1-blocking | Runtime address validation + internal transport error discriminators; un-skips the 15 ADR §5 cases. |
| WI-03c | v1-blocking | Response adapter: transport-owned strict Content-Length, Uint8Array chunks, abort propagation, 3xx return shape. |
| WI-03d | v1-blocking | TLS test harness + un-skip 33 transport tests; closes SSRF implementation gap subject to post-WI-03 security sign-off. |
| WI-04 | v1-blocking | Pins DNS-rebinding regression and operator-facing HTTPS policy. |
| WI-05 | v1-required-but-deferrable | Should land for v1; deferral requires explicit acceptance of pending-retry CAS risk. |
| WI-06 | v1-required-but-deferrable | Should land for v1; deferral requires explicit acceptance of manual recovery risk. |
| WI-07 | v1-blocking | Retry/dead-letter observability is required for operators to run v1 safely. |
| WI-08 | v1-deferred | Pure refactor; useful but not release-critical. |
| WI-09b | v1-blocking | Runbook/checklist are required for production exit-2 behavior and recovery posture. |
| WI-10 | v1-blocking | Production fail-closed behavior is the final safety net against fake worker usage. |
| WI-11a | v1-blocking | User must supply real fixtures or explicitly waive synthetic-only quality evidence. |
| WI-11b | v1-blocking-conditional | Blocking on the real-fixture branch; deferred-with-residual-risk on the synthetic-only-waiver branch. |
| WI-11c | v1-blocking-conditional | Blocking on the real-fixture branch; deferred-with-residual-risk on the synthetic-only-waiver branch. |
| WI-11d | v1-blocking | Required to lock default OCR engine or mark go-live blocked. |
| WI-12 | v1-blocking | Full test/audit sweep is required by AGENTS.md go-live rule. |
| WI-13 | v1-blocking | Final readiness report is required by AGENTS.md go-live rule. |

## Work Items

### WI-00 - Autonomous Execution Preflight Check

Goal: Prove the execution loop is trustworthy before release work begins. This WI performs checks only and writes no files.

Predecessor: none

Likely files:
- none; no file writes permitted

Acceptance criteria:
- `/cc-suite:status` is run and printed.
- cc-suite/codex-cli compatibility is checked. Current known local issue: `cc-suite v0.2.10` runner passes `--approval-policy never` and `--quiet` to codex-cli, both removed in codex-cli >=0.131. Local patch removes those two pushes from `runCodexSync` in `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.10/scripts/codex-runner.mjs`.
- Node release line is checked and final evidence line is pinned to Node 22.x LTS.
- `npm audit` is run for every package with a lockfile or install context used by v1 evidence.
- If `npm audit` surfaces multiple Critical/High CVEs, the loop does not attempt to fix all in one cycle. WI-00 prints the full audit output.
- For each Critical/High CVE, WI-00 opens a bounded sub-WI using the `WI-00-CVE-<package>-<advisory>` template below. Opening means adding an in-memory entry to the loop's work queue; WI-00 writes no files. WI-00b records the opened CVE sub-WIs durably in `docs/release/test-and-audit-report.md` after WI-09a creates the scaffold.
- Each CVE sub-WI is marked one of: `blocking` (must be resolved in its WI-00-CVE sub-WI before WI-12), or `residual-risk-candidate` (recorded for WI-13 decision). WI-00 does not wait on WI-13 and does not mark a CVE accepted as residual risk.
- Only non-breaking patch/minor upgrades may proceed autonomously within WI-00-CVE sub-WIs. Major upgrades require Stop-and-ask because they may trigger new runtime dependency or breaking-change gates.
- WI-00 completes when all Critical/High CVEs have bounded sub-WIs opened and classified as `blocking` or `residual-risk-candidate`, with no unresolved CVE left unclassified.
- Codex scope-violation protocol is printed: after any Codex-writes WI, run `git status --short` and `git diff --stat` before trusting Codex's report message.
- Prior-session pattern is cited: Codex with workspace-write sandbox added 5 unauthorized production-code changes to a doc-only task and reported success.
- Rollback/quarantine protocol is printed, including per-WI baseline/current patch artifacts.

CVE sub-WI mini-template:
- ID: `WI-00-CVE-<package>-<advisory>`
- Predecessor: usually `WI-00`; `none` only if the user authorizes parallel execution.
- Goal: for example, "upgrade better-sqlite3 to >=X.Y.Z to close GHSA-..."
- Acceptance criteria: `npm audit` is clean for that advisory in the affected package/install context.
- Tests to run: the affected package's test command from this plan.
- Audit command: `/cc-suite:audit --mini` on the upgrade diff.
- Writer/validator mode: `Claude writes, Codex validates` by default.
- v1 bucket: `v1-blocking` for Critical/High in production dependencies; `residual-risk-candidate` for Critical/High in devDependencies; `v1-deferred` for Medium/Low unless they touch a security path.

Tests to run:
- `node --version`
- `/cc-suite:status`
- `npm --prefix docs/contracts audit --audit-level=high`
- `npm --prefix services/ocr-persistence audit --audit-level=high`
- `npm --prefix services/ocr-worker audit --audit-level=high`
- `npm --prefix services/ocr-ingestion audit --audit-level=high`
- `npm --prefix services/ocr-review audit --audit-level=high`
- `npm --prefix services/ocr-worker-bakeoff audit --audit-level=high` if package exists and participates in WI-11 evidence

Verification command: `/cc-suite:verify WI-00`

Audit command: `/cc-suite:audit --mini AGENTS.md`

Risk level: Medium

Ownership: Claude writes, Codex validates

Autonomy: Autonomous OK

v1 bucket: v1-blocking

### WI-09a - Release Documentation Scaffold

Goal: Create release documentation stubs before implementation WIs reference or fill release docs.

Predecessor: WI-00

Likely files:
- `docs/release/ocr-worker-runbook.md`
- `docs/release/operator-checklist.md`
- `docs/release/test-and-audit-report.md`
- `docs/release/go-live-readiness-report.md`

Acceptance criteria:
- `docs/release/ocr-worker-runbook.md` exists with headings for HTTPS source policy, production profile, retry/dead-letter observability, pending-retry recovery, fail-closed behavior, and day-0 operations.
- `docs/release/operator-checklist.md` exists with headings for Node version, dependency audit, production config, fail-closed probes, queue/persistence checks, rollback, and evidence capture.
- `docs/release/test-and-audit-report.md` exists with headings for command, Node version, timestamp, pass/fail, skipped count, audit thread, unresolved findings, CVE sub-WIs, and diff-hash/commit evidence.
- `docs/release/go-live-readiness-report.md` exists as a stub with WI-13's required section order.
- Stubs contain no unverified claims of passing tests, cleared risks, or readiness.

Tests to run:
- `node --version`
- `npm --prefix docs/contracts test`

Verification command: `/cc-suite:verify WI-09a`

Audit command: `/cc-suite:audit --mini docs/release/ocr-worker-runbook.md docs/release/operator-checklist.md docs/release/test-and-audit-report.md docs/release/go-live-readiness-report.md`

Risk level: Low

Ownership: Claude writes, Codex validates

Autonomy: Autonomous OK

v1 bucket: v1-blocking

### WI-00b - Preflight Evidence Record

Goal: Record WI-00 preflight evidence into the release-doc scaffolds after WI-09a creates them.

Predecessor: WI-09a

Likely files:
- `docs/release/test-and-audit-report.md`
- `docs/release/go-live-readiness-report.md`
- `docs/release/go-live-plan.md`
- `AGENTS.md` only if durable policy text must be updated

Acceptance criteria:
- WI-00 command output is summarized with command, Node version, timestamp, pass/fail, and unresolved findings.
- cc-suite/codex-cli compatibility status is recorded, including plugin version and whether the local runner patch is still required.
- Evidence records that on any cc-suite plugin upgrade, the patch must be reapplied or upstream fix verified before trusting the bridge.
- CVE sub-WIs opened in memory by WI-00 are recorded durably with status: resolved, Stop-and-ask pending, `blocking`, or `residual-risk-candidate`.
- Rollback/quarantine procedure is recorded, including per-WI baseline/current patch artifacts.
- No release-doc path is referenced before WI-09a in the predecessor graph.

Tests to run:
- `node --version`
- `npm --prefix docs/contracts test`

Verification command: `/cc-suite:verify WI-00b`

Audit command: `/cc-suite:audit --mini docs/release/test-and-audit-report.md docs/release/go-live-readiness-report.md docs/release/go-live-plan.md AGENTS.md`

Risk level: Medium

Ownership: Claude writes, Codex validates

Autonomy: Autonomous OK

v1 bucket: v1-blocking

### WI-01 - HTTPS DNS-Pinning TLS Prototype Gate

Goal: Prove `https.request` can connect to a vetted IP while preserving original Host, SNI, and hostname certificate verification.

Predecessor: WI-00b

Likely files:
- `dev-memo/prototypes/https-dns-pinning-poc.mjs`
- `dev-memo/prototypes/https-dns-pinning-cert-helper.mjs`
- `dev-memo/spike-https-dns-pinning-undici.md`
- `docs/adr/ocr-fetcher-https-dns-pinning-step-11d-2-a.md`

Acceptance criteria:
- Prototype starts a local self-signed-CA HTTPS server on `127.0.0.1`.
- Prototype calls `https.request` against a URL whose hostname is the original allowed hostname.
- Custom `lookup` returns exactly `127.0.0.1`.
- Request Host header observed by the server equals the original hostname.
- TLS SNI observed by the server equals the original hostname.
- Per-request `ca` is used; `NODE_EXTRA_CA_CERTS` is not used.
- Cert valid for original hostname succeeds.
- Cert valid only for `127.0.0.1` fails certificate verification.
- ADR or memo records the exact command, Node version, and observed pass/fail result.

Tests to run:
- `node --version`
- `node dev-memo/prototypes/https-dns-pinning-poc.mjs`
- `npm --prefix services/ocr-worker test`

Verification command: `/cc-suite:verify WI-01`

Audit command: `/cc-suite:audit --mini dev-memo/prototypes/https-dns-pinning-poc.mjs dev-memo/prototypes/https-dns-pinning-cert-helper.mjs dev-memo/spike-https-dns-pinning-undici.md docs/adr/ocr-fetcher-https-dns-pinning-step-11d-2-a.md`

Risk level: High

Ownership: Claude writes, Codex validates

Autonomy: Autonomous OK

v1 bucket: v1-blocking

### WI-02t - HTTPS DNS-Pinning Regression Test Spec

Goal: Write the regression test suite spec before implementation so WI-02 and WI-03 are constrained by reviewed security-boundary tests.

Predecessor: WI-01

Likely files:
- `services/ocr-worker/tests/fetcher.https.test.mjs`
- `services/ocr-worker/tests/fetcher.https.transport.test.mjs`
- `docs/adr/ocr-fetcher-https-dns-pinning-step-11d-2-a.md`

Acceptance criteria:
- Test spec covers mixed public + private DNS answers rejecting with `host_resolves_to_private_ip`.
- Test spec covers zero vetted addresses rejecting before transport.
- Test spec covers production transport rejecting missing, empty, non-array, non-plain-object, non-string address, nonnumeric family, non-4/6 family, malformed literals, scoped literals, IPv4-mapped IPv6, family/address mismatch, and private addresses with `https_network_error`.
- Test spec covers first supplied vetted address selection with no transport reordering.
- Test spec covers cert valid for hostname passing while socket is pinned to a vetted IP.
- Test spec covers IP-only and wrong-host certs failing with `https_network_error`.
- Test spec covers strict `content-length`: leading zero, negative, non-integer, and duplicate values rejected with `https_network_error`.
- Test spec covers absent `content-length` streaming under existing size cap.
- Test spec covers `Buffer` chunks exposed as `Uint8Array`.
- Test spec covers manual 3xx handling with local HTTPS 302.
- Test spec covers abort before connect, before headers, and mid-body mapping to `https_timeout`.
- Tests may fail before WI-02/WI-03 implementation, but the expected failure mode is recorded.

Tests to run:
- `node --version`
- `node --test services/ocr-worker/tests/fetcher.https.test.mjs`
- `node --test services/ocr-worker/tests/fetcher.https.transport.test.mjs`

Verification command: `/cc-suite:verify WI-02t`

Audit command: `/cc-suite:audit --full services/ocr-worker/tests/fetcher.https.test.mjs services/ocr-worker/tests/fetcher.https.transport.test.mjs docs/adr/ocr-fetcher-https-dns-pinning-step-11d-2-a.md`

Risk level: Critical

Ownership: Claude writes, Codex validates

Autonomy: Stop and ask first

v1 bucket: v1-blocking

### WI-02 - Pass Vetted DNS Addresses Through The Fetcher Seam

Goal: Tighten the HTTPS transport interface so `fetchFromHttps` passes the fully vetted DNS answer set into transport. **Seam-only change**: production transport behavior (global `fetch` → `node:https.request`) is deferred to WI-03; SSRF closure is not complete at WI-02.

Predecessor: WI-02t (including `fix: replace blocked WI-02t seam fixtures`).

Likely files:
- `services/ocr-worker/src/fetcher/types.ts`
- `services/ocr-worker/src/fetcher/fetchPageBytes.ts`
- `services/ocr-worker/src/fetcher/httpsTransport.ts`
- `services/ocr-worker/tests/fetcher.https.test.mjs`
- `docs/adr/ocr-fetcher-https-dns-pinning-step-11d-2-a.md`

HTTPS transport stubs to update (named explicitly):
- `makeStubTransport` in `services/ocr-worker/tests/fetcher.https.test.mjs`
- `makeRecordingTransport` in `services/ocr-worker/tests/fetcher.https.test.mjs`
- Default factory `makeNodeFetchHttpsTransport` in `services/ocr-worker/src/fetcher/httpsTransport.ts` (signature only — see acceptance criteria)

Acceptance criteria:
- `DnsAddress.family` is typed as `4 | 6` as a compile-time seam narrowing only; runtime validation of the discriminated union is deferred to WI-03.
- `HttpsTransport.fetch` requires `init.allowedAddresses: ReadonlyArray<DnsAddress>`.
- `makeNodeFetchHttpsTransport` (default global-`fetch` transport) accepts `allowedAddresses` as a no-op; behavior change is deferred to WI-03. The signature changes; the body does not.
- `fetchFromHttps` rejects an empty DNS result before transport with the existing `https_network_error` code (no new fetcher error code in WI-02).
- `fetchFromHttps` rejects mixed public + private DNS answers with `host_resolves_to_private_ip`.
- `fetchFromHttps` passes the complete already-vetted public DNS answer list to transport as `init.allowedAddresses`, preserving resolver order as defined in ADR §1 / §4 (no re-sort, no family preference, no quiet subsetting).
- All existing HTTPS transport stubs (`makeStubTransport`, `makeRecordingTransport`, and the default factory) compile and include the new required parameter.
- No new public fetcher error code is introduced.
- WI-02 un-skips the three `Unlocked by WI-02` seam tests in `services/ocr-worker/tests/fetcher.https.test.mjs`, and they pass. Zero residual `Unlocked by WI-02` skips remain in that file at WI-02 completion.
- ADR §3 / §4 / §2.1 are updated to record that WI-02 lands seam-only; the production transport remains global `fetch` until WI-03.

Tests to run:
- `node --version`
- `npm --prefix services/ocr-worker test`
- `node --test services/ocr-worker/tests/fetcher.https.test.mjs`

Verification command: `/cc-suite:verify WI-02`

Audit command: `/cc-suite:audit --full services/ocr-worker/src/fetcher/types.ts services/ocr-worker/src/fetcher/fetchPageBytes.ts services/ocr-worker/src/fetcher/httpsTransport.ts services/ocr-worker/tests/fetcher.https.test.mjs docs/adr/ocr-fetcher-https-dns-pinning-step-11d-2-a.md`

Residual risk after WI-02: HTTPS fetches still flow through global `fetch`, so the SSRF gap (no DNS pinning at the socket layer) is NOT closed by WI-02 alone. SSRF closure completes at WI-03, not WI-02. Do not claim "SSRF fixed" at WI-02 commit.

Risk level: Critical

Ownership: Claude writes, Codex validates

Autonomy: Stop and ask first

v1 bucket: v1-blocking

### WI-03 split (overview)

The original monolithic WI-03 ("Replace Global Fetch With Pinned `node:https.request` Transport") has been split into four bounded, gated sub-WIs to reduce blast radius of a Critical-risk security rewrite. Each sub-WI is independently Stop-and-ask, runs its own audit-fix + verify loop, and produces a discrete commit with a discrete rollback boundary.

Locked decisions that apply to every sub-WI:
- **Factory name and export path**: factory is `makeNodeHttpsRequestTransport`, exported from both `services/ocr-worker/src/fetcher/index.ts` and `services/ocr-worker/src/index.ts`. The accompanying types `HttpsTransport` and `DnsAddress` are also re-exported from both index surfaces (`export type { HttpsTransport, DnsAddress } from "./types.js"`). After build, `import { makeNodeHttpsRequestTransport } from "<package>/dist/index.js"` resolves at runtime, and `import type { HttpsTransport, DnsAddress } from "<package>/dist/index.js"` resolves at TypeScript build time. WI-02t transport tests already reference the factory name.
- **Factory options contract**: `makeNodeHttpsRequestTransport(options?: { ca?: string | Buffer | Array<string | Buffer> })`. The empty-object call `makeNodeHttpsRequestTransport({})` must be valid because WI-02t stubs already use it. No new runtime dependencies.
- **Lookup callback behavior**: defensive dual-mode. **Both modes pin Node's lookup to `allowedAddresses[0]` only — the complete vetted list is NEVER returned to Node's lookup callback.**
  - Primary proved path (Node 22, `options.all === true`): callback returns a **single-element array** `[{ address: allowedAddresses[0].address, family: allowedAddresses[0].family }]`. Note: the array contains exactly one entry, not the full vetted list.
  - Defensive fallback (legacy `cb(err, address, family)` shape): callback returns `cb(null, allowedAddresses[0].address, allowedAddresses[0].family)`. Portability hardening only; not the primary proof path.
  - The complete vetted `allowedAddresses` list is consumed by the transport for input validation (WI-03b) and future policy decisions, but is never returned wholesale to Node's lookup.
- **Plain-object validation**: `Object.getPrototypeOf(value) === Object.prototype`. Arrays, `null`, functions, class instances, `Date`, and `Object.create(null)` are invalid.
- **No new public fetcher error codes**: WI-03* must not add entries to `FETCHER_ERROR_CODES`. Internal transport error discriminators (codes/classes on a transport-internal error type) are introduced and mapped to existing public codes by the fetcher.
- **TLS test infrastructure**: shared test helper module(s) live under `services/ocr-worker/tests/` (no production-test imports from `dev-memo/`). Prefer **static checked-in TEST-ONLY PEM fixtures under `services/ocr-worker/tests/fixtures/tls/`** over shelling out to OpenSSL during tests. Fixtures carry clear `TEST-ONLY — NOT A SECRET` headers in adjacent README/comment. If regenerating the fixtures requires OpenSSL, document that as a one-off maintenance script; tests themselves must not invoke OpenSSL.
- **127.0.0.2 loopback alias**: WI-03d adds a capability probe. If the alias is unavailable on the test platform, only the alias-dependent no-reorder test skips with a platform-specific reason — the rest of the transport suite remains active.
- **`package.json` scope**: only edited if `engines`, `scripts`, or test-gate scripts genuinely change. Default scope strikes it.
- **`cli.spawn.test.mjs:260` SIGINT flake** (pre-existing, reproduces at WI-02 baseline): carried forward as a risk note. Not fixed inside any WI-03 sub-WI.

Residual risk and sign-off:
- WI-03d closes the **DNS-rebinding / socket-pinning implementation gap**.
- Closing the gap in code does **not** equal go-live readiness. Post-WI-03d, the project still requires a separate security sign-off checkpoint (full audit pass, ADR sign-off, all v1-blocking WIs complete) before claiming SSRF is closed in production.
- The ADR's "Protocol-surface guardrails" section (appended in this revision) lists changes that, if introduced later, can silently re-open the gap and require a fresh ADR/review: HTTP/2 enablement, proxy support, switching `agent: false` to pooled `https.Agent`, or any form of socket reuse / keep-alive pooling on the HTTPS transport.

---

### WI-03a - Production HTTPS Transport Core

Goal: Ship a new pinned `node:https.request`-based transport factory `makeNodeHttpsRequestTransport` that pins the socket to `allowedAddresses[0]` via a custom `lookup`, preserves the original URL hostname for Host/SNI/cert verification, accepts per-request `ca` injection, and is reachable via the locked factory export. The existing `makeNodeFetchHttpsTransport` is retained as a thin compatibility wrapper delegating to the new factory, so the existing `fetchPageBytes.ts:41` import and `:550` default callsite continue to compile and run without WI-03a touching `fetchPageBytes.ts`. **No runtime validation, no response-adapter strictness, no test un-skips, no hard removal of the legacy factory — those are in subsequent sub-WIs.**

Predecessor: WI-02

Likely files:
- `services/ocr-worker/src/fetcher/httpsTransport.ts`
- `services/ocr-worker/src/fetcher/types.ts`
- `services/ocr-worker/src/fetcher/index.ts`
- `services/ocr-worker/src/index.ts`

`services/ocr-worker/src/fetcher/fetchPageBytes.ts` is NOT in WI-03a scope: the legacy-factory compatibility wrapper preserves its current call site. Any future direct migration from `makeNodeFetchHttpsTransport` to `makeNodeHttpsRequestTransport` at that call site must land as its own explicit sub-WI (target: WI-03d cleanup or a dedicated follow-up WI).

Acceptance criteria:
- **Canonical factory**: `makeNodeHttpsRequestTransport(options?: { ca?: string | Buffer | Array<string | Buffer> })` is the new canonical HTTPS transport factory. `makeNodeHttpsRequestTransport({})` is a valid call (WI-02t stubs already use it).
- **Exports**: `makeNodeHttpsRequestTransport` is exported from `services/ocr-worker/src/fetcher/index.ts` AND `services/ocr-worker/src/index.ts`. The types `HttpsTransport` and `DnsAddress` are re-exported from both surfaces. After build, `import { makeNodeHttpsRequestTransport } from "<package>/dist/index.js"` resolves at runtime, and `import type { HttpsTransport, DnsAddress } from "<package>/dist/index.js"` resolves at TS build time.
- **Non-skipped export smoke**: this command exits 0 after build:
  `node -e 'import("./services/ocr-worker/dist/index.js").then(m => { if (!m.makeNodeHttpsRequestTransport) throw new Error("missing makeNodeHttpsRequestTransport export"); console.log("ok"); })'`
- **Implementation core**: uses `node:https.request` with `agent: false`, `rejectUnauthorized: true`, `servername: url.hostname`. Manual redirect handling: transport does NOT follow 3xx; transport returns `{status, headers, body}` for redirects so the fetcher's existing `redirect_unsupported` mapping continues to work.
- **Lookup callback (dual-mode, both pinning to entry[0] only)**:
  - Primary (`options.all === true`): callback returns the single-element array `[{ address: allowedAddresses[0].address, family: allowedAddresses[0].family }]`.
  - Fallback (legacy `cb(err, address, family)`): callback returns `cb(null, allowedAddresses[0].address, allowedAddresses[0].family)`.
  - The complete vetted list is never returned to Node's lookup in either mode.
- **Per-request CA**: injection wired through `options.ca` (not `NODE_EXTRA_CA_CERTS`); global TLS state unchanged.
- **Hostname preservation**: Host header, URL hostname, SNI `servername`, and certificate verification all use the original URL hostname; the socket connects to `allowedAddresses[0]` only.
- **Legacy factory compatibility wrapper**: `makeNodeFetchHttpsTransport` remains as a thin compatibility wrapper around `makeNodeHttpsRequestTransport({})`. Hard removal / deprecation cleanup is DEFERRED outside WI-03a (target: WI-03d or a later cleanup WI). This prevents compile breakage at `fetchPageBytes.ts:41` (import) and `:550` (default callsite).
- **No new runtime dependencies**.
- **No new public fetcher error codes**: `FETCHER_ERROR_CODES` is unchanged.
- **Build clean**: `npm --prefix services/ocr-worker run build`. Existing tests still green (the 48 active `fetcher.https.test.mjs` cases + cross-package smokes); transport tests in `fetcher.https.transport.test.mjs` remain skipped — WI-03a does NOT un-skip them.
- **WI-03a boundary disclaimer (must not silently expand into other sub-WIs)**:
  - Runtime input validation under the global plain-object rule is DEFERRED to WI-03b.
  - Strict Content-Length parsing is DEFERRED to WI-03c.
  - Strict `Uint8Array` body-shape adaptation is DEFERRED to WI-03c.
  - Abort-phase mechanics (per-phase `req`/`res` destroy + iterator-throw normalization) are DEFERRED to WI-03c.
  - Transport-test un-skipping / full TLS harness activation is DEFERRED to WI-03d.
  - WI-03a must not silently implement WI-03b/c/d.
- **ADR §3 / §4 status update**: use this verbatim wording template (or equivalent that does not weaken the boundary): "WI-03a lands the pinned `node:https.request` transport core and package exports only. WI-03b runtime validation, WI-03c response adapter strictness, and WI-03d full TLS harness/test activation remain pending. WI-03a does not by itself complete the full WI-03 verification matrix or go-live security sign-off."
- **Evidence-claim limits**: WI-03a evidence claims are limited to (a) canonical factory exists, (b) exports reachable from `dist/index.js`, (c) lookup pins to `allowedAddresses[0]`, (d) TLS defaults (`agent: false`, `rejectUnauthorized: true`, `servername: url.hostname`) are fail-closed, (e) legacy wrapper preserves the existing call site. WI-03a does NOT claim full SSRF closure, runtime validation completeness, or response-adapter strictness; those claims are reserved for WI-03b/c/d respectively.

Tests to run:
- `node --version`
- `npm --prefix services/ocr-worker run build`
- `node -e 'import("./services/ocr-worker/dist/index.js").then(m => { if (!m.makeNodeHttpsRequestTransport) throw new Error("missing makeNodeHttpsRequestTransport export"); console.log("ok"); })'`
- `npm --prefix services/ocr-worker test`
- `node --test services/ocr-worker/tests/fetcher.https.test.mjs`

Verification command: `/cc-suite:verify WI-03a`

Audit command: `/cc-suite:audit --full services/ocr-worker/src/fetcher/httpsTransport.ts services/ocr-worker/src/fetcher/types.ts services/ocr-worker/src/fetcher/index.ts services/ocr-worker/src/index.ts docs/adr/ocr-fetcher-https-dns-pinning-step-11d-2-a.md`

Risk level: Critical
Ownership: Claude writes, Codex validates
Autonomy: Stop and ask first
v1 bucket: v1-blocking

---

### WI-03b - Runtime Address Validation + Internal Error Discriminators

Goal: At transport entry, validate `init.allowedAddresses` against the full ADR §5 surface and reject malformed values with stable internal transport error discriminators that the fetcher maps to the existing public `https_network_error` code, preserving the internal error as `cause`.

Predecessor: WI-02 + WI-03a. WI-03b relies on the WI-02 fetcher DNS seam (vetted `allowedAddresses` flowing into the transport) and on the WI-03a pinned `node:https.request` transport core.

Likely files:
- `services/ocr-worker/src/fetcher/httpsTransport.ts` (preflight wiring + internal test seam)
- `services/ocr-worker/src/fetcher/httpsTransportErrors.ts` (new internal-only error module + type guard)
- `services/ocr-worker/src/fetcher/fetchPageBytes.ts` (explicit `isHttpsTransportError` branch before generic catch-all; preserve `cause`)
- `services/ocr-worker/tests/fetcher.https.transport.test.mjs` (un-skip the 15 runtime-validation cases)
- One fetcher-level test file (e.g. `services/ocr-worker/tests/fetcher.https.test.mjs` or sibling) for the internal→public mapping coverage
- One public-barrel smoke test (e.g. `services/ocr-worker/tests/fetcher.public-surface.test.mjs` or sibling) for the barrel-prohibition assertion

Scope boundaries (must NOT cross into other WIs):
- WI-03b must NOT implement WI-03c Content-Length strictness.
- WI-03b must NOT implement WI-03c strict `Uint8Array` body-shape adaptation.
- WI-03b must NOT implement WI-03c abort-phase mechanics.
- WI-03b must NOT implement WI-03d TLS harness or un-skip non-validation TLS matrix tests.
- WI-03b is limited to runtime input validation, internal transport error discriminators, the internal test seam, and the fetcher mapping from those internal errors to the existing public surface.

#### Validation timing

- Validate `init.allowedAddresses` inside each `transport.fetch(url, init)` call.
- Validation happens before creating https.request, before invoking the custom lookup callback, and before any socket/network activity.
- Validation must be implemented as a pure preflight helper (sync, no I/O, no side effects) so it is unit-testable through the transport with a syntactically valid HTTPS URL — no live server, no DNS, no socket required.
- Tests must prove validation failure occurs before the underlying request function / socket path is invoked, by importing the internal `makeNodeHttpsRequestTransportForTest({ request })` seam (defined below), passing a recording fake `request`, and asserting it was not called when validation rejects.

#### Pinned validation order

`allowedAddresses` validation order:

1. **Container checks:**
   - `init.allowedAddresses` exists (property is present and value is not `undefined`).
   - `Array.isArray(init.allowedAddresses) === true`.
   - Array is non-empty (`length >= 1`).
2. **For each element in array order:**
   - Plain-object check (`Object.getPrototypeOf(entry) === Object.prototype`).
   - Required own-data-property descriptors present for `address` and `family` (own, data — not accessors — descriptor truthy via `Object.getOwnPropertyDescriptor`).
   - Type checks for `address` (`typeof === "string"`) and `family` (`typeof === "number"`).
   - `address === address.trim()` equality check.
   - Mapped/scoped literal rejection (see "Strict IP literal behavior" below) — BEFORE `net.isIP`/family/private checks.
   - `net.isIP(address)` parse check (must return non-zero).
   - Family match check: `net.isIP(address) === family`.
   - Private/reserved/blocklist check via `isPrivateIp(address)`.
3. **Reject the entire request on the first invalid element.**
4. **Do not filter, normalize, reorder, or wrap per-entry errors.**

**Pinned code mapping (per validation step):**

| Failure                                                  | `HttpsTransportError.code`         |
|----------------------------------------------------------|------------------------------------|
| missing `allowedAddresses`                               | `MISSING_ALLOWED_ADDRESSES`        |
| non-array `allowedAddresses`                             | `ALLOWED_ADDRESSES_NOT_ARRAY`      |
| empty array                                              | `EMPTY_ALLOWED_ADDRESSES`          |
| non-plain-object entry                                   | `ADDRESS_ENTRY_NOT_PLAIN_OBJECT`   |
| accessor descriptor on `address` or `family`             | `ADDRESS_ENTRY_NOT_PLAIN_OBJECT`   |
| missing own `address` field                              | `ADDRESS_MISSING_ADDRESS`          |
| missing own `family` field                               | `ADDRESS_MISSING_FAMILY`           |
| `address` not string                                     | `ADDRESS_NOT_STRING`               |
| `family` not number                                      | `ADDRESS_FAMILY_NOT_NUMBER`        |
| `address !== address.trim()`                             | `ADDRESS_INVALID_LITERAL`          |
| mapped/scoped literal                                    | `ADDRESS_INVALID_LITERAL`          |
| `net.isIP(address) === 0`                                | `ADDRESS_INVALID_LITERAL`          |
| `net.isIP(address) !== family`                           | `ADDRESS_FAMILY_MISMATCH`          |
| number `family` not 4 or 6                               | `ADDRESS_FAMILY_INVALID`           |
| private/reserved/blocklisted address                     | `ADDRESS_PRIVATE`                  |

**Important ordering rule:**
- For cases that satisfy both literal invalidity and private/blocklisted status, **literal invalidity wins** because the literal/mapped/scoped check runs before `isPrivateIp`.
- Concrete example: `fe80::1%lo0` must produce `ADDRESS_INVALID_LITERAL` (zone suffix rejected in step 2.5), NOT `ADDRESS_PRIVATE`, even though `isPrivateIp("fe80::1%lo0")` returns `true`.

#### Exact validation semantics

**Container shape (`init.allowedAddresses`):**
- Must be an `Array` (`Array.isArray(init.allowedAddresses) === true`).
- Must be non-empty (`length >= 1`).
- Every element is validated in array order.
- On the first invalid element, reject the entire request — do not filter, drop, reorder, normalize, or silently coerce entries. Mixed arrays (some valid, one invalid) are rejected on the first invalid entry.

**Element shape (each `entry`):**
- Each entry must be a plain object: `Object.getPrototypeOf(entry) === Object.prototype`.
- `null`, arrays, functions, `Date`, class instances (including `Buffer`), and `Object.create(null)` are invalid → `ADDRESS_ENTRY_NOT_PLAIN_OBJECT`.
- Required fields `address` and `family` must be **own data properties** (not accessors). Validation checks descriptors via `Object.getOwnPropertyDescriptor` before reading values; accessor descriptors (getter/setter) are rejected as `ADDRESS_ENTRY_NOT_PLAIN_OBJECT` so validation stays pure and side-effect-free.
- After descriptors are confirmed, each required value is read exactly once.
- `typeof entry.family === "number"` and exactly `4` or `6`. Numeric strings like `"4"` and `"6"` are invalid.
- `typeof entry.address === "string"`.
- Extra/unknown own keys on an entry are ignored — only the required known fields are validated.

**Strict IP literal behavior:**
- `net.isIP(address) === family` is necessary but not sufficient.
- Reject zone/scoped IPv6 literals — any address containing `"%"` — BEFORE `net.isIP`/family/private checks. Produces `ADDRESS_INVALID_LITERAL`.
- Reject IPv4-mapped IPv6 literals (e.g. `::ffff:127.0.0.1`, `::ffff:8.8.8.8`, `::ffff:0102:0304`) BEFORE `net.isIP`/family/private checks. Produces `ADDRESS_INVALID_LITERAL`.
- No normalization or canonicalization of the input address.
- Use `node:net` `isIP(address)` as the parser for the remaining check.
- Require `net.isIP(address) === family` (so `family === 4` requires `net.isIP(address) === 4`, and `family === 6` requires `net.isIP(address) === 6`); on parse-failure (`net.isIP === 0`) emit `ADDRESS_INVALID_LITERAL`; on family/parse mismatch emit `ADDRESS_FAMILY_MISMATCH`.
- Require `address === address.trim()`; leading/trailing whitespace is invalid → `ADDRESS_INVALID_LITERAL`.
- Reject CIDR strings, bracketed IPv6 (`[::1]`), hostnames, empty strings, numeric-only IPv4 forms, plus-prefixed forms, IPvFuture, and anything `net.isIP` rejects.
- Compressed IPv6 and uppercase IPv6 hex are valid iff `net.isIP` accepts them and `family === 6`.
- Leading-zero IPv4 is invalid iff `net.isIP` rejects it.
- No new runtime dependencies.

**Private-IP defense-in-depth:**
- Reuse the existing private-IP predicate `isPrivateIp` from `services/ocr-worker/src/fetcher/privateIp.ts`. Do not duplicate or re-implement the blocklist.
- The check runs AFTER literal/mapped/scoped rejection. Address recognized by `isPrivateIp` as private/reserved/blocked → `ADDRESS_PRIVATE` (only reached for syntactically valid, non-mapped, non-scoped literals that survived the earlier steps).
- Representative coverage beyond loopback: RFC1918 (e.g. `10.0.0.1`), IPv4 link-local (`169.254.x.x`), IPv6 loopback (`::1`), IPv6 link-local (`fe80::/10` — un-scoped form), RFC4193/ULA (`fc00::/7`). The existing `isPrivateIp` already covers these via the shared blocklist; tests exercise at least one representative from each family.

#### Internal error module

Internal module path: `services/ocr-worker/src/fetcher/httpsTransportErrors.ts`.

Shape:

```ts
class HttpsTransportError extends Error {
  code: HttpsTransportErrorCode;
  constructor(message: string, options: { code: HttpsTransportErrorCode; cause?: unknown });
}
```

Requirements:
- `name === "HttpsTransportError"` (set in constructor).
- `code` is stable, exhaustive, and enumerable (a string literal union or const-enum) so tests assert on `err.code === "<CODE>"`.
- `cause` is preserved when provided (delegated to `Error`'s standard `cause` option, Node ≥ 16).
- Stack must be preserved by normal `Error` construction (no manual `Error.captureStackTrace` removal).
- Error messages are non-contractual; tests assert class / code / cause, not full message text.

Exports from the internal module (for tests + internal callers only):
- `HttpsTransportError` (class).
- `HttpsTransportErrorCode` (type/union of stable codes).
- `isHttpsTransportError(value): value is HttpsTransportError`. The guard must check `instanceof HttpsTransportError` AND `typeof (value as any).code === "string"`; it must not rely only on message text or `name`.

Public export prohibition — these symbols must NOT be re-exported from:
- `services/ocr-worker/src/index.ts`
- `services/ocr-worker/src/fetcher/index.ts`

Internal errors must not become public API. The only way external callers see a validation failure is the existing public `https_network_error` `FetcherError` returned by `fetchPageBytes`.

#### Fetcher mapping branch

- `services/ocr-worker/src/fetcher/fetchPageBytes.ts` imports `isHttpsTransportError` from the internal module (`./httpsTransportErrors.js`).
- In the catch path around the transport call, branch on `isHttpsTransportError(err)` **before** the generic network/timeout catch-all (i.e. before `wrapTimeoutError` or its equivalent), so an internal validation error is never absorbed silently by the generic branch.
- The branch constructs a public `FetcherError` with `code: "https_network_error"` and **preserves the original `HttpsTransportError` as `cause`** (`new FetcherError(message, { code: "https_network_error", cause: err })`).
- `FETCHER_ERROR_CODES` is unchanged. No new public fetcher error codes.
- The mapping test must assert all three:
  - public `err.code === "https_network_error"`,
  - `err.cause instanceof HttpsTransportError`,
  - `err.cause.code === <expected internal validation code>`.
- The mapping test MUST NOT be satisfiable through generic `wrapTimeoutError` / catch-all behavior — the cause assertion is what proves the explicit internal branch fired.

#### Internal test seam

- Add and export `makeNodeHttpsRequestTransportForTest({ request })` from `services/ocr-worker/src/fetcher/httpsTransport.ts` only.
- Do NOT export it from:
  - `services/ocr-worker/src/index.ts`
  - `services/ocr-worker/src/fetcher/index.ts`
- WI-03b validation tests may import it by source/internal path (e.g. `../dist/fetcher/httpsTransport.js` or `../src/fetcher/httpsTransport.ts` depending on the existing test build setup).
- The seam accepts a fake `request` function. The fake must record whether it was called (e.g. by mutating a `called: boolean` flag, or by being a wrapper around `node:test`'s `mock.fn()`).
- Runtime-validation tests must assert: on every invalid `allowedAddresses` shape, the recording fake `request` is **never called** and an `HttpsTransportError` is thrown.
- This is an internal test seam only, not public API. Production code must continue to use `makeNodeHttpsRequestTransport` from WI-03a.

#### Test → internal-code mapping (15 runtime-validation stubs)

The 15 `test.skip(..., { skip: "Unlocked by WI-03" })` cases in `services/ocr-worker/tests/fetcher.https.transport.test.mjs` are un-skipped and each pinned to a stable internal code. Each test asserts on `instanceof HttpsTransportError` AND `err.code === <CODE>` as the primary check. The pre-existing message regex is removed (non-contractual messages preclude a forward-compatible regex assertion); test titles are kept for readability.

If the implemented stub titles differ from this table, align the table to the real test titles — the binding contract is the `err.code` value per step, not the title.

| # | Test (verbatim title fragment)                            | Internal code (`HttpsTransportError.code`) |
|---|-----------------------------------------------------------|--------------------------------------------|
| 1 | missing allowedAddresses                                   | `MISSING_ALLOWED_ADDRESSES`                |
| 2 | empty allowedAddresses                                     | `EMPTY_ALLOWED_ADDRESSES`                  |
| 3 | non-array allowedAddresses                                 | `ALLOWED_ADDRESSES_NOT_ARRAY`              |
| 4 | non-plain-object element                                   | `ADDRESS_ENTRY_NOT_PLAIN_OBJECT`           |
| 5 | non-string address field                                   | `ADDRESS_NOT_STRING`                       |
| 6 | nonnumeric family                                          | `ADDRESS_FAMILY_NOT_NUMBER`                |
| 7 | family=5 (non 4\|6)                                        | `ADDRESS_FAMILY_INVALID`                   |
| 8 | malformed IPv4 literal                                     | `ADDRESS_INVALID_LITERAL`                  |
| 9 | malformed IPv6 literal                                     | `ADDRESS_INVALID_LITERAL`                  |
|10 | IPv4-mapped IPv6 dotted form (`::ffff:1.2.3.4`)            | `ADDRESS_INVALID_LITERAL`                  |
|11 | IPv4-mapped IPv6 hex form (`::ffff:0102:0304`)             | `ADDRESS_INVALID_LITERAL`                  |
|12 | scoped IPv6 (`fe80::1%lo0`)                                | `ADDRESS_INVALID_LITERAL`                  |
|13 | family/address mismatch (family=6 with IPv4 literal)       | `ADDRESS_FAMILY_MISMATCH`                  |
|14 | private IPv4 (`127.0.0.1`) — defense-in-depth              | `ADDRESS_PRIVATE`                          |
|15 | private IPv6 (`::1`) — defense-in-depth                    | `ADDRESS_PRIVATE`                          |

**Top-level error code is the per-entry code.** There is no aggregate / wrapper code. The top-level `HttpsTransportError.code` is exactly the per-entry code for the first invalid entry. Mixed arrays produce the per-entry code of the first invalid element, not a wrapper.

#### Fetcher-level mapping coverage (acceptance)

- At least one fetcher-level test proves an internal `HttpsTransportError` from runtime validation maps to public `FetcherError.code === "https_network_error"` AND preserves the internal error as `cause`.
- The mapping test must NOT rely on DNS, TLS, or network failure to trigger the internal error, and must not be satisfiable through generic `wrapTimeoutError`/catch-all behavior.
- The mapping test must exercise the path AFTER the fetcher's DNS pre-check, not before — the empty `allowedAddresses` array example is not acceptable because the fetcher rejects an empty DNS result before reaching the transport.
- Recommended setup:
  - Source URL: `https://example.test/page.png`.
  - DNS resolver returns a valid public address such as `{ address: "8.8.8.8", family: 4 }` so the fetcher's DNS pre-check passes.
  - Either:
    (a) inject a stub transport that throws `new HttpsTransportError("...", { code: "ADDRESS_FAMILY_INVALID" })`, OR
    (b) use the real transport with `allowedAddresses` overridden after DNS to `[{ address: "8.8.8.8", family: 5 }]` so the transport's preflight rejects with `ADDRESS_FAMILY_INVALID`, OR
    (c) override to `[{ address: "8.8.8.8", family: 6 }]` to trigger `ADDRESS_FAMILY_MISMATCH`.
- Assertions on the resulting public `FetcherError`:
  - `err.code === "https_network_error"`.
  - `err.cause instanceof HttpsTransportError`.
  - `err.cause.code === <expected internal code, e.g. "ADDRESS_FAMILY_INVALID">`.
- The existing public fetcher error surface (`FETCHER_ERROR_CODES`) is preserved exactly.

#### Public-barrel prohibition smoke test (acceptance)

Add a **non-skipped** smoke test that imports the **public** barrels and asserts the internal symbols are absent:

- Imports:
  - `../dist/index.js` (or the existing barrel path used by the package's other public-surface tests)
  - `../dist/fetcher/index.js`
- Assertions — these symbols must be absent from both public barrels:
  - `HttpsTransportError`
  - `HttpsTransportErrorCode`
  - `isHttpsTransportError`
  - `makeNodeHttpsRequestTransportForTest`
- The existing public exports established by WI-03a must remain available:
  - `makeNodeHttpsRequestTransport`
  - `makeNodeFetchHttpsTransport`
  - `makePinnedLookup`
  - The associated public type exports (`MakeNodeHttpsRequestTransportOptions`, `FetcherError`, `FETCHER_ERROR_CODES`, etc.) per the existing `services/ocr-worker/src/fetcher/index.ts` surface.
- The smoke test imports `HttpsTransportError` etc. from the **internal** module path separately, only to compare and assert the public barrel imports do not equal those internal exports (defensive). The check is `assert.ok(!("HttpsTransportError" in publicBarrelNamespace))` style, not an identity check.

#### Acceptance criteria (summary)

- Preflight validation runs inside `transport.fetch` before `https.request`, before the custom lookup callback, and before any socket activity — proven via the `makeNodeHttpsRequestTransportForTest` seam and a recording fake `request`.
- The 15 runtime-validation stubs in `fetcher.https.transport.test.mjs` are un-skipped, each asserts on `instanceof HttpsTransportError` and stable `err.code` per the table, and all pass.
- Validation order is exactly: container checks → per-entry plain-object + own-data-property descriptors → type checks → trim equality → mapped/scoped literal rejection → `net.isIP` parse → family match → `isPrivateIp`. First invalid element rejects the whole request.
- `fe80::1%lo0` produces `ADDRESS_INVALID_LITERAL`, not `ADDRESS_PRIVATE`.
- `HttpsTransportError` lives in `services/ocr-worker/src/fetcher/httpsTransportErrors.ts`, has `name === "HttpsTransportError"`, preserves `cause`, and is NOT re-exported from `services/ocr-worker/src/index.ts` or `services/ocr-worker/src/fetcher/index.ts`.
- `makeNodeHttpsRequestTransportForTest({ request })` is exported only from `httpsTransport.ts` and NOT from public barrels.
- The fetcher (`fetchPageBytes.ts`) has an explicit `isHttpsTransportError` branch before the generic catch-all, maps to public `https_network_error`, and preserves the internal error as `cause`.
- At least one fetcher-level mapping test asserts public code + cause + cause code, exercises the path after the DNS pre-check, and is not satisfiable via generic catch-all.
- A non-skipped public-barrel smoke test asserts `HttpsTransportError`, `HttpsTransportErrorCode`, `isHttpsTransportError`, and `makeNodeHttpsRequestTransportForTest` are absent from both public barrels.
- `FETCHER_ERROR_CODES` unchanged. No new public fetcher error codes. No new runtime dependencies.

Tests to run:
- `node --test services/ocr-worker/tests/fetcher.https.transport.test.mjs`
- `npm --prefix services/ocr-worker test`

Verification command: `/cc-suite:verify WI-03b`

Audit command: `/cc-suite:audit --full services/ocr-worker/src/fetcher/httpsTransport.ts services/ocr-worker/src/fetcher/httpsTransportErrors.ts services/ocr-worker/src/fetcher/fetchPageBytes.ts services/ocr-worker/src/fetcher/index.ts services/ocr-worker/src/index.ts services/ocr-worker/tests/fetcher.https.transport.test.mjs`

Risk level: Critical
Ownership: Claude writes, Codex validates
Autonomy: Stop and ask first
v1 bucket: v1-blocking

---

### WI-03c - Response Adapter (Content-Length, Uint8Array, Abort, 3xx)

Goal: Implement the transport-owned response adapter per ADR §6 — strict single-valued Content-Length parsing (in the transport, before yielding a successful `HttpsTransportResponse`), Buffer-to-Uint8Array strict adaptation on body chunks, abort propagation through every testable phase, and the 3xx return-shape contract.

Predecessor: WI-03b (commit `1a9f55c`). WI-03c extends the same transport and reuses the WI-03b internal `HttpsTransportError` module + request-factory seam.

#### Scope boundaries (must NOT cross into other WIs)

- WI-03c must NOT implement the WI-03d TLS test harness or local HTTPS server.
- WI-03c must NOT un-skip certificate / hostname / TLS local-server tests.
- WI-03c must NOT un-skip the `127.0.0.2` first-vetted-address reorder test (needs loopback-alias binding + TLS).
- WI-03c must NOT claim full SSRF closure or full transport-TLS integration.
- Full transport / TLS integration proof remains WI-03d.

#### Likely files

- `services/ocr-worker/src/fetcher/httpsTransport.ts` (response adapter — header parsing, body iterator, abort wiring)
- `services/ocr-worker/src/fetcher/httpsTransportErrors.ts` (extend `HttpsTransportErrorCode` union with new internal codes — see below)
- `services/ocr-worker/src/fetcher/fetchPageBytes.ts` (mapping: `RESPONSE_ABORTED` → `https_timeout`; other response-adapter codes continue to map to `https_network_error` via the existing WI-03b `isHttpsTransportError` branch)
- `services/ocr-worker/tests/fetcher.https.transport.test.mjs` (un-skip exactly the WI-03c-class tests enumerated below)
- Optionally one test helper file (e.g. `services/ocr-worker/tests/helpers/fake-response.mjs`) for the fake-IncomingMessage / readable-stream harness — internal-only

#### New internal `HttpsTransportError` codes (extends the WI-03b union)

Added to `services/ocr-worker/src/fetcher/httpsTransportErrors.ts`. **Internal only** — must NOT be re-exported from `services/ocr-worker/src/index.ts` or `services/ocr-worker/src/fetcher/index.ts`. The existing WI-03b public-barrel smoke test (`fetcher.public-surface.test.mjs`) is extended to cover the new codes by name.

- `RESPONSE_CONTENT_LENGTH_INVALID` — Content-Length header is present but syntactically malformed (leading zero, negative, non-integer, signed, contains whitespace after canonical trim, or the declared length disagrees with the body bytes the transport observed).
- `RESPONSE_CONTENT_LENGTH_DUPLICATE` — Content-Length header appears more than once in the raw header sequence.
- `RESPONSE_ABORTED` — request aborted via `AbortSignal`. Surfaces from the request promise (connect / headers phase) or from the body's `AsyncIterable` (body phase).
- `RESPONSE_BODY_CHUNK_INVALID` *(optional; emit only if a body chunk fails the `chunk.constructor === Uint8Array` invariant after adaptation — defense-in-depth)*.

#### Content-Length: duplicate detection (Critical fix)

The current header conversion at `httpsTransport.ts` uses `Object.entries(res.headers)`, which is insufficient: Node's `IncomingMessage.headers` collapses duplicate Content-Length entries — a duplicate header would pass through invisibly. WI-03c MUST:

- Detect duplicate Content-Length using `res.rawHeaders` (the raw `[name1, value1, name2, value2, ...]` sequence Node 22+ preserves) OR `res.headersDistinct` (Node 18.3+ exposes per-name string arrays).
- Do NOT rely on `res.headers` alone for the duplicate check.
- Count distinct raw occurrences case-insensitively against `"content-length"`.
- Required outcomes:
  - Count = 0 → header absent → allowed; transport streams under the existing per-page size cap; no size hint.
  - Count = 1 → header present → validate syntax (see next subsection).
  - Count > 1 → reject with `RESPONSE_CONTENT_LENGTH_DUPLICATE` BEFORE yielding the response (no body iteration started, no socket leaked).
- The duplicate check runs in the transport's response callback, before constructing the public `Headers` instance.

#### Content-Length: syntax + mismatch

Transport owns syntactic validation; fetcher does NOT re-validate.

- Reject (emit `RESPONSE_CONTENT_LENGTH_INVALID`):
  - Leading zero on a non-`"0"` value (e.g. `"0123"`).
  - Negative (`-1`).
  - Non-integer (`"12.5"`).
  - Signed (`"+1"`).
  - Contains internal whitespace.
  - Any value that fails the canonical syntax: `address === address.trim()` style — accept only digit-only ASCII strings (after the transport's deduplication pass), with optional `"0"` exactly for the empty-body case.
- Accept literal `"0"`.
- If the transport observed body byte count disagrees with the validated Content-Length (mismatch), emit `RESPONSE_CONTENT_LENGTH_INVALID` from the body iterator (the iterator throws; iteration must not end as a partial-success).

**Existing wording reconciliation** — replace the prior "Fetcher must not need to re-parse Content-Length" with:

> Transport guarantees syntactically valid single-valued Content-Length when present; fetcher may use that value for its existing byte-cap checks without re-validating syntax.

This keeps the fetcher's existing `Number.parseInt(cl, 10)` cap check at `fetchPageBytes.ts:611` valid and unchanged — the fetcher is allowed to use the value, just not to re-validate it.

#### 3xx return-shape contract

Pinned ownership: WI-03c owns transport-level 3xx behavior via the request-factory seam. WI-03d adds TLS-backed integration coverage of the same behavior; it does NOT re-own the contract.

- Transport must return `{ status, headers, body }` for any 3xx status.
- Transport must NOT follow redirects.
- `body` is always an `AsyncIterable<Uint8Array>` — may be empty but **never undefined**.
- Transport must NOT pre-read the 3xx body. The body stays a lazy async iterable; the caller decides whether to consume it.
- Fetcher continues mapping 3xx → public `redirect_unsupported` per ADR §7. No change to the fetcher.

#### Body chunk shape

- Body `AsyncIterable<Uint8Array>` must yield only chunks where `chunk.constructor === Uint8Array`.
- Node `IncomingMessage` yields `Buffer` chunks; `Buffer.prototype instanceof Uint8Array` is true but `chunk.constructor === Uint8Array` is false. The transport must adapt each chunk before yielding.
- Implementation note: a zero-copy view (`new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)`) preserves `byteLength` and avoids copying; a strict copy (`new Uint8Array(chunk)`) is acceptable. Either way the fetcher's existing `chunk.byteLength` and `Buffer.concat(chunks, total)` paths must continue to work (note: `Buffer.concat` accepts `Uint8Array[]`).
- If a chunk fails the invariant after adaptation (defense-in-depth), emit `RESPONSE_BODY_CHUNK_INVALID` from the iterator.

#### Abort contract (deterministic by phase)

Abort identity: transport surfaces an `HttpsTransportError` with code `RESPONSE_ABORTED`. Fetcher maps this internal code to existing public `https_timeout` (no new public code).

- Abort source: `init.signal` (existing `AbortSignal`). When the signal fires, transport's wiring calls `req.destroy(abortErr)` / `res.destroy(abortErr)` as appropriate to the active phase.
- Phase 1 — Before connect / before request completes: the request promise rejects with `HttpsTransportError({ code: "RESPONSE_ABORTED" })`. Testable through the WI-03b request-factory seam (no TLS server required).
- Phase 2 — After connect, before headers (headers phase): the request promise rejects with `HttpsTransportError({ code: "RESPONSE_ABORTED" })`. Requires a fake-IncomingMessage / readable-stream harness if no live server.
- Phase 3 — Mid-body iteration: the body's `AsyncIterable` throws `HttpsTransportError({ code: "RESPONSE_ABORTED" })`. Iteration MUST NOT end as a partial-success. Requires fake-stream harness if no live server.
- If a phase cannot be made deterministic without the WI-03d TLS harness, that specific test is deferred to WI-03d and documented in the skipped test's skip reason — DO NOT pretend WI-03c proves it.
- Ownership rule: the transport body iterator throws on abort; the fetcher only maps the thrown error. The fetcher does not detect partial completion.
- Behavior-level assertion: tests assert `for await` throws AND fetcher maps to `https_timeout`, NOT exact Node internal error type. Node's `req.destroy(err)` / `res.destroy(err)` propagated identity can vary across versions; the behavior contract is what's tested.

#### Listener cleanup (symmetry across exits)

- Signal listeners installed on `init.signal` must be removed on every exit path:
  - normal completion (success),
  - error (any non-abort failure including Content-Length rejection),
  - abort.
- WI-03c tests must include a listener-symmetry assertion across the three abort-coverable phases × the three exit modes that apply to each. Use either:
  - a counting/spy AbortSignal that records `addEventListener` / `removeEventListener` calls and asserts the delta is zero at end of test, OR
  - an instrumented mock that captures the listener callbacks and asserts each is unwired after the corresponding exit.
- The non-TLS phases (phase-1 abort, success, error) MUST have the symmetry assertion in WI-03c. TLS-server-only listener lifecycle (if any) is deferred to WI-03d.

#### Test seam (extends WI-03b)

WI-03c may extend the WI-03b internal seam (`makeNodeHttpsRequestTransportForTest({ request })`) with fake `IncomingMessage` / readable-stream helpers for response-adapter tests. Constraints:

- The seam and any new fake-stream helpers stay internal: NOT re-exported from public barrels.
- Fake-stream helpers live under `services/ocr-worker/tests/helpers/` (test-only) or as private helpers in the test file.
- Tests that cannot be made deterministic without a local HTTPS server lifecycle remain skipped with the existing `{ skip: "Unlocked by WI-03d" }` reason (renamed from "Unlocked by WI-03" so the boundary is auditable).

#### Tests to un-skip (exact enumeration)

WI-03c un-skips exactly these from `services/ocr-worker/tests/fetcher.https.transport.test.mjs`:

| # | Line | Test title |
|---|------|------------|
| 1 | ~422 | `content-length: leading zero ("0123") rejected with transport error` |
| 2 | ~430 | `content-length: negative value (-1) rejected` |
| 3 | ~435 | `content-length: non-integer ("12.5") rejected` |
| 4 | ~440 | `content-length: duplicate values ("100, 200") rejected` |
| 5 | ~446 | `content-length: "0" is accepted (empty body case)` |
| 6 | ~453 | `content-length: absent → streams under existing size cap, no size hint` |
| 7 | ~463 | `body: each chunk yielded by the async iterator is Uint8Array, never raw Buffer` |
| 8 | ~481 | `3xx: transport surfaces status 302 instead of following the Location header` |
| 9 | ~497 | `abort: signal fired BEFORE connect resolves → request error mapped to https_timeout by fetcher` |

Conditionally un-skipped IF the fake-stream harness can make them deterministic without a live HTTPS server:

| # | Line | Test title | Condition |
|---|------|------------|-----------|
| 10 | ~506 | `abort: signal fired AFTER connect but BEFORE response headers → request error mapped to https_timeout` | requires fake-IncomingMessage harness |
| 11 | ~515 | `abort: signal fired MID-BODY after some chunks delivered → stream throws, no partial-success` | requires fake-readable-stream harness |

Explicitly **deferred to WI-03d** (NOT un-skipped by WI-03c):

| Line | Test title | Reason |
|------|------------|--------|
| ~347 | `transport connects to the FIRST element of allowedAddresses, no reordering` | requires 127.0.0.2 loopback alias + two TLS servers |
| ~386 | `TLS: cert valid for hostname → ...` | requires TLS test harness |
| ~400 | `TLS: cert valid only for IP literal → ...` | requires TLS test harness |
| ~411 | `TLS: cert valid only for wrong hostname → ...` | requires TLS test harness |
| ~537 | `e2e: TLS hostname mismatch via real transport → fetcher returns https_network_error` | requires TLS test harness |
| ~547 | `e2e: malformed Content-Length via real transport → fetcher returns https_network_error` | requires live HTTPS server |
| ~553 | `e2e: abort during body via real transport → fetcher returns https_timeout` | requires live HTTPS server |

Total un-skipped by WI-03c: 9 firm + up to 2 conditional = 9 to 11 cases. If a conditional case is left skipped, the skip reason MUST be renamed to `{ skip: "Unlocked by WI-03d" }` and documented.

#### Fetcher mapping (no new public codes)

Internal response-adapter errors map to existing public fetcher codes only:

| Internal `HttpsTransportError.code` | Public `FETCHER_ERROR_CODES` | Cause preserved? |
|---|---|---|
| `RESPONSE_CONTENT_LENGTH_INVALID` | `HTTPS_NETWORK_ERROR` | yes |
| `RESPONSE_CONTENT_LENGTH_DUPLICATE` | `HTTPS_NETWORK_ERROR` | yes |
| `RESPONSE_BODY_CHUNK_INVALID` | `HTTPS_NETWORK_ERROR` | yes |
| `RESPONSE_ABORTED` | `HTTPS_TIMEOUT` | yes |
| 3xx response status | `REDIRECT_UNSUPPORTED` (existing fetcher logic; no transport-level error) | n/a |

Mapping mechanics:

- The WI-03b `isHttpsTransportError` branch in `wrapTimeoutError` already maps every `HttpsTransportError` to `https_network_error` with `cause` preserved. WI-03c MUST add an additional discriminator inside that branch: if `err.code === "RESPONSE_ABORTED"`, map to `https_timeout` instead, still preserving `cause`. All other `HttpsTransportError` codes continue to fall through to `https_network_error`.
- `FETCHER_ERROR_CODES` MUST remain unchanged. No new public codes.
- Tests MUST assert public code AND `err.cause instanceof HttpsTransportError` AND `err.cause.code` — same shape as the WI-03b mapping test.

#### Acceptance criteria (summary)

- Content-Length duplicate detection uses `res.rawHeaders` or `res.headersDistinct`, not `res.headers` alone.
- Content-Length syntax validation lives in the transport; the fetcher may use the validated value for cap checks without re-validating syntax.
- Transport returns `{ status, headers, body }` for 3xx; `body` is always an `AsyncIterable<Uint8Array>` (may be empty, never undefined); transport does NOT pre-read the 3xx body.
- Body chunks satisfy `chunk.constructor === Uint8Array` (Buffer adapted before yield).
- Abort discriminator pinned: `HttpsTransportError({ code: "RESPONSE_ABORTED" })`. Phase-1 abort proven via the WI-03b request-factory seam. Phase-2 / phase-3 abort tests un-skipped only if a fake-stream harness makes them deterministic without a live HTTPS server; otherwise the skip reason renames to `"Unlocked by WI-03d"`.
- Listener-symmetry assertion present across success / error / abort exits for the non-TLS phases.
- Fetcher mapping: `RESPONSE_ABORTED` → `https_timeout`, other response-adapter codes → `https_network_error`, all with `cause` preserved. `FETCHER_ERROR_CODES` unchanged.
- Public-barrel smoke test (`fetcher.public-surface.test.mjs`) extended to assert the new internal codes/symbols are absent from both public barrels.
- Exactly the WI-03c-class tests enumerated above are un-skipped; TLS / hostname / e2e / no-reorder tests remain skipped with renamed reason `"Unlocked by WI-03d"`.
- No new public fetcher error codes. No new runtime dependencies.

#### Implementation order (mandatory)

1. Add the new internal `HttpsTransportError` codes to `httpsTransportErrors.ts`.
2. Implement the duplicate / syntax Content-Length parser in the transport response callback BEFORE yielding the response.
3. Implement the Buffer → Uint8Array body adapter on the body iterator.
4. Implement abort wiring + listener cleanup across the testable phases.
5. Discriminate `RESPONSE_ABORTED` in the fetcher mapping branch.
6. Extend the public-barrel smoke test with the new internal symbols.
7. Re-run the full WI-03b regression set — including `fetcher.https.transport.test.mjs` WI-03b validation cases, `fetcher.public-surface.test.mjs`, and the WI-03b mapping tests in `fetcher.https.test.mjs`. All must still pass before WI-03c may un-skip its own test set.
8. Un-skip the 9 firm + up-to-2 conditional WI-03c tests; rename the skip reason on deferred cases to `"Unlocked by WI-03d"`.

WI-03c is not complete until both the WI-03b regression set and the WI-03c un-skip set are green simultaneously.

Tests to run:
- `node --test services/ocr-worker/tests/fetcher.https.transport.test.mjs`
- `node --test services/ocr-worker/tests/fetcher.https.test.mjs`
- `node --test services/ocr-worker/tests/fetcher.public-surface.test.mjs`
- `npm --prefix services/ocr-worker test`

Verification command: `/cc-suite:verify WI-03c`

Audit command: `/cc-suite:audit --full services/ocr-worker/src/fetcher/httpsTransport.ts services/ocr-worker/src/fetcher/httpsTransportErrors.ts services/ocr-worker/src/fetcher/fetchPageBytes.ts services/ocr-worker/tests/fetcher.https.transport.test.mjs services/ocr-worker/tests/fetcher.https.test.mjs services/ocr-worker/tests/fetcher.public-surface.test.mjs`

Risk level: Critical
Ownership: Claude writes, Codex validates
Autonomy: Stop and ask first
v1 bucket: v1-blocking

---

### WI-03d - TLS Test Harness + Un-skip All Transport Tests

Goal: Promote a TLS test harness (cert helper + local HTTPS server lifecycle, static TEST-ONLY PEM fixtures) under `services/ocr-worker/tests/`, un-skip exactly the 8 remaining `"Unlocked by WI-03d"` cases in `fetcher.https.transport.test.mjs` (TLS scenarios ×3, no-reorder, phase-2 abort, e2e mappings ×3), and produce the post-WI-03 readiness summary. WI-03d does NOT remove any public exports.

Predecessor: WI-03c (commit `74ac1db`). The pinned transport (WI-03a), preflight validation + internal error module (WI-03b), and response adapter (WI-03c) are all landed. WI-03d only adds the TLS test harness and un-skips the remaining cases; it does NOT modify the production transport.

#### Execution precondition (binding)

WI-03d tests require Node 22+. This matches the contract package's existing floor and the project-wide `@types/node ^22.0.0` typing. The TLS fixture/harness uses `crypto.X509Certificate` and `tls.createSecureContext` APIs available before Node 22, but pinning Node 22+ inside WI-03d avoids CI drift and matches the rest of the project's execution contract. CI runners on older Node versions MUST fail this work item rather than skip its tests.

#### Public-API policy (binding)

- WI-03d **does NOT remove** `makeNodeFetchHttpsTransport` or any other public export.
- `makeNodeFetchHttpsTransport` remains a public compatibility wrapper, exported from BOTH:
  - `services/ocr-worker/src/index.ts`
  - `services/ocr-worker/src/fetcher/index.ts`
- `makeNodeHttpsRequestTransport` remains the canonical factory.
- Any future removal or deprecation of the legacy wrapper is a separate follow-up WI with explicit migration + release-note decision.
- WI-03d may update internal default wiring only if strictly necessary for a test or production-correctness gap, but BOTH public exports must remain present and the package surface listed in `fetcher.public-surface.test.mjs` must be unchanged.

#### Likely files

- `services/ocr-worker/tests/helpers/tls-server.mjs` (new — local HTTPS server lifecycle helpers + capability probes including `127.0.0.2`)
- `services/ocr-worker/tests/helpers/tls-fixtures.mjs` (new — static fixture loader)
- `services/ocr-worker/tests/fixtures/tls/README.md` (new — TEST-ONLY warning, regeneration instructions, fixture metadata)
- `services/ocr-worker/tests/fixtures/tls/ca.crt` (new — TEST-ONLY root CA)
- `services/ocr-worker/tests/fixtures/tls/server-hostname.{key,crt}` (new — TEST-ONLY; SAN: DNS:`allowed-host.test`)
- `services/ocr-worker/tests/fixtures/tls/server-ip-only.{key,crt}` (new — TEST-ONLY; SAN: IP:`127.0.0.1` only — no DNS SAN)
- `services/ocr-worker/tests/fixtures/tls/server-wrong-host.{key,crt}` (new — TEST-ONLY; SAN: DNS:`other-host.test`)
- `services/ocr-worker/tests/fetcher.https.transport.test.mjs` (un-skip exactly the 8 cases enumerated below)
- `services/ocr-worker/src/fetcher/fetchPageBytes.ts` (additive: extend the generic HTTPS network-error branch in `wrapTimeoutError` to pass `cause: err` so Case 6 can assert the original Node TLS error code; no new public code; `FETCHER_ERROR_CODES remains unchanged`)
- `docs/adr/ocr-fetcher-https-dns-pinning-step-11d-2-a.md` (Status + §2.1/§3/§4/§5/§6/§7 update — verbatim text below)
- `dev-memo/regen-tls-fixtures.md` (new — exact OpenSSL regeneration commands + SAN config + filename map)
- `docs/release/test-and-audit-report.md` (new or appended — post-WI-03 readiness summary section)

#### Exact tests to un-skip (8 — verbatim titles from `services/ocr-worker/tests/fetcher.https.transport.test.mjs`)

| # | Line | Verbatim test title | Category |
|---|------|---------------------|----------|
| 1 | ~487 | `transport connects to the FIRST element of allowedAddresses, no reordering` | resolver order / no-reorder |
| 2 | ~526 | `TLS: cert valid for hostname → transport returns 200 + Headers; server saw Host + SNI = url.hostname` | TLS success |
| 3 | ~540 | `TLS: cert valid only for IP literal → transport throws (mapped to https_network_error by fetcher)` | TLS IP-only mismatch |
| 4 | ~551 | `TLS: cert valid only for wrong hostname → transport throws (mapped to https_network_error)` | TLS wrong-host mismatch |
| 5 | ~908 | `abort: signal fired AFTER connect but BEFORE response headers` | phase-2 abort |
| 6 | ~930 | `e2e: TLS hostname mismatch via real transport → fetcher returns https_network_error` | e2e mapping |
| 7 | ~940 | `e2e: malformed Content-Length via real transport → fetcher returns https_network_error` | e2e mapping |
| 8 | ~946 | `e2e: abort during body via real transport → fetcher returns https_timeout` | e2e mapping |

The legend comment at the top of the file MUST be updated so the file has **zero residual `"Unlocked by WI-03d"` skips** at WI-03d completion. The only acceptable residual skip is a deterministic platform skip on the no-reorder test's `127.0.0.2`-alias-dependent sub-case when the capability probe reports the alias is unavailable; that skip MUST use a distinct reason such as `"Skipped: 127.0.0.2 loopback alias unavailable on this platform"` and MUST NOT use the `"Unlocked by WI-03d"` token.

#### Per-case acceptance contract

##### Case 1 — no-reorder (`transport connects to the FIRST element of allowedAddresses, no reordering`)

- Two reachable local HTTPS endpoints are required when the `127.0.0.2` capability is available.
- `127.0.0.1` and `127.0.0.2` MUST run distinct local HTTPS servers (independent ephemeral ports; do not require the same port across A/B endpoints).
- Each server returns a distinct marker via BOTH:
  - response header `x-wi03d-marker: A` vs `x-wi03d-marker: B`,
  - body byte/string payload `marker:A` vs `marker:B`.
- Test asserts both the header AND body marker.
- Sub-case 1: `allowedAddresses = [{127.0.0.1, 4}, {127.0.0.2, 4}]` → expect marker A.
- Sub-case 2: `allowedAddresses = [{127.0.0.2, 4}, {127.0.0.1, 4}]` → expect marker B.
- One-reachable-one-unreachable variant is **forbidden** as proof — both endpoints must be reachable so that a buggy "retry second if first fails" implementation cannot coincidentally pass.
- Test proves the chosen endpoint corresponds to `allowedAddresses[0]`, not a fallback / reorder.

##### Case 2 — TLS success (`TLS: cert valid for hostname → ...`)

- Local HTTPS server uses `server-hostname` fixture (SAN: DNS:`allowed-host.test`).
- Server bound on `127.0.0.1`, pinned via `allowedAddresses=[{127.0.0.1, 4}]`.
- Transport call uses URL `https://allowed-host.test/...`, per-request `ca` = TEST-ONLY root CA.
- Assertions:
  - response `status === 200`.
  - `response.headers instanceof Headers`.
  - server-side captured `Host` header === `allowed-host.test`.
  - server-side captured `req.socket.servername` === `allowed-host.test`.
  - server-side `req.socket.localAddress` resolves to `127.0.0.1` (strip any `::ffff:` IPv4-mapped prefix).
  - body iterable yields strict `Uint8Array` chunks (cross-check WI-03c body adapter under TLS).

##### Case 3 — TLS IP-only mismatch (`TLS: cert valid only for IP literal → ...`)

- Local HTTPS server uses `server-ip-only` fixture (SAN: `IP:127.0.0.1` only — no DNS SAN).
- Same transport call as Case 2.
- Transport must throw a hostname-verification error.
- Public mapping via fetcher = `https_network_error` (no new public code).
- Narrow accept set for the underlying Node error code:
  - `err.code in { "ERR_TLS_CERT_ALTNAME_INVALID", "ERR_OSSL_X509_HOST_MISMATCH" }`.
- Bare cert errors (`UNKNOWN_CA`, `BAD_CERTIFICATE`, `SELF_SIGNED_CERT_IN_CHAIN`) FAIL this assertion — those would indicate a broken CA chain (TLS misconfig), not hostname verification.
- The test also asserts the error message mentions hostname-mismatch semantics (substring check) to reduce brittle false-negatives across OpenSSL builds.

##### Case 4 — TLS wrong-host mismatch (`TLS: cert valid only for wrong hostname → ...`)

- Local HTTPS server uses `server-wrong-host` fixture (SAN: DNS:`other-host.test`).
- Same transport call as Case 2.
- Same hostname-verification expectations as Case 3 (same narrow Node error-code accept set; same UNKNOWN_CA/BAD_CERT/SELF_SIGNED exclusions).
- Confirms wrong-host certificate (signed by the SAME test CA) fails hostname verification — distinguishes wrong-hostname from CA-trust failure.

##### Case 5 — phase-2 abort (`abort: signal fired AFTER connect but BEFORE response headers`)

- Local HTTPS server accepts the connection (TLS handshake completes) but does NOT write the response headers (e.g. server stalls on a `setTimeout` before `res.writeHead`).
- Abort signal fires after the socket connect/TLS handshake completes but before response headers arrive.
- Transport's request promise rejects with internal `HttpsTransportError({ code: "RESPONSE_ABORTED" })`.
- Fetcher-level mapping (round-trip through `fetchPageBytes`) returns public `FetcherError({ code: "https_timeout", cause: HttpsTransportError, cause.code: "RESPONSE_ABORTED" })`.
- Listener cleanup: counting AbortSignal asserts add-count === remove-count on the abort exit.
- Test must NOT hang; total runtime ≤ 5s under deadline.

##### Cases 6, 7, 8 — e2e mappings (full round-trip through `fetchPageBytes` with the real production transport)

All three e2e cases use the same local HTTPS server lifecycle:
- `services/ocr-worker/tests/helpers/tls-server.mjs` starts the server.
- DNS stub for the fetcher's resolver returns `[{ address: "127.0.0.1", family: 4 }]` (single entry; bypasses the host-allowlist + private-IP DNS pre-check via fixture URL pointing at a public-looking hostname `allowed-host.test` allowlisted in deps).
- Fetcher deps: `allowedHttpsHosts = new Set(["allowed-host.test"])`, fixed clock, deterministic submission with `mime_type: "image/png"`, `byte_size` matching server response, `expected_sha256` omitted unless test-specific.
- Cause-chain expectations DIFFER between Case 6 and Cases 7/8 (both layers require `cause` preservation in `fetchPageBytes.ts`):
  - Cases 7 and 8 assert `err.cause instanceof HttpsTransportError` AND `err.cause.code === <expected internal code>` (matches the WI-03b/c cause-chain pattern, because the transport's own preflight/adapter throws an `HttpsTransportError`; the `isHttpsTransportError` branch in `wrapTimeoutError` preserves `cause`).
  - Case 6 asserts `err.cause` is the original Node TLS `Error` (NOT an `HttpsTransportError` — native TLS hostname-mismatch is not wrapped by the transport) AND `err.cause.code` is one of `{ ERR_TLS_CERT_ALTNAME_INVALID, ERR_OSSL_X509_HOST_MISMATCH }`. For this assertion to hold, WI-03d implementation MUST extend the generic HTTPS network-error branch in `fetchPageBytes.ts` `wrapTimeoutError` to also preserve `cause` when constructing the `FetcherError`. This is an **additive cause-preservation change**, consistent with the WI-03b/WI-03c cause-preservation behavior on the `isHttpsTransportError` branch. The change does NOT add any new public fetcher error code: `FETCHER_ERROR_CODES remains unchanged`; the public `err.code` for Case 6 stays at `https_network_error`. Concretely, the generic-branch return becomes `new FetcherError(message, { code: FETCHER_ERROR_CODES.HTTPS_NETWORK_ERROR, cause: err })` (one-line extension; `cause` is already an opt-in option on `FetcherError` since WI-03b's types.ts change).
- All three cases assert the public `err.code` per the table below.
- No new public fetcher error code introduced. `FETCHER_ERROR_CODES remains unchanged`.

| # | Title | Server fixture / setup | Expected public code | Expected `err.cause.code` |
|---|-------|------------------------|----------------------|---------------------------|
| 6 | `e2e: TLS hostname mismatch via real transport → fetcher returns https_network_error` | `server-wrong-host` fixture, server bound on `127.0.0.1` | `https_network_error` | `err.cause` is the original Node TLS `Error`; assert `err.cause.code` is one of `ERR_TLS_CERT_ALTNAME_INVALID` or `ERR_OSSL_X509_HOST_MISMATCH` (NOT `HttpsTransportError.code`). Requires WI-03d to extend the generic `wrapTimeoutError` branch with `cause: err`. |
| 7 | `e2e: malformed Content-Length via real transport → fetcher returns https_network_error` | `server-hostname` fixture; server emits malformed Content-Length (e.g. duplicate `Content-Length: 100` + `Content-Length: 200`, or non-integer `12.5`) | `https_network_error` | `RESPONSE_CONTENT_LENGTH_DUPLICATE` (or `RESPONSE_CONTENT_LENGTH_INVALID` if the test uses the non-integer variant) |
| 8 | `e2e: abort during body via real transport → fetcher returns https_timeout` | `server-hostname` fixture; server starts streaming body, holds before final chunk | `https_timeout` | `RESPONSE_ABORTED` |

#### TLS fixture strategy

Static, checked-in TEST-ONLY PEM fixtures under `services/ocr-worker/tests/fixtures/tls/`:

- Fixture set:
  - `ca.crt` — TEST-ONLY root CA used to sign all three server certs.
  - `ca.key` — TEST-ONLY root CA key (committed; **TEST-ONLY, NOT A SECRET**).
  - `server-hostname.{crt,key}` — leaf signed by `ca.crt`; SAN: `DNS:allowed-host.test`.
  - `server-ip-only.{crt,key}` — leaf signed by `ca.crt`; SAN: `IP:127.0.0.1` only (no DNS SAN).
  - `server-wrong-host.{crt,key}` — leaf signed by `ca.crt`; SAN: `DNS:other-host.test`.
- Each `.key` file MUST carry a top-of-file comment block: `# TEST-ONLY KEY — NOT A SECRET. Used by services/ocr-worker tests to drive a local HTTPS server. Regenerate via dev-memo/regen-tls-fixtures.md.`
- `services/ocr-worker/tests/fixtures/tls/README.md` MUST document:
  - TEST-ONLY warning + that committing the keys is intentional.
  - Validity period (recommended: 10 years to avoid expiry churn) and the explicit expiry date stamped in the fixture filenames or in README so a reviewer can detect drift.
  - Serial-number convention (deterministic, e.g. 1, 2, 3 for the three leaves).
  - SAN profile per fixture (matching the table above).
  - Key type / size (recommended: `prime256v1` ECDSA or `rsa:2048` — pin one).
  - Whether each cert is CA-signed (all three leaves are) vs self-signed (only the CA itself).
  - Regeneration recipe link.
- The test suite MUST NOT shell out to OpenSSL at runtime. Fixture loading is pure file-read via `fs.readFileSync` (or async equivalent) and `tls.createSecureContext` / `https.createServer` use the loaded Buffers directly.

#### Fixture regeneration recipe (`dev-memo/regen-tls-fixtures.md`)

This is developer-only maintenance — not part of test execution. The memo MUST contain:

- Exact OpenSSL invocation (or equivalent script) for generating each leaf + the CA, including:
  - Key generation parameters (`openssl genpkey -algorithm ec -pkeyopt ec_paramgen_curve:P-256 -out ...`).
  - CSR generation with the documented Subject DN.
  - SAN configuration via a `-config` file or `-addext "subjectAltName=..."` flag, with the exact SAN string per fixture.
  - Signing step (`openssl x509 -req -in ... -CA ca.crt -CAkey ca.key -set_serial N -days 3650 -extfile ...`).
- Deterministic filename map (matches the fixture set above).
- Instructions for replacing fixtures before expiry (rough date and process).
- Note that running this script is developer maintenance only; CI MUST NOT regenerate fixtures.

#### Fixture correctness preflight

A non-skipped fixture-self-check test (e.g. `services/ocr-worker/tests/fixtures/tls/fixture-self-check.test.mjs`) MUST verify:

- Each leaf's SAN matches the documented profile (parsing PEM via Node's `crypto.X509Certificate`).
- Each leaf is signed by the test CA (issuer DN match + signature verification).
- Each leaf's validity window covers `Date.now()` and at least 30 days into the future (otherwise CI flags drift before tests start failing).
- Wronghost fixture is trusted by the test CA (so the failure mode in Case 4 is hostname-mismatch, not CA-trust).
- Success fixture passes hostname verification for `allowed-host.test`.
- Failures from this self-check block the WI-03d test run; they MUST NOT be masked as `UNKNOWN_CA` / `BAD_CERTIFICATE` / `SELF_SIGNED_CERT_IN_CHAIN` in the hostname-mismatch cases.

#### HTTPS server lifecycle + teardown

- Every local HTTPS server MUST bind to loopback only (`127.0.0.1` and, when capability allows, `127.0.0.2`). No `0.0.0.0`, no external interface.
- Servers MUST close via `t.after(...)` / `try/finally` blocks regardless of success / error / abort exit.
- Open sockets MUST be destroyed on teardown — track via `server.on("connection", ...)` if needed; do not rely on Node's garbage collection to close lingering sockets.
- Tests MUST NOT depend on external network. Every assertion exercises only loopback.
- Tests MUST allocate ports dynamically (`server.listen(0, ...)`) — do NOT hard-code ports.
- Teardown MUST run on both success and failure of the test body (use `t.after` not bare `finally` so the test runner records the teardown in its report).

#### `127.0.0.2` capability behavior

- The test helper exposes `await probe127_0_0_2_loopback(): Promise<{ available: boolean, reason: string | null }>`.
- The no-reorder test calls the probe before sub-case 2. If `available === false`, sub-case 2 is skipped with the platform-specific reason from the probe (e.g. `"127.0.0.2 loopback alias unavailable on this platform: <reason>"`).
- Sub-case 1 (which only needs `127.0.0.1`) runs unconditionally.
- The TLS / phase-2 abort / e2e cases do NOT depend on the alias and run unconditionally.
- CI MUST log the probe result (`available: true|false`) so a silent-permanent-skip cannot hide indefinitely. If the probe errors (neither available nor explicitly unsupported), the test FAILS — it does NOT skip.

#### ADR Status update — verbatim text

The WI-03d implementer MUST update `docs/adr/ocr-fetcher-https-dns-pinning-step-11d-2-a.md` top-level Status block to the verbatim wording below, and apply the matching per-section deltas to §2.1 / §3 / §4 / §5 / §6 / §7 (each section's "Status" line moves from the current "Partial: ..." or "Pending: ..." state to a Landed-by-WI-03d statement).

Top-level Status (verbatim):

> WI-03d completes the TLS-backed transport verification matrix for the pinned `node:https.request` transport: certificate success/failure behavior, original-hostname SNI/Host preservation, local HTTPS e2e mapping, abort phase-2 coverage where deterministic, and resolver-order/no-reorder proof where the `127.0.0.2` capability is available. WI-03d does not remove public compatibility exports. Implementation complete; production SSRF closure claim blocked on security sign-off.

Per-section delta template:

> §N — Status: **Landed by WI-03a/b/c/d (commit `<sha>`)**. <one-line summary of the landed behavior referencing the relevant fetcher.https.transport.test.mjs test names>.

#### Post-WI-03 readiness summary

Append a new section to `docs/release/test-and-audit-report.md` (create the file if it does not exist):

- Heading: `## Post-WI-03 readiness summary`.
- Bullets:
  - `Implementation gap closed: pinned node:https.request transport (WI-03a) + preflight allowedAddresses validation (WI-03b) + response adapter (WI-03c) + TLS test harness (WI-03d) all landed.`
  - `All fetcher.https.transport.test.mjs cases active and green (except the documented 127.0.0.2-alias sub-case when the loopback alias capability is unavailable).`
  - `cli.spawn.test.mjs:260 SIGINT flake remains a pre-existing baseline issue (not introduced by WI-03; tracked separately).` — exact subsection title for this residual-risk note: `### Residual baseline issues`; format: one-line per issue with rationale.
  - `Public fetcher error surface unchanged. No new public codes.`
  - `Security sign-off still required before claiming SSRF closure in production. WI-03d does NOT by itself constitute go-live readiness.`

#### Implementation order (mandatory)

1. Generate fixtures via the recipe in `dev-memo/regen-tls-fixtures.md`; commit fixtures.
2. Add fixture self-check test; confirm it passes before any other WI-03d test is touched.
3. Add `tls-server.mjs` + `tls-fixtures.mjs` helpers; capability probe; teardown contract.
4. Extend `fetchPageBytes.ts` `wrapTimeoutError` generic HTTPS network-error branch to pass `cause: err` (one-line additive change). Re-run the WI-03b/WI-03c regression set immediately to confirm no behavior regression. `FETCHER_ERROR_CODES remains unchanged`.
5. Un-skip Case 1 (no-reorder) sub-case 1 (no alias dependency); confirm green; then sub-case 2 if alias available.
6. Un-skip Cases 2, 3, 4 (TLS scenarios); confirm green.
7. Un-skip Case 5 (phase-2 abort); confirm green.
8. Un-skip Cases 6, 7, 8 (e2e mappings); confirm green.
9. Re-run the full WI-03b + WI-03c regression set (transport + fetcher + public-surface) — all must still pass before WI-03d may claim done.
10. Update the ADR Status block + per-section deltas per the verbatim text above.
11. Append the Post-WI-03 readiness summary to `docs/release/test-and-audit-report.md`.

WI-03d is not complete until: (a) all 8 enumerated cases pass (modulo the documented `127.0.0.2` sub-case skip when capability is unavailable), (b) the WI-03b + WI-03c regression set is still green, (c) the public-barrel smoke test still passes (both public exports `makeNodeHttpsRequestTransport` and `makeNodeFetchHttpsTransport` still present; no internal symbols leaked), and (d) the ADR Status + Post-WI-03 readiness summary are updated.

#### Security claim boundary

- WI-03d may claim the implementation/test matrix for the pinned HTTPS transport is **complete** only after all non-platform-skipped WI-03d tests are active and green AND the WI-03b + WI-03c regression set is still green.
- WI-03d MAY NOT claim go-live readiness by itself.
- Post-WI-03d security sign-off remains a separate gate. The ADR Status text above pins this explicitly.

#### Acceptance criteria (summary)

- TLS fixtures under `services/ocr-worker/tests/fixtures/tls/` are static checked-in PEM files. Each `.key` carries a TEST-ONLY comment. README documents metadata + regeneration recipe. Test suite does NOT shell out to OpenSSL at runtime.
- Fixture self-check test verifies SAN, issuer, validity (+30d buffer), trust chain, and hostname expectations.
- `tls-server.mjs` provides start/stop helpers for loopback-only HTTPS servers with independent ephemeral ports; capability probe for `127.0.0.2`; deterministic teardown.
- The 8 enumerated `"Unlocked by WI-03d"` tests are un-skipped and pass per their case acceptance contracts. The only acceptable residual skip is sub-case 2 of the no-reorder test when the `127.0.0.2` probe reports unavailable.
- Public-API exports unchanged: BOTH `makeNodeHttpsRequestTransport` and `makeNodeFetchHttpsTransport` remain in `src/index.ts` and `src/fetcher/index.ts`. Public-barrel smoke test passes unchanged.
- ADR Status block + §2.1/§3/§4/§5/§6/§7 updated to the verbatim text above.
- Post-WI-03 readiness summary appended to `docs/release/test-and-audit-report.md`.
- No new public fetcher error codes. No new runtime dependencies.

Tests to run:
- `node --test services/ocr-worker/tests/fetcher.https.transport.test.mjs`
- `node --test services/ocr-worker/tests/fetcher.https.test.mjs`
- `node --test services/ocr-worker/tests/fetcher.public-surface.test.mjs`
- `node --test services/ocr-worker/tests/fixtures/tls/fixture-self-check.test.mjs`
- `npm --prefix services/ocr-worker test`
- Cross-package smoke: `npm --prefix docs/contracts test && npm --prefix services/ocr-persistence test && npm --prefix services/ocr-ingestion test && npm --prefix services/ocr-review test`

Verification command: `/cc-suite:verify WI-03d`

Audit command: `/cc-suite:audit --full services/ocr-worker/tests/helpers services/ocr-worker/tests/fixtures/tls services/ocr-worker/tests/fetcher.https.transport.test.mjs docs/adr/ocr-fetcher-https-dns-pinning-step-11d-2-a.md`

Risk level: Critical
Ownership: Claude writes, Codex validates
Autonomy: Stop and ask first
v1 bucket: v1-blocking

### WI-04 - DNS-Pinning Regression And Operator Documentation

Goal: Pin the DNS-rebinding fix with end-to-end regression coverage and operator-facing documentation.

Predecessor: WI-03d, WI-09a

Likely files:
- `services/ocr-worker/tests/fetcher.https.test.mjs`
- `services/ocr-worker/tests/pipeline.real-engine.e2e.test.mjs`
- `docs/adr/ocr-fetcher-https-dns-pinning-step-11d-2-a.md`
- `docs/release/ocr-worker-runbook.md`
- `docs/contracts/README.md`

Acceptance criteria:
- Test proves a DNS-rebinding shape cannot pass: first lookup public, later attempted lookup private does not affect the dialed socket.
- Test proves allowlisted S3 pre-signed HTTPS host pattern still works at the fetcher boundary with pinned DNS.
- Runbook documents `OCR_FETCHER_HTTPS_HOSTS`, pre-signed URL expiry, no redirects, no proxy support, and why S3 direct source remains rejected in v1.
- Runbook states that adding proxy support or connection pooling requires a new ADR.

Tests to run:
- `node --version`
- `npm --prefix services/ocr-worker test`
- `npm --prefix docs/contracts test`

Verification command: `/cc-suite:verify WI-04`

Audit command: `/cc-suite:audit --mini services/ocr-worker/tests/fetcher.https.test.mjs services/ocr-worker/tests/pipeline.real-engine.e2e.test.mjs docs/adr/ocr-fetcher-https-dns-pinning-step-11d-2-a.md docs/release/ocr-worker-runbook.md docs/contracts/README.md`

Risk level: High

Ownership: Claude writes, Codex validates

Autonomy: Autonomous OK

v1 bucket: v1-blocking

### WI-05 - Monotonic Pending-Retry Writes

Goal: Close ADR-11G Q2 by preventing stale or concurrent pending-retry overwrites from moving `retry.attempt` backward or double-bumping silently.

Predecessor: WI-04

Current schema fact: `services/ocr-persistence/src/sqlite/schema.ts` reports `CURRENT_SCHEMA_VERSION = 3`, and v3 adds nullable `pending_retry_submission_json TEXT` to `ocr_jobs`. Monotonic CAS may require schema v4 or a separate version/attempt column if atomic compare-and-set cannot be proven against the v3 JSON-only column. This fact must be re-read immediately before the WI-05 Stop-and-ask prompt; if `CURRENT_SCHEMA_VERSION` is not `3`, regenerate options A/B.

Likely files:
- `services/ocr-persistence/src/types.ts`
- `services/ocr-persistence/src/inMemoryRepo.ts`
- `services/ocr-persistence/src/sqlite/SqliteOcrPersistence.ts`
- `services/ocr-persistence/src/sqlite/schema.ts`
- `services/ocr-persistence/tests/inMemory.conformance.test.mjs`
- `services/ocr-persistence/tests/sqlite.conformance.test.mjs`
- `services/ocr-worker/src/coordinator.ts`
- `services/ocr-worker/tests/coordinator.retryWiring.test.mjs`
- `services/ocr-review/src/*`
- `services/ocr-review/tests/*`
- `docs/adr/ocr-coordinator-pending-retry-outbox-step-11g.md`

Acceptance criteria:
- Stop-and-ask approval uses the WI-05 pre-fill after re-reading the current schema version and explicitly decides whether v3 JSON-only storage is sufficient or schema v4 is required.
- If Option A is selected, WI-05 produces executable proof of single-coordinator-per-job-id: either a test demonstrating the race window does not occur under v1 deployment posture, or a deployment-config check that fails if more than one coordinator can run for the same job ID. Without this proof, Option A is not production-safe and Option B must be chosen.
- Pending-retry write rejects an attempt lower than the currently stored pending attempt.
- Re-writing the same canonical pending submission is idempotent.
- Writing attempt `N+1` over attempt `N` is accepted only when transition state makes that advance valid.
- SQLite implementation enforces the same semantics as in-memory implementation.
- Coordinator maps stale pending-write failures to a documented outcome without throwing an undocumented error.
- Review read-model behavior is checked for assumptions about pending-retry semantics.
- ADR-11G is amended with the chosen monotonic/CAS rule.

Tests to run:
- `node --version`
- `npm --prefix services/ocr-persistence test`
- `npm --prefix services/ocr-worker test`
- `npm --prefix services/ocr-review test`
- `node --test services/ocr-worker/tests/coordinator.retryWiring.test.mjs`

Verification command: `/cc-suite:verify WI-05`

Audit command: `/cc-suite:audit --full services/ocr-persistence/src/types.ts services/ocr-persistence/src/inMemoryRepo.ts services/ocr-persistence/src/sqlite/SqliteOcrPersistence.ts services/ocr-persistence/src/sqlite/schema.ts services/ocr-persistence/tests/inMemory.conformance.test.mjs services/ocr-persistence/tests/sqlite.conformance.test.mjs services/ocr-worker/src/coordinator.ts services/ocr-worker/tests/coordinator.retryWiring.test.mjs services/ocr-review docs/adr/ocr-coordinator-pending-retry-outbox-step-11g.md`

Risk level: High

Ownership: Claude writes, Codex validates

Autonomy: Stop and ask first

v1 bucket: v1-required-but-deferrable

### WI-06 - Orphaned Pending-Retry Reconciler

Goal: Close ADR-11G Q1 with an operator-safe reconciler for pending retry submissions that have no active queue row.

Predecessor: WI-05, unless WI-05 is explicitly deferred with risk acceptance; if WI-05 is deferred, WI-06 is blocked until the user either re-enables WI-05 or explicitly accepts a manual recovery posture for WI-06.

Likely files:
- `services/ocr-persistence/src/types.ts`
- `services/ocr-persistence/src/inMemoryRepo.ts`
- `services/ocr-persistence/src/sqlite/SqliteOcrPersistence.ts`
- `services/ocr-persistence/src/sqlite/SqliteOcrQueue.ts`
- `services/ocr-persistence/tests/sqliteQueue.conformance.test.mjs`
- `services/ocr-persistence/tests/sqlite.conformance.test.mjs`
- `services/ocr-worker/src/cli.ts`
- `services/ocr-worker/tests/cli.sqlite.test.mjs`
- `docs/release/ocr-worker-runbook.md`
- `docs/release/operator-checklist.md`

Acceptance criteria:
- Stop-and-ask approval explicitly covers new public operator CLI surface and persistence/queue lifecycle impact.
- Reconciler lists pending retry rows whose job has no unresolved queue row.
- Reconciler can re-enqueue exactly the pending submission for a job.
- Reconciler is idempotent if the queue row already exists.
- Reconciler never clears pending retry unless enqueue succeeds or the job is terminal.
- CLI or documented operator entrypoint has a dry-run mode.
- Runbook includes dry-run and apply examples with SQLite path.

Tests to run:
- `node --version`
- `npm --prefix services/ocr-persistence test`
- `npm --prefix services/ocr-worker test`
- `node --test services/ocr-worker/tests/cli.sqlite.test.mjs`

Verification command: `/cc-suite:verify WI-06`

Audit command: `/cc-suite:audit --full services/ocr-persistence/src/types.ts services/ocr-persistence/src/inMemoryRepo.ts services/ocr-persistence/src/sqlite/SqliteOcrPersistence.ts services/ocr-persistence/src/sqlite/SqliteOcrQueue.ts services/ocr-persistence/tests/sqliteQueue.conformance.test.mjs services/ocr-persistence/tests/sqlite.conformance.test.mjs services/ocr-worker/src/cli.ts services/ocr-worker/tests/cli.sqlite.test.mjs docs/release/ocr-worker-runbook.md docs/release/operator-checklist.md`

Risk level: High

Ownership: Claude writes, Codex validates

Autonomy: Stop and ask first

v1 bucket: v1-required-but-deferrable

### WI-07 - Retry-Storm Observability Guard

Goal: Make ADR-11F Q3 operable in v1 without adding delayed-delivery queue semantics.

Predecessor: WI-04

Likely files:
- `services/ocr-worker/src/coordinator.ts`
- `services/ocr-worker/src/observability.ts`
- `services/ocr-worker/src/cli.ts`
- `services/ocr-worker/tests/observability.test.mjs`
- `services/ocr-worker/tests/coordinator.retryWiring.test.mjs`
- `docs/adr/ocr-coordinator-retry-wiring-step-11f.md`
- `docs/release/ocr-worker-runbook.md`

Acceptance criteria:
- Structured coordinator outcome event for `retried` includes `job_id`, current attempt, max attempts, retry reason, and remaining attempts.
- Structured outcome event for `dead_lettered` includes whether budget exhaustion or permanent classification caused it.
- Runbook documents v1 no-backoff behavior and recommends conservative `max_attempts`.
- Runbook documents alert condition: repeated `retried` outcomes for same `job_id` within a short window.
- ADR-11F is amended to state true delayed backoff remains post-v1 because it needs queue delayed-delivery support.

Tests to run:
- `node --version`
- `npm --prefix services/ocr-worker test`
- `node --test services/ocr-worker/tests/observability.test.mjs`
- `node --test services/ocr-worker/tests/coordinator.retryWiring.test.mjs`

Verification command: `/cc-suite:verify WI-07`

Audit command: `/cc-suite:audit --mini services/ocr-worker/src/coordinator.ts services/ocr-worker/src/observability.ts services/ocr-worker/src/cli.ts services/ocr-worker/tests/observability.test.mjs services/ocr-worker/tests/coordinator.retryWiring.test.mjs docs/adr/ocr-coordinator-retry-wiring-step-11f.md docs/release/ocr-worker-runbook.md`

Risk level: Medium

Ownership: Claude writes, Codex validates

Autonomy: Autonomous OK

v1 bucket: v1-blocking

### WI-08 - Coordinator L2/L3 Refactor

Goal: Reduce `coordinator.ts` function length and duplicate `completeClaim` error mapping without changing behavior.

Predecessor: WI-07

Likely files:
- `services/ocr-worker/src/coordinator.ts`
- `services/ocr-worker/tests/coordinator.test.mjs`
- `services/ocr-worker/tests/coordinator.retryWiring.test.mjs`
- `services/ocr-worker/tests/workerLoop.test.mjs`

Acceptance criteria:
- `processOneOcrQueueClaim` is decomposed into named helpers for claim inspection, outcome classification, persistence, retry/dead-letter finalization, and claim completion.
- `completeClaim` error mapping is centralized in one helper.
- Existing outcome strings and error-code mapping remain unchanged.
- No queue/persistence lifecycle ownership moves out of the coordinator.
- Tests prove `unknown_receipt`, `stale_receipt`, and `lease_expired` remain distinct.

Tests to run:
- `node --version`
- `npm --prefix services/ocr-worker test`
- `node --test services/ocr-worker/tests/coordinator.test.mjs`
- `node --test services/ocr-worker/tests/coordinator.retryWiring.test.mjs`
- `node --test services/ocr-worker/tests/workerLoop.test.mjs`

Verification command: `/cc-suite:verify WI-08`

Audit command: `/cc-suite:audit --mini services/ocr-worker/src/coordinator.ts services/ocr-worker/tests/coordinator.test.mjs services/ocr-worker/tests/coordinator.retryWiring.test.mjs services/ocr-worker/tests/workerLoop.test.mjs`

Risk level: Medium

Ownership: Claude writes, Codex validates

Autonomy: Autonomous OK

v1 bucket: v1-deferred

### WI-09b - Operator Runbook And Deployment Documentation

Goal: Fill the minimum operator documentation needed to run and recover v1 safely.

Predecessor: WI-06, WI-07. If WI-06 is explicitly deferred, WI-09b may proceed after WI-07 and the WI-06 deferral decision; WI-09b must draft the pending-retry manual-recovery residual-risk language itself for later WI-13 inclusion.

Likely files:
- `docs/release/ocr-worker-runbook.md`
- `docs/release/operator-checklist.md`
- `docs/contracts/README.md`
- `services/ocr-worker/README.md`
- `services/ocr-persistence/README.md`
- `AGENTS.md`

Acceptance criteria:
- Runbook documents production env vars: `NODE_ENV=production`, `OCR_WORKER_REQUIRE_REAL=1`, `OCR_WORKER=paddleocr-onnx`, `OCR_FETCHER_FILE_ROOT`, `OCR_FETCHER_HTTPS_HOSTS`, SQLite path, queue selector, persistence selector.
- Runbook documents production fail-closed behavior and expected exit code 2 for invalid profile.
- Runbook documents source-kind policy: file, inline, https admitted; s3 rejected; S3 uses pre-signed HTTPS.
- Runbook documents pending-retry recovery and reconciler dry-run/apply flow from WI-06, or if WI-06 is explicitly deferred, documents the manual workaround and drafts explicit residual-risk language for WI-13 to accept, reject, or escalate.
- Runbook documents no PDF support in v1 and upstream rasterization responsibility.
- Operator checklist includes day-0 Node, dependency audit, config, fail-closed, queue/persistence, rollback, commit/diff-hash evidence, and audit checks.
- `AGENTS.md` is updated only if a new durable instruction is needed; `CLAUDE.md` and `GEMINI.md` remain untouched.

Tests to run:
- `node --version`
- `npm --prefix docs/contracts test`
- `npm --prefix services/ocr-worker test`
- `npm --prefix services/ocr-persistence test`

Verification command: `/cc-suite:verify WI-09b`

Audit command: `/cc-suite:audit --mini docs/release/ocr-worker-runbook.md docs/release/operator-checklist.md docs/contracts/README.md services/ocr-worker/README.md services/ocr-persistence/README.md AGENTS.md`

Risk level: Low

Ownership: Claude writes, Codex validates

Autonomy: Autonomous OK

v1 bucket: v1-blocking

### WI-10 - Production Fail-Closed Release Probe

Goal: Verify production startup cannot accidentally run the fake worker.

Predecessor: WI-09b

Likely files:
- `services/ocr-worker/src/config.ts`
- `services/ocr-worker/src/cli.ts`
- `services/ocr-worker/tests/config.test.mjs`
- `services/ocr-worker/tests/cli.spawn.test.mjs`
- `services/ocr-worker/tests/cli.test.mjs`
- `docs/release/operator-checklist.md`

Acceptance criteria:
- `NODE_ENV=production` with `OCR_WORKER_REQUIRE_REAL` unset exits 2 before dependency construction.
- `NODE_ENV=production` with `OCR_WORKER=fake` exits 2.
- `OCR_WORKER_REQUIRE_REAL=1` with `OCR_WORKER=fake` exits 2 outside production too.
- `--worker` missing value, `--worker=`, and unknown worker key remain config errors.
- Valid production profile with `OCR_WORKER=paddleocr-onnx` reaches worker construction.
- Operator checklist includes exact preflight command and expected failure/success cases.

Tests to run:
- `node --version`
- `npm --prefix services/ocr-worker test`
- `node --test services/ocr-worker/tests/config.test.mjs`
- `node --test services/ocr-worker/tests/cli.spawn.test.mjs`
- `node --test services/ocr-worker/tests/cli.test.mjs`

Verification command: `/cc-suite:verify WI-10`

Audit command: `/cc-suite:audit --mini services/ocr-worker/src/config.ts services/ocr-worker/src/cli.ts services/ocr-worker/tests/config.test.mjs services/ocr-worker/tests/cli.spawn.test.mjs services/ocr-worker/tests/cli.test.mjs docs/release/operator-checklist.md`

Risk level: Medium

Ownership: Claude writes, Codex validates

Autonomy: Autonomous OK

v1 bucket: v1-blocking

### WI-11a - Fixture Acquisition Gate

Goal: Resolve whether v1 ships with real redacted Chinese-pleading fixture evidence or an explicit synthetic-only waiver.

Predecessor: WI-09a

Tags: Pause-pending-user-input

Likely files:
- `services/ocr-worker-bakeoff/fixtures/manifest.json`
- `services/ocr-worker-bakeoff/fixtures/real/*`
- `docs/adr/ocr-engine-bakeoff-step-11a-1.md`

Acceptance criteria:
- Stop-and-ask approval uses the WI-11a pre-fill and records option A or B.
- User supplies at least 2 redacted real Chinese-pleading fixtures, or explicitly signs a written waiver recorded in the ADR.
- If fixtures are supplied, they land under `services/ocr-worker-bakeoff/fixtures/` with manifest entries.
- Manifest entries include fixture category, source/provenance, PII review state, intent metadata, and expected drift metadata.
- If waived, ADR records: v1 ships on synthetic-only quality evidence, no real legal-document external-validity claim is made, and WI-11b/WI-11c real-fixture measurement requirements are deferred with explicit risk acceptance.

Tests to run:
- `node --version`
- `npm --prefix services/ocr-worker-bakeoff test`
- `node --test services/ocr-worker-bakeoff/tests/manifest.test.mjs`

Verification command: `/cc-suite:verify WI-11a`

Audit command: `/cc-suite:audit --full services/ocr-worker-bakeoff/fixtures/manifest.json services/ocr-worker-bakeoff/fixtures/real docs/adr/ocr-engine-bakeoff-step-11a-1.md`

Risk level: High

Ownership: Claude writes, Codex validates

Autonomy: Stop and ask first; Pause-pending-user-input

v1 bucket: v1-blocking

### WI-11b - Bakeoff Harness And Report Schema

Goal: Fix bakeoff measurement validity issues before the full v1.0 measurement run, or record deferral if WI-11a selected the synthetic-only waiver branch.

Predecessor: WI-11a

Likely files:
- `services/ocr-worker-bakeoff/src/runner.ts`
- `services/ocr-worker-bakeoff/src/manifest.ts`
- `services/ocr-worker-bakeoff/src/report.ts`
- `services/ocr-worker-bakeoff/src/accuracy.ts`
- `services/ocr-worker-bakeoff/tests/runner-multi-candidate.test.mjs`
- `services/ocr-worker-bakeoff/tests/manifest.test.mjs`
- `services/ocr-worker-bakeoff/tests/accuracy.test.mjs`
- `services/ocr-worker-bakeoff/tests/report.test.mjs`
- `docs/adr/ocr-engine-bakeoff-step-11a-1.md`

Acceptance criteria:
- WI evidence records branch from WI-11a: real-fixture branch or synthetic-only-waiver branch.
- On the real-fixture branch, candidate ordering bias is addressed by randomized seed, counterbalanced passes, or fixture-major interleaving; chosen method is recorded in reports.
- Report schema includes fixture category and intent metadata.
- Report schema includes expected drift metadata sufficient to distinguish intentional punctuation drift from regression.
- Tesseract `chi_sim` install handling is explicit: measurement runs with `chi_sim` installed or marks the candidate unavailable with exact install/probe failure.
- Harness remains deterministic enough for audit: randomization seed is recorded and replayable.
- If WI-11a waiver path was chosen, harness records that real fixture category is absent by waiver rather than silently absent, and WI evidence marks real-fixture measurement deferred-with-residual-risk.

Tests to run:
- `node --version`
- `npm --prefix services/ocr-worker-bakeoff test`
- `node --test services/ocr-worker-bakeoff/tests/runner-multi-candidate.test.mjs`
- `node --test services/ocr-worker-bakeoff/tests/manifest.test.mjs`
- `node --test services/ocr-worker-bakeoff/tests/accuracy.test.mjs`
- `node --test services/ocr-worker-bakeoff/tests/report.test.mjs`

Verification command: `/cc-suite:verify WI-11b`

Audit command: `/cc-suite:audit --full services/ocr-worker-bakeoff/src/runner.ts services/ocr-worker-bakeoff/src/manifest.ts services/ocr-worker-bakeoff/src/report.ts services/ocr-worker-bakeoff/src/accuracy.ts services/ocr-worker-bakeoff/tests/runner-multi-candidate.test.mjs services/ocr-worker-bakeoff/tests/manifest.test.mjs services/ocr-worker-bakeoff/tests/accuracy.test.mjs services/ocr-worker-bakeoff/tests/report.test.mjs docs/adr/ocr-engine-bakeoff-step-11a-1.md`

Risk level: Medium

Ownership: Claude writes, Codex validates

Autonomy: Autonomous OK after WI-11a user input

v1 bucket: v1-blocking-conditional

### WI-11c - Full Measurement Run

Goal: Run the bakeoff harness against the v1 corpus and produce release evidence, or record synthetic-only-waiver measurement evidence.

Predecessor: WI-11b

Likely files:
- `services/ocr-worker-bakeoff/reports/*`
- `docs/release/test-and-audit-report.md`
- `docs/adr/ocr-engine-bakeoff-step-11a-1.md`

Acceptance criteria:
- Harness runs against synthetic corpus and real corpus if WI-11a delivered real fixtures.
- If WI-11a waiver path was chosen, report explicitly states synthetic-only run and cites ADR waiver.
- Report records Node version, host metadata, candidate versions, model versions, seed/order method, fixture list, CER, latency, RSS, license, install friction, and skipped/unavailable candidates.
- Tesseract Chinese measurement is present if `chi_sim` is installed; otherwise report records exact install/probe failure.
- Report is linked or summarized in `docs/release/test-and-audit-report.md`.
- If Codex is to execute only the measurement run, the user must pre-authorize WI-11c in User-authorized Codex-writes WIs or in the current turn; otherwise Claude executes and Codex validates.

Tests to run:
- `node --version`
- `npm --prefix services/ocr-worker-bakeoff test`
- `node services/ocr-worker-bakeoff/bin/bakeoff.mjs --role=verdict`

Verification command: `/cc-suite:verify WI-11c`

Audit command: `/cc-suite:audit --full services/ocr-worker-bakeoff docs/release/test-and-audit-report.md docs/adr/ocr-engine-bakeoff-step-11a-1.md`

Risk level: Medium

Ownership: Claude writes, Codex validates unless user pre-authorizes Codex execution for WI-11c

Autonomy: Autonomous OK after WI-11a user input

v1 bucket: v1-blocking-conditional

### WI-11d - ADR-11A.1 v1.0 Verdict Amendment

Goal: Lock the default OCR engine for v1 or mark go-live blocked.

Predecessor: branch-conditional plus WI-10. On the real-fixture branch where WI-11a chose Option A, predecessor is WI-11c and WI-10. On the synthetic-only-waiver branch where WI-11a chose Option B, predecessor is WI-11a and WI-10; WI-11b/WI-11c may be deferred by waiver and do not block WI-11d.

Likely files:
- `docs/adr/ocr-engine-bakeoff-step-11a-1.md`
- `docs/release/go-live-readiness-report.md`

Acceptance criteria:
- ADR v1.0 amendment states the chosen default engine or states that go-live is blocked.
- Verdict references WI-11c measurement report on the real-fixture branch, or WI-11a synthetic-only waiver on the waiver branch.
- Verdict records which branch applied: real-fixture branch or synthetic-only-waiver branch.
- Verdict evaluates CER, latency, RSS, license, install friction, and real-fixture external validity if real fixtures were supplied.
- If shipping on synthetic-only evidence, ADR records explicit waiver and residual risk in language suitable for WI-13.
- Default engine choice is consistent with production fail-closed config in WI-10.

Tests to run:
- `node --version`
- `npm --prefix services/ocr-worker-bakeoff test`
- `npm --prefix services/ocr-worker test`

Verification command: `/cc-suite:verify WI-11d`

Audit command: `/cc-suite:audit --full docs/adr/ocr-engine-bakeoff-step-11a-1.md docs/release/go-live-readiness-report.md services/ocr-worker-bakeoff services/ocr-worker/src/config.ts`

Risk level: High

Ownership: Claude writes, Codex validates

Autonomy: Stop and ask first

v1 bucket: v1-blocking

### WI-12 - Full Test Matrix And Full Audit Sweep

Goal: Prove all packages still pass and no Critical/High audit findings remain before readiness reporting.

Predecessor: WI-00, WI-09a, WI-00b, WI-01, WI-02t, WI-02, WI-03a, WI-03b, WI-03c, WI-03d, WI-04, WI-05 unless explicitly deferred, WI-06 unless explicitly deferred, WI-07, WI-09b, WI-10, WI-11a, WI-11b unless deferred by WI-11a waiver, WI-11c unless deferred by WI-11a waiver, WI-11d. WI-08 is excluded because it is v1-deferred.

Likely files:
- `docs/release/test-and-audit-report.md`
- `docs/release/operator-checklist.md`
- `docs/release/ocr-worker-runbook.md`
- Changed files from WI-01 through WI-11d

Acceptance criteria:
- All five core package test commands pass.
- `services/ocr-worker-bakeoff` test command passes if the package remains part of release evidence.
- Test report records command, date, Node version, pass/fail result, and skipped-test count.
- Full cc-suite audit runs on changed release scope.
- Audit scope is a superset of files changed in WI-01 through WI-11d.
- Audit scope explicitly includes `dev-memo/prototypes/*`, `services/ocr-worker-bakeoff/`, `docs/release/`, and every package whose tests run in this WI.
- No unresolved Critical or High audit findings remain.
- All CVE sub-WIs marked `blocking` must be resolved before WI-12 can complete; `residual-risk-candidate` CVEs must be explicitly resolved or rejected by WI-13.
- Any unresolved Medium/Low findings are listed with explicit release impact.

Tests to run:
- `node --version`
- `npm --prefix docs/contracts test`
- `npm --prefix services/ocr-persistence test`
- `npm --prefix services/ocr-worker test`
- `npm --prefix services/ocr-ingestion test`
- `npm --prefix services/ocr-review test`
- `npm --prefix services/ocr-worker-bakeoff test`

Verification command: `/cc-suite:verify WI-12`

Audit command: `/cc-suite:audit --full docs/contracts/src docs/contracts/schemas docs/contracts/tests services/ocr-persistence/src services/ocr-persistence/tests services/ocr-worker/src services/ocr-worker/tests services/ocr-ingestion/src services/ocr-ingestion/tests services/ocr-review/src services/ocr-review/tests services/ocr-worker-bakeoff dev-memo/prototypes docs/adr docs/release`

Risk level: Medium

Ownership: Claude writes, Codex validates

Autonomy: Autonomous OK after predecessors complete

v1 bucket: v1-blocking

### WI-13 - Final Go-Live Readiness Report

Goal: Produce the final go-live readiness report required by AGENTS.md.

Predecessor: WI-12

Likely files:
- `docs/release/go-live-readiness-report.md`
- `docs/release/test-and-audit-report.md`
- `docs/release/operator-checklist.md`
- `docs/release/ocr-worker-runbook.md`
- `docs/release/go-live-plan.md`

Required readiness report sections, in order:
1. Verdict: GO / NO-GO / GO-WITH-CAVEATS, with one-sentence rationale.
2. v1 WI status: table mapping each WI to complete/deferred/blocked, with columns for WI, status, v1 bucket, conditional branch resolved, proof artifact, test report ID, and audit thread ID. For conditional WIs such as WI-11b/WI-11c, the conditional branch resolved column records `real-fixture`, `synthetic-only-waiver`, or `not applicable`, and names any residual risk accepted.
3. Test matrix: per-package result, Node version, skipped-test count, timestamp.
4. Audit findings: unresolved findings by severity: Critical/High/Medium/Low, with release impact.
5. Security / migration / API clearance: SSRF, retry, outbox, persistence schema, queue invariants, contract surfaces, each explicitly cleared or blocked.
6. Dependency / CVE status: from WI-00 and WI-00-CVE sub-WIs; current `npm audit` output summary; any unfixed Critical/High CVEs.
7. Preflight result: from WI-00 and WI-00b; cc-suite/codex-cli compat OK? Node version pinned? Scope-violation protocol followed? Rollback procedure tested?
8. Rollback status: list any WIs that required rollback during the loop; include `.cc-suite/<wi-id>-baseline.patch`, `.cc-suite/<wi-id>-after.patch`, `.cc-suite/<wi-id>-current.patch`, rollback command, and result.
9. Residual risks: deferred items with one-line risk and mitigation each.
10. Operational preflight checklist: commands the operator runs on day-0 deployment.
11. Audience: Engineering lead + on-call + legal for compliance items.

Acceptance criteria:
- Report maps every WI in this plan to `complete`, `deferred`, or `blocked`.
- Report includes a v1 WI status table with a "Conditional branch resolved" column; for WI-11b/WI-11c it records which branch applied and which residual risk was accepted, if any.
- Report includes final test matrix result and skipped-test count.
- Report includes full-audit result and all unresolved findings by severity.
- Report explicitly clears or blocks security, migration, persistence, queue, contract, and API risks.
- Report includes dependency/CVE status from WI-00 and current `npm audit` summary.
- Each residual-risk-candidate CVE from WI-00 must be either accepted with explicit residual-risk language or escalated as a non-waivable blocker.
- Report includes preflight result from WI-00 and WI-00b.
- Report includes rollback status and per-WI patch artifacts from the Branch, Commit, And Evidence Policy.
- Report includes production preflight checklist.
- Report states whether v1 is ready to go live; if not, it names the blocking WI(s).
- Proof artifact for each completed WI is either a commit SHA when the user authorized a commit, or a working-tree diff hash when no commit exists. Working-tree hashes use `sha256sum` on Linux or `shasum -a 256` on macOS and are paired with the relevant per-WI patch artifacts.
- Report does not create a release, tag, commit, push, branch, or deployment.
- If readiness report returns NO-GO:
  - The loop freezes; no further WI implementation proceeds.
  - WI-13 produces a blocker queue listing every blocking WI in severity order.
  - For each blocker, WI-13 assigns writer/validator mode, audit scope, and predecessor chain.
  - The user is presented with the blocker queue and chooses: restart from the highest-severity blocker, waive explicitly waivable residual risks, or pause v1 indefinitely.
  - The plan does not permit a partial-go-live: NO-GO means v1 is blocked until the user explicitly resolves the blocker queue.

AGENTS.md go-live rule, verbatim, governing WI-13 waiver bounds:

> The project is not ready to go live until:
> - All planned work items are complete.
> - All package tests pass.
> - Full audit has no unresolved Critical/High findings.
> - Security, migration, persistence, queue, contract, and API risks have been explicitly cleared.
> - A final go-live readiness report is produced.

Non-waivable blockers. Any of these mean v1 remains NO-GO regardless of waiver request:
- Unresolved Critical or High audit findings on production scope.
- Uncleared SSRF / TLS / DNS / crypto / auth / tenant-isolation / sandboxing risks.
- Uncleared schema migration risk on real-data tables.
- Uncleared queue lifecycle invariant breaks: OcrQueueError code stability, class identity, dedupe key, and no FK from queue rows to `ocr_jobs`.
- Uncleared contract / wire-format / public-API surface changes that have not been re-validated by `/cc-suite:audit`.
- Failed core package tests at WI-12.
- Production deployment or release publication gates from AGENTS.md.

Waivers are permitted only for explicitly non-critical residual risks: documentation gaps, deferred-refactor items, deferred operational tooling such as an automated reconciler when a manual workaround is documented, and synthetic-only quality evidence under the WI-11 waiver branch.

Tests to run:
- `node --version`
- `npm --prefix docs/contracts test`
- `npm --prefix services/ocr-persistence test`
- `npm --prefix services/ocr-worker test`
- `npm --prefix services/ocr-ingestion test`
- `npm --prefix services/ocr-review test`

Verification command: `/cc-suite:verify WI-13`

Audit command: `/cc-suite:audit --full docs/release/go-live-readiness-report.md docs/release/test-and-audit-report.md docs/release/operator-checklist.md docs/release/ocr-worker-runbook.md docs/release/go-live-plan.md`

Risk level: Medium

Ownership: Claude writes, Codex validates

Autonomy: Autonomous OK after predecessors complete

v1 bucket: v1-blocking

## Go-Live Readiness Gate

Mapping to AGENTS.md go-live rule:

- `All planned work items are complete.` WI-13 maps WI-00 through WI-13 to complete/deferred/blocked; v1 cannot ship if any v1-blocking WI is blocked.
- `All package tests pass.` WI-12 runs the full test matrix; WI-13 re-runs the five core package tests before report finalization.
- `Full audit has no unresolved Critical/High findings.` WI-12 runs `/cc-suite:audit --full`; WI-13 records final audit status.
- `Security, migration, persistence, queue, contract, and API risks have been explicitly cleared.` Security: WI-01 through WI-04 and WI-10; migration/persistence/queue: WI-05 and WI-06; contract/API: WI-02, WI-05, WI-06, WI-10, WI-12; ongoing invariant checks for every WI.
- `A final go-live readiness report is produced.` WI-13.

## Deferred To Post-v1

- WI-08 coordinator refactor: pure refactor and not release-critical.
- ADR-11F Q1 true delayed-delivery backoff: requires delayed-delivery queue semantics and likely queue API changes; v1 ships observability and conservative retry guidance instead.
- ADR-11F Q2 per-page retry: multi-page retry needs the N>1 lift and a separate policy for mixed page outcomes.
- True `kind: "s3"` admission: ADR-11D.3 intentionally keeps S3 rejected; v1 uses pre-signed HTTPS URLs to avoid AWS SDK/credential surface in the worker.
- PDF rasterization: ADR-11A.0 rejects PDF MIME in v1; upstream rasterization is required until a dedicated rasterizer ADR covers parser sandboxing and page mapping.
- Case-box layer: defer to its own ADR series because confidentiality, privilege, audit, deadline, and multi-user data shape are larger than OCR go-live hardening.
- Cloud OCR backend and cloud authorization schema: local OCR remains default; cloud opt-in per document is post-v1.
- Connection pooling or HTTP/HTTPS proxy support for HTTPS fetcher: both interact with DNS pinning and require a new security proof.
- Multi-host / network-FS / multi-tenant deployment hardening: v1 assumes local SQLite and a single-tenant worker host posture.
- Compliance-grade persisted audit table: v1 uses structured stderr/operator collection; persisted legal audit needs its own schema.
- Model-set override via env: requires allowlist and digest design; current runtime uses the locked default engine/model set.
