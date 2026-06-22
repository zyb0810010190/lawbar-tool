# Evidence-Genie M0 — User Flows

## 1. Status / scope boundary
**Official product-definition workflow document.** It is **NOT implementation authorization** — it describes
intended behavior only. **Every UI / anchor / export behavior here is gated behind A0.7** (the
renderer/geometry conformance gate). A0.7 is not green; the `native/evidence-core` shim's
`renderer-conformance` returns `not_implemented` (a failure). **This document makes no A0.7-green claim and
defines no A0.7 marker.** Companion: `docs/product/evidence-m0-prd.md`. Sources:
`docs/reference/evidence-genie-m0-developer-handover.md`,
`dev-memo/plan-batch-casebox-evidence-product-definition-00.md`, `.claude/rules/evidence-genie.md`,
`.claude/commands/evidence-geometry-gate.md`, EVW-00.

## 2. Actors and operating environment
- **Actor:** a single **lawyer** (一名律师) working one matter at a time. Parties referenced in the
  evidence: **原告** (plaintiff), **被告** (defendant), **法院** (court).
- **Environment:** **macOS desktop**, **local-first / offline**, **air-gapped-capable** (the hearing runs on
  a counsel-controlled Mac with no network). Materials are confidential and never leave the Mac without a
  deliberate user action.

## 3. Flow map / overview
- **F1** Case workspace setup
- **F2** Import both sides' paginated PDFs
- **F3** Build **证据目录** (evidence catalogue/index) and evidence numbering (**证据号**, evidence number)
- **F4** Manually link evidence items to a physical page and region (anchor)
- **F5** Pre-hearing review and lookup by 证据号 / **卷X页Y** (volume X page Y) / page-region
- **F6** Hearing-mode navigation and excerpt restatement
- **F7** Freeze / snapshot / backup / restore
- **F8** Export with reproducible 卷页 (volume-page) citations

## 4. Flows

### F1 — Case workspace setup
- **Purpose:** create a local case workspace for one matter.
- **Preconditions:** the app is installed on the lawyer's Mac; no network required.
- **User steps:** create a case (caseNo, cause, parties 原告/被告, 法院); choose a local storage location.
- **Expected system response (intended):** a local, offline case workspace is created; nothing is sent off
  the Mac.
- **Failure/edge:** unwritable location → clear error; no silent partial state.
- **Invariant links:** local-first/offline (PRD §3, `client-local-first`).
- *Gated behind A0.7 where any UI is involved.*

### F2 — Import both sides' paginated PDFs
- **Purpose:** bring in 原告/被告 (and 法院, if any) paginated evidence PDFs as the canonical originals.
- **Preconditions:** F1 done; the PDFs are on the Mac.
- **User steps:** import each PDF; assign party; mark canonical.
- **Expected system response (intended):** each import captures page identity + geometry and locks the
  canonical original (preserved + hashed); page count is recorded.
- **Failure/edge:** unreadable/rotated/mixed-size pages are surfaced, not guessed; a class-2 geometry
  instability (page identity unstable across reopen) is an architectural stop, not a workaround.
- **Invariant links:** canonical-original-authoritative; optimized rendition never canonical.
- *Gated behind A0.7 (page identity + geometry capture is exactly what A0.7 validates).*

### F3 — Build 证据目录 and evidence numbering
- **Purpose:** assemble the per-party evidence catalogue with 证据号.
- **Preconditions:** F2 done.
- **User steps:** add evidence items (title, party, 证据号, physical page start/end), per 原告/被告.
- **Expected system response (intended):** items map to `DocumentPage`; citation labels (卷X页Y) derive
  solely from `DocumentPage`; duplicate labels allowed but an ambiguous range is flagged, never guessed.
- **Failure/edge:** start>end rejected; non-citable/cross-volume ranges flagged.
- **Invariant links:** **citation identity from `DocumentPage` only**.

### F4 — Manually link evidence to page and region (anchor)
- **Purpose:** the lawyer draws a hyperlink to a target page/region.
- **Preconditions:** F2/F3 done.
- **User steps:** open the page, draw a rectangle over the region, attach it to an evidence item/note/claim.
- **Expected system response (intended):** the anchor is stored as a page-ratio rect against the persisted
  geometry version (box origin subtracted, rotation-aware) — never screen/viewport pixels.
- **Failure/edge:** geometry-version mismatch or replaced page → `needs_review`, never a stale location.
- **Invariant links:** **anchor resolution requires stable page identity + geometry**.
- *Gated behind A0.7 (anchor geometry depends on A0.7 passing).*

### F5 — Pre-hearing review and lookup
- **Purpose:** verify the bundle and rehearse lookups.
- **Preconditions:** F3/F4 done.
- **User steps:** look up by 证据号, by 卷X页Y, and by anchored region; review coverage gaps.
- **Expected system response (intended):** each lookup resolves deterministically to the cited
  `DocumentPage` and anchored region; unresolved/`needs_review` anchors are shown, not hidden.
- **Failure/edge:** broken/quarantined anchors surfaced; freeze is blocked while `needs_review` exists.
- **Invariant links:** citation identity; anchor resolution.
- *Gated behind A0.7.*

### F6 — Hearing-mode navigation and excerpt restatement
- **Purpose:** in the air-gapped hearing, jump to a pre-marked page/region and restate the excerpt.
- **Preconditions:** a verified, frozen snapshot (F7); offline Mac.
- **User steps:** navigate by 证据号 / 卷X页Y / region; read the pre-marked excerpt.
- **Expected system response (intended):** instant, offline navigation to the exact physical page +
  anchored region; only verified renditions are shown.
- **Failure/edge:** no network dependency; an unverified rendition is never used in hearing mode.
- **Invariant links:** offline; optimized rendition never canonical.
- *Gated behind A0.7.*

### F7 — Freeze / snapshot / backup / restore
- **Purpose:** produce a defensible, point-in-time, read-only bundle and restore it.
- **Preconditions:** no unresolved `needs_review` (F5).
- **User steps:** freeze the case; back up the bundle; restore on another counsel Mac with the user-held
  passphrase.
- **Expected system response (intended):** a snapshot whose manifest + separate seal are tamper-evident
  (anti-circular: the manifest hashes a deterministic logical payload, not the sealed encrypted DB);
  restore reproduces a byte-identical canonical model, citations, and anchors.
- **Failure/edge:** any post-freeze byte change is detected; a forgotten passphrase is unrecoverable;
  migration of a frozen snapshot is never in place (read-only on a newer app).
- **Invariant links:** **snapshot integrity & confidentiality (anti-circular seal)**.
- *Gated behind A0.7.*

### F8 — Export with reproducible 卷页 citations
- **Purpose:** produce court-fileable 证据目录 / **举证质证表** (proof/cross-examination table) / **质证记录**
  (cross-examination record) with reproducible citations.
- **Preconditions:** a frozen snapshot (F7).
- **User steps:** choose an export type; generate the document.
- **Expected system response (intended):** citations render through a single contract from `DocumentPage`;
  the `CanonicalExportModel` is byte-identical across display/re-export/restore; in-app links degrade to
  textual 卷X页Y or an explicit flag, never dropped/silently wrong.
- **Failure/edge:** non-citable/cross-volume/ambiguous citations flagged, not guessed; rendered `.docx`/PDF
  are deterministic only where the renderer is controlled (canonical model, not raw bytes by default).
- **Invariant links:** **reproducible export (`CanonicalExportModel`)**.
- *Gated behind A0.7.*

## 5. Cross-flow invariants
- Citation identity derives from `DocumentPage` only (byte-stable; ambiguity refused, never guessed).
- Anchor resolution requires stable page identity + geometry; mismatch → `needs_review`.
- `OptimizedDocumentRendition` is never the canonical citation/anchor/export source.
- Snapshot integrity/confidentiality with an anti-circular manifest/seal.
- `CanonicalExportModel` / reproducible export (not raw bytes by default).
- `not_implemented` fails, never passes; **no A0.7-green claim; no A0.7 marker** is created by any flow.

## 6. Out-of-scope workflow requests
OCR / AI-VLM extraction · cloud sharing / public deployment / sync-by-default · multi-user auth ·
automatic scoring/ranking of evidence · any non-Mac flow (Windows / iPad / mobile / browser).

## 7. Handoff to later docs
- `docs/product/evidence-m0-content-inventory.md` (EPD4) — screens/content + CN↔EN terminology dictionary.
- `docs/product/evidence-m0-acceptance-scenarios.md` (EPD5) — given/when/then acceptance per flow, A0.7-gated.
