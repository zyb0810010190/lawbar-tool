# Queue review — WI-SEC-CASEBOX-TENANT-SCOPING-DEFENSE-00 (authoring/governance)

Lane: Gate-10 follow-up security fix WI **authoring/governance** (Type: IMPL, security-boundary HIGH-RISK). Governance-authoring only — this lane produces the governed queue WI so a FUTURE lane implements the tenant-scoping fix; it implements NOTHING, edits no persistence/test/report source, and makes NO go-live decision.
Date: 2026-07-04. Branch: `sec-casebox-tenant-scoping-defense-governance` (from synced `main` @ `158bde3`). Batch: 1/3 since marker `3f748bf` — no batch closeout this lane.

## What this is
Authorizes (per explicit user authorization 2026-07-04) a FUTURE execution lane to close the two Medium defense-in-depth findings + the Low the gate-10 security-boundary audit escalated (`docs/release/casebox-persistence-security-audit-00.md`, C0 H0 M2 L1, gate 10 NOT CLEARED):
- **M-1** — add a row-level `tenant_id` predicate (binding `query.tenant_id`) to the 8 child-entity SQLite list/history reads (`listEvidenceItemsSqlite`, `listDocketEntriesSqlite`, `listAuditEventsSqlite`, `getEffectiveClassificationSqlite`, `listConfidentialityClassificationsSqlite`, `getPrivilegeStatusSqlite`, `listPrivilegeMarkersSqlite`, `listOcrLinksSqlite`), keeping the `requireMatterTenant` preflight. Real caller-tenant enforcement (the reads receive `query.tenant_id`).
- **M-2** — ATOMIC-CONSISTENCY hardening for the COMPLETE child-entity id-addressed mutation set (`updateFactRow`, `updateDeadlineRow`, `updateDocketEntryRow`, `updateDocketEntryEditRow`, `updateEvidenceItemRow`, `updateLinkMarkerRow`, `updatePrivilegeMarkerRow`): scope each `UPDATE` to `WHERE id = ? AND tenant_id = ? AND matter_id = ?` bound to the RESOLVED ROW's own scope + assert `RunResult.changes === 1` before the audit-event write. NOT caller-tenant authorization (these APIs take an id + opts with no caller tenant — `types.ts:163`); the by-id loaders stay unchanged (no forbidden API-signature change). `updateMatterRow` excluded (tenant-owning parent, PK-scoped, handler tenant-checked).
- **L-1** — extend `tenant-filter-lists.test.mjs` (+ affected hardening/impl-parity/conformance) with regressions (red before, green after).
Predicate-only: NO schema/DDL (the `tenant_id` lifted columns exist; `CURRENT_SCHEMA_VERSION` stays 12), NO contract/dependency/renderer/error-code change; stable `tenant_mismatch`/`unknown_matter` surface + write-time `child.tenant==matter.tenant` invariant preserved. Full security-WI loop (plan-review → tests-first → implement → audit → verify → sign-off). Clearing gate 10 still does NOT imply go-live.

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
Path 1 runner foreground, resolved runner path `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`, retrievable YES (all envelopes `status:"completed"`), no failure class, no fallback. Governance-authoring lane → review-plan only (the security /cc-suite:audit + /verify belong to the future execution lane).

### review-plan (gpt-5.5/medium/read-only; on the fix WI)
- Attempt 1: `review-plan-mr6g9jct-y2i8pp` · **NEEDS-FIX** (1 High + 2 Medium) · sha256 `d6b48ac80f5b0bc7c1ea72f60b372f1a2cf90d293b7f12194f46b03915976f0a`.
  - **H** M-2 docket scope omitted `editDocketEntry`/`updateDocketEntryEditRow` → FIXED (added).
  - **M** cited precedent wrong (`deadlineRepoQueries.ts:157` is a scoped SELECT, not an UPDATE) → FIXED (cite `linkStatusResolverQueries.ts:157-158`, the real scoped UPDATE).
  - **M** M-2 acceptance example-based → FIXED (enumerated the mutation helpers).
- Attempt 2: `review-plan-mr6gdjdb-kuo4jg` · **NEEDS-FIX** (2 High + 1 Medium) · sha256 `e398cb40cc49c7c2d9dcfbc348222bfbc4a2aba2f4fe71577bbe2173b83666b9`.
  - **H** loaders can't take a caller-tenant predicate (APIs supply no caller tenant — `types.ts:163`) → FIXED (reframed to UPDATE-level resolved-row scoping; loaders stay by-id, no API change).
  - **H** omitted same-pattern `transitionEvidenceItem` → FIXED (added).
  - **M** push baked as automatic → FIXED (push is never automatic; requires explicit per-invocation authorization).
- Attempt 3: `review-plan-mr6gj6pt-qp7k6w` · **NEEDS-FIX** (1 Critical + 1 High + 1 Medium) · sha256 `d1ca2a1df4d6b61a449f070a96f22ce901bd2b0a65d8c3200226505d5c824816`.
  - **C** row-derived UPDATE scoping is atomic-consistency, NOT caller-rejection; and a zero-row UPDATE needs a `changes === 1` guard before the audit event → FIXED (reworded M-2 as atomic-consistency + mandated the `changes === 1` guard; M-1 alone is caller-tenant enforcement).
  - **H** scope inconsistency — if evidence is in by "same pattern," `transitionPrivilegeMarker` is too → FIXED (adopted a PRINCIPLED rule = the COMPLETE child-entity id-addressed mutation-UPDATE set; added privilege; excluded `updateMatterRow` with a recorded reason).
  - **M** precedent labeling → FIXED (linkStatusResolverQueries is the ONLY scoped-mutation precedent; the others are scoped SELECTs).
- Attempt 4 (re-review after fixes): `review-plan-mr6gpcfp-614e7z` · **READY** (no Critical/High/Medium; 2 non-blocking Lows: M-2 broader than the audit's explicit bullets but declared+mechanically justified; a sandbox note that `check-queue.sh` can't create temp files under read-only sandbox — N/A, check-queue was run outside the sandbox and PASSED) · sha256 `422207cc14acd2209e9f8678f0c5f165dd0b907f454b16089a7e6c1bc04aecb0`.

## Verdict: READY (governed fix WI; predicate-only; escalation→fix, go-live-independent)

QUEUE_REVIEW_VERDICT=PASS

## Gates (this authoring lane)
- `scripts/workflow/check-queue.sh` → PASS.
- `scripts/workflow/check-contract-integrity.sh` → PASS.
- `CURRENT_SCHEMA_VERSION` unchanged (12); no app/native/schema/contract/persistence/test/dependency code touched — this lane commits ONLY the queue governance + this review artifact. No fix implementation, no go-live decision.

## Deferred findings
None. All review findings (1 Critical + 4 High + 4 Medium across the 4 attempts) folded before governance; final re-review READY. The FUTURE execution lane owes the security /cc-suite:audit (+ /verify) with 11-field recording; it implements the fix + tests + the gate-10 sign-off append. Clearing gate 10 does NOT imply go-live; the final verdict + the three STOP-AND-ASK hard-stops remain the user's.
