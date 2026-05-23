# Deferred Audit Findings — Backlog

**Status**: append-only-ish backlog of cc-suite audit findings that were not fixed in their originating WI. Started 2026-05-21.

**Purpose**: provide a durable, scannable location for every Low (and any escalated Medium-or-higher) the assistant chose not to fix inside its originating WI. The commit-message recording per `.claude/rules/cc-suite.md` §"Audit remediation policy" is per-WI; this file is the project-wide rollup so future WIs can find prior deferrals without scraping `git log`.

**Update rules**:

- **Append on every WI close** when the audit deferred any finding. Group entries by WI / commit.
- **Update `status`** (open / closed / superseded) when a later WI addresses an open entry. Do NOT delete rows — flip the status and add a "resolved-in" reference. The historical evidence stays visible.
- **Group several findings into one row** only when they share severity + deferral category + target backlog label. Otherwise keep one row per finding for greppability.
- **Security-adjacent Lows** (SSRF / TLS / DNS / auth / sandbox per `.claude/rules/security-boundary.md`) MUST NOT appear here as `status: open` — `.claude/skills/security-wi-loop/SKILL.md` §6 requires escalation, not deferral, for those.

**Column legend**:

- `WI` — work-item label and resolution commit short hash.
- `Audit job` — `/cc-suite:status`-retrievable Path-1 job id from the originating WI.
- `Verify job` — `/cc-suite:status`-retrievable verify-pass job id that recorded the deferral.
- `Finding ID` — the auditor's identifier (e.g. `F2.1`, `Dim 3 #1`).
- `Severity` — Critical / High / Medium / Low. Anything above Low SHOULD appear as `status: escalated`, NOT `status: open` per `.claude/rules/cc-suite.md` §"Audit remediation policy" item 1.
- `Reason for deferral` — one sentence citing which clause of §"Resolution rules" item 2 applies.
- `Target` — future WI label, backlog tag, or `cleanup-accepted (no follow-up planned)`.
- `Safe-to-proceed?` — `YES` / `NO`. `NO` means this row should already be an escalation, not a deferral.
- `Status` — `open` / `closed` / `superseded`. `closed` means a later WI addressed it (cite the resolution commit in `Notes`). `superseded` means the underlying audit pattern stopped applying (e.g. the affected code was deleted).
- `Notes` — free-form context + resolution-commit reference once closed.

---

## Phase B7 — SQLite docket entries + deadline materialization (commit `<pending B7 impl commit hash>`)

| Audit job | Verify job |
|---|---|
| `audit-mphm1ece-aki58h` (mini; Path 1 native --background) | not invoked (0 C/H, 1 M + 4 L; M + 3 Lows fixed in-WI, 1 Low deferred) |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| D4#1 (B7) | Low | Cleanup-only — `sqlite.hardening.test.mjs` at 882 LOC over 700 warn. Per B7 plan §6 risk #6: B8 split if crossed. | WI-B8-pre-impl split into per-entity hardening test files | YES | open | Hardening tests grew +183 LOC for the 8 B7 tests (incl. mandatory crash-injection). Split must happen before B8 adds more hardening. |
| D4#2 (B7) | Low | Cleanup-only — `SqliteCaseBoxPersistence.ts` at 588 LOC (was 572 post-B6; +16 LOC for 8 thin call-throughs). Same posture as B5/B6 D4#1; reviewer accepted under 800 fail. | Re-evaluate at B8/B9 if class grows materially | YES | open | `#runImmediateWrite` pattern keeps growth flat per added method. |

---

## Phase B6 — SQLite facts (commit `667bb9c`)

| Audit job | Verify job |
|---|---|
| `audit-mph4cun6-aav6q2` (mini; Path 1 native --background) | not invoked (no C/H/M to verify; 0 C/H/M, 4 Lows; 2 Lows fixed in-WI, 2 Lows deferred at the time; D4#1 now CLOSED by B7) |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| D4#1 (B6) | Low | `impl-parity.test.mjs` at 773 LOC over 700 warn. Per B6 plan §"Review packet" Q7 + Risk #6: B7 MANDATORY split when crossed. | WI-B7-pre-impl split into `impl-parity-{matter,document,audit,classification,privilege,facts,docket,stub-frontier}.test.mjs` | YES | closed | Resolved in B7 (commit `<pending B7 impl commit hash>`): 773-LOC monolith split into 7 per-entity test files + 1 shared common module; each well under warn threshold. |
| D4#2 (B6) | Low | `SqliteCaseBoxPersistence.ts` over warn (572 LOC; B6 added +9 LOC for 4 thin call-throughs). Same posture as B5 D4#1. | Re-evaluate at B7/B8 if class grows materially | YES | open | B7 adds +16 LOC (588 LOC); see B7 D4#2 entry above. Same band. |

---

## Phase B5 — SQLite privilege markers (commit `<pending B5 impl commit hash>`)

| Audit job | Verify job |
|---|---|
| `audit-mpgzx0ka-r4jne5` | not invoked (no C/H/M to verify; 0 C/H/M, 5 Lows; 1 Low fixed in-WI, 4 Lows deferred) |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| D1#2 | Low | Cleanup-only — `getPrivilegeStatusSqlite` loads ALL matter markers then lets `effectivePrivilegeStatus` filter; could narrow at SQL level via `WHERE matter_id, target_type, target_id`. Acceptable at v1 lawyer-scale. | Future perf WI when marker volume grows | YES | open | Reviewer accepted as Phase-B debt. |
| D2#1 | Low | Cleanup-only — `buildShadowAppendState` and `buildShadowTransitionState` in `privilegeRepoQueries.ts` duplicate the global id+markerIndex SELECT loop. Two callers today; extract if a third privilege helper appears. | Future privilege-side extraction OR B-future-WI | YES | open | Reviewer accepted: "extract `loadPrivilegeIdIndex(db, state)` if a third privilege helper appears." |
| D4#1 | Low | Cleanup-only — `SqliteCaseBoxPersistence.ts` at 563 LOC over the 500-LOC LOC-01 extraction trigger (under 800 fail). B4 D4#1 was naturally fixed structurally via `#runImmediateWrite` + `#writeAudit` + `validateDocumentTarget` extractions; residual LOC is mostly imports + 33 `not_implemented` stubs. Reviewer: "Do not introduce a stub mixin yet; it would add indirection without reducing real complexity." | Re-evaluate at B6/B7 if growth continues | YES | open | Treated as accepted-as-known-divergence under 800 fail floor. |
| D4#2 | Low | Cleanup-only — global privilege id scans (and the analogous global classification id scans from B4) will not scale as a long-term pattern. v1 acceptable. | Future targeted-existence-lookup WI once multiple SQLite entity helpers repeat this pattern | YES | open | Reviewer: "Backlog a targeted existence/indexed lookup refactor once multiple SQLite entity helpers repeat this pattern." |

---

## Phase B4 — SQLite confidentiality classification (commit `bb285ca`)

| Audit job | Verify job |
|---|---|
| `audit-mpgyzp9t-iftt4p` | not invoked (no C/H/M to verify; 0 C/H/M, 4 Lows; 2 Lows fixed in-WI, 2 Lows deferred at the time; both now CLOSED by B5) |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| D4#1 | Low | LOC trigger 524 > 500 in SqliteCaseBoxPersistence.ts; transaction-wrapper extraction. | WI-B5-impl OR dedicated extraction WI before B5 | YES | closed | Resolved in B5 (commit `<pending B5 impl commit hash>`) — extracted `#runImmediateWrite` + `#writeAudit` private helpers per NIGHT-RUN-SQLITE-B5-IMPL lane "fix cleanly when naturally touched" instruction. Class still 563 LOC (mostly stubs + imports); structural duplication eliminated. |
| D2#1 | Low | `getEffectiveClassificationSqlite` re-implements in-memory `getEffectiveClassificationHelper` validation (matter / tenant / target_type / document resolution). | WI-B5-impl OR future docs-only extraction WI | YES | closed | Resolved in B5 (commit `<pending B5 impl commit hash>`) — extracted shared `validateDocumentTarget(db, query)` helper in `documentRepoQueries.ts`; both B4 `getEffectiveClassificationSqlite` and B5 `getPrivilegeStatusSqlite` now call it. |

---

## Phase A6 — evidence items (commit `<pending A6 commit hash>`)

| Audit job | Verify job |
|---|---|
| `audit-mpfm9yx3-u37dx3` | `verify-mpfmi1u1-m2rzhh` |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| F5.1 | Low | Cleanup-only — defensive cross-tenant supersession branch is unreachable through the public API (matter-tenant binding enforces; same-matter cross-tenant evidence would require direct state tampering). Plan's §6.A6.16b test was never added; helper's defensive code retained for forward compatibility. Audit accepted the deferral. | cleanup-accepted (no follow-up planned; revisit only if a future WI introduces a path that allows same-matter cross-tenant rows) | YES | open | Defense-in-depth witness. No test fixture available without a tamper seam. |

---

## Phase A5 — docket entries + deadline materialization (commit `<pending A5 commit hash>`)

| Audit job | Verify job |
|---|---|
| `audit-mpfktk5e-pac8by` | `verify-mpfl8uz3-ajvcvj` |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| _no deferred findings_ | — | All findings (1 Low stale-imports) fixed inline rather than deferred. | n/a | YES | n/a | Verify verdict ALL CLOSED. |

Backlog relabel (NOT a closure): A2 F4.3's `Target` field updated from "future A5-fact-targets WI" to "future fact-target broadening WI" — A5 is dockets/deadlines, not fact-targets; the original label was a misnomer.

---

## Phase A4 — facts (commit `<pending A4 commit hash>`)

| Audit job | Verify job |
|---|---|
| `audit-mpfi97ns-kf42ma` | `verify-mpfijdi4-6cdzoi` |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| _no deferred findings_ | — | All Medium/High closed; no Lows deferred (one Low — `PrepareTransitionResult.prior` dead surface — was fixed inline rather than deferred). | n/a | YES | n/a | Verify verdict ALL CLOSED. The audit re-verified the round-1 reconciliation; no residual issues. |

---

## Phase A3 — privilege markers (commit `b2ef9f1`)

| Audit job | Verify job |
|---|---|
| `audit-mpfgref5-1drdsi` | `verify-mpfgxs2h-xxgvzi` |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| F2.1 | Low | Cleanup-only — local interfaces in `inMemoryPrivilege` duplicate the public types in `types.ts`. No behavior or invariant impact. Audit accepted deferral. | Phase A4 (broader sibling-module refactor when fact entities land) | YES | closed | Closed in Phase A4 (commit `<pending A4>`). `ListPrivilegeMarkersQuery` and `ListPrivilegeMarkersPage` were removed from `inMemoryPrivilege.ts` and imported from `types.ts` instead; same refactor applied to `inMemoryClassification.ts` for the parallel `ListClassifications*` types. |
| F2.2 | Low | Out-of-scope — tenant/matter/document consistency path overlaps with `inMemoryClassification`. Resurfaces in A4 when facts add a third sibling. Audit accepted deferral. | Phase A4 (extract `resolveDocumentTarget` helper) | YES | closed | Closed in Phase A4 (commit `<pending A4>`). New shared helper `src/resolveTarget.ts` consumed by `inMemoryClassification`, `inMemoryPrivilege`, and `inMemoryFact`. Preserves the exact error-code semantics (unknown_document / tenant_mismatch / matter_id_mismatch). |
| F4.2 | Low | Cleanup-only — defensive markerIndex behavior is acceptable (no delete API exists; an index miss throws before mutation). Audit verdict: "no code change required". | cleanup-accepted (no follow-up planned) | YES | open | Defense-in-depth defensive path. Resurfaces only if A3+ introduces a marker-delete API; reopen this row at that time. |
| F5.2 | Low | Audit verdict was CLEAN — no tenant/matter leak found in `getPrivilegeStatus`. Recorded as "deferred" only in the sense that it stayed an inspected-and-accepted item; no fix required. | cleanup-accepted (no follow-up planned) | YES | open | Persistent-cleanliness witness. Keep an eye on it during A4 when `target_type === "fact"` opens up. |
| F5.3 | Low | Audit verdict was CLEAN — no disclosure-safety inference from `hasProtectiveAssertion` in any persistence path. Recorded as "deferred" only in the same sense as F5.2. | cleanup-accepted (no follow-up planned) | YES | open | Anti-disclosure-clearance invariant witness. Defended by invariants test §6.2.A3.2; that test must not be deleted or weakened without an ADR. |

---

## Phase A2 — confidentiality classification (commit `f7f4bf5`)

| Audit job | Verify job |
|---|---|
| `audit-mpfcyd9a-l60m5r` | `verify-mpfd4e2y-6hzr6w` |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| F2.2 | Low | Out-of-scope — tenant/matter/document consistency check pattern repeated across append and get-effective paths. Small now; would grow with facts. Audit accepted deferral. | Phase A4 (extract `resolveDocumentTarget` helper) | YES | closed | Closed in Phase A4 (commit `<pending A4>`) alongside A3 F2.2 — shared `resolveDocumentTarget` helper now consumed by `inMemoryClassification`. |
| F3.1 | Low | Cleanup-only — `unknown_document` code retained for forward compatibility per the documented 10-code set; not emitted by A2 methods. | cleanup-accepted (no follow-up planned) | YES | open | A3 introduced paths that DO emit `unknown_document` (appendPrivilegeMarker, getPrivilegeStatus). Mark for **review on A4 close**: if at least one A3 conformance case exercises every documented code, this row can flip to `closed`. |
| F3.2 | Low | Cleanup-only — invariants test §6.2.6 SAMPLES error codes rather than exhaustively triggering each. Acceptable per audit. | cleanup-accepted (no follow-up planned) | YES | open | Same paired observation as F3.1 — if A3+ tests reach full code coverage, the §6.2.6 sampled comment can be rephrased to "comprehensive" without code changes. |
| F4.2 | Low | Cleanup-only — whitespace-only reasons accepted by `appendConfidentialityClassification` for codes other than `"other"`. Audit accepted. | cleanup-accepted (no follow-up planned) | YES | open | Persistence DOES reject whitespace for `change_reason_code === "other"` (added during A2 audit-fix). Other reason codes are enum-bound so the whitespace concern is bounded. |
| F4.3 | Low | Out-of-scope — `listConfidentialityClassifications` returns empty for never-classified documents while `getEffectiveClassification` returns `unclassified`. Distinction is intended; only conformance pinning was missing. | future fact-target broadening WI (relabeled by A5 — A5 is dockets/deadlines, NOT fact-targets; the original "A5-fact-targets" label set by A4 was a misnomer) | YES | open | Pure test gap; behavior is correct. Target field relabeled by Phase A5 (commit `<pending A5>`); row remains open. |

---

## Phase A1 — case-box persistence in-memory base (commit `5de5530`)

| Audit job | Verify job |
|---|---|
| `audit-mpf8prhx-qenxkd` | `verify-mpf974sx-sn3hum` |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| F2.1 | Low | Cleanup-only — audit-event construction sequencing duplicated across matter create / document register / matter transition paths. Small; refactor would not change behavior. | future bounded refactor WI when a 4th audit-emitting path lands | YES | open | A2 + A3 added more audit-emitting paths (classification, privilege). The duplication factor is now ~5; consider opening a refactor WI once A4 (facts) lands. |
| F3.1 | Low | Cleanup-only — `unknown_document` retained for forward compatibility (see A2 F3.1). | (paired with A2 F3.1) | YES | superseded by A3 | A3's `appendPrivilegeMarker` and `getPrivilegeStatus` exercise this code. Closing under that justification — see `b2ef9f1` conformance §6.A3.10, §6.A3.24. |
| F3.2 | Low | Cleanup-only — test exhaustiveness for §6.2.6 (see A2 F3.2). | (paired with A2 F3.2) | YES | open | Cross-WI test coverage may have grown enough; revisit comment after A4. |
| F4.2 | Low | Cleanup-only — whitespace-only `reason` accepted by `archiveMatter` / `unarchiveMatter`. Audit accepted. | cleanup-accepted (no follow-up planned) | YES | open | Same pattern as A2 F4.2; matter-transition reasons are free-text by design. |

---

## Legend for future entries

When closing an entry, leave the row in place and update `Status` + append to `Notes` like:

```
| ... | closed | Resolved in WI-XX (commit abc1234) — extracted `resolveDocumentTarget`; conformance case 6.A4.N covers. |
```

When a finding becomes irrelevant (e.g. the affected code was removed by another WI), mark `superseded` and cite the commit that removed the underlying surface.

When several rows close together (e.g. A2 F2.2 + A3 F2.1 + A3 F2.2 all close under one A4 refactor), keep them as separate rows so the grep for any one of them still surfaces the close.
