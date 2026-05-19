Status: WI-00b preflight evidence recorded 2026-05-19. WI-12 will append the final full-sweep run; sections may carry both a "WI-00b preflight" row and a "WI-12 final" row at that point.

## Run Metadata (Command, Node Version, Timestamp, Host, Git SHA)

| Field | Value |
|-------|-------|
| Recording WI | WI-00b (Preflight Evidence Record) |
| Recorded by | Claude (writer) — per default ownership for WI-00b |
| Timestamp (UTC) | 2026-05-19T10:47:05Z |
| Host | Macbook-Air-M2 (Darwin arm64) |
| Node version | v22.22.1 (LTS line `lts/jod` per `~/.nvm`; pinned per round-4 plan WI-00 1b) |
| npm version | 10.9.4 |
| Git SHA (HEAD at WI-00 sweep) | `1c05d41` (WI-09a release-doc scaffold) |
| Git SHA (HEAD at WI-00b record) | `585c1c8` (Add no-choice autonomous cc-suite defaults) |
| codex-cli version | 0.131.0 |
| cc-suite plugin version | xiaolai/cc-suite v0.2.10 |
| cc-suite runner patch | applied (removes `--approval-policy` + `--quiet` pushes in `runCodexSync` for codex-cli ≥0.131 compat) |
| Test command pattern | `npm --prefix <pkg> test` (no flags) |

## Per-Package Test Results (Table: Package | Tests | Pass | Fail | Skipped | Duration)

Run captured 2026-05-19T10:47Z under Node v22.22.1 after `npm rebuild` against the Node 22 ABI (see Operational Notes).

| Package | Tests | Pass | Fail | Skipped | Duration (ms) |
|---------|-------|------|------|---------|---------------|
| docs/contracts | 102 | 102 | 0 | 0 | 284 |
| services/ocr-persistence | 231 | 231 | 0 | 0 | 793 |
| services/ocr-worker | 406 | 403 | 0 | 3 | 3457 |
| services/ocr-ingestion | 30 | 30 | 0 | 0 | 170 |
| services/ocr-review | 38 | 38 | 0 | 0 | 401 |
| **TOTAL** | **807** | **804** | **0** | **3** | **5105** |

Bakeoff (`services/ocr-worker-bakeoff`): not included in WI-00b sweep. WI-12 will record bakeoff test results alongside the rest of the matrix per WI-12 acceptance.

Skipped test breakdown: 3 in `services/ocr-worker` (opt-in tests). Carries forward to WI-12 final report.

## Audit Thread IDs (Table: Scope | Thread ID | Model | Effort | Verdict | Unresolved-Findings Count)

Threads run during the plan-authoring and WI-00/WI-09a loop (chronological). Round-4 verify+audit threads tied to WI-XX are listed alongside their owning WI.

| Scope | Thread ID | Model | Effort | Verdict | Unresolved |
|-------|-----------|-------|--------|---------|------------|
| Plan review round 1 (initial go-live plan) | `review-plan-mpc91b7n-lxhv0m` | gpt-5.5 | high | NEEDS REVISION | 0 (all closed in subsequent rounds) |
| Plan review round 2 | `review-plan-mpc9wx30-o7scne` | gpt-5.5 | high | NEEDS REVISION | 0 (all closed in subsequent rounds) |
| Plan review round 3 | `review-plan-mpcagu84-ljfcez` | gpt-5.5 | high | NEEDS REVISION | 0 (all closed in subsequent rounds) |
| Plan author rounds (1–4) | various (`019e3ece`, `019e3ef8`, `019e3f06`, `019e3f17`) | gpt-5.5 | medium/high | n/a (authoring) | n/a |
| WI-09a scaffold mini audit | `audit-mpchhjqe-tu59qq` | gpt-5.4 | medium | NEEDS ATTENTION | 0 (6 valid findings applied; 2 cross-validated as Codex hallucinations and rejected with rationale recorded in commit `1c05d41`) |
| WI-09a verify | (not run separately; closure declared via cross-validated audit-fix loop per No-Choice Autonomous Default) | n/a | n/a | n/a | n/a |

## Unresolved Findings by Severity

### Critical (Location + Release Impact)

None.

### High (Location + Release Impact)

None unresolved. All High findings from the plan-review series (rounds 1–3) closed in round-4 plan revision; the WI-09a audit's single High (`go-live-readiness-report.md` §2 section name) was applied as a fix in commit `1c05d41`.

### Medium (Location + Release Impact)

None unresolved. All Medium findings from the WI-09a audit applied in commit `1c05d41`. Two Medium-rated findings from the WI-09a audit were rejected with cross-validation rationale (Codex hallucination on runbook section ordering; Codex misreading of WI-04 acceptance criteria for the proxy/pooling note).

### Low (Location + Release Impact)

None unresolved. All Low findings from the WI-09a audit applied or rejected per cross-validation in commit `1c05d41`.

## CVE Status (WI-00-CVE-* Sub-WI Status; Current `npm audit` Summary)

WI-00-CVE sub-WI ledger:

| Sub-WI | Package | Advisory | Severity | Status | Closing commit |
|--------|---------|----------|----------|--------|----------------|
| WI-00-CVE-fast-uri-001 | `fast-uri` (transitive of `ajv` in docs/contracts) | GHSA-q3j6-qgpj-74h6 + GHSA-v39h-62p7-jpjc | HIGH | RESOLVED | `0ab53c0` |

Current `npm audit --audit-level=high --omit=dev` per package (captured 2026-05-19T10:47Z under Node v22.22.1):

| Package | Result |
|---------|--------|
| docs/contracts | found 0 vulnerabilities |
| services/ocr-persistence | found 0 vulnerabilities |
| services/ocr-worker | found 0 vulnerabilities |
| services/ocr-ingestion | found 0 vulnerabilities |
| services/ocr-review | found 0 vulnerabilities |
| services/ocr-worker-bakeoff | found 0 vulnerabilities |

No outstanding Critical or High CVEs in production dependencies. devDeps not yet enumerated; WI-12 final sweep should expand to include devDep audit per the plan's full-evidence intent.

## Diff-Hash / Commit Evidence

WI-00b proof artifact policy per round-4 plan's Branch, Commit, And Evidence Policy: any WI's evidence can be (a) the closing commit SHA when committed, or (b) a working-tree diff hash (`shasum -a 256` on macOS / `sha256sum` on Linux) when uncommitted.

| WI | Status | Proof artifact | Notes |
|----|--------|----------------|-------|
| WI-00 (Preflight Check) | complete | n/a (writes no files per OF-2 fix; evidence captured here) | Cross-process state: `/cc-suite:status` clean at run end |
| WI-00-CVE-fast-uri-001 | complete | commit `0ab53c0` | Patch-level transitive upgrade fast-uri 3.1.0 → 3.1.2 |
| WI-09a (Release-doc scaffolds) | complete | commit `1c05d41` | Audit `audit-mpchhjqe-tu59qq`: 6 valid findings applied + 2 rejected with rationale in commit message |
| WI-00b (this record) | in progress | working-tree diff (this file); finalized SHA once committed | Evidence-only WI; no production code changes |

## Operational Notes (Captured During WI-00)

Notes that must be carried into WI-09b runbook + WI-09b operator checklist + WI-12 final sweep:

1. **Native module ABI**: `better-sqlite3` (and likely `@gutenye/ocr-node` + onnxruntime in `services/ocr-worker-bakeoff`) compile against the active Node ABI. Switching active Node version (e.g., `nvm use <ver>`) requires running `npm rebuild` in `services/ocr-persistence` and `services/ocr-worker` (and likely `services/ocr-worker-bakeoff` for WI-11c) before tests can pass. WI-00's first cross-package sweep failed 161 tests under Node 22 against Node-24-compiled binaries; after `npm rebuild`, all 804 tests passed cleanly. This step must be in WI-09b operator-checklist Node-version-check + WI-12 final-sweep prelude.

2. **codex-cli/cc-suite version drift**: cc-suite v0.2.10's `codex-runner.mjs` originally pushed `--approval-policy never` and `--quiet` flags into `codex exec`. Both removed in codex-cli ≥0.131. The local patch (comment-only retention; no live `codexArgs.push` calls for those flags) must be re-applied on any cc-suite plugin upgrade until upstream lands the fix.

3. **Codex scope-violation protocol**: verified active in three places — AGENTS.md ("Codex must not write code, modify files, create branches, apply patches, or mutate repo/task state unless the user explicitly authorizes implementation in the current turn"), round-4 plan's `User-authorized Codex-writes WIs: []` default, and the local `feedback_codex_implement_scope.md` memory note. Post-Codex `git status --short` + `git diff --stat` verification is required by both validation protocols (Codex-writes and Claude-writes).

4. **Rollback/quarantine acknowledged**: per-WI baseline patches captured in `.cc-suite/<wi-id>-baseline.patch`. WI-00b baseline patch: `.cc-suite/wi-00b-baseline.patch` (empty, since tree was clean against HEAD at WI-00b start).

## Preflight Verdict

✓ **PASS** — all WI-00 subgoals (1a/1b/1c/1d/1e) plus rollback acknowledgement met. One HIGH CVE surfaced (WI-00-CVE-fast-uri-001) and resolved as part of the preflight cycle. No outstanding Critical/High audit findings. Test matrix clean on the pinned Node version.

WI-00 predecessor for downstream WIs is now complete; WI-09a already followed and is also complete. Next executable WI per plan: WI-01 (HTTPS DNS-Pinning TLS Prototype Gate).
