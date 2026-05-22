# Product Target Architecture (v1)

**Status**: Authoritative product summary. Promoted 2026-05-20 from `dev-memo/plan-client-00.md` (commit `a07e5d1`) and the pre-Phase-0 case-box plan (now `dev-memo/superseded/case-box-plan.md`).

This document is the single-page product-direction summary for v1. The deeper architectural decisions live in the linked ADRs; this document is the canonical pointer.

---

## v1 Product Shape

The v1 product is a **case-box workspace for one lawyer**, running locally on a Mac. The OCR pipeline is a subordinate data feed: it turns scanned legal documents into searchable text that the case box references. The lawyer's daily work happens at the case (matter) level — facts, issues, claims, elements, evidence, deadlines, privilege markers, risks, next actions, audit trail — not at the OCR-job level.

What ships in v1 day-one:
- A Mac desktop application.
- A local case box per the case-box-step-0 boundary (`docs/adr/case-box-step-0-boundary.md`).
- The existing OCR pipeline embedded in-process inside the desktop app.
- An append-only hash-chained audit log under the lawyer's user-controlled path.

What does NOT ship in v1 day-one:
- Any network surface for the default workflow.
- WeChat mini-program client.
- Browser / web UI.
- Cloud sync.
- LLM candidate-fact extraction — **indefinitely postponed** per `docs/product/project-requirements-brief.md` R-8. The deterministic stub is the v1 extractor; the Step-8 LLM-extractor-policy ADR remains as future policy only.
- Deadline computation engine (data model present; engine is post-MVP).
- Multi-user auth.

---

## Primary User

A single lawyer (or law-firm staff member working on the lawyer's behalf) on a Mac. The lawyer:

- Holds confidential legal documents that must not leave the machine by default.
- Works on one or more matters (cases) at a time.
- Reviews OCR output, accepts/rejects candidate facts, binds facts to claim elements as evidence citations, marks privilege, tracks deadlines, exports privilege logs.
- Does not administer a multi-tenant SaaS, does not register users, does not configure cloud backends, does not write code.

Browser users, multi-firm SaaS operators, and mobile-first paralegals are **not** v1 primary users. They may become users post-v1 when the sync bridge, WeChat mini-program, or auth provider lands.

---

## Client Surfaces

| Surface | Status | Notes |
|---|---|---|
| Mac desktop app | **v1 primary** | In-process embedding of `ocr-*` and `case-box-*` libraries. No network on default path. Per `docs/adr/client-application-surface.md`. |
| WeChat mini-program | **Deferred companion** | Post-v1 only. Reaches the case box via the sync bridge (per `docs/adr/sync-bridge-architecture.md`). Read-mostly + minimal write. Sees only what the lawyer explicitly opts in to expose. |
| Browser / web UI | **Indefinitely postponed** | Not v1 primary; no v1 or post-v1 architectural budget per `docs/product/project-requirements-brief.md` §3. The Electron renderer (per CLIENT-01) is Mac-app-local, not a published web app. A standalone browser SPA is not planned. |
| Windows / Linux desktop | Deferred | Mac-only v1. |
| iPad / native mobile | Deferred | |
| Multi-firm SaaS | **Not v1** | `tenant_id` retained in data shape for forward compatibility; no multi-firm v1. |

---

## Data Residency

| Aspect | v1 default | Opt-in path |
|---|---|---|
| Documents | Local filesystem under user-controlled path (default `~/Library/Application Support/lawbar/`); identified by `content_hash`; SQLite stores metadata only. **Originals retained verbatim** — see Cross-cutting Invariants. | None v1; future per-document sync grant via sync bridge |
| Case-box SoT (cases, documents, facts, issues, claims, elements, evidence, deadlines, privilege, risks, actions) | Local SQLite under user-controlled path | None v1; future per-matter sync grant via sync bridge |
| Audit log | Separate local SQLite file with hash chain, also under user-controlled path | None v1 — audit log stays local |
| OCR engine | Local `paddleocr-onnx` — applies to **scanned/image PDFs and image files / screenshots only** per `docs/product/project-requirements-brief.md` §8 + `dev-memo/plan-brief-doc-reconcile.md` §3.2 | Future external OCR worker, opt-in per document, restricted to `confidentiality_class = normal` |
| Document text extraction (non-OCR) | **None v1.** PDF text-layer / Word / MD / other office formats are retained verbatim; lawyer recourse for searchable text is manual paste (per brief §6 manual-paste fallback) | Post-v1 STOP-AND-ASK ADR (`WI-brief-doc-text-extract-policy`) decides engine + dispatch policy + text-layer detection + multi-artifact-per-document model |
| LLM candidate-fact extraction | **Indefinitely postponed** (per brief R-8); the deterministic stub remains the v1 extractor. The Step-8 LLM-extractor-policy ADR remains future policy only. | None planned. Re-opens only if the user explicitly authorizes a future LLM enablement WI. |
| Encryption at rest | macOS FileVault (system-level) | Per-document encryption deferred to post-MVP ADR |

**Default = no cloud, no network egress, no LLM remote call.** Sync is a deliberate user-driven act on a per-document or per-matter basis. The lawyer's normal workflow produces zero outbound network traffic apart from outbound OCR-source fetches when the lawyer explicitly submits a URL-sourced document for OCR (this path retains WI-03's DNS-pinning / SSRF posture unchanged).

---

## Sync Bridge Role

Per `docs/adr/sync-bridge-architecture.md`:

- **Off by default.** No listener runs in the v1 desktop app default workflow.
- **Opt-in per document or per matter.** The lawyer enables sync grants explicitly; bridge consults the grants table before exposing any record. No grant → undifferentiated 404 (does not leak existence).
- **Narrow surface.** Subset of the contract drafted at `docs/ui/sync-bridge-contract-draft.md`. Read endpoints first; writes routed through the coordinator. NO bulk export, NO submit-new-document at v1 bridge launch, NO privilege-log export.
- **Audits every operation.** Hash-chained audit events for reads (MAY log) and writes (MUST log).
- **Authenticates** when the bridge ships — but the auth provider is a Stop-and-Ask gate. Test-mode auth is the only seam recorded in SYNC-00.
- **Separate security sign-off.** WI-03 covers outbound only. The bridge's inbound surface needs its own sign-off (proposed file: `docs/release/sync-00-security-signoff.md`).

The bridge is the architectural seam through which **all** companion clients (WeChat mini-program, future browser SPA, future cloud-sync targets) reach the case box. There is no other inbound network surface.

---

## Mini-program Role

The WeChat mini-program is a **deferred companion channel**. When it ships (post-v1, after the sync bridge ships):

- Read-mostly. The day-one mini-program surface accepts the SYNC-02 read endpoints; writes (e.g. accept/reject candidate fact) wait for SYNC-03.
- Sees only what the lawyer explicitly opts in to expose, per document or per matter.
- Authenticates through the bridge's auth seam — provider Stop-and-Ask.
- Cannot consume Node libraries directly (mini-program runtime sandbox); HTTP-only.

WeChat mini-program publication requires a registered Chinese business entity and WeChat developer account. Out of v1 day-one scope.

---

## Browser / Web UI

**Indefinitely postponed.** Not v1 primary; no v1 or post-v1 architectural budget per `docs/product/project-requirements-brief.md` §3.

The Electron renderer (when Electron is chosen as the desktop shell per CLIENT-01) IS a Chromium browser, but it is Mac-app-local, not a published web app. A standalone browser SPA is NOT planned (neither v1 nor post-v1). The GW-00 ADR's original framing of a public-internet API + browser SPA is explicitly rejected. If a future brief amendment re-authorizes a browser SPA, it would open as a new reconciliation WI; until then this surface remains intentionally absent from the roadmap.

---

## Future Work Items

These WIs are recorded in priority order. **None are authorized by this document.** Each requires its own authorization gate per `AGENTS.md` Stop-and-Ask rules.

| WI | Subject | Gate |
|---|---|---|
| **CLIENT-01** | Desktop shell framework selection (recommended default: Electron, per `docs/adr/client-application-surface.md` §Framework decision deferred) | Stop-and-Ask: new runtime dependency |
| **CLIENT-02** | Renderer UI framework selection | Stop-and-Ask: new runtime dependency |
| **CLIENT-03** | `apps/lawbar-desktop/` scaffold (main process, IPC bridge, preload script, empty renderer) | regular implementation WI after CLIENT-01 + CLIENT-02 |
| **CASE-BOX Step 1** | `case-box-contract` package: schemas, state machines, validators, generated types | regular implementation WI |
| **CASE-BOX Step 2** | `case-box-persistence`: in-memory + SQLite conformance, replay-safe writers, audit hash chain | regular implementation WI |
| **CASE-BOX Step 3** | `case-box-ingestion`: case-create, document-upload, OCR submission via `ocr-ingestion`, `ocr_job_link` sync | regular implementation WI |
| **CASE-BOX Step 4** | Candidate-fact stub extractor (deterministic; pluggable for future LLM) | regular implementation WI |
| **CASE-BOX Step 5** | `case-box-review`: chronology, proof_matrix, document_index, privilege_log | regular implementation WI |
| **CASE-BOX Step 6** | Privilege markers + audit + export hooks fully wired | regular implementation WI |
| **CLIENT-04+** | Per-screen implementation in UI-00's recommended order (S2 list → S3 detail → S4 read → S1 submission → S6 cancel → S5 manual-review), then case-box screens | regular implementation WIs |
| **CLIENT-05** | Coordinator-mediated cancel function in `services/ocr-worker` (the contract names `web_app` as the cancel actor; no function exists today) | Stop-and-Ask: contract / lifecycle change |
| **AUTH (deferred)** | Auth provider selection. Re-opens when sync bridge ships, single-firm-multi-user phase begins, WeChat mini-program ships, or LLM remote extractor is enabled | Stop-and-Ask: auth/authorization |
| **TENANT (indefinitely deferred)** | Single-firm-multi-user phase (multiple users in one tenant) — demoted from "near-future" to "indefinitely deferred" per `docs/product/project-requirements-brief.md` R-4 | Stop-and-Ask after AUTH; only re-opens on explicit user authorization |
| **SYNC-01** | Sync-bridge scaffold per `docs/adr/sync-bridge-architecture.md` (package, auth seam interface, sync-grants persistence) | Stop-and-Ask: inbound network surface + framework dependency |
| **SYNC-02** | Sync-bridge read endpoints (job list, lifecycle, summary, page, manual-review worklist) | regular implementation WI after SYNC-01 |
| **SYNC-03** | Sync-bridge write endpoints (cancel, accept/reject candidate fact, quick-note); first bridge security sign-off | Stop-and-Ask: inbound write surface + security sign-off |
| **SYNC-04** | Sync-grants management UI in the desktop app | regular implementation WI |
| **SYNC-05+** | Cloud-sync target adapters | Stop-and-Ask: external account / cloud vendor |
| **SYNC-06+** | WeChat mini-program client | Stop-and-Ask: external account, third-party SDK, registered Chinese business entity |
| **CASE-BOX Step 7** | Deadline declarative-rules engine (post-MVP) | regular implementation WI |
| **CASE-BOX Step 8** | LLM extractor — **indefinitely deferred (future policy only)** per `docs/product/project-requirements-brief.md` R-8. The Step-8 LLM-extractor-policy ADR (`docs/adr/case-box-step-8-llm-extractor-policy.md`) remains as policy that would apply IF LLM enablement were ever re-authorized; v1 ships with the deterministic stub. | Stop-and-Ask: external account / cloud vendor / new runtime dep; only re-opens on explicit user authorization |
| **CASE-BOX Step 9** | Multi-user auth boundary (depends on AUTH gate) | Stop-and-Ask after AUTH |
| **DEPLOYMENT** | macOS code-signing + notarization; distribution channel choice | Stop-and-Ask: operational |
| **GO-LIVE** | Final go-live readiness sign-off | hard-stop per `AGENTS.md` |

---

## Deployment Decision (deferred)

v1 ships as a single Mac binary. Decisions deferred:

- macOS code-signing identity (Apple Developer ID) and notarization profile — operational; required before non-developer distribution.
- Distribution channel (direct download, Mac App Store, in-firm IT distribution).
- Auto-update strategy.
- Crash-reporting backend (if any) — must be off by default to preserve confidentiality posture; opt-in if added.

All deployment choices remain Stop-and-Ask per `AGENTS.md`. None is resolved by v1 architecture decisions.

---

## Cross-cutting Invariants (always-true, v1)

1. **Local-first by default.** No network egress on the lawyer's default workflow except the OCR worker's outbound HTTPS fetch (WI-03 hardened) when the lawyer explicitly submits a URL-sourced document.
2. **Coordinator owns OCR lifecycle.** Renderer / case-box / sync bridge never writes to `ocr-persistence` directly; all state transitions go through `OcrProcessingCoordinator`.
3. **Audit every write.** Every SoT mutation produces an audit event in the same logical transaction, hash-chained.
4. **LLM / automation outputs land as candidate.** Never auto-promoted to accepted.
5. **Privilege defaults to unmarked = NOT privileged.** Explicit marker required.
6. **No deletion of legal artifacts.** Soft-delete with audit reason; hard delete only via explicit retention policy (post-MVP).
7. **`tenant_id` retained.** Single tenant in v1; data shape multi-user-ready.
8. **`actor_user_id = "local-user"` is the v1 default** but only valid while local-only / no sync bridge / no LLM remote / no multi-user.
9. **No FK from case-box to OCR.** Cross-boundary references by value (`ocr_job_id`) only.
10. **No widening of public error surface.** Internal `HttpsTransportError` discriminators (WI-03b/c) never leak through IPC, bridge, or any client-facing surface.
11. **Original-file retention.** Every ingested file (Mac picker / URL / future WeChat upload / future scanner) is preserved verbatim, content-hash-addressed at a known `storage_uri`, and openable from the Mac desktop process. No extraction step (OCR, text-extraction, redaction, etc.) destroys or replaces the original. Extraction artifacts (OCR text, parsed Word, Markdown structure) are stored alongside, never in place of, the original. (Per `docs/product/project-requirements-brief.md` R-7 + `dev-memo/plan-brief-doc-reconcile.md` §4.3.)

---

## References

- `docs/adr/case-box-step-0-boundary.md` — case-box product boundary (companion to this document).
- `docs/adr/client-application-surface.md` — v1 primary client architecture.
- `docs/adr/sync-bridge-architecture.md` — opt-in companion HTTP surface.
- `docs/ui/sync-bridge-contract-draft.md` — bridge endpoint reference.
- `dev-memo/plan-client-00.md` — client surface reconciliation plan; D2 source.
- `dev-memo/superseded/case-box-plan.md` — pre-Phase-0 case-box plan (historical reference).
- `docs/ui/current-ui-map.md`, `docs/ui/ui-state-contract.md`, `docs/ui/ui-gap-report.md` — OCR-layer UI inventory.
- `docs/release/wi-03-security-signoff.md` — outbound HTTPS / SSRF / DNS-pinning sign-off.
- `docs/release/go-live-plan.md` — Stop-and-Ask gates, per-package test commands, autonomous choice policy.
- `AGENTS.md` — coordinator-ownership rule, mutation policy, Stop-and-Ask gates.
