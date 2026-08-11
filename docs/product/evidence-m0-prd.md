# Evidence-Genie M0 — Product Definition

Single product-definition document for Evidence-Genie M0: requirements, invariants, user flows, content
inventory, and acceptance scenarios. Supersedes and absorbs the former `evidence-m0-user-flows.md`,
`evidence-m0-content-inventory.md`, and `evidence-m0-acceptance-scenarios.md` (merged 2026-08-10; content
preserved, duplicated boilerplate removed).

## 1. Status / scope boundary

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

## 2. Problem statement

A single lawyer preparing for and conducting a Chinese court hearing must work from both sides' paginated
evidence PDFs, build structured work-product (证据目录 / 举证质证表 / 质证记录) by hand, cite precisely by
证据号 and 卷X页Y, and — in an air-gapped courtroom — instantly navigate to a pre-marked page/region and
restate the excerpt. Today this is manual, error-prone, and hard to keep citation-stable across
close/reopen/export, with no reliable freeze/snapshot for a defensible, reproducible bundle. Evidence-Genie
M0 is the **human-verifiable manual substrate** that makes evidence navigation, citation, freezing, and
export reliable — offline, on the lawyer's own Mac.

## 3. Target user and environment

- **User:** a single lawyer (一名律师) or law-firm staff, working one matter at a time. No multi-user, no
  firm portal. Parties referenced in evidence: **原告** (plaintiff), **被告** (defendant), **法院** (court).
- **Environment:** **macOS desktop**, **local-first / offline**, **air-gapped-capable** — hearings run on a
  counsel-controlled Mac with no network. Confidential material **never leaves the Mac** unless the lawyer
  takes a deliberate action. The offline guarantee is **OS-enforced** (App Sandbox, no network
  entitlements), not convention.

## 4. Scope

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

## 5. Product invariants (must hold; never weakened without an ADR)

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

## 6. A0.7-first dependency

**A0.7 `renderer-conformance` is the first real Evidence architecture gate.** It validates PDFKit coordinate
fidelity + page-identity stability on real messy 卷宗, classifying each failure class-1 (normalization,
fixable) vs class-2 (geometry-source instability, architectural stop).

**No Evidence UI ships before A0.7 is green.** Nothing in §4 or §7 is buildable until A0.7 passes; a class-2
result reopens the geometry-source assumption before any anchor / forms / UI work.

## 7. User flows

Flow map: **F1** workspace setup · **F2** import PDFs · **F3** build 证据目录 · **F4** manual anchor ·
**F5** pre-hearing review · **F6** hearing navigation · **F7** freeze/snapshot/restore · **F8** export.

### F1 — Case workspace setup
Create a local case workspace for one matter. **Steps:** create a case (案号, 案由, parties 原告/被告, 法院);
choose a local storage location. **Intended response:** a local, offline workspace; nothing leaves the Mac.
**Edge:** unwritable location → clear error, no silent partial state. **Invariants:** 1. *A0.7-gated (UI).*

### F2 — Import both sides' paginated PDFs
Bring in 原告/被告 (and 法院, if any) paginated evidence PDFs as canonical originals. **Steps:** import each
PDF; assign party; mark canonical. **Intended response:** each import captures page identity + geometry and
locks the canonical original (preserved + hashed); page count recorded. **Edge:** unreadable / rotated /
mixed-size pages are surfaced, not guessed; a class-2 geometry instability is an architectural stop, not a
workaround. **Invariants:** 3, 7. *A0.7-gated — page identity + geometry capture is exactly what A0.7
validates.*

### F3 — Build 证据目录 and evidence numbering
Assemble the per-party catalogue with 证据号. **Steps:** add evidence items (title, party, 证据号, physical
page start/end). **Intended response:** items map to `DocumentPage`; citation labels (卷X页Y) derive solely
from `DocumentPage`; duplicate labels allowed but an ambiguous range is flagged, never guessed. **Edge:**
start>end rejected; non-citable / cross-volume ranges flagged. **Invariants:** 5.

### F4 — Manually link evidence to page and region (anchor)
The lawyer draws a hyperlink to a target page/region. **Steps:** open the page, draw a rectangle over the
region, attach it to an evidence item / note / claim. **Intended response:** the anchor is stored as a
page-ratio rect against the persisted geometry version (box origin subtracted, rotation-aware) — never
screen/viewport pixels. **Edge:** geometry-version mismatch or replaced page → `needs_review`, never a stale
location. **Invariants:** 6. *A0.7-gated.*

### F5 — Pre-hearing review and lookup
Verify the bundle and rehearse lookups. **Steps:** look up by 证据号, by 卷X页Y, and by anchored region;
review coverage gaps. **Intended response:** each lookup resolves deterministically to the cited
`DocumentPage` and anchored region; unresolved / `needs_review` anchors are shown, not hidden. **Edge:**
broken / quarantined anchors surfaced; **freeze is blocked while `needs_review` exists**. **Invariants:**
5, 6. *A0.7-gated.*

### F6 — Hearing-mode navigation and excerpt restatement
In the air-gapped hearing, jump to a pre-marked page/region and restate the excerpt. **Preconditions:** a
verified, frozen snapshot (F7); offline Mac. **Intended response:** instant, offline navigation to the exact
physical page + anchored region; only verified renditions are shown. **Edge:** no network dependency; an
unverified rendition is never used in hearing mode. **Invariants:** 1, 7. *A0.7-gated.*

### F7 — Freeze / snapshot / backup / restore
Produce a defensible, point-in-time, read-only bundle and restore it. **Preconditions:** no unresolved
`needs_review` (F5). **Steps:** freeze the case; back up the bundle; restore on another counsel Mac with the
user-held passphrase. **Intended response:** a snapshot whose manifest + separate seal are tamper-evident
(anti-circular); restore reproduces a byte-identical canonical model, citations, and anchors. **Edge:** any
post-freeze byte change is detected; a forgotten passphrase is unrecoverable; a frozen snapshot is never
migrated in place (read-only on a newer app). **Invariants:** 8. *A0.7-gated.*

### F8 — Export with reproducible 卷页 citations
Produce court-fileable 证据目录 / 举证质证表 / 质证记录. **Preconditions:** a frozen snapshot (F7). **Steps:**
choose an export type; generate the document. **Intended response:** citations render through a single
contract from `DocumentPage`; the `CanonicalExportModel` is byte-identical across display / re-export /
restore; in-app links degrade to textual 卷X页Y or an explicit flag, **never dropped or silently wrong**.
**Edge:** non-citable / cross-volume / ambiguous citations flagged, not guessed; rendered `.docx`/PDF are
deterministic only where the renderer is controlled. **Invariants:** 9. *A0.7-gated.*

## 8. Surface inventory

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

## 9. Terminology dictionary (CN primary, English gloss)

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

## 10. Content principles and required copy

**Principles.** Legal accuracy over convenience — court-facing copy is precise; ambiguity is surfaced, never
guessed. Manual-truth only. Local / offline / confidential by default. No cloud / AI / OCR promise anywhere
in the copy. Cite physical pages, not rendered artifacts.

**Required warnings.** "Gated behind A0.7" on every UI/anchor/export surface · no A0.7-green claim and no
A0.7 marker in any copy · "Optimized rendition is never the canonical citation/anchor/export source" ·
`not_implemented` reports failure, never success · "Local-only / confidential — material stays on this Mac" ·
no copy promising extraction, suggestions, sharing, or sync.

## 11. Acceptance scenarios

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

### Traceability matrix

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

### Pass/fail interpretation

- **`not_implemented` fails, never passes.** AS-A0.7 stays red until the real harness produces conformance
  evidence.
- These scenarios **make no runtime claims** — they define intended, observable acceptance, not working
  software.
- **No scenario can mark A0.7 green** and none creates an A0.7 marker; a green marker is produced only by
  the real native A0.7 harness.
- **Future implementation must produce observable evidence** per scenario before it counts as passing.

## 12. Success criteria

- The lawyer can **assemble and freeze a reliable M0 evidence bundle** (both sides' PDFs, 证据目录, anchors)
  that verifies and restores byte-identically.
- The lawyer can **navigate during the hearing** by 证据号 / 卷X页Y / anchored region, offline.
- **Exported materials preserve citations reproducibly** — canonical export model byte-identical; links
  degrade to text or an explicit flag, never dropped or silently wrong.
- The system **remains local/offline** and does not leak confidential material; the original is always
  retained and hashed; only verified renditions enter hearing mode or bundles.

*Each criterion is realized only after A0.7 is green; here they are acceptance intent, not a claim of
working behavior.*

## 13. Non-goals and hard stops (require separate authorization)

- **Swift / SwiftPM / PDFKit native core** and **macOS CI** — new runtime/toolchain.
- **Real A0.7 harness** — a separate engineering lane; the marker is produced only by that real harness,
  never hand-authored.
- **Hard hooks** (no-UI-before-A0.7, citation-single-source, optimized-never-canonical, snapshot
  anti-circularity, offline entitlement) — deferred until the real surfaces + marker provenance exist.
- No OCR / AI-VLM / cloud / auth / network behavior is introduced by this product definition.
