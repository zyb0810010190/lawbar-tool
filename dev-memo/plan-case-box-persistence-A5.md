# CASE-BOX-PERSISTENCE Phase A5 — Docket Entries + Deadline Materialization (bounded plan)

**Status**: round-2 plan after r1 review. Round-1 verdict NEEDS REVISION (2 High + 4 Medium + Lows); revisions applied.

## Review history

- 2026-05-21 round 1 — `/cc-suite:review-plan` via Path 1 runner attempt 1 (full packet). Job `review-plan-mpfk1iem-boe4q9`. **NEEDS REVISION**. Revisions applied (this version):
  - **H1 (Dim 2 #1) IANA validation incomplete**. Old plan called `assertValidIanaTimezone` only when `kind === "datetime"`. **FIX**: call helper whenever `row.proposed_due_at_timezone !== null`, regardless of kind. Added conformance §6.A5.4b (date_only entry with non-null invalid timezone → invalid_payload).
  - **H2 (Dim 3 #1) `transitionDeadline` invents non-contract fields**. Old plan wrote `missed_at`/`withdrawn_at`. The deadline schema has only `met_at`, `previous_status`, `transition_reason`. **FIX**: `transitionDeadline` patches ONLY `status`; sets `met_at` only when `to === "met"`; sets `previous_status + transition_reason` only when `from === "missed" && to === "met"`. No invented timestamps.
  - **M1 (Dim 1 #1) `source_rule_citation` null handling**. **FIX**: Mode B's deadline-row build OMITS the property entirely when `entry.source_rule_citation` is null (does NOT store null). Added conformance §6.A5.19b for null-citation entry confirmation.
  - **M2 (Dim 2 #2) Mode B atomicity test mislabeled**. Old §6.A5.18 used duplicate-id (preflight rejection, not validate rejection). **FIX**: kept §6.A5.18 as preflight test (now §6.A5.18a). Added §6.A5.18b — a TRUE validateDeadline-rejection path using a deliberately-malformed `deadline_id`; asserts entry unchanged + zero audit events.
  - **M3 (Dim 4 #1) confirming-actor vs proposer**. **FIX**: explicit conformance §6.A5.19c — proposer is "alice", confirmer is "bob"; asserts `deadline.actor_user_id === "bob"`, both audit events' `actor_user_id === "bob"`.
  - **M4 (Dim 4 #3) optional-field omission at deadline creation**. **FIX**: Mode B's deadline-row build OMITS `met_at`, `previous_status`, `transition_reason`, and `source_rule_citation` (when null) entirely. Does NOT set them to null.
  - **M5 (Dim 5 #2) reserved `deadlines_by_matter` cursor kind**. **FIX**: DEFER cursor-kind wiring to A8 (when listDeadlines actually ships). A5 only adds `docket_entries_by_matter`. Less surface; A8 will add the deadline kind alongside its own conformance.
  - L items confirmed acceptable: Mode B order + hash binding (Dim 1 #2), idempotent re-confirm spec (Dim 2 #3), state shape (Dim 3 #2), matter-transition extraction approach (Dim 3 #3), previous_status spec (Dim 4 #2), getDeadline/listDeadlines deferral (Dim 5 #1), createAndConfirmManualDocketEntry deferral (Dim 5 #3).

**Status**: ready for round-2 `/cc-suite:review-plan`.
**Date**: 2026-05-21.
**Parent plan**: `dev-memo/plan-case-box-persistence-00.md` §10.2 row A5 ("Docket entry + deadline materialization (Step 6) — Medium-high — Mode B atomicity. Most subtle invariant.").
**Built on**: A4 (commit `1ede5e8`).

Compact review packet at top per CCSUITE-02.

---

## Review packet (compact)

### Active plan summary

Phase A5 implements Step 6: `CaseBoxDocketEntry` storage + `CaseBoxDeadline` materialization. 6 new methods: `appendDocketEntry` (Mode A propose), `confirmDocketEntry` (Mode B atomic — entry → confirmed + new Deadline row + 2 audit events), `dismissDocketEntry` (Mode C), `getDocketEntry` (scoped), `listDocketEntries`, `transitionDeadline` (pending → met/missed/withdrawn; missed → met with reason). Public surface 22 → 28. Critical Step-6 invariants: all entries start `proposed`; `date_only` confirmation FORBIDDEN; Mode B is atomic (entry confirm + deadline create commit-or-rollback together); idempotent re-confirm returns existing materialization without new audit; IANA timezone validation via contract `assertValidIanaTimezone`. Deadline reads (`getDeadline`, `listDeadlines`) deferred to A8. `createAndConfirmManualDocketEntry` convenience API NOT shipped in A5 (Step 6 ADR §6 marks it MAY; defer to a later convenience-API WI).

### Exact target files

- `services/case-box-persistence/src/inMemoryDocket.ts` — NEW sibling. Holds docket-entry state + Mode A/B/C logic. Mode B is the load-bearing piece: atomic two-write step (entry patch + deadline create) inside the existing WeakMap-mutation discipline.
- `services/case-box-persistence/src/inMemoryDeadline.ts` — NEW sibling. Holds deadline-row state + `transitionDeadline` logic. Mode B's deadline-row construction lives here so the docket module can call it without inlining.
- `services/case-box-persistence/src/inMemoryRepo.ts` — modified: add 6 thin delegate methods + 2 new state slots. LOC budget: see §1.3.
- `services/case-box-persistence/src/cursor.ts` — add cursor kind `docket_entries_by_matter` ONLY (`deadlines_by_matter` deferred to A8 per round-1 M5 fix).
- `services/case-box-persistence/src/types.ts` — add 6 interface methods + types; re-export `CaseBoxDocketEntry`, `CaseBoxDeadline`.
- `services/case-box-persistence/src/index.ts` — re-exports.
- `services/case-box-persistence/tests/conformance/fixtures.mjs` — add `makeDocketEntryInput`, `makeDeadlineInput`.
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` — add ~32 conformance cases.
- `services/case-box-persistence/tests/invariants.test.mjs` — §6.2.7 prototype allowlist bumps to 28.
- `dev-memo/deferred-audit-findings.md` — rename A2 F4.3's target label from "future A5-fact-targets WI" to "future fact-target broadening WI" (A5 is dockets, NOT fact-targets — the label was a misnomer from A4).

### Exact acceptance criteria

1. `npm --prefix services/case-box-persistence test` exits 0 (140 from A1-A4 + ~32 A5 ≈ 172 total).
2. `npm --prefix docs/contracts/case-box-contract test` still 322/322.
3. `npm --prefix docs/contracts test` (OCR) still 102/102.
4. loc-guardian: 0 files over fail (800).
5. Public surface = 28; §6.2.7 allowlist matches.
6. No new `CaseBoxPersistenceError` code; A5 reuses the 10 documented codes.
7. Audit chain remains valid spanning A1-A5.
8. cc-suite audit + verify via Path 1; retrievable.
9. Mode B atomicity proven by conformance: a Mode B failure mid-step (e.g. deadline validation rejects) leaves the entry state UNCHANGED and emits ZERO audit events.
10. `date_only` confirmation conformance pins: rejected with `invalid_argument`.
11. Idempotent re-confirm conformance pins: returns existing deadline, emits no new audit, no duplicate deadline.
12. A2 F4.3 backlog row target relabeled (does NOT close — still `status: open`).

### Exact out-of-scope list

- No SQLite, native module, API/gateway, UI, sync, cloud, auth, LLM execution, OCR-package change, external network, schema change, contract package edit, dependency change, ADR/release doc edit, .claude/** edit, push.
- No `getDeadline` / `listDeadlines` (deferred to A8; cursor kind NOT reserved — A8 adds it alongside the conformance).
- No `createAndConfirmManualDocketEntry` convenience API (deferred to later WI).
- No DEADLINE_CONTINUED audit kind (Step 6 ADR explicitly defers).
- No deadline-derivation engine (post-MVP per Step 6 ADR).
- No broadening of A2/A3 to accept fact targets (still future "fact-target broadening WI").

### Essential ADR references

- `docs/adr/case-box-step-6-deadline-docketing-rules.md` — Step 6 ADR. §1 entity shape; §3 no direct-confirm; §4 confirmation helper; §5 date_only forbidden; §6 three modes; §7 materialization field mapping (DocketEntry → CaseBoxDeadline); §8 audit-log integration.
- `docs/adr/case-box-step-4-audit-log-shape.md` — audit chain.
- `docs/contracts/case-box-contract/src/docket-invariants.ts` — `assertValidNewDocketEntry`, `assertValidDocketEntryConfirmation`, `assertValidIanaTimezone`, `interpretDocketEntryDueAt`, `DocketEntryCreationError`, `DocketEntryConfirmationError`, `InvalidIanaTimezoneError`.
- `docs/contracts/case-box-contract/src/transitions.ts` — `assertValidDocketEntryTransition` (for dismiss), `assertValidDeadlineTransition`, `ALLOWED_DOCKET_ENTRY_EDGES` (:228), `ALLOWED_DEADLINE_EDGES` (:254), `DocketEntryState`, `DeadlineState`.
- `docs/contracts/case-box-contract/src/audit-log.ts` — `DEADLINE_REGISTERED/MET/MISSED/WITHDRAWN/MISSED_TO_MET` (:80-84) + `DOCKET_ENTRY_PROPOSED/CONFIRMED/DISMISSED` (:115-117).
- `docs/contracts/case-box-contract/schemas/case-box-docket-entry.schema.json`, `case-box-deadline.schema.json`.

### Review questions (targeted)

1. Mode B atomicity — is the entry-patch + deadline-create + 2-audit-event emission genuinely atomic? Does a deadline-validation failure leave entry state unchanged AND emit zero audit events?
2. Idempotent re-confirm — does a second `confirmDocketEntry` on the same entry detect existing `confirmed_deadline_id`, return the existing materialization, and emit no new audit?
3. Audit-kind selection across the two writes — does Mode B emit BOTH `DOCKET_ENTRY_CONFIRMED` (update) AND `DEADLINE_REGISTERED` (create) in the correct order, with the deadline's `before_state_hash: null` per audit-log:365?
4. Materialization field mapping (Step 6 ADR §7) — are `id`, `kind`, `due_at`, `owner_user_id`, `status: "pending"` correctly populated on the new deadline row? Is the deadline's `actor_user_id` the docket entry's confirming actor (NOT the proposer)?
5. LOC discipline — `inMemoryRepo.ts` at 716 entering A5; what's the projected post-A5 LOC, and which delegates extract to siblings to stay safely under 800?

---

## 1. Scope

### 1.1 Functional scope — 6 new public methods (22 → 28)

1. **`appendDocketEntry(input: unknown): Promise<CaseBoxDocketEntry>`** (Mode A)
   - Pre-schema raw guard: `confirmation_state !== "proposed"` → `invalid_argument` (persistence narrows the surface, parallel to A3/A4 patterns).
   - `validateDocketEntry(input)` — failure → `invalid_payload`. (Contract export name: `validateDocketEntry`.)
   - `assertValidNewDocketEntry(row)` — `DocketEntryCreationError` → `invalid_payload`. Enforces proposed-only + null confirmation/dismissal fields.
   - **IANA timezone validation** (round-1 H1 fix): whenever `row.proposed_due_at_timezone !== null`, call `assertValidIanaTimezone(timezone)` — regardless of `proposed_due_at_kind`. A date_only entry MAY carry a non-null timezone; if it does, it MUST be valid. `InvalidIanaTimezoneError` → `invalid_payload`. (Schema separately enforces that `proposed_due_at_timezone` IS non-null when kind=datetime; persistence does NOT need to re-enforce that.)
   - Tenant/matter consistency: matter exists, `matter.tenant_id === row.tenant_id`.
   - When `source_document_id` non-null: shared `resolveDocumentTarget` (A4 helper).
   - Duplicate-id check via `docketIds: Set<string>` index.
   - Audit kind: `DOCKET_ENTRY_PROPOSED` (action: create; reason absent).
   - Atomic commit (single write).

2. **`confirmDocketEntry(entryId: string, opts: ConfirmDocketEntryOpts): Promise<{ entry: CaseBoxDocketEntry; deadline: CaseBoxDeadline }>`** (Mode B atomic)
   - `ConfirmDocketEntryOpts = { confirmation_actor_user_id, confirmed_at, deadline_id }` — `deadline_id` is the PRE-ALLOCATED ULID for the new deadline row (caller-supplied per Step 6 ADR §7 row 1; persistence does NOT generate it).
   - Pre-validate `opts` shape (non-empty strings).
   - Resolve entry via `docketIndex: Map<entryId, matterId>`. Unknown → `invalid_argument`.
   - **Idempotency preflight** (Step 6 ADR §6 Mode B step 1): if `entry.confirmation_state === "confirmed"` AND `entry.confirmed_deadline_id !== null` AND a deadline row exists for that id: return the existing entry + existing deadline; emit NO audit; do NOT validate further (the prior confirmation already proved valid).
   - `assertValidDocketEntryConfirmation(entry, "lawyer")` from `docket-invariants.ts:186` — performs the state-machine check AND the date_only-confirmation prohibition. `IllegalTransitionError` → `illegal_transition`; `DocketEntryConfirmationError` → `invalid_argument` (date_only rejected at the persistence boundary as a caller error, not a payload error).
   - Build the next entry shape: `confirmation_state = "confirmed"`, `confirmation_actor_user_id = opts.confirmation_actor_user_id`, `confirmed_at = opts.confirmed_at`, `confirmed_deadline_id = opts.deadline_id`.
   - Re-validate the patched entry via `validateDocketEntry(next)` BEFORE mutation (audit pattern from A3/A4).
   - Build the new deadline row (Step 6 ADR §7 field mapping):
     - `id = opts.deadline_id`
     - `tenant_id = entry.tenant_id`
     - `actor_user_id = opts.confirmation_actor_user_id` (**the CONFIRMING actor, NOT the proposer** — conformance §6.A5.19c pins this)
     - `matter_id = entry.matter_id`
     - `kind = entry.proposed_kind`
     - `due_at = entry.proposed_due_at` (verbatim; only datetime kind reaches Mode B per §5)
     - `owner_user_id = entry.proposed_owner_user_id`
     - `status = "pending"`
     - **Optional fields OMITTED at creation** (round-1 M4 fix): `met_at`, `previous_status`, `transition_reason` are NOT set (not present in the row). Schema-validate works because these fields are optional + the schema's if/then only fires for met-status.
     - `source_rule_citation`: copy ONLY when `entry.source_rule_citation` is a non-null string. When null, OMIT the property entirely (round-1 M1 fix). Conformance §6.A5.19b pins.
   - `validateDeadline(deadline)` — failure → `invalid_payload`. **Mode B atomicity**: if deadline validation fails, the entry patch is NOT applied; no audit emitted.
   - Build TWO audit events:
     - `DOCKET_ENTRY_CONFIRMED` (update; reason absent; `before_state_hash = entityStateHash(prior_entry)`; `after_state_hash = entityStateHash(next_entry)`; `entity_id = entry.id`; `actor_user_id = opts.confirmation_actor_user_id`).
     - `DEADLINE_REGISTERED` (create; reason absent; `before_state_hash = null` per audit-log:365; `after_state_hash = entityStateHash(deadline)`; `entity_id = deadline.id`; `actor_user_id = opts.confirmation_actor_user_id`).
   - **Atomic commit** (single synchronous block): patch the entry array slot; insert the deadline; append BOTH audit events in sequence (entry CONFIRMED first, then DEADLINE_REGISTERED).
   - Returns `{ entry: structuredClone(next), deadline: structuredClone(deadline) }`.

3. **`dismissDocketEntry(entryId: string, opts: DismissDocketEntryOpts): Promise<CaseBoxDocketEntry>`** (Mode C)
   - `DismissDocketEntryOpts = { dismissal_actor_user_id, dismissed_at, dismissal_reason }`.
   - Pre-validate reason non-empty → `invalid_argument` if missing.
   - Resolve entry; unknown → `invalid_argument`.
   - `assertValidDocketEntryTransition(entry.confirmation_state, "dismissed", "lawyer", opts.dismissal_reason)` — `IllegalTransitionError` → `illegal_transition`.
   - Patch entry: `confirmation_state = "dismissed"`, `dismissal_actor_user_id`, `dismissed_at`, `dismissal_reason`.
   - `validateDocketEntry(next)` re-check.
   - Audit kind: `DOCKET_ENTRY_DISMISSED` (action: update; reason = `opts.dismissal_reason`).

4. **`getDocketEntry(query: GetDocketEntryQuery): Promise<CaseBoxDocketEntry | null>`**
   - `query = { tenant_id, matter_id, entry_id }` — scoped per the A4 F5.1 lesson (no global-id leak).
   - Resolves matter; mismatched tenant → `tenant_mismatch` (consistent with `getFact`); unknown matter → null; cross-scope → null.

5. **`listDocketEntries(query: ListDocketEntriesQuery): Promise<ListDocketEntriesPage>`**
   - `query = { tenant_id, matter_id, confirmation_state?, source_type?, cursor?, limit? }`.
   - Ordered by `proposed_at ASC, id ASC`. Cursor kind `docket_entries_by_matter`; tuple `[string, string]`.
   - Rejects `unknown_matter` / `tenant_mismatch` per A1.

6. **`transitionDeadline(deadlineId: string, opts: DeadlineTransitionOpts): Promise<CaseBoxDeadline>`**
   - `DeadlineTransitionOpts = { to: "met" | "missed" | "withdrawn"; actor_user_id; at; transition_reason?: string }`.
   - Resolve deadline via `deadlineIndex: Map<deadlineId, matterId>`. Unknown → `invalid_argument`.
   - Pre-validate `transition_reason` non-empty when transitioning `missed → met` (per audit-log:84 `DEADLINE_MISSED_TO_MET` requires reason). Missing reason → `invalid_argument`.
   - `assertValidDeadlineTransition(prior.status, opts.to, "lawyer", opts.transition_reason)` — `IllegalTransitionError` → `illegal_transition`.
   - **Patch the row using ONLY contract-defined fields** (round-1 H2 fix): the deadline schema has only `met_at`, `previous_status`, `transition_reason` as lifecycle properties — no `missed_at` or `withdrawn_at`.
     - All paths: set `status = opts.to`.
     - When `to === "met"`: set `met_at = opts.at`.
     - When transitioning `missed → met`: ALSO set `previous_status = "missed"` and `transition_reason = opts.transition_reason` (per schema's if/then at lines 54-66 of `case-box-deadline.schema.json`).
     - When `to === "missed"` or `to === "withdrawn"`: only `status` is patched (no timestamp field). The `opts.at` is consumed only by the audit event's `timestamp` field.
   - `validateDeadline(next)` re-check BEFORE mutation.
   - Audit kind:
     - `to === "met"` from "pending" → `DEADLINE_MET` (update; reason absent).
     - `to === "met"` from "missed" → `DEADLINE_MISSED_TO_MET` (update; reason = `opts.transition_reason`).
     - `to === "missed"` → `DEADLINE_MISSED` (update; reason absent).
     - `to === "withdrawn"` → `DEADLINE_WITHDRAWN` (update; reason absent).

### 1.2 Non-functional scope — backlog touches

- A2 F4.3 backlog row: rename target label from "future A5-fact-targets WI" to "future fact-target broadening WI" (A5 is dockets, NOT fact-targets — the label was a misnomer from A4). Row stays `status: open`. NO actual closure.
- No A5 backlog closures expected (A5 is new territory; no prior deferred rows targeted A5).

### 1.3 LOC discipline

`inMemoryRepo.ts` entering A5 at **716 pure LOC** (90% of 800 fail). A5 adds 6 thin delegates. If each is ≤ 12 LOC the total addition is ~72 LOC → projected ~788, still under fail but uncomfortably close.

**Mitigation**: extract two existing A1 matter-lifecycle delegates (`archiveMatter`, `unarchiveMatter`) and the `#transitionMatter` private method to a new `src/inMemoryMatter.ts` sibling BEFORE adding A5 delegates. Estimated extraction: removes ~85 LOC from `inMemoryRepo.ts`. Post-extraction: ~631 + 72 (A5) = ~703 final. Comfortably under fail.

This extraction is functionally identical to the inline matter-transition code; conformance tests for A1's matter lifecycle MUST continue to pass with zero changes (same external behavior).

### 1.4 Internal state additions

- `state.docket: DocketState = { entriesByMatter: Map<matterId, CaseBoxDocketEntry[]>; docketIds: Set<string>; docketIndex: Map<entryId, matterId>; docketById: Map<entryId, CaseBoxDocketEntry> }`.
- `state.deadline: DeadlineState = { deadlinesByMatter: Map<matterId, CaseBoxDeadline[]>; deadlineIds: Set<string>; deadlineIndex: Map<deadlineId, matterId>; deadlineById: Map<deadlineId, CaseBoxDeadline> }`.
- Both follow the A4 `factById` pattern for O(1) row lookup.

---

## 2. Files expected to be added or modified

| Path | Action | Substance |
|---|---|---|
| `services/case-box-persistence/src/inMemoryDocket.ts` | **NEW** | Docket-entry storage + Mode A/B/C logic. Exports `createDocketState`, `prepareAppendDocketEntry`, `prepareConfirmDocketEntry` (returns both entry-patch + deadline-create + 2 audit events for atomic commit), `prepareDismissDocketEntry`, `listDocketEntries`. |
| `services/case-box-persistence/src/inMemoryDeadline.ts` | **NEW** | Deadline storage + `transitionDeadline`. Exports `createDeadlineState`, `prepareTransitionDeadline`, plus `buildDeadlineRowFromDocketEntry(entry, opts)` helper used by Mode B (lives here so docket module imports from deadline). |
| `services/case-box-persistence/src/inMemoryMatter.ts` | **NEW** | Extraction of existing matter-transition logic (A1 `archiveMatter`/`unarchiveMatter`/`#transitionMatter`). Behavior unchanged; reduces inMemoryRepo.ts LOC. |
| `services/case-box-persistence/src/inMemoryRepo.ts` | modified | Replace inline matter-transition code with delegate calls; add 6 new docket/deadline delegate methods; add 2 state slots. |
| `services/case-box-persistence/src/cursor.ts` | modified | Add cursor kind `docket_entries_by_matter` ONLY. `deadlines_by_matter` deferred to A8 (round-1 M5 fix — keeps cursor protocol surface in sync with conformance-tested surface). |
| `services/case-box-persistence/src/types.ts` | modified | New interface methods + types; re-export `CaseBoxDocketEntry`, `CaseBoxDeadline`. |
| `services/case-box-persistence/src/index.ts` | modified | Re-exports. |
| `services/case-box-persistence/tests/conformance/fixtures.mjs` | modified | Add `makeDocketEntryInput`, `makeDeadlineInput`. |
| `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` | modified | Add ~32 conformance cases. |
| `services/case-box-persistence/tests/invariants.test.mjs` | modified | §6.2.7 prototype allowlist bumps to 28. |
| `dev-memo/deferred-audit-findings.md` | modified | Relabel A2 F4.3 target (no closure). Optionally add an A5 §"Phase A5 — docket + deadline" section header for future deferrals. |

**Total**: 3 new source files + 4 modified source files + 3 modified test files + 1 docs file = 11 file diffs.

---

## 3. Files expected to remain untouched

- `docs/contracts/case-box-contract/**`.
- All other `services/**` packages.
- All ADRs / release docs.
- `.claude/**`.
- Three pre-existing user-deferred dev-memo drafts.

---

## 4. Invariants from Step 6 (and carried forward)

### Carried forward A1-A4

- `tenant_id` cross-entity consistency.
- Atomic write discipline.
- Audit emission via `buildCaseBoxAuditEvent` only.
- Per-matter monotonic `sequence`.
- `local-user` sentinel valid.
- Contract guards as single source of truth.

### New for A5 (Step 6 ADR persistence obligations)

1. **All docket entries created in `confirmation_state === "proposed"`** — pre-validation + `assertValidNewDocketEntry`.
2. **`date_only` confirmation FORBIDDEN** — `assertValidDocketEntryConfirmation` enforces; persistence maps to `invalid_argument`. Conformance pins.
3. **Mode B atomicity** — entry-patch + deadline-create + 2 audit events commit together or none commit. Implemented via the "validate everything → build everything → mutate in one synchronous block" pattern. Conformance pins via a deliberately-malformed deadline-id test that asserts entry unchanged + zero audits emitted.
4. **Idempotent re-confirm** (Step 6 ADR §6 Mode B step 1) — preflight check before any validation. Conformance pins.
5. **IANA timezone validation** — for datetime entries, `assertValidIanaTimezone` runs at append (so an unconfirmable entry doesn't pass propose). At confirm time, the entry has already been validated; confirm re-runs `validateDocketEntry` defense-in-depth.
6. **Materialization field mapping** (Step 6 ADR §7) — pinned per §1.1 method 2.
7. **Manual convenience API NOT shipped** — `createAndConfirmManualDocketEntry` deferred. Conformance does not include manual-convenience cases.
8. **DEADLINE_CONTINUED kind** — explicitly deferred by Step 6 ADR; A5 ships only the 5 documented deadline kinds (REGISTERED, MET, MISSED, WITHDRAWN, MISSED_TO_MET) + 3 docket kinds (PROPOSED, CONFIRMED, DISMISSED).
9. **Cross-matter source_document_id** — same A4 pattern: `resolveDocumentTarget` rejects cross-matter / cross-tenant document references.

---

## 5. Out of scope

Same standard exclusions plus:

- `getDeadline`, `listDeadlines` (deferred to A8 read aggregations).
- `createAndConfirmManualDocketEntry` (deferred).
- DEADLINE_CONTINUED handling.
- Deadline-derivation engine.
- A2/A3 broadening to fact targets.

---

## 6. Tests planned

~32 conformance + 2 invariants + 2 audit-chain.

### 6.1 Conformance matrix additions

| § | Case | Asserts |
|---|---|---|
| 6.A5.1 | `appendDocketEntry` proposed happy path (datetime + IANA tz) | row stored; DOCKET_ENTRY_PROPOSED audit; reason absent |
| 6.A5.2 | `appendDocketEntry` rejects confirmation_state="confirmed" | `invalid_argument` |
| 6.A5.3 | `appendDocketEntry` rejects confirmation_state="dismissed" | `invalid_argument` |
| 6.A5.4 | `appendDocketEntry` rejects invalid IANA timezone on datetime entry | `invalid_payload` |
| 6.A5.4b | `appendDocketEntry` rejects invalid IANA timezone on date_only entry (round-1 H1 fix) | `invalid_payload` — non-null bad timezone always rejected regardless of kind |
| 6.A5.5 | `appendDocketEntry` rejects datetime entry with null timezone | `invalid_payload` (schema) |
| 6.A5.6 | `appendDocketEntry` accepts date_only entry (timezone null OR valid) | row stored |
| 6.A5.7 | `appendDocketEntry` rejects non-null confirmation fields on new row | `invalid_payload` |
| 6.A5.8 | `appendDocketEntry` rejects unknown matter | `unknown_matter` |
| 6.A5.9 | `appendDocketEntry` rejects matter-level tenant mismatch | `tenant_mismatch` |
| 6.A5.10 | `appendDocketEntry` rejects unknown source_document_id | `unknown_document` |
| 6.A5.11 | `appendDocketEntry` rejects cross-matter source_document_id | `matter_id_mismatch` |
| 6.A5.12 | `appendDocketEntry` rejects duplicate id | `duplicate_id` |
| 6.A5.13 | `confirmDocketEntry` Mode B happy path (datetime entry) | entry.confirmation_state="confirmed"; deadline row materialized with correct field mapping; TWO audit events (CONFIRMED then DEADLINE_REGISTERED); chain valid |
| 6.A5.14 | `confirmDocketEntry` rejects date_only confirmation (v1 invariant) | `invalid_argument`; entry unchanged; no audit |
| 6.A5.15 | `confirmDocketEntry` idempotent re-confirm | second call returns same deadline; no new audit; no duplicate deadline row |
| 6.A5.16 | `confirmDocketEntry` rejects unknown entryId | `invalid_argument` |
| 6.A5.17 | `confirmDocketEntry` rejects confirming a dismissed entry | `illegal_transition` |
| 6.A5.18a | `confirmDocketEntry` Mode B atomicity — duplicate deadline_id preflight | injected duplicate; entry state unchanged; no audit events emitted |
| 6.A5.18b | `confirmDocketEntry` Mode B atomicity — `validateDeadline` rejection (round-1 M2 fix) | use a deliberately-malformed deadline_id pattern; validateDeadline rejects; entry state unchanged; no audit events emitted |
| 6.A5.19 | `confirmDocketEntry` deadline materialization field mapping (Step 6 §7) | deadline.kind = entry.proposed_kind; deadline.due_at = entry.proposed_due_at; deadline.owner_user_id = entry.proposed_owner_user_id; deadline.actor_user_id = opts.confirmation_actor_user_id; deadline.status = "pending" |
| 6.A5.19b | `confirmDocketEntry` null source_rule_citation omitted from deadline (round-1 M1 fix) | confirm an entry where `source_rule_citation === null`; resulting deadline row does NOT contain a `source_rule_citation` property |
| 6.A5.19c | `confirmDocketEntry` confirming actor binding (round-1 M3 fix) | proposer "alice" ≠ confirmer "bob"; deadline.actor_user_id === "bob"; DOCKET_ENTRY_CONFIRMED audit actor_user_id === "bob"; DEADLINE_REGISTERED audit actor_user_id === "bob" |
| 6.A5.20 | `dismissDocketEntry` requires reason | missing → `invalid_argument`; with reason → DOCKET_ENTRY_DISMISSED audit; reason = dismissal_reason |
| 6.A5.21 | `dismissDocketEntry` rejects dismissing already-dismissed entry | `illegal_transition` (terminal state) |
| 6.A5.22 | `dismissDocketEntry` rejects dismissing confirmed entry | `illegal_transition` (terminal state) |
| 6.A5.23 | `getDocketEntry` scoped (mirrors A4 F5.1 lesson) | unknown returns null; cross-matter returns null; cross-tenant matter throws tenant_mismatch |
| 6.A5.24 | `listDocketEntries` ordered + cursor-paginated; filter by confirmation_state | multi-page |
| 6.A5.25 | `listDocketEntries` rejects unknown_matter / tenant_mismatch | as expected |
| 6.A5.26 | `transitionDeadline` pending → met | DEADLINE_MET audit (no reason) |
| 6.A5.27 | `transitionDeadline` pending → missed | DEADLINE_MISSED audit |
| 6.A5.28 | `transitionDeadline` pending → withdrawn | DEADLINE_WITHDRAWN audit |
| 6.A5.29 | `transitionDeadline` missed → met requires reason | missing → `invalid_argument`; with reason → DEADLINE_MISSED_TO_MET audit; reason = transition_reason |
| 6.A5.30 | `transitionDeadline` rejects met → missed (terminal) | `illegal_transition` |
| 6.A5.31 | `transitionDeadline` unknown deadlineId | `invalid_argument` |
| 6.A5.32 | `transitionDeadline` malformed opts.at | `invalid_argument` (schema revalidate) |

### 6.2 Invariants test additions

- **§6.2.7 prototype allowlist** (modified): expects 28 entries (A1's 11 + A2's 3 + A3's 4 + A4's 4 + A5's 6).
- **§6.2.A5.1**: post-Mode-B, audit events in `listAuditEvents` show CONFIRMED before DEADLINE_REGISTERED at adjacent sequences (no events interleaved). Asserts ordering invariant.

### 6.3 Audit chain test additions

- **§6.3.A5.1**: Mode B chain valid — `verifyAuditChainForMatter` returns ok for a chain spanning matter+document+entry-PROPOSED+entry-CONFIRMED+deadline-REGISTERED.
- **§6.3.A5.2**: DEADLINE_REGISTERED has `before_state_hash: null` (action=create); DOCKET_ENTRY_CONFIRMED has the prior entry hash (action=update).

---

## 7. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Mode B atomicity violated — entry patched but deadline create fails, leaving inconsistent state | Medium | High | Validate everything (entry shape, deadline shape, duplicate-id) BEFORE any mutation; build all 2 audit events; mutate state in one synchronous block. Conformance §6.A5.18 explicitly pins. |
| R2 | Idempotent re-confirm misclassifies an already-confirmed entry and emits duplicate audit | Medium | High | Preflight check (Step 6 ADR §6 step 1) runs FIRST before any validation; returns early if `confirmed && confirmed_deadline_id` exists and resolves to a real deadline row. Conformance §6.A5.15 pins. |
| R3 | Audit-kind mismatch on DEADLINE_REGISTERED (action: create with non-null before_state_hash) | Low | High — audit chain corruption | Hard-coded `before_state_hash: null` for DEADLINE_REGISTERED. Conformance §6.3.A5.2 pins. |
| R4 | Mode B emits audit events in wrong order (deadline before entry, or interleaved) | Low | Medium — readers expect lawyer-action-first ordering | Implementation appends entry-CONFIRMED first, then DEADLINE_REGISTERED. Invariants §6.2.A5.1 pins adjacency + ordering. |
| R5 | LOC discipline — extraction of matter-transition logic introduces behavior drift | Low | High — A1 conformance regresses | Extraction is mechanical — moves `#transitionMatter` body verbatim. All A1 matter conformance cases run unchanged. |
| R6 | `assertValidIanaTimezone` rejects too aggressively or accepts deprecated zones | Low | Medium | Contract owns the timezone set; persistence calls helper. Conformance §6.A5.4 exercises a deliberately-invalid zone. |
| R7 | Mode B deadline-id collision with existing deadline | Low | Medium | Pre-validate duplicate deadline_id via `deadlineIds: Set<string>` BEFORE building anything. Conformance §6.A5.18 covers. |
| R8 | `dismissDocketEntry` allows confirming-then-dismissing flow that contract may not support | Low | Medium | Contract's `assertValidDocketEntryTransition` is the authority; persistence calls it. The edge table at transitions.ts:228 defines legal edges. |
| R9 | Cross-matter deadline references in transitionDeadline | Low | High — tenant/matter isolation breach | `deadlineIndex` ties deadline to matter; transition operates only within that matter's scope. |
| R10 | `transitionDeadline` `previous_status` field set inconsistently for missed → met | Low | Medium | Schema's if/then requires `previous_status` for met-from-missed. Persistence sets it; conformance §6.A5.29 checks the row's `previous_status === "missed"`. |

---

## 8. Acceptance criteria

| # | Criterion | Verified by |
|---|---|---|
| 8.1 | All package tests pass (≈172 total) | `npm --prefix services/case-box-persistence test` |
| 8.2 | Sibling contracts pass | spot test runs |
| 8.3 | loc-guardian 0 over fail | `/loc-guardian:scan` after extraction + A5 additions |
| 8.4 | Public surface = 28 | invariants §6.2.7 |
| 8.5 | No new error codes | conformance |
| 8.6 | Audit chain valid spanning A1-A5 | §6.3.A5.1 |
| 8.7 | Mode B atomicity proven | §6.A5.18 |
| 8.8 | Idempotent re-confirm proven | §6.A5.15 |
| 8.9 | date_only confirmation rejected | §6.A5.14 |
| 8.10 | cc-suite review-plan succeeded; audit + verify via Path 1; verdict `ALL CLOSED` or `ALL CLOSED + DEFERRED-PER-A5 Lows` | 11 fields recorded per invocation |
| 8.11 | A2 F4.3 backlog target relabeled (NOT closed) | `dev-memo/deferred-audit-findings.md` |
| 8.12 | Matter-transition extraction does NOT change A1 conformance behavior | A1 cases unchanged + pass |
| 8.13 | Explicit-stage commit; no `git add .`; no push | scoped diff |

---

## 9. Out-of-scope clarifications for the reviewer

Do NOT flag:
- Missing `getDeadline` / `listDeadlines` — deferred to A8.
- Missing `createAndConfirmManualDocketEntry` — Step 6 ADR §6 marks MAY; deferred.
- Missing DEADLINE_CONTINUED — Step 6 ADR defers.
- Two A5 sibling modules — Mode B explicitly bridges docket and deadline; the build-helper lives in deadline so docket can import without circularity.
- Matter-transition extraction — pre-emptive LOC fix, not an A5 behavioral change.

Reviewer SHOULD flag:
- Any Mode B path where entry is patched but deadline insert is skipped or fails silently.
- Any audit-emission path that emits CONFIRMED + DEADLINE_REGISTERED in wrong order, with wrong actor binding, or with the wrong before_state_hash.
- Any path that mutates state before validation completes.
- Any cross-matter / cross-tenant deadline leak.
- LOC drift past 800.
- `date_only` confirmation accidentally allowed.
- Idempotency check that triggers on a partial-confirm (e.g. confirmed but `confirmed_deadline_id` null).

---

## 10. cc-suite invocation plan

| Stage | Kind | Path |
|---|---|---|
| Plan review (this file) | `review-plan` | Path 1 full packet → compact on TIMEOUT → Path 2 fallback |
| Implementation audit | `audit` | Path 1 → Path 2 fallback |
| Post-fix verify | `verify` | Path 1 with explicit audit artifact |

Recording per `.claude/rules/cc-suite.md` §"Required recording" (11 fields per CCSUITE-02) + per-deferred-finding 5 fields in `dev-memo/deferred-audit-findings.md`.

---

## 11. References

- `dev-memo/plan-case-box-persistence-00.md` — parent plan §10.2 row A5.
- `dev-memo/plan-case-box-persistence-A1.md` … `A4.md` — preceding reviewed plans.
- `dev-memo/deferred-audit-findings.md` — backlog (A5 closes none; relabels A2 F4.3).
- `docs/adr/case-box-step-6-deadline-docketing-rules.md` — Step 6 ADR.
- `docs/contracts/case-box-contract/src/docket-invariants.ts`, `transitions.ts`, `audit-log.ts`.
- `docs/contracts/case-box-contract/schemas/case-box-docket-entry.schema.json`, `case-box-deadline.schema.json`.
- `services/case-box-persistence/src/inMemoryRepo.ts`, sibling modules — A1-A4 implementation; A5 extends + extracts matter-transition.
- `.claude/rules/cc-suite.md` — broker policy + retry + remediation.
