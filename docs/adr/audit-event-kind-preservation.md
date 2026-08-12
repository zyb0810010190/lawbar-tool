# ADR — Audit event `kind` preservation (tamper-evident, versioned canonicalization)

- **Status**: Proposed (pending cc-suite review-plan).
- **Date**: 2026-06-08.
- **Deciders**: lawbar-tool maintainer.
- **Batch**: `BATCH-CASEBOX-AUDIT-EVENT-KIND-ADR-00`, WI-AK1 (ADR-only; authorizes no implementation).
- **Relates to / extends**: `docs/adr/case-box-step-4-audit-log-shape.md` (audit-log shape + hash chain).
- **Scope note**: This ADR records a decision. It changes no schema, contract, persistence, IPC, DTO,
  renderer, or test file. Every code change it implies is deferred to a separately-governed,
  cc-suite-reviewed implementation batch, contract-first.

---

## 1. Context and the integrity problem

The CaseBox audit panel renders each event as raw `action · entity_type` — e.g. every deadline
status transition shows as **"update · deadline"**, indistinguishable between *met*, *missed*, and
*withdrawn*. The information to humanize the label is lost at persistence:

- The rich event **kind** (`CASE_BOX_AUDIT_EVENT_KINDS`, `docs/contracts/case-box-contract/src/audit-log.ts:72`)
  is a compile-time discriminator. `buildCaseBoxAuditEvent` (`audit-log.ts:328`, verified 2026-08-12)
  maps each kind to `{action, entity_type, reasonRequired}` and **discards the kind** — only
  `action` + `entity_type` reach the persisted event.
- Crucially, several kinds **collapse to the same persisted pair**. Verified:
  `DEADLINE_MET`, `DEADLINE_MISSED`, `DEADLINE_WITHDRAWN` are all
  `{action:"update", entity_type:"deadline", reasonRequired:false}`.
- The per-event hash (`canonicalAuditEventHashInput`, `audit-log.ts:217`, verified 2026-08-12) covers an explicit
  **12-field** allow-list: `action, actor_user_id, after_state_hash, before_state_hash, entity_id,
  entity_type, id, matter_id, prev_event_hash, reason, tenant_id, timestamp`. `verifyAuditChain`
  (`audit-log.ts:~310`) validates shape then recomputes each event's hash from that input and checks
  the `prev_event_hash` links. The exact canonical string is pinned by a golden test
  (`docs/contracts/case-box-contract/tests/audit-event-kind-v2.test.mjs:52`).

**The integrity problem.** If we preserve `event_kind` but leave it **outside** the hash, the audit
record becomes tamper-editable in exactly the dimension we are trying to surface. A direct edit of a
stored event's `event_kind` from `DEADLINE_MET` to `DEADLINE_MISSED` changes **none** of the 12
hashed fields (both kinds share `action:"update"`, `entity_type:"deadline"`), so the recomputed hash
still matches the stored `event_hash`, `verifyAuditChain` still **passes**, and yet the human-facing
legal meaning of the event has flipped from "the lawyer met this deadline" to "the lawyer missed
it." For a legal audit record this is unacceptable: the only durable carrier of the met/missed/
withdrawn distinction would be a field that verification does not protect.

A consistency rule (`event_kind` must agree with `action`/`entity_type`) does **not** close this gap,
because `DEADLINE_MET` and `DEADLINE_MISSED` are *both* consistent with `{update, deadline}`. The
distinction lives only in `event_kind`; therefore `event_kind` must participate in integrity.

This ADR supersedes an earlier draft direction (unhashed display metadata), which cc-suite
review-plan `review-plan-mq4v6gfn-cdy5f7` correctly flagged FAIL/BLOCK on this exact High finding.

## 2. Decision

1. Persist a normalized optional **`event_kind`** on audit events, valued by the existing
   `CASE_BOX_AUDIT_EVENT_KINDS` key (e.g. `"DEADLINE_MET"`). No new vocabulary is invented.
2. **`event_kind` participates in audit integrity for new-format events**: it is included in the
   canonical hash input of events that carry it.
3. The hash change is made by **versioned canonicalization**, never by mutating the existing
   (v1) hash format in place. Legacy events continue to verify byte-for-byte under v1; new events
   verify under v2. **Mixed old/new chains must verify** end to end.
4. `verifyAuditChain` selects the canonicalization version **per event** (see §3).
5. **Consistency invariant** (§4): a present `event_kind` must match its
   `{action, entity_type, reasonRequired}` metadata; enforced at build time and in tests.
6. Backward compatibility (§5): legacy rows have no `event_kind`, still verify under v1, and the
   renderer falls back to `action · entity_type`. **No backfill** of collided legacy rows.
7. **No SQLite indexed `event_kind` column** in the first implementation path — `event_json` already
   carries the field on read. A dedicated indexed column is deferred and separately governed (§6).

## 3. Versioned canonicalization design

### 3.1 v1 (legacy) — unchanged
`canonicalAuditEventHashInput_v1(event)` is **exactly** today's function: the 12-field alphabetical
object, identical bytes. The golden test (`audit-event-kind-v2.test.mjs:52`, "v1: canonicalAuditEventHashInput is byte-identical for legacy events") must remain **unchanged** —
that is the proof v1 is untouched. Every event written before the implementation ships is a v1 event
and verifies under v1 forever.

> **Line numbers re-derived 2026-08-12.** §1's anchors had drifted 6-112 lines since 2026-06-08
> and pointed at unrelated functions. All citations in this document are now verified against
> the current file.

### 3.2 v2 (kind-bearing) — additive
`canonicalAuditEventHashInput_v2(event)` extends the v1 object with the new integrity-bearing
field(s), in canonical (alphabetical) order:

- `audit_schema_version` (the integer `2`),
- `event_kind` (the normalized key),
- `changed_fields` — **conditional**, present only on `MATTER_DETAILS_UPDATED`; slots
  alphabetically between `before_state_hash` and `entity_id`,
- …plus the existing 12 v1 fields.

> **Amended 2026-08-12.** `changed_fields` was added to this canonical input by commit `a1b55f0`
> (2026-08-05, matter-details-edit Phase A) and was missing from this list for 58 days. It is a
> security-boundary field: `canonicalAuditEventHashInput` **throws** if `changed_fields` appears on
> any event whose kind is not `MATTER_DETAILS_UPDATED` (`docs/contracts/case-box-contract/src/audit-log.ts:228`),
> so a schema-bypassing malformed event cannot hash a smuggled value. Byte-preservation for existing
> events was proven in that commit, so chain integrity was never affected — the defect was
> documentary. A future v3 author reading §3.2 alone would have under-specified the serialization.

`event_hash = sha256(canonicalAuditEventHashInput_v2(event))` for new events. Because v2 is a
*different* serialization, a v2 event's hash is intrinsically different from what v1 would produce —
which is what makes downgrade tampering detectable (§3.4).

### 3.3 Version selection in `verifyAuditChain`
Version selection is governed by an **explicit field-pair rule**, not by a single field:

- An event with **both** `event_kind` **and** `audit_schema_version` present → verify under **v2**.
- An event with **neither** present → verify under **v1** (legacy).
- **Partial presence** (exactly one of the two) → **fail validation/verification.** A v2 event must
  carry both fields; a v1 event must carry neither. There is no valid event with only one, so partial
  presence is treated as a malformed/tampered row and rejected, removing any selection ambiguity.

The chain-linking logic is unchanged: versioning only changes *which canonical input* is fed to the
hash for a given event, so a chain that interleaves v1 (legacy) and v2 events verifies link-by-link
exactly as today.

### 3.4 Why this is tamper-evident (and downgrade-proof)
This rests on the **actual** verification model of `case-box-step-4-audit-log-shape.md`, which this
ADR must not overstate. `verifyAuditChain` (contract) walks the events in order, recomputes each
event's hash from its (version-selected) canonical input, and checks that each recomputed hash equals
the `prev_event_hash` recorded by its **successor** — i.e. integrity flows through the *chain links*,
not through trusting a row's own stored `event_hash` column. The persistence layer then cross-checks
the **computed head hash** of the final event against the persisted anchor
`case_box_audit_chain_heads.head_hash`. Tamper-evidence therefore comes from: (a) a changed event's
recomputed hash no longer matching its successor's `prev_event_hash` (breaking the chain), and/or
(b) the recomputed head no longer matching the stored head anchor.

Under that model, hashing `event_kind` in v2 yields:

- **Kind mutation** (`DEADLINE_MET`→`DEADLINE_MISSED`, both fields still present): the v2 recompute of
  that event changes → its successor's `prev_event_hash` link breaks (or, for the last event, the
  computed head ≠ stored head anchor) → **FAIL**.
- **Kind/version removal** (strip both fields to force v1 selection): the v1 recompute omits the kind
  → produces a different hash than the chain link/head anchor expect → **FAIL**.
- **Version downgrade** (`audit_schema_version` 2→1): partial presence is rejected by §3.3; and because
  the version field is *inside* the v2 hashed input, altering it changes the recompute → **FAIL**.
  (This answers "must the version field itself be hashed?" — **yes**, precisely to prevent downgrade.)

**Known limitation (inherited, stated honestly).** Like the existing chain, this scheme detects
*localized* edits but not a *full-chain rewrite*: an attacker with write access who re-emits every
event with recomputed hashes **and** rewrites the `case_box_audit_chain_heads.head_hash` anchor
produces an internally consistent forgery. Defense against full rewrite depends on an **external
witness** of the head hash (the assumption already documented in
`case-box-step-4-audit-log-shape.md`); hashing `event_kind` strictly *increases* what a localized edit
must change, but does not, by itself, defeat a wholesale rewrite. The implementation batch must not
claim otherwise.

### 3.5 Selection mechanism — recommendation
Two mechanisms were evaluated:

- **(A) Derived-from-presence** (no explicit field): select v2 iff `event_kind` is present. Sufficient
  and tamper-evident for the v1→v2 step on its own, with zero new fields, but it leaves nothing to
  disambiguate a future v3 (where both v2 and v3 would carry `event_kind`).
- **(B) Explicit, hashed `audit_schema_version`**: records the format number on the event and includes
  it in the v2 hash.

**Recommendation: adopt (B), with selection governed by the §3.3 field-pair rule.** An event is v2 iff
it carries **both** `event_kind` and `audit_schema_version` (both-absent ⟹ v1; partial ⟹ reject), and
the explicit `audit_schema_version` is **hashed in v2**. Rationale: the both-fields rule keeps v1↔v2
unambiguous today, while an explicit, hashed version field (i) makes the format self-describing for
auditors, and (ii) is the only safe discriminator for a future v3 (where presence of `event_kind`
alone no longer distinguishes formats). The version field **must** be in the hashed input (§3.4) so it
cannot be silently downgraded. The implementation must state, and test, that once the v2 builder
ships, **every** newly emitted event carries `event_kind` + `audit_schema_version=2`; the both-absent
state is the durable legacy (v1) marker, and partial presence is always a rejected/tampered row.

## 4. Consistency invariant

A present `event_kind` MUST equal a key of `CASE_BOX_AUDIT_EVENT_KINDS` whose metadata
`{action, entity_type, reasonRequired}` matches the event's persisted `action`, `entity_type`, and
reason-presence. Incoherent rows (e.g. `event_kind:"DEADLINE_MET"` with `entity_type:"document"`)
MUST be rejected:

- **Build time**: `buildCaseBoxAuditEvent` already derives `action`/`entity_type` *from* the kind, so
  setting `event_kind = kind` is automatically consistent; the builder must additionally assert the
  field it stamps equals the lookup key.
- **Validation/verify**: a consistency check (kind ⇒ expected action/entity_type) runs in schema
  validation and/or `verifyAuditChain`, and is covered by tests.

This invariant is necessary but **not sufficient** for tamper-evidence (met/missed share
action/entity_type, so both pass the consistency check) — which is exactly why §2.2/§3 hash the kind.
The two mechanisms are complementary: consistency rejects *incoherent* rows; hashing detects
*coherent-but-altered* rows within one `{action, entity_type}` class.

## 5. Backward compatibility

- Existing audit rows have no `event_kind` / `audit_schema_version`; they verify under v1 unchanged.
- **Collided legacy deadline rows cannot be backfilled.** The met/missed/withdrawn distinction was
  never persisted; reconstructing it would fabricate legal history. No backfill is permitted —
  legacy rows stay kind-less and verify as v1.
- The renderer must fall back to `action · entity_type` for any row without `event_kind` (and for any
  unknown/future kind it cannot map). Fallback must remain honest — never guess a transition kind.

## 6. Persistence implications

- `event_json` (the stored `JSON.stringify(event)`) carries `event_kind` + `audit_schema_version`
  automatically; `listAuditEventsSqlite` parses `event_json` with no read-time re-validation
  (`services/case-box-persistence/src/sqlite/auditRepoQueries.ts:101`). Therefore **no DDL/migration**
  is required for the read/display path.
- `eventHashFn` in persistence (`services/case-box-persistence/src/auditChain.ts`) reuses the
  contract's canonical-input function; once the contract ships v1/v2 selection, persistence inherits
  it verbatim — no persistence-side hash re-implementation.
- **No SQL-side filter/index on `event_kind` in the first path.** A dedicated, nullable indexed column
  (schema `V9` `ADD COLUMN`, no backfill) is **deferred** and requires its own ADR + security-WI loop
  (better-sqlite3 ABI), justified only if SQL-side filtering/search later needs it.

## 7. Contract / schema implications (for the implementation batch)

- Add an **optional** `event_kind` enum (the `CASE_BOX_AUDIT_EVENT_KINDS` keys) and an optional
  `audit_schema_version` to `docs/contracts/case-box-contract/schemas/case-box-audit-event.schema.json`.
  Because the schema is `additionalProperties:false` (`:83`), the fields MUST be declared before any
  event carries them — **contract-first ordering** is mandatory.
- Regenerate `src/generated/case-box-audit-event.ts` (auto-gen via `scripts/gen-types.mjs`).
- `buildCaseBoxAuditEvent` stops dropping the kind: it stamps `event_kind` + `audit_schema_version=2`.
- Add `canonicalAuditEventHashInput_v2` and version selection in `verifyAuditChain`; keep v1 and the
  golden test byte-identical.

## 8. Renderer implications (for a later UI batch)

- The renderer maps `event_kind` → a humanized label (e.g. `DEADLINE_MET` → "Deadline marked met"),
  with `action · entity_type` fallback for null/unknown kinds.
- That UI work is `Type: UI`, touches `renderer/*`, and therefore requires its own **design artifact**
  (the kind → label mapping table) per the path-based UI gate.

## 9. Alternatives rejected

- **Unhashed `event_kind` (display-only metadata)** — REJECTED. The audit meaning becomes
  tamper-editable while `verifyAuditChain` still passes (§1). This was the prior draft, blocked by
  review-plan `review-plan-mq4v6gfn-cdy5f7`.
- **Renderer-only derivation from existing fields** — REJECTED. `DEADLINE_MET/MISSED/WITHDRAWN`
  collapse to identical `{action, entity_type}` with empty `reason`; the distinction is unrecoverable
  after persistence.
- **Persist an English `display_label` string** — REJECTED. Bakes presentation/localization into the
  audit record, is non-normalized, and still needs the same integrity handling as a kind.
- **Add a SQLite indexed `event_kind` column now** — DEFERRED. Not needed for display (event_json
  carries it); a column is justified only for future SQL-side filtering and is separately governed.
- **Mutate the single v1 canonicalization in place to add `event_kind`** — REJECTED. It would change
  every legacy event's recomputed hash and break verification of all historical events; versioned
  canonicalization (§3) is required instead.

## 10. Test plan (for the implementation batch — not run in this ADR batch)

- The **golden v1** canonical-hash string remains **unchanged** (`audit-event-kind-v2.test.mjs:52`).
- A **v2** canonical-hash test pins the new string and asserts `event_kind` + `audit_schema_version`
  are included.
- **Tampering `event_kind`** on a v2 event (within the same action/entity_type) breaks verification.
- **Stripping** `event_kind`/`audit_schema_version` (downgrade attempt) breaks verification.
- **Partial presence** (exactly one of `event_kind` / `audit_schema_version`) is rejected by
  validation/verification (the §3.3 field-pair rule).
- **Changing `audit_schema_version`** breaks verification (version is hashed).
- An `event_kind` **inconsistent** with `action`/`entity_type` is rejected by validation/verify.
- A **mixed** chain (v1 legacy events followed by v2 events) verifies end to end.
- Persistence conformance: `event_json` round-trips `event_kind`; legacy null-kind rows still verify;
  the `event_count == COUNT(*) == MAX(sequence)` invariant is unaffected.
- Desktop DTO/projection: `event_kind` is projected to the renderer DTO with no authority-field leak
  (it is emitter-chosen, not server-authority).
- Renderer: kinded rows render humanized labels; null/unknown rows render `action · entity_type`.

## 11. Hard stops

- **Do not mutate the v1 hash format in place.** Any hash change is via versioned canonicalization
  preserving v1 verification (and the v1 golden test).
- **The `audit_schema_version` (version marker) must be inside the v2 hashed input** — never an
  unhashed selector that could be downgraded.
- **Do not fabricate backfill** for legacy collided events.
- **Do not add a SQL column/index** for `event_kind` in the first path without separate governance
  (ADR + security-WI loop + ABI).
- **Do not implement** any of §7/§8/§10 in this ADR batch — implementation begins only after this ADR
  is accepted (cc-suite review-plan READY) and its own batch is governed.

## Consequences

- **Positive**: the met/missed/withdrawn (and docket/fact/document) distinction becomes durable and
  tamper-evident; humanized audit labels become possible without weakening the chain; legacy history
  is preserved and still verifies; no migration for the first path.
- **Negative / cost**: a second canonicalization format and version-selection logic add complexity to
  `verifyAuditChain`; the implementation is a high-risk contract + hash-chain change requiring the
  full security-WI loop (plan-review → tests-first → implement → audit → verify → sign-off).
- **Follow-up**: contract WI (schema + builder + v2 canonicalization + tests) → persistence
  conformance WI → DTO/projection WI → UI WI (with design artifact). The indexed-column option remains
  a separately-governed, deferred enhancement.
