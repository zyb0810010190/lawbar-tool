# Product Definition

**What the product is, and how it looks and behaves.** Consolidated 2026-08-12 from 27
documents: the requirements brief, the Evidence-Genie M0 definition, and all 25 UI design
artifacts. Every source is carried in verbatim.

## What is and is not in here

| | Where it lives |
|---|---|
| What the product is; how each screen looks and behaves | **This file** |
| Work not yet built | `docs/product/product-plan.md` |
| Why a technical decision was made | `docs/adr/**` — these **outrank this file** on the decision each documents |
| Plans and closeouts for work already shipped | `dev-memo/*.md`, unchanged — records, cited by source 77 times |
| Schemas and contracts | `docs/contracts/case-box-contract` — a real npm package, not documentation |

**Authority note.** Part I §"Status banner" declares this brief READY and authoritative for
whole-product direction, and simultaneously subordinate to any ADR on that ADR's specific
decision. Both remain true after this merge.

## The three parts

**Part I — Project requirements brief.** The product's own answers to twenty scoping
questions (§1–20), the reconciliation log recording where the brief and the ADRs disagreed
and how each conflict was resolved, and the target architecture: client surfaces, data
residency, the sync-bridge seam, and eleven cross-cutting invariants that hold for v1.

**Part II — Evidence-Genie M0.** The Evidence product definition: problem statement, scope,
the eleven court-facing product invariants, user flows F1–F8, the eleven-surface content
inventory, the CN↔EN terminology dictionary, and the given/when/then acceptance scenarios with
their traceability matrix. Everything here is gated behind A0.7, which is **not green**.

**Part III — UI design artifacts.** One per shipped screen, oldest first: intent, states,
copy, empty and error cases, edge cases. This is the UI specification, not decoration — nine
renderer modules cite these documents by name for their own behaviour.

## A note on reading it

This is a **structured consolidation**, not a rewrite. Each source appears whole, under its
own heading, with provenance stamped. That was deliberate: rewriting 3,652 lines from
memory is how content silently disappears, and preserving it verbatim makes loss checkable —
303 source headings were verified present after assembly, with none missing.

The consequence is repetition. Each Part III artifact carries its own status/scope preamble,
and Parts I and II each restate the local-first and no-real-client-data posture. A
deduplication pass would shorten this materially; it has not been done, because doing it by
hand is exactly the step where things go missing. Treat the repetition as the cost of a
verifiable merge.

## Cited design artifacts

Six Part III artifacts are cited directly by renderer source. Their original paths remain as
one-line stubs pointing here, so those citations keep resolving without editing any source
comment — editing renderer comments shifts line numbers, and the i18n allowlist is keyed by
line number across 103 entries.

- `dev-memo/design/2026-06-26-audited-evidence-links-ui.md`
- `dev-memo/design/2026-07-04-t3-catalog-review-preview.md`
- `dev-memo/design/2026-07-05-global-overdue-dashboard-banner.md`
- `dev-memo/design/2026-07-09-desktop-zh-cn-settings-entry.md`
- `dev-memo/design/2026-08-03-claimtrack-screen.md`
- `dev-memo/design/2026-08-05-matter-details-edit-screen.md`
# Part I — Product description

---

## Project requirements brief (§1–20, reconciliation log, target architecture)

*Absorbed 2026-08-12 from `docs/product/project-requirements-brief.md`. Content verbatim; heading levels shifted one deeper.*

---
status: READY
date: 2026-05-22
author: project-brief skill (run by Claude Code on user direction)
authoritative_after: reached READY via review; verdict retained after the 2026-08-10 configuration reset
revision: 5 (post fourth review-plan: NEEDS-FIX → applied; R-5 item (j) expanded to four fields including contention_summary_text; R-5 proposed-resolution sentence corrected to (a)..(j); re-review required)
---

### Status banner

**This brief is READY and authoritative for whole-product direction.** It reached READY through review; the
review gate that produced that verdict has since been retired with the 2026-08-10 configuration reset, which
does not revoke the verdict.

Authority order: **reviewed ADRs under `docs/adr/` outrank this brief** for the specific technical decision
each one documents; this brief outranks everything else on product direction. Where this brief disagrees
with an existing ADR, the `Reconciliation log` below names the conflict; the ADRs are not silently
rewritten.

**Absorbed 2026-08-10:** the former `docs/product/product-target-architecture.md` — a derived
single-page summary — now lives here as **Appendix A**. Content preserved.

### One-paragraph summary

A local-first Mac desktop application for one lawyer (or law-firm staff acting on the lawyer's behalf). v1 day-one focuses on two **lawyer-facing workflow categories** — **litigation matters** and **counsel matters** — which map to the existing `case-box-matter.schema.json` `matter_type` enum values `litigation` and `advisory` (the schema's other values `arbitration | due_diligence | criminal_defense | other` are out-of-scope for v1 UI but retained in the schema for forward compatibility). Each workflow category carries its own structured sub-entities (claims/defenses, evidence, deadlines, court info, contracts, payments, lawyer letters, contract reviews, consultations). Confidential documents stay on the Mac by default. A **post-v1** WeChat mini-program companion adds login-gated lawyer-only access for uploading WeChat screenshots, downloading authorized originals, and reading authorized matter surfaces. Cloud sync, remote LLM, multi-user collaboration, browser SPA, document text extraction (non-OCR), and monetization are all indefinitely postponed or post-v1. Originals are **retained verbatim** after any extraction; extraction is additive, never destructive.

### Answers to sections 1-20

#### §1 Product vision

A case-box workspace for one lawyer running locally on Mac. The product covers two **v1 workflow categories** — litigation matters and counsel matters — each with its own structured sub-entities. Confidential legal documents stay on the lawyer's Mac by default; nothing leaves unless the lawyer takes a deliberate per-document or per-matter action. Originals are always retained verbatim after extraction. The product exists because existing legal tools force cloud upload or require multi-tenant SaaS, neither acceptable under PRC lawyer confidentiality duties.

#### §2 Target users

- **Primary**: single lawyer (or firm staff acting on the lawyer's behalf) on Mac.
- **Secondary (post-v1 companion)**: same lawyer on phone via WeChat mini-program. Mini-program access is **login-gated**; unauthenticated users see only the login screen.
- **Explicitly excluded**: multi-firm SaaS operators, browser-first users, mobile-first paralegals, end-clients, opposing counsel, public users, courts.

#### §3 Primary platform — ranking

1. **Mac desktop** — v1 primary; in-process embedding.
2. **WeChat mini-program** — **post-v1** companion, login-gated. NO v1 code, NO v1 ship.
3. **Browser SPA** — **indefinitely postponed**. No v1 or v2 architectural budget.
4-7. **Windows / Linux desktop / iPad / native mobile** — indefinitely postponed.

#### §4 Mac app expectations

- Single `.app` bundle, default install to `/Applications`.
- Data path: `~/Library/Application Support/lawbar/` (user-relocatable).
- Fully offline default.
- No telemetry. No auto-update v1 (manual download).
- Code-sign + notarize required before non-dev distribution — STOP-AND-ASK (Apple Developer ID, notarization profile, signing identity).
- Crash reporting OFF default; opt-in if added.
- Desktop framework decision (Electron / Tauri / native) remains STOP-AND-ASK per `dev-memo/plan-client-00.md` §6.

#### §5 WeChat mini-program expectations (POST-V1; not in v1 day-one code)

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

#### §6 Local-first / cloud / sync expectations

- **Default**: local-only on lawyer's Mac. Zero cloud, zero sync, zero network egress on the default workflow.
- **Exceptions** (each STOP-AND-ASK gated):
  - WI-03-hardened outbound HTTPS for URL-sourced OCR fetch (unchanged).
  - Future per-document or per-matter sync grant to a sync bridge (post-v1).
- **Conversion paths from upload to searchable data**:
  - **OCR** (v1 day-one): scanned PDFs, image PDFs, image files (PNG, JPG), WeChat screenshots once mini-program ships. Engine: `paddleocr-onnx` local.
  - **Document text extraction** (POST-V1 — moved out of day-one per first review fix; see R-6): PDF text-layer, `.docx`, `.md`. Engine TBD via STOP-AND-ASK. v1 day-one DOES NOT include this surface. v1 day-one acceptance for PDF/Word/MD: **original is retained; lawyer may attach extracted text manually via paste** if needed. No automated extraction.
- Sync and cloud behavior remains opt-in per document or per matter; never per-account global; never auto-on; never overrides confidentiality/privilege rules.
- Originals are retained **verbatim** after any extraction (OCR now, text-extraction later). The product never replaces an original. Originals must remain directly openable on Mac desktop and downloadable through the post-v1 mini-program when authorized.

#### §7 Legal workflow and case management — TWO V1 CATEGORIES

**Vocabulary alignment**: this brief uses `litigation` and `counsel` as **lawyer-facing English labels**. The underlying schema uses `case-box-matter.schema.json#matter_type` enum values `litigation` (matches) and `advisory` (this brief's `counsel` maps to schema `advisory`). The schema's other values `arbitration | due_diligence | criminal_defense | other` are NOT scoped for v1 UI — but they remain in the schema. v1 UI presents `litigation` and `counsel`; the underlying row's `matter_type` is `litigation` or `advisory`.

**Day-one v1 vertical slice rule**: §7 names every sub-entity the lawyer eventually wants. v1 day-one persistence covers ONLY the sub-entities marked **(v1)**. Sub-entities marked **(POST-V1)** are documented as product-direction but NOT persisted, edited, or shown in v1.

**Create-time requiredness rule**: required-on-create fields are listed under "Create-time required". Other sub-entity rows MAY be added incrementally; "completeness checks" for archive / export are POST-V1.

##### §7.A Litigation matter (`matter_type = "litigation"`)

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

##### §7.B Counsel matter (`matter_type = "advisory"` in schema; "counsel" in UI)

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

##### Cross-category invariants

- Every entity inherits `tenant_id`, `actor_user_id`, audit-event provenance, privilege/confidentiality posture, and soft-delete rules per existing case-box ADRs.
- LLM-driven candidate extraction is **disabled v1 and indefinitely postponed** (§12). Manual entry is the v1 path.
- Original file retention is **load-bearing**: every ingestion path (Mac picker / URL / future WeChat upload / future scanner) preserves the original file content-addressed by content hash. Extraction artifacts (OCR text) are stored alongside the original, never replacing it.
- **Matter-type immutability**: once a matter row is created with `matter_type = "litigation"` or `matter_type = "advisory"`, the value is immutable. If a counsel matter evolves into litigation, the lawyer creates a **new** litigation matter and links it via a `successor_matter_id` reference on the original (a small additive contract change — see R-5). No in-place mutation.

#### §8 OCR vs document text extraction requirements

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

#### §9 Document and evidence workflows

- **Ingestion paths v1**: Mac file picker; URL submission (WI-03 hardened HTTPS). (Post-v1: WeChat screenshot upload via mini-program; future scanner integration.)
- **Citation binding**: `CaseBoxFact` rows reference `document_id` + `page_number` + `excerpt` pointing to source OCR text (existing Step-2 contract).
- **Redaction**: NOT designed v1. NO redacted-derivative artifacts produced. NO redacted-derivative export. Redaction is a STOP-AND-ASK post-v1 ADR — until that ADR exists, redaction does not happen at any layer.
- **Export (v1 day-one)**: lawyer-driven local file copy of original files and audit log out of the data directory. No structured export entity, no PDF report, no signed bundle.
- **Export (post-v1)**: signed evidence bundle (format TBD, tamper-evident); PDF chronology / proof matrix / privilege log; plain-text fact dump. Each is a separate STOP-AND-ASK ADR.
- **Backup (v1)**: the entire data directory at `~/Library/Application Support/lawbar/` is backup-as-directory. macOS Time Machine restores the directory. The backup manifest is: matter SQLite, audit-log SQLite, blob store directory (content-hash-addressed). Restoration is "drop directory back, run schema integrity check on startup". No separate backup product v1.

#### §10 Deadlines / docketing

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

#### §11 Confidentiality / privilege / audit expectations

Per `case-box-step-3` (privilege markers), `case-box-step-4` (audit log), and `case-box-step-5` (confidentiality classification) ADRs:

- **Privilege**: standalone marker entity per `(target_type, target_id)`. States: `proposed | confirmed | dismissed | waived`. Unmarked = neither privileged nor cleared-for-disclosure. No auto-mark.
- **Confidentiality**: per-target classification entity, append-only history. Levels: `unclassified` (default; denies external) → `normal` → `confidential` → `highly_confidential` → `restricted` (no external ever).
- **Audit log (v1)**: separate SQLite file, hash-chained, `additionalProperties: false`, `entity_type` enum closed. Timestamp included in hash. Schema-level enforcement.
- **Mini-program audit shape (POST-V1)**: every mini-program operation (login attempt, read, download, upload) MUST produce an audit event. The event family — kinds, payload shape, principal identification — is a load-bearing piece of any future SYNC WI and MUST be designed BEFORE the SYNC implementation begins. See R-2 and R-3 for scope.
- **Who-saw-what**: not v1. Default reads on Mac do not log per-screen access (the Mac process IS the lawyer per `case-box-step-7`). Mini-program read access logging policy: decided in the SYNC WI per `docs/adr/sync-bridge-architecture.md` §"Audits every operation".
- **Tamper-evidence**: hash chain + chain-verifier helper, already in `case-box-contract` Step 4.

#### §12 AI / LLM boundaries

- **v1**: AI / LLM extraction is **INDEFINITELY POSTPONED**. Deterministic stub or fully manual entry is the v1 path.
- The existing `docs/adr/case-box-step-8-llm-extractor-policy.md` ADR remains as **future policy only**, not an active implementation roadmap. No v1 WI targets it.
- The `llm_extraction` value in source-type enums (e.g. Step-6 docket source) is **contract vocabulary** retained for forward provenance; v1 has no producer of LLM-sourced rows.
- Forbidden under any future enablement:
  - Auto-accept facts (always candidate-only).
  - Auto-confirm deadlines.
  - Auto-mark privilege or confidentiality.
  - Prompt-leak to any user-visible surface.

#### §13 Collaboration / multi-user expectations

- **v1**: single-user. `actor_user_id = "local-user"` sentinel valid only while: local-only Mac, no sync bridge, no remote LLM, no multi-user write path.
- Data shape multi-user-ready: `tenant_id` + `actor_user_id` required on every row.
- Single-firm-multi-user phase: **indefinitely deferred** under this brief.
- Multi-firm SaaS: NOT v1.
- Auth provider choice: STOP-AND-ASK. The mini-program's login gate (§5) requires an auth **seam interface** to be planned in any future SYNC WI; the **provider** itself remains STOP-AND-ASK.

#### §14 Export / backup / archive

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

#### §15 Security / compliance

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

#### §16 Deployment / distribution

- v1: single Mac binary, direct download (channel TBD).
- Code-sign + notarize: STOP-AND-ASK (Apple Developer ID, notarization profile).
- Auto-update: manual v1. Mechanism (Sparkle / electron-updater / custom) = STOP-AND-ASK.
- Crash reporting: OFF default; opt-in only.
- Mac App Store vs direct vs in-firm IT: STOP-AND-ASK.

#### §17 Business model

**INDEFINITELY POSTPONED.** v1 architecture decisions are not blocked on monetization.

#### §18 Must-have v1 day-one / acceptable-deferred / post-v1

##### v1 day-one MUST-HAVE

- Mac desktop app shell (CLIENT-01, CLIENT-02, CLIENT-03 WIs).
- Local case box with **`matter_type` enum reconciliation** (purpose-tag and party_side and successor_matter_id extensions per R-5; deadline kind vocabulary per R-5).
- §7.A and §7.B **(v1) sub-entities only** persisted, edited, and viewed locally. (POST-V1 sub-entities NOT day-one.)
- OCR pipeline embedded in-process (existing).
- Original file retention for every ingestion path.
- Manual-paste fallback for PDF/Word/MD text content (in lieu of automated text extraction).
- Append-only hash-chained audit log (existing).
- Visible overdue-deadline list in the case-box UI.
- Per-screen case-box UI tailored to the two v1 workflow categories.

##### v1 acceptable-deferred (DOES NOT block v1 ship)

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

##### Post-v1 (no v1 budget)

- Sync bridge (SYNC-01..05) — under reconciliation per R-1/R-2/R-3.
- Mini-program (SYNC-06+), including login gate, screenshot upload, original download.
- Cloud-sync targets.
- LLM remote extractor (kept as future policy only).
- Multi-user / multi-firm.
- Browser SPA (indefinitely postponed).
- Windows / Linux / iPad / mobile.
- Monetization.
- Document text-extraction engine (separate STOP-AND-ASK ADR before any code).

#### §19 Explicit non-goals

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

#### §20 Hard-stop decisions

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

### Reconciliation log

> **Reading note (2026-08-10).** Entries below were written while
> `docs/product/product-target-architecture.md` was a separate file. That file is now **Appendix A of this
> document**; every reference to it in these entries resolves there. The entries are left as originally
> written — they are a record of how each conflict was resolved, and rewriting them would falsify that
> record.

Each entry: brief section, conflicting source, prior wording, brief's new wording, proposed resolution.

#### R-1 — Mini-program login gate forces auth-seam contract planning (post-v1)

- **Brief section**: §5, §13.
- **Conflicting source**: `docs/adr/sync-bridge-architecture.md` and `docs/adr/case-box-step-7-multi-user-readiness.md`.
- **Prior wording**: Bridge "authenticates when the bridge ships — but the auth provider is a Stop-and-Ask gate. Test-mode auth is the only seam recorded in SYNC-00." Single-user posture valid "only while no sync bridge is enabled".
- **Brief's new wording**: §5 explicitly requires login-gated lawyer-only access for the mini-program. Unauthenticated users reach only the login screen. The auth **provider** stays STOP-AND-ASK; the auth **seam interface** must be planned in any future SYNC WI BEFORE the mini-program ships.
- **Severity**: Medium (existing sync ADR already contemplates a seam; the conflict is principal-model maturity, not seam existence).
- **Proposed resolution**: SYNC-01 (sync bridge scaffold) WI absorbs the auth-seam contract design. ADRs NOT silently rewritten. Treat as **part of the post-v1 SYNC reconciliation program** (see R-1/R-2/R-3 grouped resolution at the end of this log).

#### R-2 — Mini-program download of original files expands SYNC scope (post-v1)

- **Brief section**: §5, §14.
- **Conflicting source**: `docs/product/product-target-architecture.md` §"Sync Bridge Role" and `docs/adr/sync-bridge-architecture.md`.
- **Prior wording**: "NO bulk export, NO submit-new-document at v1 bridge launch, NO privilege-log export." Sync bridge endpoints sketched as "case summary, OCR job status, page view".
- **Brief's new wording**: §5 requires the post-v1 mini-program to support download of authorized original files and extracted-text artifacts, with explicit gates: auth + grant + privilege + confidentiality + audit. NOT bulk export; per-doc / per-matter authorized.
- **Severity**: High (qualitative scope expansion of the bridge).
- **Proposed resolution**: separate WI under the post-v1 SYNC reconciliation program. Bridge contract draft (`docs/ui/sync-bridge-contract-draft.md`) extends with binary-original download + extracted-text download endpoints. Security sign-off included.

#### R-3 — WeChat screenshot upload introduces inbound document-ingestion write surface (post-v1)

- **Brief section**: §5, §7.A, §7.B.
- **Conflicting source**: `docs/adr/sync-bridge-architecture.md` (read-mostly framing) and `docs/adr/case-box-step-0-boundary.md` §1 (ingestion via Mac desktop only).
- **Prior wording**: Bridge writes limited to "cancel, accept/reject candidate fact, quick-note". Ingestion implied Mac-desktop only.
- **Brief's new wording**: §5 + §7 require WeChat screenshots uploaded via the post-v1 mini-program to become `CaseBoxDocument` rows. Defined as "system-original = uploaded bytes; NOT legal proof of underlying chat".
- **Severity**: Critical (qualitatively larger than current bridge writes; introduces inbound document-ingestion surface; needs separate security sign-off).
- **Proposed resolution**: separate WI under the post-v1 SYNC reconciliation program. Bridge contract draft extends with screenshot-upload endpoint (size limits, MIME types, content-hash, confidentiality classification at upload time, audit event shape). Security sign-off required.

#### R-1/R-2/R-3 grouped resolution — Post-v1 SYNC reconciliation program

R-1, R-2, and R-3 together expand the SYNC track from the current "narrow read + minimal write" framing to a full mini-program companion. These three reconciliation items are NOT treated as routine post-READY follow-ups. They constitute a **post-v1 reconciliation program** that must run as a sequence of separate WIs:

1. SYNC reconciliation WI-a — auth-seam contract design.
2. SYNC reconciliation WI-b — authorized read endpoints (existing + tighten gates).
3. SYNC reconciliation WI-c — authorized original-file + extracted-text download (R-2).
4. SYNC reconciliation WI-d — authorized screenshot upload (R-3).
5. SYNC reconciliation WI-e — audit event family for all of the above (per §11 mini-program audit shape).
6. SYNC reconciliation WI-f — conflict-resolution policy for concurrent mini-program + Mac writes.

Each carries its own `/cc-suite:review-plan` pass. NONE land in v1 day-one.

#### R-4 — Multi-user phase tightened from "near-future" to "indefinitely deferred"

- **Brief section**: §13.
- **Conflicting source**: `docs/product/product-target-architecture.md` (Future Work Items, `TENANT (deferred)`); `case-box-step-7-multi-user-readiness.md` (describes single-firm-multi-user as "future near-term").
- **Prior wording**: "Near-future" / "future near-term".
- **Brief's new wording**: Single-firm-multi-user is **indefinitely deferred**.
- **Severity**: Low (product-direction tightening; no schema change; existing Step-7 invariants stand).
- **Proposed resolution**: docs-only reconciliation WI demotes `TENANT` in `product-target-architecture.md` Future Work Items.

#### R-5 — Matter-type vocabulary alignment + additive contract surface for v1 §7 sub-entities (v1 day-one)

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

#### R-6 — Document text extraction (non-OCR) DEFERRED from v1 day-one to post-v1

- **Brief section**: §6, §8, §15, §18, §20.
- **Conflicting source**: `docs/adr/case-box-step-0-boundary.md` §4 ("OCR runs locally via `paddleocr-onnx`") and `docs/product/product-target-architecture.md` (only OCR engine mentioned).
- **Prior wording (revision 1 of this brief, now corrected)**: "NEW v1 surface; engine STOP-AND-ASK; day-one must-have" — this created a v1-day-one × STOP-AND-ASK deadlock.
- **Brief's new wording**: **Document text extraction is post-v1** with engine choice as a separate STOP-AND-ASK ADR. v1 day-one supports PDF / Word / MD ingestion-and-original-retention with a manual-paste fallback for searchable text. No automated extraction lands in v1.
- **Severity**: Low (now downgraded — was Critical when day-one × STOP-AND-ASK conflicted).
- **Proposed resolution**: open a post-v1 ADR-draft WI for the text-extraction engine choice. NOT a v1 blocker. v1 day-one ships without it.

#### R-7 — Original file retention as load-bearing v1 invariant

- **Brief section**: §6, §7, §9.
- **Conflicting source**: None directly — `case-box-step-0-boundary.md` §4 already references content-hash-addressed local storage.
- **Brief's new wording**: Promote "original file retention" to an explicit cross-cutting v1 invariant for discoverability.
- **Severity**: Low (consistent with existing posture).
- **Proposed resolution**: small docs-only WI to append "Original file retention" to `case-box-step-0-boundary.md` cross-cutting invariants and `product-target-architecture.md` Cross-cutting Invariants. Not blocking.

#### R-8 — LLM scope tightened from "feature-flagged future opt-in" to "indefinitely postponed"

- **Brief section**: §12, §18.
- **Conflicting source**: `docs/adr/case-box-step-8-llm-extractor-policy.md` and `docs/product/product-target-architecture.md` §"Data Residency" (LLM listed as opt-in path).
- **Prior wording**: LLM "feature-flagged, opt-in per case, candidate-only output".
- **Brief's new wording**: AI / LLM indefinitely postponed. Step 8 ADR stays as **future policy only**, not an active roadmap item. `llm_extraction` enum values across the contract remain (vocabulary-only; no v1 producer).
- **Severity**: Low (policy-direction tightening; Step-8 ADR is already policy-only with no implementation).
- **Proposed resolution**: docs-only reconciliation WI demotes `CASE-BOX Step 8` in `product-target-architecture.md` Future Work Items.

#### R-9 — Lawyer-letter and contract-review lifecycle state machines (POST-V1)

- **Brief section**: §7.B, §18.
- **Conflicting source**: None — case-box contract does not yet model these entities.
- **Brief's new wording**: v1 captures lawyer letters and contract reviews as `CaseBoxDocument` rows with purpose tags + free-text lifecycle fields (date / service status / authorization / preliminary evidence summary / review date / final-version marker). Full state-machine modeling for these workflows is **post-v1**.
- **Severity**: Low (post-v1 product-direction note; v1 free-text capture is sufficient).
- **Proposed resolution**: post-v1 ADRs (`case-box-lawyer-letter-lifecycle.md`, `case-box-contract-review-lifecycle.md`) when those workflows mature.

### Sources consulted

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

### Suggested follow-up WIs

(In sequence; each opens after `/cc-suite:review-plan` returns READY on this brief.)

1. **WI-brief-matter-type** *(v1, FOUNDATIONAL — blocks all other v1 case-box work)* — additive contract amendment covering all ten R-5 items: (a) `CaseBoxDocument.purpose` enum, (b) `work_order_status` enum, (c) free-text lifecycle fields on documents, (d) `supersedes_document_id`, (e) `CaseBoxFact.purpose` enum, (f) `CaseBoxFact.as_of_date`, (g) `CaseBoxEvidenceItem.party_side`, (h) `CaseBoxMatter.successor_matter_id`, (i) deadline `kind` vocabulary extension (`payment | evidence_submission | appeal | hearing`), (j) `CaseBoxMatter` litigation-specific free-text fields (`case_type_text`, `case_progress_text`, `court_contact_text`, `contention_summary_text`). Also pins the optional-vs-nullable schema convention for the WI. ADR amendments to `case-box-step-0` entity list, `case-box-step-2` (fact purpose + as_of_date), `case-box-step-6` (deadline kind), and the matter + document + evidence schemas. Carries `/cc-suite:review-plan`. Resolves R-5.
2. **WI-brief-doc-reconcile** *(v1, docs-only)* — update `product-target-architecture.md` Future Work Items: demote `TENANT`, `BROWSER SPA`, `CASE-BOX Step 8` to "indefinitely deferred"; append "Original file retention" to cross-cutting invariants; note the post-v1 SYNC reconciliation program. Resolves R-4, R-7, R-8 and the §3 browser SPA wording.
3. **WI-brief-doc-text-extract-policy** *(post-v1, ADR-draft)* — ADR for non-OCR document text extraction engine selection. STOP-AND-ASK runtime dependency. Resolves R-6. NOT v1.
4. **WI-brief-sync-reconciliation-program** *(post-v1; multi-WI)* — opens the six-WI program for SYNC: auth seam (R-1), authorized reads, authorized download (R-2), authorized upload (R-3), audit event family, conflict resolution. Each runs `/cc-suite:review-plan` independently.
5. **WI-brief-lawyer-letter-and-contract-review-lifecycle** *(post-v1)* — ADRs for lawyer-letter and contract-review state machines. Resolves R-9. NOT v1.
6. **WI-brief-redaction-policy** *(post-v1)* — ADR for redaction (before any redaction code).

### Hard-stop decisions (STOP-AND-ASK checklist)

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

### Stop condition

This brief is stale or superseded when any of the following occurs:

- A subsequent brief at the same path raises `supersedes: docs/product/project-requirements-brief.md` (in frontmatter) and reaches `READY`.
- A product pivot (new matter category, new primary platform, new monetization shape) materially invalidates §1, §3, §7, or §17.
- A reconciliation entry updates an ADR in a way that contradicts a section here without a matching brief amendment.

In any of those cases the brief is amended in place (status `AMENDMENT-PENDING-REVIEW`) and re-reviewed by
whatever review path is then in force before returning to `READY`.

---

## Appendix A — Target architecture (v1)

*Absorbed 2026-08-10 from `docs/product/product-target-architecture.md` (promoted 2026-05-20 from
`dev-memo/plan-client-00.md`, commit `a07e5d1`). A derived single-page summary of the direction stated
above; the deeper decisions live in the linked ADRs.*

### A.1 v1 product shape

The v1 product is a **case-box workspace for one lawyer**, running locally on a Mac. The OCR pipeline is a
subordinate data feed: it turns scanned legal documents into searchable text that the case box references.
The lawyer's daily work happens at the case (matter) level — facts, issues, claims, elements, evidence,
deadlines, privilege markers, risks, next actions, audit trail — not at the OCR-job level.

**Ships v1 day-one:** a Mac desktop application · a local case box per
`docs/adr/case-box-step-0-boundary.md` · the existing OCR pipeline embedded in-process · an append-only
hash-chained audit log under the lawyer's user-controlled path.

**Does NOT ship v1 day-one:** any network surface on the default workflow · WeChat mini-program · browser /
web UI · cloud sync · LLM candidate-fact extraction (**indefinitely postponed** per R-8; the deterministic
stub is the v1 extractor) · deadline computation engine (data model present, engine post-MVP) ·
multi-user auth.

### A.2 Primary user

A single lawyer (or law-firm staff working on the lawyer's behalf) on a Mac. They hold confidential
documents that must not leave the machine by default; work one or more matters at a time; review OCR output,
accept/reject candidate facts, bind facts to claim elements as evidence citations, mark privilege, track
deadlines, export privilege logs. They do **not** administer a multi-tenant SaaS, register users, configure
cloud backends, or write code.

Browser users, multi-firm SaaS operators, and mobile-first paralegals are **not** v1 primary users.

### A.3 Client surfaces

| Surface | Status | Notes |
|---|---|---|
| Mac desktop app | **v1 primary** | In-process embedding of `ocr-*` and `case-box-*` libraries. No network on the default path. Per `docs/adr/client-application-surface.md`. |
| WeChat mini-program | **Deferred companion** | Post-v1 only. Reaches the case box via the sync bridge (`docs/adr/sync-bridge-architecture.md`). Read-mostly + minimal write. Sees only what the lawyer explicitly exposes. |
| Browser / web UI | **Indefinitely postponed** | No v1 or post-v1 architectural budget (§3). The Electron renderer is Mac-app-local, not a published web app. A standalone browser SPA is not planned. |
| Windows / Linux desktop | Deferred | Mac-only v1. |
| iPad / native mobile | Deferred | |
| Multi-firm SaaS | **Not v1** | `tenant_id` retained in the data shape for forward compatibility only. |

### A.4 Data residency

| Aspect | v1 default | Opt-in path |
|---|---|---|
| Documents | Local filesystem under a user-controlled path (default `~/Library/Application Support/lawbar/`); identified by `content_hash`; SQLite stores metadata only. **Originals retained verbatim** (A.9 §11). | None v1; future per-document sync grant |
| Case-box source of truth (cases, documents, facts, issues, claims, elements, evidence, deadlines, privilege, risks, actions) | Local SQLite under a user-controlled path | None v1; future per-matter sync grant |
| Audit log | Separate local SQLite file with hash chain, user-controlled path | None v1 — the audit log stays local |
| OCR engine | Local `paddleocr-onnx` — **scanned/image PDFs and image files/screenshots only** (§8) | Future external OCR worker, opt-in per document, restricted to `confidentiality_class = normal` |
| Document text extraction (non-OCR) | **None v1.** PDF text-layer / Word / MD / other office formats retained verbatim; recourse for searchable text is manual paste (§6) | Post-v1 STOP-AND-ASK decision on engine + dispatch policy + text-layer detection |
| LLM candidate-fact extraction | **Indefinitely postponed** (R-8); the deterministic stub remains the v1 extractor | None planned; re-opens only on explicit user authorization |
| Encryption at rest | macOS FileVault (system-level) | Per-document encryption deferred post-MVP |

**Default = no cloud, no network egress, no LLM remote call.** Sync is a deliberate user-driven act per
document or per matter. The normal workflow produces zero outbound traffic apart from outbound OCR-source
fetches when the lawyer explicitly submits a URL-sourced document (retaining WI-03's DNS-pinning / SSRF
posture unchanged).

### A.5 Sync-bridge role

Per `docs/adr/sync-bridge-architecture.md`: **off by default** (no listener in the v1 default workflow) ·
**opt-in per document or matter** (the bridge consults the grants table before exposing any record; no grant
→ undifferentiated 404, which does not leak existence) · **narrow surface** (read endpoints first, writes
routed through the coordinator; no bulk export, no submit-new-document, no privilege-log export at launch) ·
**audits every operation** (hash-chained; reads MAY log, writes MUST log) · **authenticates** when it ships,
though the auth provider is a stop-and-ask gate · **separate security sign-off** (WI-03 covers outbound
only; the inbound surface needs its own).

The bridge is the architectural seam through which **all** companion clients reach the case box. There is no
other inbound network surface.

### A.6 Mini-program and browser surfaces

**WeChat mini-program** — a deferred companion channel. When it ships (post-v1, after the sync bridge):
read-mostly (writes wait for SYNC-03); sees only what the lawyer explicitly exposes; authenticates through
the bridge's auth seam; cannot consume Node libraries directly (HTTP-only). Publication requires a
registered Chinese business entity and a WeChat developer account — out of v1 scope.

**Browser / web UI** — indefinitely postponed. The Electron renderer IS a Chromium browser, but it is
Mac-app-local, not a published web app. The GW-00 ADR's original framing of a public-internet API + browser
SPA is explicitly rejected. Re-authorizing a browser SPA would open a new reconciliation entry.

### A.7 Roadmap — future work items

Priority order. **None is authorized by this document**; each requires its own gate per §20.

| WI | Subject | Gate |
|---|---|---|
| **CLIENT-01** | Desktop shell framework selection (recommended: Electron) | Stop-and-ask: new runtime dependency |
| **CLIENT-02** | Renderer UI framework selection | Stop-and-ask: new runtime dependency |
| **CLIENT-03** | `apps/lawbar-desktop/` scaffold (main process, IPC bridge, preload, empty renderer) | after CLIENT-01 + 02 |
| **CASE-BOX 1** | `case-box-contract`: schemas, state machines, validators, generated types | regular |
| **CASE-BOX 2** | `case-box-persistence`: in-memory + SQLite conformance, replay-safe writers, audit hash chain | regular |
| **CASE-BOX 3** | `case-box-ingestion`: case-create, document-upload, OCR submission, `ocr_job_link` sync | regular |
| **CASE-BOX 4** | Candidate-fact stub extractor (deterministic; pluggable) | regular |
| **CASE-BOX 5** | `case-box-review`: chronology, proof matrix, document index, privilege log | regular |
| **CASE-BOX 6** | Privilege markers + audit + export hooks fully wired | regular |
| **CLIENT-04+** | Per-screen implementation (S2 list → S3 detail → S4 read → S1 submission → S6 cancel → S5 manual review), then case-box screens | regular |
| **CLIENT-05** | Coordinator-mediated cancel in `services/ocr-worker` | Stop-and-ask: contract / lifecycle change |
| **AUTH** (deferred) | Auth provider selection; re-opens when the sync bridge ships, the multi-user phase begins, the mini-program ships, or a remote LLM extractor is enabled | Stop-and-ask: auth |
| **TENANT** (indefinitely deferred) | Single-firm-multi-user phase — demoted per R-4 | Stop-and-ask after AUTH |
| **SYNC-01** | Sync-bridge scaffold (package, auth seam, sync-grants persistence) | Stop-and-ask: inbound network surface |
| **SYNC-02** | Bridge read endpoints | after SYNC-01 |
| **SYNC-03** | Bridge write endpoints; first bridge security sign-off | Stop-and-ask: inbound write surface |
| **SYNC-04** | Sync-grants management UI | regular |
| **SYNC-05+** | Cloud-sync target adapters | Stop-and-ask: external account / cloud vendor |
| **SYNC-06+** | WeChat mini-program client | Stop-and-ask: external account, third-party SDK, business entity |
| **CASE-BOX 7** | Deadline declarative-rules engine (post-MVP) | regular |
| **CASE-BOX 8** | LLM extractor — **indefinitely deferred** per R-8; the policy ADR applies only IF re-authorized | Stop-and-ask; explicit user authorization only |
| **CASE-BOX 9** | Multi-user auth boundary | Stop-and-ask after AUTH |
| **DEPLOYMENT** | macOS code-signing + notarization; distribution channel | Stop-and-ask: operational |
| **GO-LIVE** | Final go-live readiness sign-off | hard stop (§20) |

### A.8 Deployment (deferred)

v1 ships as a single Mac binary. Deferred: macOS code-signing identity (Apple Developer ID) and notarization
profile (required before non-developer distribution) · distribution channel (direct download, Mac App Store,
in-firm IT) · auto-update strategy · crash-reporting backend, which must be **off by default** to preserve
the confidentiality posture, opt-in if added. All remain stop-and-ask per §20.

### A.9 Cross-cutting invariants (always true, v1)

1. **Local-first by default.** No network egress on the default workflow except the OCR worker's outbound
   HTTPS fetch (WI-03 hardened) when the lawyer explicitly submits a URL-sourced document.
2. **Coordinator owns OCR lifecycle.** Renderer / case-box / sync bridge never write to `ocr-persistence`
   directly; all state transitions go through `OcrProcessingCoordinator`.
3. **Audit every write.** Every source-of-truth mutation produces a hash-chained audit event in the same
   logical transaction.
4. **LLM / automation outputs land as candidate.** Never auto-promoted to accepted.
5. **Privilege defaults to unmarked = NOT privileged.** An explicit marker is required.
6. **No deletion of legal artifacts.** Soft-delete with an audit reason; hard delete only via an explicit
   retention policy (post-MVP).
7. **`tenant_id` retained.** Single tenant in v1; the data shape stays multi-user-ready.
8. **`actor_user_id = "local-user"`** is the v1 default, valid only while local-only (no sync bridge, no
   remote LLM, no multi-user).
9. **No foreign key from case-box to OCR.** Cross-boundary references by value (`ocr_job_id`) only.
10. **No widening of the public error surface.** Internal `HttpsTransportError` discriminators never leak
    through IPC, the bridge, or any client-facing surface.
11. **Original-file retention.** Every ingested file is preserved verbatim, content-hash-addressed at a known
    `storage_uri`, and openable from the Mac desktop process. No extraction step (OCR, text extraction,
    redaction) destroys or replaces the original; extraction artifacts are stored alongside it, never in
    place of it. (Per R-7.)

### A.10 References

`docs/adr/case-box-step-0-boundary.md` (case-box product boundary) ·
`docs/adr/client-application-surface.md` (v1 primary client architecture) ·
`docs/adr/sync-bridge-architecture.md` (opt-in companion HTTP surface) ·
`docs/ui/sync-bridge-contract-draft.md` (bridge endpoint reference) ·
`dev-memo/plan-client-00.md` (client-surface reconciliation; D2 source) ·
`dev-memo/superseded/case-box-plan.md` (pre-Phase-0 plan, historical) ·
`docs/ui/current-ui-map.md`, `docs/ui/ui-state-contract.md`, `docs/ui/ui-gap-report.md` (OCR-layer UI
inventory) · `docs/release/wi-03-security-signoff.md` (outbound HTTPS / SSRF / DNS-pinning sign-off) ·
`docs/release/go-live-plan.md` (gates, per-package test commands) ·
`docs/product/evidence-m0-prd.md` (Evidence-Genie M0 product definition).

# Part II — Evidence-Genie M0

---

## Evidence-Genie M0 — product definition

*Absorbed 2026-08-12 from `docs/product/evidence-m0-prd.md`. Content verbatim; heading levels shifted one deeper.*


Single product-definition document for Evidence-Genie M0: requirements, invariants, user flows, content
inventory, and acceptance scenarios. Supersedes and absorbs the former `evidence-m0-user-flows.md`,
`evidence-m0-content-inventory.md`, and `evidence-m0-acceptance-scenarios.md` (merged 2026-08-10; content
preserved, duplicated boilerplate removed).

### 1. Status / scope boundary

**Official product-definition document. NOT implementation authorization.** It defines *what the product
should say and do*; building it is gated by the engineering lanes.

**Every UI / anchor / export behavior described here is gated behind A0.7** (the renderer/geometry
conformance gate). A0.7 is **not green**. **This document makes no A0.7-green claim and defines no A0.7
marker.**

Surviving sources: `docs/reference/evidence-genie-m0-developer-handover.md`,
`docs/adr/ADR-evidence-m0-xiaolai-workflow-composition.md` (EVW-00),
`dev-memo/plan-batch-casebox-evidence-product-definition-00.md` (EPD1),
`docs/product/project-requirements-brief.md`.

> **Provenance note.** §5 below previously lived in `.claude/rules/evidence-genie.md`, an agent-scaffolding
> file removed in the 2026-08-10 configuration reset. These are **court-facing product invariants**, not
> agent workflow rules, so the product definition now owns them directly. One former invariant (an
> echo-sleuth pre-flight wording rule) was workflow-only and retired with the scaffolding.

### 2. Problem statement

A single lawyer preparing for and conducting a Chinese court hearing must work from both sides' paginated
evidence PDFs, build structured work-product (证据目录 / 举证质证表 / 质证记录) by hand, cite precisely by
证据号 and 卷X页Y, and — in an air-gapped courtroom — instantly navigate to a pre-marked page/region and
restate the excerpt. Today this is manual, error-prone, and hard to keep citation-stable across
close/reopen/export, with no reliable freeze/snapshot for a defensible, reproducible bundle. Evidence-Genie
M0 is the **human-verifiable manual substrate** that makes evidence navigation, citation, freezing, and
export reliable — offline, on the lawyer's own Mac.

### 3. Target user and environment

- **User:** a single lawyer (一名律师) or law-firm staff, working one matter at a time. No multi-user, no
  firm portal. Parties referenced in evidence: **原告** (plaintiff), **被告** (defendant), **法院** (court).
- **Environment:** **macOS desktop**, **local-first / offline**, **air-gapped-capable** — hearings run on a
  counsel-controlled Mac with no network. Confidential material **never leaves the Mac** unless the lawyer
  takes a deliberate action. The offline guarantee is **OS-enforced** (App Sandbox, no network
  entitlements), not convention.

### 4. Scope

**In scope (M0)** — all gated behind A0.7:
- Import **both sides' paginated PDFs** with 证据目录; set the canonical original.
- **Manual page/region linking** — the lawyer draws a hyperlink to a target page/region (anchor).
- Navigation/citation vocabulary: **证据目录 / 证据号 / 卷X页Y**; navigation by physical page + drawn rect.
- **Hearing lookup** by 证据号, by page, and by anchored region.
- **Freeze → snapshot → backup/restore** (point-in-time, read-only, verifiable, confidential bundle).
- **Export** with reproducible **卷页** citations (court-fileable 证据目录 / 举证质证表 / 质证记录).
- **Readable compression** as a **quality gate** — size reduction that never alters
  citation/geometry/page-count/anchor behavior/readability; the original is always retained + hashed.

**Out of scope (M0)** — the product offers no such capability and makes no such promise:
OCR · AI/VLM extraction · cloud / public deployment / sync-by-default · auth / multi-user / multi-firm SaaS ·
external database services · evidence-weight scoring or ranking · cross-case templates beyond the manual
forms · non-Mac platforms (Windows / iPad / mobile / browser).

### 5. Product invariants (must hold; never weakened without an ADR)

1. **macOS-only, local-first / offline-first.** OS-enforced (App Sandbox, no network entitlements). Never
   reframed as browser-first, multi-tenant, or default-on-cloud.
2. **Manual-truth-only M0 scope.** No OCR, AI/VLM, external databases, evidence-weight scoring, cloud sync,
   auth provider, or network behavior. Lawyer-entered fields are authoritative and court-facing.
3. **A0.7 renderer-conformance is the first real Evidence architecture gate.** It must be built and green
   before downstream Evidence architecture, classifying each failure **class-1** (local normalization bug,
   fixable inline) vs **class-2** (geometry-source instability — architectural STOP). A class-2 result stops
   downstream work; do not build anchors / forms / UI on top of it.
4. **No Evidence UI before A0.7 is green.** A stop-grade boundary, not advice.
5. **Citation identity comes only from `DocumentPage`.** Every citation derives solely from
   `documentId + physicalPageIndex → citationVolume + citationPageLabel`, byte-stable across
   close/reopen/export — never page-index arithmetic, never an optimized rendition. An ambiguous citation
   (mapping to more than one physical page in scope) is disambiguated or refused+warned, **never guessed**.
6. **Anchors persist page-ratio geometry against captured page geometry**, never viewport/screen pixels —
   resolved box origin subtracted, rotation-aware, version-pinned to `geometryCapturedAt`, in PDF page
   space. A replacement or geometry-version mismatch yields `needs_review`, **never a stale location**.
7. **`OptimizedDocumentRendition` is never the canonical citation/anchor source.** The uploaded original is
   authoritative. An optimized rendition is a display/size convenience only, usable after geometry + anchor
   + readability verification. Readable compression, never destructive canonicalization.
8. **Snapshot manifest/seal anti-circularity is preserved.** The `SnapshotManifest` hashes a deterministic
   **logical** payload, NOT the encrypted DB file that holds the seal; a separate `SnapshotSeal` makes the
   manifest tamper-evident. This anti-circularity must not be collapsed.
9. **`CanonicalExportModel` is the reproducibility layer** — deterministic serialization, byte-identical
   across display / re-export / restore. Raw `.docx`/PDF bytes are **not** hashed by default; use
   canonicalized artifact hashing only where the renderer is controlled.
10. **`not_implemented` fails, never passes.** Any Evidence harness not yet implemented exits non-zero and
    reports `not_implemented` as a **failure**. It never satisfies a gate.
11. **A future AI suggestion layer is build-flagged and separate from manual truth.** Any machine/AI
    suggestion output lives in a separate migration namespace (`Manual*` ≠ `Extracted*`), promoted into
    manual tables only by explicit lawyer review. It must never overwrite or masquerade as manual truth.

### 6. A0.7-first dependency

**A0.7 `renderer-conformance` is the first real Evidence architecture gate.** It validates PDFKit coordinate
fidelity + page-identity stability on real messy 卷宗, classifying each failure class-1 (normalization,
fixable) vs class-2 (geometry-source instability, architectural stop).

**No Evidence UI ships before A0.7 is green.** Nothing in §4 or §7 is buildable until A0.7 passes; a class-2
result reopens the geometry-source assumption before any anchor / forms / UI work.

### 7. User flows

Flow map: **F1** workspace setup · **F2** import PDFs · **F3** build 证据目录 · **F4** manual anchor ·
**F5** pre-hearing review · **F6** hearing navigation · **F7** freeze/snapshot/restore · **F8** export.

#### F1 — Case workspace setup
Create a local case workspace for one matter. **Steps:** create a case (案号, 案由, parties 原告/被告, 法院);
choose a local storage location. **Intended response:** a local, offline workspace; nothing leaves the Mac.
**Edge:** unwritable location → clear error, no silent partial state. **Invariants:** 1. *A0.7-gated (UI).*

#### F2 — Import both sides' paginated PDFs
Bring in 原告/被告 (and 法院, if any) paginated evidence PDFs as canonical originals. **Steps:** import each
PDF; assign party; mark canonical. **Intended response:** each import captures page identity + geometry and
locks the canonical original (preserved + hashed); page count recorded. **Edge:** unreadable / rotated /
mixed-size pages are surfaced, not guessed; a class-2 geometry instability is an architectural stop, not a
workaround. **Invariants:** 3, 7. *A0.7-gated — page identity + geometry capture is exactly what A0.7
validates.*

#### F3 — Build 证据目录 and evidence numbering
Assemble the per-party catalogue with 证据号. **Steps:** add evidence items (title, party, 证据号, physical
page start/end). **Intended response:** items map to `DocumentPage`; citation labels (卷X页Y) derive solely
from `DocumentPage`; duplicate labels allowed but an ambiguous range is flagged, never guessed. **Edge:**
start>end rejected; non-citable / cross-volume ranges flagged. **Invariants:** 5.

#### F4 — Manually link evidence to page and region (anchor)
The lawyer draws a hyperlink to a target page/region. **Steps:** open the page, draw a rectangle over the
region, attach it to an evidence item / note / claim. **Intended response:** the anchor is stored as a
page-ratio rect against the persisted geometry version (box origin subtracted, rotation-aware) — never
screen/viewport pixels. **Edge:** geometry-version mismatch or replaced page → `needs_review`, never a stale
location. **Invariants:** 6. *A0.7-gated.*

#### F5 — Pre-hearing review and lookup
Verify the bundle and rehearse lookups. **Steps:** look up by 证据号, by 卷X页Y, and by anchored region;
review coverage gaps. **Intended response:** each lookup resolves deterministically to the cited
`DocumentPage` and anchored region; unresolved / `needs_review` anchors are shown, not hidden. **Edge:**
broken / quarantined anchors surfaced; **freeze is blocked while `needs_review` exists**. **Invariants:**
5, 6. *A0.7-gated.*

#### F6 — Hearing-mode navigation and excerpt restatement
In the air-gapped hearing, jump to a pre-marked page/region and restate the excerpt. **Preconditions:** a
verified, frozen snapshot (F7); offline Mac. **Intended response:** instant, offline navigation to the exact
physical page + anchored region; only verified renditions are shown. **Edge:** no network dependency; an
unverified rendition is never used in hearing mode. **Invariants:** 1, 7. *A0.7-gated.*

#### F7 — Freeze / snapshot / backup / restore
Produce a defensible, point-in-time, read-only bundle and restore it. **Preconditions:** no unresolved
`needs_review` (F5). **Steps:** freeze the case; back up the bundle; restore on another counsel Mac with the
user-held passphrase. **Intended response:** a snapshot whose manifest + separate seal are tamper-evident
(anti-circular); restore reproduces a byte-identical canonical model, citations, and anchors. **Edge:** any
post-freeze byte change is detected; a forgotten passphrase is unrecoverable; a frozen snapshot is never
migrated in place (read-only on a newer app). **Invariants:** 8. *A0.7-gated.*

#### F8 — Export with reproducible 卷页 citations
Produce court-fileable 证据目录 / 举证质证表 / 质证记录. **Preconditions:** a frozen snapshot (F7). **Steps:**
choose an export type; generate the document. **Intended response:** citations render through a single
contract from `DocumentPage`; the `CanonicalExportModel` is byte-identical across display / re-export /
restore; in-app links degrade to textual 卷X页Y or an explicit flag, **never dropped or silently wrong**.
**Edge:** non-citable / cross-volume / ambiguous citations flagged, not guessed; rendered `.docx`/PDF are
deterministic only where the renderer is controlled. **Invariants:** 9. *A0.7-gated.*

### 8. Surface inventory

A **content inventory, not a component spec** — it names surfaces and copy but invents no UI widgets or
architecture and authorizes no UI build. Each entry: purpose · key fields · warning · empty · error. **All
surfaces are gated behind A0.7.**

1. **Case workspace** — hold one matter locally. Fields: 案号, 案由, 原告, 被告, 法院. Warning: "Local-only /
   confidential — stays on this Mac." Empty: "No case selected." Error: "Storage location unwritable."
2. **Party / court / case metadata** — capture parties + court. Fields: 原告, 被告, 法院, 审判长/法官.
   Empty: "No parties yet." Error: "Required field missing."
3. **Document import / pagination** — import both sides' PDFs as canonical originals. Fields: party,
   pdfPath, pageCount, status (canonical). Warning: "Optimized rendition is never the canonical
   citation/anchor source." Empty: "No documents imported." Error: "Unreadable PDF / page identity unstable
   (A0.7 class-2 — stop)."
4. **Evidence catalogue (证据目录)** — per-party catalogue with 证据号. Fields: 证据号, title, party, physical
   page start/end, citation (卷X页Y). Warning: "Ambiguous range — disambiguate, not guessed." Empty: "No
   evidence items." Error: "start>end / non-citable / cross-volume."
5. **Evidence detail** — one item + its links. Fields: title, 证据号, citation range, notes. Warning:
   "Citations derive only from `DocumentPage`." Error: "Linked page replaced — needs review."
6. **Manual page-region linking (anchor)** — draw a hyperlink to a page/region. Fields: page, page-ratio
   rect, geometry version, label. Warning: "Anchors use page-ratio geometry, never screen pixels." Empty:
   "No anchors." Error: "Geometry-version mismatch → needs_review."
7. **Pre-hearing review** — verify bundle + coverage. Fields: lookup by 证据号 / 卷X页Y / region. Warning:
   "Freeze blocked while items need review." Empty: "No items to review." Error: "Broken / quarantined
   anchor."
8. **Hearing lookup / navigation** — offline jump to a pre-marked page/region + restate. Fields: 证据号,
   卷X页Y, region. Warning: "Offline / air-gapped; only verified renditions shown." Empty: "Nothing pinned."
   Error: "Unverified rendition refused."
9. **Freeze / snapshot / backup / restore** — defensible point-in-time bundle. Fields: snapshotId, manifest
   hash, seal, passphrase prompt. Warning: "Forgotten passphrase is unrecoverable; snapshots open read-only
   on a newer app." Empty: "No snapshots." Error: "Snapshot verification failed (post-freeze byte change)."
10. **Export package** — court-fileable 证据目录 / 举证质证表 / 质证记录. Fields: export type,
    citationFormatVersion, exportTemplateVersion. Warning: "Citations render from `DocumentPage` via one
    contract; links degrade to text or an explicit flag, never dropped." Empty: "No export yet." Error:
    "Export blocked — unresolved citation / unfrozen snapshot."
11. **Settings / local storage** — storage path, app version. Warning: "No network; data stays local."
    Error: "Path unavailable."

**Empty / error state catalogue.** No case selected · No documents imported · No evidence items · Link
missing/invalid (needs_review) · Page-identity mismatch · Geometry unstable (A0.7 class-2 → stop) · Snapshot
verification failed · Export blocked. Each is shown plainly; none is silently guessed or auto-resolved.

### 9. Terminology dictionary (CN primary, English gloss)

| Term | English gloss |
|---|---|
| 证据目录 | Evidence catalogue / index |
| 证据号 | Evidence number |
| 卷X页Y | Volume X, page Y (citation) |
| 举证质证表 | Evidence-presentation / cross-examination table |
| 质证记录 | Cross-examination record |
| 原告 | Plaintiff |
| 被告 | Defendant |
| 法院 | Court |
| 案号 | Case number |
| 案由 | Cause of action |
| 审判长 / 法官 | Presiding judge / Judge |

### 10. Content principles and required copy

**Principles.** Legal accuracy over convenience — court-facing copy is precise; ambiguity is surfaced, never
guessed. Manual-truth only. Local / offline / confidential by default. No cloud / AI / OCR promise anywhere
in the copy. Cite physical pages, not rendered artifacts.

**Required warnings.** "Gated behind A0.7" on every UI/anchor/export surface · no A0.7-green claim and no
A0.7 marker in any copy · "Optimized rendition is never the canonical citation/anchor/export source" ·
`not_implemented` reports failure, never success · "Local-only / confidential — material stays on this Mac" ·
no copy promising extraction, suggestions, sharing, or sync.

### 11. Acceptance scenarios

Each scenario records invariant link · flow/surface · Given/When/Then · observable evidence · A0.7 status.
"Observable evidence" is what a lawyer (or a future test) could observe — **never an assertion that software
exists today**.

**AS-A0.7 — renderer-conformance stays red until the real harness.** *Given* the `native/evidence-core`
shim, *when* `renderer-conformance` runs, *then* it returns `status:"not_implemented"` and exits non-zero.
Observable: the JSON envelope + non-zero exit. **This scenario IS the gate** — it must stay red until the
real Swift/PDFKit harness lands and passes on messy 卷宗 with class-1/class-2 classification. Out-of-scope:
fabricating a green marker; any UI built before this is green.

**AS-A1 — citation identity from `DocumentPage`.** *Given* an evidence item (原告 or 被告) with a physical
page range, *when* its 卷X页Y citation is generated and the case is closed/reopened/exported, *then* the
citation is byte-identical and derived solely from `DocumentPage`; an ambiguous range is refused+warned.
Observable: identical 卷X页Y across close/reopen/export; explicit ambiguity warning. Invariant 5. Gated.

**AS-A3 — anchor resolution by page identity + region.** *Given* an anchor drawn as a page-ratio rect
against a geometry version, *when* the case is reopened/frozen, *then* it resolves to the same documentId +
physicalPageIndex + geometry version + rect; a mismatch yields `needs_review`. Observable: identical
resolution; `needs_review` on mismatch. Invariant 6. Gated.

**AS-A5 — manual forms (举证质证表 / 质证记录).** *Given* lawyer-entered claim/element → evidence relations
and 三性 cross-examination entries against the opposing party, *when* the forms are produced, *then* each row
cites via the single citation contract and flags proof gaps per rule. Observable: contract-rendered
citations + flagged gaps. Invariants 2, 9. Gated. Out-of-scope: machine-generated content; scoring.

**AS-A6 — typed-metadata lookup.** *Given* the catalogue, *when* the lawyer searches by typed metadata
(证据号 / party / page), *then* results resolve deterministically to the cited `DocumentPage`; coverage gaps
are listed. Observable: deterministic results + gap list. Invariants 2, 5. Gated. Out-of-scope:
full-text/OCR/AI search.

**AS-A8 — freeze / snapshot / restore integrity.** *Given* a frozen snapshot, *when* any post-freeze byte
change occurs OR it is restored on another counsel Mac with the user-held passphrase, *then* the manifest +
separate seal detect tampering and a clean restore reproduces a byte-identical canonical model, citations,
and anchors. Observable: tamper detection; byte-identical restore. Invariant 8. Gated. Out-of-scope: cloud
backup; in-place migration of a frozen snapshot.

**AS-A10 — reproducible export.** *Given* a frozen snapshot, *when* an export is generated and
re-exported/restored, *then* the `CanonicalExportModel` is byte-identical; in-app links degrade to textual
卷X页Y or an explicit flag. Observable: byte-identical canonical model; bijective link↔citation/flag.
Invariant 9. Gated. Out-of-scope: hashing raw `.docx`/PDF bytes by default.

**AS-A1-T9 — readable compression quality gate.** *Given* an `OptimizedDocumentRendition`, *when* it is
produced, *then* it is rejected for hearing/export if it changes geometry / page count / box / anchor
behavior or degrades readability; the original is always retained + hashed and remains canonical.
Observable: rejection on any geometry/readability change. Invariant 7. Gated.

**AS-OFFLINE — local-only / no cloud.** *Given* the app on a counsel Mac, *when* any flow runs, *then* no
network egress occurs and confidential material never leaves the Mac without a deliberate action; the
hearing runs air-gapped. Observable: no network activity. Invariant 1. Gated (UI).

**AS-NEG — out-of-scope requests stay refused.** *Given* a request for OCR, AI/VLM extraction, cloud
sharing, multi-user auth, or a non-Mac platform, *when* raised against M0, *then* it is out of scope — the
product offers no such capability and makes no such promise. Observable: absence of the capability +
explicit out-of-scope copy. Invariant 2. Not gated (negative).

#### Traceability matrix

| Scenario | Flow | Surface | Invariant | A0.7 |
|---|---|---|---|---|
| AS-A0.7 | F-(pre) | document-import / geometry-gate | 3 | **IS the gate** (not_implemented) |
| AS-A1 | F3/F8 | evidence-catalogue | 5 | gated |
| AS-A3 | F4/F5 | manual-page-region-linking | 6 | gated |
| AS-A5 | F8 | export-package | 2, 9 | gated |
| AS-A6 | F5 | pre-hearing-review | 2, 5 | gated |
| AS-A8 | F7 | freeze/snapshot | 8 | gated |
| AS-A10 | F8 | export-package | 9 | gated |
| AS-A1-T9 | F2/F8 | document-import | 7 | gated |
| AS-OFFLINE | F1/F6 | settings / hearing-lookup | 1 | gated (UI) |
| AS-NEG | — | all | 2 | n/a |

#### Pass/fail interpretation

- **`not_implemented` fails, never passes.** AS-A0.7 stays red until the real harness produces conformance
  evidence.
- These scenarios **make no runtime claims** — they define intended, observable acceptance, not working
  software.
- **No scenario can mark A0.7 green** and none creates an A0.7 marker; a green marker is produced only by
  the real native A0.7 harness.
- **Future implementation must produce observable evidence** per scenario before it counts as passing.

### 12. Success criteria

- The lawyer can **assemble and freeze a reliable M0 evidence bundle** (both sides' PDFs, 证据目录, anchors)
  that verifies and restores byte-identically.
- The lawyer can **navigate during the hearing** by 证据号 / 卷X页Y / anchored region, offline.
- **Exported materials preserve citations reproducibly** — canonical export model byte-identical; links
  degrade to text or an explicit flag, never dropped or silently wrong.
- The system **remains local/offline** and does not leak confidential material; the original is always
  retained and hashed; only verified renditions enter hearing mode or bundles.

*Each criterion is realized only after A0.7 is green; here they are acceptance intent, not a claim of
working behavior.*

### 13. Non-goals and hard stops (require separate authorization)

- **Swift / SwiftPM / PDFKit native core** and **macOS CI** — new runtime/toolchain.
- **Real A0.7 harness** — a separate engineering lane; the marker is produced only by that real harness,
  never hand-authored.
- **Hard hooks** (no-UI-before-A0.7, citation-single-source, optimized-never-canonical, snapshot
  anti-circularity, offline entitlement) — deferred until the real surfaces + marker provenance exist.
- No OCR / AI-VLM / cloud / auth / network behavior is introduced by this product definition.

# Part III — UI design artifacts

---

## Design artifact — case-box "Matter not found" copy

*Absorbed 2026-08-12 from `dev-memo/design/2026-06-02-casebox-matter-not-found-copy.md`. Content verbatim; heading levels shifted one deeper.*


**Date**: 2026-06-02
**Type**: UI copy correctness fix (no layout / control / IPC / persistence change)
**Surface**: the "Matter not found" error page on both view-matter and archive-matter screens
(`apps/lawbar-desktop/renderer/screens/viewMatter.ts`, `…/archiveMatter.ts`;
`data-test-id="view-not-found"` / `"archive-not-found"`).

### Problem

When a matter id resolves to nothing, both screens render:

> Matter not found
> **It may have been created in a previous session — data is in-memory only.**

That explanation is now **false**. Case-box persists to SQLite under Electron
`app.getPath("userData")` (`PRODUCT(desktop): use SQLite case-box runtime`, proven across
restart by `PRODUCT(desktop): prove case-box persistence across restart`). A matter is no
longer lost on relaunch, so "not found" is **not** caused by in-memory volatility. The copy is
both inaccurate and actively misleading: it tells the user their data was discarded when, in
fact, their matters persist locally. This is the same class of stale-copy bug fixed for the
empty state in `dev-memo/design/2026-06-02-casebox-persistent-empty-state-copy.md`.

### Decision

Replace the volatility explanation with an accurate, non-alarming reason:

> Matter not found
> **The link may be out of date.**

#### Why this wording

- **Accurate**: with durable local persistence, a "not found" result means the id does not
  correspond to any stored matter — typically a stale or mistyped route (`#/matters/:id`), not
  data loss. "The link may be out of date." states that without overclaiming.
- **Avoids false implications**: it does not assert volatility (false) nor deletion (v1 archives
  matters but does not delete them, so "removed" would be misleading too).
- **Recoverable**: both screens already render a back-link (`view-back-link` /
  `archive-back-link-list`) to the matter list; the copy + link together let the user recover.
- **Minimal**: the `Matter not found` heading and page structure are unchanged; only the one
  explanatory sentence changes, identically on both screens for consistency.

### Exact copy

- view-matter not-found `<p>`: `The link may be out of date.`
- archive-matter not-found `<p>`: `The link may be out of date.` (identical)

### Out of scope (explicitly unchanged)

Layout, DOM structure, the `*-not-found` / back-link test ids, IPC contracts, persistence code,
and all workflow gates. Copy-only change plus the two test assertions that pin the string.

### Affected files

- `apps/lawbar-desktop/renderer/screens/viewMatter.ts`
- `apps/lawbar-desktop/renderer/screens/archiveMatter.ts`
- `apps/lawbar-desktop/tests/renderer-view-matter.test.mjs`
- `apps/lawbar-desktop/tests/renderer-archive-matter.test.mjs`

---

## Design artifact — case-box persistent empty-state copy

*Absorbed 2026-08-12 from `dev-memo/design/2026-06-02-casebox-persistent-empty-state-copy.md`. Content verbatim; heading levels shifted one deeper.*


**Date**: 2026-06-02
**Type**: UI copy change (no layout / control / IPC / persistence change)
**Surface**: matter-list empty state (`apps/lawbar-desktop/renderer/screens/listMatters.ts`,
`data-test-id="list-empty"`)

### Problem

The active empty-state card reads:

> No matters yet. Click + New matter to create the first one. **Data is held in memory only —
> relaunching the app clears it.**

That second sentence is now **false**. The desktop case-box runtime persists to SQLite under
Electron `app.getPath("userData")` (landed: `PRODUCT(desktop): use SQLite case-box runtime`,
and proven across restart by `PRODUCT(desktop): prove case-box persistence across restart`).
Telling the user their data is volatile is both inaccurate and undermines trust in a legal
tool whose value depends on durable local storage.

### Decision

Replace the volatility sentence with an accurate, reassuring local-persistence statement:

> No matters yet. Click + New matter to create the first one. **Matters are stored locally on
> this device.**

#### Why this wording

- **Accurate**: matters persist locally (SQLite under `userData`), surviving relaunch.
- **Local-first framing**: "on this device" matches the v1 local-first posture
  (`.claude/rules/client-local-first.md`) — it states persistence without implying any cloud
  or sync (which is opt-in and not present here).
- **Minimal**: one sentence swap; the first two sentences ("No matters yet…create the first
  one.") are unchanged, so the call-to-action and tone are preserved.
- The archived empty state ("No archived matters.") is unaffected.

### Exact copy

- Active empty state: `No matters yet. Click + New matter to create the first one. Matters are stored locally on this device.`
- Archived empty state: `No archived matters.` (unchanged)

### Out of scope (explicitly unchanged)

Layout, DOM structure, the `list-empty` test id, the `+ New matter` control, IPC contracts,
persistence code, and all workflow gates. This is a copy-only change plus the three test
assertions that pin the copy string.

### Affected files

- `apps/lawbar-desktop/renderer/screens/listMatters.ts` — the copy string.
- `apps/lawbar-desktop/tests/{casebox-ui.electron,smoke.electron,renderer-list-matters}.test.mjs`
  — assertions that pin the empty-state text.

---

## Design artifact — Case-box matter audit-event log viewer

*Absorbed 2026-08-12 from `dev-memo/design/2026-06-03-casebox-audit-log-viewer.md`. Content verbatim; heading levels shifted one deeper.*


**Date**: 2026-06-03.
**WI**: `PRODUCT(ui+ipc): surface full matter audit-event log on matter view`.
**Type**: UI (read-only). Manual-merge (touches renderer + IPC surface).
**Surface**: extends the existing matter detail screen `apps/lawbar-desktop/renderer/screens/viewMatter.ts`. No new route.
**Grounds**: `services/case-box-persistence/src/sqlite/auditRepoQueries.ts` (`listAuditEvents`, already implemented, seek-paginated), `docs/adr/case-box-step-4-audit-log-shape.md` (audit-event shape + chain semantics), `docs/contracts/case-box-contract/schemas/case-box-audit-event.schema.json`.

### Problem

A lawyer opening a matter can currently see only the audit **chain head** (head hash, last-event id, event count) via the existing "Show audit chain head" disclosure. The full ordered history — *what happened, when, by which action* — is persisted (`listAuditEvents`) but has no UI. For a legal tool, the visible, ordered chain of custody is the core trust property: "show me everything that happened to this matter."

### Scope (this WI)

- **Read-only.** No audit-event creation path (audit events are appended internally by other operations; this WI never writes).
- Surface the existing persisted events on the **existing** matter view, inside the **existing** audit disclosure. No new screen, no new route.
- One new read IPC channel: `casebox:audit:listEvents`.
- Honor the persistence API's seek pagination (`limit` + `next_cursor`).
- Preserve tenant/matter scoping (matter existence + tenant check before listing, exactly like `chainHead`).

Out of scope (explicitly not bundled): documents, deadlines/docket, facts, evidence, privilege, confidentiality UI; audit-event creation; chain *verification* UI (`verifyAuditChainForMatter`).

### Data shown per event

From `CaseBoxAuditEvent` (schema required fields): `timestamp`, `action`, `entity_type`, `entity_id`, `after_state_hash`; optional `reason`, `before_state_hash`, `prev_event_hash`, `id`, `actor_user_id`. The row renders the human-relevant subset:

- **Timestamp** — local-formatted (reuse `formatLocalDateTime`).
- **Action** — e.g. `matter.created`, `matter.archived` (verbatim from the event).
- **Entity** — `entity_type` + a shortened `entity_id` (reuse `ulidShort`).
- **Reason** — shown only when present (non-empty).

Hashes (`after_state_hash`, etc.) are NOT shown per-row in v1 (the chain head already exposes the head hash + copy affordance); keeping rows compact. Full-hash disclosure per row is a deferred enhancement, not this slice.

### Layout (ASCII mock)

```
▾ Show audit chain head
  Head hash:  a1b2c3…  [Copy]  ▸ Show full hash
  Last event: 01JZ…             ▸ Show full event id
  Event count: 3

  Audit events                                  ← new section (data-test-id="view-audit-list")
  ┌────────────────────────────────────────────┐
  │ 2026-06-03 14:02  matter.created            │   ← <li data-test-id="view-audit-event">
  │   matter · 01JZ0…                           │
  │ 2026-06-03 14:05  classification.appended   │
  │   matter · 01JZ0…   reason: sealed on intake│
  │ 2026-06-03 15:11  matter.archived           │
  │   matter · 01JZ0…   reason: closed          │
  └────────────────────────────────────────────┘
  [ Show more ]                                 ← only when next_cursor !== null
```

### Behavior & states

The event list loads **lazily**, in the same `<details>` open handler that already triggers the chain-head load (one click loads both head + first page of events). Ordering is the persistence order (chain/seek order) — rendered as an ordered `<ol>`.

| State | Render | data-test-id |
|---|---|---|
| Loading | "Loading audit events…" | `view-audit-loading` |
| Error (envelope `ok:false`) | `<p role="alert">` with `env.error.message` | `view-audit-error` |
| Empty (count 0 / no rows) | reuse the existing "No audit events recorded yet." (no separate empty list) | `view-chain-empty` |
| Populated | `<ol>` of event rows, soonest-first as returned | `view-audit-list` / `view-audit-event` |
| More available (`next_cursor !== null`) | "Show more" button appends the next page | `view-audit-more` |

- **Pagination**: first page uses the default server limit; "Show more" passes the returned `next_cursor`. Each click appends; the button is removed when `next_cursor` comes back `null`.
- **Failure isolation**: an event-list error renders inline (`role="alert"`) and does NOT blank the chain-head summary already shown.
- **No console noise** on the normal path (mirrors the existing "normal active render emits NO console.warn" test).

### IPC contract (new channel)

```
channel:  casebox:audit:listEvents
request:  ListAuditEventsDto { matterId: string; limit?: number; cursor?: string }
response: IpcEnvelope<ListAuditEventsPage>   // { rows: CaseBoxAuditEvent[]; next_cursor: string|null }
```

- Renderer never supplies `tenant_id` (server injects the active tenant); `tenant_id` is a forbidden DTO field. `limit` is bounded by the existing `MAX_LIST_LIMIT`; `cursor` by `MAX_CURSOR_LENGTH`. Validation + matter-existence + tenant-scope mirror `chainHeadHandler` exactly.

### Accessibility

- The list is an `<ol>` (ordered history). Each event is an `<li>`. Error uses `role="alert"`. "Show more" is a `<button type="button">`. Reuses the screen's existing announce region for nothing new (static content). No focus trap; tab order follows DOM.

### Non-goals / deferred

- Per-row full-hash disclosure, chain-verification status, filtering by action/entity, export. Deferred — not this slice.

### Acceptance (testable)

1. Opening the disclosure loads + renders the first page of events as an `<ol>` in chain order (renderer test with a stub api returning 2–3 events).
2. Empty matter shows the existing "No audit events recorded yet." copy (no list).
3. Envelope error renders `role="alert"` inline, head summary intact.
4. `next_cursor` present → "Show more" appears; clicking appends the next page and removes the button when the cursor is exhausted.
5. IPC handler: tenant injection, forbidden `tenant_id` → `invalid_payload`, unknown field → `invalid_payload`, absent matter → `unknown_matter` (listAuditEvents not called), tenant mismatch → `tenant_mismatch` (not called), happy path returns the page.

---

## Design artifact — Deadline urgency surfacing (overdue / due-within-7-days)

*Absorbed 2026-08-12 from `dev-memo/design/2026-06-03-casebox-deadline-urgency.md`. Content verbatim; heading levels shifted one deeper.*


**Date**: 2026-06-03.
**WI**: `PRODUCT(ui): surface overdue and due-soon deadlines in the matter deadlines view`.
**Type**: UI. Manual-merge.
**Surface**: the existing Deadlines disclosure on the matter view (`renderer/screens/viewMatterDeadlines.ts`). No new route, no new IPC channel.
**Grounds**: brief §18 v1 day-one MUST-HAVE — *"Visible overdue-deadline list in the case-box UI; dashboard banner when overdue or due within 7 days."* The deadline read surface (`casebox:deadline:list`) and its response fields (`due_at`, `status`) already exist (and were tenant-hardened in PR #34 / projected in PR #35). This slice adds the urgency *presentation* only.

### Problem

A matter's deadlines render as a flat, unordered-by-urgency list with no visual signal for what is overdue or imminent. For a legal deadline tool this is the single highest-value gap — a missed litigation deadline is malpractice. The data needed to flag urgency already crosses the IPC boundary; nothing below the renderer needs to change.

### Scope (this WI)

- **Renderer-only.** No contract, persistence, `services/`, or new IPC channel. Uses the existing `casebox:deadline:list` response.
- **Read-only.** Still NO create / confirm / dismiss / transition — display only.
- Per-matter view only. The **global cross-matter dashboard banner** (a single banner across all matters) is a deferred follow-up because it needs a new cross-matter deadline-aggregation IPC channel (`getDeadlineCalendar` exists in persistence aggregations but is not exposed over IPC).

### Classification (pure, clock-injected)

`classifyDeadlineUrgency(dueAtIso, status, nowMs)` in `renderer/format.ts` — pure, so it is unit-tested deterministically:

| Condition | Urgency |
|---|---|
| `status !== "pending"` (met / missed / withdrawn) | `none` (settled — never urgent) |
| `due_at` unparseable | `none` |
| `due_at < now` | `overdue` |
| `now ≤ due_at ≤ now + 7 days` (boundaries inclusive) | `due-soon` |
| `due_at > now + 7 days` | `none` |

The deadline list arrives sorted `due_at ASC`, so the earliest rows sort to the top naturally — **no client reordering**. The injected `now` defaults to `Date.now()` in production; tests pass a fixed value.

### Visual design

**Banner** (above the list, `role="status"` so screen readers announce it): shown only when ≥1 urgent deadline is loaded. Text: `"{N} overdue · {M} due within 7 days"` (each clause omitted when its count is 0). Styling:
- any overdue → **danger** tokens (`--color-danger` / `--color-danger-subtle` / `--color-danger-border`), via the `view-deadlines-banner--overdue` modifier.
- due-soon only → **warning** tokens (`--color-warning*`).

**Per-row pill** (`view-deadlines-urgency`, appended after the `kind · status` text): `Overdue` (danger tokens) or `Due soon` (warning tokens). Settled / future rows get no pill. `data-urgency` attribute carries the classification for tests.

All colors are existing theme-aware `var(--color-*)` tokens (both light and dark themes define the danger/warning subtle+border variants), so the `renderer-no-hardcoded-color` lint passes and dark mode inherits.

```
┌ Deadlines ─────────────────────────────────────────┐
│ ⚠ 1 overdue · 1 due within 7 days        (banner)  │   ← danger bg when overdue present
│ • 2026-06-01 09:00  filing · pending  [Overdue]    │   ← danger pill
│ • 2026-06-05 17:00  hearing · pending [Due soon]   │   ← warning pill
│ • 2026-07-30 12:00  payment · pending              │   ← no pill (>7 days)
│ • 2026-05-01 12:00  filing · met                   │   ← no pill (settled)
└────────────────────────────────────────────────────┘
```
(The `⚠` above is illustrative; the implementation renders text only — no emoji, no `innerHTML`.)

### Pagination — eager load all pages (correctness)

The deadlines disclosure **exhausts the seek cursor up front** (loads every page before finalising) rather than paginating with a "Show more" button. Rationale (cc-suite audit `audit-mpxsbpuk-asj8i2`, High): the list is sorted `due_at ASC` across **all** statuses, so a page of old settled (`met`/`missed`/`withdrawn`) deadlines can sit ahead of — and hide — a later **pending overdue** deadline. A partial load would make the banner silently undercount (possibly show *no* urgency despite an overdue deadline) — unacceptable for a malpractice-critical view. Per-matter deadline counts are bounded, so exhausting the cursor is cheap. If matters ever grow huge, a server-side overdue aggregate (new IPC) would replace the loop — noted as the global-dashboard follow-up. This removed the previous "Show more" affordance for deadlines (the existing pagination test was rewritten to assert eager loading + a regression test for the hidden-overdue case).

### Tests

- `tests/renderer-deadline-urgency.test.mjs` — pure classifier: overdue / due-soon / none, the now and now+7d boundaries, the just-past-window case, settled statuses, unparseable date, and labels.
- `tests/renderer-view-matter.test.mjs` (extended) — DOM: pills appear on the right rows with the right `data-urgency`; banner text + overdue-vs-warning styling + `role="status"`; due-soon-only banner; no-urgent → banner hidden + no pills. `now` injected for determinism.

### Out of scope / deferred

- Global cross-matter overdue dashboard banner (needs a new aggregation IPC channel).
- Deadline write flows (confirm / dismiss / transition / create) — separate WIs.
- Sorting/grouping beyond the natural `due_at ASC` order.

### Stop condition

Shipped when the per-matter deadlines view shows the overdue/due-soon banner + pills, gates green, cc-suite audit clean. Superseded if a global deadline-dashboard WI later subsumes the per-matter banner.

---

## Design artifact — Matter deadlines (read-only list) + handler split

*Absorbed 2026-08-12 from `dev-memo/design/2026-06-03-casebox-deadlines-readonly.md`. Content verbatim; heading levels shifted one deeper.*


**Date**: 2026-06-03.
**WI**: `PRODUCT(ui+ipc): surface matter deadlines and docket read-only` (B7 deadline read surface).
**Type**: UI (read-only). Manual-merge (UI + IPC surface).
**Surface**: a new Deadlines section on the matter view (`renderer/screens/viewMatter.ts`), rendered by a new sibling `renderer/screens/viewMatterDeadlines.ts`. No new route.
**Grounds**: `services/case-box-persistence/src/sqlite/deadlineRepoQueries.ts` (`listDeadlines`, already implemented, seek-paginated); ADR `docs/adr/case-box-step-6-deadline-docketing-rules.md`; schema `case-box-deadline.schema.json`; brief §7.A.

### Problem

A matter's deadlines are persisted (`listDeadlines`) but have no IPC channel and no UI. Deadline visibility is the highest-anxiety litigator need ("did I miss a filing?"). This slice surfaces the **read path** only.

### Mandatory structural pre-step (done) — handler split

`apps/lawbar-desktop/src/caseBox/handlers.ts` had reached 614 LOC, accumulating every IPC handler (loc-guardian warn zone). Before adding deadline handlers it was split **mechanically** (no behavior change) into per-entity sibling modules, with `handlers.ts` kept as a thin barrel so every existing import (`from "./handlers.js"`, tests' `from "../dist/.../handlers.js"`) is unchanged:

| Module | Contents | LOC |
|---|---|---|
| `handlerShared.ts` | `CHANNEL`, `PersistenceProvider`/`ClockFn`, `isPlainJsonObject` + `shapeGuardFailure` + `forbiddenFieldFailure` | 55 |
| `matterHandlers.ts` | create / get / list / archive | 233 |
| `auditHandlers.ts` | chainHead / listAuditEvents | 130 |
| `documentHandlers.ts` | list / get / register (+ `DOC_TYPES`, `RegisterDocumentDeps`) | 254 |
| `deadlineHandlers.ts` | listDeadlines (this WI) | 79 |
| `handlers.ts` | barrel re-export only | 26 |

Equivalence proof: all pre-existing handler + renderer tests pass unchanged after the split (320/0 total, of which the prior suite was 306).

### Product scope (this WI)

- **Read-only.** No docket creation, deadline confirmation/dismissal/editing, transitions, notifications, calendar export, or date-rule mutation.
- Smallest useful surface: **one** channel `casebox:deadline:list` (seek-paginated). The `getDeadlineCalendar` aggregation is **deferred** (not bundled) to keep the slice tight.
- Tenant/matter scoping preserved.

### IPC contract (new channel)

```
casebox:deadline:list   ListDeadlinesDto { matterId: string; limit?: number; cursor?: string }
                        -> IpcEnvelope<ListDeadlinesPage>   // { rows: CaseBoxDeadline[]; next_cursor: string|null }
```

`listDeadlinesHandler` mirrors the document/audit list handlers exactly: forbidden (`tenant_id`/`actor_user_id`) + unknown-field rejection, `matterId`/`limit`/`cursor` validation, matter-existence + active-tenant check **before** the read, server-side `tenant_id`+`matter_id` injection.

### UI

A lazy "Show deadlines" disclosure on the matter view. Each row renders the human-relevant `CaseBoxDeadline` subset: `due_at` (local-formatted), `kind · status`, and optionally `source_rule_citation` (rule) and `owner_user_id` (short). Empty → "No deadlines recorded for this matter." Error → inline `role="alert"`. "Show more" pagination via `next_cursor`. `el()` sets `textContent` (no `innerHTML`).

### Out of scope / deferred

Calendar channel (`getDeadlineCalendar`), docket entries, confirm/dismiss/transition, status/kind filters, notifications, export. Deferred.

### Acceptance (testable)

1. Handler split: all pre-existing handler + renderer tests pass unchanged (equivalence).
2. Deadlines disclosure does not call `list` until opened; opening renders the rows.
3. Empty matter → "No deadlines recorded for this matter."
4. Error → inline `role="alert"`.
5. `next_cursor` → "Show more" appends the next page and disappears when exhausted.
6. IPC handler: tenant injection; forbidden `tenant_id` → `invalid_payload`; unknown field → `invalid_payload`; non-int limit → `invalid_payload`; absent matter → `unknown_matter` (read not called); tenant mismatch → `tenant_mismatch` (read not called).

---

## Design artifact — Register a document into a matter (B2 WI-2b)

*Absorbed 2026-08-12 from `dev-memo/design/2026-06-03-casebox-document-register.md`. Content verbatim; heading levels shifted one deeper.*


**Date**: 2026-06-03.
**WI**: `PRODUCT(ui+ipc): register documents to a matter` (B2 documents vertical, slice WI-2b — the write/create path; read path shipped in WI-2a, PR #30).
**Type**: UI (write — adds the first file-handling channel). Manual-merge (UI + IPC + file/storage handling).
**Surface**: an "Add document" control in the existing Documents section of the matter view (`renderer/screens/viewMatterDocuments.ts`). New main-process file-storage util `src/caseBox/documentStorage.ts`. No new screen/route.
**Grounds**: `services/case-box-persistence/src/inMemoryDocument.ts` (`registerDocument` / `prepareRegisterDocument` — expects a fully-formed, schema-valid document; enforces `matter_id`/`tenant_id` match + `status="registered"`); schema `case-box-document.schema.json`; brief §7.A.

### Problem

WI-2a made the Documents section read-only — it is empty until documents can be added. This slice lets a lawyer **add one local file to a matter** so the read surface becomes useful.

### Smallest safe vertical slice

User picks one local file → main computes `content_hash` → main copies the file into app-controlled storage → main builds a `storage_uri` → existing `registerDocument` persists the document → the Documents list refreshes and shows it.

### Conservative file-handling design

The renderer **never supplies a filesystem path**. The flow is main-driven:

1. Renderer calls `casebox:document:register` with only `{ matterId, doc_type }`.
2. Main validates the matter (existence + active tenant) **before** any dialog or filesystem access.
3. Main opens a single-file chooser (`dialog.showOpenDialog({ properties: ['openFile'] })`). Cancel → the channel returns `value: null` (not an error); nothing is stored.
4. Main computes a SHA-256 `content_hash` of the chosen file, copies it (never moves) into `<userData>/case-box-documents/<documentId>/<safe-basename>`, and derives `storage_uri = pathToFileURL(dest).href`.
5. Main builds the full document (server-authority fields injected: `id`, `tenant_id`, `actor_user_id`, `matter_id`, `source: "uploaded"`, `content_hash`, `storage_uri`, `received_at`, `status: "registered"`, `byte_size`), runs `validateDocument`, and calls `persistence.registerDocument(matterId, doc)`.

**Path-safety**: the destination is always strictly under `<storageRoot>/<documentId>/` where `documentId` is a server ULID; the user-influenced filename is reduced to `path.basename` and re-checked to resolve inside that subdir (a crafted `../…` name cannot escape; a pure `..` falls back to the documentId). The file is copied, not executed; `storage_uri` is data, displayed as text, never opened.

**Testability**: the file chooser and the storage util are injected dependencies of `registerDocumentHandler` (`chooseFile`, `storeFile`), so the handler logic is unit-tested without Electron/fs; the storage util is unit-tested against a real temp dir; production wires the dialog + `makeStoreFile(storageRoot)` in `electron/main.ts`.

### IPC contract (new channel)

```
casebox:document:register   RegisterDocumentDto { matterId: string; doc_type: DocType }
                            -> IpcEnvelope<CaseBoxDocument | null>   // null = user cancelled the chooser
```

Server-authority fields are FORBIDDEN in the DTO (`id`, `tenant_id`, `actor_user_id`, `content_hash`, `storage_uri`, `received_at`, `status`, `source`, `filename`, `byte_size`, `custody_chain`) → `invalid_payload`. `doc_type` must be a known enum value. Tenant injected server-side; renderer never supplies it.

### UI

The Documents disclosure gains an "Add document" row: a `doc_type` `<select>` + an "Add document" `<button>` + a status line. Click → button disabled + "Adding…" → on success "Added." and the list refreshes in place; on cancel "Cancelled." (no refresh); on error an inline `role="alert"`. `el()` sets `textContent` (no `innerHTML`); no file is ever opened from `storage_uri`.

### Out of scope (not bundled)

OCR, facts, evidence links, deadlines, privilege, confidentiality, file preview/open, drag-and-drop, multi-file, supersession, status/doc_type list filters. Deferred.

### Acceptance (testable)

1. Storage util: SHA-256 hash matches; file copied under `<root>/<id>/<basename>` with identical bytes (source untouched); `storage_uri` is the file URL; filename with path components → basename (no traversal); pure `..` → documentId fallback.
2. Handler happy path: builds the full document (source=uploaded, status=registered, injected tenant/actor/id), validates, persists; returns it.
3. Handler cancelled: `chooseFile` null → `value: null`; `storeFile` + `registerDocument` NOT called.
4. Handler scoping: forbidden `tenant_id`/`content_hash` → `invalid_payload`; unknown field → `invalid_payload`; invalid `doc_type` → `invalid_payload`; absent matter → `unknown_matter` (chooser NOT opened); tenant mismatch → `tenant_mismatch` (chooser NOT opened); schema violation (e.g. negative `byte_size`) → `invalid_payload` (registerDocument NOT called).
5. Renderer: add success registers (default doc_type) then refreshes the list; cancel shows "Cancelled." without refresh; error renders inline `role="alert"`.

---

## Design artifact — Case-box matter documents (read-only list/get)

*Absorbed 2026-08-12 from `dev-memo/design/2026-06-03-casebox-documents-readonly.md`. Content verbatim; heading levels shifted one deeper.*


**Date**: 2026-06-03.
**WI**: `PRODUCT(ui+ipc): surface read-only matter documents list/get` (B2 documents vertical, slice WI-2a).
**Type**: UI (read-only). Manual-merge (touches renderer + IPC surface).
**Surface**: a new Documents section on the existing matter detail screen (`apps/lawbar-desktop/renderer/screens/viewMatter.ts`), rendered by a new sibling module `renderer/screens/viewMatterDocuments.ts`. No new route.
**Grounds**: `services/case-box-persistence/src/sqlite/documentRepoQueries.ts` (`listDocuments`, `getDocument`, already implemented); schema `docs/contracts/case-box-contract/schemas/case-box-document.schema.json`; brief §7.A litigation day-one vertical (documents listed first).

### Problem

A matter's documents are persisted (`listDocuments`/`getDocument`) but have no IPC channel and no UI. A lawyer cannot see which documents belong to a matter. This slice surfaces the **read path** only.

### Scope (this WI / slice 2a)

- **Read-only.** No registration, file picker, hashing (`content_hash`), storage copy (`storage_uri`), or file opening — display only. Document *creation* is a separate later slice (2b).
- Two new read IPC channels: `casebox:document:list`, `casebox:document:get`.
- A Documents section on the matter view: lazily list the matter's documents; expand a row to view its metadata via `get`.
- Honor seek pagination (`limit` + `next_cursor`); preserve tenant/matter scoping.

Out of scope (not bundled): facts, deadlines, evidence, privilege, confidentiality, BRCBW; document registration / file handling.

### LOC guard (mandatory pre-step)

`viewMatter.ts` was 759 LOC (loc-guardian warn zone). Before adding the Documents section, the audit/chain disclosure was extracted **mechanically** (no behavior change) into a sibling module `renderer/screens/viewMatterAudit.ts`; the Documents section lives in its own sibling `viewMatterDocuments.ts`. `viewMatter.ts` drops to ~420 LOC; both siblings are < 400. The screen is not redesigned — only the disclosure bodies move out.

### IPC contract (new channels)

```
casebox:document:list   ListDocumentsDto { matterId: string; limit?: number; cursor?: string }
                        -> IpcEnvelope<ListDocumentsPage>   // { rows: CaseBoxDocument[]; next_cursor: string|null }
casebox:document:get    GetDocumentDto   { matterId: string; documentId: string }
                        -> IpcEnvelope<CaseBoxDocument | null>
```

Scoping (mirrors the matter channels):
- Renderer never supplies `tenant_id`/`actor_user_id` (forbidden DTO fields); server injects the active tenant.
- `list`: matter existence + active-tenant checked before querying; `tenant_id`+`matter_id` injected into the query. `limit` bounded by `MAX_LIST_LIMIT`, `cursor` by `MAX_CURSOR_LENGTH`.
- `get`: matter existence + tenant checked; then `getDocument(documentId)`; the returned document must match the active tenant (else `tenant_mismatch`) AND the requested matter (else `value: null` — scoped not-found). This prevents reading another matter's/tenant's document by id.

### Layout (ASCII mock)

```
▾ Show documents                              ← <details data-test-id="view-docs-summary">
  • complaint.pdf   pleading · registered   2026-06-03 14:02   ▸ (details)
      Content hash: a1b2c3…
      Storage: file:///…/complaint.pdf
      Pages: 12
  • answer.pdf      pleading · reviewed     2026-06-04 09:10   ▸ (details)
  [ Show more ]                               ← only when next_cursor !== null

  (empty)  No documents in this matter yet.
```

### Behavior & states

The Documents disclosure loads lazily on first open (one `list` call). Each row is an expandable `<details>`; expanding it lazily calls `get` for that document and renders its metadata (content_hash truncated, storage_uri, page_count, language, mime_type, byte_size — whichever are present).

| State | Render | data-test-id |
|---|---|---|
| Loading | "Loading documents…" | `view-docs-loading` |
| Empty | "No documents in this matter yet." | `view-docs-empty` |
| List error | `<p role="alert">` with `env.error.message` | `view-docs-error` |
| Populated | `<ul>` of rows (filename, doc_type · status, received_at) | `view-docs-list` / `view-docs-item` |
| More | "Show more" appends next page via `next_cursor` | `view-docs-more` |
| Row detail loading/error/found | inline under the row | `view-docs-detail-*` |

`el()` sets `textContent` (no `innerHTML`). No file is opened; storage_uri is shown as text only.

### Accessibility

Documents are a `<ul>`; each row a `<details>`/`<summary>`. Errors use `role="alert"`. "Show more" is a `<button type="button">`. Tab order follows DOM.

### Non-goals / deferred (slice 2b and later)

Document registration, file picker, content hashing, storage copy, file opening/preview, status/doc_type filters, sorting controls. Deferred.

### Acceptance (testable)

1. Documents disclosure does not call `list` until opened; opening renders the rows (renderer test with a stub returning 2 docs).
2. Empty matter shows "No documents in this matter yet." (no rows).
3. List envelope error renders `role="alert"` inline.
4. `next_cursor` → "Show more" appends the next page and disappears when exhausted.
5. Expanding a row calls `get` with `{matterId, documentId}` and renders its metadata.
6. IPC handlers: tenant injection; forbidden `tenant_id` → `invalid_payload`; unknown field → `invalid_payload`; absent matter → `unknown_matter` (persistence read not called); tenant mismatch → `tenant_mismatch`; `get` of a doc in another matter → `value: null`; `get` of a doc in another tenant → `tenant_mismatch`; missing `documentId` → `invalid_payload`.

---

## Design artifact — Matter facts (read-only list)

*Absorbed 2026-08-12 from `dev-memo/design/2026-06-03-casebox-facts-readonly.md`. Content verbatim; heading levels shifted one deeper.*


**Date**: 2026-06-03.
**WI**: `PRODUCT(ui+ipc): surface matter facts read-only` (B6 fact read surface).
**Type**: UI (read-only). Manual-merge (UI + IPC surface).
**Surface**: a new Facts section on the matter view (`renderer/screens/viewMatter.ts`), rendered by a new sibling `renderer/screens/viewMatterFacts.ts`. New handler module `src/caseBox/factHandlers.ts`. No new route.
**Grounds**: `services/case-box-persistence/src/sqlite/factsRepoQueries.ts` (`listFacts`, already implemented, seek-paginated); schema `case-box-fact.schema.json`; brief §7.A litigation day-one vertical (facts = claims/defenses/timeline).

### Problem

A matter's facts are persisted (`listFacts`) but have no IPC channel and no UI. This slice surfaces the **read path** only — the last big litigation-vertical read surface (matters → documents → deadlines → **facts** → evidence).

### Scope (this WI)

- **Read-only.** No fact creation, editing, deletion, OCR extraction, document/evidence linking, privilege, or confidentiality changes.
- One channel `casebox:fact:list` (seek-paginated). `getFact` is **deferred / not added** — the list rows already carry the full `CaseBoxFact`, so a per-fact `get` is redundant for this read surface.
- Tenant/matter scoping preserved.

### IPC contract (new channel)

```
casebox:fact:list   ListFactsDto { matterId: string; limit?: number; cursor?: string }
                    -> IpcEnvelope<ListFactsPage>   // { rows: CaseBoxFact[]; next_cursor: string|null }
```

`listFactsHandler` (new `factHandlers.ts`, mirrors `deadlineHandlers.ts`): forbidden (`tenant_id`/`actor_user_id`) + unknown-field rejection, `matterId`/`limit`/`cursor` validation, matter-existence + active-tenant check **before** the read, server-side `tenant_id`+`matter_id` injection. The per-entity handler split (prior WI) means this is a small self-contained module.

### UI

A lazy "Show facts" disclosure on the matter view. Each row renders the human-relevant `CaseBoxFact` subset: `statement_text` (the fact), `status · source_type`, the date (`as_of_date` if present else `created_at`, local-formatted), and `extraction_confidence` when present. Empty → "No facts recorded for this matter." Error → inline `role="alert"`. "Show more" pagination via `next_cursor`. `el()` sets `textContent` (no `innerHTML`) — statement text is rendered as text only.

### Out of scope / deferred

`getFact`, status/source_type filters, fact creation/edit/delete, document/evidence linking, supersession chains, OCR extraction. Deferred.

### Acceptance (testable)

1. Facts disclosure does not call `list` until opened; opening renders the rows.
2. Empty matter → "No facts recorded for this matter."
3. Populated rows show `statement_text`, `status · source_type`, and `extraction_confidence` when present.
4. Error → inline `role="alert"`.
5. `next_cursor` → "Show more" appends the next page and disappears when exhausted.
6. IPC handler: tenant injection; forbidden `tenant_id` → `invalid_payload`; unknown field → `invalid_payload`; non-int limit → `invalid_payload`; absent matter → `unknown_matter` (read not called); tenant mismatch → `tenant_mismatch` (read not called).

---

## Design artifact — Add and confirm a deadline (propose → confirm write)

*Absorbed 2026-08-12 from `dev-memo/design/2026-06-05-casebox-deadline-create-confirm.md`. Content verbatim; heading levels shifted one deeper.*


**Date**: 2026-06-05.
**WI (suggested)**: `PRODUCT(ui+bridge): add + confirm deadline on a matter` (case-box
deadlines vertical — the write/create path; read path shipped in B7 deadline read surface).
**Type**: UI (write). Manual-merge (renderer UI + renderer IPC bridge wiring). No new
main-process handler — `casebox:docket:create` + `casebox:docket:confirm` already exist on
`ipcMain` (WI-601, PR #51).
**Surface**: an "Add deadline" control + a transient "Proposed (unconfirmed)" area inside the
existing Deadlines disclosure of the matter view (`renderer/screens/viewMatterDeadlines.ts`).
No new screen / route / modal / wizard.
**Grounds**: backend handlers `createDocketEntryHandler` + `confirmDocketEntryHandler`
(`src/caseBox/docketHandlers.ts`); `CreateDocketEntryDto` / `ConfirmDocketEntryDto` /
`DOCKET_ENTRY_RESPONSE_FIELDS` / `CONFIRM_DOCKET_DEADLINE_RESPONSE_FIELDS`
(`src/caseBox/dto.ts`); ADR `docs/adr/case-box-step-6-deadline-docketing-rules.md`; precedent
design `dev-memo/design/2026-06-03-casebox-document-register.md`; urgency design
`dev-memo/design/2026-06-03-casebox-deadline-urgency.md`; code precedent
`viewMatterDocuments.ts renderAddControl` + the `viewMatterDeadlines.ts` urgency banner.

### Problem

The Deadlines section is read-only (`renderDeadlinesDisclosure` → `loadDeadlines`, with the
urgency banner): it shows "No deadlines recorded for this matter." until deadlines exist, but
there is no way to add one. The v1 deadlines path is **propose → confirm**: `appendDocketEntry`
creates a *proposed* entry; only `confirmDocketEntry` materializes the `CaseBoxDeadline` that
surfaces in `listDeadlines`. Both channels are live but unreachable from the renderer. This
slice lets a lawyer **propose a deadline and then confirm it** so it joins the deadline list.

### Smallest safe vertical slice

Lawyer enters `proposed_kind` + `proposed_due_at` (datetime) + `proposed_due_at_timezone`
(IANA) → renderer calls `casebox:docket:create` → main injects identity / provenance and
persists a *proposed* docket entry, returning it → the renderer shows it in a transient
"Proposed (unconfirmed)" row with a **Confirm** button → click Confirm → renderer calls
`casebox:docket:confirm` with `{ matterId, entryId }` → main materializes the deadline → the
deadline list refreshes in place and the new deadline appears (with the existing urgency
classification); the proposed row clears.

Nothing else: no dismiss, no edit, no transition, no reminders.

#### Two-step state (important design constraint)

There is **no docket-read IPC** — proposed-but-unconfirmed entries are not separately
listable. The proposed entry lives **only** in the renderer's ephemeral state (the
`casebox:docket:create` response) between propose and confirm. Consequences the design accepts:

- A page reload / matter re-navigation **before** confirming loses the unconfirmed proposal
  from the UI (the persisted proposed entry still exists server-side but cannot be re-surfaced
  without a read channel). This is acceptable for the smallest slice; a future docket-read IPC
  + "pending proposals" surface is **out of scope** (noted below).
- Confirm is the only step that makes a deadline visible in `loadDeadlines`. Until confirm, the
  deadline list is unchanged.

### IPC contract (existing channels — consume, do not change)

```
casebox:docket:create    CreateDocketEntryDto { matterId: string;
                                                 proposed_kind: string;            // required, non-empty
                                                 proposed_due_at: string;          // required ISO-8601 datetime
                                                 proposed_due_at_timezone: string; // required IANA tz
                                                 proposed_owner_user_id?: string } // optional
                          -> IpcEnvelope<RendererDocketEntryRow>   // PROPOSED entry (confirmation_state "proposed")

casebox:docket:confirm   ConfirmDocketEntryDto { matterId: string; entryId: string }
                          -> IpcEnvelope<{ entry: RendererDocketEntryRow;          // now confirmation_state "confirmed"
                                           deadline: RendererConfirmDeadlineRow }> // the materialized CaseBoxDeadline
```

- `create` injects all authority / provenance / lifecycle fields server-side (`id`,
  `tenant_id`, `actor_user_id`, `source_type: "manual"`, `proposed_due_at_kind: "datetime"`,
  provenance `null`, lifecycle `null`, `created_at`). Those are **forbidden in the DTO** →
  `invalid_payload`.
- `confirm` is scoped fail-closed: main runs a scoped `getDocketEntry({ tenant_id, matter_id,
  entry_id })` preflight and rejects a foreign / unknown / wrong-tenant `entryId` with
  `invalid_payload` **without** materializing anything. The renderer must surface that safely.
- Both responses are projected to renderer-safe allowlists (authority identities stripped). The
  materialized `deadline` carries the same non-authority fields the deadline list already
  renders, so it slots straight into `renderDeadlineRow`.

#### Renderer bridge wiring (part of this WI)

`electron/preload.mts` adds `createDocketEntry: (dto) => ipcRenderer.invoke("casebox:docket:create", dto)`
and `confirmDocketEntry: (dto) => ipcRenderer.invoke("casebox:docket:confirm", dto)`;
`renderer/api.ts` adds both to `CaseBoxClient` + `CaseBoxApi` and wires them through
`createCaseBoxApi` with `RENDERER_CREATE_DOCKET_DTO_FIELDS` (`matterId`, `proposed_kind`,
`proposed_due_at`, `proposed_due_at_timezone`, `proposed_owner_user_id`) and
`RENDERER_CONFIRM_DOCKET_DTO_FIELDS` (`matterId`, `entryId`) strip-allowlists — mirroring
`registerDocument`. `preload.mts` (electron/) is not design-gated; `renderer/api.ts` is.

### UI

The Deadlines disclosure gains one **in-section** "Add deadline" control, placed above the
existing banner + list, built with `el()` / `textContent` only — never `innerHTML`. Proposed
elements + test ids (mirroring `view-docs-add-*` and the `view-deadlines-*` family):

- `view-deadlines-add-control` — wrapper `div`.
- `view-deadlines-add-kind` — text `<input>` for `proposed_kind` (placeholder e.g. "filing").
  Required.
- `view-deadlines-add-due` — `<input type="datetime-local">` for `proposed_due_at` (converted
  to ISO-8601 on submit). Required.
- `view-deadlines-add-tz` — `<input>`/`<select>` for `proposed_due_at_timezone` (IANA;
  default pre-filled with the host tz). Required.
- `view-deadlines-add` — "Propose deadline" `<button type="button">`.
- `view-deadlines-add-status` — a `<span>` status line.
- `view-deadlines-proposed` — a transient area (hidden until a proposal exists) holding the
  proposed row + its confirm control:
  - `view-deadlines-proposed-row` — shows the proposed `kind` + `due_at` + a "Proposed
    (unconfirmed)" marker.
  - `view-deadlines-confirm` — "Confirm deadline" `<button type="button">`.
  - `view-deadlines-confirm-status` — a `<span>` status line.

**Propose flow** (mirror `renderAddControl`): click "Propose deadline" → button `disabled` +
status "Proposing…" → `api.createDocketEntry({ matterId, proposed_kind, proposed_due_at,
proposed_due_at_timezone })` → button re-enabled → on success status "Proposed — confirm to add
it." and the `view-deadlines-proposed` area un-hides showing the returned proposed entry; on
error inline alert (no proposed area).

**Confirm flow**: click "Confirm deadline" → confirm button `disabled` + confirm-status
"Confirming…" → `api.confirmDocketEntry({ matterId, entryId })` (entryId from the held proposed
response) → on success: confirm-status "Confirmed.", the `view-deadlines-proposed` area clears
(hidden), and the deadline list refreshes in place (re-run `loadDeadlines` against a cleared
body so the urgency banner + the materialized deadline reflect the new state); on error inline
alert in `view-deadlines-confirm-status`, proposed area retained so the lawyer can retry.

#### Error / success states

| Condition | UI |
|---|---|
| Propose success | `view-deadlines-add-status` "Proposed — confirm to add it."; proposed area shown. |
| Propose `invalid_payload` (missing/invalid kind/due/tz, or forbidden field) | `view-deadlines-add-status` gets `role="alert"` + `data-test-id="view-deadlines-add-error"`, server message; proposed area not shown. |
| Confirm success | `view-deadlines-confirm-status` "Confirmed."; proposed area cleared; deadline list refreshes; new deadline visible with urgency pill if applicable. |
| Confirm `invalid_payload` (foreign / unknown / wrong-tenant entryId — fail-closed) | `view-deadlines-confirm-status` `role="alert"` + `data-test-id="view-deadlines-confirm-error"`, server message; proposed area retained. |
| `unknown_matter` / `tenant_mismatch` (either step) | inline `role="alert"` with server message; never the raw matter id. |
| In flight | the active button `disabled`; status text set; `role` removed while loading. |

Every `!env.ok` renders inline (consistent with the existing `view-deadlines-error`); no throw
to console.

### Accessibility notes

- Error statuses use `role="alert"` only when an error is shown (set on failure, removed while
  loading) — matches `view-deadlines-error` on the read surface.
- The transient proposed area uses the `hidden` attribute (removed from the a11y tree) until a
  proposal exists, and is announced via a `role="status"` on the proposed-row marker so a
  screen reader hears "Proposed (unconfirmed)" when it appears — consistent with the existing
  `role="status"` urgency banner.
- Each input has a visible `<label>` (or `aria-label`): kind, due date/time, timezone. Both
  buttons have discernible names ("Propose deadline", "Confirm deadline").
- Keyboard: plain form controls in DOM order; Confirm becomes focusable when the proposed area
  appears; no focus trap, no custom widget; the disclosure stays a native `<details>`.
- The materialized deadline reuses the existing `renderDeadlineRow` urgency pill, whose meaning
  is conveyed by text (`deadlineUrgencyLabel`) + `data-urgency`, not color alone.

### Tests / acceptance (testable)

Renderer unit tests (extend `tests/renderer-view-matter.test.mjs`; bridge in
`tests/renderer-api.test.mjs` + `tests/renderer-dto-sync.test.mjs`), using `_view-matter-dom.mjs`
+ a mock `CaseBoxApi` with an injected fixed clock (the deadline screen already takes `nowMs`):

1. **Propose success** — `createDocketEntry` resolves `ok` → `view-deadlines-proposed` un-hides
   with the proposed kind/due; status "Proposed — confirm to add it."
2. **Propose → Confirm success** — after a proposal, `confirmDocketEntry` resolves `ok` →
   proposed area clears, `listDeadlines` is re-invoked, and the materialized deadline renders
   (with the correct urgency pill against the fixed clock).
3. **Confirm foreign/unknown entryId** — `confirmDocketEntry` returns `invalid_payload` →
   inline `role="alert"` `view-deadlines-confirm-error`; proposed area retained; deadline list
   NOT refreshed.
4. **Propose invalid** — missing `proposed_kind` (client pre-check) or server `invalid_payload`
   → inline `view-deadlines-add-error`; no proposed area.
5. **Server boundary** — `unknown_matter` / `tenant_mismatch` on propose → inline alert with the
   server message; never the raw matter id.
6. **DTO strip** — `createDocketEntry` forwards only the five create fields; `confirmDocketEntry`
   forwards only `matterId` / `entryId` (renderer allowlists; `renderer-dto-sync` parity with
   `CREATE_DOCKET_DTO_FIELDS` / `CONFIRM_DOCKET_DTO_FIELDS`).
7. **Two-step state** — before confirm, the deadline list is unchanged (confirm is the only
   step that calls `listDeadlines` refresh).
8. **Safe DOM** — no `innerHTML`; all text via `el()` / `textContent`.

Gate: `npm --prefix apps/lawbar-desktop test`.

### Out of scope (not bundled)

Deadline dismissal / edit / transition; reminders / notifications / reminder offsets; a
docket-read IPC or a persistent "pending proposals" surface (so unconfirmed proposals survive
reload); rule-citation autofill / jurisdiction deadline rules; bulk add; multi-step wizards or
modals; WeChat Mini Program. All deferred. The reload-loses-unconfirmed-proposal limitation is
an accepted constraint of this slice, not a defect.

### Stop condition

Retire when the Add+Confirm-deadline WI ships (referencing this artifact as its
`Design artifact:`) and the acceptance tests above are green. Stale if the
`casebox:docket:create` / `casebox:docket:confirm` contracts change before the WI lands.

---

## Design artifact — Add a fact to a matter (claims / timeline write)

*Absorbed 2026-08-12 from `dev-memo/design/2026-06-05-casebox-fact-create.md`. Content verbatim; heading levels shifted one deeper.*


**Date**: 2026-06-05.
**WI (suggested)**: `PRODUCT(ui+bridge): add fact to a matter` (case-box facts vertical — the
write/create path; read path shipped in B6 fact read surface).
**Type**: UI (write). Manual-merge (renderer UI + renderer IPC bridge wiring). No new
main-process handler — `casebox:fact:create` already exists on `ipcMain` (WI-602, PR #52).
**Surface**: an "Add fact" control inside the existing Facts disclosure of the matter view
(`renderer/screens/viewMatterFacts.ts`). No new screen / route / modal / wizard.
**Grounds**: backend handler `createFactHandler` (`src/caseBox/factHandlers.ts`) +
`CreateFactDto` / `CREATE_FACT_RESPONSE_FIELDS` (`src/caseBox/dto.ts`); contract
`case-box-fact.schema.json` (R-5 `purpose` / `as_of_date`); precedent design
`dev-memo/design/2026-06-03-casebox-document-register.md` + code precedent
`viewMatterDocuments.ts renderAddControl`.

### Problem

The Facts section is read-only (`renderFactsDisclosure` → `loadFacts`): it shows "No facts
recorded for this matter." until facts can be added, but there is no way to add one. A lawyer
cannot record a claim, defense, or timeline event. The backend write channel
`casebox:fact:create` is live but unreachable — the renderer bridge (`electron/preload.mts`
whitelist + `renderer/api.ts`) does not expose it. This slice lets a lawyer **add one
manual fact to a matter** so the read surface becomes useful.

### Smallest safe vertical slice

Lawyer types a `statement_text` (and optionally chooses a `purpose`, and — only for a
timeline event — an `as_of_date`) → renderer calls `casebox:fact:create` with just those
fields → main injects identity / status / provenance and persists a `candidate`
lawyer-authored fact → the Facts list refreshes in place and shows it. One in-section control,
exactly like "Add document".

Nothing else: no review/accept/reject, no evidence/document linking, no edit, no delete.

### IPC contract (existing channel — consume, do not change)

```
casebox:fact:create   CreateFactDto { matterId: string;
                                       statement_text: string;        // required, non-empty
                                       purpose?: FactPurpose;         // optional R-5 enum
                                       as_of_date?: string }          // optional, date-only YYYY-MM-DD
                       -> IpcEnvelope<RendererCreatedFactRow>          // candidate, lawyer_authored
```

- `FactPurpose` ∈ { `claim`, `defense`, `counterclaim`, `timeline_event`, `work_order_result`,
  `consultation_q`, `consultation_a`, `other` }. Absent ⇒ persistence defaults to `other`.
- `as_of_date` rules are **server-enforced** (the UI mirrors them, never re-implements them):
  (a) FORMAT — whenever supplied, must match `^\d{4}-\d{2}-\d{2}$` (date-only, no time); (b)
  REQUIREDNESS — required non-empty when `purpose === "timeline_event"`. A violation returns
  `invalid_payload`.
- Server injects every authority / status / provenance field (`id`, `tenant_id`,
  `actor_user_id`, `matter_id`, `status: "candidate"`, `source_type: "lawyer_authored"`, all
  `source_*` / `extractor_*` / `reviewer_*` / review fields `null`, `created_at`). These are
  **forbidden in the DTO** → `invalid_payload`. The renderer never supplies them.
- The response is already projected to a renderer-safe allowlist (authority identities
  stripped); the created fact comes back with `status: "candidate"`.

#### Renderer bridge wiring (part of this WI)

`electron/preload.mts` adds `createFact: (dto) => ipcRenderer.invoke("casebox:fact:create", dto)`;
`renderer/api.ts` adds `createFact` to `CaseBoxClient` + `CaseBoxApi` and wires it through
`createCaseBoxApi` with a `RENDERER_CREATE_FACT_DTO_FIELDS` strip-allowlist (`matterId`,
`statement_text`, `purpose`, `as_of_date`) — mirroring `registerDocument`'s
`stripDtoFields(...)`. `preload.mts` is under `electron/`, not `renderer/`, so it is not
design-gated; `renderer/api.ts` is.

### UI

The Facts disclosure gains one **in-section** "Add fact" control above the list (sibling of
the `view-facts-list`), built with `el()` / `textContent` only — never `innerHTML`. Proposed
elements + test ids (mirroring the `view-docs-add-*` family):

- `view-facts-add-control` — wrapper `div`.
- `view-facts-add-statement` — a `<textarea>` for `statement_text` (multi-line; placeholder
  "Statement of fact"). Required.
- `view-facts-add-purpose` — a `<select>` over the 8 `FactPurpose` values (default `other`).
- `view-facts-add-asof` — a date `<input type="date">` for `as_of_date`, **hidden by default**;
  revealed (and marked required, `aria-required="true"`) only when
  `view-facts-add-purpose` value is `timeline_event` (a `change` listener toggles the `hidden`
  attribute). Mirrors the server's conditional rule; the server remains the validator.
- `view-facts-add` — the "Add fact" `<button type="button">`.
- `view-facts-add-status` — a `<span>` status line.

**Flow** (mirror `renderAddControl`): click → button `disabled` + status "Adding…" (role
cleared) → `api.createFact({ matterId, statement_text, purpose, ...(as_of_date when set) })`
→ button re-enabled → on success status "Added." + the list refreshes in place (re-run the
existing `loadFacts` against a cleared body, exactly as documents refresh) → the new
`candidate` fact appears via the existing `renderFactRow`.

#### Error / success states

| Condition | UI |
|---|---|
| Success | status `textContent = "Added."`; list refreshes; inputs may be cleared. |
| Empty `statement_text` (client pre-check) OR server `invalid_payload` | status gets `role="alert"` + `data-test-id="view-facts-add-error"`, `textContent = env.error.message` (safe server copy); no refresh. |
| `unknown_matter` / `tenant_mismatch` | same inline `role="alert"` path with the server message. |
| `timeline_event` without `as_of_date` | server returns `invalid_payload`; surfaced inline. The conditional reveal makes this rare, but the server is authoritative. |
| In flight | button `disabled`, status "Adding…", `role` removed so it is not announced as an alert. |

No envelope error ever throws to the console; every `!env.ok` renders inline (consistent with
`loadFacts`' existing `view-facts-error`).

### Accessibility notes

- Error status uses `role="alert"` only when an error is shown (set on failure, removed while
  loading) — matches the read surface's `view-facts-error` and the document Add control.
- The `as_of_date` input, when revealed, is `aria-required="true"`; when hidden it carries the
  `hidden` attribute (removed from the a11y tree), so a screen reader never sees an
  irrelevant date field for non-timeline purposes.
- Each control has an associated visible `<label>` (or `aria-label`) — `statement_text`,
  `purpose`, `as_of_date`. The button has a discernible name ("Add fact").
- Keyboard: the control is plain form elements in DOM order (textarea → select → [date] →
  button); no focus trap, no custom widget. The disclosure remains a native `<details>`.
- Color is not the only signal: success/error is conveyed by text + `role`, not color alone
  (defers to the existing token palette; `ui-tokenize` enforces tokens at implement time).

### Tests / acceptance (testable)

Renderer unit tests (extend `tests/renderer-view-matter.test.mjs`; bridge in
`tests/renderer-api.test.mjs` + `tests/renderer-dto-sync.test.mjs`), using the existing
`_view-matter-dom.mjs` harness + a mock `CaseBoxApi`:

1. **Add success** — `createFact` resolves `ok` → status shows "Added." and `listFacts` is
   re-invoked (list refreshes); the new candidate row renders.
2. **Conditional reveal** — selecting `purpose = timeline_event` un-hides `view-facts-add-asof`
   and sets `aria-required`; selecting any other purpose re-hides it.
3. **timeline_event missing as_of_date** — mock returns `invalid_payload` → inline
   `role="alert"` `view-facts-add-error`, no refresh.
4. **Empty statement** — client pre-check (or server `invalid_payload`) → inline alert, no
   `createFact` call (client pre-check) / no refresh.
5. **Server boundary** — `unknown_matter` / `tenant_mismatch` envelope → inline alert with the
   server message; never the raw matter id.
6. **DTO strip** — `createFact` only forwards `matterId` / `statement_text` / `purpose` /
   `as_of_date` (renderer allowlist); any extra key is dropped before invoke
   (`renderer-dto-sync` parity with `CREATE_FACT_DTO_FIELDS`).
7. **Safe DOM** — no `innerHTML`; all text via `el()` / `textContent` (covered by the existing
   no-hardcoded / import-shape checks + review).

Gate: `npm --prefix apps/lawbar-desktop test`.

### Out of scope (not bundled)

Fact review / accept / reject lifecycle; evidence / document linking; privilege /
confidentiality; fact edit / delete / supersession; bulk import; OCR-extracted facts; status or
purpose list filters; multi-step wizards or modals; WeChat Mini Program. All deferred.

### Stop condition

Retire when the Add-fact WI ships (referencing this artifact as its `Design artifact:`) and the
acceptance tests above are green. Stale if the `casebox:fact:create` DTO contract changes
before the WI lands.

---

## Design artifact — Review a fact (review / accept / reject lifecycle)

*Absorbed 2026-08-12 from `dev-memo/design/2026-06-05-casebox-fact-review.md`. Content verbatim; heading levels shifted one deeper.*


**Date**: 2026-06-05.
**WI (target)**: `PRODUCT(ui+bridge): fact review controls + status rendering` (BATCH-CASEBOX-FACT-REVIEW-00, WI-804 — the renderer half; the transition IPC shipped in WI-802).
**Type**: UI (write). Manual-merge (renderer UI + renderer IPC bridge wiring). No new main-process handler — `casebox:fact:transition` already exists on `ipcMain` (WI-802, PR #57).
**Surface**: per-fact Review / Accept / Reject controls + review-state rendering inside the existing Facts disclosure of the matter view (`renderer/screens/viewMatterFacts.ts`). No new screen / route / modal / wizard.
**Grounds**: backend handler `transitionFactHandler` (`src/caseBox/factHandlers.ts`, WI-802) + `TransitionFactDto` / `TRANSITION_FACT_RESPONSE_FIELDS` (`src/caseBox/dto.ts`); persistence `transitionFact` + the contract status enum (`case-box-fact.schema.json`: `candidate|reviewed|accepted|rejected`); ADR `docs/adr/case-box-step-2-fact-promotion-and-provenance.md` (no auto-accept); precedent designs `dev-memo/design/2026-06-05-casebox-fact-create.md` + `…-casebox-deadline-create-confirm.md`; code precedent `viewMatterDocuments.ts renderAddControl`.

### Problem

The Facts section lists facts (each created as a `candidate`, WI-602/701) but a lawyer cannot **act on** them — there is no way to mark a candidate fact reviewed, accept a reviewed fact, or reject a fact with a reason. The transition channel `casebox:fact:transition` is live (WI-802) but unreachable from the renderer (the bridge does not expose it, and the fact rows do not render review state). This slice lets a lawyer **move a fact through its review lifecycle** from the matter view.

### Smallest safe vertical slice

For each fact row, surface the transitions that are legal **from its current status**, plus render the current status clearly. Clicking a transition calls `casebox:fact:transition`; on success the facts list refreshes in place and the row shows its new status. One in-section control per row, mirroring the document-register / add-fact control shape.

### 1. Matter-view placement for the review controls

- The controls live on each fact row inside the existing **Facts disclosure** (`renderFactsDisclosure` → the per-row `renderFactRow`), NOT a new screen/modal. The WI-701 "Add fact" control stays above the list; review controls are per row, below each fact's statement/meta.
- Reuse the WI-701 `listContainer` + `runLoad`/`loadGen` structure so a successful transition refreshes the list in place (and the stale-load guard already added there applies).

### 2. Per-fact status rendering (candidate / reviewed / accepted / rejected)

Each row renders a status pill/label driven by the fact's `status` (already in the list response). Convey status by **text first** (never color alone):

- `candidate` — "Candidate" (neutral). Shows the Review and Reject actions.
- `reviewed` — "Reviewed" + the reviewed timestamp (`reviewed_at`). Shows the Accept and Reject actions.
- `accepted` — "Accepted" + `accepted_at`. Terminal in v1 — no further actions.
- `rejected` — "Rejected" + `rejected_at` + the `rejection_reason` text. Terminal in v1 — no further actions.

The data needed (`status`, `reviewed_at`, `accepted_at`, `rejected_at`, `rejection_reason`) is ALREADY in `LIST_FACTS_RESPONSE_FIELDS`; this slice only widens the renderer's `FactRow` display, no IPC change for reading. Use a per-status CSS class (token-driven) plus a `data-status` attribute and visible label so status is not color-only.

### 3. Review / Accept / Reject interaction model (legal edges only)

The handler/persistence enforce the state machine; the UI offers only the legal `to` for the current status (and must not offer an illegal one):

| Current status | Offered actions (`to`) |
|---|---|
| `candidate` | **Review** (`→ reviewed`), **Reject** (`→ rejected`) |
| `reviewed`  | **Accept** (`→ accepted`), **Reject** (`→ rejected`) |
| `accepted`  | none (terminal) |
| `rejected`  | none (terminal) |

There is **no `candidate → accepted` shortcut** — Accept is offered only on a `reviewed` fact (the contract/ADR bans auto-accept; the server returns `illegal_transition` if it is ever attempted, which the UI surfaces as an inline error). `candidate → rejected` IS offered (a candidate may be rejected without first being reviewed).

### 4. Rejection-reason UX

- **Reject** reveals a required `rejection_reason` text input (a small inline field or a compact confirm row on the row), then a "Confirm reject" action. The DTO is built with `to: "rejected"` + the non-empty `rejection_reason`.
- `rejection_reason` is **required** for reject: an empty/whitespace reason renders an inline `role="alert"` error and does NOT call the channel (client precheck; the server also enforces it → `invalid_payload`).
- `rejection_reason` is **never sent** for non-reject transitions (Review / Accept). The DTO for those is `{ matterId, factId, to }` with no `rejection_reason` key (the server rejects a `rejection_reason` supplied for a non-rejected `to` with `invalid_payload`; the UI must not send it).

### 5. Loading / error / stale-request behavior

Mirror the WI-701 add-fact control:
- On click: disable the row's action buttons + show a transient "…ing" status; wrap the call + refresh in `try/catch/finally` (finally re-enables the buttons; catch shows a generic inline `role="alert"`).
- On `ok`: the facts list refreshes **in place** (re-run `loadFacts` against the `listContainer`; the `loadGen`/`isCurrent` stale-load guard ensures a superseded load cannot mutate the refreshed list); the row reflects the new status.
- On `!ok`: an inline `role="alert"` carries the server's safe message (e.g. `illegal_transition`, `invalid_payload`, `unknown_matter`, `tenant_mismatch`) — never a raw id; the list is NOT refreshed.

### 6. Accessibility

- Every action is a real `<button>` with a discernible name ("Review", "Accept", "Reject", "Confirm reject") and is keyboard reachable in DOM order; no custom widgets, no focus trap; the disclosure stays a native `<details>`.
- The rejection-reason input has an associated visible `<label>` / `aria-label`; when revealed it is `aria-required="true"`, and is removed from the a11y tree (`hidden`) when not rejecting.
- Status is conveyed by **visible text** (the status label + timestamp + rejection reason), not color alone; the status element carries `data-status` for testability.
- Inline errors use `role="alert"` only when shown; in-flight status text has its `role` removed so it is not announced as an alert.
- Disabled/pending state: action buttons get the `disabled` attribute while a transition is in flight (a practical pending announcement); the status text updates to "…ing" then the terminal copy.

### 7. Safety / authority boundary

- The renderer forwards ONLY `{ matterId, factId, to, rejection_reason? }`. The bridge (`renderer/api.ts` + `RENDERER_TRANSITION_FACT_DTO_FIELDS`, parity-checked by `renderer-dto-sync`) strips any other key.
- The server / main process INJECTS `reviewer_actor_user_id` (active actor) + the `at` timestamp and computes the lifecycle fields (`status`, `reviewed_at`, `accepted_at`, `rejected_at`). The renderer MUST NOT supply reviewer actor, timestamps, status, `*_at`, `supersedes_fact_id`, `tenant_id`, or `actor_user_id` (the WI-802 handler rejects them as `invalid_payload`).
- The response is projected through `TRANSITION_FACT_RESPONSE_FIELDS` (authority identities stripped); the renderer renders only non-authority fields.

### 8. Test expectations for WI-804

- **Bridge strip/forward** (`renderer-api.test.mjs`): `transitionFact` forwards only the allowlisted fields; smuggled authority/lifecycle keys are dropped before invoke.
- **DTO parity** (`renderer-dto-sync.test.mjs`): `RENDERER_TRANSITION_FACT_DTO_FIELDS` ↔ `TRANSITION_FACT_DTO_FIELDS` field sets are equal.
- **Browser-faithful UI tests in a NEW dedicated file** `tests/renderer-fact-review.test.mjs` (mirroring `renderer-deadline-write.test.mjs` / `renderer-fact-write.test.mjs`): per-status the correct actions render (and illegal ones do NOT — e.g. no Accept on a candidate, no actions on accepted/rejected); Review/Accept transition success refreshes the list in place; Reject requires a non-empty reason (empty → inline error, channel NOT called) and never sends `rejection_reason` for non-reject; a backend `illegal_transition`/`invalid_payload` envelope renders inline `role="alert"` with no refresh; a stale superseded load cannot mutate the refreshed list; status text is present and not color-only (assert the visible label + `data-status`).
- **Do NOT modify `renderer-view-matter.test.mjs`** (it is at the loc-guardian 1200-LOC margin from the WI-704 split — keep it untouched; the new review tests go in the dedicated file). Wire the new test file into the `package.json` `test` script.

### Out of scope (not bundled)

Fact supersession (`supersedes_fact_id`) / replace-on-accept; un-reject / re-open of a terminal fact; bulk review; evidence/privilege linkage; review history / audit timeline rendering (the audit chain is a separate surface); filtering the fact list by status; the `reviewed → reviewed` no-op. All deferred.

### Stop condition

Retire when the WI-804 review-UI WI ships (referencing this artifact as its `Design artifact:`) and the acceptance tests above are green. Stale if the `casebox:fact:transition` DTO contract changes before WI-804 lands.

---

## Design artifact — Pending docket proposals: durable read + dismiss

*Absorbed 2026-08-12 from `dev-memo/design/2026-06-06-casebox-docket-pending-dismiss.md`. Content verbatim; heading levels shifted one deeper.*


**Date**: 2026-06-06.
**WI**: WI-D4 (BATCH-CASEBOX-DOCKET-LIFECYCLE-00) — renderer bridge + pending-proposals UI + dismiss UI.
**Type**: UI (read + a single dismiss write). Renderer + the preload bridge only: `apps/lawbar-desktop/electron/preload.mts` (invoke bindings — the real renderer IPC bridge) + `renderer/api.ts` + `renderer/types.ts` + the Deadlines screen. NO new main-process handler and NO change to `electron/ipc/**` or `electron/main.ts` — `casebox:docket:list` (WI-D1) and `casebox:docket:dismiss` (WI-D2) already exist on `ipcMain`; WI-D4 only adds the two invoke bindings to `preload.mts`.
**Surface**: a "Pending proposals" group INSIDE the existing Deadlines disclosure of the matter view (`renderer/screens/viewMatterDeadlines.ts`), plus a per-proposal **Dismiss** affordance. No new screen / route / modal / wizard. If the file nears the 800 LOC cap, the proposals group + its handlers extract to a sibling `renderer/screens/viewMatterDocketProposals.ts`.
**Grounds**: handlers `listDocketEntriesHandler` + `dismissDocketEntryHandler` (`src/caseBox/docketHandlers.ts`); `LIST_DOCKET_*` / `DISMISS_DOCKET_*` / `DOCKET_ENTRY_RESPONSE_FIELDS` / `RendererDocketEntryRow` (`src/caseBox/dto.ts`); ADR `docs/adr/case-box-step-6-deadline-docketing-rules.md`; precedent designs `dev-memo/design/2026-06-05-casebox-deadline-create-confirm.md` (propose→confirm) + `dev-memo/design/2026-06-05-casebox-fact-review.md` (per-row review/transition controls + reason capture). Code precedent: `viewMatterFacts.ts` review controls (legal-action-only, text-first status, narrow DTO forward, inline `role=alert`) + the existing `viewMatterDeadlines.ts` disclosure/urgency rendering.

### Problem

A proposed docket entry is **durably persisted** (`appendDocketEntry` writes a `confirmation_state="proposed"` row + a `DOCKET_ENTRY_PROPOSED` audit) but **invisible after reload**: the Deadlines section loads only `casebox:deadline:list` (confirmed deadlines), and the proposed entry lives in the UI only as an ephemeral `proposedEntryId` JS variable. A lawyer who proposes a deadline and reloads before confirming gets an **orphaned proposal** — still in the DB, gone from the screen, with no way to recover or cancel it. This slice surfaces durable pending proposals after reload (read) and lets the lawyer **dismiss/cancel** a stale one.

### Smallest safe vertical slice

On opening (disclosing) the Deadlines section, the renderer additionally calls `casebox:docket:list` filtered to `confirmation_state="proposed"` and renders a **"Pending proposals"** group above the confirmed-deadline list. Each proposed row shows the proposal's human fields and a **Dismiss** affordance. Dismiss collects a required reason, calls `casebox:docket:dismiss` `{ matterId, entryId, dismissal_reason }`, and on success removes the row (re-lists). Nothing else: no edit, no confirm-here (confirm stays in the existing propose→confirm control), no deadline status transition, no reminders.

### Layout (inside the Deadlines disclosure)

```
▼ Deadlines
   ┌─ Pending proposals (N) ────────────────────────────────┐   ← only shown when N >= 1
   │  • Filing — due 2026-06-30 14:00 America/New_York        │
   │      proposed 2026-06-01 · source: manual               │
   │      [ Dismiss ]                                         │
   │  • Hearing — due 2026-07-15 …                            │
   │      [ Dismiss ]                                         │
   └─────────────────────────────────────────────────────────┘
   (urgency banner — existing)
   Deadlines (confirmed) — existing list
      • …
   [ Add deadline ]  ← existing propose→confirm control (unchanged)
```

- The "Pending proposals" group renders ABOVE the confirmed-deadline list and the urgency banner, because an unconfirmed proposal is an action item awaiting the lawyer's decision.
- It is **omitted entirely when there are zero proposals** (no empty "Pending proposals (0)" chrome) — the confirmed list keeps its own existing empty state.
- Per-row fields (read-only, from `DOCKET_ENTRY_RESPONSE_FIELDS`): `proposed_kind` (label), `proposed_due_at` (formatted via the existing `formatLocalDateTime`) + `proposed_due_at_timezone`, `proposed_at` (proposed date), `source_type`. No actor/tenant identity is shown (they are stripped server-side; the renderer never receives them).

### States

- **Not loaded**: like the confirmed deadlines, the proposals group is lazily loaded — nothing fetched until the Deadlines disclosure is opened. (Matches the existing `deadlines: NOT loaded until summary clicked` behavior.)
- **Loading**: a brief "Loading…" affordance while the `casebox:docket:list` call is in flight (reuse the section's existing loading idiom).
- **Empty**: zero proposals → the group is not rendered at all (the confirmed list/urgency render as today).
- **Populated**: N proposed rows, each with a Dismiss affordance.
- **Paginated**: `casebox:docket:list` returns `{ rows, next_cursor }`. WI-D4 renders the **first page** and, when `next_cursor` is **non-null**, renders an explicit **"Show more"** affordance that fetches the next page (passing `cursor`) and **appends** its rows — mirroring the existing facts list `next_cursor` "Show more" pattern (`viewMatterFacts.ts`). Proposed entries beyond page one MUST be reachable (no silent truncation). Do NOT eager-load unbounded pages. The visible count reflects the rows currently loaded; "Show more" disappears once `next_cursor` is null.
- **Dismissing**: while a dismiss call is in flight, the row's Dismiss control is disabled (and shows a transient "Dismissing…" label) to prevent a double-submit.
- **Error (load)**: if `casebox:docket:list` returns an error envelope, render an inline `role="alert"` in the proposals area (mirrors `deadlines: envelope error renders inline role=alert`); the confirmed list still renders independently.
- **Error (dismiss)**: if `casebox:docket:dismiss` returns an error envelope (e.g. the entry was already confirmed/dismissed in another window → `invalid_payload`), render an inline `role="alert"` near that row, re-enable the control, and re-list so the UI reflects current state.

### Dismiss affordance + reason capture

- The dismiss control is a **two-step, in-row** affordance (mirrors the fact-review reject-with-reason precedent, not a separate modal): clicking **Dismiss** reveals a required **reason** text input + a **Confirm dismiss** button and a **Cancel** (back-out) button.
- **Reason is required**: Confirm dismiss is disabled until the reason field is non-empty (and the server also enforces non-empty `dismissal_reason` — defense in depth). The renderer trims and rejects whitespace-only locally before calling.
- On **Confirm dismiss**: call `casebox:docket:dismiss` with exactly `{ matterId, entryId, dismissal_reason }`. The renderer forwards ONLY those three fields (server injects actor + timestamp; the renderer never sends authority/timestamp/state fields).
- On **Cancel**: collapse the reason input back to the single Dismiss control; no call made.

### Destructive / confirmation behavior

- Dismiss is a **reversible-by-re-propose** action (the model is dismiss + re-propose; there is no in-place edit), and it does NOT delete data — it transitions the entry to `dismissed` with an audited reason. It is therefore treated as a **deliberate-but-not-catastrophic** action: the inline reason-capture step IS the confirmation (an explicit second click + a typed reason), consistent with the fact-reject precedent. No separate "Are you sure?" modal.
- Only **proposed** entries are dismissible from this UI (WI-D2 enforces proposed-only server-side; the UI only ever lists `confirmation_state="proposed"` rows, so a Dismiss control never appears on a confirmed/dismissed entry).

### Accessibility & keyboard

- The proposals group is a labelled region (`aria-label="Pending proposals"`); the count is in the visible heading text (not color-only).
- Each row's Dismiss control is a real `<button>`; the revealed reason field is a labelled `<input>`/`<textarea>` with an associated `<label>` (`for`/`id`); Confirm dismiss + Cancel are real `<button>`s — all reachable and operable by keyboard (Tab/Enter/Space), no mouse-only affordance.
- Disabled state during "Dismissing…" uses the `disabled` attribute (announced by AT), not visual-only graying.
- Errors use `role="alert"` so they are announced on appearance.
- Status/labels are **text-first** (e.g. the kind label, "proposed", "Dismissing…"), never color-only — consistent with the WI-804 review-controls convention.

### Relationship to the existing propose → confirm flow

- The existing **Add deadline** control (propose → confirm, `dev-memo/design/2026-06-05-casebox-deadline-create-confirm.md`) is UNCHANGED. After a successful **propose**, that control still shows its transient in-session "Proposed (unconfirmed)" row with a **Confirm** button (ephemeral, same session).
- The NEW "Pending proposals" group is the **durable, reload-surviving** view of the same proposed entries (read from persistence via `casebox:docket:list`), and it is where a lawyer **dismisses** a proposal they no longer want. Confirm remains in the propose→confirm control for this slice (confirming from the pending-proposals list is a possible future enhancement, explicitly out of scope here).
- After a **confirm** (via the existing control), the entry leaves `proposed` → the next list refresh drops it from "Pending proposals" and it appears in the confirmed deadlines list. After a **dismiss**, the entry leaves `proposed` → it drops from "Pending proposals" and does not appear anywhere else (terminal).

### Bridge (renderer wiring)

- `apps/lawbar-desktop/electron/preload.mts` (the real renderer IPC bridge — `renderer/preload.mts` does not exist): add `listDocketEntries` + `dismissDocketEntry` invoke bindings on the case-box client, alongside the existing `listDeadlines`/`createDocketEntry`/`confirmDocketEntry`/`transitionFact` bindings. Invoke bindings only — no main-process handler / `electron/ipc/**` / `electron/main.ts` change.
- `renderer/api.ts`: add `listDocketEntries(dto)` + `dismissDocketEntry(dto)` to `CaseBoxClient`/`CaseBoxApi`, each stripping outgoing DTO fields via `stripDtoFields(dto, RENDERER_LIST_DOCKET_DTO_FIELDS)` / `RENDERER_DISMISS_DOCKET_DTO_FIELDS`.
- `renderer/types.ts`: `ListDocketEntriesDto` + `DismissDocketEntryDto` + `RENDERER_LIST_DOCKET_DTO_FIELDS` (`["matterId","confirmation_state","source_type","limit","cursor"]`) + `RENDERER_DISMISS_DOCKET_DTO_FIELDS` (`["matterId","entryId","dismissal_reason"]`); `renderer-dto-sync` PAIRS assert these are set-equal to the canonical `LIST_DOCKET_DTO_FIELDS` / `DISMISS_DOCKET_DTO_FIELDS`. (WI-D4 MUST NOT touch `src/caseBox/dto.ts`; the canonical constants are imported/read for the sync assertion only.)
- The renderer reads only the human fields it renders; it never inspects authority identities (none are present in the projected response).

### Out of scope (hard stops for WI-D4)

- NO edit-in-place of a proposed entry (no contract operation; needs an ADR).
- NO deadline status transition (met/missed/withdrawn) — separate slice; persistence exists but no IPC.
- NO reminders / scheduling / notifications.
- NO confirm-from-the-pending-list (confirm stays in the existing propose→confirm control).
- NO change to `src/**`, `electron/ipc/**`, `electron/main.ts`, `services/**`, `docs/contracts/**`, or `apps/lawbar-desktop/src/caseBox/dto.ts`. The ONLY non-renderer file WI-D4 touches is `apps/lawbar-desktop/electron/preload.mts` (the two invoke bindings). If WI-D4 appears to require any of the forbidden paths, STOP and report.

### Acceptance hooks for WI-D4

- A test mounts the Deadlines section, lists a proposed entry, and asserts it renders in the "Pending proposals" group (proving reload visibility).
- A test asserts the Dismiss flow forwards exactly `{ matterId, entryId, dismissal_reason }` and that the row disappears / list refreshes on success.
- A test asserts a dismiss error renders inline `role="alert"`.
- A test asserts that when `casebox:docket:list` returns a non-null `next_cursor`, a "Show more" affordance is rendered and clicking it fetches + appends the next page (proposals beyond page one reachable; no silent truncation).
- `renderer-dto-sync` PAIRS for the two new DTO field-sets pass.
- `viewMatterDeadlines.ts` stays under the 800 source LOC cap (extract `viewMatterDocketProposals.ts` if needed); `loc-guardian:scan` clean.

---

## Design artifact — Deadline status-transition controls

*Absorbed 2026-08-12 from `dev-memo/design/2026-06-07-deadline-transition.md`. Content verbatim; heading levels shifted one deeper.*


**Status**: design artifact (WI-DT2) for BATCH-CASEBOX-DEADLINE-TRANSITION-00.
**Date**: 2026-06-07.
**Author**: Claude Code (UI lane).
**Implements / consumed by**: WI-DT3 (renderer UI) — cite this path in the WI-DT3 PR body to satisfy the path-based UI design-artifact gate.
**Backend**: WI-DT1 `casebox:deadline:transition` (`window.lawbar.caseBox.transitionDeadline`).

This is a text/DOM design (the app renders a token-styled DOM via the `el()` helper; there is no separate visual prototyping tool in this repo). It mirrors the shipped two-step capture used by `viewMatterDocketProposals.ts` (docket dismiss) and the fact-reject flow.

---

### 1. Where it lives

Inside `renderDeadlineRow()` (`apps/lawbar-desktop/renderer/screens/viewMatterDeadlines.ts`), append a **transition controls block** as the last child of the existing `<li class="view-deadlines-row">`, after the meta (`view-deadlines-row-meta`) and the optional detail (`view-deadlines-row-detail`). The current row already shows `kind · status` (`view-deadlines-kind`) and an urgency pill; the controls sit below them.

```
<li class="view-deadlines-row" data-test-id="view-deadlines-row">
  <div class="view-deadlines-row-meta"> due · kind · status · [urgency] </div>
  <div class="view-deadlines-row-detail"> rule · owner </div>          (optional, unchanged)
  <div class="view-deadlines-transition"                                (NEW)
       data-test-id="view-deadlines-transition"> … per-status controls … </div>
</li>
```

If LOC risk appears in `viewMatterDeadlines.ts`, the controls block + its handlers extract to a sibling `viewMatterDeadlineTransitions.ts` (allowed by WI-DT3); the placement above is unchanged.

### 2. Per-status affordances (visibility rule)

The control set is a pure function of the row's current `status` (the renderer never offers an edge the persistence state machine would reject; persistence remains the authority and surfaces `illegal_transition`):

| Current status | Controls shown |
|---|---|
| `pending`  | three buttons: **Mark met**, **Mark missed**, **Withdraw** (single-click each; no reason) |
| `missed`   | one button: **Mark met** → opens the two-step **required-reason** capture |
| `met`      | none (terminal in v1) |
| `withdrawn`| none (terminal in v1) |

For `met` / `withdrawn`, render no transition block (or an empty one) — there is no outgoing edge. Do not render disabled buttons for impossible edges.

### 3. Interaction — pending → met / missed / withdrawn (single-click)

These edges require no reason (`DeadlineTransitionOpts.transition_reason` omitted). One click:

1. Disable all three buttons in the row (busy guard — a fast double-click must not fire twice; mirrors the `pageLoading` re-entrancy guard).
2. Call `api.transitionDeadline({ matterId, deadlineId: d.id, to })`.
3. **On success** (`env.ok`): refresh the deadlines list via the existing generation-guarded `refresh()`/`load()` so the row re-renders with its new status (and loses its now-invalid controls).
4. **On error** (`!env.ok`): render an inline `role="alert"` message in `view-deadlines-transition-error`, **keep the row**, re-enable the buttons, and **do NOT call refresh** (the WI-D4 dismiss-error lesson — refreshing wipes the inline error and the user's place).

### 4. Interaction — missed → met (two-step, required reason)

`missed → met` requires a non-empty `transition_reason` (audit edge `DEADLINE_MISSED_TO_MET`). The reason capture **is** the confirmation (no separate modal — mirrors docket dismiss + fact reject):

1. Initial state: a single **Mark met** button.
2. Click **Mark met** → reveal a required reason `<input>` (`view-deadlines-transition-reason`, `aria-label="Reason met after missed"`) plus **Confirm** and **Cancel** buttons; hide the initial **Mark met** button.
3. **Cancel** → restore the initial state (hide input + Confirm/Cancel, show **Mark met**), discard any typed reason.
4. **Confirm** with an **empty/whitespace** reason → inline `role="alert"` "A reason is required to mark a missed deadline as met"; stay in the capture state; do **not** call the API.
5. **Confirm** with a non-empty reason → disable Confirm (busy guard) and call `api.transitionDeadline({ matterId, deadlineId: d.id, to: "met", transition_reason })`.
   - **Success** → refresh (generation-guarded), as §3.3.
   - **Error** → inline `role="alert"`, keep the row + the typed reason, re-enable Confirm, **no refresh**, as §3.4.

The renderer sends only `{ matterId, deadlineId, to, transition_reason? }`. The server injects the actor + timestamp and enforces the edge/reason rules; the renderer's reason gating is a UX convenience, not the security boundary.

### 5. Inline error + success semantics (summary)

- **Errors never refresh.** The row, its controls, and any typed reason stay; the error shows in an inline `role="alert"`; controls re-enable so the user can retry or cancel.
- **Success always refreshes** through the existing generation-guarded loader so a superseded load cannot clobber a newer one.
- **Busy guard** on every in-flight transition (disable the triggering control) prevents double submission.

### 6. Accessibility

- All controls are `<button type="button">` with explicit, distinct text labels (Mark met / Mark missed / Withdraw / Confirm / Cancel).
- The reason field is a labeled (`aria-label`) required text input; the empty-reason refusal is announced via the `role="alert"` error node.
- Error nodes use `role="alert"` so assistive tech announces them on appearance (consistent with the existing deadlines/docket error nodes).
- Focus: when the two-step capture opens, move focus to the reason input; on cancel, return focus to the **Mark met** button.
- Controls are keyboard-operable (native buttons/input); no custom key handling required.

### 7. data-test-id contract (for WI-DT3 renderer tests)

- `view-deadlines-transition` — the per-row controls container.
- `view-deadlines-transition-met` / `-missed` / `-withdrawn` — the pending-row single-click buttons.
- `view-deadlines-transition-reason` — the missed→met reason input.
- `view-deadlines-transition-confirm` / `-cancel` — the missed→met two-step buttons.
- `view-deadlines-transition-error` — the inline `role="alert"` error node.

### 8. Out of scope

Reminders, scheduling, docket edit, editing a deadline's `due_at`/`kind`/`owner`, any new persistence/contract field, and any transition not in the persistence edge set. `met` and `withdrawn` are terminal in v1 (no "reopen").

### 9. Stop condition

Implemented by WI-DT3; this artifact is retired when WI-DT3 merges. Superseded if the deadline edge set or the Deadlines section layout changes.

---

## Design artifact — Audit event-kind humanized labels

*Absorbed 2026-08-12 from `dev-memo/design/2026-06-08-audit-event-kind-labels.md`. Content verbatim; heading levels shifted one deeper.*


**WI**: WI-U2 (ASSET) of `BATCH-CASEBOX-AUDIT-EVENT-KIND-V2-UI-00`. **Date**: 2026-06-08.
**Status**: design artifact (authoritative for WI-U3). Renderer-only display; no contract/persistence change.
**Relates to**: `docs/adr/audit-event-kind-preservation.md` §8 (renderer maps kind→label; honest fallback).

This artifact specifies how WI-U3 renders the Batch-1 `event_kind` (projected to the audit DTO in WI-U1)
as a humanized label in the audit-history panel (`apps/lawbar-desktop/renderer/screens/viewMatterAudit.ts`,
`renderAuditEventRow`).

### 1. Render rule (replace-vs-augment)
- **Known `event_kind`** → the humanized label REPLACES the raw `action` text in the existing
  `view-audit-action` span (the row's primary, screen-reader-visible text). The entity detail
  (`entity_type · ulidShort(entity_id)`) and the optional `reason` line are UNCHANGED.
- **Null / missing / unknown `event_kind`** → the `view-audit-action` span shows the raw `action`
  (today's behaviour); together with the unchanged `entity_type · id` detail this is exactly the ADR
  `action · entity_type` fallback. **No inference** — never guess `DEADLINE_MET` vs `DEADLINE_MISSED`
  (or any transition) from `action`/`entity_type`; only a stored `event_kind` produces a label.

### 2. Accessibility
- The label is plain text inside the `view-audit-action` span → part of the accessible row name (not
  color/title-only).
- The audit list already carries `aria-live="polite"` (from the earlier a11y batch); appended rows —
  including their labels — are announced. No focus change.

### 3. Honest-wording constraint
Labels describe the recorded action only; they imply no fact not stored in the event (e.g.
`DEADLINE_MET` → "Deadline marked met", a record of the lawyer's action, not a court finding).

### 4. The label table (all 49 `CASE_BOX_AUDIT_EVENT_KINDS` keys)

| event_kind | label | (declared action · entity_type) |
|---|---|---|
| MATTER_REGISTERED | Matter created | create · matter |
| MATTER_ARCHIVED | Matter archived | update · matter |
| MATTER_UNARCHIVED | Matter unarchived | update · matter |
| DOCUMENT_REGISTERED | Document registered | create · document |
| DOCUMENT_OCR_SUBMITTED | Document OCR submitted | update · document |
| DOCUMENT_OCR_COMPLETE | Document OCR completed | update · document |
| DOCUMENT_OCR_FAILED | Document OCR failed | update · document |
| DOCUMENT_TRIAGED | Document triaged | update · document |
| DOCUMENT_TAGGED | Document tagged | update · document |
| DOCUMENT_REVIEWED | Document reviewed | update · document |
| DOCUMENT_SOFT_DELETED | Document deleted | delete-soft · document |
| OCR_LINK_SNAPSHOTTED | OCR link snapshotted | create · ocr_link |
| OCR_LINK_REFRESHED | OCR link refreshed | update · ocr_link |
| DEADLINE_REGISTERED | Deadline registered | create · deadline |
| DEADLINE_MET | Deadline marked met | update · deadline |
| DEADLINE_MISSED | Deadline marked missed | update · deadline |
| DEADLINE_WITHDRAWN | Deadline withdrawn | update · deadline |
| DEADLINE_MISSED_TO_MET | Missed deadline marked met | update · deadline |
| EVIDENCE_PROPOSED | Evidence proposed | create · evidence_item |
| EVIDENCE_ACCEPTED | Evidence accepted | update · evidence_item |
| EVIDENCE_REJECTED | Evidence rejected | update · evidence_item |
| EVIDENCE_SUPERSEDED | Evidence superseded | update · evidence_item |
| FACT_PROPOSED | Fact proposed | create · fact |
| FACT_REVIEWED | Fact reviewed | update · fact |
| FACT_ACCEPTED | Fact accepted | update · fact |
| FACT_REJECTED | Fact rejected | update · fact |
| FACT_REPLACEMENT_ACCEPTED | Replacement fact accepted | create · fact |
| PRIVILEGE_MARKER_PROPOSED | Privilege marker proposed | create · privilege_marker |
| PRIVILEGE_MARKER_CONFIRMED | Privilege marker confirmed | update · privilege_marker |
| PRIVILEGE_MARKER_DISMISSED | Privilege marker dismissed | update · privilege_marker |
| PRIVILEGE_MARKER_WAIVED | Privilege waived | privilege-waive · privilege_marker |
| EXTERNAL_OCR_AUTHORIZED | External OCR authorized | update · matter |
| EXTERNAL_OCR_REVOKED | External OCR revoked | update · matter |
| SYNC_GRANT_GRANTED | Sync grant granted | update · matter |
| SYNC_GRANT_REVOKED | Sync grant revoked | update · matter |
| LLM_EXTRACTION_OPT_IN | LLM extraction opted in | update · matter |
| LLM_EXTRACTION_OPT_OUT | LLM extraction opted out | update · matter |
| PRIVILEGE_LOG_EXPORTED | Privilege log exported | export · matter |
| CASE_DATA_EXPORTED | Case data exported | export · matter |
| DOCUMENT_ACCESSED | Document accessed | access · document |
| DOCUMENT_PRINTED | Document printed | print · document |
| DOCUMENT_SHARED | Document shared | share · document |
| CLASSIFICATION_SET | Confidentiality set | create · confidentiality_classification |
| CLASSIFICATION_UPGRADED | Confidentiality upgraded | create · confidentiality_classification |
| CLASSIFICATION_DOWNGRADED | Confidentiality downgraded | create · confidentiality_classification |
| CLASSIFICATION_RESET_TO_UNCLASSIFIED | Confidentiality reset to unclassified | create · confidentiality_classification |
| DOCKET_ENTRY_PROPOSED | Docket proposal created | create · docket_entry |
| DOCKET_ENTRY_CONFIRMED | Docket proposal confirmed | update · docket_entry |
| DOCKET_ENTRY_DISMISSED | Docket proposal dismissed | update · docket_entry |

(The `(action · entity_type)` column is reference only — it is the fallback shown when the kind is
null/unknown; it is NOT appended when a label is shown.)

### 5. WI-U3 implementation shape
- `apps/lawbar-desktop/renderer/screens/auditEventLabels.ts` (new): `export const EVENT_KIND_LABELS:
  Record<string, string>` with the 49 rows above + `export function auditEventLabel(ev): string` that
  returns `EVENT_KIND_LABELS[ev.event_kind]` when present/known, else `ev.action` (the raw action; the
  entity detail supplies the `· entity_type`).
- The map MUST stay in sync with `CASE_BOX_AUDIT_EVENT_KINDS`; WI-U3 adds a test asserting every map key
  is a valid kind (and, ideally, that every current kind has a label).

### 6. Out of scope
No `audit_schema_version` display; no audit filtering/search; no inference of transitions; no
contract/persistence/Electron change.

### Stop condition
Promoted to WI-U3 (renderer implementation); artifact retired once WI-U3 ships.

---

## Design artifact — Renderer accessibility + pagination-safety polish

*Absorbed 2026-08-12 from `dev-memo/design/2026-06-08-renderer-a11y-pagination-polish.md`. Content verbatim; heading levels shifted one deeper.*


**WI**: WI-AP1 (ASSET) of `BATCH-CASEBOX-RENDERER-A11Y-POLISH-00`. **Date**: 2026-06-08.
**Status**: design artifact (authoritative for WI-AP2). Implementation-shaping, not a contract change.
**Scope**: renderer-only, **existing IPC only**. No contract / persistence / Electron / DTO / source-IPC change.

This artifact specifies the accessibility and pagination-safety polish that WI-AP2 implements in four
renderer screens:

- `apps/lawbar-desktop/renderer/screens/viewMatterDocuments.ts`
- `apps/lawbar-desktop/renderer/screens/viewMatterFacts.ts`
- `apps/lawbar-desktop/renderer/screens/viewMatterAudit.ts`
- `apps/lawbar-desktop/renderer/screens/viewMatterDeadlines.ts`

The canonical precedent for the pagination guard already exists in the codebase at
`apps/lawbar-desktop/renderer/screens/viewMatterDocketProposals.ts:95-100` — WI-AP2 mirrors it, it does
not invent a new pattern.

---

### 1. Show-more re-entrancy guard (documents, facts, audit)

#### Problem
Each of the documents / facts / audit panels paginates via a `loadPage()` closure wired to a "Show more"
button's `click` handler. None of the three has an in-flight guard. A user who double-clicks "Show more"
(or clicks while the IPC round-trip is pending) triggers two concurrent `loadPage()` calls against the
same `cursor`, which **double-fetches the same page and double-appends its rows**. The docket-proposals
panel already solved this:

```ts
let pageLoading = false; // re-entrancy guard: a fast double-click must not append the same page twice
const loadPage = async (): Promise<void> => {
  if (pageLoading) return;       // a fetch is already in flight — drop the concurrent call
  pageLoading = true;
  try {
    env = await api.listX(dto);
  } finally {
    pageLoading = false;         // always clear, even on throw, so the next click works
  }
  // …append rows, re-attach Show-more…
};
```

#### Required pattern (apply to all three)
- Declare a closure-scoped `let pageLoading = false;` alongside the existing `cursor` / `moreBtn` state.
- First statement of `loadPage()`: `if (pageLoading) return;` then `pageLoading = true;`.
- Wrap the `await api.list…(…)` IPC call in `try { … } finally { pageLoading = false; }` so the guard
  clears on success **and** on throw (a failed fetch must not permanently wedge pagination).
- The guard is per-panel/per-closure state; it must not be module-global (multiple matters / re-renders
  must each get their own guard).

#### Per-file anchors
- **documents** (`viewMatterDocuments.ts`): `loadPage()` ~260-307; `api.listDocuments` ~265. Note it
  removes + recreates `moreBtn` each page — keep that; only add the guard around the fetch.
- **facts** (`viewMatterFacts.ts`): `loadPage()` ~458-507; `api.listFacts` ~463.
- **audit** (`viewMatterAudit.ts`): `loadPage()` ~305-350; `api.listAuditEvents` ~306; appends to the
  `<ol class="view-audit-list">`.

### 2. Button disabled / loading feedback while a page request is in flight

For the **audit** Show-more specifically, the transient in-flight state must be visible/guarded, not just
internally dropped:

- On entering `loadPage()` (after setting `pageLoading = true`), if the Show-more button is currently
  mounted, set `moreBtn.disabled = true` (or equivalent `aria-disabled` + `disabled` attribute) so a
  second click is both ignored (guard) **and** visibly suppressed.
- In the `finally`, restore the button to enabled before (or as part of) re-attaching it for the next page.
- This is required for audit (acceptance criteria call it out). Documents/facts get the same disabled
  treatment if it is mechanically free with the guard; the load-bearing requirement is the no-double-append
  guard for all three and the visible disabled state for audit.

### 3. aria-label assignments

Add a stable, human-readable `aria-label` to each of these controls (screen-reader naming; no visual change):

| Control | File / anchor | aria-label (intent) |
|---|---|---|
| Document-type `<select>` | `viewMatterDocuments.ts:98` (`view-docs-add-type`) | "Document type" |
| Add-document button | `viewMatterDocuments.ts` (`view-docs-add`) | "Add document" |
| Audit chain-head disclosure | `viewMatterAudit.ts:51` (`view-chain-summary` `<summary>`) | "Audit chain head details" |
| Audit Show-more button | `viewMatterAudit.ts:336` (`view-audit-more`) | "Show more audit events" |
| Copy-hash button | `viewMatterAudit.ts:112` (`view-chain-copy`) | "Copy chain-head hash" |

Exact label wording may be refined during impl; the requirement is that each control exposes a non-empty
`aria-label`. The add-document button already has visible text "Add document"; the `aria-label` makes the
accessible name explicit and stable against future text changes.

### 4. aria-live behavior

- **Appended audit list** (`viewMatterAudit.ts` `<ol class="view-audit-list">`): give the list (or its
  container) `aria-live="polite"` so newly appended audit rows are announced when "Show more" loads a page,
  without stealing focus.
- **Deadline urgency banner** (`viewMatterDeadlines.ts:643-655`): the banner already has `role="status"`;
  add an explicit `aria-live="polite"`. `role="status"` implies a polite live region, but explicit
  `aria-live` is the testable, unambiguous contract and avoids reliance on implicit role mapping. This is a
  **single-attribute** change — `viewMatterDeadlines.ts` is 745/800 pure LOC, so the edit must stay minimal.

### 5. Error / loading states must not wipe already-rendered rows

Pagination and any load/error feedback must be **additive**. Specifically:

- A failed `api.list…()` call (or an error envelope) must NOT clear previously rendered rows. The guard's
  `finally` clears `pageLoading`; the error path may surface an inline error node (the audit panel already
  has a `view-audit-error` alert) but must leave the existing list intact.
- The "Show more" flow appends; it never re-renders the whole list from scratch. The existing
  remove-and-recreate of the *Show-more button itself* is fine — that is the button, not the rows.

### 6. Non-goal — audit event labels are NOT humanized in this batch

The audit panel today renders raw `action · entity_type` (e.g. "update · deadline"). Humanizing this to
distinguish *met / missed / withdrawn* is **explicitly out of scope** and must not be attempted here,
because the audit `kind` is **not persisted**: the audit event entity stores only `action` + `entity_type`
(+ hashes / reason / open-index); `buildCaseBoxAuditEvent` maps the input `kind` to `{action, entity_type}`
and **drops the kind** at build time. The renderer therefore cannot recover the kind from existing IPC.
Humanized labels require storing the kind (or a derived label) on the hash-verified audit event — a
contract + persistence + ADR change — and belong in a separate future ADR-first batch, not WI-AP2.

---

### Acceptance (for WI-AP2)
Observable in the existing renderer test harness:
1. Rapid double-click on documents / facts / audit "Show more" → exactly one `api.list…` call and one page
   of rows appended (no double-fetch, no double-append).
2. Document-type select, add-document button, audit disclosure, audit Show-more, copy-hash → each exposes a
   non-empty `aria-label`.
3. Deadline urgency banner → `aria-live="polite"`.
4. Audit Show-more → `disabled` while a page load is in flight (test holds an unresolved api promise to
   observe the transient state, per the review-plan Medium finding).
5. `npm --prefix apps/lawbar-desktop test` passes; loc-guardian reports no over-limit file.

---

## Design artifact — Docket proposal edit UI (DPE5)

*Absorbed 2026-08-12 from `dev-memo/design/2026-06-12-docket-proposal-edit-ui.md`. Content verbatim; heading levels shifted one deeper.*


**Status**: design direction (human-authored noun) for `WI-DPE5`. Satisfies the `Type: UI`
design-artifact gate (`UI-GATES.md` §"Queue entry gate" + §"PR-time gate"). NOT implementation-authorizing
on its own — the governed `WI-DPE5` queue block + `/cc-suite:review-plan` authorize implementation.
**Date**: 2026-06-12.
**Feature**: in-place edit of a **proposed** docket entry's content, the terminal UI layer of the
docket-proposal-edit feature (contract DPE2 → hardening FIX1 → persistence DPE3 → IPC/DTO DPE4 → **UI DPE5**).
**Plan**: `dev-memo/plan-batch-casebox-docket-proposal-edit-ui-00.md`.
**Source of truth**: `docs/adr/docket-proposal-edit.md` §3 (six editable fields), §4 (immutable
provenance/lifecycle), §6 ("(edited)" / `revised_at` visibility), §9 (DPE5 = UI).
**Surface**: `apps/lawbar-desktop/renderer/screens/viewMatterDocketProposals.ts` — the pending-proposals
group inside the matter view's Deadlines disclosure.

---

### 1. Intent

Let a lawyer correct the content of a docket proposal they already created (or that was machine-suggested)
**before** confirming it into a deadline — without deleting and re-creating it, and without any risk of the
renderer touching authority, provenance, lifecycle, or audit data. Editing is a content fix on a still-
**proposed** entry; it is **not** a confirmation and **not** a dismissal.

---

### 2. UI pattern — per-row two-step reveal (mirrors dismiss)

The edit affordance reuses the exact interaction shape of the existing in-row **Dismiss** control so the
screen stays visually and behaviorally coherent.

```
┌ Pending proposals (2) ─────────────────────────────────────────────┐
│ • filing · manual   due Jun 20, 2026 4:00 PM   proposed Jun 1       │
│                                            [ Edit ] [ Dismiss ]      │   ← default row
│                                                                     │
│ • hearing · manual  due Jun 22, 2026 9:00 AM  proposed Jun 2 (edited)│  ← revised_at present → badge
│                                            [ Edit ] [ Dismiss ]      │
└─────────────────────────────────────────────────────────────────────┘

Edit pressed on row 1 → two-step reveal (Dismiss hidden while editing):

┌─────────────────────────────────────────────────────────────────────┐
│ • Kind:        [ filing            ]                                 │
│   Due:         [ 2026-06-20T16:00 ]   Kind: (datetime ▾)            │
│   Timezone:    [ America/New_York ]   (host zone)                    │
│   Owner:       [ local-user        ]                                 │
│   Reminders:   advance_notice −7d, final_notice −1d   (read-only)    │   ← passthrough, §4
│                                  [ Save changes ] [ Cancel ]  ⓘ      │
└─────────────────────────────────────────────────────────────────────┘
```

Rules:

- **Edit** and **Confirm** (the deadline-confirm action elsewhere in the Deadlines section) are **distinct**.
  There is **no edit-then-confirm shortcut** (ADR §3): saving an edit leaves the entry **proposed**; the
  lawyer confirms separately when ready.
- Only one mode per row at a time: revealing Edit hides Dismiss; revealing Dismiss hides Edit. (Mirrors the
  existing single-control reveal.)
- The reveal is inline within the row — no modal, matching the dismiss + add-deadline precedents.

---

### 3. Form scope — five editable controls + one passthrough

Editable (renderer controls):

| Field | Control | Validation (UX layer; main is authoritative) |
|---|---|---|
| `proposed_kind` | text | non-empty |
| `proposed_due_at` | datetime / date input | parseable ISO-8601; host-zone resolver reused from add-deadline |
| `proposed_due_at_kind` | select `datetime` / `date_only` | one of the two |
| `proposed_due_at_timezone` | text/display, **host zone** | IANA zone; `null` only with `date_only`; `date_only→datetime` upgrade needs a valid zone (ADR §3) |
| `proposed_owner_user_id` | text | non-empty (single-lawyer default `local-user`) |

Passthrough (NOT a rich editor in DPE5):

- **`reminder_offsets`** — **read-only display + unchanged passthrough on save**:
  - If the existing reminders are available on the projected row, display them read-only (e.g.
    `advance_notice −7d, final_notice −1d`).
  - On **Save**, send the existing `reminder_offsets` value **unchanged** as part of the 6-field content set
    (so the persistence edit never sees a dropped/blanked reminders array).
  - **No add/remove/reorder editor** in this WI. A rich reminder editor is deferred to a separate future
    UI WI if a need arises (`WI-DPE5-L*` / a follow-up), not folded into DPE5.

Rationale for passthrough: `reminder_offsets` is a nested `{offset_days, kind}[]` array; a full editor is
disproportionate to this slice and would widen the surface. Passthrough keeps DPE5 bounded and the security
surface identical to confirm/dismiss while still letting the lawyer fix the five scalar fields.

---

### 4. Forbidden fields — never an editable control

The edit form renders **no** editable control for any of: `tenant_id`, `matter_id`/matter authority,
`actor_user_id`, `editor_actor_user_id`, `id`/`entry_id` (identity), `source_type`,
`source_rule_citation`, `extractor_*`, `extraction_confidence`, `source_document_id`, `source_page_number`,
`source_excerpt` (provenance), `confirmation_state`, `proposed_at`, `confirmation_actor_user_id`,
`confirmed_at`, `confirmed_deadline_id`, `dismissal_actor_user_id`, `dismissed_at`, `dismissal_reason`,
`created_at` (lifecycle/audit), and **`revised_at`**.

- `matterId`/`entryId` are scope the screen already holds (from the listed row); they are **not** user-
  editable form fields — they are passed as the immutable target of the edit.
- `revised_at` may be **displayed** only as renderer-safe edited-state metadata (§5); it is never an input.
- These align with the app's `EDIT_DOCKET_FORBIDDEN_FIELDS` (the server-side authority); the renderer's
  `RENDERER_EDIT_DOCKET_DTO_FIELDS` allowlist + `stripDtoFields` are the renderer-side second layer.

---

### 5. Edited state — "(edited)" badge

- A row whose projected `revised_at` is present renders an **"(edited)"** badge in the meta line (next to
  kind/due/proposed-at), with accessible text (not color-only).
- Presence of the badge is the machine-suggested-vs-user-edited distinction (ADR §6): no `revised_at` +
  `source_type=llm_extraction` = machine-suggested; `revised_at` present = user-edited.
- If a timestamp is shown, it is **secondary and non-authoritative** — e.g. a `title`/tooltip or a muted
  inline `edited <localized time>` via `formatLocalDateTime(revised_at)`. The badge, not the timestamp, is
  the primary signal.
- The badge is derived purely from the projected row; the renderer never computes or writes `revised_at`.

---

### 6. Save / cancel behavior

- **Save changes**: validate the five editable fields → call the DPE4 renderer bridge
  `api.editDocketEntry({ matterId, entryId, proposed_kind, proposed_due_at, proposed_due_at_kind,
  proposed_due_at_timezone, proposed_owner_user_id, reminder_offsets })` — **only** `matterId`, `entryId`,
  and the six content fields (five edited + `reminder_offsets` passthrough). Disable controls, show
  "Saving…".
  - **Success**: the entry stays **proposed** with revised content → refresh/reconcile the row **in place**
    (the section's existing generation-guarded `refresh()`), so it reappears with the new values + the
    "(edited)" badge. No navigation, no confirm side effect.
  - **Error** (`!env.ok`): keep the form open with the entered values, show the **normalized** inline error
    (`env.error.message`, already a static no-leak string from main) via accessible alert semantics,
    re-enable **Save changes**. Do **not** refresh on error (a reload would wipe the inline alert — matches
    the dismiss + confirm-deadline error paths).
- **Cancel**: exit edit mode with **no API call**; discard entered values; restore the Edit/Dismiss buttons;
  clear any status.
- Re-entrancy: a per-control `saving` guard prevents a double-click on Save from firing two `editDocketEntry`
  calls (mirrors the dismiss/`pageLoading` guards).

---

### 7. Accessibility / keyboard

- **Edit**, **Save changes**, **Cancel** are all real `<button type="button">` elements — keyboard
  reachable and operable (Enter/Space), mirroring the dismiss control.
- Each edit input has an associated label / `aria-label`; required fields carry `aria-required="true"`
  (mirrors the dismiss reason input's `aria-required`).
- Inline error uses the screen's existing accessible-alert pattern: `role="alert"` +
  `data-test-id="...-error"` (same as `view-docket-dismiss-error`).
- **Focus**: on reveal, focus moves to the first edit field; on Save-success (after refresh) or Cancel,
  focus returns predictably to the row's Edit button (or the next logical control) — never dropped to
  document top. **Escape** cancels the edit.
- The "(edited)" badge exposes accessible text (e.g. visually-hidden "edited" or `aria-label`), not color
  alone — satisfies the axe regression-gate floor (UI-GATES §B is a floor, not certification).

---

### 8. Scope / exclusions

- **No renderer-wide redesign** — only the per-row edit affordance + the badge are added; the proposals
  section's layout, pagination, generation guard, and the dismiss control are otherwise untouched.
- **No persistence / IPC / contract / error-map change** — DPE5 reuses the frozen DPE3 persistence op,
  the DPE4 `casebox:docket:edit` channel + DTO, and the existing no-leak error mapping verbatim.
- **No new IPC channel.**
- **No rich `reminder_offsets` editor** in DPE5 (passthrough only; §3).
- **confirm / dismiss / create / list behavior unchanged.**
- **Not WI-DPE2-FIX2** (Class-B contract hardening — separate, deferred).
- The visual / a11y / Lighthouse regression gates (UI-GATES §A/B/C) are not yet wired into automation;
  DPE5 relies on this artifact + renderer unit tests + manual review.

---

### 9. Acceptance signals (for the eventual review-plan / tests)

1. Edit reveals a form prefilled with the five editable values + the read-only reminders; Dismiss hidden
   while editing.
2. Save sends exactly `{ matterId, entryId, + six content fields }` — no authority/provenance/lifecycle/
   `revised_at`; `reminder_offsets` is the unchanged existing value.
3. Successful save keeps the entry proposed and refreshes the row in place with new values + "(edited)" badge.
4. Error keeps the form, shows a normalized inline alert, re-enables Save, does not refresh, leaks no
   tenant/matter/id.
5. Cancel makes no API call.
6. Edit/Save/Cancel keyboard reachable; focus returns predictably; Escape cancels.
7. confirm/dismiss/create/list behavior unchanged.

---

### 10. Stop condition

Consumed when `WI-DPE5` is promoted to a governed queue block citing this artifact and review-plan returns
READY. Outdated if the DPE4 DTO/projection surface changes or `docs/adr/docket-proposal-edit.md` §3/§6/§9
is revised.

---

## Design artifact — Audited evidence-links renderer UI (view / create / unlink / relink / export)

*Absorbed 2026-08-12 from `dev-memo/design/2026-06-26-audited-evidence-links-ui.md`. Content verbatim; heading levels shifted one deeper.*


**Date**: 2026-06-26.
**WI (target, future)**: `WI-A3-LINK-UI-T1` — renderer UI for the audited link lifecycle (Type: UI; this artifact is
its `Design artifact:` gate reference).
**WI (this)**: `WI-A3-LINK-UI-DESIGN-00` (design-only; not A0.7-gated; no renderer code).
**Type**: UI (design only). **Surface**: a per-matter "Evidence links" disclosure inside the existing matter
detail view.
**Grounds**: the live persistence lifecycle (`createLink`/`unlinkLink`/`relinkLink` + `resolveLinkStatuses`/
`buildExportCitations`, `LINK_CREATED`/`LINK_UNLINKED`/`LINK_RELINKED`); the merged IPC surface (5 `casebox:link:*`
channels + preload `CaseBoxApi` methods, PR #142); `docs/adr/ADR-evidence-a3-link-ipc-surface.md`; and the renderer
precedents (fact create + fact review two-step + deadline transition two-step; status-label+`data-status`
rendering; i18n catalog; a11y patterns).

### Problem

The audited link lifecycle is complete in persistence + IPC, but the renderer has NO UI for it (and no link
methods in `renderer/api.ts`/`renderer/types.ts` yet). A lawyer cannot view a matter's evidence links, create a
link, see its status/export flags, unlink (break) a link with a reason, or relink it. This artifact designs that UI
so the future `WI-A3-LINK-UI-T1` impl lane has a settled, gate-referenceable design.

### Smallest safe vertical slice

A per-matter "Evidence links" disclosure (mirroring the Facts disclosure) that lists links with their resolver
**status + lifecycle** (NOT export flags — those live in the export panel, §2) and offers create / unlink
(reason-required) / relink actions, plus an "Export citations" trigger that shows the export citation set (where the
export flags appear). **Out of this slice**: export-document RENDERING (only the export DATA is shown/triggered); per-
evidence/per-anchor filtered views (matter-scoped list only in v1); any new audit-chain-internal display.

### 1. Placement / structure

- A new disclosure section **"Evidence links"** in the matter detail view, lazy-loaded on summary click (the Facts
  disclosure pattern, `renderer/screens/viewMatterFacts.ts`). Data via `api.listLinks({ matterId })` (matter from
  route context). A new screen module `renderer/screens/viewMatterLinks.ts` (loc-guardian: a dedicated file, not
  folded into `viewMatter.ts`).
- A **"Create link"** sub-form at the top of the section; the **list** below; each row carries its resolver
  **status + lifecycle** (active/unlinked), `created_at`, the `unlink_reason` (when unlinked), and its action(s) —
  **NOT** export flags (those are in the export panel, §2).
- An **"Export citations"** button at the section header that calls `api.exportLinkCitations({ matterId })` and
  renders the returned `{ citations, byFlag }` as a read-only citation list (卷X页Y labels + per-link status/flag +
  the byFlag summary counts). Export-to-document is a separate later lane.

### 2. UI state model for link rows + actions

**Two distinct data sources — the row contract is `RendererLink` ONLY (audit M1):**
- **The list row** is built from `RendererLink` (the `listLinks` projection), whose fields are exactly `id,
  matter_id, source_type, source_id, anchor_id, status, created_at, unlinked_at, unlink_reason`. So a row renders
  ONLY: the **lifecycle** (`active` when `unlinked_at` NULL vs `unlinked` when set, carrying `unlink_reason`) and the
  **resolver status** `status ∈ { valid, needs_review, broken }`. **`exportFlag` is NOT on `RendererLink`** and the
  list row MUST NOT show it — `LINK_RESPONSE_FIELDS` MUST NOT be extended with `exportFlag` (that would be an IPC
  contract change, out of scope; STOP if the impl wants it).
- **The export flags** (`exportFlag ∈ { null(clean), UNLINKED, BROKEN, NEEDS_REVIEW, NON_CITABLE, AMBIGUOUS }`) live
  ONLY in `ExportCitationResult.citations[]` (the SEPARATE `exportLinkCitations` call) and are shown ONLY in the
  **export-citations panel** (§1), joined to their link by `linkId` there — never folded into the list-row load.
- **Render rule** (never color-only): the list row shows a visible **status** label + `data-status="<status>"` + a
  CSS class (e.g. `view-links-status--broken`), mirroring the deadline urgency pill; the export panel shows a
  visible **flag** label + `data-flag="<exportFlag|clean>"` per citation. Labels live in the i18n catalog (§6). A
  row also shows `created_at`, and for an unlinked link the `unlinked_at` + `unlink_reason` (the audit-relevant
  facts; §7-auditability).
- **Action availability** (mirrors `reviewActionsFor(status)` in facts): an `active` link → **Unlink**; an
  `unlinked` link → **Relink**. Create is the section-level form. No action mutates by guessed id — every action
  carries `matterId` + `linkId` (the IPC layer does the scoped preflight).

### 3. User-facing action flows (create / unlink / relink)

All flows follow the precedent: disable controls → status "处理中… / Working…" → `api.<op>(dto)` → on `ok` refresh
the list in place + a success line ("已创建 / Created.", etc.); on `!ok` show the server message inline
(`role="alert"`), keep inputs, re-enable.

- **Create** (`api.createLink({ matterId, sourceType, sourceId, anchorId })`): a form — `sourceType` `<select>`
  (the 5-enum evidence/note/question/calcTerm/claimElement), `sourceId` + `anchorId` text inputs. Client validates
  non-empty + the sourceType enum (the IPC layer is the second guard). Not destructive → no extra confirmation
  beyond the form submit.
- **Unlink** (meaningful / durable / audited) (`api.unlinkLink({ matterId, linkId, unlinkReason })`): a per-row
  **Unlink** button reveals a **required** reason input (two-step, like fact-reject + deadline missed→met). Copy
  warns this **breaks the citation** and is **recorded in the audit trail**. Client guards a non-empty/non-blank
  reason before the call (server also enforces). Confirm button = "确认断开 / Confirm unlink".
- **Relink** (`api.relinkLink({ matterId, linkId })`): a per-(unlinked)-row **Relink** button, **no reason** (the
  persistence relink takes none); copy = "恢复此链接 / Restore link". One-click (it is reversible — the link is
  restored, the resolver recomputes the real status).

### 4. A0.7-gating + confirmation behavior

A0.7 is a **dev/commit-time governance gate, NOT a runtime feature** (`ADR-evidence-a3-link-ipc-surface.md` D4).
Therefore the UI **does NOT** show an "A0.7 marker" prompt or a runtime gate-unlock step, and the impl lane MUST
NOT invent one. The user-facing "confirmation behavior for a meaningful mutating action" is the **two-step
reason flow for unlink** (deliberate, reason-required) + the **create form submit**; relink is a single reversible
click. Runtime safety = the OS-sandbox offline posture + main-injected actor/tenant (the renderer never supplies
identity) — the UI surfaces none of that; it just calls the IPC method and renders the `{ok,error}` envelope.

### 5. Error / empty / loading / gate-failure display model

- **Loading**: a text banner ("加载链接… / Loading links…") — not spinner-only.
- **Empty**: a heading + paragraph ("此案件暂无证据链接") + a hint to use the Create form (the list-empty pattern).
- **Error (inline) — ONE model (audit L1)**: `role="alert"` shown only when an error occurs, cleared on new input.
  The **default** is to render the server **safe** message verbatim (the main process already maps
  `CaseBoxPersistenceError` → a static safe message via `errorMap.ts`; the renderer adds no REQUIRED i18n at the
  error boundary). The renderer MAY OPTIONALLY map a small allowlist of known codes to friendlier catalog copy
  (e.g. `illegal_transition` → "此链接已断开/已恢复 / link already unlinked/active — refresh the row";
  `unknown_matter`/`tenant_mismatch` → "无法加载 / could not load this matter's links"; `invalid_argument` on create
  → "missing evidence/anchor"), but it **MUST fall back to the server safe message** for any unmapped code — never a
  blank or a guessed message. (So: server-safe-message is the rule; per-code catalog copy is an optional, fallback-
  guarded refinement — the two are not in conflict.)
- **"Gate-failure"/permission state**: there is no runtime A0.7 gate, so there is no marker-failure UI. The error
  codes above are the only "permission/validation" states the user sees, all via the one error model.
- **Stale-load guard**: a superseded list load must not overwrite a refreshed list (the fact-review stale-load
  guard pattern).

### 6. Confidentiality / no-real-data constraints

- The link UI shows **identifiers (source_id, anchor_id — ids, not content), status, export flags, timestamps, and
  the lawyer-entered unlink_reason** only. It MUST NOT render raw evidence body / private PDF bytes / OCR text — the
  link DTOs carry none (the IPC `LINK_RESPONSE_FIELDS` already excludes `tenant_id`/`payload_json`; the export
  citation carries 卷X页Y DocumentPage labels, not evidence content). Linking to an evidence detail view (if any)
  reuses the EXISTING authorized evidence surface; the link UI itself adds no new evidence-content exposure.
- **No real evidence content** in fixtures, screenshots, logs, reports, or this/any design artifact — synthetic ids
  only (the `check-no-real-data` gate enforces this in the desktop tests).

### 7. Auditability without chain internals

Represent the link's audited lifecycle by its **visible facts** — created (timestamp), unlinked (timestamp +
reason), relinked — NOT by chain internals. The UI MUST NOT surface event hashes, `prev/before/after_state_hash`,
sequence numbers, or `event_kind` strings. (The existing audit-events view, if the user wants the raw chain, is a
separate surface; the link UI stays at the lifecycle/status level.)

### 8. Accessibility + i18n

- **a11y**: status as a visible label + `data-status` (never color-only); the unlink reason input gets a `<label
  for>` marked required + initial focus when revealed (the deadline missed→met reason pattern); Enter submits,
  Escape cancels the reason step; errors via `role="alert"`; success via `aria-live="polite"`; action buttons carry
  `aria-label` where the text isn't self-describing.
- **i18n**: ALL copy in `renderer/i18n/catalog.ts` (zh-CN; loud-fail on a missing key; the `renderer-i18n-guard`
  test forbids hardcoded UI strings). New keys the impl adds: `linkStatus.valid|needs_review|broken|unlinked`,
  `linkFlag.UNLINKED|BROKEN|NEEDS_REVIEW|NON_CITABLE|AMBIGUOUS`, `links.section.*`, `links.create.*`,
  `links.unlink.button|reasonLabel|confirm|warning`, `links.relink.button`, `links.export.button`, `links.empty.*`,
  `links.loading`.

### 9. Authority boundary (renderer bridge — the impl lane's prerequisite)

The link methods are ABSENT from `renderer/api.ts`/`renderer/types.ts`. The impl lane MUST add: the 5 methods to
the renderer `CaseBoxApi`/`CaseBoxClient` (wrapping `window.lawbar.caseBox.*` via `createCaseBoxApi` +
`stripDtoFields`); the renderer DTO types; and the `RENDERER_CREATE_LINK_DTO_FIELDS` / `RENDERER_UNLINK_LINK_…` /
`RENDERER_RELINK_LINK_…` / `RENDERER_LIST_LINKS_…` / `RENDERER_EXPORT_LINK_CITATIONS_…` strip allowlists in
`renderer/types.ts` — and EXTEND the `renderer-dto-sync.test.mjs` `PAIRS` list with the new link pairs (the
hard-coded list that gates renderer↔canonical DTO parity). The renderer strips outgoing request DTOs; it never
forwards `tenantId`/`actorUserId` (main injects them).

### 10. Test expectations (for the impl lane)

Renderer tests (MockDoc + stub `api`, plain node — no Electron/better-sqlite3): `renderer-links-list.test.mjs`
(lazy-load on disclosure; rows render the resolver **status** + lifecycle via `data-status`/`unlinked_at`, visible
label not color-only — NO export flag on the list row; empty/loading),
`renderer-links-create.test.mjs` (form → `createLink` → success refresh + clear / error inline; sourceType enum),
`renderer-links-unlink.test.mjs` (two-step reason; required-non-empty guard; `unlinkLink` → refresh; error keeps
inputs), `renderer-links-relink.test.mjs` (one-click `relinkLink` → refresh), `renderer-links-export.test.mjs`
(`exportLinkCitations` → citation list / error). Plus: extend `renderer-api.test.mjs` (`stripDtoFields` drops
`tenantId`/`actorUserId` from link DTOs) + `renderer-dto-sync.test.mjs` (the new RENDERER_*_LINK_DTO_FIELDS ↔
canonical pairs) + `renderer-i18n-guard` (the new catalog keys). All registered in `apps/lawbar-desktop/
package.json`'s curated test list (an additive manifest edit the impl lane's allowed-files must include).

### 11. Deferred items (explicitly addressed)

- **LINK-IPC-T1-D1** (real-db list/export IPC round-trip). **Recommendation: fold D1 into the UI impl lane** — the
  UI lane already builds/tests the desktop end-to-end and benefits from a real Electron-ABI `casebox:link:*`
  round-trip (create→list→export→unlink→relink). Add it as an Electron integration test
  (`tests/casebox-ipc.electron.test.mjs` extension). A separate Electron-integration predecessor is NOT necessary;
  bundling closes D1 exactly where the value is. If the impl lane finds the integration test too large, it MAY
  split it into its own follow-up — but D1 should close at or with the UI lane, not linger.
- **LINK-IPC-T1-D2** (stale "no errorMap change" governance prose). **Recommendation: a separate tiny docs-only
  cleanup lane** (or fold into the next governance-doc pass). It is doc-consistency only (the committed file-level
  governance is correct). Do NOT edit it in this UI design lane. It does not block the UI lane.
- **D3 — IPC ADR §2 DTO table stale (review-plan Low, 2026-06-26)**: `docs/adr/ADR-evidence-a3-link-ipc-surface.md`
  §2 still shows `UnlinkLinkDto { linkId, unlinkReason }` / `RelinkLinkDto { linkId }` WITHOUT `matterId`, but the
  live DTOs (`apps/lawbar-desktop/src/caseBox/dto/link.ts`) + this design include `matterId` (the WI-A3-LINK-IPC-T1
  High#1 scoped-preflight fix). This design correctly follows the live DTOs. **Fold the ADR §2 table sync into the
  same docs-only cleanup lane as D2** (do NOT edit the ADR here). Doc-consistency only; not blocking.

### 12. Sequencing recommendation

**Next lane = the UI IMPLEMENTATION (`WI-A3-LINK-UI-T1`, Type: UI)**, citing this artifact as its `Design artifact:`
(the PR-time `check-ui-design-artifact` gate + the queue UI gate). That lane: (1) the renderer link bridge (§9), (2)
the `viewMatterLinks` screen + the create/unlink/relink/export flows + status rendering, (3) the i18n catalog keys,
(4) the renderer tests (§10), (5) **D1's Electron integration round-trip**. A0.7 posture: the UI lane is NOT
A0.7-gated at runtime; its **commit SHOULD be treated as A0.7-gated (custody 9b)** — it touches court-facing link
presentation, like the IPC lane — UNLESS that lane's own review-plan records a concrete contrary reason. Either
way, NO runtime A0.7 marker UI is added (review-plan note, 2026-06-26). The **D2 docs cleanup** is an independent
trivial lane, anytime.

### Out of scope (this design)

Export-document rendering; per-evidence/per-anchor filtered link views; bulk operations; an audit-chain-internal
viewer; any renderer code; any IPC/persistence/schema/contract change.

### Stop condition

"Done" when this artifact + its governance are committed. "Outdated" when `WI-A3-LINK-UI-T1` ships (the artifact is
retired/realized), or when a superseding link-UX decision is recorded.

---

## Design note — A3 link audit-event labels (LINK_CREATED / LINK_UNLINKED / LINK_RELINKED)

*Absorbed 2026-08-12 from `dev-memo/design/2026-06-28-a3-link-audit-event-labels.md`. Content verbatim; heading levels shifted one deeper.*


**Status:** design note (UI-label scope only). **Date:** 2026-06-28.
**WI:** WI-A3-INTERNAL-DEPS-COMMIT-TARBALLS-T2.
**Governs:** the `Design artifact:` UI-gate reference for the minimal renderer audit-event-label completion bundled with the DESKTOP-DEPS-00 packaging fix.

### Problem
The A3 link lifecycle emits three audit-event kinds — `LINK_CREATED`, `LINK_UNLINKED`, `LINK_RELINKED` — already merged in the `case-box-contract` audit-event vocabulary and persisted by the merged link IPC/persistence. The desktop renderer's audit-log viewer renders a human label per audit-event kind via an **exhaustive** map `renderer/i18n/labels.ts` `EVENT_KIND_ID: Record<CaseBoxAuditEventKind, CatalogId>` (a missing/extra key is a compile error) plus the `eventKind.*` strings in `renderer/i18n/catalog.ts`. These three LINK_* kinds were never given labels — the desktop only compiled because it had been building against a stale bundled contract whose `CaseBoxAuditEventKind` lacked them (the DESKTOP-DEPS-STALE-LOCK-01 defect). Refreshing the bundled contract makes the exhaustive map incomplete → `tsc` fails until the three labels are added.

### UI change (the entire scope)
Add exactly three audit-event labels, mirroring the existing entries:

| Audit kind | Catalog id | English label (proposed, mirrors existing voice) |
|---|---|---|
| `LINK_CREATED` | `eventKind.LINK_CREATED` | "Evidence link created" |
| `LINK_UNLINKED` | `eventKind.LINK_UNLINKED` | "Evidence link unlinked" |
| `LINK_RELINKED` | `eventKind.LINK_RELINKED` | "Evidence link relinked" |

(Final wording follows the established `eventKind.*` style in `catalog.ts`; the entries are added to `EVENT_KIND_ID` in `labels.ts`, the `eventKind.LINK_*` keys in `catalog.ts`, and — only if it independently enumerates kinds — `renderer/screens/auditEventLabels.ts`.)

### Explicitly NOT in scope
- No layout, screen, navigation, filter, or workflow change.
- No audit-event semantics change (the kinds are already defined + persisted).
- No permission, data-exposure, or confidentiality change; no evidence content rendered (these are static labels for already-merged event kinds).
- No new renderer flow, component, or interaction.
- No unrelated i18n/catalog key changes.

### Acceptance
The desktop `tsc` build + `npm test` pass against the refreshed contract with the three labels present; the audit-log viewer shows a human label (not a raw enum) for LINK_* events; the i18n drift-guard / allowlist remains green.

---

## Design artifact — T3 证据目录及说明 review/preview surface (S2)

*Absorbed 2026-08-12 from `dev-memo/design/2026-07-04-t3-catalog-review-preview.md`. Content verbatim; heading levels shifted one deeper.*


**Date**: 2026-07-04.
**WI**: `WI-FORMS-T3-S2-CATALOG-PREVIEW-00` (Forms T3 slice S2 — in-app read-only review/preview of the T3 catalog).
**Type**: UI (read-only). Manual-merge (touches renderer + a new read-only IPC channel).
**Surface**: a new read-only **证据目录及说明 (T3 catalog) preview** section on the existing matter detail screen (`apps/lawbar-desktop/renderer/screens/viewMatter.ts`), rendered by a NEW sibling module `renderer/screens/viewMatterT3Catalog.ts`. No new route.
**Grounds (source of truth)**: the S1 logical model `apps/lawbar-desktop/src/caseBox/export/t3CatalogModel.ts` (`buildT3CatalogModel` / `T3CatalogModel` / `T3CatalogRefusal`, merged in PR #170); persistence read `listEvidenceItems` (`services/case-box-persistence/src/types.ts` `ListEvidenceItemsQuery`/`ListEvidenceItemsPage`) + the existing matter read; parent plan `dev-memo/plan-forms-t3-evidence-catalog-00.md` §4 slice S2; ADR `dev-memo/adr-forms-t3-s0-schema.md`; DR-00 (`dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md` §H).

### Problem

The T3 证据目录及说明 logical model exists (S1: `buildT3CatalogModel`) but there is **no way for a lawyer to see it**. It is a main-process node module (imports `node:crypto`), and — critically — **there is no `casebox:evidence:*` IPC channel at all today** (evidence is persisted but never surfaced to the renderer). So the review/preview surface cannot be a renderer-only change; it needs a read path. This slice surfaces the **read/preview** only: an in-app, read-only rendering of the S1 model for a matter. It renders the internal lawyer trial-review catalog on screen; it does **not** generate a DOCX/PDF and does **not** decide the export renderer (that is S3, separately gated).

### Key architectural decision (primary review-plan question)

Because the S1 model lives in the main process and no evidence IPC exists, S2 requires **exactly one new READ-ONLY IPC channel** that, in the main process, reads the matter + `listEvidenceItems`, calls the merged `buildT3CatalogModel`, and returns the resulting `T3CatalogModel` (plus, optionally, `t3CatalogModelSha256`) to the renderer. The renderer renders it as a read-only table — it does **not** re-implement the model logic (S1 is the single source of truth) and cannot import the main-process module (`node:crypto`). This mirrors the `casebox:document:list`/`get` read-channel precedent (`dev-memo/design/2026-06-03-casebox-documents-readonly.md`).

This is the one surface expansion S2 needs. It is read-only, non-mutating, and adds no evidence WRITE path. Alternative considered and rejected: reimplement `buildT3CatalogModel` in a renderer-safe module — rejected because it duplicates court-facing truth logic and violates "S1 is the source of truth." If the reviewer or user prefers to avoid any new IPC channel, S2 cannot proceed as a preview and must be re-scoped or deferred — surfaced here rather than silently chosen.

### Scope (this WI / slice S2)

- **Read-only.** No evidence create/edit/transition, no field entry, no submitter *editing*. Display of the S1 model only.
- **One** new read-only IPC channel: `casebox:t3:previewCatalog` (matter-scoped; builds and returns the `T3CatalogModel`). No other channel.
- A 证据目录及说明 preview section on the matter view: lazily fetch + render the header (提交人诉讼地位 + submitter 名称/姓名) and the 4-column table (序号 / 证据名称 / 证明内容 / 页码).
- Honor the S1 model exactly: ordering, `reviewNeeded` markers, non-promotion, status filtering (default `accepted`), submitter refusal.

Out of scope (not bundled): DOCX/PDF generation; any export renderer decision (S3); evidence create/edit/registration; the `卷X页Y`/A10 citation column; submitter *selection UI* beyond surfacing a refusal state (a picker is a follow-up if needed); T4/T5 (证明对象/三性/质证) of any kind; contract/schema/persistence change; `CURRENT_SCHEMA_VERSION` change; migrations; native/custody/marker/JS-shim/A8; new runtime dependency.

### LOC guard (mandatory pre-step for the impl WI)

`viewMatter.ts` is in the loc-guardian warn zone historically; the T3 preview MUST live in its own sibling `renderer/screens/viewMatterT3Catalog.ts` (mirroring `viewMatterDocuments.ts`), NOT be inlined into `viewMatter.ts`. If wiring the section pushes `viewMatter.ts` over the warn threshold, extract mechanically (no behavior change) as prior siblings did. New files kept well under the 800-source / 1200-test fail thresholds.

### Data path + IPC contract (new read-only channel)

The request DTO + result type live in a NEW per-entity module `apps/lawbar-desktop/src/caseBox/dto/t3.ts` (mirroring `dto/document.ts`), re-exported from the `dto.ts` barrel — consistent with the existing per-entity DTO split (no monolith growth).

```
casebox:t3:previewCatalog
  req:  T3PreviewCatalogDto { matterId: string; submitterSelection?: { partyIndex: number; displayNameEcho: string } }
  res:  IpcEnvelope<T3CatalogPreviewResult>
        // IpcEnvelope is the EXISTING strict shape: { ok: true, value } | { ok: false, error }.
        // A read ERROR (unknown_matter / tenant_mismatch / invalid_payload) is { ok: false, error }.
        // A submitter REFUSAL is an EXPECTED review state, NOT an error — it rides in the SUCCESS value
        // as a discriminated union (never `null`):
        //   T3CatalogPreviewResult =
        //     | { kind: "model";   model: T3CatalogModel; modelSha256?: string }
        //     | { kind: "refusal"; code: T3RefusalCode }   // one of the four S1 T3CatalogRefusal codes
```

Scoping (mirrors the matter/document channels):
- Renderer never supplies `tenant_id`/`actor_user_id` (forbidden DTO fields → `invalid_payload`); the server injects the active tenant.
- Matter existence + active-tenant checked BEFORE any evidence read; on absent matter → `unknown_matter` (evidence read not called); on tenant mismatch → `tenant_mismatch`.
- **Pagination drain (mandatory)**: `listEvidenceItems` is seek-paginated (default page 50, `next_cursor`). S1 assigns `sequence`/order over the FULL input, so the handler MUST drain **all** `status: "accepted"` pages — loop `listEvidenceItems({ tenant_id, matter_id, status: "accepted", cursor })` with a bounded page size until `next_cursor === null`, accumulate the rows, THEN call `buildT3CatalogModel` ONCE over the complete set. Never build from a single truncated page.
- The main handler calls the merged `buildT3CatalogModel({ matter, evidenceItems, submitterSelection })`; a thrown `T3CatalogRefusal` is caught and mapped to `{ ok: true, value: { kind: "refusal", code } }`, never a crash and never an error envelope.
- The renderer receives an already-built model (or a refusal result); it does NOT import `t3CatalogModel.ts`.

The renderer needs a read-only view type mirroring `T3CatalogModel` (structural, in `renderer/types.ts`); no contract-package change either way.

### Layout (ASCII mock)

```
▾ 证据目录及说明 (preview)                         ← <details data-test-id="view-t3-summary">
  提交人诉讼地位:  原告 (plaintiff)                ← header; ⟨needs review⟩ if absent/out-of-enum
  名称/姓名:       张三

  ┌──────┬──────────────┬────────────────────────┬────────┐
  │ 序号 │ 证据名称       │ 证明内容                 │ 页码    │
  ├──────┼──────────────┼────────────────────────┼────────┤
  │  1   │ 银行流水       │ 证明款项交付。            │ 4-7    │
  │  2   │ ⟨needs review⟩ │ ⟨needs review⟩          │ ⟨needs review⟩ │
  │  3   │ 借条          │ 1、证明借款…；2、证明金额。 │ 1-3    │
  └──────┴──────────────┴────────────────────────┴────────┘

  (empty)   本案暂无已采纳证据可供目录展示。         ← no accepted evidence

  (refusal) 需选择提交人：本案存在 0 或多个当事人（client），请指定提交人后再预览。
            ← T3CatalogRefusal(submitter_selection_required)
```

### Behavior & states

The preview disclosure loads lazily on first open (one `previewCatalog` call). It renders the header then the table. Each `reviewNeeded` cell renders a visible, non-fabricated marker (e.g. `⟨needs review⟩` / a localized string), never blank-that-reads-as-data and never a substituted value.

| State | Render | data-test-id |
|---|---|---|
| Loading | "加载证据目录…" | `view-t3-loading` |
| Empty (no accepted rows) | "本案暂无已采纳证据可供目录展示。" | `view-t3-empty` |
| Envelope/read error | `<p role="alert">` with `env.error.message` | `view-t3-error` |
| Submitter refusal | review banner naming the refusal (needs submitter selection / stale echo) | `view-t3-refusal` |
| Populated | header + `<table>` of rows (序号 / 证据名称 / 证明内容 / 页码) | `view-t3-table` / `view-t3-row` |
| review-needed cell | explicit marker element | `view-t3-review-needed` |

`el()` sets `textContent` (no `innerHTML`); Chinese proof text rendered verbatim (already NFC from the model). No file is written/opened.

### Field mapping (from the S1 model — no promotion)

| Column / header | Source (S1 model field) | Rule |
|---|---|---|
| 序号 | `row.sequence` | 1..n over the ordered+filtered rows; raw `display_order` not shown. |
| 证据名称 | `row.evidenceName` (`{text}` XOR `{reviewNeeded}`) | from `evidence_title` ONLY; `notes`/filename/`party_side` never shown as the name. |
| 证明内容 | `row.proofStatement` | from `proof_statement` ONLY; verbatim (NFC). |
| 页码 | `row.pageRange` | from `exhibit_page_range` ONLY; NO `卷X页Y` column; never replaced by a citation. |
| 提交人诉讼地位 | `model.litigationPosition` (`{value}` XOR `{reviewNeeded}`) | matter-level; `⟨needs review⟩` when absent/out-of-enum. |
| 名称/姓名 | `model.submitterName` | S1 submitter resolution; refusal → refusal state, never a guessed name. |

### Ordering, missing-field, non-promotion (inherited verbatim from S1)

- **Ordering**: exactly the S1 order (valid `display_order` first ascending, then stable `created_at ASC, id ASC`); the UI does not re-sort.
- **Missing/blank**: `reviewNeeded` → explicit marker cell; never invented, never blank-as-data.
- **Non-promotion**: `notes`, source-document filename, and `party_side` MUST NOT appear as 证据名称/证明内容/页码.
- **Status filtering**: default `accepted`-only (excludes proposed/rejected/superseded — supersession chain shows only the live row), per the S1 default; the UI does not widen it in M0.

### Accessibility

The catalog is a `<table>` with a `<caption>` and `<th scope="col">` column headers; the disclosure is `<details>`/`<summary>`. Errors/refusals use `role="alert"`. `review-needed` markers carry accessible text (not color-only). Tab order follows DOM. Localized strings go through the existing i18n allowlist.

### Non-goals / forbidden scope (the impl WI approves NONE of these)

- **No DOCX/PDF generation** and **no export renderer decision** (S3, separately gated on the runtime-dependency hard-stop).
- **No evidence write path** (create/edit/transition/registration) and **no submitter-editing** persistence.
- **No `卷X页Y`/A10 citation column** (页码 stays `exhibit_page_range`).
- **No contract/schema/persistence change**, **no `CURRENT_SCHEMA_VERSION` change**, **no migration/DDL**.
- **No native/custody/marker/JS-shim/A8** and **no T4/T5** fields or behavior.
- **No new runtime dependency.**
- **No re-implementation of the S1 model** in the renderer (S1 is the single source of truth).

### Acceptance (testable — for the future S2 implementation WI)

1. Preview disclosure does not call `previewCatalog` until opened; opening renders the header + rows (renderer test with a stub returning a built model).
2. 序号/证据名称/证明内容/页码 render from the model's `sequence`/`evidenceName`/`proofStatement`/`pageRange`; a `reviewNeeded` cell renders the explicit marker (`view-t3-review-needed`), never blank-as-data.
3. Empty (no accepted rows) shows the empty string; a widened status is NOT offered in M0.
4. `litigationPosition` `{value}` renders the position; `{reviewNeeded}` renders the marker.
5. A refusal result (`{ kind: "refusal", code }`) renders the `view-t3-refusal` banner naming the reason; no guessed submitter name appears. Cover **all four** S1 codes: `submitter_selection_required` (0/multi client), `submitter_index_out_of_range`, `submitter_not_client`, `submitter_selection_stale`.
6. `notes`/filename/`party_side` present on the underlying evidence never appear as 证据名称/证明内容/页码 (test with an item carrying them + no S1 fields → all three cells are `review-needed`).
7. Row order matches the S1 model order (UI does not re-sort).
8. **Pagination drain**: a matter with **> 50 accepted evidence items** yields a model over ALL of them (序号 1..n over the full set, S1 order), proving the handler drains every `accepted` page until `next_cursor === null` before building — not a single truncated page.
9. IPC handler success/error shape: renderer-supplied `tenant_id`/`actor_user_id` → `{ ok: false }` `invalid_payload`; an unknown DTO field → `invalid_payload`; a malformed `submitterSelection` (wrong types) → `invalid_payload`; absent matter → `unknown_matter` (evidence read not called); tenant mismatch → `tenant_mismatch`; a thrown `T3CatalogRefusal` → `{ ok: true, value: { kind: "refusal", code } }` (success value, NOT an error, NOT a crash, never `null`).
10. No DOCX/PDF is produced and no `卷X页Y` column exists; `页码` equals `exhibit_page_range`.
11. Regression: no T4/T5 (证明对象/三性/质证) field appears; `CURRENT_SCHEMA_VERSION` remains 12; no migration/DDL added.

---

## Design artifact — Global overdue-deadline dashboard banner (Gate 3 R2)

*Absorbed 2026-08-12 from `dev-memo/design/2026-07-05-global-overdue-dashboard-banner.md`. Content verbatim; heading levels shifted one deeper.*


**Status:** design spec (the "noun" the `Type: UI` WI implements against, per `UI-GATES.md`). Not implementation-authorizing on its own; the governed WI `WI-GATE3-R2-OVERDUE-DASHBOARD-BANNER-00` implements against it.
**Date:** 2026-07-05. **Author:** Claude Code. **Source:** brief §10 ("dashboard banner when any deadline is overdue or due within 7 days … the lawyer sees overdue deadlines whenever the case-box UI opens"); gate-3 residual R2 (`docs/release/gate3-client-release-readiness-00.md` §2/§3).

### 1. Problem / gap

Brief §10 requires a **global dashboard banner** surfaced **when the case-box UI opens**, warning whenever **any** deadline in **any** matter is overdue or due within 7 days. Today the client has only a **per-matter** urgency surface: `renderer/screens/viewMatterDeadlines.ts` renders a `role="status"` banner + per-row pills for a single matter's deadlines, classified by the shared `classifyDeadlineUrgency` (brief §18, tested in `renderer-deadline-urgency.test.mjs`). The **cross-matter / app-open** banner does not exist. This design specifies ONLY that missing global banner; the per-matter banner is unchanged and MUST NOT be rebuilt.

### 2. Surface (where it mounts)

The **matter-list home** (`renderer/screens/listMatters.ts`) is the app-open landing (it renders on launch and after nav-home). The global banner mounts **at the top of the matter-list home surface**, above the matter list, so it is visible whenever the UI opens / returns home. (A shell-level mount — `renderer/index.ts`/`nav.ts` chrome, visible on every screen — is an acceptable alternative the implementer may choose IF it does not duplicate the per-matter banner; the home-surface mount is the v1 default for minimal scope.)

### 3. Data-source boundary (UI-ONLY — no new IPC/persistence)

The banner aggregates **client-side** over the **existing** per-matter deadline channel — it introduces **NO** new IPC channel, contract, DTO, or persistence query:

- Read the matters the home already lists via the existing `casebox:matter:list` (`deps.api.listMatters`).
- For each listed matter, read its deadlines via the **existing** `casebox:deadline:list` (`casebox:deadline:list` per-matter channel), then classify each `pending` deadline with the **reused** `classifyDeadlineUrgency(dueAt, status, nowMs)` + `DEADLINE_DUE_SOON_WINDOW_MS` from `renderer/format.ts` — **do NOT reimplement the urgency rule**.
- Sum `overdue` and `due-soon` counts across matters.

**Scope guard:** this is a UI-layer aggregation over existing channels. It MUST NOT add a cross-matter deadline-summary IPC channel or a persistence aggregation — that would be persistence/IPC/contract work outside a `Type: UI` WI. If the implementer finds N per-matter calls unacceptable at the target matter scale (v1 is single-lawyer, few matters — expected fine), that is a **STOP**: a separate persistence/IPC aggregation WI is required, not an in-scope expansion here.

### 4. States

| State | Behaviour |
|---|---|
| overdue > 0 or due-soon > 0 | Banner shown: a concise summary, e.g. "N overdue · M due within 7 days" (counts from §3). |
| both zero | Banner hidden (no empty "all clear" chrome for v1 — minimal). |
| loading | The banner area stays absent until the aggregation resolves (no flash / no spinner churn on the home). |
| error (a matter/deadline read fails) | Non-blocking **degraded** state: a quiet "couldn't check deadlines" message; the home matter list still renders. The banner MUST NOT crash or block the home screen. |

### 5. Accessibility

`role="status"` (polite live region), consistent with the existing per-matter banner in `viewMatterDeadlines.ts`. NOT `role="alert"` (overdue deadlines are important but not an interrupting emergency; brief §10 is "visible … only", no escalation). Text is real text (not colour-only); any urgency colour uses the existing design tokens (no hard-coded colour — `renderer-no-hardcoded-color.test.mjs` convention).

### 6. i18n

All banner strings go through the existing i18n catalog (`renderer/i18n/`), mirroring the per-matter banner's i18n pattern; no hard-coded user-facing English (the `renderer-i18n-guard` convention applies).

### 7. Distinction from the existing per-matter urgency UI (do NOT rebuild)

- **Existing (unchanged):** `viewMatterDeadlines.ts` — per-matter, on a single matter's deadlines screen: a `role="status"` count banner + per-row pills, `classifyDeadlineUrgency`, brief §18.
- **This WI (new):** a **global / cross-matter** banner at the **app-open home**, summarising urgency across ALL matters. It **reuses** `classifyDeadlineUrgency` and matches the per-matter banner's a11y/i18n idioms; it does **not** modify, move, or duplicate the per-matter banner.

### 8. Tests required before gate 3 is reassessed

- A renderer test (peer of `renderer-deadline-urgency.test.mjs` / `renderer-list-matters.test.mjs`) asserting, with an injected clock + mock api: (a) the aggregation counts overdue + due-soon across mock matters using `classifyDeadlineUrgency`; (b) the banner **renders** the correct counts when > 0; (c) the banner is **hidden** when both counts equal 0; (d) a failed per-matter read yields the **degraded** state and the home still renders; (e) the banner carries `role="status"`; (f) i18n labels resolve (no raw English).
- Full `npm --prefix apps/lawbar-desktop test` green.

### 9. Non-goals

- No new IPC/contract/persistence/DTO (client-side aggregation over existing channels only).
- No change to the per-matter `viewMatterDeadlines.ts` banner or to `format.ts`'s urgency rule (reuse only).
- No escalation / push / email / SMS (brief §10 explicitly excludes these; v1 UX is "visible … only").
- No gate-4 (signing/distribution) decision; no release-doc finalization; no gate-6 audit; no go-live decision.

### 10. Gate-3 effect

Implementing this closes gate-3 residual **R2**. Gate 3 may then advance but **still depends on gate 4** (signing/notarization/public distribution — a user STOP-AND-ASK) and R3 (bounded polish); the implementer records whether gate 3 remains PARTIAL or advances **without** collapsing the gate-4 STOP-AND-ASK, and never implies go-live.

---

## Design artifact — Chinese-first desktop UI + Settings entry

*Absorbed 2026-08-12 from `dev-memo/design/2026-07-09-desktop-zh-cn-settings-entry.md`. Content verbatim; heading levels shifted one deeper.*


**WI**: `WI-DESKTOP-ZH-CN-SETTINGS-ENTRY-00` · **Date**: 2026-07-09 · **Status**: design (non-authoritative until cc-suite review-plan).
**Author**: Claude Code. **Type: UI** (satisfies the `Design artifact:` gate for `apps/*/renderer/*` changes).

### Intent

Make the Electron renderer **Chinese-first** (zh-CN is already the locked v1 locale, `renderer/i18n/t.ts` `LOCALE="zh-CN"`) and add a visible **设置 (Settings)** entry to the app shell with a basic Settings screen. This closes the remaining English drift the anti-drift allowlist still tracks and gives the lawyer an in-app place to see local-first / offline / privacy posture.

Nothing here changes product direction: local-first, offline-first, single-lawyer, no telemetry — it surfaces that posture, it does not alter it (`.claude/rules/client-local-first.md`).

### Shell layout (sidebar)

```
┌───────────────┐
│  Lawbar · 案件盒 │
├───────────────┤
│ §  案件          │  #/matters      (data-nav="list")
│ +  新建案件       │  #/matters/new  (data-nav="new")
│ ⚙  设置          │  #/settings     (data-nav="settings")   ← NEW
└───────────────┘
```

`⚙ 设置` is a static sidebar `<a>` mirroring the existing two links (same `data-nav` / `data-i18n` idiom, `applySidebarCurrent` marks `aria-current="page"` when the route is `settings`). Reachable without DevTools.

### Settings screen (`#/settings`) — read-only, static + a few dynamic facts

```
设置

应用
  版本            0.1.0
  运行模式         开发 (dev) | 生产 (production)

数据与隐私
  数据位置         ~/Library/Application Support/lawbar
  本地优先         文档仅保存在本机，除非您主动导出。
  离线优先         应用在离线状态下可正常使用。
  FileVault        已开启 | 未开启 | 未知    (+ 生产环境要求全盘加密的说明)
  隐私             不收集遥测数据；崩溃上报已关闭。

  [打开数据文件夹]   ← optional, only if trivially safe
```

Dynamic facts (`版本`, `运行模式`, `FileVault`) come from ONE new read-only preload namespace `window.lawbar.appInfo.get()` → `{ version, mode, dataDir, fileVaultState, offline:true, telemetry:false }`, backed by a single `ipcMain.handle("app:info", …)`. The data-dir path string is displayed as documented text; `打开数据文件夹` is deferred unless it can reuse an existing safe shell-open path.

### i18n approach

Every remaining user-facing English literal in `renderer/index.ts` + `renderer/screens/*.ts` moves into `renderer/i18n/catalog.ts` (zh-CN) and is wired via `t()`. `t()` throws on a missing key, so a missed wiring fails loudly in build/tests. The anti-drift allowlist is regenerated and must burn down to only genuinely-exempt occurrences (bare separators/symbols, and any developer-only text). New namespaces: `matterCreate.*`, `matterArchive.*`, `notFound.*`, `settings.*`, plus per-sub-screen namespaces for the expandable view panels.

### Out of scope

Signing/notarization/release; legal/compliance conclusions; schema/persistence-contract changes; archive/document upload; unrelated restyle. New preload channel is **additive + read-only** (no existing surface renamed/removed).

---

## Design Artifact — ClaimTrack screen (WI-PTA-VS3)

*Absorbed 2026-08-12 from `dev-memo/design/2026-08-03-claimtrack-screen.md`. Content verbatim; heading levels shifted one deeper.*


**Status:** design artifact for the VS-3 UI WI (satisfies the UI-GATES `Design artifact:` requirement of
`dev-memo/plan-pta-claimtrack-completion-lane-00.md` §1 VS-3). **Date:** 2026-08-03.
**Authored by:** _jacob, from a cc-suite Codex design consult (thread `019fcd47`), on Frank's explicit
delegation of the VS-3 design decision (overriding the lane's default "human checkpoint" for this WI).

### 0. Intent (one line)

A **dense trial-prep register**, not a workflow board. The screen must answer instantly:
*"Which claim thread is this, between whom, and what is our posture?"* Correctness and trust beat polish —
this is a v1 internal tool for one litigation lawyer, offline, zh-CN.

### 1. Three concepts that MUST stay distinct (load-bearing — collapsing them causes counterclaim errors)

- **诉讼地位 (litigation role):** 原告 / 被告 — a party's standing in the case (from the matter's party data).
- **我方立场 (our posture):** 我方主张 / 我方应对 — `our_role` = asserting / responding.
- **诉请方向 (thread direction):** 主张方 → 相对方 — `claimant_party_id → respondent_party_id`.

All three are shown where available; none is derived from another. (In a 反诉, our posture and the thread
direction invert relative to the 本诉 — so a UI that fuses them would mislabel the counterclaim.)

### 2. Navigation / entry point

Lives under the matter's **trial-prep** area, near evidence / issues / hearing-prep — NOT as generic case
metadata. Nav label: **庭审准备 › 诉请跟踪**.

### 3. List (read-only)

Two FIXED groups, in this order, each ordered by `sort_order` ascending:
1. **本诉** (`track_type = main_claim`)
2. **反诉** (`track_type = counterclaim`)

Each row shows (NO title-only rows — a bare title is ambiguous before a hearing):

`序号 · 标题 · 我方主张|我方应对 · 主张方 → 相对方 · 状态徽章`

```
诉请跟踪
── 本诉 ─────────────────────────────
 1  返还借款本金        我方主张   张三 → 李四      进行中
 2  违约金              我方主张   张三 → 李四      进行中
── 反诉 ─────────────────────────────
 1  抵销已付款项        我方应对   李四 → 张三      进行中
                                         [ + 添加诉请 ]
```

- Status badge maps `active → 进行中` (v1 only ever shows 进行中; `withdrawn → 已撤回`, `resolved → 已了结`
  reserved for a later slice). Party cells show the party's display name; role suffix `（原告）/（被告）`
  when the matter provides it.
- List is unpaginated (persistence returns the full matter-scoped array; claim counts are bounded).

### 4. Add form (the only write in VS-3; created as `status = active`)

**Required — the claim-identity fields** (validated before the create IPC call):
- `track_type` — radio: 本诉 / 反诉
- `our_role` — radio: 我方主张 / 我方应对
- `claimant_party_id` — dropdown of matter parties (see §5)
- `respondent_party_id` — dropdown of matter parties (see §5)
- `title` — short text, non-empty

**Optional — a collapsed `▸ 补充内容` section** (empty string allowed; shown, not required — money/legal
basis matter in court, but forcing them causes rushed filler or abandoned entries):
- `claim_summary` — 请求/主张摘要
- `response_summary` — 抗辩/回应摘要
- `legal_basis` — 法律依据
- `calculation_summary` — 金额/计算摘要

**Auto / server-side (never in the form):** `id`, `tenant_id`, `actor_user_id`, `status = "active"`,
`created_at`, `updated_at`, and `sort_order`.

```
添加诉请
 类型     (•) 本诉   ( ) 反诉                *必填
 我方立场 (•) 我方主张 ( ) 我方应对          *必填
 主张方   [ 张三（原告） ▾ ]                *必填
 相对方   [ 李四（被告） ▾ ]                *必填
 标题     [___________________________]     *必填
 ▸ 补充内容（请求摘要 / 抗辩摘要 / 法律依据 / 金额计算）  选填
                                   [ 取消 ]  [ 保存 ]
```

#### `sort_order` — the one deliberate divergence from the consult
The consult recommended a lawyer-visible, editable `sort_order` at creation (lawyers prepare in
claim-importance order). VS-3 instead **auto-appends** (`sort_order` = next number within the selected
group) and displays the `序号`, deferring *manual reordering* to the edit slice. Reason: v1 has no edit, so
a create-time-only order control is half a feature (it can't re-sort existing rows) while adding form
friction; a lawyer naturally enters claims in importance order during prep, which append already preserves.
**Manual reorder is the first VS-3 follow-up, paired with the edit slice.**

### 5. Party selection rules

- Dropdowns populated ONLY from the matter's existing parties (source-of-truth; the lawyer never types an
  id or an ad-hoc name). Option label: `名称（诉讼地位）`, e.g. `张三（原告）`.
- **Block** selecting the same party as both 主张方 and 相对方 (no exception-note field exists in v1).
- If the matter has **fewer than two parties**, DISABLE "添加诉请" and show:
  `暂无可选当事人 — 请先在案件中添加至少两位当事人，再创建诉请跟踪项。`

### 6. Empty / first-run states (functional copy — NEVER sample/fake legal cards; fake content erodes trust)

- Zero tracks (≥2 parties exist): `暂无诉请跟踪项` / `先添加本案需要跟踪的本诉或反诉请求。` + primary
  button `添加诉请`.
- Zero selectable parties: the §5 no-parties message (add disabled).

### 7. Deliberately NOT in VS-3 (Codex challenge — build the trustworthy register first)

Edit / status transitions (撤回 / 了结) / delete / filters / kanban or timeline views / claim resolution /
tags / attachments / evidence-linking / manual reorder. These are meaningful only after the core register is
trustworthy. The single thing to get right is **row identity** — `type + our posture + 主张方→相对方 +
title + order`; if that's ambiguous the lawyer can't rely on the screen in prep.

### 8. i18n

All strings via the zh-CN catalog (no literals). New enum-label facades needed: `track_type`
(本诉/反诉), `our_role` (我方主张/我方应对), `status` (进行中/已撤回/已了结). Party role suffix reuses the
existing matter party-role labels if present.

### References
`dev-memo/plan-pta-claimtrack-completion-lane-00.md` (VS-3 row + gates); the ClaimTrack contract
(`case-box-claim-track.schema.json`); Codex design consult thread `019fcd47`.

---

## Design Artifact — app restyle to macOS-HIG structure (warm palette kept)

*Absorbed 2026-08-12 from `dev-memo/design/2026-08-04-app-restyle-macos-hig.md`. Content verbatim; heading levels shifted one deeper.*


**Status:** design artifact for the UI restyle WI(s). Satisfies the UI-GATES `Design artifact:` requirement.
**Date:** 2026-08-04. **Authored by:** _jacob, from a Codex design consult (thread `019fcfbf`) + Frank's review.
**Interactive mockup (approved, palette-kept revision):** Artifact `45b3110a-fad0-48a5-a0fe-6bf9ec7ee3a1`
(local, private — matter view + ClaimTrack register, light + dark).

### 0. Intent

Remove the "rigid / print-broadsheet" feel by adopting **macOS system-app structure** (Finder / Mail / Notes:
source-list selection, soft elevation, larger radii, SF-style type hierarchy, roomier-but-still-dense spacing) —
**while keeping the existing warm colour identity verbatim.** Frank's directive (2026-08-04): the direction is
approved, *keep the original colour scheme*. So this is a **structure/scale/type** change, NOT a palette change.

### 1. What is KEPT (unchanged — do not touch)

Every colour/palette token in the two `:root` blocks of `apps/lawbar-desktop/renderer/index.css` stays at its
current value — light (`--color-background:#F7F4EE`, `--color-accent:#D88B57`, …) and dark
(`#16130F` / `#E59E6B`, …), including all surface / text / border / accent-ramp / status / confidentiality /
traffic tokens. Selection, focus, primary actions, and the "active/进行中" status badge continue to use the
honey-orange accent family — NOT a new blue. The `no-hardcoded-color` gate's "exactly 2 `:root` blocks" invariant
is preserved.

### 2. What CHANGES (structure / scale / type only)

All changes are token-value edits (mirrored byte-equal into `apps/lawbar-desktop/src/theme/tokens.ts` where the
token is in the synced set), plus a few surgical component rules. **No palette hue changes.**

#### 2.1 Radius (`html` scale tokens + tokens.ts SCALE)
| token | current | new |
|---|---|---|
| `--radius-sm` | 2px | **6px** |
| `--radius-md` | 3px | **8px** |
| `--radius-lg` | 5px | **12px** |
| `--radius-pill` | 999px | 999px (keep) |

Cards use `--radius-lg`; buttons/inputs/segments `--radius-md`; chips/badges `--radius-pill`.

#### 2.2 Elevation (real soft shadow, replacing the flat hairline ring)
The current `--shadow-sm` is a hairline ring (`0 0 0 1px var(--color-border)`) and `--shadow-xs:none` — this
flatness is a main source of the "rigid" feel. Replace with genuine soft elevation, **theme-specific**, in the two
`:root` blocks.

**Gate constraint (load-bearing):** the `no-hardcoded-color` scanner forbids `rgba()`/`rgb()` *everywhere*; only
**hex** (incl. 8-digit `#RRGGBBAA`) is allowed, and only inside the two `:root` blocks. So shadows MUST be
expressed as 8-digit hex, never `rgba()`.

| token | light `:root` | dark `:root` |
|---|---|---|
| `--shadow-sm` | `0 1px 2px #1F1A170D, 0 8px 22px #1F1A1714` | `0 1px 2px #00000059, 0 12px 30px #00000073` |
| `--shadow-xs` | `0 1px 2px #1F1A1710` | `0 1px 2px #0000004D` |

(`#1F1A17` = the existing warm near-black text colour, so shadows read warm, not grey.) Cards move from the ring to
`--shadow-sm`; because the ring previously supplied the card edge, card rules must also keep a
`border: 1px solid var(--color-border)` hairline so edges stay crisp on the ivory ground.

#### 2.3 Type
- **Drop serif headings.** Revalue `--font-serif` to the UI sans stack so every serif-display usage becomes sans
  without editing each component rule.
- **`--font-ui` order: KEEP Noto-first (unchanged).** See §4 — the earlier "system-first" proposal was reversed
  during implementation on new evidence (a live S1 offline-determinism policy + guarding test). `--font-ui` stays
  `"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", -apple-system, system-ui, sans-serif`.
- Weights: normalise any `700` heading to `600` (avoid 700 — heavier reads worse in dense CJK and less AppKit).
  Sizes/line-heights largely unchanged; keep CJK line-heights (body ~1.5, table rows ~1.4).

#### 2.4 Component-layer de-rigidify (the ornaments) — deferred to WI-2
Remove the editorial/print language at the component-CSS layer: `§` section markers, uppercase-mono "eyebrows",
drop-caps, colophon/letterpress touches (`editorial-styles.css`, `cn-overlay.css`, `v12-typography.css`). Replace
with plain SF section labels and source-list-style disclosure `<summary>` rows (chevron + row, not a legal
heading). This is a larger component-CSS pass, split out so WI-1 stays token-scoped and gate-safe.

#### 2.5 UI removal per Frank (2026-08-04)
Remove the **审计链 (audit-chain) disclosure** from the matter view (`viewMatter.ts` composition) — UI only. The
audit-chain **mechanism in persistence is unchanged and non-negotiable** (critical invariant); only its on-screen
panel is removed. This is a one-line composition change (drop `viewMatterAudit` from the `mainCol` array) + its
test; belongs with WI-2 (component/UI), not the token WI.

### 3. Gate constraints (must pass)
- `renderer-no-hardcoded-color.test.mjs`: exactly 2 `:root` blocks; no `rgba()`/`rgb()`; hex only, only in `:root`.
  New shadows use 8-digit hex accordingly.
- `main.test.mjs` palette-sync: any changed token that appears in `tokens.ts` (`LIGHT/DARK_THEME_TOKENS` compat
  subset + `SCALE_TOKENS`) must be updated in BOTH files, byte-equal.
- `renderer-i18n-guard` unaffected (no visible-string changes in WI-1).

### 4. Font order — REVERSED during implementation (kept Noto-first)
Initially I chose system-font-first (`-apple-system` first) for a crisper Latin/SF look. Implementation surfaced
new evidence that reversed this: `smoke.electron.test.mjs:161` ("S1 font wiring") guards a **live** policy — the
body stack MUST lead with the self-hosted `Noto Sans SC` — established for **offline rendering determinism** (the
app bundles its own WOFF2 so it renders identically on any machine, independent of installed system fonts;
`renderer/fonts/PROVENANCE.md`, HS10). Weighing it: the "Apple feel" comes overwhelmingly from **structure**
(elevation, radii, dropped serif), not from Latin rendering in SF vs Noto Sans (a subtle difference at UI sizes).
The system-first swap was the ONLY change that touched a live policy, required editing its guarding test, and
traded away offline determinism — for the smallest visual gain. **Decision: keep `--font-ui` Noto-first**
(unchanged), respect S1, and still drop serif headings (`--font-serif: var(--font-ui)`). Net: all structural
de-rigidify wins, zero conflict with S1, no test change, offline determinism preserved.

### 5. Sequencing (revised after WI-1 audit `audit-msfihuyp`)
The WI-1 audit found two things that reshape the split: the `--shadow-*` tokens have **zero `var(--shadow-*)`
consumers** (revaluing them is visually inert until component rules are wired to them), and aliasing
`--font-serif → var(--font-ui)` is an incoherent half-measure (misnamed token + the bundled Noto Serif face goes
dead). Both need the **component layer** to be coherent/visible. So:
- **WI-UI-RESTYLE-1 (token revalue — radius only):** §2.1 radius (`--radius-sm/md/lg` → 6/8/12px). This is the ONLY
  token change that is actually consumed (35 `var(--radius-*)` sites) and therefore visible on its own. Token-only,
  both hard gates green, palette untouched. Shipped first as a clean, bounded increment.
- **WI-UI-RESTYLE-2 (component restyle):** §2.2 elevation — revalue `--shadow-sm/-xs` (8-digit hex) **AND wire card
  rules to `box-shadow: var(--shadow-sm)`** so the soft elevation actually appears; §2.3 serif drop — **retarget the
  `--font-serif` consumers to `--font-ui` and remove the now-dead `--font-serif` token + its `@font-face` + the Noto
  Serif WOFF2** (proper removal, not an alias); §2.4 ornaments; §2.5 audit-panel removal; weight normalisation.
  Component-CSS + `viewMatter.ts` composition + font-file removal + tests. This is where the bulk of the visible
  de-rigidify (elevation, no-serif, no-ornaments) actually lands.

### 6. Out of scope
Any palette hue change; new colours; a third `:root` block; layout re-architecture; new dependencies; the audit
mechanism; anything under the Evidence A0.7 gate.

---

## Design — Matter-details edit screen (`#/matters/:id/edit`)

*Absorbed 2026-08-12 from `dev-memo/design/2026-08-05-matter-details-edit-screen.md`. Content verbatim; heading levels shifted one deeper.*


**Date:** 2026-08-05. **Feature:** issue #2 "edit case info after creation" (user request). **Type:** UI design
artifact for Phase D of the matter-details-edit vertical (parent `dev-memo/plan-matter-details-edit-00.md`).
**Backend:** DONE — audited IPC `casebox:matter:updateDetails` (Phase C `99c5517`) + persistence
(Phase B `8b591cf`) + reason-hardening (`e9ff43c`). **Style:** macOS HIG restyle, original ivory+honey palette
(`dev-memo/design/2026-08-04-app-restyle-macos-hig.md`; tokens in `src/theme/tokens.ts`). **UX consult:** Codex
`review-plan-msfyrorm-0qavjf` (decisions below evaluated + accepted).

### Purpose
Let a lawyer correct/update the 6 free-text descriptive fields of a matter after creation, recording a required
court-facing `reason` on each edit. Mirrors the existing `archiveMatter` form screen (the closest precedent).

### Route + entry + nav
- Route `#/matters/:id/edit` (3-segment, ULID-guarded), mirroring `#/matters/:id/archive`. Registered in BOTH
  `renderer/router.ts` and `renderer/index.ts` (duplicated route table).
- Entry: a `view-edit` button (`button--primary`, `t("detail.editButton")`) on `viewMatter`, rendered ONLY when
  `row.status === "active"` (hidden for archived matters — decision 3). Placed in the detail header/actions area,
  NOT in the archive danger zone.
- Nav loop: viewMatter → Edit → on success `navigate(buildHash("view", {id}))` back to the refreshed detail
  (decision 5). No audit-history panel — the in-app audit VIEW was removed per the user (`我不需要审计链`,
  WI-2d `2275551`); the event is still RECORDED by the mechanism, just not displayed.

### The 6 editable fields (seeded from `getMatter`)
| Field | Label key | Required? | Clearable? |
|---|---|---|---|
| `name` | `detail.field` name (title) | REQUIRED | NO (empty-name submit blocked inline) |
| `retainer_scope` | `detail.field.retainerScope` | optional | yes → `""` |
| `case_type_text` | `detail.field.caseType` | optional | yes → `""` |
| `case_progress_text` | `detail.field.caseProgress` | optional | yes → `""` |
| `court_contact_text` | `detail.field.courtContact` | optional | yes → `""` |
| `contention_summary_text` | `detail.field.contentionSummary` | optional | yes → `""` |

Reuse the existing `detail.field.*` labels for consistency with the read-only view. `name` uses a text `input`; the
5 descriptors use `textarea` (they are multi-line in the detail view).

### Layout (top → bottom)
1. Back link (`← 返回案件`, `matterEdit.backToMatter`) + title `matterEdit.title` (interpolates `{name}`).
2. The 6 fields (name first, then the 5 descriptors), each a `.field` with label + control + inline error hint
   (`.field-hint--error`) for the name-required rule.
3. **"Changes to be recorded" summary** (`matterEdit.changesTitle`) — a live region listing which fields will
   change (by label), recomputed on every input against the seeded values (decision 2). Empty state:
   `matterEdit.changesNone` ("尚无更改"). This sits immediately ABOVE the reason field so the recorded justification
   is reviewed against the actual delta.
4. **Reason** textarea (`matterEdit.reasonLabel` with `{min}`/`{max}`), REQUIRED for every edit including clearing
   an optional field (decision 2). Bounds mirror archive: min 10, max 500.
5. Form actions: Submit (`matterEdit.submit`, `button--primary`) + Cancel (`matterEdit.cancel`, back to view).
6. Hidden `role="alert"` form-error (zh-CN safe message via `errorMessage(env.error)`) + `role="status"`
   `aria-live="polite"` announce region (mirror archive).

### Behaviour
- **Seed:** load via `api.getMatter({matterId})`; prefill each control with the current value (optional descriptors
  absent → empty control). Invalid ULID → invalid-id view, no IPC. `env.value === null` → not-found. Envelope error
  → error view.
- **Dirty-tracking (decision 1):** keep the seeded snapshot; on any input recompute the changed set; ENABLE Submit
  only when ≥1 field differs from its seed AND `name.trim()` is non-empty. This pre-empts `no_editable_change` so the
  user never hits that server error for a permanent audit action.
- **Patch construction:** send only the 6 fields in `patch`; for each descriptor, `""` (cleared) is sent as an
  explicit change; `name` always sent (required). (Persistence canonicalizes + rejects a true no-op; the UI's
  dirty-gate makes that unreachable in the happy path.)
- **Name required (decision 4):** on submit, if `name.trim()===""` → inline field error
  (`matterEdit.error.nameRequired`), focus name, no IPC. The 5 descriptors may submit as `""`.
- **Reason validation:** trim; too-short → `matterEdit.error.reasonTooShort {min}`; too-long →
  `matterEdit.error.reasonTooLong {max}`; both inline, focus reason, no IPC.
- **Submit:** re-entrancy guard; disable submit; announce `matterEdit.status.saving`; call
  `api.updateMatterDetails({matterId, patch, reason})`; on `!ok` show `errorMessage(env.error)` in the form-error
  (handles `matter_archived`/`no_editable_change`/`invalid_payload`/`unknown_matter`/`tenant_mismatch`/
  `audit_chain_desync` as zh-CN safe messages), re-enable, return; on success announce
  `matterEdit.status.saved` → `navigate(view)`.
- **Archived direct-route (decision 3):** if `row.status !== "active"`, render a READ-ONLY variant — the fields shown
  disabled + an archived banner `matterEdit.archivedBanner` ("案件已归档，需先取消归档才能编辑。") + a back/unarchive
  affordance; NO editable form, NO submit. (The entry button is already hidden for archived, so this is the
  direct-URL safety net.)

### Style
- No hardcoded hex (`renderer-no-hardcoded-color.test.mjs`). Reuse `.field`, `.field textarea/input`,
  `.field-hint--error`, `.form-error`, `.form-actions`, `.button`/`.button--primary`, `.back-link`, `.view-card`.
  The macOS look (radius 6/8/12, warm elevation shadows, ivory canvas `#F7F4EE` / honey accent `#D88B57`) is
  inherited from the tokens — the form matches archive automatically.
- The "Changes to be recorded" summary uses a `.view-card`-like container (muted heading + a list); accent only on
  the changed-field labels if any accent is used — keep it quiet.

### Copy (new `matterEdit.*` + `detail.editButton`, all zh-CN, through `t()`)
`detail.editButton` "编辑…"; `matterEdit.backToMatter` "← 返回案件"; `matterEdit.title` "编辑案件信息 — {name}";
`matterEdit.loading` "正在加载案件…"; `matterEdit.notFoundTitle`/`invalidIdBody`/`unavailableTitle`/`staleLinkBody`
(mirror matterArchive); `matterEdit.changesTitle` "将记录的更改"; `matterEdit.changesNone` "尚无更改";
`matterEdit.reasonLabel` "原因 *（{min}–{max} 个字符）"; `matterEdit.submit` "保存更改"; `matterEdit.cancel` "取消";
`matterEdit.error.nameRequired` "案件名称不能为空。"; `matterEdit.error.reasonTooShort` "请填写原因，且至少需 {min} 个字符。";
`matterEdit.error.reasonTooLong` "原因不得超过 {max} 个字符。"; `matterEdit.status.saving` "正在保存…";
`matterEdit.status.saved` "已保存"; `matterEdit.archivedBanner` "案件已归档，需先取消归档才能编辑。".

### Tests
- `tests/renderer-edit-matter.test.mjs` (mirror `renderer-archive-matter.test.mjs` MockDoc harness): invalid ULID →
  no IPC; envelope error / not-found views; seed prefill; dirty-gate (submit disabled with no change, enabled after
  a change); name-required inline block (no IPC); reason too-short/too-long inline; happy-path calls
  `updateMatterDetails` with the right patch+reason and navigates to view; each persistence error → safe message;
  archived → read-only (no submit). Register in `package.json` test script.
- `viewMatter` test: assert the `view-edit` button exists + navigates for active, and is ABSENT for archived.
- Regenerate `ui-strings-allowlist.json` (the `node -e` scanner one-liner) AFTER the source is final; re-run the
  FULL desktop gate (the i18n guard is LINE-INDEXED — a late comment edit shifts entries; regen is the last step).

### Out of scope
Editing parties / confidentiality / jurisdiction / matter_type / status (each has its own audited path or is
frozen); the audit-history VIEW (removed per user); any push/merge.

---

## Design — Batch UI redesign spec (all interactive controls)

*Absorbed 2026-08-12 from `dev-memo/design/2026-08-05-ui-batch-redesign-spec.md`. Content verbatim; heading levels shifted one deeper.*


**Date:** 2026-08-05 (drafted); 2026-08-06 (APPROVED + scope corrected). **Status:** APPROVED by Frank on
2026-08-06 ("同意ui方案，请进行下一步"). This is the authorizing **Design artifact** for the WI-UI-* batches
(`Type: UI` per AGENTS.md UI-GATES). See §0 "Verified scope correction" — the implementation scope is narrower
than the original draft's premise; the visual *direction* is unchanged. **Scope:** every
interactive control across the 13 renderer screens. **Purpose:** decide all button layout / add-remove / naming
changes ONCE, as rules, so a small number of cohesive implementation batches can apply them — instead of
one-WI-per-button. **Basis:** the as-is control inventory (read from the real code, 2026-08-05) + 19 cross-screen
inconsistencies A–S. **Companion:** a clickable mockup of the to-be (redline that, not this table).

This spec DECIDES a first-pass direction (macOS HIG + court-facing clarity + consistency). Every row is a proposal;
Frank overrides freely on the mockup.

---

### 0. Verified scope correction (2026-08-06, read from real code before implementing)

Before implementing, the actual renderer was re-read (not the draft's inventory). Findings that **narrow** the
scope (the visual direction below is unchanged; there is simply less to change than the A–S table implied):

- **The `.button` CSS family is already complete** in `renderer/index.css`: `.button`, `--primary`, `--accent`,
  `--danger`, `--danger-strong`, `--ghost`, `--secondary`, `--sm`. No CSS authoring needed.
- **The core-flow screens already adopt it correctly** — `createMatter` (`button--primary` submit, `button`
  cancel, `button--secondary` party add/remove), `editMatter` (same), `archiveMatter` (`button--danger`),
  `listMatters` (`button--accent` new, `button list-load-more` pagination), `viewMatter` (`button--primary`
  edit, `button--danger` archive). The draft's premise "core screens abandon the button system" was **wrong**.
- **The real gap = the 7 matter sub-section screens.** Their buttons use bespoke `view-*` classes
  (`view-docs-add-btn`, `view-facts-add-btn`, `view-claim-tracks-add-btn`, `view-deadlines-*`,
  `view-docket-*`, `view-links-*`, `view-t3-export-button`) that have **zero dedicated CSS** → they render as
  near-default browser buttons. This is the genuine F/E gap and the entire real WI-UI-1.
- **WI-UI-2..4 will be re-verified against real code the same way** before implementing — several draft claims
  (form-action order, missing 取消) are likely already satisfied on some screens. No batch is implemented on the
  draft's word alone.

**WI-UI-1 method (surgical):** for each bespoke sub-section button, **prepend** `button button--<weight> ` to
its class (keep the bespoke class as a suffix, keep every `data-test-id`, labels/handlers untouched). Weights:
danger = unlink/dismiss and their confirms (`view-links-unlink(-confirm)`, `view-docket-dismiss(-btn|-confirm)`);
primary = add/create/reveal + confirm-a-benign-step (`*-add-btn`, `view-links-create-btn`,
`view-deadlines-confirm-btn`, `view-deadlines-transition-confirm`); secondary = export / inline-edit / relink /
any cancel / status toggles (`view-*-export*`, `view-docket-edit-btn`, `view-links-relink`,
`view-deadlines-transition-btn`, all `*-cancel`).

#### Companion mockup APPROVED (2026-08-10)

The interactive mockup — artifact `d817a6f0-ade6-4a68-aa6e-bf3295d4a566` ("Lawbar 界面重设计提案", with the
before/after toggle and the 圈改 annotation layer) — was **explicitly approved by Frank on 2026-08-10**. It is
the visual companion to this document; **this file remains the authoritative Design artifact** for the
`Type: UI` requirement, and it is what the shipped commits cite.

Verified at approval time: every decision the mockup renders matches what actually shipped —
button weights (`c9e3187`), the 断开/确认断开 danger pair plus the two added 取消 (`f824ac2`), the naming
table 添加X / 保存 / 确认+宾语 / ← 返回 (`52a8207`), and the 编辑…-primary / 归档…-in-危险操作 header split,
which UI-4 confirmed already existed and therefore closed as a verified no-op (`d19b8c8`). The mockup's
"全部 data-test-id 保持不变" promise held: id sets were diffed per screen, zero lost or renamed.

Approval is therefore **retrospective and confirmatory** — the programme was already complete. No further
UI batch is authorized by it. NOT independently re-verified at approval time: the exact CSS rendering of
`.button--danger` (the mockup draws it as an outline; the shipped token may differ) — a cosmetic detail, not
a decision.

#### Open questions resolved (2026-08-06)

- **(R) Settings utility row → DEFERRED to a separate WI.** The 打开数据目录 / 复制诊断信息 utilities require new
  IPC and are not pure presentation; WI-UI-4 only rebalances Settings with static info. Interactive utilities
  are a later opt-in WI. Supersedes §3's "add a utility row (optional)" — presentation-only in these batches.
- **(UI-4) → CLOSED AS A NO-OP, verified 2026-08-08. The 4-batch plan completes at UI-3.** Both of UI-4's
  items were re-verified against real code and neither has remaining work:
  - **(L) matter action cluster — ALREADY SATISFIED.** The proposed rule was "header = 编辑 primary,
    危险操作 section = 归档 danger". That is exactly what ships: `viewMatter.ts:317-318` renders 编辑 as
    `button button--primary view-edit-btn` in the header, and `viewMatter.ts:488-501` renders 归档 as
    `button button--danger view-archive-btn` inside the archive pull card marked `detail.dangerZone`
    (「危险操作」). §"Visual-weight rules" of this same spec already recorded that separation as
    "intentional, not drift" — item L contradicted its own document.
  - **(R) Settings — no gap to close.** The interactive half (打开数据目录 / 复制诊断信息) was already
    DEFERRED above (needs new IPC; not presentation). The residual "rebalance with static info" has no
    identified deficit: `settings.ts` already presents 版本, 运行模式, 数据位置, 本地优先, 离线优先,
    FileVault state + its production note, and the no-telemetry privacy statement across two sections.
  Implementing UI-4 anyway would have meant inventing churn against a screen that is already correct, which
  §"Execution discipline" forbids. **No WI-UI-4 commit exists or is needed.**
- **(I, action order) → INLINE surfaces use `[primary, cancel]`; a future MODAL surface would use macOS
  HIG `[cancel, primary]`.** Decided 2026-08-08 for WI-UI-2, at Frank's direction to route the call to Codex
  (`review-plan-mskgim15-vhefre`, thread `019fe1bb-754a-7113-aaa8-eaa9a0e85806`).
  *Why this was a real fork:* the app is macOS-only with a native-feel goal, and Apple's HIG puts the default
  button RIGHTMOST — the opposite of this spec's approved `[primary, cancel]`. Verified reality first: 4 of 5
  action rows are already primary-first (`viewMatterDeadlines.ts:593`, `viewMatterDocketProposals.ts:525`,
  `archiveMatter`, `editMatter`); only `viewMatterClaimTracks.ts:448` was `[cancel, save]`.
  *Mechanism for the decision (not "best practice says"):* HIG's ordering is written for modal/alert surfaces
  that STOP the user to force a choice between escape and default. These are inline task controls embedded in
  a list/document workflow, read left-to-right — so primary-first keeps the row's main verb first in scan
  order and keeps every inline row mechanically uniform. Destructive rows deliberately do NOT deviate: if
  destructive rows reversed order while benign ones did not, placement would become a hidden safety signal
  users must learn, which is weak and easily mislearned. The real guard on these flows is the mandatory typed
  reason — already hardened against whitespace-only input in `e9ff43c`.
  *Scope limit:* this convention binds INLINE surfaces only. No true modal/sheet exists in the app today; if
  one is ever introduced it follows macOS HIG (primary right), because the split follows interaction surface,
  not danger level. So WI-UI-2 changes exactly one existing row (ClaimTracks) and places both new cancels
  after their confirm.
- **(O, 2-step escape) → CONFIRMED by code, exactly two missing.** `view-facts-reject-confirm` and
  `view-links-unlink-confirm` are the only confirm actions in the renderer with no cancel sibling; every other
  confirm already pairs with one. Both are destructive and both require a typed reason, so a user who reveals
  the reason input currently has no way to back out. WI-UI-2 adds `view-facts-reject-cancel` and
  `view-links-unlink-cancel`.
- **(D, deadlines) → KEEP 提议 semantics; do NOT rename to 添加期限.** The docket lifecycle is
  proposed → confirmed → materialized (`docs/adr/case-box-step-6-deadline-docketing-rules.md`); "添加" would
  misrepresent the two-step. The committed ADR outranks the "添加X uniformly" proposal (source hierarchy). The
  D rule still applies to non-lifecycle add actions (documents / facts / claim-tracks / evidence).

---

### 1. Naming rules + legal-term glossary

**Verbs (one intent → one verb):**
| Intent | Rule | Fixes |
|---|---|---|
| Start creating the ONE top-level entity (a matter) | **新建案件** (the entry CTA) → its commit button **创建案件** | B |
| Add a child record to a matter | **添加X** — 添加当事人 / 添加文档 / 添加事实 / 添加诉请 / 添加期限 (was 新增/添加/提议 mixed) | D |
| Commit any inline form (add-form or edit-form) | **保存** (editMatter "保存更改"→保存; docket "保存修改"→保存; claimTrack 保存 ✓) | C |
| Abandon a form / collapse a reveal | **取消** (one shared key) | H |
| Confirm a two-step destructive action | **确认+对象**: 确认归档 / 确认驳回 / 确认断开 / 确认完成 (the bare "确认" on missed→met becomes 确认完成) | G |
| Return to the matter list | **← 返回案件列表** (one key; add the missing arrow on notFound) | A |
| Return to one matter | **← 返回案件** (one key) | A |

**In-flight status:** specific, never generic — "正在创建链接…" / "正在断开…" / "正在恢复…" (retire the shared opaque
"处理中…"). Matches the app's existing specific style ("正在归档…", "正在保存…"). Fixes N.

**Required marker:** every required field/legend ends with " *", uniformly (createMatter has it, claimTrack lacks
it). Fixes Q.

**Glossary (one term per concept, app-wide):** 案件 (matter), 当事人 (party), 期限 (deadline), 事实 (fact),
诉请 (claim track), 文档 (document), 证据链接 (evidence link), 归档 (archive), 驳回 (dismiss/reject),
断开 (unlink), 审计日志 (audit log). Ban vague labels ("确定"/"处理"); every action names its object.

---

### 2. Visual-weight rules (the shared `.button` family, applied everywhere)

| Weight | Class | Use |
|---|---|---|
| **Primary** | `button button--primary` | the ONE main action of a screen/form: 创建案件, 保存, 编辑…, 添加X (the reveal), the primary confirm of a benign 2-step |
| **Danger** | `button button--danger` | EVERY destructive / irreversible-audited action AND its confirm: 归档…, 确认归档, 断开→确认断开, 驳回→确认驳回, 撤回 |
| **Neutral/secondary** | `button button--secondary` | 取消, 添加当事人 (form-row add), 加载更多, 导出… |
| **Back** | `back-link` | the two back links only |

**Hard rule — no bespoke button classes.** Every `view-*-btn` in the matter sub-sections (documents, deadlines,
docket, facts, links, claim-tracks, T3) MUST adopt `button` + the weight modifier above. This is the single biggest
consistency fix (F): today those seven sub-sections have no shared visual weight. `data-test-id`s stay unchanged so
the smoke tests keep their hooks (S).

**Danger weight reaches in-section destructive actions (E):** 断开 (unlink), 驳回 (dismiss/reject), 撤回 (withdraw)
render as `button--danger`, same as archive — a court-facing tool must not show "break this citation, recorded in
the audit log" with neutral weight.

---

### 3. Layout + grouping rules

- **Form action order — primary first, then cancel**, everywhere: `[Save/Submit, Cancel]`. Fixes I (claimTrack is
  currently `[Cancel, Save]`; docket edit `[Save, Cancel]`).
- **Matter-level actions** (viewMatter): keep **编辑…** as a header primary; keep **归档…** in a distinct
  「危险操作」 section (destructive actions stay visually separated from benign ones — intentional, not drift).
  Resolves L by making the separation a rule, not an accident.
- **Two-step "reveal reason → confirm" is ONE standard component** (O): reveal a reason input + `[确认X (danger),
  取消 (neutral)]`. Add the missing 取消 to fact-reject and link-unlink (today they have no escape). Same layout,
  labels, and danger weight in all four sites (deadline missed→met, docket dismiss, fact reject, link unlink).
- **Pagination** "加载更多" is always `button button--secondary` (J: three of four sites lack the class today).
- **Settings** gains a light action affordance so it doesn't read as broken next to the action-dense chrome (R) —
  e.g. a 「打开数据目录」 / 「复制诊断信息」 utility row (proposal; Frank decides if wanted).
- **"编辑…" (navigate) vs "编辑" (inline)** (K): keep the ellipsis "编辑…" ONLY for navigation-to-a-screen; the
  docket in-row inline edit uses a distinct label 「修改此项」 to signal in-place editing, not navigation.

---

### 4. Cross-screen consistency check (A–S → resolution)

| # | Inconsistency | Resolution |
|---|---|---|
| A | "返回列表" under 4 keys; notFound drops the arrow | one key `nav.backToList` = "← 返回案件列表"; one `nav.backToMatter` = "← 返回案件" |
| B | new-matter named 3 ways, weighted 2 ways | 新建案件 (start) → 创建案件 (commit); all primary weight (drop accent) |
| C | save labelled 4 ways | 保存 for every inline commit; 创建案件 only for the matter create |
| D | add-child verb 新增/添加/提议 mixed | 添加X uniformly |
| E | danger weight only top-level | danger weight on all destructive actions incl. sub-sections |
| F | sub-sections abandon the button system | all controls adopt `.button` family |
| G | confirm labels inconsistent; bare "确认" | 确认+对象 everywhere; 确认完成 replaces bare 确认 |
| H | 取消 under 6 keys, mixed weight | one `nav.cancel` key, `button--secondary` |
| I | save/cancel order differs | `[primary, cancel]` everywhere |
| J | 加载更多 styled 2 ways | always `button--secondary` |
| K | "编辑…" nav vs "编辑" inline | 编辑… = navigate; 修改此项 = inline |
| L | matter actions split across regions | rule: header=编辑 primary, 危险操作 section=归档 danger |
| M | duplicate placeholder keys | one `form.selectPlaceholder` = "— 请选择 —" |
| N | generic "处理中…" | specific per-action status strings |
| O | 2-step reason reveal reimplemented | one standard component (reason + 确认X danger + 取消) |
| P | export named by content vs format | 导出引用 / 导出证据目录（DOCX） — name the content, note the format in parens |
| Q | required marker inconsistent | " *" on all required legends/labels |
| R | Settings has no affordances | add a utility row (optional) |
| S | data-test-id conventions differ | preserve ALL existing ids (test hooks); redesign is class/label/layout only |

---

### 5. Batched implementation plan (fewest cohesive batches)

Ordered so each batch is one cohesive, independently-shippable WI. Batches 1–2 are pure presentation (low-risk —
lighter loop); 3–4 touch copy + structure; none touch persistence/IPC/data.

- **Batch UI-1 — the shared button system (F, E, J).** Give every `view-*-btn` and pagination control the
  `.button` family + correct weight; apply danger weight to all destructive actions. CSS + class strings only; no
  label/behavior change. Biggest visual payoff, lowest risk. (~7 sub-section files + index.css.)
- **Batch UI-2 — form action order + the 2-step component (I, O).** Normalize `[primary, cancel]`; unify the
  reveal-reason→confirm affordance (add the two missing 取消). (claimMatter/claimTrack/docket + facts/links/deadline
  reason flows.)
- **Batch UI-3 — naming + catalog consolidation (A,B,C,D,G,H,K,M,N,P,Q).** Apply the verb rules; collapse the
  duplicated keys (back-links, cancel, placeholder) into shared keys; specific status strings; required markers.
  Copy-only + catalog; regen the i18n allowlist ONCE at the end. (catalog.ts + every screen's label refs.)
- **Batch UI-4 — matter action cluster + Settings affordance (L, R).** Finalize viewMatter header vs 危险操作
  placement; add the Settings utility row if Frank wants it.

Governance: Batches 1–2 are pure presentation → desktop gate (i18n guard + color guard + dto-sync + screen tests)
is sufficient; self-review acceptable per cc-suite low-risk. Batches 3–4 (copy/structure) → desktop gate + one
cc-suite audit each. None touch the audit chain, server authority, or data. Every batch preserves all
`data-test-id`s. Regenerate the line-indexed i18n allowlist as the LAST step of any batch that shifts screen lines,
then re-run the full desktop gate (the standing lesson).

---

### Redline instructions
Open the companion mockup and mark up: (1) any label you'd word differently, (2) any button that should move /
appear / disappear, (3) any weight (primary/danger/neutral) you disagree with, (4) whether Settings gets the
utility row, (5) whether deadline "propose→confirm" keeps 提议 or becomes 添加期限. Your redlines replace the
proposals here; then I implement in the 4 batches above.
