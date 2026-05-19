# Go-Live Plan

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
- **Factory name and export path**: factory is `makeNodeHttpsRequestTransport`, exported from both `services/ocr-worker/src/fetcher/index.ts` and `services/ocr-worker/src/index.ts`; after build, `import { makeNodeHttpsRequestTransport, HttpsTransport } from "<package>/dist/index.js"` must resolve. WI-02t transport tests already reference this name.
- **Factory options contract**: `makeNodeHttpsRequestTransport(options?: { ca?: string | Buffer | Array<string | Buffer> })`. The empty-object call `makeNodeHttpsRequestTransport({})` must be valid because WI-02t stubs already use it. No new runtime dependencies.
- **Lookup callback behavior**: defensive dual-mode. Primary proved path is Node 22's `options.all === true` returning the complete vetted list in resolver order (per WI-01 prototype). Fallback for the legacy `cb(err, address, family)` shape returns the first vetted address without re-sorting or filtering; the fallback is portability hardening, not the primary proof path.
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

Goal: Replace the global-`fetch` body of `makeNodeFetchHttpsTransport` with a `node:https.request`-based implementation that pins the socket to `allowedAddresses[0]` via a custom `lookup`, preserves the original URL hostname for Host/SNI/cert verification, accepts per-request `ca` injection, and is reachable via the locked factory export. **No runtime validation, no response-adapter changes, no test un-skips — those are in subsequent sub-WIs.**

Predecessor: WI-02

Likely files:
- `services/ocr-worker/src/fetcher/httpsTransport.ts`
- `services/ocr-worker/src/fetcher/types.ts`
- `services/ocr-worker/src/fetcher/index.ts`
- `services/ocr-worker/src/index.ts`

Acceptance criteria:
- New factory `makeNodeHttpsRequestTransport(options?: { ca?: string | Buffer | Array<string | Buffer> })` is exported from `services/ocr-worker/src/fetcher/index.ts` AND `services/ocr-worker/src/index.ts`. After build, `import { makeNodeHttpsRequestTransport, HttpsTransport } from "<package>/dist/index.js"` resolves. `makeNodeHttpsRequestTransport({})` is a valid call.
- Implementation uses `node:https.request` with `agent: false`, `rejectUnauthorized: true`, `servername: url.hostname`, manual redirect handling (transport does NOT follow 3xx — returns `{status, headers, body}` for redirects).
- Custom `lookup` callback supports BOTH `options.all === true` (Node 22, primary) AND the legacy `cb(err, address, family)` shape (defensive). In primary mode the callback returns the complete vetted `allowedAddresses` list in resolver order. In legacy mode it returns the first vetted entry without re-sorting or filtering.
- Per-request CA injection wired through `options.ca` (not `NODE_EXTRA_CA_CERTS`).
- Host header, URL hostname, SNI `servername`, and certificate verification all use the original URL hostname; the socket connects to `allowedAddresses[0]` only.
- `makeNodeFetchHttpsTransport` (the legacy global-`fetch` default from WI-02) is REMOVED or marked deprecated with an explicit note; production deps wiring (in `services/ocr-worker/src/cli.ts` or equivalent) is updated to use the new factory.
- No new runtime dependencies introduced.
- No entries added to `FETCHER_ERROR_CODES` (public fetcher error surface unchanged).
- Build clean: `npm --prefix services/ocr-worker run build`. Existing tests still green (the existing 48 fetcher.https.test.mjs tests, the cross-package smokes); transport tests in `fetcher.https.transport.test.mjs` remain skipped — WI-03a does NOT un-skip them.
- ADR §3 / §4 updated to record WI-03a landed the transport core; runtime validation (§5) and response adapter (§6) status remain "pending" until WI-03b / WI-03c.

Tests to run:
- `node --version`
- `npm --prefix services/ocr-worker run build`
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

Goal: At transport entry, validate `init.allowedAddresses` against the full ADR §5 surface and reject malformed values with stable internal transport error discriminators that the fetcher maps to existing public fetcher error codes.

Predecessor: WI-03a

Likely files:
- `services/ocr-worker/src/fetcher/httpsTransport.ts`
- `services/ocr-worker/src/fetcher/types.ts` (internal error type/class; no FETCHER_ERROR_CODES additions)
- `services/ocr-worker/src/fetcher/fetchPageBytes.ts` (transport-error → fetcher-error mapping, if any new mapping is needed)
- `services/ocr-worker/tests/fetcher.https.transport.test.mjs` (un-skip the 15 runtime-validation cases)

Acceptance criteria:
- Transport rejects, before any socket activity: missing `allowedAddresses`; empty array; non-array; non-plain-object element (`Object.getPrototypeOf(value) === Object.prototype` check); non-string `address`; nonnumeric `family`; `family` not in `{4, 6}`; malformed IPv4 literal; malformed IPv6 literal; IPv4-mapped IPv6 dotted form (`::ffff:1.2.3.4`); IPv4-mapped IPv6 hex form (`::ffff:0102:0304`); scoped IPv6 (`fe80::1%lo0`); family/address mismatch; private IPv4 (defense-in-depth, even though fetcher already screened); private IPv6.
- A new internal transport error type (e.g. `TransportInputError` with a stable `code` discriminator: `MISSING_ALLOWED_ADDRESSES`, `EMPTY_ALLOWED_ADDRESSES`, `NON_ARRAY`, `NON_PLAIN_OBJECT`, `NON_STRING_ADDRESS`, `NON_NUMERIC_FAMILY`, `INVALID_FAMILY`, `MALFORMED_IPV4`, `MALFORMED_IPV6`, `MAPPED_IPV6`, `SCOPED_IPV6`, `FAMILY_ADDRESS_MISMATCH`, `PRIVATE_ADDRESS`) lives inside `httpsTransport.ts` or a sibling module. It is NOT exported as part of the public fetcher surface.
- `FETCHER_ERROR_CODES` is unchanged. The fetcher maps every transport-internal validation error to the existing `https_network_error` public code, per ADR §7. The mapping is centralized and tested.
- The 15 runtime address-validation tests in `fetcher.https.transport.test.mjs` (currently `test.skip(..., { skip: "Unlocked by WI-03" })`) are un-skipped and pass. Each test's assertion is tightened from a message-regex to assert on the transport-internal code/class as the primary check, with the message regex retained as a secondary readability check.
- No new public fetcher error codes added.
- No new runtime dependencies.

Tests to run:
- `node --test services/ocr-worker/tests/fetcher.https.transport.test.mjs`
- `npm --prefix services/ocr-worker test`

Verification command: `/cc-suite:verify WI-03b`

Audit command: `/cc-suite:audit --full services/ocr-worker/src/fetcher/httpsTransport.ts services/ocr-worker/src/fetcher/types.ts services/ocr-worker/src/fetcher/fetchPageBytes.ts services/ocr-worker/tests/fetcher.https.transport.test.mjs`

Risk level: Critical
Ownership: Claude writes, Codex validates
Autonomy: Stop and ask first
v1 bucket: v1-blocking

---

### WI-03c - Response Adapter (Content-Length, Uint8Array, Abort, 3xx)

Goal: Implement the transport-owned response adapter per ADR §6 — strict Content-Length parsing (in the transport, before yielding a successful `HttpsTransportResponse`), Buffer-to-Uint8Array strict adaptation on body chunks, abort propagation through every phase, and the 3xx return-shape contract.

Predecessor: WI-03b

Likely files:
- `services/ocr-worker/src/fetcher/httpsTransport.ts`
- `services/ocr-worker/tests/fetcher.https.transport.test.mjs` (un-skip content-length + body shape + abort tests; total ~11 cases)

Acceptance criteria:
- **Content-Length parsing happens in the transport**, before yielding a successful `HttpsTransportResponse`. Reject with a transport-internal error (mapped to `https_network_error`) on: leading zero (`"0123"`), negative (`-1`), non-integer (`"12.5"`), duplicate values (`"100, 200"`). Accept literal `"0"` (the empty-body case). Absent header is acceptable; transport streams under the existing size cap, no size hint. Fetcher must not need to re-parse Content-Length.
- **Body chunks** yielded by the response's `AsyncIterable<Uint8Array>` satisfy `chunk.constructor === Uint8Array`. `Buffer` is NOT acceptable (even though `Buffer extends Uint8Array`).
- **3xx handling**: transport returns `{ status, headers, body }` for any 3xx response — does NOT follow the redirect. The fetcher (existing code) maps to `redirect_unsupported`. Transport must not consume the redirect body unnecessarily.
- **Abort by phase**:
  - **Connect phase** (before TCP/TLS established): on signal abort, transport calls `req.destroy(<abort-marker>)` and surfaces an error normalized to the abort discriminator. Fetcher maps to `https_timeout`.
  - **Headers phase** (after socket established, before response headers received): on signal abort, transport calls `req.destroy(<abort-marker>)` and any `res.destroy` if applicable; surfaces the same abort discriminator.
  - **Body phase** (during body iteration): on signal abort, transport calls `res.destroy(<abort-marker>)` (and `req.destroy` if needed) so the body's `AsyncIterable` **throws** the normalized abort error. Iteration must NOT end as a partial-success.
- Signal listeners installed on the AbortSignal are removed on normal completion, error, AND abort to avoid listener leaks.
- All content-length, body-shape, abort-phase tests in `fetcher.https.transport.test.mjs` un-skipped and pass.
- No new public fetcher error codes; no new runtime dependencies.

Tests to run:
- `node --test services/ocr-worker/tests/fetcher.https.transport.test.mjs`
- `npm --prefix services/ocr-worker test`

Verification command: `/cc-suite:verify WI-03c`

Audit command: `/cc-suite:audit --full services/ocr-worker/src/fetcher/httpsTransport.ts services/ocr-worker/tests/fetcher.https.transport.test.mjs`

Risk level: Critical
Ownership: Claude writes, Codex validates
Autonomy: Stop and ask first
v1 bucket: v1-blocking

---

### WI-03d - TLS Test Harness + Un-skip All Transport Tests

Goal: Promote a TLS test harness (cert helper + local HTTPS server lifecycle, static TEST-ONLY PEM fixtures) under `services/ocr-worker/tests/`, un-skip the remaining ~18 transport tests in `fetcher.https.transport.test.mjs` (TLS scenarios, manual 3xx, e2e mapping, no-reorder), and produce the post-WI-03 readiness summary.

Predecessor: WI-03c

Likely files:
- `services/ocr-worker/tests/helpers/tls-server.mjs` (new — server lifecycle + capability probes including 127.0.0.2)
- `services/ocr-worker/tests/helpers/tls-fixtures.mjs` (new — static fixture loader)
- `services/ocr-worker/tests/fixtures/tls/README.md` (new — TEST-ONLY warning, regeneration instructions)
- `services/ocr-worker/tests/fixtures/tls/ca.crt` (new — TEST-ONLY)
- `services/ocr-worker/tests/fixtures/tls/server-hostname.{key,crt}` (new — TEST-ONLY; cert valid for `allowed-host.test`)
- `services/ocr-worker/tests/fixtures/tls/server-ip-only.{key,crt}` (new — TEST-ONLY; cert valid only for IP literal)
- `services/ocr-worker/tests/fixtures/tls/server-wrong-host.{key,crt}` (new — TEST-ONLY; cert valid for `other-host.test`)
- `services/ocr-worker/tests/fetcher.https.transport.test.mjs` (un-skip remaining cases)
- `docs/adr/ocr-fetcher-https-dns-pinning-step-11d-2-a.md` (status + §2.1 update)
- `dev-memo/regen-tls-fixtures.md` (new — one-off OpenSSL regeneration script docs)

Acceptance criteria:
- TLS fixtures under `services/ocr-worker/tests/fixtures/tls/` are static checked-in PEM files. Each `.key` file is accompanied by a clear comment / adjacent README marking it as **TEST-ONLY, NOT A SECRET**. Regenerating the fixtures uses a documented one-off OpenSSL script (in `dev-memo/`); the test suite itself does not require OpenSSL at runtime.
- `services/ocr-worker/tests/helpers/tls-server.mjs` provides start/stop helpers for local HTTPS servers bound to `127.0.0.1`, with optional `127.0.0.2` binding gated on a capability probe. Servers expose distinct response markers so the no-reorder test can identify entry[0] vs entry[1].
- The no-reorder test runs both sub-cases when 127.0.0.2 is available; when not, it skips ONLY the alias-dependent sub-case (not the entire transport suite) with a platform-specific reason naming the missing capability.
- TLS scenarios: cert-valid-for-hostname passes (status 200, server saw original hostname in Host + SNI, socket peer is 127.0.0.1); IP-only cert fails with hostname-verification error (`ERR_TLS_CERT_ALTNAME_INVALID` or `ERR_OSSL_X509_HOST_MISMATCH` — narrow accept set per WI-01 prototype audit); wrong-host cert fails identically.
- Manual 3xx test: local server returns 302 + Location header; transport returns `{status: 302, headers, body: empty}` without following.
- All remaining `Unlocked by WI-03` skips in `fetcher.https.transport.test.mjs` are removed; the file has zero residual `Unlocked by WI-03` skips at WI-03d completion.
- The legacy `makeNodeFetchHttpsTransport` (if still present from WI-02) is fully removed in WI-03d (or earlier in WI-03a per that sub-WI's deprecation choice); all production deps wiring uses `makeNodeHttpsRequestTransport`.
- ADR top-level Status changes from "Partial: seam (WI-02) landed; production transport rewrite (WI-03) pending" to a final state explicitly noting that WI-03a/b/c/d closed the implementation gap and that post-WI-03 security sign-off is the remaining gate. ADR §3 / §4 / §5 / §6 / §7 / §2.1 are updated to reflect each section's landed state.
- Post-WI-03 readiness summary appended to `docs/release/test-and-audit-report.md` (or equivalent) noting: implementation gap closed; cli.spawn:260 SIGINT flake remains pre-existing and out of scope; security sign-off still required before claiming SSRF fixed in production.
- No new public fetcher error codes; no new runtime dependencies.

Tests to run:
- `node --test services/ocr-worker/tests/fetcher.https.transport.test.mjs`
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
