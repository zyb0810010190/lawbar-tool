> Source/reference material for Evidence-Genie M0 product definition; not executable product scope. Faithful copy of the developer handover (the canonical M0 domain source).

# Evidence-Genie M0 — Developer Handover Package
*Derived from the authoritative source: **Evidence-Genie M0 — Consolidated Developer Handoff (v2)**. This package restates that source; it does not re-architect it. Where the source leaves something undecided, it is listed under §11, not resolved here.*

---

## 1. Executive handover summary
**What it is.** Evidence-Genie M0 is the human-verifiable manual substrate of Evidence-Genie: a local-first, fully-offline **macOS** case-preparation and courtroom tool. Both sides' evidence are paginated PDFs; the lawyer builds structured work-product forms by hand and manually draws hyperlinks to a target page/region. In the air-gapped hearing, the lawyer navigates by 证据号 or page and restates pre-marked excerpts.

**In scope:** offline navigation by physical page + drawn rect; both-sides paginated PDFs with 证据目录; manual forms; citation by 证据号/卷页; typed-metadata search; freeze→snapshot→backup/restore; export with 卷页 citations; readable file-size optimization.
**Out of scope (M0):** OCR; AI/VLM; external databases; evidence-weight scoring; cross-case templates; non-Mac platforms.
**Hard project gate:** M0 is valid **only if hearings run on counsel-controlled Macs**. There is no borrowed-Windows fallback.

**Build-readiness status.** The four hard invariants (citation identity, anchor resolution, snapshot integrity, court-fileable export) are specified at ticket depth (A1/A3/A8/A10) and are internally consistent. A5/A6/A9 are deliberately at epic level only — off the critical path. **The engine is specified enough to begin building.**

**⚠ Most important warning.** **A0.7 is the first reality gate and must be built first.** It is the only step that tests the riskiest real-world assumption — PDFKit coordinate fidelity and page-identity stability on messy 卷宗 — before anything is built on top of it. Treat any A0.7 failure as architectural feedback, not implementation noise (see §5).

---

## 2. Architecture summary
- **macOS-only stack.** Swift + SwiftUI/AppKit (UI, Phase B) · **PDFKit** (render + coordinates) · SQLite via **GRDB.swift** + **SQLCipher** (encryption at rest) · **CryptoKit** AES-256-GCM (bundle envelope) + a **pinned Argon2id** dependency (KDF) · **Keychain/Secure Enclave** (local DB key) · **App Sandbox with no network entitlements** (OS-enforced offline) · hardened runtime, Developer-ID signing, notarization, notarized `.dmg`.
- **Local-first / offline.** No network. The offline guarantee is enforced by the sandbox (absent network entitlements), not by convention.
- **Logic-first, UI-last.** A headless, UI-agnostic domain core (Phase A) is built and tested before any production UI (Phase B).
- **Manual truth vs future AI suggestion layer.** Lawyer-entered fields are authoritative and court-facing. Future machine output is a **build-flagged** suggestion layer (separate migration namespace; `Manual* ≠ Extracted*`), promoted into manual tables only by explicit lawyer review.
- **Canonical original vs optimized rendition.** The uploaded original is authoritative for anchors and citations. An `OptimizedDocumentRendition` is a display/size convenience usable only after geometry + anchor + readability verification; it **never** becomes the citation/anchor basis. *Readable compression, never destructive canonicalization.*
- **Navigation identity ≠ citation identity.** The app **navigates** by `physicalPageIndex`; it **cites/exports only from `DocumentPage`**. Invariant: `documentId + physicalPageIndex → citationVolume + citationPageLabel`, byte-stable across close/reopen/export.
- **Anchor geometry model.** Anchors are ratio-based against **persisted geometry**, pinned to the resolved box (cropBox→mediaBox fallback recorded), in PDF page space (lower-left origin, 72 dpi), **box origin subtracted**, never screen pixels. Each anchor names the geometry version (`geometryCapturedAt`) it was normalized against.
- **Snapshot manifest/seal model.** Freeze produces a point-in-time-consistent, read-only snapshot. A `SnapshotManifest` hashes every artifact; a **separate `SnapshotSeal`** makes the manifest tamper-evident (no circular self-hash). Bundles are confidential via a user-held passphrase independent of the local device key.
- **Two-layer export reproducibility.** The **canonical export model** (`CanonicalExportModel`) is byte-identical across display/re-export/restore via deterministic serialization. **Rendered `.docx`/PDF artifacts** are deterministic only where the renderer is controlled — normalize volatile metadata or hash a canonicalized representation, **never raw bytes by default**.

---

## 3. Hard invariants (restated, not weakened)
- **A1 — Citation identity.** Every citation is derived **solely from `DocumentPage`** (never page-index arithmetic, never an optimized rendition). `documentId + physicalPageIndex → citationVolume + citationPageLabel` is byte-stable across close/reopen/export. Duplicate citation labels are permitted; a citation that maps to >1 physical page in scope is **ambiguous** and must be disambiguated or refused+warned, never guessed.
- **A3 — Anchor resolution.** An anchor persisted from a PDFKit gesture resolves, after close/reopen/freeze, to the **same `documentId`, `physicalPageIndex`, persisted geometry version, and page-ratio rect — with no viewport coordinates involved.** Replacement or geometry-version mismatch yields `needs_review`, never a stale location.
- **A8 — Snapshot integrity & confidentiality.** A frozen snapshot is immutable, verifiable, and confidential: it contains no unresolved replacements; the manifest detects any post-freeze byte change and is itself tamper-evident via the seal; restored on any counsel Mac it reproduces the **byte-identical canonical export model** (and citations/anchors); the portable bundle is restorable **only with the user-held passphrase**, independent of the local device key.
- **A10 — Court-fileable export reproducibility.** Every citation is rendered **solely from `DocumentPage`** through a single contract; the **canonical export model is byte-identical** across display/re-export/restore; in-app hyperlinks degrade to textual 卷X页Y **or** an explicit `ExportCitationFlag` (never dropped, never silently wrong); rendered `.docx`/PDF are deterministic only where controlled.
- **A1-T9 — Readable compression.** Compression may reduce size but must not alter citation identity, page geometry, page count, anchor resolution, or practical readability. The original is preserved + hashed; an optimized rendition is a derived artifact that is **rejected** for hearing/export if it changes geometry/page count/box/anchor behavior or degrades readability of text, dates, amounts, seals, signatures, or handwriting.
- **A0.7 — Geometry-source stability classification.** The harness does not merely pass/fail; it **classifies** failures as either a local normalization bug (fixable inline) or geometry-source instability (architectural stop). Only the first class may be fixed while continuing the current architecture (see §5).

---

## 4. Build order
**First-commit sequence (start here):**
```
A0.1 Swift scaffold
→ A0.2 GRDB + SQLCipher
→ A0.4 headless harness
→ A1-T2 DocumentPage
→ A1-T0 geometry
→ A0.7 renderer/geometry harness
```
**Larger sequence:**
```
A3 (anchor engine) → A5 (forms) → A6 (search/coverage/synthesis)
→ A8 (freeze/manifest/crypto) → A10 (export) → A9 (audit/offline)
⇒ Phase B (SwiftUI + PDFKit UI)
⇒ Phase C (regressions + two-matter pilot)
⇒ Phase F (future AI seam, build-flagged)
```
A5, A6, A9 are not yet at ticket depth and are off the critical path.

---

## 5. A0.7 — first reality gate (classification gate, not a checkbox)
A0.7 loads representative real 卷宗 fixtures through the PDFKit adapter and verifies stable `physicalPageIndex`, correct resolved-box bounds (incl. mediaBox fallback and non-zero origin), rotation handling, byte-identical `ratio→page-space→ratio` round-trip, and correct rendered region. **It classifies every failure** rather than just flagging it:

- **Class 1 — Normalization bug → patch locally and continue.** Page identity and persisted geometry are stable, but a rect lands shifted, inverted, or scaled wrong on cropBox-offset, rotated, mixed-size, or non-zero-origin pages. *Examples:* box origin not subtracted; y-axis inversion; wrong rotation transform; ratio uses mediaBox while geometry says cropBox; viewport coordinate leaks into persistence. *Response:* fix **A3-T2** normalization/conversion math and re-run A0.7 — **no architecture reset.**
- **Class 2 — Geometry-source instability → stop and reassess.** The same unmodified file, reopened, yields unstable `physicalPageIndex`, page count, `resolvedBox`, bounds, rotation, or geometry hash. *Examples:* same page gets a different `physicalPageIndex` across opens; PDFKit reports different crop/media bounds across runs; rotation differs across reopen; persisted geometry not reproducible from the same original; page identity changes after a no-op import/reopen. *Response:* **stop downstream work — do not build A3/A5/UI on top.** Reassess the geometry-source assumption: PDF canonicalization at import, a different renderer, additional page fingerprinting, or binding anchors to a stronger page identity than `physicalPageIndex` alone.

*Verification:* `renderer-conformance` over real fixtures, emitting a per-failure classification. Permanent CI gate.

---

## 6. WI internal workflow
`Draft → Plan Review → Testing Gate Review → Ready for Execution → In Progress → Code Review → Verification → Done`. Test *design* is reviewed before code; test *execution* runs at the end. *(On a solo/small build, the review steps collapse to a logged self-review against the §6 checklist — distinct reviewer preferred, recorded review minimum.)*
**Cross-cutting rollback rule:** if at any state a new failure mode appears or the protected invariant / test assumptions change, the WI returns to **Plan Review or Testing Gate Review**.

1. **Draft** — *Purpose:* define before design. *Checks/contents:* title/ID, protected invariant, dependency tickets, touched modules/tables/files, acceptance criteria, expected regression home, known edge cases. *Exit:* specific enough for Plan Review. *Rollback:* (origin state).
2. **Plan Review** — *Purpose:* review the approach before test design. *Checks:* dependency order valid; no architectural principle violated; data-model changes explicit; migration impact known; failure modes named; no hidden UI dependency leaked into Phase A; no citation/anchor/snapshot/export/offline invariant weakened. *Exit:* approved. *Rollback:* back to Draft.
3. **Testing Gate Review** — *Purpose:* review the test design before execution. *Checks:* the 7 fields (§7) + the four-point approval standard (§7). *Exit:* test design approved. *Rollback:* back to Draft/Plan Review if the approach or invariant is unclear.
4. **Ready for Execution** — *Purpose:* implementation may begin. *Rule:* no code starts before this state, except throwaway spikes explicitly marked disposable. *Rollback:* per cross-cutting rule.
5. **In Progress** — *Purpose:* implement the smallest complete slice. *Checks:* code + the approved tests + fixtures + migrations (if schema changes) + docs (only if the behavior contract changed). *Exit:* slice complete. *Rollback:* if a new failure mode appears or the protected invariant changes, return to Plan Review or Testing Gate Review.
6. **Code Review** — *Purpose:* review implementation against the approved plan and tests. *Checks:* code matches the approved plan; tests match the approved gate; no invariant weakened; no unapproved dependency or UI leak; migration/rollback safe; errors explicit, not silent. *Exit:* approved. *Rollback:* changes requested → back to In Progress.
7. **Verification** — *Purpose:* execute proof, not intent. *Checks:* run the WI verification command; run affected permanent CI gates; attach output/logs; **classify failures where applicable (esp. A0.7)**; confirm regression placement. *Exit:* green. *Rollback:* back to In Progress / Testing Gate Review.
8. **Done** — *Purpose:* close only with proof. *Checks:* acceptance criteria met; verification passed; regression committed (or one-off rationale recorded); review complete; no unresolved invariant risk.

**Per-WI checklist:** `[ ]` invariant named · `[ ]` dependencies checked · `[ ]` plan reviewed · `[ ]` testing gate reviewed · `[ ]` negative case included · `[ ]` verification command concrete · `[ ]` regression home specified · `[ ]` implementation complete · `[ ]` code reviewed · `[ ]` verification output attached · `[ ]` CI gates green or unaffected · `[ ]` done criteria met.

---

## 7. Testing Gate process
**Seven required fields:** 1) behavior/invariant protected; 2) test level(s); 3) fixtures; 4) positive cases; 5) negative/edge cases; 6) regression placement; 7) verification command/procedure.
**Four-point approval standard (gate to Ready for Execution):** the reviewer confirms (a) the protected invariant is **named**; (b) at least **one negative case** exists; (c) the **verification command/procedure is concrete**; (d) the **regression destination is specified or explicitly marked one-off**.

---

## 8. Permanent CI gates (what each protects)
- **A0.7 renderer/geometry round-trip** — coordinate fidelity + page-identity stability on real, messy PDFs (with per-failure classification).
- **A1-T6 citation stability** — citations byte-identical across close/reopen/export and derived only from `DocumentPage`.
- **A3-T2 / A3-T3 coordinate conformance** — page-ratio normalization (box-origin/rotation correct) and renderer conformance.
- **A3-T10 anchor-resolution regression** — anchors round-trip end-to-end identically, incl. quarantine/replacement scenarios.
- **A8.3 snapshot verification** — any post-freeze byte change is detected; the seal makes the manifest tamper-evident.
- **A10-T6 golden canonical export** — the `CanonicalExportModel` is byte-identical against golden fixtures (and canonicalized artifact where available); raw bytes only for deterministic renderers under controlled settings.
- **A1-T9 compression readability** — optimized renditions preserve geometry/citation/anchor/readability; composes the gates above.

---

## 9. Ticket-pack summary (dependencies + verify commands preserved)

### A0.7 — Renderer/Geometry Harness *(first reality gate)* — depends: A0.2, A0.4, A1-T2, A1-T0
Classification gate (§5). *Verify:* `renderer-conformance` (per-failure classification). **CI gate.**

### A1 — Page identity & citation map *(T0→T2→T3→T5→T6→T7→T8→T1→T4→T9)*
- **A1-T0** Geometry capture · *coordinate source-of-truth* · persist resolved box/bounds/rotation; record cropBox→mediaBox fallback; immutable for `canonical`. *Verify:* `geometry-roundtrip`.
- **A1-T2** DocumentPage schema · *citation identity* · `UNIQUE(documentId, physicalPageIndex)`; labels non-unique; `isCitable`. *Verify:* `migrate+assert-constraints`.
- **A1-T3** Index↔label rules · *citation identity* · deterministic map; per-volume reset/overrides/non-citable/sort key. *Verify:* `rules-apply` diff.
- **A1-T5** Citation generator · *citation identity* · 卷X页Y only from DocumentPage; ambiguity→disambiguate or refuse+warn. *Verify:* golden diff.
- **A1-T6** Citation-stability gate · *citation identity* · byte-identical across close/reopen/export; only from DocumentPage. **CI gate.** *Verify:* `citation-stability-gate`.
- **A1-T7** Replacement quarantine · *stale-reference safety* · `canonical→replaced_pending_review→superseded`; links `needs_review`. *Verify:* `quarantine-transitions`.
- **A1-T8** Freeze-blocking · *snapshot integrity* · block freeze on `needs_review`; acknowledged-`broken` allowed + audited. *Verify:* `freeze-gate`.
- **A1-T1** Import model · *canonical lock* · import, party, set canonical, trigger T0/T2. *Verify:* `import-fixtures`.
- **A1-T4** Evidence range validation · *citation identity* · resolve to DocumentPage; flag non-citable/cross-volume; reject start>end. *Verify:* `evidence-range-validation`.
- **A1-T9** Readable compression · depends A1-T0/T2/T6, A3-T2 · preserve+hash original; derived rendition; any geometry/page/box change→rejected. *Verify:* `compress-readability-fixtures`→`geometry-roundtrip`→`citation-stability-gate`→`snapshot-verify`.

### A3 — Anchor / link engine *(T2→T1→T5→T6→T7→T4→T8→T9→T3→T10)*
- **A3-T2** page_ratio normalization · *coordinate stability* · ratios vs persisted box; **subtract box origin**; rotation-aware; anchor's geometry version only. **CI gate.** *Verify:* `coordinate-roundtrip`.
- **A3-T1** Anchor schema · FKs to DocumentPage + geometry version; ratios only. *Verify:* schema asserts.
- **A3-T5** Follow-link resolver · headless tuple; **quarantine-aware** (replaced/version mismatch→`needs_review`); `broken`→error. *Verify:* `resolve-links`.
- **A3-T6** Mutation/cascade · move re-normalizes same version; delete cascades **per rule** (undecided — see §11); audited. *Verify:* `anchor-mutation`.
- **A3-T7** Integrity checker · out-of-range/orphan/`needs_review`/`broken`/geometry-version mismatch. *Verify:* `integrity-scan`.
- **A3-T4** Source registry · valid source types; existing-source ref; delete cascades. *Verify:* `source-registry`.
- **A3-T8** Coverage-gap query · sources w/ no valid link. *Verify:* `coverage-gap`.
- **A3-T9** Link manager query · filter/sort; perf budget. *Verify:* `link-query`.
- **A3-T3** Renderer conformance · stable index, box bounds (+fallback, non-zero origin), rotation, round-trips. **CI gate.** *Verify:* `renderer-conformance`.
- **A3-T10** Regression suite · reopen/freeze identical; quarantine scenarios. **CI gate.** *Verify:* `a3-regression`.

### A8 — Freeze / backup / restore *(T2→T3→T5→T4→T6→T7→T1)*
- **A8.2** Freeze service · **SQLite Online Backup API by default** (`VACUUM INTO` only as explicit compaction); enforce A1.8 gate; atomic; audited. *Verify:* `freeze-service`.
- **A8.3** Manifest + seal · SHA-256 over files(role)/logical SQLite payload/citation map/anchor set/export previews/optimized renditions; separate `SnapshotSeal`; **verify-before-hearing**; newer-app open **read-only, no migration**. **CI gate.** *Verify:* `snapshot-verify`.
- **A8.5** Two-key encryption · `LocalDatabaseKey` (Keychain/Secure-Enclave) vs `BundlePassphrase` (never stored, zeroized) → **pinned Argon2id** (OWASP floor 19 MiB/2/1 minimum) → **AES-256-GCM**; forgotten passphrase = unrecoverable. **CI gate.** *Verify:* `two-key-crypto`.
- **A8.4** Export bundle · package snapshot+manifest; AES-GCM; refuse unfrozen; no partial. *Verify:* `export-bundle`.
- **A8.6** Restore on second Mac · decrypt→verify manifest→read-only; reproduce byte-identical canonical model (A10-T6), citations (A1-T6), anchors (A3-T10); fresh `LocalDatabaseKey`. *Verify:* `restore-and-reproduce`.
- **A8.7** Snapshot versioning · keep last N; never overwrite; audited pruning. *Verify:* `snapshot-versioning`.
- **A8.1** Autosave + crash recovery · atomic/WAL; recover last consistent state. *Verify:* `autosave-recovery`.

### A10 — Export (court-fileable) *(T1→T2→T3→T4→T5→T6→T7)*
- **A10-T1** Citation rendering contract · the **only** code producing citation strings; renders from `DocumentPage` via A1-T5; pins `citationFormatVersion` (syntax) **and** `exportTemplateVersion` (layout); `ExportCitationFlag` enum is part of the contract. *Verify:* `citation-render-contract` golden + static lint.
- **A10-T2** Hyperlink degradation · every in-app link → textual 卷X页Y **or** the matching `ExportCitationFlag`; **bijection** link↔citation/flag; never dropped/silently wrong. *Verify:* `hyperlink-degradation` bijection test.
- **A10-T3** Export 证据目录 · per-party 证N/对N, titles, citation ranges via contract; non-citable/cross-volume flagged. *Verify:* `export-evidence-index` golden.
- **A10-T4** Export 举证质证表 · claim/element→our evidence→证明对象→citation; proof-gap per rule. *Verify:* `export-juzheng-table` golden.
- **A10-T5** Export 质证记录 · per-opposing 三性 + reasons + contradiction citations; quarantined contradiction flagged. *Verify:* `export-zhizheng-record` golden.
- **A10-T6** Golden canonical export fixtures · compare `CanonicalExportModel` byte-for-byte (deterministic serialization); canonicalized artifact where available; raw bytes only for deterministic renderers. **CI gate.** *Verify:* `golden-export` (canonical + canonicalized).
- **A10-T7** Export preview hashing · write `ExportPreview` with `canonicalModelSha256` into the manifest; verify-before-hearing includes it; citation-map change invalidates the cached preview. *Verify:* `export-preview-hash` across freeze/restore + map-change.

---

## 10. Data model handover (grouped by purpose)
**Case / document / page identity**
```
Case          { id, caseNo, cause, parties[], court }
Document      { id, caseId, party:原告|被告|法院, pdfPath, pageCount, status:DocumentStatus, importedAt }
DocumentStatus= canonical | replaced_pending_review | superseded
DocumentPage  { id, documentId, physicalPageIndex, citationVolume?, citationPageLabel,
                citationPageSortKey?, isCitable, note? }   UNIQUE(documentId, physicalPageIndex)
```
**Geometry**
```
DocumentPageGeometry { documentId, physicalPageIndex, resolvedBox:"cropBox"|"mediaBox",
                boundsX, boundsY, boundsWidth, boundsHeight, rotation, pdfKitVersion?, capturedAt }
                UNIQUE(documentId, physicalPageIndex)  FK→DocumentPage   // capturedAt = geometry version
```
**Evidence / citation (+ work-product forms)**
```
Evidence      { id, caseId, party, evidenceNo, title, physicalPageStart, physicalPageEnd,
                citationStartCached?, citationEndCached?, citationCacheGeneratedAt?, citationCacheSourceHash?, note }
                // authoritative = physicalPageStart/End + DocumentPage; cache invalidated when map hash changes
Claim / ClaimElement / EvidenceUse(relation:证明|反驳|计算依据, sanxing?) / Note / Bookmark / Question / Calculation / Tag
```
**Anchors / links**
```
Anchor        { id, documentId, physicalPageIndex, geometryCapturedAt, rect(page_ratio), label? }
                FK→DocumentPage  FK→DocumentPageGeometry(version)
Link          { id, sourceType:evidence|note|question|calcTerm|claimElement, sourceId, anchorId, status:LinkStatus }
LinkStatus    = valid | needs_review | broken
rect = { x, y, width, height, coordinateSpace:"page_ratio", originRef:"DocumentPageGeometry", pageRotation }
```
**Export**
```
ExportCitationFlag = 引用待核_NEEDS_REVIEW | 引用缺失_BROKEN | 不可引用_NON_CITABLE | 引用歧义_AMBIGUOUS | 文档已替换_REPLACED
CanonicalExportModel { exportType, citationFormatVersion, exportTemplateVersion,
                rows[], citations[], linkDegradations[], flags:[ExportCitationFlag],
                warnings[], sourceObjectIds[], generatedFromSnapshotId? }
                // canonicalModelSha256 = SHA-256 of a deterministic serialization (stable key/row order,
                //   normalized Unicode/whitespace, no timestamps unless court-facing, no machine paths/renderer metadata)
ExportPreview { id, snapshotId, exportType, citationFormatVersion, exportTemplateVersion,
                canonicalModelSha256, renderedArtifactSha256?, canonicalizedArtifactSha256?, warningSetSha256, createdAt }
```
**Snapshot**
```
SnapshotManifest { snapshotId, createdAt, appVersion, schemaVersion,
                files:[{ path, sha256, role:original|optimized|exportPreview }],
                sqlitePayloadSha256, citationMapSha256, anchorSetSha256, acknowledgedBrokenLinksSha256?,
                exportPreviews:[ExportPreview.canonicalModelSha256 …],
                optimizedRenditions:[{ documentId, sourceDocumentSha256, optimizedSha256,
                  compressionProfile, readabilityVerified, geometryVerified, anchorRoundTripVerified }] }
SnapshotSeal  { snapshotId, manifestSha256, sealedAt, sealedByAppVersion,
                sealMethod:local_sqlcipher_hmac | bundle_aes_gcm }
Snapshot      { id, caseId, createdAt, path }
```
**Audit / activity**
```
AuditEntry    { id, caseId, action, target, at }     // immutable forensic
ActivityEvent { id, caseId, kind, summary, at }      // user-facing, compactable
```
**Compression**
```
OptimizedDocumentRendition { id, documentId, sourceDocumentSha256, optimizedPath, optimizedSha256,
                compressionProfile, originalBytes, optimizedBytes, reductionRatio,
                pageCountVerified, geometryVerified, anchorRoundTripVerified, readabilityVerified,
                createdAt, status:valid|rejected|needs_review, rejectionReason? }
```
**🔑 Anti-circularity rule (do not break):** `sqlitePayloadSha256` hashes a deterministic **logical** payload, **not** the encrypted DB file that holds the seal; live DB integrity is `PRAGMA cipher_integrity_check`. The `SnapshotSeal` lives in the SQLCipher DB (local) or inside the AES-GCM envelope (bundle); `sealedByAppVersion` lets a newer-app read-only open distinguish a known-older seal from an unknown/malformed one.

---

## 11. Open decisions / parked items
- **Argon2id cost calibration** against the slowest counsel Mac (OWASP floor 19 MiB / 2 iterations / parallelism 1 is the **minimum**, not the target; calibrate upward). Pair with an enforced passphrase-strength floor.
- **Anchor-delete cascade rule (A3-T6):** `broken`-with-audit vs hard-delete. The source specifies "delete cascades **per rule**" but leaves the rule itself undecided. *(Not resolved here; the source does not decide it.)*
- **Whether A5 / A6 / A9 need ticket depth** — for project-management tracking rather than architecture. They are off the critical path; expanding them is optional.

---

## 12. What not to do
- **Do not start any UI before A0.7 is green.**
- **Do not treat an `OptimizedDocumentRendition` as a citation or anchor source** — the canonical original is authoritative.
- **Do not hash raw `.docx`/PDF bytes by default** — compare the canonical export model; use canonicalized/normalized artifact hashing only where the renderer is controlled.
- **Do not let any export module format citations independently** — the A10-T1 contract is the single source; a static lint enforces this.
- **Do not silently compress evidence** — show sizes/ratio/check results; only verified renditions enter hearing mode or bundles; the original is always retained and hashed.
- **Do not proceed after a class-2 A0.7 instability** — stop and reassess the geometry-source assumption.
- **Do not migrate frozen snapshots in place** — a newer app opens them read-only; any migration runs on a copy and re-manifests.

---

## 13. Immediate next action
Build **A0.1 → A0.2 → A0.4 → A1-T2 → A1-T0**, then **run A0.7 (`renderer-conformance`) on real, messy 卷宗 fixtures** — stamped scans, rotated pages, cropBox/mediaBox mismatch + non-zero origin, mixed page sizes, WeChat/payment screenshots, handwritten IOUs. Classify every failure (class 1 vs class 2). A green A0.7 validates the anchor architecture; a class-2 result stops downstream work and reopens the geometry-source assumption before A3/A5/UI are built.
```
```
