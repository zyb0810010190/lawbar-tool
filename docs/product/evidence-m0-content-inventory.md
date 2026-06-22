# Evidence-Genie M0 — Content Inventory

## 1. Status / scope boundary
**Official product-definition content inventory.** It is **NOT implementation authorization** and is a
**content inventory, not a component spec** — it names surfaces and copy but invents no UI widgets or
architecture and authorizes no UI build. **Every UI / anchor / export surface here is gated behind A0.7.**
A0.7 is not green; `renderer-conformance` returns `not_implemented` (a failure). **No A0.7-green claim; no
A0.7 marker.** Companions: `docs/product/evidence-m0-prd.md`, `docs/product/evidence-m0-user-flows.md`.
Sources also: `docs/reference/evidence-genie-m0-developer-handover.md`, `.claude/rules/evidence-genie.md`,
`.claude/rules/client-local-first.md`, EVW-00.

## 2. Content principles
- **Legal accuracy over convenience** — court-facing copy is precise; ambiguity is surfaced, never guessed.
- **Manual-truth only** — lawyer-entered fields are authoritative; no machine extraction.
- **Local / offline / confidential by default** — nothing leaves the Mac without a deliberate action.
- **No cloud / AI / OCR promise** — the product makes no such claim anywhere in its copy.
- **Cite physical pages, not rendered artifacts** — citations come from `DocumentPage` (卷X页Y), never from an
  optimized rendition.

## 3. Terminology dictionary (CN primary, English gloss)
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

## 4. Surface inventory
*(Each surface: purpose · primary content · key fields · user-visible warnings · empty state · error state ·
A0.7 gate. All UI/anchor/export surfaces are **gated behind A0.7**.)*

1. **Case workspace** — purpose: hold one matter locally. Content: case summary. Fields: 案号, 案由, 原告,
   被告, 法院. Warning: "Local-only / confidential — stays on this Mac." Empty: "No case selected." Error:
   "Storage location unwritable." *Gated behind A0.7 (UI).*
2. **Party / court / case metadata** — purpose: capture parties + court. Content: party list. Fields: 原告,
   被告, 法院, 审判长/法官. Warning: none beyond local-only. Empty: "No parties yet." Error: "Required field
   missing." *Gated behind A0.7 (UI).*
3. **Document import / pagination** — purpose: import both sides' paginated PDFs as canonical originals.
   Content: per-document page list. Fields: party, pdfPath, pageCount, status (canonical). Warning:
   "Optimized rendition is never the canonical citation/anchor source." Empty: "No documents imported."
   Error: "Unreadable PDF / page identity unstable (A0.7 class-2 — stop)." *Gated behind A0.7 (geometry).*
4. **Evidence catalogue (证据目录)** — purpose: per-party catalogue with 证据号. Content: evidence items.
   Fields: 证据号, title, party, physical page start/end, citation (卷X页Y). Warning: "Ambiguous range —
   disambiguate, not guessed." Empty: "No evidence items." Error: "start>end / non-citable / cross-volume."
   *Gated behind A0.7 (citation derives from `DocumentPage`).*
5. **Evidence detail** — purpose: one evidence item + its links. Content: item metadata + anchors. Fields:
   title, 证据号, citation range, notes. Warning: "Citations derive only from `DocumentPage`." Empty: "No
   detail." Error: "Linked page replaced — needs review." *Gated behind A0.7.*
6. **Manual page-region linking (anchor)** — purpose: draw a hyperlink to a page/region. Content: the page +
   drawn rect. Fields: page, page-ratio rect, geometry version, label. Warning: "Anchors use page-ratio
   geometry, never screen pixels." Empty: "No anchors." Error: "Geometry-version mismatch → needs_review."
   *Gated behind A0.7 (anchor geometry).*
7. **Pre-hearing review** — purpose: verify the bundle + coverage. Content: lookup + coverage-gap list.
   Fields: lookup by 证据号 / 卷X页Y / region. Warning: "Freeze blocked while items need review." Empty: "No
   items to review." Error: "Broken / quarantined anchor." *Gated behind A0.7.*
8. **Hearing lookup / navigation** — purpose: offline jump to a pre-marked page/region + restate. Content:
   navigator + excerpt. Fields: 证据号, 卷X页Y, region. Warning: "Offline / air-gapped; only verified
   renditions shown." Empty: "Nothing pinned." Error: "Unverified rendition refused." *Gated behind A0.7.*
9. **Freeze / snapshot / backup / restore** — purpose: defensible point-in-time bundle. Content: snapshot +
   manifest/seal status. Fields: snapshotId, manifest hash, seal, passphrase prompt. Warning: "Forgotten
   passphrase is unrecoverable; snapshots open read-only on a newer app." Empty: "No snapshots." Error:
   "Snapshot verification failed (post-freeze byte change detected)." *Gated behind A0.7.*
10. **Export package** — purpose: court-fileable 证据目录 / 举证质证表 / 质证记录. Content: export preview.
    Fields: export type, citationFormatVersion, exportTemplateVersion. Warning: "Citations render from
    `DocumentPage` via one contract; links degrade to text or an explicit flag, never dropped." Empty: "No
    export yet." Error: "Export blocked — unresolved citation / unfrozen snapshot." *Gated behind A0.7.*
11. **Settings / local storage** — purpose: local storage + app settings. Content: storage path, app
    version. Fields: storage location. Warning: "No network; data stays local." Empty: n/a. Error: "Path
    unavailable." *Gated behind A0.7 (UI).*

## 5. Required warnings and guardrail copy
- **"Gated behind A0.7"** on every UI/anchor/export surface; the product is not usable until A0.7 is green.
- **No A0.7-green claim; no A0.7 marker** appears in any copy.
- **"Optimized rendition is never the canonical citation/anchor/export source."**
- **`not_implemented` fails** — any not-yet-built capability reports failure, never success.
- **"Local-only / confidential — material stays on this Mac."**
- **No OCR / AI / cloud** — no copy promises extraction, suggestions, sharing, or sync.

## 6. Empty / error states (catalogue)
- No case selected · No documents imported · No evidence items · Link missing/invalid (needs_review) ·
  Page-identity mismatch · Geometry unstable (A0.7 class-2 → stop) · Snapshot verification failed ·
  Export blocked. Each is shown plainly; none is silently guessed or auto-resolved.

## 7. Cross-document consistency
This inventory aligns with `docs/product/evidence-m0-prd.md` (promises/invariants) and
`docs/product/evidence-m0-user-flows.md` (F1–F8). **EPD5** (`docs/product/evidence-m0-acceptance-scenarios.md`)
turns these surfaces + states into given/when/then acceptance scenarios, each A0.7-gated.
