# Evidence-Genie M0 — Acceptance Scenarios

## 1. Status / scope boundary
**Official product-definition acceptance scenarios.** **NOT implementation authorization.** Every
UI / anchor / export behavior described is **gated behind A0.7**. A0.7 is not green; `renderer-conformance`
returns `not_implemented` (a failure). **No A0.7-green claim; no A0.7 marker.** These are *intended*
acceptance criteria; they make no runtime claim and no scenario passes until the real implementation
produces evidence. Sources: `docs/product/evidence-m0-prd.md`, `docs/product/evidence-m0-user-flows.md`,
`docs/product/evidence-m0-content-inventory.md`, `docs/reference/evidence-genie-m0-developer-handover.md`,
`.claude/rules/evidence-genie.md`, `.claude/commands/evidence-geometry-gate.md`, EVW-00.

## 2. Scenario format
Each scenario records: **ID** · **invariant link** · **flow/surface link** · **preconditions** ·
**Given / When / Then** · **observable evidence** · **A0.7 gate status** · **out-of-scope exclusions**.
"Observable evidence" is what a lawyer (or a future test) could observe — never an assertion that software
exists today.

## 3. Core scenarios

### AS-A0.7 — renderer-conformance gate remains not_implemented until the real harness
- Invariant: A0.7 geometry/page-identity classification · Flow/surface: F-(pre)/geometry-gate ·
  Pre: only the JS shim exists.
- **Given** the `native/evidence-core` shim, **When** `renderer-conformance` is run, **Then** it returns
  `status:"not_implemented"` and exits non-zero (a failure). Observable: the JSON envelope + non-zero exit.
- A0.7 gate: **this scenario IS the gate** — it must stay `not_implemented` (red) until the real Swift/PDFKit
  harness lands; passing requires real conformance on messy 卷宗 with class-1/class-2 classification.
- Out-of-scope: fabricating a green marker; any UI built before this is green.

### AS-A1 — citation identity from `DocumentPage` / physical page
- Invariant: citation identity · Flow F3/F8 · surface: 证据目录 · Pre: documents imported, 证据号 assigned.
- **Given** an evidence item (belonging to 原告 (plaintiff) or 被告 (defendant)) with a physical page range, **When** its 卷X页Y citation is generated and the
  case is closed/reopened/exported, **Then** the citation is byte-identical and derived solely from
  `DocumentPage`; an ambiguous range is refused+warned, never guessed.
- Observable: identical 卷X页Y across close/reopen/export; an explicit warning on ambiguity.
- A0.7 gate: **gated behind A0.7**. Out-of-scope: page-index arithmetic; optimized-rendition citations.

### AS-A3 — manual anchor resolution by page identity + region
- Invariant: anchor resolution · Flow F4/F5 · surface: manual-page-region-linking · Pre: stable geometry.
- **Given** an anchor drawn as a page-ratio rect against a geometry version, **When** the case is
  reopened/frozen, **Then** it resolves to the same documentId + physicalPageIndex + geometry version +
  rect; a version mismatch yields `needs_review`, never a stale location.
- Observable: identical resolution; `needs_review` on mismatch. A0.7 gate: **gated behind A0.7**.
- Out-of-scope: viewport/screen-pixel anchors.

### AS-A5 — manual forms (举证质证表 and 质证记录)
- Invariant: manual-truth / export contract · Flow F8 · surface: export-package · Pre: items + claims entered.
- **Given** lawyer-entered claim/element → our (原告 / 被告, as applicable) evidence relations and 三性 cross-examination entries against the opposing party (and the 法院 (court)-filed record where relevant), **When**
  the 举证质证表 and 质证记录 are produced, **Then** each row cites via the single citation contract and
  flags proof gaps per rule.
- Observable: forms with contract-rendered citations + flagged gaps. A0.7 gate: **gated behind A0.7**.
- Out-of-scope: machine-generated form content; scoring.

### AS-A6 — typed-metadata search / lookup
- Invariant: citation identity / manual-truth · Flow F5 · surface: pre-hearing-review · Pre: catalogue built.
- **Given** the catalogue, **When** the lawyer searches by typed metadata (证据号 / party / page), **Then**
  results resolve deterministically to the cited `DocumentPage`; coverage gaps are listed.
- Observable: deterministic results + coverage-gap list. A0.7 gate: **gated behind A0.7**.
- Out-of-scope: full-text/OCR/AI search.

### AS-A8 — freeze / snapshot / backup / restore integrity
- Invariant: snapshot integrity & confidentiality (anti-circular seal) · Flow F7 · surface: freeze/snapshot.
- **Given** a frozen snapshot, **When** any post-freeze byte change occurs OR it is restored on another
  counsel Mac with the user-held passphrase, **Then** the manifest+separate seal detect tampering and a
  clean restore reproduces a byte-identical canonical model, citations, and anchors.
- Observable: tamper detection; byte-identical restore. A0.7 gate: **gated behind A0.7**.
- Out-of-scope: cloud backup; in-place migration of a frozen snapshot.

### AS-A10 — reproducible export with 卷X页Y citations
- Invariant: reproducible export (`CanonicalExportModel`) · Flow F8 · surface: export-package.
- **Given** a frozen snapshot, **When** an export (证据目录 / 举证质证表 / 质证记录) is generated and
  re-exported/restored, **Then** the `CanonicalExportModel` is byte-identical; in-app links degrade to
  textual 卷X页Y or an explicit flag, never dropped/silently wrong.
- Observable: byte-identical canonical model; bijective link↔citation/flag. A0.7 gate: **gated behind A0.7**.
- Out-of-scope: hashing raw `.docx`/PDF bytes by default.

### AS-A1-T9 — readable compression quality gate
- Invariant: readable compression · Flow F2/F8 · surface: document-import · Pre: a canonical original.
- **Given** an `OptimizedDocumentRendition`, **When** it is produced, **Then** it is rejected for
  hearing/export if it changes geometry/page count/box/anchor behavior or degrades readability; the original
  is always retained + hashed and remains canonical.
- Observable: rejection on any geometry/readability change; original preserved. A0.7 gate: **gated behind A0.7**.
- Out-of-scope: optimized rendition as a citation/anchor source.

### AS-OFFLINE — local-only / no cloud / confidentiality
- Invariant: offline / local-first · Flow F1/F6 · surface: settings/hearing-lookup.
- **Given** the app on a counsel Mac, **When** any flow runs, **Then** no network egress occurs and
  confidential material never leaves the Mac without a deliberate action; the hearing runs air-gapped.
- Observable: no network activity; air-gapped hearing navigation. A0.7 gate: **gated behind A0.7** (UI).
- Out-of-scope: cloud sync / public deployment.

### AS-NEG — negative scenarios (out-of-scope requests stay refused)
- Invariant: M0 scope boundary · Flow N/A · surface: all.
- **Given** a request for OCR, AI/VLM extraction, cloud sharing/public deployment, multi-user auth, or a
  non-Mac platform, **When** it is raised against M0, **Then** it is **out of scope** — the product offers
  no such capability and makes no such promise.
- Observable: absence of the capability + explicit out-of-scope copy. A0.7 gate: n/a (negative).
- Out-of-scope (the point): OCR · AI/VLM · cloud/public · auth/multi-user · non-Mac.

## 4. Traceability matrix
| Scenario | PRD § | User-flow | Content surface | Invariant | A0.7 gate |
|---|---|---|---|---|---|
| AS-A0.7 | §7 | F-(pre) | document-import / geometry-gate | A0.7 classification | IS the gate (not_implemented) |
| AS-A1 | §6 | F3/F8 | evidence-catalogue | citation identity | gated |
| AS-A3 | §6 | F4/F5 | manual-page-region-linking | anchor resolution | gated |
| AS-A5 | §4/§6 | F8 | export-package | manual forms / export contract | gated |
| AS-A6 | §4 | F5 | pre-hearing-review | citation identity / manual-truth | gated |
| AS-A8 | §6 | F7 | freeze/snapshot | snapshot integrity (anti-circular) | gated |
| AS-A10 | §6 | F8 | export-package | reproducible export | gated |
| AS-A1-T9 | §4/§6 | F2/F8 | document-import | readable compression | gated |
| AS-OFFLINE | §3 | F1/F6 | settings / hearing-lookup | offline / local-first | gated (UI) |
| AS-NEG | §5 | — | all | M0 scope boundary | n/a |

## 5. Pass/fail interpretation
- **`not_implemented` fails, never passes.** AS-A0.7 stays red until the real harness produces conformance
  evidence.
- These scenario docs **make no runtime claims** — they define intended, observable acceptance, not working
  software.
- **No scenario can mark A0.7 green** and none creates an A0.7 marker; the green marker is produced only by
  the real native A0.7 harness (a separate hard-stop lane).
- **Future implementation must produce observable evidence** (per scenario) before any scenario is
  considered passing; until then every gated scenario is pending behind A0.7.

## 6. Handoff to closeout
`EPD-CLOSEOUT` will summarize the product-definition docs (PRD, user-flows, content-inventory, acceptance-
scenarios) and the still-unresolved hard-stop boundaries (Swift/SwiftPM/PDFKit native core, macOS CI, real
A0.7 harness + marker provenance, deferred hard hooks, root-intake-file disposition).
