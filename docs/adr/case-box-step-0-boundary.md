# ADR: Case-Box Step 0 — Product Boundary

## Status

**Accepted** — 2026-05-20. Promoted from the pre-Phase-0 plan at `dev-memo/case-box-plan.md` (archived under `dev-memo/superseded/case-box-plan.md` in the same commit as this ADR; tracked content is authoritative; the archived dev-memo is historical reference only).

This ADR fixes the case-box product boundary, its relationship to the OCR pipeline, and the v1 confidentiality / multi-user posture. It is the Step-0 of the case-box ADR series (`case-box-step-1-*` through `case-box-step-8-*` are future ADRs per the phasing recorded here).

This ADR does NOT authorize implementation. It does NOT introduce code, dependencies, schemas, or contract changes.

## Context

The repository today ships a four-package OCR pipeline (contract + worker + persistence + ingestion + review). UI-00 (`docs/ui/ui-gap-report.md`) inferred a seven-screen surface (S1–S7) derived from the OCR contract and read-model. PLAN-CLIENT-00 (`dev-memo/plan-client-00.md`, commit `a07e5d1`) locked the v1 client as a Mac desktop application with local-first data residency, splitting the gateway decision into `docs/adr/client-application-surface.md` and `docs/adr/sync-bridge-architecture.md` (commit `cc2071e`).

The OCR pipeline is **a subordinate data feed**, not the v1 product. The lawyer-facing product is a **case box**: a matter-level workspace for facts, issues, claims, elements, evidence, deadlines, privilege markers, risks, next actions, and an append-only audit log. OCR exists to turn scanned legal documents into searchable text that the case box can reference; the lawyer's daily work happens at the case level, not the OCR-job level.

The pre-Phase-0 plan defined the case-box boundary, data model, MVP vertical slice, and ADR list. This Step-0 ADR promotes the boundary and confidentiality decisions to tracked authoritative form so the local-first Mac app product direction no longer depends on an untracked dev-memo.

Adjacent state that this ADR aligns with:

- `docs/adr/client-application-surface.md` — v1 primary client = Mac desktop, in-process embedding, zero default network surface.
- `docs/adr/sync-bridge-architecture.md` — opt-in narrow companion HTTP bridge, off by default, post-v1.
- `docs/release/wi-03-security-signoff.md` — outbound HTTPS / SSRF / DNS-pinning sign-off (worker only). Unchanged by this ADR.
- `AGENTS.md` — coordinator-ownership rule, Stop-and-Ask gates, mutation policy.

## Decision

Adopt the following case-box product boundary as authoritative for v1:

### 1. Case-box is a new sibling boundary, parallel to the OCR pipeline

Create new packages alongside `services/ocr-*`:

```
docs/contracts/
  ocr-worker-contract/         (existing — unchanged)
  case-box-contract/           (NEW — schemas, state machines, validators)
services/
  ocr-worker/                  (existing — unchanged)
  ocr-persistence/             (existing — unchanged)
  ocr-ingestion/               (existing — unchanged)
  ocr-review/                  (existing — unchanged)
  case-box-persistence/        (NEW)
  case-box-ingestion/          (NEW)
  case-box-review/             (NEW)
```

### 2. Dependency direction is one-way; OCR knows nothing about case-box

```
case-box-review        ─→  case-box-persistence  ─→  case-box-contract
case-box-ingestion     ─→  case-box-persistence
case-box-ingestion     ─→  ocr-ingestion          (drive OCR submissions)
case-box-persistence   ─→  ocr-persistence       (READ-ONLY)
case-box-contract      ─→  ocr-worker-contract   (vocab reference for ocr_job_id, status enums)
ocr-*                  ─→  case-box-*            FORBIDDEN
```

OCR is a subordinate data feed: the case box consumes OCR results and OCR-job status snapshots. The OCR pipeline never references case-box concepts. `ocr-worker-contract` is NOT modified to add legal concepts; legal vocabulary grows `case-box-contract` instead.

### 3. OCR is a subordinate data feed into case-box documents, not the whole product UI

The seven UI-00 surfaces (S1–S7) describe the **OCR layer**, not the v1 product. The v1 product UI is matter-level: case list, document index per case, chronology, proof matrix, privilege log, deadline calendar, risk register, audit trail. OCR state surfaces (S2 job list, S3 job detail, S4 per-page review, S5 manual-review worklist, S6 cancel) appear inside the case box as document-status surfaces, not as the top-level product navigation.

The OCR surfaces remain valid as a delivery target; they are no longer the product framing.

### 4. Local-first is the default, no exceptions for the v1 lawyer workflow

The default data residency is **local on the lawyer's Mac**:

- SQLite under a user-controlled path (default `~/Library/Application Support/lawbar/`).
- Document storage as files on local disk, identified by `content_hash`; SQLite stores metadata only. Encryption-at-rest is deferred (v1 relies on macOS FileVault); per-document encryption is a follow-up decision.
- OCR runs locally via the existing `paddleocr-onnx` engine when invoked from the desktop app.
- Audit log in a separate SQLite file with hash chain, also under the user-controlled path.

No network egress is required for the lawyer's daily workflow. The desktop app's in-process embedding (`docs/adr/client-application-surface.md`) preserves this property.

### 5. Cloud / external OCR / LLM extraction are opt-in, not default

Three opt-in surfaces are explicitly recognized:

- **External OCR worker.** The default OCR engine is local. A future worker variant MAY run remotely; using it requires per-document opt-in (the user explicitly authorizes the external worker for that document). Inherits `case-box-plan.md` cross-cutting invariant #4: "documents never leave local storage unless `confidentiality_class = normal` AND user explicitly authorized external worker for that doc."
- **Cloud sync / sync-bridge target.** Per-document and per-matter opt-in via the sync grant table introduced by `docs/adr/sync-bridge-architecture.md` SYNC-01. Bridge is off until grant exists. No default-on cloud, no per-account global cloud, no automatic backup.
- **LLM candidate-fact extraction.** Feature-flagged off by default. Per-case opt-in. LLM output always lands as `draft_status = candidate`; lawyer promotion is the only path to `accepted`. The deterministic stub extractor is the MVP default.

All three opt-ins are recorded as audit events. Revoking any opt-in is a separate audit event.

### 6. `tenant_id` retained for forward compatibility

Every case-box persistence row carries `tenant_id`. v1 ships single-user single-tenant. The field is present so single-firm-multi-user (future near-term) and multi-firm-SaaS (NOT v1) can land without a data-shape migration. v1 reads and writes use a single retained tenant id; cross-tenant queries are not implemented in v1.

### 7. `actor_user_id = "local-user"` is allowed only for local-only v1

The persistence layer records `actor_user_id` on every SoT row and every audit event. v1 ships with the constant `actor_user_id = "local-user"`. This is acceptable **only** while:

- the workflow is entirely local on the lawyer's Mac;
- no sync bridge is enabled;
- no LLM extractor with remote calls is enabled;
- no multi-user write path exists.

The instant any of those preconditions changes (sync bridge ships, multi-user phase lands, LLM remote call is enabled), `actor_user_id = "local-user"` is no longer valid and a real principal must be threaded through.

### 8. Auth provider deferred

No auth provider is chosen. The auth-provider Stop-and-Ask gate (per `AGENTS.md`) stays open until any of the following lands: sync bridge ships, single-firm-multi-user phase begins, WeChat mini-program ships, LLM extractor with authenticated remote calls is enabled. The case-box data shape is forward-compatible (carries `tenant_id` and `actor_user_id` on every row) so no schema migration is required when an auth provider is chosen.

## Why this boundary, and not a larger ocr-review

`case-box-plan.md` D3 articulated five reasons to keep case-box separate from `ocr-review`. Captured here authoritatively:

1. **Different vocabulary.** `ocr-review`'s domain is per-job OCR state surfaced for a lawyer reviewer. Case-box's domain is matter-level legal artifacts: facts, issues, evidence, claims, deadlines, privilege. Collapsing both into one package destroys two distinct ubiquitous languages.
2. **Different source-of-truth.** `ocr-review` is a derived read-model over `ocr-persistence`; it is stateless. `case-box-review` derives from `case-box-persistence`, which has its OWN writes (accepted facts, deadlines, privilege markers, evidence citations). Two source-of-truths cannot share a "review" package without violating the existing repo invariant that review is read-model-only.
3. **Step-8B is OCR cross-job aggregation, not legal aggregation.** Treating "cross-job in 8B" as a license to put fact-extraction into `ocr-review` confuses transport concerns (multiple OCR jobs surfaced in one view) with domain concerns (legal facts derived across documents).
4. **Test isolation.** OCR-state tests should not depend on claim/element/evidence fixtures, and vice versa.
5. **Failure-mode isolation.** A bug in case-box logic must not corrupt `ocr-review`, and vice versa.

## Cross-boundary rules (mirror existing repo invariants)

- **No DB-level FK from case-box tables to OCR tables.** Mirrors the existing "No FK from queue rows to ocr_jobs" invariant from `AGENTS.md`.
- **OCR references by value only.** Case-box references OCR jobs by `ocr_job_id` value; `ocr_job_link` is a Derived snapshot of OCR state, never a write.
- **Verbatim OCR error codes when surfaced.** Case-box must not collapse OCR `OcrQueueError` codes (`dedupe_conflict`, `unknown_receipt`, `stale_receipt`, `lease_expired`, `invalid_claim`); when surfaced, they are surfaced exactly. Matches `docs/adr/client-application-surface.md` IPC-layer rule and `docs/adr/sync-bridge-architecture.md` bridge-layer rule.
- **Case-box owns its own state machines.** Never reuse OCR state machines for legal artifacts; never extend `ocr-worker-contract` with legal concepts.
- **Coordinator ownership rule preserved.** Any case-box write that drives OCR (e.g. `submitDocumentForOcr`) goes through `ocr-ingestion`'s `ingestDocumentForOcr`, which goes through `OcrProcessingCoordinator`. Case-box never writes to `ocr-persistence` directly.
- **WI-03 SSRF posture preserved.** The OCR worker's outbound HTTPS fetcher retains its DNS-pinning / `allowedAddresses` discipline unchanged. Case-box does not add any new outbound network surface.

## ADR series phasing (case-box-step-1 through case-box-step-8)

This Step-0 ADR is the boundary decision. The remaining ADRs in the case-box series are sketched here so future WIs have a known target; none of them are authorized for implementation by this ADR.

| ADR | Subject |
|---|---|
| `case-box-step-0-boundary.md` (this ADR) | Product boundary, dependency direction, local-first default, opt-in policy. |
| `case-box-step-1-contract-vocabulary.md` | What `case-box-contract` owns vs `ocr-worker-contract`. Entity list, state machines, controlled vocab. |
| `case-box-step-2-fact-promotion-and-provenance.md` | `candidate → reviewed → accepted | rejected`, supersedes chain, LLM provenance fields, no auto-accept. |
| `case-box-step-3-privilege-marker-model.md` | Doc-level vs page-range markers, waiver one-way, privilege log export, default = unmarked (NOT privileged). |
| `case-box-step-4-audit-log-append-only.md` | Separate SQLite store, hash chain, no UPDATE / DELETE, replay-tamper-detection. |
| `case-box-step-5-confidentiality-no-cloud-default.md` | Local-by-default, opt-in per doc / matter, sync-bridge alignment, external-worker authorization. |
| `case-box-step-6-deadline-declarative-rules.md` | No hardcoded date math; jurisdiction-keyed rules registry; recompute discipline; `case.jurisdiction` immutable after first deadline. |
| `case-box-step-7-multi-user-readiness.md` | `actor_user_id` from day 1; auth deferred; data shape forward-compatible. |
| `case-box-step-8-llm-extractor-policy.md` | Pluggable extractor interface; candidate-only output; per-case opt-in; no PII leakage; feature-flagged off by default. |

## MVP-1 scope (recorded; not authorized)

`case-box-plan.md` D7 phasing for MVP-1 (Phases 0–6):

| Phase | Scope |
|---|---|
| 0 | ADR Step-0 (this) + Step-1 boundary + vocabulary committed. |
| 1 | `case-box-contract`: schemas, state machines, validators, generated types. |
| 2 | `case-box-persistence`: in-memory + SQLite conformance, replay-safe writers, audit hash chain. |
| 3 | `case-box-ingestion`: case-create, document-upload, OCR submission via `ocr-ingestion`, `ocr_job_link` sync. |
| 4 | Candidate-fact stub extractor (deterministic; pluggable for future LLM). |
| 5 | `case-box-review`: chronology, proof_matrix, document_index, privilege_log. |
| 6 | Privilege markers + audit + export hooks fully wired. |
| 7 (post-MVP) | Deadline declarative-rules engine. |
| 8 (post-MVP) | LLM extractor (feature-flagged, opt-in per case). |
| 9 (post-MVP) | Multi-user auth boundary. |

MVP-1 = Phases 0–6 (default; confirm at the next authorization gate). Phases 7–9 are post-MVP.

## MVP-1 acceptance gates (recorded; not authorized)

- All package tests green: contract, persistence (in-mem + sqlite), ingestion, review, cross-package E2E.
- Audit hash-chain replay test passes against a tampered DB and detects the tamper.
- Privilege log export round-trips a fixture case without leaking unmarked-but-privileged docs (test fixture explicitly covers the "default = unmarked" hazard).
- Vertical-slice script runs end-to-end against a fake-worker fixture and produces non-empty proof matrix + privilege log + audit trail.
- ADRs Step-0 through Step-4 committed; Steps 5–8 stubbed with status `pending`.

## Consequences

### Positive

- The v1 product is recorded as the **case box**, not the OCR pipeline. UI work prioritizes matter-level navigation, not OCR-job-level navigation.
- Local-first default protects lawyer confidentiality at the architecture level. Cloud / external OCR / LLM extraction become explicit deliberate acts, not silent defaults.
- Dependency direction is one-way; the OCR pipeline remains independently testable and shippable without the case box.
- `tenant_id` and `actor_user_id` in the data shape preserve every realistic forward path (single-firm-multi-user, multi-firm-SaaS) without a v1 schema migration.
- Audit log with hash chain provides tamper-evident history from day one — important for legal-document workflows.

### Negative

- Adds three new packages (`case-box-contract`, `case-box-persistence`, `case-box-review`) and likely a fourth (`case-box-ingestion`) before any new lawyer-facing feature ships. Architectural investment must precede feature delivery.
- Privilege-marker default = unmarked (NOT privileged) is the safer legal posture but requires UI affordances that surface this clearly to the lawyer so they do not assume "no marker" means "privileged".
- Deadline engine is post-MVP; v1 ships without automated deadline computation. Lawyers must enter deadlines manually until Step-6 lands.

### Neutral

- The OCR pipeline is unchanged. Existing per-package tests stay green.
- `docs/adr/client-application-surface.md` and `docs/adr/sync-bridge-architecture.md` are unchanged; case-box rides on top of them.

## Confidentiality posture summary

Recorded here for reference; the full version lives in the forthcoming `case-box-step-5-confidentiality-no-cloud-default.md`.

1. Default: documents do not leave local storage.
2. Per-document opt-in is required for ANY external surfacing (external OCR worker, sync bridge, cloud sync target, LLM extractor with remote call).
3. Opt-in requires `confidentiality_class = normal` AND an explicit per-document or per-matter user action. Documents marked `heightened` or `sealed` cannot be opted-in to external workers without an additional override decision (out of scope for v1).
4. Privilege markers default to absent = unmarked (NOT privileged). Lawyer must explicitly mark privileged documents; UI must surface this default clearly.
5. Every opt-in, opt-out, and external transmission produces an audit event.

## Multi-user readiness summary

Recorded here for reference; the full version lives in the forthcoming `case-box-step-7-multi-user-readiness.md`.

1. Every SoT row carries `actor_user_id`. v1 = constant `"local-user"`.
2. Every audit event carries `actor_user_id`.
3. `tenant_id` carried by every row. v1 = single retained tenant.
4. No auth provider is chosen; the data shape is forward-compatible so any future provider can populate `actor_user_id` and `tenant_id` without migration.
5. The v1 IPC layer (`docs/adr/client-application-surface.md`) trusts the OS to identify the lawyer; multi-user lands when sync bridge or single-firm-multi-user is authorized.

## Non-goals

This ADR does NOT:

- Implement any case-box code.
- Authorize any future case-box ADR (Steps 1–8 are sketched, not approved).
- Choose a desktop-shell framework (Electron / Tauri / native) — that is `docs/adr/client-application-surface.md` CLIENT-01.
- Choose a renderer UI framework — CLIENT-02.
- Choose an auth provider.
- Choose a cloud storage backend.
- Choose an LLM provider.
- Design any specific UI screen.
- Add a runtime dependency.
- Modify any existing package's exports, types, schemas, or persistence behavior.
- Decide deployment topology.
- Specify deadline computation rules, privilege-log export format, or audit-log retention values.

## Open questions deliberately deferred

Inherited from `case-box-plan.md` "Open decisions" §pre-Phase-0 and recorded here for the next authorization gate:

1. **MVP-1 scope confirmation.** Default proposal: Phases 0–6. Confirm or extend to Phase 7 (deadline engine) at the next gate.
2. **Document storage path default.** Default proposal: `~/Library/Application Support/lawbar/`. Confirm at the case-box-ingestion implementation WI.
3. **Encryption at rest.** Default proposal: v1 relies on FileVault; per-document encryption deferred to a post-MVP ADR. Confirm or override.
4. **Document storage shape.** Default proposal: filesystem with `content_hash`, SQLite stores metadata only. Confirm.
5. **LLM extractor default.** Default proposal: feature-flagged off; opt-in per case; deterministic stub is the MVP default extractor. Confirm.
6. **Auth deferral for MVP-1.** Default proposal: ship MVP-1 with `actor_user_id = "local-user"` so long as no sync bridge / LLM remote call / multi-user phase is enabled. Confirm.

## Addendum (WI-brief-matter-type, 2026-05-22) — R-5 additive contract surface

The project-requirements-brief (`docs/product/project-requirements-brief.md`, status `READY`, commit `fe09ea4`) reconciles two lawyer-facing workflow categories (litigation, counsel) against the existing `matter_type` enum and adds optional fields across matter / document / fact / evidence / docket-entry / deadline schemas. The detailed additions are in `dev-memo/plan-brief-matter-type.md` §3 and §4, cc-suite-reviewed at jobIds `review-plan-mpgi330d-48grud` and `review-plan-mpgiamit-mgk1j7`.

Summary of additions (all optional fields or additive enum values; no existing fixture invalidated):

- **Matter** — `successor_matter_id` (R-5(h)); `case_type_text`, `case_progress_text`, `court_contact_text`, `contention_summary_text` (R-5(j), litigation-facing free text).
- **Document** — `purpose` enum (R-5(a)); `work_order_status` enum with one-way invariant "if present, purpose='work_order'" (R-5(b)); `supersedes_document_id` ULID (R-5(d)); six free-text lifecycle fields (R-5(c)).
- **Fact** — `purpose` enum (R-5(e)); `as_of_date` date-only with conditional "non-null when purpose='timeline_event'" (R-5(f)).
- **Evidence-item** — `party_side` enum (R-5(g)).
- **Docket-entry + Deadline** — `kind` vocabulary extended with `payment`, `evidence_submission`, `appeal` (R-5(i); `hearing` was already present).

Cross-row invariants (INV-4, INV-5) are validator-layer helpers in `src/matter-type-invariants.ts` (`assertValidDocumentSupersession`, `assertValidMatterSuccessor`); persistence-layer enforcement is deferred to a follow-up WI per the brief's §10.1 hard release-gate.

The v1 entity list above is extended only by the optional-field additions; no new top-level entity is introduced by this WI.

## Addendum (WI-brief-doc-reconcile, 2026-05-22) — Original-file retention + OCR/text-extraction split + LLM indefinite postponement

The project-requirements-brief (`docs/product/project-requirements-brief.md`, status `READY`, commit `fe09ea4`) and the reviewed plan at `dev-memo/plan-brief-doc-reconcile.md` (READY at jobId `review-plan-mpgknx49-ywpiv4`) tighten three Step-0 commitments:

### Original-file retention (R-7) — promoted to load-bearing v1 cross-cutting invariant

Add to the §"Cross-cutting Invariants" effective for v1 (recorded inline here because Step-0 has no separate Cross-cutting Invariants section heading — the closest analogue is §"Confidentiality posture summary" + §"Multi-user readiness summary" + the §"Decision" body itself; the invariant is stated here as a Step-0 addendum and mirrored in `docs/product/product-target-architecture.md` §"Cross-cutting Invariants (always-true, v1)" item 11):

> **Original-file retention.** Every ingested file (Mac picker / URL / future WeChat upload / future scanner) is preserved verbatim, content-hash-addressed at a known `storage_uri`, and openable from the Mac desktop process. No extraction step (OCR, text-extraction, redaction, etc.) destroys or replaces the original. Extraction artifacts (OCR text, parsed Word, Markdown structure) are stored alongside, never in place of, the original.

This is a clarification of Step-0 §4 ("Document storage as files on local disk, identified by `content_hash`"); no new state machine, actor model, or enforcement layer is introduced. If a future architectural change makes original-file retention enforceable (write-once filesystem layer, hash-chain over file modifications, per-asset encryption), THAT change deserves its own ADR.

### OCR vs text-extraction split (R-6)

Step-0 §5 referenced "external OCR worker" + "LLM extraction" as opt-in surfaces. Add a third surface clarification:

- **OCR (v1 day-one)**: `paddleocr-onnx` local engine applies to **scanned/image PDFs and image files / screenshots only**.
- **Document text extraction (post-v1, non-OCR)**: PDF text-layer / Word / MD / other office formats are accepted for retention only. Lawyer recourse for searchable text in v1 is the manual-paste fallback (lawyer types/pastes text into `CaseBoxDocument.manual_extracted_text` once that field lands via WI-brief-doc-asset-impl). The engine + dispatch policy (including text-layer detection in PDFs + multi-artifact-per-document model) is the post-v1 STOP-AND-ASK ADR `case-box-text-extraction-policy.md` (WI-brief-doc-text-extract-policy).
- Both pipelines are subordinate data feeds per §3; case-box never FKs into either.

### LLM extraction (R-8) — indefinitely postponed

Step-0 §5 ("LLM candidate-fact extraction. Feature-flagged off by default. Per-case opt-in.") is tightened: LLM extraction is **indefinitely postponed** under the current brief. The Step-8 LLM-extractor-policy ADR (`docs/adr/case-box-step-8-llm-extractor-policy.md`) remains as **future policy only** — it would apply IF LLM enablement were ever explicitly re-authorized. v1 ships with the deterministic stub extractor; no LLM remote-call seam is wired. Step-7 multi-user-readiness preconditions (no LLM remote enabled) therefore hold trivially under v1.

This addendum does NOT modify the Step-8 ADR body (which is already correctly framed as policy-only). It records the demotion at the Step-0 framing level so future implementers do not interpret §5 as "LLM is a near-future opt-in".

## References

- `dev-memo/superseded/case-box-plan.md` — historical source (archived from `dev-memo/case-box-plan.md` in the same commit as this ADR).
- `dev-memo/plan-brief-matter-type.md` — WI-brief-matter-type plan (READY).
- `docs/product/project-requirements-brief.md` — project-level intake; R-5 is the source of the matter-type addendum; R-6/R-7/R-8 are the source of the doc-reconcile addendum.
- `dev-memo/plan-brief-doc-reconcile.md` — WI-brief-doc-reconcile plan (READY).
- `dev-memo/plan-client-00.md` — client surface reconciliation; CLIENT-00b authorization.
- `docs/adr/client-application-surface.md` — v1 primary client = Mac desktop.
- `docs/adr/sync-bridge-architecture.md` — opt-in companion HTTP bridge.
- `docs/product/product-target-architecture.md` — companion product summary (target user, client surfaces, data residency, future WIs).
- `docs/ui/current-ui-map.md`, `docs/ui/ui-state-contract.md`, `docs/ui/ui-gap-report.md` — UI inventory.
- `docs/release/wi-03-security-signoff.md` — outbound HTTPS sign-off (preserved).
- `docs/release/go-live-plan.md` — Stop-and-Ask gates, per-package test commands.
- `AGENTS.md` — coordinator-ownership rule, mutation policy.
- `docs/contracts/src/transitions.ts`, `docs/contracts/schemas/` — OCR vocabulary referenced (read-only) by case-box.
