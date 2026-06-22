# Evidence-Genie M0 — Product Requirements Document (PRD)

## 1. Status / scope boundary
**Official product-definition document** for Evidence-Genie M0. **It is NOT implementation authorization.**
It defines *what the product should say and do*; building it is gated by the governed engineering lanes.
**Every UI / anchor / export behavior described here is gated behind A0.7** (the renderer/geometry
conformance gate). A0.7 is not green and the harness shim's `renderer-conformance` returns
`not_implemented` (a failure); **this PRD makes no A0.7-green claim and defines no A0.7 marker.** Sources:
`docs/reference/evidence-genie-m0-developer-handover.md`,
`dev-memo/plan-batch-casebox-evidence-product-definition-00.md` (EPD1),
`docs/adr/ADR-evidence-m0-xiaolai-workflow-composition.md` (EVW-00), `.claude/rules/evidence-genie.md`,
`AGENTS.md`, `.claude/rules/client-local-first.md`.

## 2. Problem statement
A single lawyer preparing for and conducting a Chinese court hearing must work from both sides' paginated
evidence PDFs, build structured work-product (证据目录 / 举证质证表 / 质证记录) by hand, cite precisely by
证据号 and 卷X页Y, and — in an air-gapped courtroom — instantly navigate to a pre-marked page/region and
restate the excerpt. Today this is manual, error-prone, and hard to keep citation-stable across
close/reopen/export, with no reliable freeze/snapshot for a defensible, reproducible bundle. Evidence-Genie
M0 is the **human-verifiable manual substrate** that makes evidence navigation, citation, freezing, and
export reliable — offline, on the lawyer's own Mac.

## 3. Target user / environment
- **User:** a single lawyer (or law-firm staff) working one matter at a time. No multi-user, no firm-portal.
- **Environment:** **macOS desktop**, **local-first / offline**, **air-gapped-capable** (hearings run on a
  counsel-controlled Mac with no network). Confidential legal material **never leaves the Mac** unless the
  lawyer takes a deliberate action. The offline guarantee is OS-enforced (App Sandbox, no network
  entitlements), not convention.

## 4. M0 in-scope
- Import **both sides' paginated PDFs** with 证据目录; set the canonical original.
- **Manual page/region linking** — the lawyer draws a hyperlink to a target page/region (anchor).
- Navigation/citation vocabulary: **证据目录 / 证据号 / 卷X页Y**, navigation by physical page + drawn rect.
- **Hearing lookup** by 证据号, by page, and by anchored region.
- **Freeze → snapshot → backup/restore** (point-in-time, read-only, verifiable, confidential bundle).
- **Export** with reproducible **卷页** citations (court-fileable 证据目录 / 举证质证表 / 质证记录).
- **Readable compression** as a **quality gate** (size reduction that never alters citation/geometry/page
  count/anchor behavior/readability; the original is always retained + hashed).

*(All §4 behaviors are gated behind A0.7.)*

## 5. M0 out-of-scope
OCR · AI/VLM · cloud / public deployment / sync-by-default · auth / multi-user / multi-firm SaaS · external
database services · evidence-weight scoring/ranking · cross-case templates beyond the manual forms ·
non-Mac platforms (Windows / iPad / mobile / browser).

## 6. Product promises / invariants (must hold; never weakened)
- **Citation identity from `DocumentPage` only** — every citation derives solely from `DocumentPage`
  (`documentId + physicalPageIndex → citationVolume + citationPageLabel`), byte-stable across
  close/reopen/export; ambiguity is refused+warned, never guessed.
- **Anchor resolution only on stable page identity + geometry** — anchors are page-ratio against persisted
  geometry (box origin subtracted, rotation-aware, version-pinned), never screen/viewport pixels; a
  mismatch yields `needs_review`, never a stale location.
- **Optimized rendition is never canonical** — an `OptimizedDocumentRendition` is display convenience only,
  never a citation/anchor/export basis.
- **Snapshot integrity & confidentiality** — a frozen snapshot is immutable, tamper-evident
  (manifest + separate seal, anti-circular), restorable byte-identically on another counsel Mac, and opened
  only with the user-held passphrase.
- **Reproducible export model** — citations render through a single contract; the `CanonicalExportModel` is
  byte-identical across display/re-export/restore (not raw `.docx`/PDF bytes by default).
- **`not_implemented` fails** — any unimplemented harness/behavior is a failure, never a pass.
- **No A0.7-green claim** — this product is not "ready" until A0.7 is genuinely green; this PRD asserts no
  such state.

## 7. A0.7-first dependency
**A0.7 `renderer-conformance` is the first real Evidence architecture gate** — it validates PDFKit
coordinate fidelity + page-identity stability on real messy 卷宗, classifying each failure class-1
(normalization, fixable) vs class-2 (geometry-source instability, architectural stop). The current
`native/evidence-core` shim returns **`not_implemented`** for `renderer-conformance` (and all gates). **No
Evidence UI ships before A0.7 is green.** Nothing in §4/§8 is buildable until A0.7 passes; a class-2 result
reopens the geometry-source assumption before any anchor/forms/UI work.

## 8. Success criteria
- The lawyer can **assemble and freeze a reliable M0 evidence bundle** (both sides' PDFs, 证据目录, anchors)
  that verifies and restores byte-identically.
- The lawyer can **navigate during the hearing** by 证据号 / 卷X页Y / anchored region, offline.
- **Exported materials preserve citations reproducibly** (canonical export model byte-identical;
  links degrade to text or an explicit flag, never dropped/silently wrong).
- The system **remains local/offline** and does not leak confidential material; the original is always
  retained and hashed; only verified renditions enter hearing mode or bundles.

*(Each success criterion is realized only after A0.7 is green; here they are acceptance intent, not a claim
of working behavior.)*

## 9. Non-goals / hard stops (require separate authorization)
- **Swift / SwiftPM / PDFKit native core** and **macOS CI** — new runtime/toolchain; explicit authorization.
- **Real A0.7 harness** — a separate governed engineering lane (the marker is produced only by that real
  harness, never hand-authored).
- **Hard hooks** (no-UI-before-A0.7, citation-single-source, optimized-never-canonical, snapshot
  anti-circularity, offline-entitlement) — deferred until the real surfaces + marker provenance exist.
- No OCR / AI-VLM / cloud / auth / network behavior is introduced by this product definition.

## 10. Follow-up docs
- `docs/product/evidence-m0-user-flows.md` (EPD3) — manual evidence + hearing workflows end-to-end.
- `docs/product/evidence-m0-content-inventory.md` (EPD4) — screen/content inventory + CN↔EN terminology.
- `docs/product/evidence-m0-acceptance-scenarios.md` (EPD5) — given/when/then acceptance, each A0.7-gated.
