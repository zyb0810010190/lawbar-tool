# ADR — Evidence-Genie A10: Court-Fileable Export & CanonicalExportModel (A10-DESIGN-00)

- **Status:** Accepted (design-only; cc-suite review-plan `review-plan-mqzdh645-b3593t` READY-WITH-LOW). **Authorizes no code, schema, migration, native, or export-render implementation.** Each A10 sub-WI in §13 is separately authorized.
- **Date:** 2026-06-29.
- **WI:** WI-EVIDENCE-A10-DESIGN-00 (Type: PLAN; docs/ADR-only).
- **Authoritative source:** `docs/reference/evidence-genie-m0-developer-handover.md` (tracked) §3 (A10 invariant), §"A10 — Export (court-fileable)", §"Data model" (CanonicalExportModel / ExportPreview / ExportCitationFlag), §"Two-layer export reproducibility", §"What not to do".
- **Composes under:** `AGENTS.md` §"Evidence-Genie M0 workflow composition" (layer 3) and `.claude/rules/evidence-genie.md` (invariants 1, 5, 7, 8, 9). Conflicts resolve in favor of the Evidence invariants.

This ADR **records and decides**; it enables no A10 behavior. It transcribes (does not invent) the handover's export data model and gives A8.6 restore-and-reproduce a precise target.

---

## 1. What A10 is

A10 is the **court-fileable export reproducibility** gate: a single, deterministic pipeline that turns the frozen case into court work-product whose **logical model is byte-identical** across display / re-export / restore. Per handover §3:

> **A10 — Court-fileable export reproducibility.** Every citation is rendered **solely from `DocumentPage`** through a single contract; the **canonical export model is byte-identical** across display/re-export/restore; in-app hyperlinks degrade to textual 卷X页Y **or** an explicit `ExportCitationFlag` (never dropped, never silently wrong); rendered `.docx`/PDF are deterministic only where controlled.

A10 comprises seven tickets (handover §A10), order **T1→T2→T3→T4→T5→T6→T7**:

| Ticket | Purpose | Verify harness | CI gate |
|---|---|---|---|
| A10-T1 | Citation-rendering contract — the **only** code producing citation strings; renders from `DocumentPage` (via A1); pins `citationFormatVersion` (syntax) + `exportTemplateVersion` (layout); owns the `ExportCitationFlag` enum | `citation-render-contract` (golden + static lint) | via T6 |
| A10-T2 | Hyperlink degradation — every in-app link → textual 卷X页Y **or** matching `ExportCitationFlag`; **bijection** link↔citation/flag; never dropped/silently-wrong | `hyperlink-degradation` | — |
| A10-T3 | Export 证据目录 (evidence index) — per-party 证N/对N, titles, citation ranges; non-citable/cross-volume flagged | `export-evidence-index` | — |
| A10-T4 | Export 举证质证表 — claim/element → our evidence → 证明对象 → citation; proof-gap per rule | `export-juzheng-table` | — |
| A10-T5 | Export 质证记录 — per-opposing 三性 + reasons + contradiction citations | `export-zhizheng-record` | — |
| A10-T6 | Golden canonical export — `CanonicalExportModel` byte-identical via deterministic serialization | `golden-export` | ✅ |
| A10-T7 | Export-preview hashing — write `ExportPreview` with `canonicalModelSha256` into the `SnapshotManifest`; verify-before-hearing; citation-map change invalidates the cached preview | `export-preview-hash` | — |

## 2. Why A10 now (honest build state)

A10 is the remaining **hard-invariant** architecture design target (A1/A3/A8/A10). It is **not** "the only unbuilt runtime gate": A0.7 is now meaningfully green (messy-fixture coverage merged) but its marker/custody is a separate WI; **A8 is design-only/decided, not implemented**; **A1 is PARTIAL** (citation persistence built, A1-T6 native gate `not_implemented`); **A3 is built** (persistence/IPC/UI) but its `a3-regression` native gate is `not_implemented`; **A10 itself is SPEC-ONLY** (no `CanonicalExportModel` type; only the A3 precursor `ExportCitationResult` + the BUILT A3-EXPORT-00 degradation contract). A10 is designed now because **A8.6 restore-and-reproduce cannot close until A10-T1 (contract) + A10-T6 (golden `CanonicalExportModel`) exist** (A8 ADR §6/§8); deciding the canonical export model unblocks A8's capstone.

## 3. What A10 must NOT do

- **MUST NOT** hash raw `.docx`/PDF bytes by default (handover §"what not to do"); reproducibility is measured against the `CanonicalExportModel`; canonicalized/normalized artifact hashing only where the renderer is controlled (`evidence-genie.md` invariant 9).
- **MUST NOT** let any export module format citations independently — A10-T1 is the **single** citation-string source; a static lint enforces it.
- **MUST NOT** drop a link→citation mapping or render one silently wrong — degradation is **total + bijective** (every in-app link yields exactly one export-citation object; a missing page/geometry/anchor yields a deterministic flagged object, never a silent omission) (A3-EXPORT-00; INV-A3-9).
- **MUST NOT** derive citations from anything but `DocumentPage` (never page-index arithmetic, never an `OptimizedDocumentRendition`) (A1; invariants 1, 7).
- **MUST NOT** weaken A8 manifest/seal anti-circularity — the `ExportPreview.canonicalModelSha256` is a manifest input over the deterministic logical model, not the encrypted DB.
- **MUST NOT** invent the 证据目录/举证质证表/质证记录 form-field layouts (see §10 — deferred behind a product/legal form-spec).
- **MUST NOT** introduce network/cloud/auth — local-first/offline.

## 4. CanonicalExportModel (transcribed from the handover — NOT invented)

```
CanonicalExportModel { exportType, citationFormatVersion, exportTemplateVersion,
  rows[], citations[], linkDegradations[], flags:[ExportCitationFlag],
  warnings[], sourceObjectIds[], generatedFromSnapshotId? }
// canonicalModelSha256 = SHA-256 of a deterministic serialization
ExportPreview { id, snapshotId, exportType, citationFormatVersion, exportTemplateVersion,
  canonicalModelSha256, renderedArtifactSha256?, canonicalizedArtifactSha256?, warningSetSha256, createdAt }
```

**`canonicalModelSha256` determinism rule (verbatim intent):** SHA-256 of a deterministic serialization with **stable key/row order, normalized Unicode/whitespace, no timestamps unless court-facing, no machine paths/renderer metadata**. This is the reproducibility unit — byte-identical across display, re-export, and restore on another Mac.

The A10 implementation **owns** this type (A10-T1/T6). This ADR does not define its serializer, fixture format, or field-level encoding beyond the transcription above — those are A10-T1/T6 implementation decisions, reviewed under the security/persistence loop.

## 5. Layering — canonical model vs rendered artifact vs bundle vs filing package

- **CanonicalExportModel** — the deterministic **logical** model (the reproducibility layer; byte-identical via serialization). The thing A8.6 reproduces and A10-T6 golden-tests.
- **Rendered artifact** (`.docx`/PDF) — a derived view; deterministic **only where the renderer is controlled** (normalize volatile metadata or hash a canonicalized representation; never raw bytes by default). `renderedArtifactSha256?`/`canonicalizedArtifactSha256?` are optional, controlled-renderer-only.
- **Exhibit bundle / export bundle** — A8.4's packaged snapshot+manifest (AES-GCM, user passphrase); A10 produces the `ExportPreview` entries the manifest seals, but the bundle is A8's concern.
- **Court filing package** — the human-facing deliverable (证据目录 + 举证质证表 + 质证记录 rendered for a specific court). Its **form-field layout is OUT OF SCOPE here** (§10).

## 6. Citation, anchor, and degradation representation

- **Citations (A10-T1):** rendered solely from `DocumentPage` (`documentId + physicalPageIndex → citationVolume + citationPageLabel`), single contract, `citationFormatVersion` + `exportTemplateVersion` pinned. Text form 卷X页Y (§7 jurisdiction assumption). The model carries structured `citationVolume`/`citationPageLabel` plus the rendered `text` (as the BUILT `ExportCitation` already does).
- **Anchors/links:** represented via their resolved `case_box_links.status` (the single source of trust — the export MUST run `resolveLinkStatuses` in scope immediately before export and MUST NOT compute its own status), preserving INV-A3-1..A3-10 (DocumentPage identity, geometry-version pinning, page-ratio, fail-closed `needs_review`, explicit `broken`).
- **Degradation (A10-T2):** total + bijective. Every link → a clean 卷X页Y citation **or** exactly one `ExportCitationFlag`.

**ExportCitationFlag — reconciliation (review-plan Low #3).** Two flag sets exist and MUST be reconciled by A10-T1, not silently merged:
- **Built reality** (`exportCitationQueries.ts` A3 precursor): `NEEDS_REVIEW | BROKEN | NON_CITABLE | AMBIGUOUS | UNLINKED` — where **`UNLINKED`** reflects the V12 durable `unlinked_at` marker (highest precedence, distinct from `BROKEN`).
- **Handover spec**: `引用待核_NEEDS_REVIEW | 引用缺失_BROKEN | 不可引用_NON_CITABLE | 引用歧义_AMBIGUOUS | 文档已替换_REPLACED`.
- **Decision:** A10-T1 owns the canonical `ExportCitationFlag` enum and MUST (a) **retain `UNLINKED`** (it models real, shipped V12 lifecycle state — do not erase it), and (b) treat **`REPLACED` as spec-pending**: it is part of the handover contract but is **not implemented** and MUST NOT be emitted until document replacement lifecycle + status-reason support exists. A10-T1 records the localized (中文_ENGLISH) labels. This divergence is logged as a deferred reconciliation, not resolved by fiat here.

## 7. Determinism, IDs, timestamps, locale, formatting

Governed by the `canonicalModelSha256` rule (§4): stable key/row order (sorted, not insertion order), Unicode/whitespace normalization, **no timestamps unless court-facing**, no machine paths, no renderer metadata. Stable IDs come from persisted object ids (`sourceObjectIds[]`, `generatedFromSnapshotId?`), never ephemeral. **Locale/jurisdiction assumption (review-plan Low — recorded, not silently chosen):** Evidence-Genie M0 targets the **Chinese court system** (the handover commits to 卷X页Y / 三性 / 证据目录 / 举证质证表 / 质证记录 and the local-first single-lawyer posture). This is a **recorded assumption**; multi-jurisdiction / court-format variation (per-province layout, seal placement, font-metric embedding) is a **separate future decision**, not in scope.

## 8. Reproducibility verification + how A10 feeds A8.6

- **A10-T6 (`golden-export`, CI gate):** the `CanonicalExportModel` is compared **byte-for-byte** against golden fixtures via deterministic serialization (canonicalized artifact where available; raw bytes only for controlled deterministic renderers).
- **A10-T7 (`export-preview-hash`):** writes `ExportPreview { canonicalModelSha256, … }` into the `SnapshotManifest.exportPreviews[]`; verify-before-hearing includes it; a citation-map change invalidates the cached preview.
- **Feed to A8.6:** A8.6 "reproduce byte-identical canonical model" **is** A10-T6 (`golden-export`); citations reproduced = A1-T6; anchors reproduced = A3-T10. A10 **owns** `CanonicalExportModel`; A8 only consumes it (A8 ADR §6/§8). A10-T6 must therefore exist before A8.6 can close.

## 9. Schema / native / UI impact (all LATER; none in this lane)

- **Schema:** future persistence of `ExportPreview` rows + canonical-model references is likely; **none in this lane**; `CURRENT_SCHEMA_VERSION` stays 12. A schema change is a future A10/A8 persistence WI under the security/persistence loop.
- **Native / Swift:** the `golden-export` harness (A10-T6) joins the `native/evidence-core` harness surface (currently `not_implemented`); controlled-renderer `.docx`/PDF determinism may need native/render work. **None here.**
- **Renderer UI:** export/preview UI is **Phase B (SwiftUI)** product work, a separate UI-design-artifact lane. **None here.**

## 10. Deferred + out-of-scope (explicit)

- **A10-T3/T4/T5 court work-product FORMS (证据目录 / 举证质证表 / 质证记录):** the handover specifies these at **epic level only, not ticket/field depth**. Their field layouts, citation-injection points, proof-gap rule, 三性 structure, and court-format specifics require a **product/legal form-field spec**. This ADR designs the canonical-model **envelope + citation/degradation contract** they will populate, but **A10-T3/T4/T5 MUST NOT be implemented or accepted until that form-field spec is resolved** (review-plan Low #2). Designing their fields here would be invention (non-scope).
- **Court-format / jurisdiction / multi-court / cloud / auth / China-filing / PIPL / local-first reconciliation:** **not blockers and not in scope** for the A10 core — the Chinese-court single-lawyer local-first posture is recorded (§7). (A network-transported filing would be a separate hard-stop ADR.)
- **Implementation of any A10 code/export/render/CanonicalExportModel:** out of scope; each is a downstream governed WI (§13).

## 11. Invariant & threat-model summary

Threats A10 defends: (a) **non-reproducible export** → byte-identical `CanonicalExportModel` (A10-T6) + `ExportPreview` hashing (A10-T7); (b) **silent citation loss/error** → single A10-T1 contract + total+bijective degradation (A10-T2) + static lint; (c) **citation drift from non-canonical source** → citations only from `DocumentPage`; (d) **renderer non-determinism** → canonical-model-not-raw-bytes (controlled-renderer-only artifact hashing); (e) **post-freeze export tampering** → `ExportPreview` sealed in the manifest, verify-before-hearing. Invariants preserved: A1 citation-from-DocumentPage; INV-A3-1..A3-10 (incl. fail-closed `needs_review`, explicit `broken`, total+bijective degradation); A8 manifest/seal anti-circularity + canonical-not-raw-bytes (invariant 9); local-first offline.

## 12. Dependency / sequencing summary (A0.7 / A1 / A3 / A8)

- **A0.7:** meaningfully green (messy fixtures merged); A10 geometry-derived citations rest on it. (Marker/custody = separate WI.)
- **A1:** PARTIAL — citation persistence built; **A1-T6** `citation-stability-gate` (`not_implemented`) feeds A8.6, and A10-T1 must preserve A1 citation identity.
- **A3:** built; **A3-T10** `a3-regression` (`not_implemented`) feeds A8.6; A10 consumes resolved link status (INV-A3-1..10).
- **A8:** decided (design); **A8.6 hard-blocks on A10-T1 + A10-T6**. A10 gives it the target; A10 does not implement A8.
- A10 implementation builds on the **BUILT** A3-EXPORT-00 degradation contract + `ExportCitationResult`; the **`golden-export` native harness is `not_implemented`** (a prerequisite for A10-T6).

## 13. Implementation WI sequence (each separately authorized; none authorized by this ADR)

1. **WI-A10-T1-CITATION-CONTRACT** — single citation-render contract from `DocumentPage`; pin `citationFormatVersion` + `exportTemplateVersion`; own + reconcile the `ExportCitationFlag` enum (retain `UNLINKED`; `REPLACED` spec-pending). Gate: `citation-render-contract` (golden + static lint). *Stop-point: must not erase `UNLINKED` or emit unimplemented `REPLACED`.*
2. **WI-A10-T2-HYPERLINK-DEGRADATION** — link → 卷X页Y or flag, total+bijective; runs `resolveLinkStatuses` before export. Gate: `hyperlink-degradation`.
3. **WI-A10-T3/T4/T5-FORMS** — **BLOCKED** until a product/legal form-field spec exists (§10). Gates: `export-evidence-index` / `export-juzheng-table` / `export-zhizheng-record`. *Stop-point: form-field spec + court-format decision required first.*
4. **WI-A10-T6-GOLDEN-EXPORT** — `CanonicalExportModel` byte-identical golden; build the `golden-export` native harness. Gate: `golden-export` (CI). *Stop-point: deterministic-serialization rule must hold; raw-byte hashing forbidden by default.*
5. **WI-A10-T7-EXPORT-PREVIEW-HASH** — `ExportPreview.canonicalModelSha256` into `SnapshotManifest`; verify-before-hearing; map-change invalidation. Gate: `export-preview-hash`. *(Composes with A8.3/A8.6.)*

Prerequisites for A8.6 closure (not for A10 design): A10-T1 + A10-T6 green, plus A1-T6 + A3-T10 native gates.

## 14. Acceptance tests A10 must prove (handover verify harnesses)

`citation-render-contract` (single source + golden + static lint) · `hyperlink-degradation` (total+bijective) · `export-evidence-index` / `export-juzheng-table` / `export-zhizheng-record` (golden; **blocked on form-spec**) · `golden-export` **CI** (CanonicalExportModel byte-identical) · `export-preview-hash` (across freeze/restore + citation-map change). A `not_implemented` harness is a FAIL, never a pass.

## 15. Per-lane stop-points (carried into the WIs)

- A10-T3/T4/T5 without a resolved product/legal form-field spec → **STOP**.
- Any raw-byte `.docx`/PDF hashing by default → **STOP** (canonical-model only).
- Any second citation-formatting code path (bypassing A10-T1) → **STOP**.
- Any dropped/silently-wrong citation (degradation not total+bijective) → **STOP**.
- Erasing `UNLINKED` or emitting unimplemented `REPLACED` → **STOP**.
- Citations/anchors derived from anything but `DocumentPage` / resolved link status → **STOP**.
- Any weakening of A0.7/A1/A3/A8 invariants, or any network/cloud surface → **STOP** (surface, never silently choose).

## 16. References
- `docs/reference/evidence-genie-m0-developer-handover.md` (tracked) §3, §A10, §Data model, §Two-layer reproducibility, §What not to do.
- `docs/adr/ADR-evidence-a3-export-degradation.md` (A3-EXPORT-00 — degradation precedence A10-T2 builds on).
- `docs/adr/ADR-evidence-a3-anchor-link-contract.md` (INV-A3-1..A3-10).
- `docs/adr/ADR-evidence-a8-snapshot-integrity-confidentiality.md` (A8.6 → A10-T6 dependency; ExportPreview/manifest tie-in).
- `services/case-box-persistence/src/sqlite/exportCitationQueries.ts` (`ExportCitationResult` A3 precursor; `UNLINKED` flag; 卷X页Y).
- `native/evidence-core/lib/commands.mjs` (`golden-export` currently `not_implemented`).
- `.claude/rules/evidence-genie.md` (invariants 1/5/7/8/9), `.claude/rules/{client-local-first,security-boundary,autonomy,cc-suite}.md`.
