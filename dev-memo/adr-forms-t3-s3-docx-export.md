# ADR — T3 S3 DOCX export: renderer/library decision (FORMS-T3-S3-DOCX-00)

**Date**: 2026-07-04. **Type**: ADR / decision record (documentation only — no export implementation,
no dependency addition, no code/tests). **Lane**: WI-FORMS-T3-S3-DOCX-DECISION-GOVERNANCE.
**Status**: decision record for the LATER T3 DOCX export implementation WI — **not**
implementation-authorizing. Parent plan: `dev-memo/plan-forms-t3-evidence-catalog-00.md` (slice S3,
"LAST; double-gated"). Prior slices merged: S0 (contract fields), S1 (`t3CatalogModel.ts` logical
model), S2 (`casebox:t3:previewCatalog` read-only preview).

> **Binding inputs.** `dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md` §H DR-00 (T3 = internal lawyer
> trial-review, DOCX-first, 证明内容 label, 页码 = physical bundle page range, 卷X页Y supporting-only,
> T4/T5 gated, no custody/seal/A8); `dev-memo/plan-forms-t3-evidence-catalog-00.md` §2 (renderer choice
> was a REQUIRED open decision — candidate A: a DOCX library = new runtime dependency = autonomy
> hard-stop; candidate B: bespoke OOXML; candidate C: preview-first) and §4 slice S3 (double-gated on
> the renderer decision AND on S1 shipping); `apps/lawbar-desktop/src/caseBox/export/t3CatalogModel.ts`
> (S1 model — the SOLE input to S3 rendering); `docs/adr/ADR-evidence-a10-court-fileable-export.md`
> (A10 invariant 9 — never hash raw `.docx`/PDF bytes by default; reproducibility is measured against a
> canonical LOGICAL model, canonicalized/normalized artifact hashing only where the renderer is
> controlled).

## Review packet (compact)

1. **Summary**: resolve the S3 renderer/library open decision. **Decision: use the maintained `docx`
   npm package** (dolanmiu/`docx`) as the T3 DOCX generation library, subject to normal repo dependency
   review at implementation time. This lane writes ONE decision ADR + queue governance; it implements
   nothing and adds no dependency.
2. **Exact target files (this lane)**: `dev-memo/adr-forms-t3-s3-docx-export.md` (this file),
   `dev-memo/run/queue.md` + `queue.linted` + `queue.reviewed` + `queue.governed` +
   `dev-memo/run/reviews/queue-review-125.md`.
3. **Acceptance criteria (this lane)**: ADR records the decision, the `docx`-vs-bespoke-OOXML
   rationale, dependency risks + controls, forbidden scope, and compatibility targets + test
   expectations; docs/governance-only diff; `CURRENT_SCHEMA_VERSION` unchanged; check-queue +
   check-contract-integrity pass; broker review-plan READY.
4. **Out of scope**: any export implementation; the actual `docx` dependency addition / lockfile
   change; PDF generation; T4/T5; schema/contract/persistence change; custody/seal/A8; raw-sample
   commit.
5. **Essential references**: the S1 model (`t3CatalogModel.ts`), the S2 preview
   (`viewMatterT3Catalog.ts` / `t3Handlers.ts`), A10 invariant 9, DR-00.
6. **Review questions**: (a) is `docx` the right choice over bespoke OOXML for this bounded internal
   form? (b) are the dependency risks + controls sufficient and correctly deferred to the impl WI? (c)
   does the ADR keep S3 rendering the S1 model ONLY (no re-implementation, no A10 CanonicalExportModel
   coupling, no 卷X页Y)? (d) is the determinism/golden approach (normalized OOXML, not raw bytes)
   consistent with A10 invariant 9?

## 1. Problem

The T3 track has a logical model (S1) and an in-app read-only preview (S2), but no way to produce the
**DOCX-first** deliverable DR-00 requires (lawyers edit/annotate the output). The repo has **no DOCX
generation mechanism** and no `docx`/`docxtemplater`/`officegen`/JSZip/PDF dependency (verified). Slice
S3 was blocked on a renderer/library decision, which is a new-runtime-dependency autonomy hard-stop.
The user has resolved that hard-stop in favor of the `docx` library; this ADR records the decision and
its controls so a future implementation WI does not re-litigate the choice.

## 2. Decision

**Generate the T3 证据目录及说明 `.docx` with the maintained `docx` npm package** (pure-TypeScript
OOXML document builder), rendering **exclusively from the S1 `T3CatalogModel`** produced by
`buildT3CatalogModel`. The DOCX layer is a deterministic projection of the S1 model into a Word table;
it introduces no new truth and re-implements no S1 logic.

### 2.1 Why `docx` over bespoke OOXML (candidate B)

| Axis | `docx` (chosen) | Bespoke OOXML (rejected) |
|---|---|---|
| Document model | Typed/declarative `Document`/`Table`/`TableRow`/`TableCell`/`Paragraph` primitives | Hand-owned XML string/zip generation |
| Table primitives | First-class table/row/cell/heading with widths + borders | Hand-authored `w:tbl`/`w:tr`/`w:tc` markup |
| Maintenance burden | Library owns OOXML correctness + Word-compat quirks | We own an OOXML generator forever |
| Compatibility regression surface | Centralized in a widely-used library, exercised by many consumers | Every Word/WPS/LibreOffice quirk is ours to discover |
| Zip/packaging | Library emits the `.docx` zip package | We hand-own a zip writer |

Mechanism: the only S3 consumer is a single bounded internal form (one table, a small header). A typed
table builder is strictly less code and less long-term risk than a hand-owned OOXML+zip generator, with
no offsetting benefit to bespoke XML for a layout this simple. Candidate C (preview-first) is already
satisfied by S2; S3 is the DOCX slice candidate C deferred to.

### 2.2 What S3 renders (no scope drift)

- Header: 提交人诉讼地位 (原告/被告 or an explicit review-needed marker) + 名称/姓名.
- One table, DR-00's four columns: 序号 / 证据名称 / 证明内容 / 页码, one row per S1 model row, in
  the S1 model order (never re-sorted).
- `reviewNeeded` cells render an explicit needs-review marker (never blank-as-data, never fabricated).
- A submitter refusal (`{kind:"refusal"}` from the S1 model / S2 channel) renders NO document — it
  surfaces the same review state the S2 preview shows; the DOCX is produced only for a `{kind:"model"}`.
- **No `卷X页Y`/citation column** (页码 stays `exhibit_page_range`; DR-00 Q4). **No** A10
  `CanonicalExportModel` coupling — S3 renders the forms-T3 internal review form, which is NOT the
  court-fileable A10-T3 evidence index and does not adopt its citation contract.

## 3. Dependency risks and controls

The `docx` addition is a **new runtime dependency** (autonomy hard-stop). This ADR authorizes the
*choice*; the *addition* is controlled and deferred:

- **Addition only in the future S3 implementation WI** — never in this lane. The exact
  `apps/lawbar-desktop/package.json` + lockfile diff MUST be reviewed there.
- **Dependency/supply-chain review is a required gate in the S3 impl WI**: run the repo's dependency
  risk review (`/codex-dependency-review` / `dependency_risk_reviewer`) on the actual package.json +
  lockfile diff, plus the standard cc-suite review/audit/verify chain. The review MUST explicitly clear,
  for `docx` AND its full transitive set: (1) exact pinned version + recorded integrity hash (as of
  review the latest published `docx` is `9.7.1`, 2026-05-27, MIT, TypeScript — the impl WI pins whatever
  is current then); (2) **license** compatibility (MIT/permissive expected; flag any copyleft/unknown);
  (3) **install/postinstall/preinstall scripts** — none should run arbitrary code (flag any lifecycle
  script); (4) **optionalDependencies / peerDependencies** surface; (5) **maintainer / release
  provenance** (established maintainer, signed/consistent releases); (6) **known advisories** (`npm
  audit` / GHSA clean, or each finding triaged); (7) **package size / bundle impact** on the packaged
  Electron app; (8) **Node/Electron packaging compatibility** (pure-JS, works under the app's Node
  22.x/24.x + electron-builder, no arch-specific rebuild).
- **No native dependency** — `docx` is pure JS/TS; the S3 WI MUST reject any transitive native binding
  (no new `better-sqlite3`-class ABI surface; no node-gyp build step).
- **No network / runtime service** — generation is fully local/offline (client-local-first posture);
  the S3 WI MUST verify `docx` performs no network I/O.
- **No template-execution engine** — no `docxtemplater`-style runtime template eval over
  user/document data; the document is built programmatically from the S1 model via the typed API.
- **Output derives ONLY from the S1 logical model** — the DOCX builder takes a `T3CatalogModel` and
  emits a table; it MUST NOT read persistence, contract, or documents directly, and MUST NOT
  re-implement `buildT3CatalogModel`.

## 4. Forbidden scope (the S3 impl WI approves NONE of these)

- **No PDF generation** (DOCX-first only; PDF is not this track).
- **No T4/T5** (证明对象/三性/质证) fields or behavior.
- **No evidence write behavior** (read-only source; the export mutates nothing).
- **No schema/migration/contract/persistence change** — `CURRENT_SCHEMA_VERSION` stays 12 unless a
  genuinely required change is separately governed by its own ADR + review.
- **No raw client samples or tracked intake fixtures** — golden/QA data is synthetic.
- **No custody/marker/seal/JS-shim/A8 work** (DR-00: not implicated for internal review).
- **No broad renderer/UI redesign** — only a minimal user-initiation trigger (§6).
- **No new dependency beyond `docx` and its reviewed transitive set** — anything else is a fresh
  hard-stop.

## 5. Compatibility targets and tests (for the future S3 implementation WI)

- **Determinism**: aim for deterministic generation where feasible. Because a `.docx` is a ZIP whose
  container carries volatile metadata (timestamps), the reproducibility unit is a **normalized OOXML
  assertion**, NOT a raw-`.docx`-byte hash (consistent with A10 invariant 9 — never hash raw
  `.docx`/PDF bytes by default; hash a canonicalized representation only where the renderer is
  controlled). The S3 golden MUST include **BOTH** (not either/or): (i) a **structural assertion** over
  the built model → document mapping (header text present; the ordered 4-column rows; 序号 1..n;
  reviewNeeded markers), AND (ii) a **focused normalized-OOXML assertion** on the extracted main
  document part (e.g. `word/document.xml`, normalized for stable attribute order / whitespace) covering
  the table header + row text. Raw-`.docx`-byte hashing is FORBIDDEN as the golden. The S1
  `t3CatalogModelSha256` remains the stable upstream reproducibility anchor for the logical input.
- **Table header + row mapping**: 序号/证据名称/证明内容/页码 header cells present; one table row per
  S1 model row in S1 order; 序号 = 1..n.
- **Chinese labels + punctuation**: 证据目录及说明 title, column headers, and multi-clause proof text
  (e.g. `1、…；2、…`) render verbatim (NFC), no mojibake.
- **review-needed / refusal behavior**: a `reviewNeeded` cell renders the explicit marker; a
  `{kind:"refusal"}` model yields NO document + surfaces the refusal (never a fabricated/blank export).
- **Litigation position / header**: 提交人诉讼地位 renders the position when present, the marker when
  absent.
- **Accepted-status filtering**: only `accepted` rows appear (inherited from the S1 model default).
- **Non-promotion**: `notes` / source-document filename / `party_side` never appear as
  证据名称/证明内容/页码.
- **No `卷X页Y` column**: 页码 equals `exhibit_page_range`; assert no citation column exists.
- **Empty / refusal cases**: an empty (no accepted rows) model renders a header + empty table (or an
  explicit "no rows" note), never invented rows.
- **Third-party open QA**: whether the generated `.docx` opens in Word / WPS / LibreOffice is recorded
  as **manual QA** unless the repo later adds an automated conformance harness for it; it is NOT a
  required automated gate in the S3 WI (documented as a manual acceptance step).

## 6. Minimal user-initiation trigger (design reference for the S3 UI touch)

If S3 requires user initiation, the ONLY UI change is a minimal **"导出 DOCX"** affordance inside the
existing S2 T3 preview disclosure (`renderer/screens/viewMatterT3Catalog.ts`): a `<button
type="button">` with a `data-test-id` (e.g. `view-t3-export-docx`) that invokes a single new
main-process export path and reports success/failure inline (`role="alert"` on error), mirroring the
S2 states. It adds NO new screen, NO route, and NO redesign. This section is the design-artifact
reference for that trigger; the S3 WI carries this ADR as its `Design artifact:`.

**Delivery path DECISION (main-process save dialog; the renderer never handles raw DOCX bytes).** The
export is a MAIN-process operation. The trigger invokes one export path; the main process builds the
`T3CatalogModel` from the same drained-accepted-evidence + `buildT3CatalogModel` source as the S2
preview, builds the `docx` `Document`, packs it to a buffer, and writes it via the Electron save
dialog (`dialog.showSaveDialog`), returning ONLY a structured status result to the renderer. Semantics
the S3 WI MUST honor:
- **Cancel**: cancelling the save dialog is a no-op success (`{ written: false }`), NOT an error.
- **Overwrite**: the OS save dialog owns overwrite confirmation; the app never silently overwrites.
- **Extension**: the default filename ends in `.docx` and the dialog filter is DOCX.
- **Refusal**: a `{kind:"refusal"}` model produces NO document and surfaces the refusal (never a file).
- **Errors**: a build/write failure returns a structured error the renderer reports inline (`role="alert"`).
- **No raw bytes in the renderer**: the renderer only ever sees `{ written: true|false }` / error / refusal —
  never the `.docx` bytes.

## 7. Explicit non-decisions (this lane approves NONE of these)

- **No export implementation** (no DOCX builder, no IPC export channel, no UI trigger code).
- **No dependency addition** (`docx` is CHOSEN here; ADDED only in the S3 impl WI after dependency
  review).
- **No PDF**, **no T4/T5**, **no schema/contract/persistence change**, **no custody/A8**, **no raw
  sample commit**.

## Effect on gating

With this ADR reviewed and merged, the S3 renderer/dependency blocking condition is **decision-resolved**:
the T3 DOCX implementation WI (`docx` dependency + a `T3CatalogModel → .docx` builder + the minimal
export trigger + normalized-OOXML golden tests, per §2/§5/§6) can be queued as its own governed WI. That
WI is HIGH-RISK (new runtime dependency) and MUST run the dependency-risk review + full broker
review-plan → audit → verify. T4/T5 remain design-gated.

## References
- `dev-memo/plan-forms-t3-evidence-catalog-00.md` (§2 renderer candidates; §4 slice S3).
- `dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md` §H DR-00.
- `apps/lawbar-desktop/src/caseBox/export/t3CatalogModel.ts` (S1 model — sole S3 input).
- `apps/lawbar-desktop/src/caseBox/t3Handlers.ts` + `renderer/screens/viewMatterT3Catalog.ts` (S2 surface).
- `docs/adr/ADR-evidence-a10-court-fileable-export.md` (invariant 9 — normalized artifact hashing, never raw bytes).
- `.claude/rules/autonomy.md` (new-runtime-dependency hard stop), `.claude/rules/cc-suite.md`
  (high-risk review category), `.claude/rules/client-local-first.md` (offline posture),
  `.claude/rules/evidence-genie.md` (manual-truth invariant 2).
