# PLAN — Matter-details edit, Phase A: ADR + contract (audit kind + changed_fields + hasher)

**Type:** SOURCE/contract WI (HIGH-RISK — audit-chain security boundary). **Status:** DRAFT. **Branch:**
`feature/pta-claimtrack-vertical-slice` (local; no push). **Parent (READY):** `dev-memo/plan-matter-details-edit-00.md`
(review-plan `review-plan-msftb3fh-am8xe6` READY; design already reviewed). **Atomic** per the sequencing consult
(Codex thread `019fd104`): ADR + vocabulary + changed_fields + hasher + tests move together.

## 1. Scope
Add the `MATTER_DETAILS_UPDATED` audit-event kind + a narrow structured `changed_fields` to the audit-event
contract, and extend the canonical hasher to cover `changed_fields` — WITHOUT changing any existing event's hash.
No persistence/IPC/UI (Phases B/C/D). Mirrors the VS-0 additive-kind precedent (`MATTER_PARTY_IDS_ASSIGNED`,
`9638278`).

### Target files
- **NEW `docs/adr/ADR-matter-details-edit-v1.md`** — the locked decision: v1 editable set = the 6 free-text fields
  (name, retainer_scope, case_type_text, case_progress_text, court_contact_text, contention_summary_text);
  litigation_position + jurisdiction.value + parties + confidentiality DEFERRED; the `MATTER_DETAILS_UPDATED` audit
  model; the D4a latest-prior-matter-event continuity rule; the D5a `changed_fields` decision (structured, hashed,
  per-kind-restricted). Cross-reference the parent plan + the confidentiality ADR + VS-0's party-identity ADR.
- `docs/contracts/case-box-contract/src/audit-log.ts` —
  - Add `MATTER_DETAILS_UPDATED: { action: "update", entity_type: "matter", reasonRequired: true }` to
    `CASE_BOX_AUDIT_EVENT_KINDS`.
  - **Extend `canonicalAuditEventHashInput` (v2 branch only)** to conditionally include `changed_fields` in the
    canonical object ONLY when `event.changed_fields !== undefined`, in its alphabetical slot (BETWEEN
    `before_state_hash` and `entity_id`): `...(event.changed_fields !== undefined ? { changed_fields: event.changed_fields } : {})`.
    **Do NOT add it unconditionally** (that would change every existing v2 event's canonical string → break the
    chain). The v1 (legacy) branch is UNTOUCHED.
- `docs/contracts/case-box-contract/schemas/case-box-audit-event.schema.json` —
  - Add `MATTER_DETAILS_UPDATED` to the `event_kind` enum.
  - Add optional `changed_fields`: `{ type: "array", items: { type: "string", enum: <the 6 editable field paths> },
    uniqueItems: true, minItems: 1 }`.
  - **Conditional restriction:** `changed_fields` is allowed ONLY on `event_kind === "MATTER_DETAILS_UPDATED"`;
    forbidden (via `if/then` or `not`) on every other kind (re-review clarification ii).
- `docs/contracts/case-box-contract/src/generated/case-box-audit-event.ts` — REGENERATE from the schema (the
  `AUTO-GENERATED` file; use the gen script, do not hand-edit).
- `docs/contracts/case-box-contract/tests/audit-event-kind-v2.test.mjs` (+ a focused new test file if cleaner) —
  see §2.

## 2. Acceptance criteria (tests)
1. **BYTE-PRESERVATION (the #1 invariant):** for every EXISTING event kind (no `changed_fields`),
   `canonicalAuditEventHashInput` returns a **byte-identical** string to before this WI — the pinned-exact-output /
   canonical-order test still passes unchanged; a v2 event without `changed_fields` hashes exactly as it did.
2. **Tamper-evidence:** a `MATTER_DETAILS_UPDATED` event WITH `changed_fields` includes it in the canonical string
   (in the correct alphabetical slot); two such events differing ONLY in `changed_fields` produce DIFFERENT hashes.
3. **Kind registration:** `MATTER_DETAILS_UPDATED` present in `CASE_BOX_AUDIT_EVENT_KINDS` with
   `{action:"update", entity_type:"matter", reasonRequired:true}`; the schema enum == the TS kinds keys (the
   existing schema↔TS sync test covers the new kind).
3. **Schema conditional:** the schema ACCEPTS `changed_fields` (valid allowlisted array) on a
   `MATTER_DETAILS_UPDATED` event and REJECTS it on any other kind; rejects non-allowlisted / empty / duplicate
   `changed_fields` values.
4. `reasonRequired:true` enforced for the new kind (mirrors existing reasonRequired tests); label coverage if the
   contract carries an event-kind label map.
5. `npm --prefix docs/contracts/case-box-contract test` all green (incl. verifyAuditChain consistency). No other
   package affected — but run `npm --prefix apps/lawbar-desktop test` too, since the desktop consumes the contract
   tarball's kind union (label/errormap exhaustiveness) — if the desktop's exhaustive-consumer maps break on the
   new kind, that is a Phase-A-adjacent catch-up (add the label), NOT scope creep; record it.

## 3. Governance + discipline
HIGH-RISK contract / audit-chain security boundary. Design is review-plan'd (parent READY) → Phase A =
test-first implement → `/cc-suite:audit` on the diff → `/cc-suite:verify`. **Fully-green-before-commit is
mandatory** (the sequencing-consult control): regenerate `src/generated/*` from schema, run BOTH package test
suites, run cc-suite audit+verify, `git diff --cached --name-only` exact-path check — ALL before the single commit,
so the batch audit finds nothing trivial. No push.

## 4. Stop condition
Superseded when Phase A is committed + verified. Phase B (persistence `updateMatterDetails`) opens next, gated on
this ADR being merged. Hard-stop if the byte-preservation invariant (AC 1) cannot hold — that means the hasher
change is wrong and must not ship.
