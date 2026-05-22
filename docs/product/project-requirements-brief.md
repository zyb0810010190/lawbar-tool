---
status: DRAFT-PENDING-REVIEW
date: 2026-05-22
author: project-brief skill (run by Claude Code on user direction)
authoritative_after: /cc-suite:review-plan returns READY (or only Low-risk clarifications remain)
revision: 5 (post fourth review-plan: NEEDS-FIX → applied; R-5 item (j) expanded to four fields including contention_summary_text; R-5 proposed-resolution sentence corrected to (a)..(j); re-review required)
---

## Status banner

This brief is NOT authoritative until `/cc-suite:review-plan` returns READY per `.claude/rules/cc-suite.md`. Until then, every section is INPUT to review. Existing reviewed ADRs under `docs/adr/` outrank this draft (per `.claude/rules/project-brief.md` §"Authority hierarchy"). Where this brief disagrees with an existing ADR, the `Reconciliation log` below names the conflict; the ADRs are not silently rewritten.

## One-paragraph summary

A local-first Mac desktop application for one lawyer (or law-firm staff acting on the lawyer's behalf). v1 day-one focuses on two **lawyer-facing workflow categories** — **litigation matters** and **counsel matters** — which map to the existing `case-box-matter.schema.json` `matter_type` enum values `litigation` and `advisory` (the schema's other values `arbitration | due_diligence | criminal_defense | other` are out-of-scope for v1 UI but retained in the schema for forward compatibility). Each workflow category carries its own structured sub-entities (claims/defenses, evidence, deadlines, court info, contracts, payments, lawyer letters, contract reviews, consultations). Confidential documents stay on the Mac by default. A **post-v1** WeChat mini-program companion adds login-gated lawyer-only access for uploading WeChat screenshots, downloading authorized originals, and reading authorized matter surfaces. Cloud sync, remote LLM, multi-user collaboration, browser SPA, document text extraction (non-OCR), and monetization are all indefinitely postponed or post-v1. Originals are **retained verbatim** after any extraction; extraction is additive, never destructive.

## Answers to sections 1-20

### §1 Product vision

A case-box workspace for one lawyer running locally on Mac. The product covers two **v1 workflow categories** — litigation matters and counsel matters — each with its own structured sub-entities. Confidential legal documents stay on the lawyer's Mac by default; nothing leaves unless the lawyer takes a deliberate per-document or per-matter action. Originals are always retained verbatim after extraction. The product exists because existing legal tools force cloud upload or require multi-tenant SaaS, neither acceptable under PRC lawyer confidentiality duties.

### §2 Target users

- **Primary**: single lawyer (or firm staff acting on the lawyer's behalf) on Mac.
- **Secondary (post-v1 companion)**: same lawyer on phone via WeChat mini-program. Mini-program access is **login-gated**; unauthenticated users see only the login screen.
- **Explicitly excluded**: multi-firm SaaS operators, browser-first users, mobile-first paralegals, end-clients, opposing counsel, public users, courts.

### §3 Primary platform — ranking

1. **Mac desktop** — v1 primary; in-process embedding.
2. **WeChat mini-program** — **post-v1** companion, login-gated. NO v1 code, NO v1 ship.
3. **Browser SPA** — **indefinitely postponed**. No v1 or v2 architectural budget.
4-7. **Windows / Linux desktop / iPad / native mobile** — indefinitely postponed.

### §4 Mac app expectations

- Single `.app` bundle, default install to `/Applications`.
- Data path: `~/Library/Application Support/lawbar/` (user-relocatable).
- Fully offline default.
- No telemetry. No auto-update v1 (manual download).
- Code-sign + notarize required before non-dev distribution — STOP-AND-ASK (Apple Developer ID, notarization profile, signing identity).
- Crash reporting OFF default; opt-in if added.
- Desktop framework decision (Electron / Tauri / native) remains STOP-AND-ASK per `dev-memo/plan-client-00.md` §6.

### §5 WeChat mini-program expectations (POST-V1; not in v1 day-one code)

**Scope marker**: every mini-program-touching paragraph in this section describes the **post-v1 companion**. The v1 day-one Mac app contains no mini-program code, no sync-bridge listener, no auth seam beyond the local-user sentinel.

When the mini-program ships (each step gated by a separate STOP-AND-ASK):

- **Login-gated**: lawyer-only access. Unauthenticated users reach only the login screen. The mini-program's auth **seam interface** must be contract-shaped before any mini-program code is written; the **auth provider choice** remains STOP-AND-ASK.
- **Authorization gates for every read/download/upload**: each operation must pass ALL of:
  1. Authenticated principal (lawyer).
  2. Sync grant exists for the target document or matter (per `docs/adr/sync-bridge-architecture.md`).
  3. Privilege resolver: no protective assertion blocks the operation (per `case-box-step-3`).
  4. Confidentiality resolver: `assertExternalHandlingAllowed` permits the operation for `externalAction = sync_transmit` (per `case-box-step-5`).
  5. Audit event recorded (writes MUST, reads MAY per sync ADR).
- **Authorized read surfaces**: case summary, document index, deadline list, evidence list, OCR job status, per-page review. Surface list mirrors current `docs/ui/sync-bridge-contract-draft.md`.
- **Authorized download surfaces** (NEW relative to current sync ADR — see R-2):
  - **Binary original file**: lawyer can download the verbatim original bytes of any authorized document.
  - **Extracted-text artifact** (OCR text only — text-extraction artifacts are post-v1 even beyond mini-program): downloadable as plain text.
  - Rendered previews of pages: per-page PNG / PDF render. Read-only.
  - NO bulk export. NO cross-matter aggregation. NO privilege-log export.
- **Authorized upload surface** (NEW relative to current sync ADR — see R-3):
  - **WeChat screenshot upload**: lawyer selects target matter, attaches a screenshot (PNG / JPG). The mini-program creates a new `CaseBoxDocument` row in the chosen matter, OCR-pipelines the image, retains the original verbatim. The screenshot is "system-original" — i.e., the original bytes of the upload artifact — and is NOT a legal-proof representation of the underlying WeChat chat record (that determination is part of the lawyer's case work).
  - NO non-screenshot document upload from the mini-program. Mac desktop remains the path for PDFs, Word docs, Markdown, etc.
- **Publication**: WeChat mini-program registration (Chinese business entity, WeChat developer account, ICP filing if required) remains STOP-AND-ASK.

### §6 Local-first / cloud / sync expectations

- **Default**: local-only on lawyer's Mac. Zero cloud, zero sync, zero network egress on the default workflow.
- **Exceptions** (each STOP-AND-ASK gated):
  - WI-03-hardened outbound HTTPS for URL-sourced OCR fetch (unchanged).
  - Future per-document or per-matter sync grant to a sync bridge (post-v1).
- **Conversion paths from upload to searchable data**:
  - **OCR** (v1 day-one): scanned PDFs, image PDFs, image files (PNG, JPG), WeChat screenshots once mini-program ships. Engine: `paddleocr-onnx` local.
  - **Document text extraction** (POST-V1 — moved out of day-one per first review fix; see R-6): PDF text-layer, `.docx`, `.md`. Engine TBD via STOP-AND-ASK. v1 day-one DOES NOT include this surface. v1 day-one acceptance for PDF/Word/MD: **original is retained; lawyer may attach extracted text manually via paste** if needed. No automated extraction.
- Sync and cloud behavior remains opt-in per document or per matter; never per-account global; never auto-on; never overrides confidentiality/privilege rules.
- Originals are retained **verbatim** after any extraction (OCR now, text-extraction later). The product never replaces an original. Originals must remain directly openable on Mac desktop and downloadable through the post-v1 mini-program when authorized.

### §7 Legal workflow and case management — TWO V1 CATEGORIES

**Vocabulary alignment**: this brief uses `litigation` and `counsel` as **lawyer-facing English labels**. The underlying schema uses `case-box-matter.schema.json#matter_type` enum values `litigation` (matches) and `advisory` (this brief's `counsel` maps to schema `advisory`). The schema's other values `arbitration | due_diligence | criminal_defense | other` are NOT scoped for v1 UI — but they remain in the schema. v1 UI presents `litigation` and `counsel`; the underlying row's `matter_type` is `litigation` or `advisory`.

**Day-one v1 vertical slice rule**: §7 names every sub-entity the lawyer eventually wants. v1 day-one persistence covers ONLY the sub-entities marked **(v1)**. Sub-entities marked **(POST-V1)** are documented as product-direction but NOT persisted, edited, or shown in v1.

**Create-time requiredness rule**: required-on-create fields are listed under "Create-time required". Other sub-entity rows MAY be added incrementally; "completeness checks" for archive / export are POST-V1.

#### §7.A Litigation matter (`matter_type = "litigation"`)

**Create-time required (v1)**: matter `name`, `jurisdiction.value`, `matter_type="litigation"`, at least one `parties[]` entry, `confidentiality_class`, `status`, `actor_user_id`, `tenant_id`, `created_at`. (All per existing Step-1 matter schema.)

**(v1) — persisted day-one**:
- Case identity: case name (`name`), court of jurisdiction (`jurisdiction.value`), party names (`parties[].display_name` per the existing matter schema), case type (NEW optional matter-row free-text field `case_type_text` per R-5 item (j); POST-V1: controlled vocabulary), case progress (NEW optional matter-row free-text field `case_progress_text` per R-5 item (j); POST-V1: lifecycle).
- Deadlines and to-dos via `CaseBoxDocketEntry` → `CaseBoxDeadline` (existing Step-6 contract). Litigation deadline kinds (new vocabulary per R-5): `payment | evidence_submission | appeal | hearing`. Vocabulary extension is a follow-up WI; until then v1 UI uses the existing `kind` vocabulary with free-text descriptor.
- Court procedural documents stored as `CaseBoxDocument` rows with `purpose = "court_procedural"` (R-5 item (a) enum value); OCR pipelined; originals retained.
- Engagement contract — stored as `CaseBoxDocument` with `purpose = "engagement_contract"` tag (purpose-tagging is a small additive contract change — see R-5).
- Payment / invoice records — stored as `CaseBoxDocument` with `purpose = "payment_record"` tag. (No separate billing entity v1; lawyer treats invoices as documents.)
- Court contact info — NEW optional matter-row free-text field `court_contact_text` per R-5 item (j) (POST-V1: structured contact entity).
- Party contact info — uses the existing `parties[].notes` free-text field on the matter schema (no new field required). POST-V1: structured contact sub-entity.
- Claims and defenses (including counterclaims) — `CaseBoxFact` rows tagged with a NEW `purpose` enum value `claim | defense | counterclaim` (`CaseBoxFact.purpose` does NOT exist today; it is part of the R-5 contract extension). Deterministic, manual entry only since LLM is postponed.
- Evidence list for both parties — `CaseBoxEvidenceItem` rows (existing) with new `party_side` enum `our | opposing`.
- Important client-lawyer engagement decision chat records — `CaseBoxDocument` with `purpose = "decision_record"` tag.
- WeChat chat screenshots — `CaseBoxDocument` rows; uploaded via Mac desktop in v1; via mini-program post-v1; original retained.

**(v1 — captured as free-text, structure POST-V1)**:
- Summary of parties' main points of contention — NEW optional matter-row free-text field `contention_summary_text` per R-5 item (j) (POST-V1: structured sub-entity).
- Timeline of important facts and key events — `CaseBoxFact` rows with `purpose = "timeline_event"` and a NEW optional `as_of_date` field (`CaseBoxFact.as_of_date` does NOT exist today; it is part of the R-5 contract extension). Both fields land together in R-5.

**(POST-V1 — NOT persisted day-one)**:
- Structured court entity with full address / phone / contact-person / schedule.
- Structured party-contact sub-entity.
- Engagement-contract lifecycle state machine (lifecycle stays as document-row metadata in v1).
- Billing entity (separate from document tag).

#### §7.B Counsel matter (`matter_type = "advisory"` in schema; "counsel" in UI)

**Create-time required (v1)**: same matter-row fields as litigation. Parties[] is still required (≥1 entry; for counsel matters this is the client organization).

**(v1) — persisted day-one**:
- Counsel contracts — `CaseBoxDocument` with `purpose = "counsel_contract"` tag.
- Payment / invoice records — `CaseBoxDocument` with `purpose = "payment_record"` tag.
- Work orders issued by the client organization — `CaseBoxDocument` with `purpose = "work_order"` tag plus `work_order_status` enum (`open | in_progress | answered | closed`) on the document row (POST-V1: dedicated work-order entity).
- Lawyer handling results for each work order — `CaseBoxFact` rows with `purpose = "work_order_result"` linked to the work-order document by `source_document_id`. The `purpose` field is the R-5 extension.
- WeChat chat screenshots — same as litigation; original retained.
- General consultations — `CaseBoxFact` rows with `purpose = "consultation_q" | "consultation_a"` linked to source document. The `purpose` field is the R-5 extension. Existing fact lifecycle (candidate → reviewed → accepted / rejected) applies.

**(v1 — captured as free-text fields on the relevant document row)**:
- Lawyer's letters: stored as `CaseBoxDocument` with `purpose = "lawyer_letter"` + free-text fields `letter_date`, `service_status`, `client_authorization_summary`, `preliminary_evidence_summary`. (POST-V1: lawyer-letter lifecycle state machine — draft / sent / served / responded — see R-9.)
- Contract reviews: stored as `CaseBoxDocument` with `purpose = "contract_review_input"` (original) and `purpose = "contract_review_final"` (revised) linked by `supersedes_document_id`. Free-text fields: `review_date`, `final_version_marker`. (POST-V1: contract-review lifecycle state machine — see R-9.)

**(POST-V1 — NOT persisted day-one)**:
- Lawyer-letter and contract-review lifecycle state machines (R-9).
- Dedicated work-order entity (v1 uses document tags).

#### Cross-category invariants

- Every entity inherits `tenant_id`, `actor_user_id`, audit-event provenance, privilege/confidentiality posture, and soft-delete rules per existing case-box ADRs.
- LLM-driven candidate extraction is **disabled v1 and indefinitely postponed** (§12). Manual entry is the v1 path.
- Original file retention is **load-bearing**: every ingestion path (Mac picker / URL / future WeChat upload / future scanner) preserves the original file content-addressed by content hash. Extraction artifacts (OCR text) are stored alongside the original, never replacing it.
- **Matter-type immutability**: once a matter row is created with `matter_type = "litigation"` or `matter_type = "advisory"`, the value is immutable. If a counsel matter evolves into litigation, the lawyer creates a **new** litigation matter and links it via a `successor_matter_id` reference on the original (a small additive contract change — see R-5). No in-place mutation.

### §8 OCR vs document text extraction requirements

| Aspect | OCR (v1 day-one) | Document text extraction (POST-V1) |
|---|---|---|
| Input formats | Scanned / image PDF, PNG, JPG, screenshots | PDF with text layer, `.docx`, `.md` |
| Engine | `paddleocr-onnx` (local) | TBD — STOP-AND-ASK runtime dependency |
| Original retention | Mandatory | Mandatory |
| Output | Page-keyed OCR text + bounding boxes | Plain text + (where applicable) structure |
| Lawyer review surface | S5 manual-review screen (existing) | Defined when the engine lands |
| Error surfacing | Existing `OcrQueueError` codes, retry / dead-letter classification | Defined when the engine lands |
| Cloud | Local v1; external worker opt-in per document, `confidentiality_class=normal` only | N/A in v1 |
| **v1 acceptance bar** | Every page that OCR cannot read with confidence is visible in S5 for lawyer correction; no silent loss; existing retry/DLQ classification handles transient failures | N/A — extraction is post-v1 |
| Quantitative accuracy | DEFERRED — no quantitative target. v1 standard is "lawyer can correct via S5". | N/A |

**Manual-paste fallback (v1)**: for PDFs / Word docs / Markdown the lawyer wants searchable in v1, the lawyer manually pastes extracted text into a free-text field on the document row. This is the v1 substitute for automated text extraction.

### §9 Document and evidence workflows

- **Ingestion paths v1**: Mac file picker; URL submission (WI-03 hardened HTTPS). (Post-v1: WeChat screenshot upload via mini-program; future scanner integration.)
- **Citation binding**: `CaseBoxFact` rows reference `document_id` + `page_number` + `excerpt` pointing to source OCR text (existing Step-2 contract).
- **Redaction**: NOT designed v1. NO redacted-derivative artifacts produced. NO redacted-derivative export. Redaction is a STOP-AND-ASK post-v1 ADR — until that ADR exists, redaction does not happen at any layer.
- **Export (v1 day-one)**: lawyer-driven local file copy of original files and audit log out of the data directory. No structured export entity, no PDF report, no signed bundle.
- **Export (post-v1)**: signed evidence bundle (format TBD, tamper-evident); PDF chronology / proof matrix / privilege log; plain-text fact dump. Each is a separate STOP-AND-ASK ADR.
- **Backup (v1)**: the entire data directory at `~/Library/Application Support/lawbar/` is backup-as-directory. macOS Time Machine restores the directory. The backup manifest is: matter SQLite, audit-log SQLite, blob store directory (content-hash-addressed). Restoration is "drop directory back, run schema integrity check on startup". No separate backup product v1.

### §10 Deadlines / docketing

Per `case-box-step-6-deadline-docketing-rules.md` ADR:

- Sources: `manual | court_order_excerpt | llm_extraction | imported`. **Vocabulary-only**: `llm_extraction` is an allowed enum value for future provenance; v1 has no LLM producer (see §12 + R-8).
- Each docket entry carries source provenance, extractor name + version + confidence, source document + page + excerpt.
- Lifecycle: proposed → confirmed (lawyer-only) → materializes `CaseBoxDeadline`. Or proposed → dismissed with reason.
- `date_only` deadlines forbidden from auto-confirm in v1.
- Reminder shape stored only (offsets); no v1 notification engine.
- **v1 deadline UX**: visible **overdue list** in the case-box UI; dashboard banner when any deadline is overdue or due within 7 days. **NO** push notifications, NO email, NO SMS, NO escalation. The lawyer sees overdue deadlines whenever the case-box UI opens.
- Litigation-specific deadline kinds (`payment | evidence_submission | appeal | hearing`) require an expanded `kind` vocabulary — see R-5. Until that WI lands, v1 UI uses the existing `kind` vocabulary with free-text descriptor.
- Declarative-rules engine for computed deadlines: post-v1 (Step 7 not yet planned).
- Escalation model: POST-V1; v1 UX is "visible in overdue list only".

### §11 Confidentiality / privilege / audit expectations

Per `case-box-step-3` (privilege markers), `case-box-step-4` (audit log), and `case-box-step-5` (confidentiality classification) ADRs:

- **Privilege**: standalone marker entity per `(target_type, target_id)`. States: `proposed | confirmed | dismissed | waived`. Unmarked = neither privileged nor cleared-for-disclosure. No auto-mark.
- **Confidentiality**: per-target classification entity, append-only history. Levels: `unclassified` (default; denies external) → `normal` → `confidential` → `highly_confidential` → `restricted` (no external ever).
- **Audit log (v1)**: separate SQLite file, hash-chained, `additionalProperties: false`, `entity_type` enum closed. Timestamp included in hash. Schema-level enforcement.
- **Mini-program audit shape (POST-V1)**: every mini-program operation (login attempt, read, download, upload) MUST produce an audit event. The event family — kinds, payload shape, principal identification — is a load-bearing piece of any future SYNC WI and MUST be designed BEFORE the SYNC implementation begins. See R-2 and R-3 for scope.
- **Who-saw-what**: not v1. Default reads on Mac do not log per-screen access (the Mac process IS the lawyer per `case-box-step-7`). Mini-program read access logging policy: decided in the SYNC WI per `docs/adr/sync-bridge-architecture.md` §"Audits every operation".
- **Tamper-evidence**: hash chain + chain-verifier helper, already in `case-box-contract` Step 4.

### §12 AI / LLM boundaries

- **v1**: AI / LLM extraction is **INDEFINITELY POSTPONED**. Deterministic stub or fully manual entry is the v1 path.
- The existing `docs/adr/case-box-step-8-llm-extractor-policy.md` ADR remains as **future policy only**, not an active implementation roadmap. No v1 WI targets it.
- The `llm_extraction` value in source-type enums (e.g. Step-6 docket source) is **contract vocabulary** retained for forward provenance; v1 has no producer of LLM-sourced rows.
- Forbidden under any future enablement:
  - Auto-accept facts (always candidate-only).
  - Auto-confirm deadlines.
  - Auto-mark privilege or confidentiality.
  - Prompt-leak to any user-visible surface.

### §13 Collaboration / multi-user expectations

- **v1**: single-user. `actor_user_id = "local-user"` sentinel valid only while: local-only Mac, no sync bridge, no remote LLM, no multi-user write path.
- Data shape multi-user-ready: `tenant_id` + `actor_user_id` required on every row.
- Single-firm-multi-user phase: **indefinitely deferred** under this brief.
- Multi-firm SaaS: NOT v1.
- Auth provider choice: STOP-AND-ASK. The mini-program's login gate (§5) requires an auth **seam interface** to be planned in any future SYNC WI; the **provider** itself remains STOP-AND-ASK.

### §14 Export / backup / archive

- **v1 day-one Mac**: lawyer manages backups via macOS Time Machine on the data directory. Lawyer can manually copy originals out via Finder.
- **v1 day-one backup manifest** (for documentation; no separate tooling):
  - `~/Library/Application Support/lawbar/case-box.sqlite` — case-box rows.
  - `~/Library/Application Support/lawbar/audit-log.sqlite` — hash-chained audit DB.
  - `~/Library/Application Support/lawbar/blobs/<content-hash-prefix>/<content-hash>` — content-hash-addressed blob store.
  - Restoration: copy directory back; on startup, app runs schema integrity check + audit-chain verification.
- **Mini-program download** (POST-V1): per-doc / per-matter authorized; gates per §5 (auth + grant + privilege + confidentiality + audit). NOT public sharing.
- **Post-v1 export candidates** (all STOP-AND-ASK):
  - Signed evidence bundle (tamper-evident).
  - PDF chronology / proof matrix / privilege log.
  - Plain-text fact dump.
- **Retention**: legal artifacts soft-delete only v1. Hard-delete policy = STOP-AND-ASK post-MVP ADR.

### §15 Security / compliance

- **Threat model**:
  - Confidential legal documents must not leave lawyer's Mac by default.
  - macOS FileVault is v1 encryption-at-rest reliance.
  - WI-03 outbound HTTPS hardened (DNS-pinning, SSRF defense, IP allow-list, TLS validation).
  - No public network surface v1.
  - Mini-program inbound surface (when shipped) requires separate security sign-off (`docs/release/sync-00-security-signoff.md`) per `docs/adr/sync-bridge-architecture.md`.
- **Compliance regimes assumed** (verify on review):
  - 中华人民共和国律师法 (PRC Lawyers' Law) confidentiality.
  - PRC Personal Information Protection Law (PIPL) for client PI.
  - 律师执业管理办法 (lawyer practice management).
  - No GDPR / HIPAA / SOC 2 unless explicitly added.
- **Security boundaries**:
  - SSRF / TLS / DNS / fetcher in `services/ocr-worker/`.
  - Case-box persistence boundary.
  - Future sync-bridge inbound surface (separate sign-off).
  - Future document-text-extraction engine surface (when post-v1 engine lands).
- Per-document encryption: DEFERRED post-MVP.

### §16 Deployment / distribution

- v1: single Mac binary, direct download (channel TBD).
- Code-sign + notarize: STOP-AND-ASK (Apple Developer ID, notarization profile).
- Auto-update: manual v1. Mechanism (Sparkle / electron-updater / custom) = STOP-AND-ASK.
- Crash reporting: OFF default; opt-in only.
- Mac App Store vs direct vs in-firm IT: STOP-AND-ASK.

### §17 Business model

**INDEFINITELY POSTPONED.** v1 architecture decisions are not blocked on monetization.

### §18 Must-have v1 day-one / acceptable-deferred / post-v1

#### v1 day-one MUST-HAVE

- Mac desktop app shell (CLIENT-01, CLIENT-02, CLIENT-03 WIs).
- Local case box with **`matter_type` enum reconciliation** (purpose-tag and party_side and successor_matter_id extensions per R-5; deadline kind vocabulary per R-5).
- §7.A and §7.B **(v1) sub-entities only** persisted, edited, and viewed locally. (POST-V1 sub-entities NOT day-one.)
- OCR pipeline embedded in-process (existing).
- Original file retention for every ingestion path.
- Manual-paste fallback for PDF/Word/MD text content (in lieu of automated text extraction).
- Append-only hash-chained audit log (existing).
- Visible overdue-deadline list in the case-box UI.
- Per-screen case-box UI tailored to the two v1 workflow categories.

#### v1 acceptable-deferred (DOES NOT block v1 ship)

- Code-signing + notarization (works in dev mode without).
- Auto-update.
- Encryption-at-rest beyond FileVault.
- LLM stub-extractor wiring.
- Deadline declarative-rules engine.
- Mini-program companion (entire SYNC track).
- Document text extraction (PDF text-layer / Word / MD).
- Backup/export tooling beyond Finder + Time Machine.
- Redaction.
- Push notifications / email / SMS reminders.
- Lawyer-letter and contract-review lifecycle state machines.
- Dedicated work-order entity.
- Structured court / party-contact sub-entities.
- counsel → litigation matter-type conversion tooling (workaround: new matter + `successor_matter_id`).

#### Post-v1 (no v1 budget)

- Sync bridge (SYNC-01..05) — under reconciliation per R-1/R-2/R-3.
- Mini-program (SYNC-06+), including login gate, screenshot upload, original download.
- Cloud-sync targets.
- LLM remote extractor (kept as future policy only).
- Multi-user / multi-firm.
- Browser SPA (indefinitely postponed).
- Windows / Linux / iPad / mobile.
- Monetization.
- Document text-extraction engine (separate STOP-AND-ASK ADR before any code).

### §19 Explicit non-goals

- Multi-tenant SaaS lawyer portal.
- Browser-first client. (Browser SPA indefinitely postponed.)
- Default-on cloud sync of lawyer documents.
- WeChat-primary client (companion only).
- Public HTTP API.
- Cross-firm collaboration.
- End-client-facing surfaces.
- Court / opposing-counsel direct integration.
- AI auto-decision-making (no auto-accept under any future LLM enablement).
- Destructive extraction (originals must always be retained).
- Treating mini-program file download as public sharing.
- v1 monetization features.
- v1 document text extraction (post-v1 only).
- v1 redaction.

### §20 Hard-stop decisions

Each item is STOP-AND-ASK regardless of workflow. Inherits and tightens `.claude/rules/autonomy.md`.

- Auth provider choice.
- Cloud vendor choice.
- External document exposure beyond WI-03-hardened outbound HTTPS.
- Mini-program publication / registration.
- Sync bridge enablement (listener ship).
- LLM enablement (any form, including local on-device).
- Electron / Tauri / native runtime dependency.
- Renderer UI framework choice.
- **Document text-extraction engine choice** (post-v1; no v1 commitment).
- Public deployment / release / publication.
- Code-signing identity + notarization profile.
- Secret material handling.
- New runtime dependencies (each individually).
- Apple Developer ID acquisition.
- Per-document encryption-at-rest scheme.
- Hard-delete retention policy.
- Tenant boundary widening.
- Any external network surface beyond WI-03-hardened outbound HTTPS.
- Real-data migration on live lawyer data.
- Monetization decisions (billing / external accounts).
- Redaction ADR (before any redaction code lands).

## Reconciliation log

Each entry: brief section, conflicting source, prior wording, brief's new wording, proposed resolution.

### R-1 — Mini-program login gate forces auth-seam contract planning (post-v1)

- **Brief section**: §5, §13.
- **Conflicting source**: `docs/adr/sync-bridge-architecture.md` and `docs/adr/case-box-step-7-multi-user-readiness.md`.
- **Prior wording**: Bridge "authenticates when the bridge ships — but the auth provider is a Stop-and-Ask gate. Test-mode auth is the only seam recorded in SYNC-00." Single-user posture valid "only while no sync bridge is enabled".
- **Brief's new wording**: §5 explicitly requires login-gated lawyer-only access for the mini-program. Unauthenticated users reach only the login screen. The auth **provider** stays STOP-AND-ASK; the auth **seam interface** must be planned in any future SYNC WI BEFORE the mini-program ships.
- **Severity**: Medium (existing sync ADR already contemplates a seam; the conflict is principal-model maturity, not seam existence).
- **Proposed resolution**: SYNC-01 (sync bridge scaffold) WI absorbs the auth-seam contract design. ADRs NOT silently rewritten. Treat as **part of the post-v1 SYNC reconciliation program** (see R-1/R-2/R-3 grouped resolution at the end of this log).

### R-2 — Mini-program download of original files expands SYNC scope (post-v1)

- **Brief section**: §5, §14.
- **Conflicting source**: `docs/product/product-target-architecture.md` §"Sync Bridge Role" and `docs/adr/sync-bridge-architecture.md`.
- **Prior wording**: "NO bulk export, NO submit-new-document at v1 bridge launch, NO privilege-log export." Sync bridge endpoints sketched as "case summary, OCR job status, page view".
- **Brief's new wording**: §5 requires the post-v1 mini-program to support download of authorized original files and extracted-text artifacts, with explicit gates: auth + grant + privilege + confidentiality + audit. NOT bulk export; per-doc / per-matter authorized.
- **Severity**: High (qualitative scope expansion of the bridge).
- **Proposed resolution**: separate WI under the post-v1 SYNC reconciliation program. Bridge contract draft (`docs/ui/sync-bridge-contract-draft.md`) extends with binary-original download + extracted-text download endpoints. Security sign-off included.

### R-3 — WeChat screenshot upload introduces inbound document-ingestion write surface (post-v1)

- **Brief section**: §5, §7.A, §7.B.
- **Conflicting source**: `docs/adr/sync-bridge-architecture.md` (read-mostly framing) and `docs/adr/case-box-step-0-boundary.md` §1 (ingestion via Mac desktop only).
- **Prior wording**: Bridge writes limited to "cancel, accept/reject candidate fact, quick-note". Ingestion implied Mac-desktop only.
- **Brief's new wording**: §5 + §7 require WeChat screenshots uploaded via the post-v1 mini-program to become `CaseBoxDocument` rows. Defined as "system-original = uploaded bytes; NOT legal proof of underlying chat".
- **Severity**: Critical (qualitatively larger than current bridge writes; introduces inbound document-ingestion surface; needs separate security sign-off).
- **Proposed resolution**: separate WI under the post-v1 SYNC reconciliation program. Bridge contract draft extends with screenshot-upload endpoint (size limits, MIME types, content-hash, confidentiality classification at upload time, audit event shape). Security sign-off required.

### R-1/R-2/R-3 grouped resolution — Post-v1 SYNC reconciliation program

R-1, R-2, and R-3 together expand the SYNC track from the current "narrow read + minimal write" framing to a full mini-program companion. These three reconciliation items are NOT treated as routine post-READY follow-ups. They constitute a **post-v1 reconciliation program** that must run as a sequence of separate WIs:

1. SYNC reconciliation WI-a — auth-seam contract design.
2. SYNC reconciliation WI-b — authorized read endpoints (existing + tighten gates).
3. SYNC reconciliation WI-c — authorized original-file + extracted-text download (R-2).
4. SYNC reconciliation WI-d — authorized screenshot upload (R-3).
5. SYNC reconciliation WI-e — audit event family for all of the above (per §11 mini-program audit shape).
6. SYNC reconciliation WI-f — conflict-resolution policy for concurrent mini-program + Mac writes.

Each carries its own `/cc-suite:review-plan` pass. NONE land in v1 day-one.

### R-4 — Multi-user phase tightened from "near-future" to "indefinitely deferred"

- **Brief section**: §13.
- **Conflicting source**: `docs/product/product-target-architecture.md` (Future Work Items, `TENANT (deferred)`); `case-box-step-7-multi-user-readiness.md` (describes single-firm-multi-user as "future near-term").
- **Prior wording**: "Near-future" / "future near-term".
- **Brief's new wording**: Single-firm-multi-user is **indefinitely deferred**.
- **Severity**: Low (product-direction tightening; no schema change; existing Step-7 invariants stand).
- **Proposed resolution**: docs-only reconciliation WI demotes `TENANT` in `product-target-architecture.md` Future Work Items.

### R-5 — Matter-type vocabulary alignment + additive contract surface for v1 §7 sub-entities (v1 day-one)

- **Brief section**: §7.A, §7.B, §10, §18.
- **Conflicting source**: `docs/contracts/case-box-contract/schemas/case-box-matter.schema.json` (`matter_type` enum is `["litigation", "arbitration", "advisory", "due_diligence", "criminal_defense", "other"]`); `docs/contracts/case-box-contract/schemas/case-box-fact.schema.json` (NO `purpose`, NO `as_of_date`); `docs/contracts/case-box-contract/schemas/case-box-document.schema.json` (NO `purpose`, NO `work_order_status`, NO free-text lifecycle fields); `docs/contracts/case-box-contract/schemas/case-box-evidence-item.schema.json` (NO `party_side`); `docs/adr/case-box-step-0-boundary.md`; `docs/adr/case-box-step-6-deadline-docketing-rules.md` `kind` vocabulary.
- **Prior wording (revision 1 of this brief, now corrected)**: "introduces `matter_type` discriminator" — this was wrong. `matter_type` already exists, already required, with the broader enum above.
- **Brief's new wording**: §7 uses lawyer-facing labels `litigation` and `counsel`; the schema-level value for "counsel" is the existing `advisory`. v1 UI surfaces only `litigation` and `advisory`. Other enum values (`arbitration | due_diligence | criminal_defense | other`) remain in the schema for forward compatibility but are NOT v1 UI surfaces. The following additive contract changes are needed for v1:

  **(a) `CaseBoxDocument.purpose`** — new controlled-vocab enum field. v1 values: `engagement_contract | payment_record | decision_record | court_procedural | counsel_contract | work_order | lawyer_letter | contract_review_input | contract_review_final | screenshot | other`. Optional field; absent = `other`.

  **(b) `CaseBoxDocument.work_order_status`** — new optional enum (`open | in_progress | answered | closed`); only valid when `purpose = "work_order"`. Schema invariant: `work_order_status` null unless `purpose = "work_order"`.

  **(c) `CaseBoxDocument` free-text lifecycle fields** — `letter_date`, `service_status`, `client_authorization_summary`, `preliminary_evidence_summary` (for `purpose = "lawyer_letter"`); `review_date`, `final_version_marker` (for `purpose = "contract_review_*"`). All optional free-text strings; no validation beyond `maxLength`. Lifecycle state machines are post-v1 (see R-9).

  **(d) `CaseBoxDocument.supersedes_document_id`** — new optional ULID reference for the contract-review revision linkage (and any other v1 document supersession needs). Optional; persistence enforces same-matter same-tenant.

  **(e) `CaseBoxFact.purpose`** — new controlled-vocab enum field. v1 values: `claim | defense | counterclaim | timeline_event | work_order_result | consultation_q | consultation_a | other`. Optional field; absent = `other`. Required to satisfy §7.A (claims/defenses/counterclaims, timeline) and §7.B (work-order results, consultations).

  **(f) `CaseBoxFact.as_of_date`** — new optional date-only string field. Required (non-null) when `purpose = "timeline_event"`; optional otherwise. Schema invariant: `as_of_date` is `date-only` (no time component); does NOT replace `created_at`.

  **(g) `CaseBoxEvidenceItem.party_side`** — new optional enum (`our | opposing`); supports §7.A "evidence list for both parties".

  **(h) `CaseBoxMatter.successor_matter_id`** — new optional ULID reference; supports the counsel→litigation workaround. Persistence enforces same-tenant.

  **(i) Step-6 `kind` vocabulary extension** — append `payment | evidence_submission | appeal | hearing` to the existing `CaseBoxDocketEntry.proposed_kind` and `CaseBoxDeadline.kind` enums (and the audit-event `entity_type` enum is unchanged — these are deadline kinds, not entity types).

  **(j) `CaseBoxMatter` litigation-specific free-text fields** — four new optional matter-row fields for `matter_type = "litigation"`: `case_type_text` (free-text descriptor of the case type — POST-V1: controlled vocabulary), `case_progress_text` (free-text descriptor of current case progress — POST-V1: lifecycle state machine), `court_contact_text` (free-text court contact info — POST-V1: structured contact entity), `contention_summary_text` (free-text summary of the parties' main points of contention — POST-V1: structured sub-entity). All four are optional and schema-only constrained by `maxLength`. NOT required for `matter_type = "advisory"` (counsel matters) — counsel matters can leave them null or omitted. **Party contact information** in v1 uses the existing `parties[].notes` field on the matter schema — no new field needed.

  Optional-vs-nullable convention for all of (a)..(j) including all four R-5(j) fields: the WI-brief-matter-type WI MUST pick one convention consistently (recommendation: optional-omitted for absent values; nullable-required only where a v1 invariant forces presence, e.g. `as_of_date` non-null when `purpose = "timeline_event"`). The convention choice is part of the WI's `/cc-suite:review-plan` scope.

  All of (a)..(j) are additive (new optional fields or new enum values). No existing field semantics change; no existing fixture is invalidated.

- **Severity**: Critical (foundational for every other v1 WI; all downstream UI / persistence / read-model work depends on this).
- **Proposed resolution**: open WI-brief-matter-type FIRST in v1 sequencing. The WI is a contract-only ADR amendment covering all of (a)..(j). `/cc-suite:review-plan` required. All other v1 WIs (CLIENT-01..04, case-box-step-1+, UI, deadline-kind expansion) block on this.

### R-6 — Document text extraction (non-OCR) DEFERRED from v1 day-one to post-v1

- **Brief section**: §6, §8, §15, §18, §20.
- **Conflicting source**: `docs/adr/case-box-step-0-boundary.md` §4 ("OCR runs locally via `paddleocr-onnx`") and `docs/product/product-target-architecture.md` (only OCR engine mentioned).
- **Prior wording (revision 1 of this brief, now corrected)**: "NEW v1 surface; engine STOP-AND-ASK; day-one must-have" — this created a v1-day-one × STOP-AND-ASK deadlock.
- **Brief's new wording**: **Document text extraction is post-v1** with engine choice as a separate STOP-AND-ASK ADR. v1 day-one supports PDF / Word / MD ingestion-and-original-retention with a manual-paste fallback for searchable text. No automated extraction lands in v1.
- **Severity**: Low (now downgraded — was Critical when day-one × STOP-AND-ASK conflicted).
- **Proposed resolution**: open a post-v1 ADR-draft WI for the text-extraction engine choice. NOT a v1 blocker. v1 day-one ships without it.

### R-7 — Original file retention as load-bearing v1 invariant

- **Brief section**: §6, §7, §9.
- **Conflicting source**: None directly — `case-box-step-0-boundary.md` §4 already references content-hash-addressed local storage.
- **Brief's new wording**: Promote "original file retention" to an explicit cross-cutting v1 invariant for discoverability.
- **Severity**: Low (consistent with existing posture).
- **Proposed resolution**: small docs-only WI to append "Original file retention" to `case-box-step-0-boundary.md` cross-cutting invariants and `product-target-architecture.md` Cross-cutting Invariants. Not blocking.

### R-8 — LLM scope tightened from "feature-flagged future opt-in" to "indefinitely postponed"

- **Brief section**: §12, §18.
- **Conflicting source**: `docs/adr/case-box-step-8-llm-extractor-policy.md` and `docs/product/product-target-architecture.md` §"Data Residency" (LLM listed as opt-in path).
- **Prior wording**: LLM "feature-flagged, opt-in per case, candidate-only output".
- **Brief's new wording**: AI / LLM indefinitely postponed. Step 8 ADR stays as **future policy only**, not an active roadmap item. `llm_extraction` enum values across the contract remain (vocabulary-only; no v1 producer).
- **Severity**: Low (policy-direction tightening; Step-8 ADR is already policy-only with no implementation).
- **Proposed resolution**: docs-only reconciliation WI demotes `CASE-BOX Step 8` in `product-target-architecture.md` Future Work Items.

### R-9 — Lawyer-letter and contract-review lifecycle state machines (POST-V1)

- **Brief section**: §7.B, §18.
- **Conflicting source**: None — case-box contract does not yet model these entities.
- **Brief's new wording**: v1 captures lawyer letters and contract reviews as `CaseBoxDocument` rows with purpose tags + free-text lifecycle fields (date / service status / authorization / preliminary evidence summary / review date / final-version marker). Full state-machine modeling for these workflows is **post-v1**.
- **Severity**: Low (post-v1 product-direction note; v1 free-text capture is sufficient).
- **Proposed resolution**: post-v1 ADRs (`case-box-lawyer-letter-lifecycle.md`, `case-box-contract-review-lifecycle.md`) when those workflows mature.

## Sources consulted

- `AGENTS.md` (+ `CLAUDE.md` import)
- `docs/product/product-target-architecture.md`
- `docs/contracts/case-box-contract/schemas/case-box-matter.schema.json` (verified `matter_type` enum)
- `docs/adr/case-box-step-0-boundary.md`
- `docs/adr/case-box-step-2-fact-promotion-and-provenance.md`
- `docs/adr/case-box-step-3-privilege-marker-model.md`
- `docs/adr/case-box-step-4-audit-log-shape.md`
- `docs/adr/case-box-step-5-confidentiality-classification.md`
- `docs/adr/case-box-step-6-deadline-docketing-rules.md`
- `docs/adr/case-box-step-7-multi-user-readiness.md`
- `docs/adr/case-box-step-8-llm-extractor-policy.md`
- `docs/adr/client-application-surface.md` (via product summary)
- `docs/adr/sync-bridge-architecture.md`
- `dev-memo/plan-client-00.md`
- `dev-memo/project-brief-00.md`
- `.claude/rules/autonomy.md`
- `.claude/rules/cc-suite.md`
- `.claude/rules/client-local-first.md`
- `.claude/rules/project-brief.md`
- `.claude/rules/security-boundary.md`
- `.claude/rules/spark.md`
- `.claude/rules/staging-hygiene.md`
- `.claude/skills/project-brief/SKILL.md`
- `git log --oneline -50`
- Codex review-plan thread (first revision), job `review-plan-mpgg9yrg-amf715` (NEEDS-FIX → applied)

## Suggested follow-up WIs

(In sequence; each opens after `/cc-suite:review-plan` returns READY on this brief.)

1. **WI-brief-matter-type** *(v1, FOUNDATIONAL — blocks all other v1 case-box work)* — additive contract amendment covering all ten R-5 items: (a) `CaseBoxDocument.purpose` enum, (b) `work_order_status` enum, (c) free-text lifecycle fields on documents, (d) `supersedes_document_id`, (e) `CaseBoxFact.purpose` enum, (f) `CaseBoxFact.as_of_date`, (g) `CaseBoxEvidenceItem.party_side`, (h) `CaseBoxMatter.successor_matter_id`, (i) deadline `kind` vocabulary extension (`payment | evidence_submission | appeal | hearing`), (j) `CaseBoxMatter` litigation-specific free-text fields (`case_type_text`, `case_progress_text`, `court_contact_text`, `contention_summary_text`). Also pins the optional-vs-nullable schema convention for the WI. ADR amendments to `case-box-step-0` entity list, `case-box-step-2` (fact purpose + as_of_date), `case-box-step-6` (deadline kind), and the matter + document + evidence schemas. Carries `/cc-suite:review-plan`. Resolves R-5.
2. **WI-brief-doc-reconcile** *(v1, docs-only)* — update `product-target-architecture.md` Future Work Items: demote `TENANT`, `BROWSER SPA`, `CASE-BOX Step 8` to "indefinitely deferred"; append "Original file retention" to cross-cutting invariants; note the post-v1 SYNC reconciliation program. Resolves R-4, R-7, R-8 and the §3 browser SPA wording.
3. **WI-brief-doc-text-extract-policy** *(post-v1, ADR-draft)* — ADR for non-OCR document text extraction engine selection. STOP-AND-ASK runtime dependency. Resolves R-6. NOT v1.
4. **WI-brief-sync-reconciliation-program** *(post-v1; multi-WI)* — opens the six-WI program for SYNC: auth seam (R-1), authorized reads, authorized download (R-2), authorized upload (R-3), audit event family, conflict resolution. Each runs `/cc-suite:review-plan` independently.
5. **WI-brief-lawyer-letter-and-contract-review-lifecycle** *(post-v1)* — ADRs for lawyer-letter and contract-review state machines. Resolves R-9. NOT v1.
6. **WI-brief-redaction-policy** *(post-v1)* — ADR for redaction (before any redaction code).

## Hard-stop decisions (STOP-AND-ASK checklist)

Restated for autopilot consultation. Autopilot stops on any of these.

- [ ] Auth provider choice.
- [ ] Cloud vendor choice.
- [ ] External document exposure beyond WI-03-hardened outbound HTTPS.
- [ ] Mini-program publication / registration.
- [ ] Sync bridge enablement (listener ship).
- [ ] LLM enablement (any form, including local on-device).
- [ ] Electron / Tauri / native runtime dependency.
- [ ] Renderer UI framework choice.
- [ ] Document text-extraction engine choice (post-v1).
- [ ] Public deployment / release / publication.
- [ ] Code-signing identity + notarization profile.
- [ ] Secret material handling.
- [ ] New runtime dependencies (each individually).
- [ ] Apple Developer ID acquisition.
- [ ] Per-document encryption-at-rest scheme.
- [ ] Hard-delete retention policy.
- [ ] Tenant boundary widening.
- [ ] Any external network surface beyond WI-03-hardened outbound HTTPS.
- [ ] Real-data migration on live lawyer data.
- [ ] Monetization decisions.
- [ ] Redaction ADR (before any redaction code).

## Required cc-suite review

This brief is not authoritative until:
1. /cc-suite:review-plan docs/product/project-requirements-brief.md returns READY
   (or only Low-risk clarifications remain).
2. Any Critical/High findings are fixed and the brief is re-reviewed.
3. Each RECONCILIATION-NEEDED entry has either been resolved
   (via a follow-up WI that updates the conflicting ADR/doc) or explicitly
   accepted as a known divergence by the user.
4. Each STOP-AND-ASK item in §"Hard-stop decisions" has been seen
   and acknowledged by the user.

Review focus per .claude/rules/project-brief.md §"cc-suite review focus":
- Internal consistency across the twenty sections.
- Consistency with existing ADRs and product docs (any drift goes into
  the Reconciliation log, not silent override).
- Scope creep (v1 day-one list vs deferred list vs post-v1).
- Unsafe external-data assumptions (cloud / sync / LLM / multi-tenant).
- Hard-stop clarity (§20 items must be unambiguous STOP-AND-ASK decisions).

## Stop condition

This brief is stale or superseded when any of the following occurs:

- A subsequent brief at the same path raises `supersedes: docs/product/project-requirements-brief.md` (in frontmatter) and reaches `READY`.
- A product pivot (new matter category, new primary platform, new monetization shape) materially invalidates §1, §3, §7, or §17.
- A reconciliation WI updates an ADR in a way that contradicts a section here without a matching brief amendment.

In any of those cases, the user runs `/project-brief` again to write an amendment (status `AMENDMENT-PENDING-REVIEW`) and re-runs `/cc-suite:review-plan`.
