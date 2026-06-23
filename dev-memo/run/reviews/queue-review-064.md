# Queue review 064 — WI-ENA11 (BATCH-CASEBOX-EVIDENCE-A07-MARKER-WRITE)

**Date**: 2026-06-23.
**WI**: WI-ENA11 — implement A0.7 marker WRITE + keyed VALIDATION + a guard ledger, per A07-MARK-00, with
LOCAL-ONLY gitignored markers and ENV-supplied HMAC key custody (`LAWBAR_A07_MARKER_HMAC_KEY`). Writer reuses
the A0.7 harness via a minimal Swift CLI; guard `--staged`/tracked reject all evidence-namespace material
unconditionally; `--scan` validates only genuine local markers (key + ledger). The apex marker authority.
**HIGH-RISK** (crypto HMAC provenance + key custody + ledger + new Swift build target).
**Queue**: `dev-memo/run/queue.md` (single WI; prior WI-ENA10 executed + merged via PR #112, `5d75f57`).
**Reviewed queue.md sha256**: `dc54b6809bb26d95d0da883456520c35127108049de61a9b59065c86c1d4efbc`.

## Storage + key custody decisions (resolved by the user this lane)
- Markers are LOCAL-ONLY run-state, gitignored (`dev-memo/run/evidence/`), NEVER committed. A single
  `.gitignore` entry is authorized for this WI.
- Key custody: ENV-supplied HMAC key only; no committed/long-lived/cloud/keychain/network key; tests use
  ephemeral temp keys; write fails closed on missing/empty/weak key.
- Guard: `--staged`/commit/tracked reject ALL `dev-memo/run/evidence/**` unconditionally; `--scan` of local
  untracked markers validates with key+ledger; clean tree (CI) passes.

## cc-suite invocation (required recording)
- **Kind**: review-plan (HIGH-RISK; broker required, no self-review).
- **Target scope**: `dev-memo/run/queue.md` WI-ENA11 block (compact packet inlined) + A07-MARK-00 §2-§8 +
  A07-GATE-00 §5/§8 + the WI-ENA8 harness + WI-ENA10 guard (read-only).
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqqb99is-7nmkw6`.
- **threadId**: none emitted.
- **rawOutput sha256**: `68ebb1380ac5d45b4eaac698b0f8f75a0043e4b38980c3cb69214369d8234515`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**SCOPE-ASSESSMENT: MARKER-WRITE-LOCAL-ONLY** (Codex confirmed scope stays marker write + validation + local
guard ledger; no EVW5/UI/product/cloud-keychain/JS-shim/harness-semantics change).

Codex confirmed (adversarially): the plan is a sound, bounded A07-MARK-00 implementation under the resolved
decisions; reusing the harness via a tiny Swift CLI is the right architecture (no second source of truth);
the forgery model is coherent (HMAC over canonical payload + recompute-on-validate + fixture/oracle hash checks
+ ledger `runId -> markerPath+provenancePayloadHash+repo/tree` binding makes fabricated/touched/copied/
schema-only/invalid-HMAC fail; anti-circularity preserved by hashing the canonical payload, not the marker
file); storage/guard behavior preserves the WI-ENA10 fail-closed posture (committed markers categorically
rejected; clean tree CI-safe); env-only HMAC custody is acceptable for M0 with fail-closed missing/weak-key
behavior + ephemeral test keys; openssl is an acceptable macOS system tool. No Critical/High blocking.

## Low-risk clarifications (folded into implementation; non-blocking)
1. **Canonical serialization defined exactly.** The canonical payload is a single-line JSON object with a FIXED
   field order (gateId, schemaVersion, harnessImplCommit, repoCommit, repoTreeHash, fixturePath, fixtureSha256,
   oraclePath, oracleSha256, resultStatus, resultClassification, observedPageCount, tolerance, command,
   platform, producedAt, runId), no insignificant whitespace. `provenancePayloadHash = sha256(canonical
   payload)`; `provenance = HMAC-SHA256(env key, canonical payload)`. Validation reconstructs the exact same
   canonical string from the marker's fields and recomputes both.
2. **Minimum HMAC key strength explicit.** The writer + validator require `LAWBAR_A07_MARKER_HMAC_KEY` length
   >= 32 characters; missing/empty/shorter => fail closed (write refuses; validation rejects).
3. **Duplicate-runId ambiguity rejected.** Ledger validation requires EXACTLY ONE matching ledger entry for a
   marker's runId; zero or more-than-one (duplicate/ambiguous) => reject (never accept first-match).
4. **Ledger-file handling.** `ledger.jsonl` (guard-owned state) is skipped during local `--scan` marker
   validation, but is STILL covered by the unconditional committed/tracked/staged rejection (if it is ever
   tracked/staged it is rejected like any evidence-namespace file). It is gitignored (local-only).
5. **openssl availability.** If `openssl` is missing or its invocation fails, the writer refuses to write
   (no unverifiable marker) and the validator fails closed (never silently accepts).

These sharpen the implementation within scope; verdict stands as READY; governance proceeds.

## Disposition
READY → eligible to govern. Proceeding to mark-reviewed + govern (standalone, content-bound to sha
`dc54b680…`). HIGH-RISK + marker authority: after implementation, broker `/cc-suite:audit` + `/cc-suite:verify`
run on the impl scope before commit. User authorization for the marker-write step (local-only markers, env HMAC
custody) was given explicitly; EVW5 hard hooks remain a separate hard-stop — none authorized by ENA11. No marker
or key is committed.

QUEUE_REVIEW_VERDICT=PASS
