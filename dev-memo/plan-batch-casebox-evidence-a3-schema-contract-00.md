# BATCH-CASEBOX-EVIDENCE-A3-SCHEMA-CONTRACT-00 (plan — proposal)

**Status**: proposal plan (the governed `dev-memo/run/queue.md` is the authority). Proposes the A3 schema
implementation WI sequence; does NOT authorize execution. Each WI is separately authored into `queue.md`,
governed, and (where it touches persistence) A0.7-gated before it runs.
**Date**: 2026-06-23. **Type**: PLAN (design / sequencing).
**ADR**: `docs/adr/ADR-evidence-a3-schema-persistence-contract.md` (A3-SCHEMA-00). Read it first.

## 0. Purpose & scope cut

Sequence the A3 anchor/link **persistence** implementation after the merged A3 contract (A3-CONTRACT-00) +
A3-T2 math. Define the implementation WIs, which one may touch persistence (all of §2 do; the schema WI is
first), the test fixtures/strategy, and the A0.7-dependence. **This plan writes no code, schema, migration, or
dependency.**

Explicitly NOT here: schema/migration code; the storage-engine (SQLite/GRDB/SQLCipher) dependency choice
(a future hard-stop WI); resolver/status-transition logic; export degradation; UI; the anchor-delete cascade
policy (UNRESOLVED — A3-SCHEMA-00 decision 5).

## 1. A0.7-dependence (binding on every persistence WI below)

Every A3 schema/persistence implementation WI is A0.7-DEPENDENT: it MUST carry `Requires-A07: yes` in its
governed queue block and run under custody mode 9b (human-run gated `check-gates` with the HMAC key; agent
never receives the key; impl commit blocked until the human reports gated PASS; marker local-only/gitignored;
key env-only). A3-T1-DESIGN (this ADR + plan) is the only A3-T1 WI that is NOT gated.

## 2. Proposed implementation WI sequence

```
WI-A3-T1-IMPL  IMPL   Anchor + Link SCHEMA only (per A3-SCHEMA-00 §3): tables + constraints —
                      Anchor(documentId,physicalPageIndex FK->DocumentPage; geometryCapturedAt NOT NULL FK;
                      rectX/Y/Width/Height as canonical 12-dp TEXT; pageRotation; NO viewport/REAL coords),
                      Link(sourceType CHECK; sourceId; anchorId FK->Anchor; status CHECK IN
                      valid|needs_review|broken, NOT NULL, NO DEFAULT). NO resolver, NO status-transition
                      logic, NO UI/product, NO ON DELETE cascade. A0.7-GATED. HIGH-RISK: persistence +
                      migration + the storage-engine dependency decision are autonomy hard stops handled in
                      this WI's own authorization (the engine choice may be split out first). Verify: schema
                      asserts + migrate+assert-constraints. Depends: A3-T1-DESIGN (this ADR), A3-T2 (merged).

WI-A3-T5       IMPL   Resolver + status transitions: compute LinkStatus from (anchor.geometryCapturedAt vs
                      current DocumentPageGeometry version) + Document.status + target existence. Mismatch /
                      replaced/superseded -> needs_review; missing target -> broken; never silently valid.
                      A0.7-GATED. Verify: resolve-links. Depends: A3-T1-IMPL.

WI-A3-export   IMPL   Export degradation: in-app link -> textual 卷X页Y or an ExportCitationFlag (A10-T2
                      bijection; never dropped/silently wrong). A0.7-GATED. Depends: A3-T5.

WI-A3-T6       IMPL   Mutation / cascade — STOPS-AND-ASKS for the anchor-delete cascade policy (UNRESOLVED;
                      A3-SCHEMA-00 decision 5 / A3-CONTRACT-00 decision 9) before coding it. A0.7-GATED.
                      Depends: A3-T5.
```

**Sequencing note**: schema-only first (no transitions baked into the physical shape), then resolver/status,
then export, with mutation/cascade gated on a human policy decision. The storage-engine + any
numeric-decimal-storage option is decided against the real engine in A3-T1-IMPL's authorization (or a split
dependency WI), never assumed here.

## 3. Test strategy / fixtures (A3-SCHEMA-00 decision 8)

The schema WI's tests MUST prove:
- **Byte-stable ratio storage**: store an A3-T2 canonical `page_ratio` (e.g. `"0.250000000000"`), read it
  back, assert byte-identical — no re-rounding, no float drift.
- **Provenance required**: inserting an anchor with NULL/absent `geometryCapturedAt` fails (NOT NULL + FK);
  invalid/absent geometry provenance cannot create a persisted anchor.
- **No implicit valid**: `Link.status` has no `DEFAULT 'valid'`; the CHECK enforces `{valid,needs_review,
  broken}`; a row without an explicit status fails.
- **No-stale-valid (A3-T5 WI)**: after a geometry-version bump or `Document.status` leaving `canonical`, the
  affected links resolve to `needs_review`, never `valid`.
- **No evidence in commits**: the WI's commit contains no marker/ledger/key/evidence-run file
  (`dev-memo/run/evidence/**` stays gitignored/local-only).

Fixtures are synthetic (no client-confidential PDFs), authored in the impl WI.

## 4. Verification (this design PR)

Docs-only (ADR + this plan); changes no source. Real commands:
- `scripts/workflow/check-contract-integrity.sh`
- `scripts/workflow/check-gates.sh` (A0.7 gate not required — queue has no Requires-A07, no markers)
- `npm --prefix apps/lawbar-desktop test`
- `npm --prefix native/evidence-core test` (A3-T2 stays green)

## 5. Stop condition

"Done" when the ADR + this plan are committed (WI-A3-T1-DESIGN). "Outdated" when its §2 WIs are promoted into
`queue.md` and governed, or when A3-SCHEMA-00 is superseded.

## References
- `docs/adr/ADR-evidence-a3-schema-persistence-contract.md` (A3-SCHEMA-00).
- `docs/adr/ADR-evidence-a3-anchor-link-contract.md` (A3-CONTRACT-00),
  `docs/adr/ADR-evidence-a07-key-custody-operating-model.md` (A07-KEY-00).
- `native/evidence-core/lib/page-ratio.mjs` (A3-T2). `Evidence-Genie-M0-Developer-Handover.md` §10/§11.
