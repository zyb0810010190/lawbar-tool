# Forms-spec design note — A10-T3/T4/T5 from real samples (FORMS-SPEC-A10-T3-T5-00)

**Date**: 2026-07-02. **Type**: DESIGN / SPEC note (documentation only; no product code, no schema, no
render). **Lane**: WI-FORMS-SPEC-A10-T3-T5-SAMPLE-ADR-00 (§0–§G); **amended by** WI-FORMS-T3-Q1-Q4-DECISION-RECORD-00
(§H, DR-00). **Status**: design input for a *future* forms PLAN WI — **not** implementation-authorizing.

> **AUDIENCE (DR-00, 2026-07-02 — see §H):** these forms are **internal lawyer trial-review tools**, NOT
> court-filing artifacts in this phase. Where §0–§G describe the samples as "court-fileable / court work-product"
> that is the *sample's* origin and the A10 program name; the **product use is internal trial review**, so no
> court-template compliance, signature/seal, or custody/tamper-evidence is required this phase (§H governs).

This note grounds the still-gated A10-T3/T4/T5 court-work-product forms in two REAL user-provided samples so a
later forms PLAN WI has a concrete reference instead of invention. It authorizes **no** implementation. Per
`docs/adr/ADR-evidence-a10-court-fileable-export.md` §10 the form-field layouts remain gated behind a
product/legal form-spec; this note records what the samples show and what remains undecided — it is that spec's
first evidence, not its conclusion.

## 0. Sample provenance (input-only, NOT committed)

Two local, untracked input files under `dev-memo/run/intake/forms-samples/` (kept unstaged — raw client
material never enters git):
- **T3 reference** — `孙乐驰-证据目录及说明-一审.pdf` (a filed 证据目录及说明, 2 pages, 25 evidence rows;
  scanned/image PDF — no text layer).
- **T5 reference** — `【一审】质证意见-孙乐驰20260629.docx` (a filed 质证意见 narrative brief; ~60 paragraphs).

Both are one real 劳动合同纠纷 (labor-contract dispute) first-instance (一审) case. They are a single data point,
not a template authority — see §5 non-decisions and §6 open questions.

## A. T3 — 证据目录及说明 (evidence catalogue + description)

Observed structure (from `孙乐驰-证据目录及说明-一审.pdf`, treated as the current visual/content reference):

1. **Title** (centered): `证据目录及说明`.
2. **提交人诉讼地位：** a checkbox status — the sample shows `☑原告` (submitter's litigation status;
   原告/被告 selectable).
3. **名称/姓名：** the submitter name field — sample `孙乐驰`.
4. **Evidence table** — exactly four columns:
   | # | Column | Sample content |
   |---|---|---|
   | 1 | `序号` | 1, 2, 3 … 25 (sequential) |
   | 2 | `证据名称` | e.g. `劳动合同`, `续订劳动合同协议书`, `深圳市社会保险历年参保缴费明细表` |
   | 3 | `证明内容` | per-item proof statement, often multi-clause: `1、证明原告与被告存在劳动关系；2、证明原告的工龄情况。` |
   | 4 | `页码` | **physical bundle page ranges**: `1-5`, `6-7`, `8-9`, `10-11`, `29-30`, `41-49`, `50-61`, `62` … |
5. **Numbered evidence rows** — 25 rows in the sample (continuing across both pages).
6. **Footer note** (copies/originals): `注：以上证据均为复印件(原件请特别注明，未填写完时可用续页)`.
7. **Signature block** — a two-column footer:
   - left: `提交人签名及电话：` then `提交时间：`
   - right: `签收人：` then `签收时间：`

**Load-bearing observations (spec-shaping, not decisions):**
- The sample's evidence-description column header is **`证明内容`** (not `证明目的`). The lawyer-entered
  per-item proof statement is free text.
- The `页码` column in this sample is **the physical bundle page range** (start–end of the item within the
  paginated evidence bundle), **NOT** the A10 `卷X页Y` citation form. This is the single most important open
  decision for T3 (§6 Q4).
- Every field except the citation/page range is either existing catalogue data (`证据号`/order, title, party,
  physical page start/end per `docs/product/evidence-m0-content-inventory.md` surface 4) or a short
  lawyer-entered string (证明内容) or a signature/date block (人-facing, likely blank at export).

**T3 is the best first implementation candidate after spec approval** — its columns map almost entirely to data
the tool already holds (evidence items, order, titles, physical page ranges), the per-item 证明内容 is a single
free-text field, and it needs no new proof/三性 model. It is a table over existing evidence data plus a
static header/footer — the lowest-risk of the three forms.

## B. T5 — 质证意见 / 质证记录 (cross-examination)

Observed pattern (from `【一审】质证意见-孙乐驰20260629.docx`, treated as a **narrative 质证意见 brief**, NOT a
finalized structured table):

1. **Case-number header**: `粤0304民初15872号、16806号`.
2. **Title**: `质证意见`.
3. **Salutation**: `尊敬的审判庭：`.
4. **Intro**: `孙乐驰诉航天建设集团深圳有限公司劳动合同纠纷一案，原告孙乐驰发表质证意见如下：`.
5. **Body organized by OPPOSING evidence**, one section per item (`一、二、三…`), each keyed to the opposing
   evidence number + name (e.g. `关于被告提交的证据一《薪酬制度管理办法》`). Each section:
   - States the **三性** position — 真实性 / 合法性 / 关联性 — as accept / reject / **partial** (the sample shows
     all three: `真实性、合法性、关联性均不予认可`; and partial: `对该证据的形式真实性予以认可，但…合法性、关联性…不予认可`).
   - States whether **证明目的** is accepted (`证明目的不予认可` / `予以认可`).
   - Gives **factual/legal reasons** (`第一…第二…第三…`), citing statutes (e.g. 《劳动合同法》第四条) and
     **cross-referencing the party's own evidence numbers** (e.g. "根据原告提交的证据《中国建设银行…》").

**This informs T5 but does NOT yet define a structured 质证记录 table.** The sample is a free-form legal brief:
its 三性 stance + 证明目的 + reasons are prose, not normalized fields, and the "contradiction citations" the
handover names (`per-opposing 三性 + reasons + contradiction citations`) appear here only as inline narrative
references, not as a citation-linked data structure. T5 therefore needs a product decision: **generate the
narrative 质证意见 brief, or a structured 质证记录 table (or both)** — see §6 Q5.

## C. T4 — 举证质证表 (proof / cross-examination table)

**Still under-specified. No sample provided; no fields designed here** (designing them would be invention,
forbidden by ADR §10). T4 needs a product/legal **proof model** before any PLAN WI:
- **争议焦点 / claim / issue** — the disputed points the table is organized around.
- **证明对象** — what each claim/element must prove.
- **linked evidence** — which of our evidence items support each 证明对象.
- **citation** — how each link cites (卷X页Y via A10-T1, and/or the T3-style 页码 range).
- **proof-gap rule** — the rule that flags a 证明对象 with insufficient/absent supporting evidence.

None of these exist as data or as a decided rule. T4 remains fully design-gated.

## D. Decision — recommended sequence

1. **T3 证据目录及说明 first** — most data already exists; a table + static header/footer/signature block over
   existing evidence items. Proceed to a later PLAN WI **after this forms-spec note is reviewed and governed**
   AND the T3 open questions (§6 Q1–Q4) are answered.
2. **T5 质证意见 / 质证记录 design second** — the narrative sample informs it, but a structured-vs-narrative
   decision (§6 Q5) is required before a PLAN WI.
3. **T4 举证质证表 only after the proof-model decisions** (§C / §6) are made.

T3 **may proceed** to a later PLAN WI once this note is governed and Q1–Q4 are resolved. **T4 and T5 remain
design-gated** — this note does not prove their required fields are sufficient.

## E. Explicit non-decisions (this lane approves NONE of these)

- **No schema mutation approved.** Whether T3/T5/T4 need new persisted fields is undecided (§6 Q7); any new
  field triggers a separate schema ADR + explicit approval, and `CURRENT_SCHEMA_VERSION` is unchanged here.
- **No DOCX/PDF renderer implementation approved.** The rendered output target (§6 Q2) is undecided; A10-T6 /
  the CanonicalExportModel is the *logical* layer, not a `.docx`/PDF writer.
- **No custody / seal / tamper-evidence approved.** If forms must be sealed, that is A8 snapshot/seal design,
  not this note and not direct A10 (§6 Q8).
- **No court-specific jurisdiction variant approved** beyond what the single sample shows (a 深圳 一审
  劳动争议 filing). One sample is not a multi-court template authority.
- **No A8 implementation approved.**
- **No forms implementation approved in this lane.** This is a design/spec note only.

## F. Open questions (must be answered before the respective PLAN WI)

1. **T3 audience** — is 证据目录 for internal lawyer review first, or direct court filing? **RESOLVED (§H, DR-00
   2026-07-02): internal lawyer trial-review tool; NOT direct court submission; NOT an official court-filing
   artifact in this phase.**
2. **T3 export format** — DOCX first? **RESOLVED (§H): lawyer-review DOCX first (lawyers may edit/annotate); an
   app preview/table view may follow later; PDF NOT required this phase unless separately authorized. This note
   does NOT implement any of them.**
3. **T3 description column** — `证明内容` vs `证明目的`? **RESOLVED (§H): use the sample label `证明内容`; do NOT
   replace with `证明目的` unless a later product/legal review requires it.**
4. **T3 `页码` meaning** — physical bundle page range vs `卷X页Y`? **RESOLVED (§H): physical bundle page range
   first (matching the sample); the A10 `卷X页Y` citation may be supporting metadata later but does NOT replace
   the sample's `页码` field.**
5. **T5 output shape** — generate the **narrative 质证意见 brief** (matching the sample), a **structured
   质证记录 table**, or both? A structured table needs a normalized 三性 + 证明目的 + reasons + contradiction-
   citation model that the sample does not supply.
6. **M0 vs post-v1** — are T4/T5 in M0 scope or post-v1? (`docs/product/project-requirements-brief.md`
   status:READY §"Export (post-v1)" flags proof-matrix exports as post-v1 STOP-AND-ASK, while the PRD lists the
   three forms as an M0 promise — a `RECONCILIATION-NEEDED` to settle.)
7. **New persisted fields** — do T4/T5 (or a structured T5) require new schema fields (证明对象, 三性 per
   opposing item, proof-gap, contradiction links)? If yes → schema ADR + explicit approval before any impl.
8. **Lawyer review / freeze before export** — is a lawyer sign-off / freeze required before a form export is
   produced (and is the export sealed/tamper-evident → A8)?

## G. Status

- **T3 证据目录及说明** — concrete structure captured from a real filing; **best first candidate**; its blocking
  open questions **Q1–Q4 are now RESOLVED** (see §H) → **T3 is eligible for a later implementation PLAN WI**.
  NOT implemented here (this lane records decisions only; implementation is a separate governed WI).
- **T5 质证意见 / 质证记录** — narrative sample captured; **design-gated** pending Q5/Q6.
- **T4 举证质证表** — **design-gated** pending the proof-model + Q6.
- No code, schema, fixture, IPC, native, custody, JS-shim, A8, renderer, or DOCX/PDF-generation performed. Raw
  samples stay untracked input under `dev-memo/run/intake/forms-samples/`.

## H. Decision record DR-00 — internal trial-review audience + T3 Q1–Q4 (2026-07-02)

**New product decision (user, 2026-07-02):** these forms do **NOT** need to be submitted to the court. They are
**internal lawyer trial-review tools** — used to make it easier for a lawyer to review evidence during trial
(quick evidence lookup, review, and argument preparation). Therefore, **in this phase**:

- T3/T4/T5 are **NOT court-filing artifacts**.
- **No court-specific official-template compliance** is required.
- **No signature/seal placement** is required.
- **No custody / seal / tamper-evidence** is required.

### Consequences of the internal-review decision
- Court-specific template compliance, signature/seal placement, and custody/tamper-evidence are **OUT OF SCOPE
  for this phase**.
- **A8 custody/snapshot/seal is NOT implicated** by this internal-review decision (an internal review tool need
  not be sealed). A8 remains its own separate, unstarted area.
- The **design goal is lawyer usability during trial** — fast evidence lookup, on-screen/review-doc convenience,
  and argument preparation — not court-format fidelity.

### T3 Q1–Q4 resolutions (unblock a later T3 PLAN WI)
| Q | Decision |
|---|---|
| **Q1 audience** | Internal lawyer review during trial. NOT direct court submission. NOT an official court-filing artifact in this phase. |
| **Q2 export format** | Prefer a **lawyer-review DOCX first** (lawyers may edit/annotate). An app preview/table view may be useful later; **PDF not required** this phase unless separately authorized. This lane implements **none** of them. |
| **Q3 description label** | Use the sample label **`证明内容`** for T3. Do NOT replace it with `证明目的` unless later product/legal review requires that wording. |
| **Q4 `页码` meaning** | Use the **physical bundle page range** first (matching the sample). The A10 `卷X页Y` citation may be **supporting metadata later**, but does NOT replace the sample's `页码` field. |

### Effect on gating
- **T3** — Q1–Q4 resolved → **eligible for a later implementation PLAN WI**. This lane does **NOT** authorize T3
  implementation; a separate governed PLAN WI (with its own review/audit) is still required, and if it turns out
  to need new persisted fields that triggers the schema ADR + explicit approval (Q7).
- **T4 举证质证表** — **remains under-specified** (proof-model undecided; §C / §F Q6–Q7).
- **T5 质证意见 / 质证记录** — **remains design-gated**; the sample is a **narrative 质证意见**, not a finalized
  structured 质证记录 table (§B / §F Q5).
- **The §E explicit non-decisions still hold in full**: no schema mutation, no DOCX/PDF renderer implementation,
  no custody/seal/tamper-evidence, no A8, and **no forms implementation** are approved by this note. DR-00
  narrows the audience/scope; it does not authorize building anything.

## References
- `docs/adr/ADR-evidence-a10-court-fileable-export.md` (A10-DESIGN-00 §5/§7/§10/§13 — forms gated behind a
  product/legal form-spec).
- `docs/reference/evidence-genie-m0-developer-handover.md` §A10 (T3/T4/T5 epic descriptions).
- `docs/product/evidence-m0-content-inventory.md` (surface 4 证据目录, surface 10 export package).
- `docs/product/project-requirements-brief.md` (status:READY; export-scope reconciliation, §"Export (post-v1)").
- `dev-memo/evidence-a10-closeout-00.md` (A10 non-gated pipeline CLOSED; T3/T4/T5 product-legal-gated).
