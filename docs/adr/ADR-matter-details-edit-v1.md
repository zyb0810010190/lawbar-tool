# ADR — Matter-details edit v1 (audited "edit case info", 6 free-text fields)

**Status:** Accepted (matter-details-edit Phase A). **Date:** 2026-08-04.
**Context source:** `dev-memo/plan-matter-details-edit-00.md` (umbrella, review-plan READY:
`review-plan-msftb3fh-am8xe6`) + `dev-memo/plan-matter-details-edit-A-docket.md` (Phase-A docket).
Design consult: cc-suite Codex thread `019fd0d5` (design), `019fd104` (Phase-A atomicity/sequencing).

## Context

After a matter is created there is **no way to correct its information**: the contract has no
matter-details-update audit kind, persistence has no `updateMatter`, there is no IPC channel and no
edit screen. Editing a matter is not a plain `UPDATE` — a matter is an **audited entity**, so an edit
MUST append an audit event with state-hash continuity. A silent `UPDATE case_box_matters` is
undetectable, court-facing corruption.

The matter audit kinds are `MATTER_REGISTERED` / `MATTER_ARCHIVED` / `MATTER_UNARCHIVED` /
`MATTER_PARTY_IDS_ASSIGNED` + the OCR/sync/LLM/export flag kinds — none means "descriptive details
corrected," and there is deliberately no generic `MATTER_UPDATED`. Two further constraints shape the
v1 cut:

- **Not every field is a plain correction.** `litigation_position` feeds T3/court-facing exports and
  `jurisdiction.value` is venue/deadline/forms-bearing; both are legally load-bearing, not merely
  descriptive. `parties[]` are referenced by `case_box_claim_tracks` (reference integrity), and
  matter-level confidentiality has its own reason-gated path
  (`docs/adr/case-box-step-5-confidentiality-classification.md`, which excludes `target_type:"matter"`
  from `CaseBoxConfidentialityClassification`).
- **The audit event has no metadata column.** For a court-facing audit a reviewer must be able to see
  WHAT materially changed. Before/after payloads are not retained (only hashes), so "what changed"
  cannot be derived post-hoc, and the human `reason` must stay clean prose.

## Decision

1. **v1 editable set = exactly the 6 free-text descriptive fields (D1).** `name`, `retainer_scope`,
   `case_type_text`, `case_progress_text`, `court_contact_text`, `contention_summary_text`. Everything
   else is FROZEN for v1. Build an `updateMatterDetails`, NOT a generic row update.
   - **Deferred to their own later WIs:** `litigation_position` (court-facing exports consumer proof
     required); `jurisdiction.value` (its own ADR + locked/deadline/derived-lock invariants);
     `parties[]` (D2 — an assigned `party.id` is immutable once referenced; party editing waits on a
     claim-track reference-integrity policy + a party-change audit model); matter confidentiality (D3 —
     a future dedicated `updateMatterConfidentiality` + `MATTER_CONFIDENTIALITY_CHANGED`, never the
     generic edit).
   - **Frozen by product invariant:** `matter_type`, `parties[]`, `confidentiality_class`, the opt-in
     flags (external_ocr / sync / llm — dedicated authorize/revoke kinds already exist), `id` /
     `tenant_id` / `actor_user_id` / `created_at`, `status` / `archived_at` (lifecycle path only),
     `successor_matter_id`, `jurisdiction.locked`.

2. **Audit model — new kind `MATTER_DETAILS_UPDATED` (D4).** `{ action: "update", entity_type:
   "matter", reasonRequired: true }`. Persistence (Phase B) appends **one** event in the SAME
   transaction as the `payload_json` rewrite, computing `before_state_hash` (current stored payload) +
   `after_state_hash` (rewritten payload) + chaining `prev_event_hash` off the global audit head.
   `reasonRequired: true` because an edit is a deliberate correction whose rationale is court-facing.
   The kind is **specific**, not a generic `MATTER_UPDATED`: reusing `MATTER_ARCHIVED` or a flag kind
   would be semantically false. Additive (renames/removes/merges nothing; not the `OcrQueueError`
   boundary), so it is a governed high-risk contract change (ADR + cc-suite review-plan/audit/verify),
   matching the VS-0 `MATTER_PARTY_IDS_ASSIGNED`, PTA-03, and A3 `LINK_CREATED` precedents.

3. **Continuity against the latest prior MATTER event (D4a).** With child entities (claim tracks,
   deadlines, documents) now interleaving the chain, the fail-closed continuity check MUST verify the
   stored matter payload's hash against the latest prior `entity_type="matter" AND entity_id=matter.id`
   event's `after_state_hash` — NOT the global last event. Selection: that entity-scoped set ordered
   `sequence DESC`, read INSIDE the same write transaction that appends the new event + rewrites
   `payload_json`, under the append-only locking discipline. Fail-closed (refuse, no write) when: no
   prior matter event exists (a matter always has `MATTER_REGISTERED`, so absence = corruption); the
   prior event's `after_state_hash` is null/malformed; the stored payload's `entityStateHash` ≠ that
   prior `after_state_hash` (drift); any read/hash/compute error. The global chain rules
   (`prev_event_hash` off the global head; `event_count == COUNT(*) == MAX(sequence)`) still hold — D4a
   only changes which event supplies the *state-continuity* baseline. This is Phase B's obligation;
   Phase A only locks the rule.

4. **Structured, hashed `changed_fields` (D5a; review §3 resolved as option (b)).** The
   `MATTER_DETAILS_UPDATED` event carries a narrow structured `changed_fields: string[]` — sorted, values
   restricted to the 6 editable field paths, `minItems: 1`, `uniqueItems`. It is computed AFTER
   canonicalization over the editable allowlist only, and it **participates in the event hash**
   (tamper-evident). Rejected alternatives: (a) reason+hashes-only (a reviewer can't see WHAT changed);
   (c) JSON-in-reason (pollutes the court-facing human reason field, parsing ambiguity). It is NOT a
   generic unbounded metadata slot — the schema restricts `changed_fields` to `MATTER_DETAILS_UPDATED`
   and forbids it on every other kind (including legacy v1 events).

   Two Phase-A audit hardenings (`audit-msfu7fye-e6vlu9`): (i) **canonicalizer guard** — because the
   canonicalizer is itself a security boundary called directly by `eventHashFn`, it now THROWS if
   `changed_fields` is present on any non-`MATTER_DETAILS_UPDATED` event, so a schema-bypassing malformed
   event can never hash a smuggled field (byte-safe: only fires when the field is present). (ii) **canonical
   sorted order is a hard requirement, not a hint** — the v2 hash is order-sensitive, so `["name",…]` and a
   reordering of the same set hash differently. JSON Schema cannot enforce array sortedness, so the
   **Phase-B persistence emitter MUST emit `changed_fields` in ascending sorted order** (enforced + tested
   in Phase B); Phase A documents the requirement (schema description + this ADR) and tests the
   order-sensitivity so the reason for the emitter rule is recorded.

5. **Byte-preservation of every existing event hash (the #1 invariant).** The v2 canonicalizer includes
   `changed_fields` in the canonical object ONLY when `event.changed_fields !== undefined`, in its
   alphabetical slot (between `before_state_hash` and `entity_id`):
   `...(event.changed_fields !== undefined ? { changed_fields: event.changed_fields } : {})`. An event
   with NO `changed_fields` therefore produces a canonical string **byte-identical** to the pre-change
   v2 shape, so every existing event's hash — and thus the whole chain — is unchanged. Adding
   `changed_fields` unconditionally (with a null/default) would rewrite every existing v2 event's string
   and break verification; that is forbidden. The v1 (legacy) branch is untouched.

## Rejected alternatives (load-bearing)

- **A generic `MATTER_UPDATED` kind or generic row update.** Would let any matter column (including
  frozen/legally-load-bearing fields) change under one indistinct audit label. The v1 cut is a
  narrow, named, correctable-text edit precisely so the audit trail stays legible and the frozen fields
  stay frozen.
- **A generic metadata / `changed_fields` escape hatch on all kinds.** Rejected for the same reason as
  the migration-rewrite in the VS-0 party-identity ADR: an unbounded, unrestricted metadata slot on
  every kind invites drift and un-reviewable audit rows. `changed_fields` is per-kind-restricted and
  allowlisted.
- **Schema-allowance without extending the hasher.** The pre-change canonicalizer is fixed-field, so a
  schema allowance alone would leave `changed_fields` un-hashed and NOT tamper-evident — a court could
  not rely on it. Hence the conditional-spread hasher extension in Phase A (re-review clarification i).
- **Editing parties / confidentiality / litigation_position / jurisdiction in v1.** Each is deferred to
  its own WI with its own invariants (D2/D3 + review findings 1/2); folding them into the generic edit
  would smuggle legally load-bearing or reference-integrity changes past a descriptive-text audit model.

## Consequences

- **Phase A (this WI):** the additive `MATTER_DETAILS_UPDATED` kind + the narrow `changed_fields` land
  in the contract (schema enum + `changed_fields` property + per-kind conditional; `CASE_BOX_AUDIT_EVENT_KINDS`
  map; regenerated `src/generated/case-box-audit-event.ts`; hasher conditional-spread; tests). The
  schema-enum ↔ TS-map sync test enforces alignment; the byte-preservation tests pin that existing
  events hash unchanged.
- **Phase B (persistence):** `updateMatterDetails` + `prepareMatterDetailsUpdate` (in-memory + SQLite
  parity), D4a fail-closed continuity, strict D5 patch semantics (reject unknown/frozen keys —
  jurisdiction keys are simply REJECTED, no deadline-aware logic since `jurisdiction.value` is deferred;
  re-review clarification iii), canonicalize-before-no-op rejection, archived-reject, one event in
  transaction. Does not start until this ADR is merged (review finding 6).
- **Phase C (IPC) / Phase D (UI):** the `casebox:matter:updateDetails` channel + the `#/matters/:id/edit`
  route (UI gated on a design artifact).
- **Downstream desktop consumers** gain the new kind's i18n label when the contract tarball is
  republished — a separate step, per the VS-0 `MATTER_PARTY_IDS_ASSIGNED` publish precedent. Until then
  the desktop gate runs against the prior tarball and is unaffected by the new kind (its
  `Record<CaseBoxAuditEventKind, …>` map stays exhaustive over the prior union).
- **Later (separate features, NOT this vertical):** `updateMatterConfidentiality`; party management with
  claim-track reference integrity; `litigation_position` and `jurisdiction.value` edits.

## References
- `dev-memo/plan-matter-details-edit-00.md` (umbrella; D1/D2/D3/D4/D4a/D5/D5a), `dev-memo/plan-matter-details-edit-A-docket.md` (Phase-A docket).
- `docs/contracts/case-box-contract/src/audit-log.ts` (`CASE_BOX_AUDIT_EVENT_KINDS`, `canonicalAuditEventHashInput`, `verifyAuditChain`); `docs/contracts/case-box-contract/schemas/case-box-audit-event.schema.json`.
- `docs/adr/audit-event-kind-preservation.md` (v2 versioned, tamper-evident kind hashing — the canonicalization this ADR extends).
- `docs/adr/ADR-casebox-matter-party-identity.md` (VS-0 — additive matter audit kind + audited-mutation, no unaudited migration; publish precedent).
- `docs/adr/case-box-step-5-confidentiality-classification.md` (confidentiality has its own audited path; matter confidentiality is NOT the generic details edit).
- `AGENTS.md` §"Critical invariants" (append-only atomic audit chain; persistence = source of truth; stable `OcrQueueError` codes untouched).
