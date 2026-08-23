# PLAN — Matter-details edit (audited "edit case info") — umbrella

**Type:** umbrella PLAN (governs a HIGH-RISK multi-WI vertical). **Status:** DRAFT — non-authorizing until cc-suite
`review-plan` returns READY. **Branch:** `feature/pta-claimtrack-vertical-slice` (local; no push).

**Review record:** cc-suite `review-plan` attempt 1 (`review-plan-msfs0feb-kcagp3`, full plan, high) → TIMEOUT
(codex 30-min). Retry (`review-plan-msft4qq2-37iwlq`, compact packet, high) → **NEEDS-FIX** → 6 findings folded
(rev-1): DEFER `litigation_position` + `jurisdiction.value` (narrowing v1 to 6 free-text fields); §3 resolved as
**(b)** structured `changed_fields`; D4a operational spec expanded; D5 patch semantics tightened; D2 immutable-`id`
rule. Re-review (`review-plan-msftb3fh-am8xe6`, rev-1 compact, high) → **READY (Low-risk clarifications)**. The 3
clarifications are folded into Phase A/B below (§4): (i) extend the canonical audit-event hasher to cover
`changed_fields` (the current canonicalizer is fixed-field — schema allowance alone is insufficient for
tamper-evidence); (ii) schema rejects `changed_fields` on every kind EXCEPT `MATTER_DETAILS_UPDATED`; (iii) Phase B
merely REJECTS jurisdiction keys (no deadline-aware jurisdiction logic — that field is deferred). **Status: plan
READY; Phase A may open (implementation still requires per-WI review-plan/audit/verify + user go-ahead).**
**Grounding:** Frank's reported gap (#2 — a matter cannot be edited after creation); Codex design consult (thread
`019fd0d5`); assistant-verified repo constraints (below). Consumes the audit-chain invariants + the shipped
ClaimTrack vertical (VS-0..VS-3) unchanged.

## 0. Problem
After a matter is created there is **no way to correct its information** — no update path at any layer (contract has
no matter-details-update audit kind; persistence port has no `updateMatter`; no IPC channel; no edit screen/route).
Editing a matter is not a plain UPDATE: a matter is an **audited entity**, so an edit MUST append an audit event
with state-hash continuity (a silent `UPDATE case_box_matters` is undetectable court-facing corruption).

## 1. Verified constraints (assistant-checked, not just Codex)
- **No update path exists:** port `services/case-box-persistence/src/types.ts` matter methods = create/get/archive/
  unarchive/ensurePartyIds; audit kinds (`docs/contracts/case-box-contract/src/audit-log.ts:72-114`) have
  MATTER_REGISTERED/ARCHIVED/UNARCHIVED/PARTY_IDS_ASSIGNED + flag toggles + exports — **no generic details-update**.
- **Confidentiality has its own reason-gated audit path** (`audit-log.ts:119-122`: CLASSIFICATION_SET/UPGRADED/
  DOWNGRADED[reason]/RESET[reason], entity_type `confidentiality_classification`). Codex further notes the
  confidentiality ADR keeps *matter-level* classification on the matter row and excludes `target_type:"matter"`
  from `CaseBoxConfidentialityClassification` — so a matter-confidentiality edit needs its OWN future audited
  method, and MUST NOT ride the generic details edit.
- **Claim tracks reference `party_id`s** (`case-box-claim-track.ts:28/32` claimant/respondent) validated against
  `matter.parties[].id` — so editing/removing parties can orphan claim-track references.
- **Audited-mutation precedent** to mirror: `prepareMatterTransition` + `prepareEnsureMatterPartyIds`
  (`src/inMemoryMatter.ts`) — before/after `entityStateHash`, chain off the prior event, one appended event,
  fail-closed continuity.

## 2. Design decisions
- **D1 (rev-1) — narrow scope: name + free-text descriptors only.** Build `updateMatterDetails`, NOT a generic row
  update. V1 edits ONLY correctable, non-legally-load-bearing text. V1 field matrix:
  | Field | V1 | Rationale |
  |---|---|---|
  | `name` | **EDITABLE** | common correction (caption fix) |
  | `retainer_scope` | **EDITABLE** | descriptive scope text |
  | `case_type_text` / `case_progress_text` / `court_contact_text` / `contention_summary_text` | **EDITABLE** | lawyer free-text descriptors |
  | `litigation_position` | **DEFERRED (post-v1)** | feeds T3/court-facing exports — NOT merely descriptive; editable only in a later WI that documents every consumer + adds tests proving exports/read-models use the post-edit audited state (review finding 1) |
  | `jurisdiction.value` | **DEFERRED (post-v1)** | venue/deadline/forms-bearing, NOT descriptive; add later with its own ADR + invariant set (locked/deadline/derived-lock tests) (review finding 2) |
  | `jurisdiction.locked` | FROZEN | derived legal guard; renderer never sets it |
  | `matter_type` | FROZEN | product invariant — evolution via `successor_matter_id`, not in-place |
  | `parties[]` | FROZEN (D2) | claim-track reference integrity |
  | `confidentiality_class` | FROZEN (D3) | dedicated audited path |
  | opt-in flags (external_ocr / sync / llm) | FROZEN | already have dedicated authorize/revoke audit kinds |
  | `id` / `tenant_id` / `actor_user_id` / `created_at` | FROZEN | server authority/provenance |
  | `status` / `archived_at` | FROZEN | lifecycle path only (archive/unarchive) |
  | `successor_matter_id` | FROZEN | matter-evolution/linking feature |

  So v1 EDITABLE = exactly `{name, retainer_scope, case_type_text, case_progress_text, court_contact_text,
  contention_summary_text}` (6 free-text fields). `litigation_position` + `jurisdiction.value` are their own later
  WIs; everything else frozen.
- **D2 — defer party editing entirely.** Including parties turns this into reference-integrity machinery. Future
  party-management rules (its own feature), tightened per review finding 6: **an assigned `party.id` is immutable
  once referenced**; block deletion/role/name change of any party referenced by `case_box_claim_tracks` UNLESS
  claim tracks first gain immutable display snapshots OR a reference-preserving migration + a dedicated party-change
  audit model lands. Rename/delete of a referenced party is forbidden until that safety exists.
- **D3 — defer confidentiality editing.** A future dedicated method (candidate `updateMatterConfidentiality` +
  `MATTER_CONFIDENTIALITY_CHANGED`, reasonRequired both directions since heightened/sealed denies external handling)
  — NOT the generic details edit, NOT `CaseBoxConfidentialityClassification` (ADR excludes `target_type:"matter"`).
- **D4 — audit model.** New kind `MATTER_DETAILS_UPDATED` `{ action:"update", entity_type:"matter",
  reasonRequired:true }`. Persistence appends **one** event in the SAME transaction as the `payload_json` update,
  computing `before_state_hash` (current stored payload) + `after_state_hash` (rewritten payload) + chaining
  `prev_event_hash` off the matter audit head.
- **D4a (rev-1) — continuity against the latest prior MATTER event + operational spec.** With child entities (claim
  tracks, deadlines, documents) now interleaving the chain, the fail-closed continuity check MUST verify the stored
  matter payload's hash against the latest prior `entity_type="matter" AND entity_id=matter.id` event's
  `after_state_hash` — NOT the global last event. Operational spec (review finding 3):
  - **Selection:** the latest prior matter event = that entity-scoped set ordered `sequence DESC` (canonical
    entity-local ordering), read INSIDE the same write transaction that appends the new event + rewrites
    `payload_json`, under the same locking discipline existing append-only audit writes use.
  - **Fail-closed cases (all → refuse, no write):** no prior matter event exists (a matter always has
    MATTER_REGISTERED, so absence = corruption); the prior event's `after_state_hash` is null/malformed; the stored
    payload's `entityStateHash` ≠ that prior `after_state_hash` (drift); any read/hash/compute error.
  - **Concurrency:** the read→hash→append→update sequence is one transaction; a concurrent update racing between
    read and write must not interleave (transaction/lock, mirroring existing audit-append writes).
  - **Global chain rules still preserved:** `prev_event_hash` chains off the global audit head and the append-only
    global sequence/hash invariants (`event_count == COUNT(*) == MAX(sequence)`) still hold — D4a only changes which
    event supplies the *state-continuity* baseline, not the global chaining.
- **D5 (rev-1) — strict PATCH semantics + no-op rejection + archived read-only.** The DTO is a partial patch of the
  6 editable fields only. Precise rules (review finding 5):
  - **Reject unknown fields** (not in the editable allowlist) and **reject any frozen field** even if its value is
    unchanged (a frozen key present at all = `invalid_payload`).
  - `undefined` / absent key = "no change to this field"; `null` or `""` = an explicit clear, allowed ONLY where
    the field's domain permits clearing (`name` is required → cannot clear to empty; the optional text descriptors
    may be cleared to `""`). Never silently erase an optional field via a full-replacement payload.
  - **Normalize/canonicalize before no-op detection** (trim, canonical form), then reject the edit if NO editable
    field actually changes after canonicalization (no audit spam).
  - `changed_fields` (D5a below) is computed AFTER canonicalization, over the editable allowlist only.
  - Editing an **archived** matter is rejected — the user unarchives, edits, re-archives.
- **D5a (rev-1) — record `changed_fields` (review §3 resolved as option (b)).** Phase A adds a narrow, structured
  `changed_fields: string[]` (sorted; values restricted to the 6 editable field paths) to the `MATTER_DETAILS_UPDATED`
  event's payload/schema — NOT a generic unbounded metadata escape hatch, and NOT JSON-in-reason. Rationale: for a
  court-facing audit a reviewer must see WHAT materially changed; before/after payloads aren't retained (only
  hashes), so `changed_fields` can't be derived post-hoc, and the human `reason` must stay clean prose. The
  `changed_fields` participate in the event hash (tamper-evident).

## 3. RESOLVED (review-plan) — how to record which fields changed → option (b)
The audit event schema has no metadata/changed-fields column. review-plan chose **(b)**: add a narrow, structured
`changed_fields: string[]` to the `MATTER_DETAILS_UPDATED` event payload/schema (Phase A), restricted to the 6
editable field paths — see D5a. Rejected: (a) reason+hashes-only (too weak for court-facing materiality review — a
reviewer can't see WHAT changed); (c) JSON-in-reason (pollutes the court-facing human reason field, parsing
ambiguity). Do NOT make it a generic unbounded metadata slot — narrow to this event.

## 4. Phasing (governed WI sequence; mirrors the ClaimTrack slice)
- **Phase A — ADR + contract (HIGH-RISK):** `docs/adr/ADR-matter-details-edit-v1.md` **locks the v1 field set**
  (the 6 free-text fields; litigation_position + jurisdiction.value + parties + confidentiality explicitly
  out) + the audit model + D4a continuity spec + the D5a `changed_fields` decision. Contract: add
  `MATTER_DETAILS_UPDATED` to `CASE_BOX_AUDIT_EVENT_KINDS` + schema enum + generated types, AND add the narrow
  structured `changed_fields: string[]` to the event payload/schema (D5a). **Re-review clarifications (must land in
  Phase A):** (i) extend the canonical audit-event **hasher** to include `changed_fields` when present — the current
  canonicalizer is fixed-field, so a schema allowance alone would leave `changed_fields` un-hashed / not
  tamper-evident; (ii) the schema must **reject `changed_fields` on every event kind EXCEPT `MATTER_DETAILS_UPDATED`**
  (conditional). Tests: schema↔TS sync, reasonRequired, changed_fields shape/allowlist + per-kind rejection,
  canonical-hash-covers-changed_fields, verify-chain, label coverage. Per review finding 6, **persistence (Phase B)
  does not start until this ADR is merged** (field set + changed_fields + continuity locked). review-plan + audit +
  verify.
- **Phase B — persistence (HIGH-RISK):** `updateMatterDetails` on the port + `prepareMatterDetailsUpdate`
  (in-memory + SQLite parity), D4a fail-closed continuity, strict D5 patch semantics (unknown/frozen-key reject —
  **jurisdiction keys are simply REJECTED, no deadline-aware logic** since `jurisdiction.value` is deferred;
  re-review clarification iii), canonicalize-before-no-op rejection, archived-reject, one-event-in-transaction;
  hardening + impl-parity tests. review-plan + audit + verify.
- **Phase C — IPC (Tier-1):** `casebox:matter:updateDetails` channel + handler + DTO (editable-field allowlist,
  forbidden server/lifecycle fields, reason), preload, renderer api/types, drift-sync. Server injects actor/tenant.
- **Phase D — UI (Tier-1.5, needs a design artifact):** `#/matters/:id/edit` route + an edit affordance on the
  active matter detail, form seeded from `getMatter`, reason field, archived → read-only. Design artifact under the
  UI gates.
- **Later (separate features, NOT this vertical):** `updateMatterConfidentiality`; party management with
  claim-track reference integrity.

## 5. Hard stops (halt + report)
Silent `UPDATE case_box_matters` without an audit event; any DTO accepting server/provenance/lifecycle fields; any
party edit before the claim-track reference policy exists; any confidentiality change via the generic edit; any
jurisdiction change while deadlines exist / lock inconsistent; any update that advances the audit head while the
matter payload hash is out of sync with the latest prior MATTER event; any UI editing an archived matter directly;
any full-replacement payload that can erase an optional field unintentionally.

## 6. Review packet (compact) — rev-1 (post NEEDS-FIX)
- **Summary:** Add an audited `updateMatterDetails` for **6 free-text descriptive fields only** (name,
  retainer_scope, case_type_text/case_progress_text/court_contact_text/contention_summary_text). New
  `MATTER_DETAILS_UPDATED` audit kind + a narrow structured `changed_fields: string[]` (D5a), one event per edit
  in-transaction, fail-closed continuity vs the latest prior MATTER event (D4a operational spec), strict PATCH
  semantics (D5), no-op + archived rejected. `litigation_position`, `jurisdiction.value`, parties, and
  confidentiality are all DEFERRED to their own later WIs. Phased ADR/contract → persistence → IPC → UI.
- **Field matrix / audit model / continuity / patch / deferrals:** §2 (D1 rev-1, D4/D4a rev-1, D5/D5a rev-1, D2/D3),
  §3 (resolved (b)).
- **Out of scope:** litigation_position + jurisdiction.value (later WIs); party editing (D2); confidentiality
  editing (D3); matter_type/status/successor/flags/server fields; a generic row update; an unbounded metadata slot.
- **Essential refs:** `src/inMemoryMatter.ts` (prepareMatterTransition/ensureMatterPartyIds precedent);
  `src/audit-log.ts`; `case-box-matter.schema.json`; the confidentiality ADR
  (`docs/adr/case-box-step-5-confidentiality-classification.md`); the ClaimTrack party-ref checks
  (`src/inMemoryClaimTrack.ts`).
- **Re-review questions (rev-1 — confirm the NEEDS-FIX findings are resolved):** (1) Is the narrowed v1 field set
  (6 free-text fields; litigation_position + jurisdiction deferred) now correctly scoped? (2) Is the D4a operational
  spec (entity-scoped latest-prior-matter selection ordered sequence DESC, in-transaction, explicit fail-closed
  cases + concurrency) complete? (3) Is D5a (narrow structured `changed_fields`, hashed, not JSON-in-reason)
  correct? (4) Is D5's strict patch contract (unknown/frozen reject, domain-gated clear, canonicalize-before-no-op)
  right? (5) Any residual gap before Phase A opens?

## 7. Stop condition
Superseded when review-plan is READY and Phase A opens. Revised if review-plan flags the field matrix, the D4a
continuity rule, or the §3 changed-fields decision.
