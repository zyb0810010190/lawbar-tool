# Architecture Decision Records — index

60 records. This file orients a reader arriving here; it decides nothing itself.

**These records are normative, not archival.** `docs/product/product-plan.md` states that an ADR
outranks the product brief on the decision it documents. Where this index and a record disagree,
**the record wins** — this file is a finding aid, and a finding aid cannot amend a decision.

## Read the scope before you read the status

The single most common way to misread this corpus is to see **Accepted** and conclude that code was
authorized. It usually was not. Status here carries two independent facts, and only one of them is
lifecycle:

| Scope | Meaning | Typical phrasing in the record |
|---|---|---|
| **design-only** | Decides a direction. Authorizes no code, schema, or migration. | "design only; authorizes no implementation", "Decision-only", "Doc-only", "**Does NOT authorize implementation**" |
| **contract** | Fixes an interface others must satisfy. Still authorizes no implementation. | "schema/persistence CONTRACT — design only; authorizes no migration or persistence code" |
| **implementation-authorizing** | Code shipped with, or under, this record. | "**Decision + code**", "Implemented in this step", "Co-committed with …" |

`Accepted (schema/persistence CONTRACT — design only; authorizes no migration or persistence code)`
is **Accepted** and **authorizes nothing**. Both halves are load-bearing. Thirty-five of the sixty
records below authorize no implementation — 26 design-only and 9 contract, against
25 implementation-authorizing; treating any of them as a licence to write code is the
error this table exists to prevent.

## Case-box foundations — the Step 0–8 series

Boundary, model and implementation decisions for the case box. Step 0 sets the boundary; the rest
fill it in. **There is no Step 1 record.** `case-box-step-1-contract-vocabulary.md` appears in Step
0's phasing table as planned work and was never written; the corpus resolved it by pointing at the
shipped package instead — see the redirect in `docs/adr/case-box-step-7-multi-user-readiness.md`.
References to it elsewhere in the repo are dead.

| Record | Governs | Scope |
|---|---|---|
| `docs/adr/case-box-step-0-boundary.md` | Product boundary: a package family parallel to OCR, local-first, external services as audited opt-ins | design-only |
| `docs/adr/case-box-step-2-fact-promotion-and-provenance.md` | Fact lifecycle; `candidate → accepted` deliberately absent so only a lawyer promotes | implementation-authorizing |
| `docs/adr/case-box-step-3-privilege-marker-model.md` | Privilege markers; no field readable as a disclosure clearance | implementation-authorizing |
| `docs/adr/case-box-step-4-audit-log-shape.md` | Audit-log shape, canonical hash input, chain verifier | implementation-authorizing |
| `docs/adr/case-box-step-5-confidentiality-classification.md` | Append-only classification; `unclassified` denies all external handling | implementation-authorizing |
| `docs/adr/case-box-step-6-deadline-docketing-rules.md` | Docket entries as the authority; deadlines are a projection | implementation-authorizing |
| `docs/adr/case-box-step-7-multi-user-readiness.md` | The `"local-user"` sentinel and the conditions that void it | design-only |
| `docs/adr/case-box-step-8-llm-extractor-policy.md` | What any future LLM extraction must satisfy before it may run | design-only |

## Case-box features

| Record | Governs | Scope |
|---|---|---|
| `docs/adr/ADR-casebox-matter-party-identity.md` | Server-side party ULIDs; audited backfill, no migration | implementation-authorizing |
| `docs/adr/ADR-matter-details-edit-v1.md` | Six editable matter fields via one audited `MATTER_DETAILS_UPDATED` event | implementation-authorizing |
| `docs/adr/docket-proposal-edit.md` | Content-only edit of a `proposed` docket entry | design-only |
| `docs/adr/audit-event-kind-preservation.md` | Versioned canonicalization so `event_kind` joins the hash chain | design-only |

## Evidence — A3 anchors and links

The largest coherent series. All contract or design; **no A3 record authorizes implementation.**

**One caveat you must not miss.** `docs/adr/ADR-evidence-a3-anchor-link-contract.md` appears below
as a live contract and *is* one — but it is also superseded in fact. Its interface obligations still
govern the A3 design; its present-tense claims about enforcement machinery are void. Read its banner
before relying on it.

| Record | Governs | Scope |
|---|---|---|
| `docs/adr/ADR-evidence-a3-anchor-link-contract.md` | Anchor identity, canonical `page_ratio`, fail-closed resolution | contract |
| `docs/adr/ADR-evidence-a3-schema-persistence-contract.md` | Anchor/link schema; 12-dp decimal strings, no implicit `valid` | contract |
| `docs/adr/ADR-evidence-a3-page-geometry-foundation.md` | `DocumentPage` / `DocumentPageGeometry` as prerequisites | contract |
| `docs/adr/ADR-evidence-a3-persistence-substrate.md` | Existing better-sqlite3 layer; no new dependency | design-only |
| `docs/adr/ADR-evidence-a3-resolver-status-transitions.md` | The status ladder; `valid` is never a default | contract |
| `docs/adr/ADR-evidence-a3-anchor-delete-policy.md` | A referenced anchor is refused deletion; no cascade | contract |
| `docs/adr/ADR-evidence-a3-export-degradation.md` | One deterministic export flag per link; never drop a link | contract |
| `docs/adr/ADR-evidence-a3-unlink-break-link-workflow.md` | Unlink as a separate audited operation | contract |
| `docs/adr/ADR-evidence-a3-durable-unlink-schema.md` | The marker columns that make unlink durable | contract |
| `docs/adr/ADR-evidence-a3-link-create-operation.md` | `createLink` semantics and its audit event | design-only |
| `docs/adr/ADR-evidence-a3-link-ipc-surface.md` | The five `casebox:link:*` channels | design-only |
| `docs/adr/ADR-evidence-a3-link-d1-roundtrip-closure.md` | Test-only synthetic anchor seed for the IPC round trip | design-only |

## Evidence — A0.7 renderer conformance and marker provenance

**Read the banners on all four before relying on anything here.** Each is superseded in fact: the
gate, marker writer, validator and guard they design were deleted and never rebuilt. They record
intent and reasoning only. These are four of **six** superseded-in-fact records; the other two sit
under client architecture and in the A3 series. All six are listed together below.

| Record | Governs | Scope |
|---|---|---|
| `docs/adr/ADR-evidence-native-core-a07-feasibility.md` | A Swift/PDFKit evidence core behind the deterministic-JSON CLI contract | design-only |
| `docs/adr/ADR-evidence-a07-renderer-conformance-gate.md` | What the A0.7 gate would prove: deterministic page geometry, three-state verdict | design-only |
| `docs/adr/ADR-evidence-a07-marker-provenance.md` | Marker payload bound to fixture, oracle, harness commit and run id | design-only |
| `docs/adr/ADR-evidence-a07-key-custody-operating-model.md` | Where the marker HMAC key lives and the three accepted custody modes | design-only |

## Evidence — A8 snapshot, A10 export, forms

| Record | Governs | Scope |
|---|---|---|
| `docs/adr/ADR-evidence-a8-snapshot-integrity-confidentiality.md` | Tamper-evident snapshots; two never-conflated keys | design-only |
| `docs/adr/ADR-evidence-a10-court-fileable-export.md` | `CanonicalExportModel`; citations degrade total-and-bijectively | design-only |
| `docs/adr/ADR-forms-t4-proof-model-scope.md` | T4 is post-v1; the proof model is issue-centric | design-only |

## Client architecture and packaging

| Record | Governs | Scope |
|---|---|---|
| `docs/adr/client-application-surface.md` | A Mac desktop app embedding the libraries in-process; no network by default | design-only |
| `docs/adr/sync-bridge-architecture.md` | An opt-in, off-by-default HTTP bridge for a future companion | design-only |
| `docs/adr/ADR-evidence-desktop-internal-deps-packaging.md` | Commit the internal tarballs plus the lockfile, guarded by a drift gate (lifecycle: Proposed, not Accepted) | design-only |
| `docs/adr/ADR-evidence-m0-xiaolai-workflow-composition.md` | Three-layer agent workflow composition; higher layers constrain lower | design-only |

## OCR — queue and runtime (Step 10)

| Record | Governs | Scope |
|---|---|---|
| `docs/adr/ocr-processing-coordinator-step-10c.md` | The coordinator owns queue lifecycle; never prewrites `processing` | implementation-authorizing |
| `docs/adr/ocr-worker-runtime-entrypoint-step-10e.md` | Worker runtime shell; exit codes, not `process.exit` | implementation-authorizing |
| `docs/adr/ocr-pipeline-runtime-integration-step-10f.md` | In-memory pipeline smoke test | implementation-authorizing |
| `docs/adr/ocr-worker-bin-wrapper-step-10g.md` | The `bin/ocr-worker.mjs` wrapper and real-spawn smoke | implementation-authorizing |
| `docs/adr/ocr-queue-boundary-step-10h.md` | SQLite-backed queue; Redis/BullMQ/SQS/Postgres rejected | design-only |
| `docs/adr/ocr-queue-boundary-amendment-step-10h-a.md` | Amends 10H — receipt lineage, clock authority, contention proof | design-only |
| `docs/adr/ocr-queue-runtime-wiring-step-10j.md` | The `--queue` flag and second connection | implementation-authorizing |
| `docs/adr/ocr-ingest-enqueue-only-step-10k.md` | Enqueue-only ingest; job and queue rows in one transaction | implementation-authorizing |
| `docs/adr/ocr-cross-process-e2e-step-10l.md` | Cross-process end-to-end through the real bin | implementation-authorizing |

## OCR — engine selection and adapters (Step 11A–11C)

| Record | Governs | Scope |
|---|---|---|
| `docs/adr/ocr-real-worker-source-access-step-11a-0.md` | Source-access and confidentiality threat model | design-only |
| `docs/adr/ocr-engine-bakeoff-step-11a-1.md` | PaddleOCR-via-ONNX as provisional default; a v0.1 verdict | design-only |
| `docs/adr/ocr-engine-output-mapping-step-11a-5.md` | `OcrJobOutcome` shape and its composed validator | contract |
| `docs/adr/ocr-worker-runtime-step-11b.md` | In-process engine behind a closed-union `WORKER_REGISTRY` | design-only |
| `docs/adr/ocr-engine-to-result-mapper-step-11c-1.md` | Pure engine-line → `OcrResult` projection | implementation-authorizing |
| `docs/adr/ocr-page-fetcher-step-11c-2.md` | The fetch boundary and its gate order | implementation-authorizing |
| `docs/adr/ocr-engine-adapter-registry-step-11c-3a.md` | Adapter shape and the frozen registry map | implementation-authorizing |
| `docs/adr/ocr-real-paddleocr-engine-step-11c-3b.md` | The real engine factory behind `EnginePort` | implementation-authorizing |
| `docs/adr/ocr-worker-bin-wiring-step-11c-3c.md` | Bin wiring; the point the pipeline became usable for real OCR | implementation-authorizing |

## OCR — fetcher source kinds and retry (Step 11D–11G)

| Record | Governs | Scope |
|---|---|---|
| `docs/adr/ocr-fetcher-inline-source-step-11d-1.md` | `inline` source kind; base64 payload, capped and sniffed | implementation-authorizing |
| `docs/adr/ocr-fetcher-https-source-step-11d-2.md` | `https` source kind and its ordered gate chain | implementation-authorizing |
| `docs/adr/ocr-fetcher-https-dns-pinning-step-11d-2-a.md` | HTTPS connect pinned to the already-vetted address | implementation-authorizing |
| `docs/adr/ocr-fetcher-s3-source-step-11d-3.md` | `s3` stays rejected in v1; pre-sign and submit as `https` | design-only |
| `docs/adr/ocr-fetcher-retry-classification-step-11e.md` | Transient vs permanent error classification (data layer) | implementation-authorizing |
| `docs/adr/ocr-coordinator-retry-wiring-step-11f.md` | The coordinator acts on that classification | implementation-authorizing |
| `docs/adr/ocr-coordinator-pending-retry-outbox-step-11g.md` | Durable pending-retry record so an attempt cannot re-run forever | implementation-authorizing |

## Records superseded in fact — read these before trusting the six

Six records carry a `⚠️ SUPERSEDED IN FACT — 2026-08-10` banner. The machinery they describe in the
present tense was deleted in the configuration reset of `49dd7ad` and the follow-up `e67b047`.

**The banners do their job well and you should read one in full.** They enumerate exactly which
scripts are gone, carry a "Verified 2026-08-12" date, spell out the consequence — *"There is no
A0.7 gate, so nothing 'fails closed'"*, *"any marker-forgery hole this ADR describes as closed is
**open**"* — and instruct the reader to read every "is built / is enforced / fails closed / is
wired" claim as past tense. The records are honest about their own obsolescence.

- `docs/adr/ADR-evidence-a07-renderer-conformance-gate.md`
- `docs/adr/ADR-evidence-a07-marker-provenance.md`
- `docs/adr/ADR-evidence-a07-key-custody-operating-model.md`
- `docs/adr/ADR-evidence-native-core-a07-feasibility.md`
- `docs/adr/ADR-evidence-m0-xiaolai-workflow-composition.md`
- `docs/adr/ADR-evidence-a3-anchor-link-contract.md` — also the A3 series' foundational contract,
  listed above as live. Both are true, and the split matters: the interface obligations it fixes
  remain binding on any future A3 work, while every present-tense claim that a gate, validator or
  marker check *exists* is currently false.

What is absent is a *forward-pointing successor* — no record states the current posture in its own
right; you learn it only from a banner on an obsolete document. That absence is a real gap, not
merely an open question: a reader learns the current posture only from a document announcing its own
obsolescence. It is mitigated — the banners are truthful, specific and dated — but the fix is a
successor record stating the posture directly. Until one exists, **the banners are the only
authority on this gap.**

Two further supersessions are partial and properly recorded, needing nothing:
`docs/adr/ocr-fetcher-https-source-step-11d-2.md` is superseded in part by Step 11E on error-code
splitting, and `docs/adr/ADR-evidence-a3-link-d1-roundtrip-closure.md` supersedes its own rev-0
seed mechanism in place.

## Conventions, as they actually are

Two naming families coexist: 23 records use an `ADR-<topic>.md` prefix, 37 are unprefixed legacy
names. **The filename is the universal stable identifier** — every record has one, and every
cross-reference in this repo cites it, in documentation and in shipped source. There is no numbering scheme and adding one would break those
references.

Eighteen records additionally declare a canonical id (`A3-SCHEMA-00`, `A07-KEY-00`, `EVW-00`,
`SYNC-00`, `CLIENT-00`, …) which is cited from TypeScript and test fixtures as well as prose. The
remaining 42 have none. Both facts are load-bearing: canonical ids are an additional, code-facing
identifier that exists for only some records.

Twenty records contain a section weighing alternatives — `## Rejected alternatives`,
`## Options considered`, `### Option A/B/C/D`. Forty do not; they record obligations, invariants and
boundaries rather than a chosen option. That is a property of the decisions, not a defect in the
records, and it is why this corpus does not fit a template that requires an options section.
