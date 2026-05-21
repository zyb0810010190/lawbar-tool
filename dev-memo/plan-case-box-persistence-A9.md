# CASE-BOX-PERSISTENCE Phase A9 — Replay-Safe `*Once` Variants (bounded plan)

**Status**: round-2 plan after r1 review. Round-1 verdict NEEDS REVISION (4 Med + Lows); revisions applied.

## Review history

- 2026-05-21 round 1 — Path 1 full packet, first try. Job `review-plan-mpg3q9su-etlyjv`. Verdict **NEEDS REVISION**. Revisions applied:
  - **M Dim 1 #1 + M Dim 5 #2 (`created_at` exclusion is wrong)**. **FIX**: `CaseBoxFact.created_at` is caller-supplied (not store-assigned). Projection now INCLUDES all caller-supplied schema fields including `created_at`. The only fields excluded would be store-assigned ones; `CaseBoxFact` has none. §1.1 method rewritten.
  - **M Dim 2 #1 (missing boundary tests)**. **FIX**: added §6.A9.11 (same id, different `created_at` → `duplicate_id`), §6.A9.12 (same id, different `actor_user_id` → `duplicate_id`).
  - **M Dim 3 #2 (projection drift load-bearing for Phase B)**. **FIX**: `factCanonicalProjection` is EXPORTED from `inMemoryFact.ts`. Phase B's SQLite implementation must reuse the same exported helper. Conformance pins inclusion of every caller-supplied field.
  - **M Dim 4 #2 (id-based replay precondition implicit)**. **FIX**: §1.1 documents the precondition explicitly: `appendFactOnce` is replay-safe for redelivery of the **same request id**, not semantic dedupe of identical content under different ids. Callers MUST stamp the same `id` on each redelivery attempt.
  - **L Dim 2 #3 (OCR-link Once equivalence)**. **FIX**: §5 strengthens the note — `upsertOcrLink` IS the named replay-safe writer for OCR links; no alias unless future ABI review requires naming symmetry.
  - **L Dim 1 #2 + #3**: confirmation only, no change.
  - **L Dim 4 #1 (`duplicate_id` vs `replay_conflict`)**: defer `replay_conflict` taxonomy decision to ABI remediation WI; A9 reuses `duplicate_id`.
  - **L Dim 5 #1 (terminal point)**: confirmed sound.

**Status**: ready for round-2 review.
**Date**: 2026-05-21.
**Parent plan**: `dev-memo/plan-case-box-persistence-00.md` §6.2 + §10.2 row A9 ("Medium risk").
**Built on**: A8 (commit `cb4750b`).

A9 closes the in-memory persistence A-series with replay-safe variants for at-least-once redelivery paths.

---

## Review packet (compact)

### Active plan summary

Phase A9 adds 1 new public method — `appendFactOnce(input)` — implementing the replay-safe Once pattern from OCR's `appendOcrStatusOnce` (services/ocr-persistence/src/inMemoryRepo.ts:108-133). Per parent plan §6.2 line 130, only fact-candidate appends and OCR-link snapshots are at-least-once redelivery targets in v1. OCR-link upserts ALREADY provide Once semantics natively (A7 commit c31dbaa — byte-identical replay is a no-op via canonical-JSON deep equality). Docket entries and confirmations are explicitly OUT of scope per parent §6.2 line 132 (lawyer-initiated, not queue-driven). Other entity appends (classification, privilege, evidence) are NOT in the parent's Once list — A9 declines to ship them. Public surface 42 → 43. Pre-A9 inMemoryRepo.ts is 623 pure LOC; A9 adds ~5 LOC delegate + ~30 LOC helper in `inMemoryFact.ts`. Projected post-A9 ~628 LOC (under 700).

### Exact target files

- `services/case-box-persistence/src/inMemoryFact.ts` — modified: add `applyAppendFactOnce(state, repo, deps, input)` helper that canonicalizes payload, checks replay, falls through to strict `applyAppendFact` on miss. Also add canonical projection helper `factCanonicalProjection(input | row)`.
- `services/case-box-persistence/src/inMemoryRepo.ts` — modified: add `appendFactOnce` thin delegate.
- `services/case-box-persistence/src/types.ts` — modified: add `appendFactOnce` interface method.
- `services/case-box-persistence/src/index.ts` — re-export touched only if a new type ships (none expected).
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` — add ~10 conformance cases.
- `services/case-box-persistence/tests/invariants.test.mjs` — §6.2.7 allowlist bumps to 43.

### Exact acceptance criteria

1. `npm --prefix services/case-box-persistence test` exits 0 (249 from A1-A8 + ~10 A9 ≈ 259 total).
2. `npm --prefix docs/contracts/case-box-contract test` still 322/322.
3. `npm --prefix docs/contracts test` (OCR) still 102/102.
4. loc-guardian: 0 over fail. `inMemoryRepo.ts` < 700 pure LOC.
5. Public surface = 43; §6.2.7 allowlist matches.
6. No new `CaseBoxPersistenceError` code; A9 reuses the 10 documented codes.
7. cc-suite audit + verify via Path 1 (verify Path 2 fallback acceptable per CCSUITE-02).
8. Replay semantics: byte-canonical equal payload → return stored row, no audit event emitted, audit chain head/count unchanged.
9. Conflict semantics: same canonical key (id) with different fields → strict path's `duplicate_id` is sufficient (don't invent a new error code).

### Exact out-of-scope list

- All standard exclusions: no SQLite / native module / API / UI / sync / cloud / auth / LLM / OCR-package import / external network / schema change / contract edit / dependency change / ADR-or-release edit / .claude/** edit / push.
- No `appendDocketEntryOnce` / `confirmDocketEntryOnce` (parent plan §6.2 line 132 — lawyer-initiated, not queue-driven, explicitly excluded from v1).
- No `appendConfidentialityClassificationOnce` / `appendPrivilegeMarkerOnce` / `appendEvidenceItemOnce` (not in parent §6.2 scope).
- No `upsertOcrLinkOnce` alias — `upsertOcrLink` IS the named replay-safe writer for OCR links per A7 (byte-identical replay → no-op, no audit emitted). No alias unless future ABI review requires naming symmetry. The plan documents this as the intentional public-surface choice for OCR-link Once equivalence.
- No `transitionFactOnce` — transitions are not at-least-once redelivery targets; the parent's Once list covers appends only.
- No idempotency-key derivation from the contract's `idempotency_key` field if such exists — A9 uses content-based canonical projection per parent §6.2 step 4.

### Essential ADR references

- `dev-memo/plan-case-box-persistence-00.md` §6.2 (Replay-safe writers / idempotency keys) + §10.2 row A9.
- `services/ocr-persistence/src/inMemoryRepo.ts:108-133` (`appendOcrStatusOnce`) — reference pattern.
- `services/ocr-persistence/src/replaySafe.ts` (`deepEquals` + canonical projection).

### Review questions (targeted)

1. **Canonical projection scope**: should the projection exclude only store-assigned timestamps (`created_at` if persistence-allocated) and store-assigned IDs, or also normalize array ordering / null vs missing optionals? Per parent §6.2 step 4: "MUST exclude store-assigned fields (`persisted_at`, `id` if persistence-allocated) so equality is content-based."
2. **Idempotency key**: do we use the fact's `id` as the primary dedupe key, or compute a hash of the canonical payload? Decision proposed: use `id` as the primary lookup (callers supply the id; same id + same payload = replay; same id + different payload = strict path's `duplicate_id` is correct).
3. **Audit emission on replay**: confirm no audit event emitted on exact replay. Pattern mirrors `appendOcrStatusOnce` which returns stored event verbatim without re-appending.
4. **Behavior when fact already advanced past candidate**: if a fact was appended as candidate (audit `FACT_PROPOSED`), then transitioned to accepted, and `appendFactOnce` is called again with the original candidate payload — does that replay return the now-accepted row, or fail? Pattern decision: return the stored row regardless of current status (the canonical-projection equality is against the ORIGINAL candidate row's stored content; since transition mutates the row in-place, the projection will no longer match). Result: in practice, replay-after-transition returns the conflict path; callers should not replay after transition. Document.
5. **OCR-link Once equivalence**: A7's upsertOcrLink already implements Once semantics. A9 documents this but adds no separate `upsertOcrLinkOnce` alias. Is that the right call, or should a thin alias ship for API parity with OCR-persistence?

---

## 1. Scope

### 1.1 Functional scope — 1 new public method (42 → 43)

**`appendFactOnce(input: unknown): Promise<CaseBoxFact>`**

Replay-safe variant of `appendFact`. **Precondition (round-1 M Dim 4 #2 fix)**: callers MUST stamp the **same `id`** on each redelivery attempt of the same logical request. Once is for at-least-once redelivery of the same request id, NOT for semantic dedupe of identical content under different ids.

Behavior:

1. Parse `input.id` (must be a string per the fact schema; raw input is validated by the strict path on fall-through).
2. Look up `state.fact.factById.get(input.id)`:
   - If present: compute `factCanonicalProjection(stored)` and `factCanonicalProjection(input)`. If canonical-JSON equal, return `structuredClone(stored)` — REPLAY, no audit event emitted, audit chain head/count unchanged.
   - If present and projection differs: fall through to strict `applyAppendFact` — which will throw `duplicate_id` per A4 behavior. This is the intended outcome: same id with different fields is a programming bug or a divergent retry; reuse the strict error.
   - If absent: fall through to strict `applyAppendFact` — normal append + audit.
3. Atomic: the lookup + commit is a single synchronous step.

**Canonical projection** (`factCanonicalProjection`, EXPORTED for Phase B parity per round-1 M Dim 3 #2 fix):
- Includes **ALL** caller-supplied schema fields. `CaseBoxFact` has no store-assigned fields, so the projection includes the full row (id, tenant_id, matter_id, actor_user_id, statement, status, source_type, source_document_id, source_page_number, source_excerpt, source_ocr_job_id, source_rule_citation, extractor_name, extractor_version, extraction_confidence, supersedes_fact_id, accepted_at, reviewer_actor_user_id, reviewed_at, created_at, and any other schema-defined field).
- Uses the `canonicalJson` pattern (sorted-keys recursive) — reused from `inMemoryOcrLink.ts:81-95`. To prevent helper drift between modules, A9 extracts `canonicalJson` to a shared `replaySafe.ts` mirror of `services/ocr-persistence/src/replaySafe.ts` if it's used a second time, OR leaves it inlined in `inMemoryFact.ts` if not. **Decision**: inline for now (one consumer); if Phase B SQLite reuses, extract then.
- Does NOT mutate the input.

### 1.2 LOC budget

Pre-A9: inMemoryRepo.ts 623. A9 adds:
- `inMemoryFact.ts`: ~35 LOC (`applyAppendFactOnce` + `factCanonicalProjection` + canonical JSON if not already importable).
- `inMemoryRepo.ts`: +5 LOC (one delegate).

Projected post-A9: ~628 LOC. Under 700 by 72 LOC.

### 1.3 Internal state additions

None. A9 reuses existing `state.fact.factById` index.

---

## 2. Files expected to be added or modified

| Path | Action | Substance |
|---|---|---|
| `services/case-box-persistence/src/inMemoryFact.ts` | modified | Add `applyAppendFactOnce(state, repo, deps, input): CaseBoxFact` + `factCanonicalProjection(fact-like): string`. |
| `services/case-box-persistence/src/inMemoryRepo.ts` | modified | Add `appendFactOnce(input)` thin delegate (~5 LOC). |
| `services/case-box-persistence/src/types.ts` | modified | Add `appendFactOnce` to interface. |
| `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` | modified | Add ~10 conformance cases. |
| `services/case-box-persistence/tests/invariants.test.mjs` | modified | §6.2.7 allowlist bumps to 43. |

---

## 3. Files expected to remain untouched

- `docs/contracts/case-box-contract/**`.
- All other `services/**` packages.
- All ADRs / release docs.
- `.claude/**`.
- Three pre-existing user-deferred dev-memo drafts.
- `dev-memo/deferred-audit-findings.md` — no expected closures (no A9-targeted rows).

---

## 4. Invariants carried forward

- `tenant_id` cross-entity consistency on the fall-through strict path (replay path returns stored row unchanged, so tenancy was already enforced at original insert).
- Atomic write discipline.
- Audit emission via `buildCaseBoxAuditEvent` only — replay path emits ZERO audit events.
- Per-matter monotonic `sequence` — unchanged by replay (no new audit).
- `local-user` sentinel valid.

---

## 5. Out of scope

- All standard exclusions plus:
- No multi-field idempotency key (fact's `id` is sufficient).
- No `Once` variants for entities outside parent §6.2 scope.
- No retry mechanics (Once is the dedupe primitive; queue/retry layers live elsewhere).

---

## 6. Tests planned

~10 new conformance + 1 invariants.

### 6.1 Conformance matrix additions

| § | Case | Asserts |
|---|---|---|
| 6.A9.1 | `appendFactOnce` new fact (cold path) | row inserted; audit emitted (FACT_PROPOSED) |
| 6.A9.2 | `appendFactOnce` exact replay | row returned; NO new audit; head/count unchanged |
| 6.A9.3 | `appendFactOnce` same id, different fields | `duplicate_id` (strict path) |
| 6.A9.4 | `appendFactOnce` returns deep clone (not internal ref) | mutating return does not affect store |
| 6.A9.5 | `appendFactOnce` schema-invalid payload | `invalid_payload` (strict path) |
| 6.A9.6 | `appendFactOnce` non-candidate status rejected | `invalid_argument` (mirrors appendFact's pre-guard) |
| 6.A9.7 | `appendFactOnce` cross-tenant | `tenant_mismatch` (matter check via strict path) |
| 6.A9.8 | `appendFactOnce` after fact transitioned to accepted | replay returns conflict (canonical projection differs from current row) |
| 6.A9.9 | `appendFactOnce` chain head unchanged after replay | exact head/count match before vs after replay |
| 6.A9.10 | `appendFactOnce` 5x replay produces 1 audit row | only first call emits an audit; subsequent 4 return same row, no audit |
| 6.A9.11 | `appendFactOnce` same id, different `created_at` (round-1 M Dim 2 #1) | `duplicate_id` (projection diverges) |
| 6.A9.12 | `appendFactOnce` same id, different `actor_user_id` (round-1 M Dim 2 #1) | `duplicate_id` (projection diverges; protects audit attribution) |

### 6.2 Invariants test additions

- **§6.2.7 prototype allowlist** (modified): expects 43 entries.

---

## 7. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Canonical projection includes a store-assigned field, causing replay to falsely conflict | Low | Medium | `CaseBoxFact` has NO store-assigned fields, so the projection includes all caller-supplied schema fields including `created_at`. §6.A9.2 + §6.A9.10 pin exact replay; §6.A9.11 + §6.A9.12 pin field inclusion (different `created_at` / `actor_user_id` → conflict). |
| R2 | Replay emits a duplicate audit event | Low | High (chain corruption) | Replay path returns BEFORE the audit-event builder is called. §6.A9.9 + §6.A9.10 pin head/count unchanged across replays. |
| R3 | Replay-after-transition silently returns stored (accepted) row | Low | Medium | Documented behavior in §1.1 method 5: projection of accepted row !== projection of original candidate (status differs), so transition-then-replay falls into the duplicate_id conflict path. §6.A9.8 pins. |
| R4 | LOC overshoot | Low | Low | A9 adds ~35 LOC total; 700 ceiling has 77 LOC margin pre-A9. |
| R5 | Canonical projection drift between in-memory and future SQLite impl | Medium | Medium | Document the projection algorithm in inMemoryFact.ts. SQLite (Phase B) must reuse the same algorithm; conformance §6.A9.* will catch drift. |

---

## 8. Acceptance criteria

| # | Criterion | Verified by |
|---|---|---|
| 8.1 | All package tests pass | `npm --prefix services/case-box-persistence test` |
| 8.2 | Sibling contracts pass | spot test runs |
| 8.3 | loc-guardian: 0 over fail; inMemoryRepo.ts < 700 | `/loc-guardian:scan` |
| 8.4 | Public surface = 43 | invariants §6.2.7 |
| 8.5 | No new error codes | conformance |
| 8.6 | Exact replay produces 0 new audit events | §6.A9.9 + §6.A9.10 |
| 8.7 | Replay-after-transition correctly conflicts | §6.A9.8 |
| 8.8 | cc-suite review-plan + audit + verify retrievable (or Path 2 fallback recorded) | 11 fields recorded |
| 8.9 | Explicit-stage commit; no `git add .`; no push | scoped diff |

---

## 9. Out-of-scope clarifications for the reviewer

Do NOT flag:
- Missing `appendDocketEntryOnce` / `confirmDocketEntryOnce` — parent plan §6.2 line 132 explicitly excludes them from v1.
- Missing `appendXOnce` for classification/privilege/evidence — not in parent §6.2 scope.
- Missing `upsertOcrLinkOnce` alias — A7's upsertOcrLink already provides Once semantics; documented in §5.
- No new error code for "same id, different payload" — reusing `duplicate_id` is intentional; matches OCR's pattern.

Reviewer SHOULD flag:
- Any path that emits an audit event on replay.
- Any path that mutates state on replay.
- Any canonical projection that includes a store-assigned field.
- LOC drift past 700.

---

## 10. cc-suite invocation plan

| Stage | Kind | Path |
|---|---|---|
| Plan review (this file) | `review-plan` | Path 1 full packet → compact on TIMEOUT → Path 2 |
| Implementation audit | `audit` | Path 1 |
| Post-fix verify | `verify` | Path 1 with explicit audit artifact → Path 2 fallback per CCSUITE-02 if Path 1 ETIMEDOUT (mirrors A8's verify-R2 fallback) |

---

## 11. References

- `dev-memo/plan-case-box-persistence-00.md` §6.2 + §10.2 row A9.
- `dev-memo/plan-case-box-persistence-A1.md` … `A8.md`.
- `dev-memo/deferred-audit-findings.md` — backlog.
- `services/ocr-persistence/src/inMemoryRepo.ts:108-133` — `appendOcrStatusOnce` reference pattern.
- `services/ocr-persistence/src/replaySafe.ts` — `deepEquals` reference.
- `services/case-box-persistence/src/inMemoryOcrLink.ts:81-95` — canonical-JSON helper already in case-box-persistence (extracted in A7).
- `.claude/rules/cc-suite.md` — broker policy + CCSUITE-02 retry/fallback.
