# Gate 2 — OCR Pipeline Verification (per-package test sweep + integration)

**Status:** OCR pipeline verification **PASS** — the four production OCR packages test green (0 failures) with the `better-sqlite3` ABI smoke passing and the `AGENTS.md` critical invariants directly asserted. **Gate 2 stays `PARTIAL`** (enriched with the verified marker — a test sweep is not a go-live sign-off, and dependent gates remain unresolved). This is **NOT** a clearance of gates 5/6/9/12/14/15/18/19/20, and is **NOT** a go-live decision. **Date:** 2026-07-07. **Author:** Claude Code (WI-RELEASE-G2-OCR-PIPELINE-VERIFY-00 execution lane). **Governed by:** `dev-memo/run/queue.md` (queue.governed sha256 `b35f06af…`, PR #210 merge `958df51`), review `dev-memo/run/reviews/queue-review-156.md`.

This is a **test-only** verification (runs the existing per-package suites + inspects the surfaces); it changed **no** OCR source/test, renamed **no** error code, and added **no** dependency. Environment of record: macOS 15.6.1 (Darwin 24.6.0) · Node v24.14.0 · `CURRENT_SCHEMA_VERSION = 12`. `dist/` rebuilds performed by the test commands are gitignored (no tracked change). No real user documents — fixtures only.

---

## 1. OCR packages verified
The four **production** packages: `services/ocr-worker`, `services/ocr-persistence`, `services/ocr-ingestion`, `services/ocr-review`. **`services/ocr-worker-bakeoff` is OUT of scope** — its README states it is an ADR-11A.1 engine bakeoff harness that "stays outside the production dependency graph … `services/{ocr-worker, ocr-persistence, ocr-ingestion, ocr-review}` and `docs/contracts` MUST NOT depend on this package". It is an experiment/comparison harness, not part of the v1 pipeline.

## 2. Package test results (`AGENTS.md` §"Test commands")
| Package | Command | tests | pass | fail | skipped |
|---|---|---|---|---|---|
| ocr-persistence | `npm --prefix services/ocr-persistence test` (incl. `abi-smoke` pretest) | 231 | **231** | **0** | 0 |
| ocr-worker | `npm --prefix services/ocr-worker test` | 475 | **472** | **0** | 3 (env-gated, §5) |
| ocr-ingestion | `npm --prefix services/ocr-ingestion test` | 30 | **30** | **0** | 0 |
| ocr-review | `npm --prefix services/ocr-review test` | 38 | **38** | **0** | 0 |
| **Total** | | **774** | **771** | **0** | **3** |

- **`ocr-persistence` `abi-smoke` pretest**: `[abi-smoke] OK better-sqlite3 native binding loads on this Node ABI`.
- All suites exited green (0 failures). Counts are the node `--test` runner's reported summary (`ℹ tests/pass/fail/skipped`).
- Each package's `test` script builds `docs/contracts` (+ `ocr-persistence` for `ocr-worker`/`ocr-review`) as a prerequisite — the shared contract build is a test-command prerequisite, not a separately scored suite.

## 3. Worker / queue / persistence / ingestion / review surfaces + critical invariants
The `AGENTS.md` §"Critical invariants" are **directly asserted** by named test files (all included in the green counts above):
- **Coordinator owns lifecycle** — `services/ocr-worker/tests/coordinator.test.mjs`, `coordinator.retryWiring.test.mjs`, `cli.test.mjs`.
- **Queue dedupe key = `job_id` + canonical submission JSON** — `services/ocr-persistence/tests/sqliteQueue.lineage.test.mjs`, `sqliteQueue.schema.test.mjs`.
- **Stable `OcrQueueError` codes** (`dedupe_conflict`/`unknown_receipt`/`stale_receipt`/`lease_expired`/`invalid_claim`, not collapsed/renamed) — `sqliteAtomicEnqueue.step10k.test.mjs`, `sqliteQueue.lineage.test.mjs`, `services/ocr-worker/tests/coordinator.test.mjs`, `observability.test.mjs`.
- **No FK from queue rows to `ocr_jobs`** — `services/ocr-persistence/tests/sqliteQueue.schema.test.mjs`, `sqlite.hardening.test.mjs`.

## 4. Integration / smoke evidence
The repo does not ship a single dedicated end-to-end (ingestion→worker→persistence→review) harness; the **integration evidence is the per-package suites + the shared contract build they each perform** — the `ocr-worker` / `ocr-review` suites build and consume the `ocr-persistence` + `docs/contracts` packages, exercising the cross-package contract seam. The absence of a dedicated single end-to-end harness is recorded as a residual (§10 R-G2-1), not fabricated.

## 5. Known skips (honestly explained — a skip is NEVER counted as a pass)
The 3 `ocr-worker` skips share one **environment-gated** cause:
- `127.0.0.2` loopback alias **unavailable on this platform** (`127.0.0.2 bind failed: EADDRNOTAVAIL`). These are SSRF / DNS-pinning **transport-matrix** sub-cases that require a *second* loopback IP (`127.0.0.2`) to exercise the `allowedAddresses` pinning across multiple loopback addresses. macOS binds only `127.0.0.1` by default, so those sub-cases skip while **sub-case 1 (`127.0.0.1`) still runs** (`… running sub-case 1 only`). The security behavior is still covered by the runnable `127.0.0.1` sub-cases and by the gate-9 HTTPS DNS-pinning sign-off (`docs/release/wi-03-security-signoff.md`). **Acceptable for this test-only sweep** (deterministic, offline; the skip is a platform capability limit, not a masked regression) — v1 release acceptance remains governed by the unresolved readiness gates, not by this sweep. No other skips.

## 6. Deterministic PASS / FAIL conclusion
**PASS — per-package sweep + cross-package contract integration.** All four production-package suites exited green (0 failures), the `abi-smoke` pretest passed, the critical invariants are directly asserted by passing test files, and every skip is an honestly-explained platform-capability skip that does not mask a regression. This is a per-package + cross-package-contract-seam PASS (§4), **not** a full end-to-end pipeline proof (no dedicated e2e harness exists — R-G2-1). FAIL would have been: any suite red, the ABI smoke failing, a critical invariant broken, or a skip masking a real regression — none occurred.

## 7. Mode
**Test-only** — ran the existing per-package suites + inspected the surfaces. Wrote NO OCR product code, added NO dependency, edited NO test. `dist/` rebuilds performed by the `test` scripts are gitignored (no tracked change).

## 8. How the result feeds gate 2 without clearing unrelated gates
A PASS supplies the "per-package test sweep + integration confirmation" evidence. Per the governed WI, **gate 2 MUST remain `PARTIAL`** — the row is enriched with a `[Δ] per-package OCR test sweep + integration PASS` marker (roll-up bucket unchanged); a `PARTIAL → CLEARED` move is NOT made here (it belongs to a separate holistic readiness-refresh WI). This verification:
- does **NOT** re-open, alter, or newly clear any dependent gate: **gate 5** is already CLEARED (all-package-test — the prior ocr-worker SIGINT-flake resolution; cited here as supporting context, not re-cleared/altered), **gate 9** (fetcher SSRF/TLS/DNS-pinning sign-off; supporting context for the transport skips) stays as-is, and **gates 12/14/15/18/19/20** stay uncleared;
- defers **gate 6** (full-project audit) to later;
- keeps **go-live independence**: an OCR test sweep is not a go-live sign-off. The final GO/NO-GO and the STOP-AND-ASK hard-stops (gate 4 signing/distribution, gate 11 律师法, gate 17 license/business, gate 21 final sign-off) remain the user's.

## 9. Environment
macOS 15.6.1 (Darwin 24.6.0) · Node v24.14.0 · `better-sqlite3` (ABI smoke OK) · `CURRENT_SCHEMA_VERSION = 12` · date 2026-07-07. Fixtures only; no real user documents.

## 10. Residual risks / follow-up (separate future WIs — not run here)
- **R-G2-1** — no dedicated single end-to-end (ingestion→worker→persistence→review) integration harness exists; the per-package suites + shared contract build are the integration evidence. A dedicated e2e harness could be a follow-up (would strengthen gate 2 toward CLEARED at a readiness refresh).
- **R-G2-2** — the `127.0.0.2` loopback-alias transport sub-cases are platform-gated (skipped on macOS default); running them requires configuring the second loopback alias. Related to gate 9 (DNS-pinning), which is separately signed off; not re-run here.
- **R-G2-3** — the real-PaddleOCR engine path is model-gated / not exercised offline in this sweep; a runtime-with-models OCR-accuracy exercise (the `ocr-worker-bakeoff` domain, out of the v1 production graph) is a separate post-v1 concern.
- No product/source follow-up WI is required; these are documentary notes.
