# Product Plan

**The single place for work not yet built.** Consolidated 2026-08-12 from eleven separate
lane documents under `dev-memo/`, each carried in verbatim below.

## What is and is not in here

The rule that decides membership: **a plan describes work not yet built. A plan for work
already shipped is a *record*, not a plan.**

| | Where it lives | Why |
|---|---|---|
| Work not yet built | **This file** | — |
| What the product is, and how it looks | `docs/product/product-definition.md` | Description, not plan |
| Why a technical decision was made | `docs/adr/**` | The product brief states ADRs **outrank** it on the decision each documents; folding them in would invert that |
| Plans for work already shipped | `dev-memo/*.md`, unchanged | They are records. Production source cites them 77 times; merging them would break those references and turn history into a roadmap |

None of the eleven sources merged here was cited by source code — verified before merging, which
is why they could move.

> **Repaired 2026-08-12.** The absorbed sections below were written while
> `.claude/rules/autonomy.md` was the hard-stop authority. That file was deleted in the
> 2026-08-10 configuration reset, and its product hard-stops now live in
> `docs/product/product-definition.md` Part I §20, which is self-contained and authoritative.
> **Every such citation below has been repointed there.** This is forward-looking plan text, not
> a historical record — a plan citing a deleted authority is a live defect, so the references
> were repaired rather than annotated. The original wording named `.claude/rules/autonomy.md`.

## Sequenced overview

Ordering reflects what blocks what, not effort.

**Blocking everything Evidence-related**
- **A0.7 renderer-conformance** is PROVISIONAL, not green. **Updated 2026-08-29 — the reason has
  changed, the conclusion has not.** Five of the six defects in the lane below are closed (D1 NaN
  blindness, D2 box-only oracles, D3 empty sample points, D4 sample-resolution classification, D6
  stability-mode NaN). What remains is **D5: nothing can prove the gate ran.** The marker writer and
  validator were deleted 2026-08-10, and the audit preceding that deletion found agent-side
  attestation is not a trust boundary at all. So A0.7 cannot be called green — not because the
  harness is known wrong, but because no artifact here is entitled to assert it is right.
  No Evidence UI ships until it is genuinely green; a class-2 result reopens the geometry-source
  assumption entirely. Detail: `docs/product/product-definition.md`.

  **A scope limit worth stating plainly**, because nothing else in this repo says it: A0.7's entire
  evidence base is five hand-authored synthetic PDFs totalling 1,907 bytes, the largest 432. Real
  client documents can never enter this repo, so a synthetic corpus is forced — but "A0.7 green"
  could therefore only ever mean "PDFKit measured five minimal handmade byte streams reproducibly",
  which is a narrower claim than the phrase suggests.

  *The lane referred to below as missing now exists — it is §0 of this file, written 2026-08-12.
  The sentence claiming otherwise was stale and is removed.*

**Ship v1 (the release cluster — mostly READY, not executed)**
1. macOS Developer-ID signing + notarization — the lane is written and marked READY; it has
   not been run. Blocks any distribution to a non-developer machine.
2. Production-launch readiness — the gate list for calling v1 done.
3. Release checklist · smoke matrix · RC1 artifact handoff · CI release gates ·
   data-migration compatibility — the mechanics that make a release repeatable.

**Post-v1 features (no work started)**
4. **Forms T4** (举证质证表) — deferred post-v1; T3 shipped.
5. **Night mode / dark theme foundation** — PLAN-ONLY, 401 lines, nothing built.
6. **WeChat mini-program companion (Gate 0)** — the largest deferred item. Needs the sync
   bridge first, plus a registered Chinese business entity and a WeChat developer account.
   The decision memo is included alongside the plan because the two are only readable together.

**Standing constraint on all of the above:** every item is stop-and-ask per the product brief
§20. Nothing here is authorized by being written down.

## Contents

0. **A0.7 defect closure — the blocking lane** *(written 2026-08-12, not absorbed)*
1. WeChat Mini Program companion (Gate 0) — plan
2. WeChat Mini Program companion (Gate 0) — decision memo
3. Night-mode / dark-mode theme foundation
4. Forms T4 — 举证质证表
5. macOS Developer-ID signing + notarization
6. Desktop production-launch readiness
7. Desktop release smoke matrix
8. RC1 artifact handoff
9. Desktop local data — schema migration / upgrade compatibility
10. Desktop CI release gates
11. Release checklist

Sections 1–11 are their source documents verbatim, with heading levels shifted one deeper so the
file reads as one document. Provenance is stamped at the top of each. Section 0 was written
directly into this file — it is the one lane with no source document, which is why it did not
exist until now.

---

## A0.7 defect closure — the blocking lane

*Written directly 2026-08-12. Every claim below was verified against
`native/evidence-core-swift/Sources/EvidenceCoreSmoke/A07ConformanceHarness.swift` (460 lines) and
the oracle JSON before being written; file:line citations are the evidence.*

**Why this lane exists.** A0.7 (`renderer-conformance`) is the first real Evidence architecture
gate: it validates that PDFKit reports page geometry reproducibly enough for citations and anchors
to be stable. No Evidence UI ships before it is genuinely green. It is **PROVISIONAL, not green**,
and until 2026-08-12 it was the only outstanding item in this product with no plan at all —
including in the file you are reading.

**What "green" cannot currently mean.** The marker/attestation tooling that used to record a gate
run was deleted on 2026-08-10 with the governance layer. Nothing in this repository can presently
prove the gate ran, so "A0.7 is green" is not a claim any artifact here is entitled to make. That
is a separate gap from the four defects below and is listed last.

### D1 — NaN silently passes every tolerance check *(class-1, fixable)*

> **CLOSED for oracle mode — 2026-08-29.** `evaluate` now rejects non-finite observed geometry
> before any tolerance comparison, classified `class_2_geometry_source_instability`, covering box
> origin/extent/cropBox on every page plus the normalized sample values. Verified two-sided: the
> four NaN tests fail against the pre-change harness with real assertion failures ("pass" is not
> equal to "fail"), and disabling the guard turns the new test file red with 10 failures. Full
> Swift suite 148/0 against a 140/0 baseline. See
> `native/evidence-core-swift/Tests/EvidenceCoreSmokeTests/A07NonFiniteGeometryTests.swift`.
>
> **Stability mode CLOSED 2026-08-29 — the owner ruled: refuse.** `evaluateStability` now rejects
> non-finite observations on every capture before the canonical comparison, classified class-2.
> Agreement on a non-number is not stability. The deliberate assertion at
> `A07StabilityHarnessTests.swift:295` was updated rather than deleted, so the record shows the old
> expectation overturned rather than quietly gone. Discovered while writing the test and not
> predicted by this lane: **infinity passed in stability mode too** — oracle mode caught it via
> `abs(inf - x) > tol`, but stability mode subtracts nothing, so infinite reads agreed exactly as NaN
> did. Mutation-verified: disabling the guard turns the suite red with 7 failures. Full suite 160/0.


Every geometry comparison in the harness has the form `if abs(observed - expected) > tol` —
`A07ConformanceHarness.swift:269` (box width/height), `:276` (origin), `:289-290` (cropBox),
`:307` (normalized sample points).

In IEEE 754, `NaN > tol` evaluates to **false**. So an observation of `NaN` does not trip any
check; it passes. A grep for `isNaN` or `isFinite` across all 460 lines returns nothing — there is
no finiteness guard anywhere in the file.

**Why it matters here:** a NaN reaching the comparison means the renderer returned a
non-representable coordinate. That is precisely the condition the gate exists to detect, and it is
the one condition the gate is structurally blind to.

**Scope — this is oracle mode only.** Stability mode has a SECOND, independent NaN path:
`A07ConformanceHarness.swift:404-411` returns `pass/ok` when two reads produce identical canonical
geometry strings, and two NaN reads do. `A07StabilityHarnessTests.swift:295` asserts exactly that
— `evaluateStability(captures: [nan, nan]).status == .pass`. Arguably correct for the question
stability mode asks (did two reads agree?), but it means "stable" is reported for geometry that
is not a number.

**Closing it:** reject non-finite observations explicitly before comparison, and classify that
rejection — a NaN from the geometry source is a class-2 signal, not a normalization bug. Decide
separately whether stability mode should refuse NaN outright or keep reporting agreement.
**Acceptance:** in oracle mode, a fixture whose observed geometry contains NaN produces `fail`,
never `pass`. In stability mode, the decision is recorded either way and `:295` reflects it.

### D2 — an oracle with zero sample points can return `pass` *(class-1, fixable)*

> **CLOSED — 2026-08-29.** `evaluate` now returns `fail` / `fixture_or_oracle_invalid` when the
> oracle carries no sample points, deliberately not `inconclusive_no_checkable_assertions` — the
> oracle *does* have box assertions, so reporting none would be false; it is invalid *for the A0.7
> claim*. A new enum case was considered and rejected: this classification is court-facing and
> downstream code switches on it.
>
> **The red-test warning below did not materialise, because D3 landed first.** With the three
> oracles populated, their fixtures pass for the right reason — no assertion was flipped and
> `testMessyRotatedFixturePasses`' deliberate "must not be inconclusive" stays true. That ordering
> has a cost the lane did not anticipate: those fixtures were the invariant's only coverage, so
> `A07OracleSufficiencyTests.swift` now asserts it directly on synthetic oracles, plus a corpus test
> that every shipped oracle carries at least one sample point. Mutation-verified: disabling the
> guard → 7 failures; emptying one oracle → 1.


`A07ConformanceHarness.swift:119`:

```swift
var hasCheckableAssertions: Bool { !expected.perPageMediaBox.isEmpty || !expected.samplePoints.isEmpty }
```

The operator is `||`. An oracle carrying box assertions but **no** sample points therefore clears
the guard at `:249`, the sample-comparison loop at `:305` iterates zero times, and execution falls
through to `:315` returning `status: .pass, classification: .ok` — with the detail string
`"all N box + 0 sample assertions within tolerance"`.

So the harness can report a clean pass having never executed the coordinate-normalization check,
which is the substance of what A0.7 is supposed to verify.

**The test suite pins this behaviour as correct.** `A07ConformanceHarnessTests.swift` contains
`testMessyCropBoxFixturePasses`, `testMessyRotatedFixturePasses` and
`testMessyMixedSizesFixturePasses`, each asserting `XCTAssertEqual(r.status, .pass)` and
`.classification == .ok` for exactly the three fixtures that carry zero sample points. Verified
2026-08-12 by reading the assertions, not inferred from the names.

That matters for whoever closes this: **the fix turns three green tests red**, and the obvious
reading of a red `…FixturePasses` test is that the fix broke something. It did not — the test was
encoding the gap. Their assertion messages ("must pass with cropBox observed distinctly") describe
box-level intent, which the box assertions genuinely do check; the names simply promise more
coverage than the oracles supply.

**Closing it:** either require at least one sample point for a `pass` verdict, or introduce a
distinct status meaning "box geometry verified, normalization unverified". A run that checked no
sample points must not be reported the same way as one that checked several.
**Acceptance:** a box-only oracle yields something other than `pass/ok`, AND the three tests above
are updated to assert the new verdict — not deleted, and not reverted to green by relaxing the fix.

### D3 — three of five oracles assert no normalization at all *(fixture gap)*

> **CLOSED — 2026-08-29.** All three now carry three sample points each, derived from the documented
> construction and never back-filled from harness output. Each point discriminates against the
> plausible wrong normalization rather than merely existing: rotated proves /Rotate 90 must not swap
> width and height; cropbox proves normalization uses the mediaBox and not the cropBox (note
> `(306,396)` gives 0.5 under *either* box, so it would not have discriminated and was not used); and
> mixed-sizes sets `samplePageIndex: 1` so it proves the right page's box is used. Each
> `independenceStatement` records the derivation and the discriminator.


Measured 2026-08-12, re-counted for this lane:

| Oracle | samplePoints |
|---|---|
| `a07-renderer-conformance/oracle.json` | 5 |
| `messy/synthetic-nonzero-origin.oracle.json` | 3 |
| `messy/synthetic-cropbox.oracle.json` | **0** |
| `messy/synthetic-mixed-sizes.oracle.json` | **0** |
| `messy/synthetic-rotated.oracle.json` | **0** |

The three carrying zero are exactly the hardest renderer conditions the messy fixtures exist to
exercise — a cropBox/mediaBox mismatch, mixed page sizes, and rotation. Combined with D2, each of
them currently returns a clean pass while testing nothing about coordinates.

**Closing it:** populate `samplePoints` for those three, derived from how the fixture was
constructed — **never back-filled from harness output**, which would make the oracle agree with
whatever the code currently does. If a fixture genuinely cannot carry sample points, say so in the
oracle and in the fixtures README rather than leaving an empty array that reads as coverage.
**Acceptance:** each of the three either carries sample points or states in-file why it cannot.

### D4 — a sample-count mismatch is classified class-1, and may not be *(classification risk)*

> **CLOSED — 2026-08-29, and it was more than the comment this lane specified.** The acceptance
> criterion here was "the choice is recorded with its reasoning". Recording a policy the code
> contradicts is worse than silence, so the causes are now separated at their source in `run`:
> an out-of-range `samplePageIndex` is `fixture_or_oracle_invalid` (the oracle names a page the
> document lacks, so it cannot adjudicate the fixture); `page(at:)` returning nil for an in-range
> index is **class-2** (PDFKit's own structural report contradicts itself). The third historical
> cause — an empty `samplePoints` — is now unreachable because D2's guard rejects such an oracle
> first, and a test asserts that so neither guard can silently revive the collapse.
>
> **One branch is implemented but untested, stated rather than glossed:** there is no way to make
> PDFKit report N pages and then refuse an in-range one without a seam this harness does not have.
> Full suite 166/0; mutation widening the range guard turns the new tests red.


`A07ConformanceHarness.swift:300-303` treats `observed.sampleNormalized.count !=
oracle.expected.samplePoints.count` as `class_1_normalization_math_bug` — a fixable local bug.

The class-1/class-2 distinction is the most consequential judgement this gate makes: class-1 means
fix the normalization math; **class-2 means the geometry source itself is unstable and downstream
anchor, forms and UI work must stop**. Misclassifying a class-2 as class-1 does not produce a
visible failure — it produces continued construction on an unsound foundation.

My original framing was wrong and is corrected here: the renderer does not enumerate sample
points. `run` computes `sampleNormalized` one-for-one from `oracle.expected.samplePoints`
(`A07ConformanceHarness.swift:188-196`), so a count mismatch cannot mean "the renderer counted
differently". It means the oracle's sample page was unavailable or invalid, or `evaluate` was
called directly with mismatched inputs. The real gap is narrower: an invalid `samplePageIndex`
probably belongs in `fixture_or_oracle_invalid`, and `page(at:)` returning nil despite a correct
page count is arguably class-2 — neither has a stated policy.

The file's comments do settle the broad rule — structural geometry disagreement is class-2, wrong
normalized values after correct boxes are class-1 (`:239-244`, `:298-303`) — but they do not
address this edge.
**Closing it:** state a policy for the two unhandled causes above, in a comment at `:301`.
**Acceptance:** the choice is recorded with its reasoning, so the next reader need not re-derive it.

### D5 — nothing can prove the gate ran *(blocked on a decision, not on code)*

Even with D1–D4 closed, "A0.7 is green" is unverifiable: the marker writer and validator were
deleted on 2026-08-10, and the audit that preceded their deletion concluded that agent-side
attestation is not a trust boundary at all — the producer and the verifier ran as the same uid.

**Closing it is a product decision, not a repair.** The options are a CI job that runs the harness
where this process cannot reach it, or accepting that A0.7 status is asserted by a human rather
than attested. Either is defensible; leaving it implicit is not.
**Two artifacts already claim it is green**, and did when this lane was written:
`docs/adr/ADR-evidence-a10-court-fileable-export.md:33` and `:106` both say A0.7 is "meaningfully
green". Corrected 2026-08-12 — but the acceptance criterion below was false at the moment I wrote
it, which is the same failure this lane exists to prevent.
**Acceptance:** the attestation choice is written down, and a repo-wide grep for claims that A0.7
is green returns only statements scoped as historical.

### Sequencing

D1, D2 and D3 are independent and can proceed in parallel — an earlier draft claimed D3 depended
on D2, which is wrong: populating the three empty oracles immediately makes those fixtures
exercise normalization, whether or not the box-only pass path is closed. D2 remains necessary so
that any FUTURE box-only oracle cannot pass. Close both before calling oracle-mode conformance
meaningful. D4 is a decision that should precede any further class-1 fix, since it governs what
"fixable" means. D5 gates the word *green*
and nothing else; D1–D4 can all close while D5 remains open.

**Nothing in this lane is authorized by being written here.** Each item is stop-and-ask per
`docs/product/product-definition.md` Part I §20.

---

## PLAN — WeChat Mini Program companion (Gate 0)

*Absorbed 2026-08-12 from dev-memo/plan-wechat-mini-program-00.md (source deleted in the same commit). Content verbatim; heading levels shifted one deeper.*


**Status**: Gate-0 plan (doc-only). **Authorizes nothing.**
**Type**: PLAN (doc-only).
**Date**: 2026-06-13.
**Author**: Claude Code.
**WI**: WI-WX0 (Gate 0 inspection + plan). No WI-WX1 is authorized by this document.

> This plan exists to record a Gate-0 finding and to scope the decision work that must
> precede any WeChat Mini Program effort. It does **not** authorize implementation, a Mini
> Program skeleton, a bridge, an API service, new dependencies, cloud/public deployment, or
> any contact with real matter data. Every item below that touches a hard stop in
> `docs/product/product-definition.md` Part I §20 remains an explicit STOP-AND-ASK.

### 1. Backend / API finding — **Category B**

Shared DTOs / handlers / contracts exist, but **no deployable internet-ready backend
exists** — the only product transport is desktop Electron IPC.

#### 1.1 Reusable surfaces that DO exist (path evidence)

- `docs/contracts/case-box-contract/` — typed contract package (`src/`, `schemas/`,
  `fixtures/`, `dist/`). Vocabulary owner; reusable DTO/wire-shape source.
- `services/case-box-persistence/` — persistence **library** (`package.json`
  `main: ./dist/index.js`; no server entrypoint). In-memory + SQLite repos.
- `apps/lawbar-desktop/electron/ipc/caseBoxHandlers.ts` — typed, payload-validated request
  handlers (matter / document / deadline / docket / audit), reusable as a handler layer.

#### 1.2 Production surface that is MISSING (path evidence)

- **No deployable authenticated HTTPS backend.** No product `express` / `fastify` / `koa` /
  `http.createServer` entrypoint anywhere in `services/*` or `apps/*`. The only
  `.listen(` / `createServer` matches are TLS **test fixtures**
  (`services/ocr-worker/tests/helpers/tls-server.mjs`, `tls-fixtures.mjs`).
- **Transport is Electron IPC only.** Every handler is `ipcMain.handle(CHANNEL.*, …)`
  (`apps/lawbar-desktop/electron/ipc/caseBoxHandlers.ts`, `electron/main.ts`,
  `electron/preload.mts`). A Mini Program cannot reach Electron IPC.
- **No product HTTP route / server.** No inbound API server; the only gateway-shaped ADRs
  (`docs/adr/ocr-fetcher-https-*`) are *outbound*-fetch security, not an inbound API. The
  `ocr-ui-gateway-architecture.md` ADR referenced by `client-local-first.md` does **not**
  exist on disk.
- **No auth provider / session surface.** No `passport` / `jsonwebtoken` / `jwt` / `oauth` /
  `bcrypt` / `bearer`. Apparent "auth" grep hits are domain vocabulary only
  (`EXTERNAL_OCR_AUTHORIZED` event kinds, the word `session`).
- **Persistence is local SQLite / in-memory, not a network data plane**
  (`better-sqlite3`; `services/case-box-persistence/src/sqlite/`, `…/inMemory*`).

#### 1.3 Why B, not A or C

- **Not A** — Category A requires a deployable authenticated HTTP service with tenant/matter
  authorization. None exists.
- **Not C** — Category C is raw local IPC with nothing reusable. Reusable contracts,
  handlers, and a persistence library *do* exist beyond IPC.
- → **B**: reusable DTO/handler/persistence surfaces present; no deployable internet-ready
  backend; desktop IPC only.

### 2. Gate 0 outcome — **HOLD**

The repo was inspectable and this plan could be written, so Gate 0 is **HOLD**, not BLOCKED.

`Gate 0: HOLD` means: planning may proceed; *implementation* may not. The implementation
block is recorded separately in §3 — do not conflate the two. (Gate 0 = "could we inspect
and plan?" → yes → HOLD. Implementation gate = "may we build?" → no → blocked, §3.)

### 3. Implementation status — **BLOCKED**

Blocked pending explicit user authorization for the backend / auth / cloud / legal / entity /
filing decisions enumerated in §4.

**Reason.** Reusable DTO / handler / persistence surfaces exist (§1.1), but:

1. The required **Category-A authenticated HTTPS backend does not exist** (§1.2). A WeChat
   Mini Program can only talk to an internet-reachable HTTPS API with auth and tenant/matter
   authorization — there is nothing for it to consume.
2. **Legal / entity / filing / compliance prerequisites are not proven** — no China business
   entity, no ICP filing, no 小程序备案 (Mini Program registration), no service-category
   qualification, no PIPL / sensitive-PI review, no attorney-confidentiality analysis.
3. **Local-first confidentiality constraints remain unresolved.** `client-local-first.md`
   makes WeChat a *deferred companion only*, makes cloud/sync opt-in and never default-on,
   and lists "Public HTTP API" as a **forbidden v1 framing**. A Mini Program backend would
   expose legal-document data off the lawyer's Mac — the exact posture the rule forbids
   without deliberate, per-action authorization.

#### 3.1 Hard-stop gates that block implementation (`docs/product/product-definition.md` Part I §20)

- Choosing an auth provider.
- Choosing a cloud vendor / any public deployment mode.
- Exposing legal documents (real or production-shaped) to external/cloud services.
- New runtime dependencies.
- Public API / wire-format / schema / CLI surface introduction.

Each is an independent STOP-AND-ASK. None is satisfied. None is granted by this plan.

### 4. Next action — decision memo (not implementation)

Before any WeChat Mini Program WI may be proposed for `/cc-suite:review-plan`, author a
**decision memo** that resolves, with explicit user authorization per item:

1. **Backend-service ownership** — who builds/operates the Category-A authenticated HTTPS
   backend; in-house vs managed; reuse of `case-box-contract` DTOs + `case-box-persistence`
   handlers vs a separate service.
2. **Auth-provider choice** — identity, session model, tenant/matter authorization
   (`tenant_id` is retained in schemas for forward-compat only today).
3. **Cloud / public deployment** — vendor, region, network exposure model, and how it
   reconciles with local-first (sync bridge vs server-of-record).
4. **China entity + filings** — business entity, ICP filing, 小程序备案, service-category
   qualification required for a legal-services Mini Program.
5. **Sensitive-PI / PIPL review** — lawful basis, data minimization, cross-border transfer
   rules for legal-matter personal information.
6. **Attorney confidentiality** — privilege / confidentiality obligations when matter data
   leaves the Mac; what a companion channel may ever see (read-mostly, intentionally exposed
   subset per `client-local-first.md`).
7. **Reconciliation with local-first product promises** — explicit divergence record vs
   `client-local-first.md` + `docs/product/`, resolved through the
   client-architecture-reconcile flow, before any ADR.

The decision memo is the prerequisite artifact. Only after it is authored, its hard-stop
items explicitly authorized by the user, and any resulting ADR passes `/cc-suite:review-plan`,
may a concrete implementation WI be drafted.

### 5. Explicitly NOT authorized by this plan

- No **WI-WX1**.
- No Mini Program skeleton / source.
- No bridge / adapter / API-service implementation.
- No production-data wiring.
- No new dependency, endpoint, or deployment.

This is a Gate-0 record. It authorizes no work. The decision memo of §4 is the recommended
prerequisite next artifact (itself doc-only); it is not authorized by this plan and requires
its own go-ahead.

### Appendix A — illustrative, non-binding cost surface (NOT plan-of-record)

> **Non-binding.** The following is an *illustrative* sketch of where effort/cost would land
> IF the §4 decisions were resolved affirmatively. It is **not** a plan of record, is **not**
> estimated, and **must not be implemented in this WI**. It exists only to make the scope of
> the §4 decision memo legible.

- **Backend service** — stand up a Category-A authenticated HTTPS API (reuse contract DTOs +
  persistence handlers, or a separate service); auth + tenant/matter authorization; transport
  hardening.
- **Sync / exposure layer** — define the intentionally-exposed read-mostly subset; opt-in,
  per-matter/per-document grants; audit-event coverage for external exposure.
- **Mini Program client** — WeChat Mini Program shell consuming the HTTPS API (read-mostly +
  minimal write, per `client-local-first.md`).
- **Ops / compliance** — hosting, ICP + 小程序备案, PIPL controls, key custody, monitoring.

Each line above re-triggers one or more §3.1 hard stops and is gated accordingly.

### References

- `docs/product/product-definition.md` Part I §3 (local-first posture) — WeChat deferred companion; cloud opt-in; no public
  HTTP API in v1.
- `docs/product/product-definition.md` Part I §20 — hard-stop list (auth provider, cloud vendor, external
  document exposure, new deps, public API).
- the deleted .claude/rules/security-boundary.md rule — security-sensitive surface discipline.
- the deleted .claude/rules/cc-suite.md rule — review-plan broker; required before any high-risk impl WI.
- `docs/contracts/case-box-contract/`, `services/case-box-persistence/`,
  `apps/lawbar-desktop/electron/ipc/caseBoxHandlers.ts` — Category-B evidence (§1.1).

---

## DECISION MEMO — WeChat Mini Program companion (Gate 0)

*Absorbed 2026-08-12 from dev-memo/decision-wechat-mini-program-gate0-00.md (source deleted in the same commit). Content verbatim; heading levels shifted one deeper.*


**Status**: decision memo (doc-only). **Authorizes nothing.**
**Type**: DECISION-MEMO (doc-only).
**Date**: 2026-06-13.
**Author**: Claude Code.
**Input evidence**: WI-WX0 plan commit `1b34bb4`
(§1 of this plan) — backend/API finding **Category B**, Gate 0
**HOLD**, implementation **BLOCKED**.

> This memo resolves what it can from repo evidence and **explicitly marks unresolved** every
> item that depends on a hard-stop decision (`docs/product/product-definition.md` Part I §20) or an external fact
> not present in the repo. A memo cannot grant a hard-stop authorization; only the user can.

### Repo constraints carried in (input, not re-decided here)

- Backend/API finding = **Category B** (reusable DTO/handler/persistence surfaces exist; no
  deployable internet-ready backend; Electron IPC only).
- **No Category-A authenticated HTTPS backend exists.**
- `client-local-first.md`: WeChat = **deferred companion only**; cloud/sync **opt-in, never
  default-on**; **"Public HTTP API" is a forbidden v1 framing**.
- hard-stops (product-definition Part I §20): auth-provider choice, cloud vendor / public deployment, external
  document exposure, new runtime dependencies.

### Decisions

#### 1. Move from local-first-only to local-first-plus-internet-reachable backend?
**UNRESOLVED — requires explicit user authorization.** A WeChat companion structurally
requires an internet-reachable HTTPS backend. That crosses the `client-local-first.md`
posture (cloud opt-in, never default-on; no public HTTP API in v1). The repo does **not**
authorize the move; it is a deliberate product-direction decision the user must make, then
reconcile via the client-architecture-reconcile flow. **Default state: NOT allowed.**

#### 2. Who owns the backend service operationally?
**UNRESOLVED.** No backend exists, no owner is recorded. Candidate shapes (not selected):
reuse `case-box-contract` DTOs + `case-box-persistence` handlers behind a new service vs a
separate service; in-house operation vs managed hosting. Ownership + operational
responsibility (on-call, patching, key custody) must be named before any build.

#### 3. Should a Category-A authenticated HTTPS backend be built?
**UNRESOLVED — gated by #1.** Technically it is the prerequisite for any Mini Program. But it
cannot be authorized until #1 (product-direction move), #4 (auth), #5 (cloud), and #6
(exposure) are resolved. **Default state: do not build.**

#### 4. Auth-provider decision required?
**REQUIRED; provider NOT selected.** A Mini Program backend needs identity + session +
tenant/matter authorization (today `tenant_id` is forward-compat-only, no auth surface
exists). Choosing an auth provider is an **hard stop** (product-definition Part I §20) — STOP-AND-ASK. This
memo records that the decision is required and **does not select one** (no prior
authorization exists).

#### 5. Public cloud / public deployment allowed?
**UNRESOLVED — hard stop; vendor NOT selected.** Cloud vendor and public deployment are
hard stop (product-definition Part I §20)s and conflict with the local-first default-off posture. This memo
records the decision is required and **selects no vendor and no deployment mode** (no prior
authorization exists). **Default state: not allowed.**

#### 6. Expose legal matter metadata or documents to an external service?
**NOT ALLOWED by default → document/file content is OUT OF SCOPE.** Exposing legal documents
(real or production-shaped) to external/cloud services is an hard stop (product-definition Part I §20) and a
`client-local-first.md` forbidden framing. Until #1 is authorized with an explicit,
per-action, opt-in exposure model, **file/document content stays out of scope entirely**, and
even matter *metadata* exposure remains unresolved (a companion may at most see an
intentionally-exposed, read-mostly subset — not defined here).

#### 7. China entity, ICP domain, 小程序备案, legal-services category qualification?
**UNRESOLVED — no repo evidence any exist.** A legal-services Mini Program requires a China
business entity, an ICP-filed domain, 小程序备案 (Mini Program registration), and
service-category qualification. None is present or referenced in the repo. All four are
**open external prerequisites** that must be proven before implementation.

#### 8. PIPL / confidentiality review required before implementation?
**YES — required and not yet done.** Before any implementation, the following must be
completed: PIPL sensitive-personal-information handling analysis, **separate consent**,
notice, **personal-information protection impact assessment (PIPIA)**, **data-residency**
determination, **retention/deletion** policy, and **attorney-confidentiality / privilege**
review for any matter data that would leave the lawyer's Mac. None exists today. These are
hard prerequisites, not parallel work.

#### 9. Next technical artifact — ADR or remain HOLD?
**Remain HOLD.** An architecture ADR would presuppose a direction on the #1/#5/#6 hard stops
that the user has not authorized; drafting it now would encode a forbidden-by-default posture
as if decided. The correct next artifact is **user resolution of the #1–#8 hard stops**, not
an ADR.

### Unresolved-decision summary

| # | Decision | State | Why |
|---|----------|-------|-----|
| 1 | Local-first → +internet backend | UNRESOLVED (default: no) | product-direction hard stop |
| 2 | Backend operational owner | UNRESOLVED | none recorded |
| 3 | Build Category-A HTTPS backend | UNRESOLVED (default: no) | gated by 1/4/5/6 |
| 4 | Auth provider | REQUIRED, not selected | hard stop |
| 5 | Public cloud / deployment | UNRESOLVED (default: no), no vendor | hard stop |
| 6 | External exposure of matter data | NOT ALLOWED by default | hard stop; content out of scope |
| 7 | China entity / ICP / 备案 / category | UNRESOLVED | no repo evidence |
| 8 | PIPL + confidentiality review | REQUIRED, not done | legal prerequisite |
| 9 | ADR vs HOLD | HOLD | ADR would presuppose unauthorized direction |

### Recommendation — **KEEP HOLD**

**KEEP HOLD — no implementation, no ADR yet.**

Rationale: every load-bearing decision (#1, #5, #6 in particular) is an unresolved hard stop
defaulting to *not allowed*, and the legal/entity/compliance prerequisites (#7, #8) are
unproven. There is no evidence in the repo resolving any hard stop, so neither
`AUTHORIZE ADR ONLY` nor `AUTHORIZE WI-WX1 PLANNING ONLY` is justified. The project stays at
Gate-0 HOLD until the user explicitly resolves the #1–#8 items above. The next step is a
user decision, not a further technical artifact.

### References

- §1 of this plan (commit `1b34bb4`) — Gate-0 plan, Category-B
  finding, HOLD/BLOCKED.
- `docs/product/product-definition.md` Part I §3 (local-first posture) — WeChat deferred companion; cloud opt-in; no public
  HTTP API in v1.
- `docs/product/product-definition.md` Part I §20 — hard-stop list.
- the deleted .claude/rules/security-boundary.md rule, the deleted .claude/rules/cc-suite.md rule — security + review
  discipline for any future high-risk WI.

---

## Plan: Night-Mode / Dark-Mode Theme Foundation (PLAN-ONLY)

*Absorbed 2026-08-12 from dev-memo/plan-night-mode-foundation-00.md (source deleted in the same commit). Content verbatim; heading levels shifted one deeper.*


> **ENUMERATION + DESIGN ONLY.** This document specifies the theme-foundation contract that any future Mac-client UI must implement. It does NOT author UI code, does NOT make a desktop framework decision (Electron / Tauri / native — STOP-AND-ASK per brief §20 + `dev-memo/plan-client-00.md` §6), does NOT add any new runtime dependency, does NOT activate production, does NOT make legal / vendor / signing / external-exposure decisions. Each follow-up implementation WI requires SEPARATE explicit user authorization.

**Status**: READY (revision 2 — Path 1 native --background rev-1 review returned READY (Low-risk clarifications) with 2 Mediums + 5 Lows; rev-2 applied all 7: §1 `surface-elevated` target relaxed to "color OR shadow" (M D1#1); §5 lint guarantee tightened ("lint OR manual audit at first UI WI before merge" — M D2#2); §3.2 path wording softened to "suggested persistence location pattern" (L D4#3); §7 explicit non-relaxation of brief §20 hard-stops added (L D5#2); token-module shape noted as TS-canonical-with-schema-equivalent-otherwise (L D3#1); §2 palette flagged "NOT brand/design final" (L D4#4); §6 ratios flagged "approximate, accurate to ±0.05" with CI contrast check as authoritative (L D1#2)).
**Date**: 2026-05-23.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Lane**: plan-only UI/theme — night-mode foundation.
**Predecessor**: blueprint at `1b92c58`; legacy reconciliation at `546fb09`; amendments WI #1-#4 + WI #8 at `b5c7d9f` on `origin/main`. Phase B SQLite COMPLETE at `98446aa`.

### Review packet (compact)

#### Active plan summary

The current repo has **zero UI implementation** per `docs/ui/current-ui-map.md` (exhaustive search at the time it was authored; verified again in this WI's survey at HEAD `b5c7d9f`). The brief §3-§4 locks v1 as a Mac desktop application; `dev-memo/plan-client-00.md` §6 + brief §20 keep the framework choice (Electron / Tauri / native) as STOP-AND-ASK. Therefore night-mode work today is **theme-foundation contract authoring** — defining the semantic token system that any future UI scaffolding will adopt from day one, NOT migrating existing components (because none exist).

This plan defines:

1. **§1 Semantic theme tokens** — 12 named tokens (10 user-requested + 2 derived) with WCAG-AA contrast targets.
2. **§2 Light + Dark palettes** — actual sRGB hex values for each token in each mode, with computed contrast ratios for the load-bearing pairs.
3. **§3 System / Light / Dark mode behavior** — System mode follows OS preference (macOS NSAppearance via Electron `nativeTheme` or Tauri equivalent); user override persisted locally; precedence rules.
4. **§4 No-hard-coded-color rule** — every UI component reads tokens; lint or build-time enforcement strategies for both Electron-renderer and Tauri-webview candidates.
5. **§5 Migration-target inventory** — there are **zero** components to migrate today. The plan instead defines acceptance criteria for the FIRST UI WI ("every screen reads only theme tokens; no raw hex / rgb / hsl literals outside the token module").
6. **§6 Contrast verification** — each token pair documented + computed contrast ratio + WCAG-AA target.
7. **§7 STOP-AND-ASK gates** — framework choice; renderer UI framework choice; new runtime dependency (e.g., color library or contrast checker); Apple Developer ID + notarization (orthogonal to theme; flagged for completeness).
8. **§8 Suggested follow-up WIs** — each separately authorized.

Plan-only file: §3 of this plan (THIS FILE).

#### Exact target files (THIS plan-WI)

CREATED (single file):
- §3 of this plan — THIS FILE.

NOT touched by this plan-WI's commit:
- `docs/ui/**` (the UI design surface; this file is upstream of any UI doc edit).
- `docs/release/go-live-plan.md` (legacy plan; preserved post-WI-#8).
- `docs/product/product-definition.md` Part I (brief is READY; amend in place).
- `docs/adr/**`.
- `services/**`, `docs/contracts/**`.
- AGENTS.md.

#### Exact acceptance criteria (this plan-WI itself)

1. Plan committed alone (one file).
2. §1 enumerates the 10 user-requested semantic tokens + the 2 derived tokens needed to make the contract complete.
3. §2 specifies a full Light palette + full Dark palette with actual sRGB hex values.
4. §3 specifies System / Light / Dark mode behavior — precedence rules, persistence model (local file path under `~/Library/Application Support/lawbar/`), and a tri-state semantic ("System | Light | Dark").
5. §4 specifies how the no-hard-coded-color rule will be enforced — design rule + lint strategy + token-module export shape (framework-agnostic).
6. §5 declares the migration target inventory: zero existing components; first UI WI is greenfield.
7. §6 computes contrast ratios for each load-bearing token pair and flags any pair below WCAG-AA (4.5:1 body text; 3:1 large text / UI components / focus ring).
8. §7 enumerates the STOP-AND-ASK gates inherited from brief §20 that apply to this work.
9. §8 lists bounded follow-up WIs (each a SEPARATE authorization) that turn this contract into shipped UI.
10. cc-suite review-plan returns READY (or only Low-risk clarifications remain) via Path 1 native `--background`.

#### Exact out-of-scope list

- **Authoring any UI code** (zero TS / TSX / JSX / Vue / Svelte / HTML / CSS / SCSS files exist or will be created in this lane).
- **Choosing the desktop framework** (Electron / Tauri / native — brief §20 + plan-client-00 §6 STOP-AND-ASK).
- **Choosing a renderer UI framework** (React / Solid / Vue / Svelte / etc. — brief §20 STOP-AND-ASK).
- **Adding any new runtime or dev dependency** (no color libraries, no theme libraries, no contrast checkers added in this lane).
- **Editing `docs/ui/**`, `docs/release/**`, `docs/product/**`, `docs/adr/**`, or any service / contract / test code.**
- **Apple Developer ID / signing / notarization** decisions (orthogonal STOP-AND-ASK).
- **Production activation / deployment / external document exposure** — all hard-stops; user-only.
- **`git push`** (separate explicit authorization).
- **Implementing the follow-up WIs in §8** (each a SEPARATE authorization).

#### Essential references

- `docs/product/product-definition.md` Part I §3 (platform ranking), §4 (Mac app expectations — offline default, no telemetry, signing STOP-AND-ASK), §20 (hard-stop list — framework, renderer, runtime deps).
- `dev-memo/plan-client-00.md` §3-§6 (architecture decision matrix; framework caveat in §6).
- `docs/ui/current-ui-map.md` (baseline zero — no UI code in repo).
- `docs/ui/ui-state-contract.md` (state contract derived from backend; not theme-related but useful frame).
- `docs/ui/ui-gap-report.md` (gaps between contracts and a future UI).
- `docs/ui/sync-bridge-contract-draft.md` (companion channel — post-v1; not theme-related).
- `dev-memo/plan-go-live-readiness-00.md` gate #3 (Mac-client surface — OPEN) + gate #4 (distribution + signing — STOP-AND-ASK).
- `docs/product/product-definition.md` Part I §20.
- WCAG 2.1 §1.4.3 (contrast minimum) + §1.4.11 (non-text contrast) — referenced by name only; do NOT cite external URLs.

#### Review questions for the reviewer

1. **Scope discipline**: is this correctly framed as theme-foundation CONTRACT authoring (no UI code, no framework decision)? Does §"Scope discipline" at the top + the header banner adequately prevent reading the file as authorization to implement?

2. **Token completeness**: §1 enumerates 12 tokens (10 user-requested + 2 derived: `text-on-accent` and `surface-elevated`). Are the 2 derived tokens necessary, or should they wait for a follow-up WI? Plan picks: include them because focus-ring on top of accent and elevated card surfaces are basic Mac-app affordances; omitting them forces hard-coded values in the first UI WI.

3. **Palette choices**: §2 specifies actual sRGB hex values. The values target WCAG-AA contrast against the corresponding `background` / `surface` token in each mode. Is the palette opinion (cool-neutral with warm-blue accent) acceptable as a starting point, or should §2 only declare contrast-ratio TARGETS and defer actual values to a follow-up WI? Plan picks: declare actual values so the first UI WI has a concrete starting point; reviewer may push to "targets only".

4. **System mode persistence**: §3 specifies persistence at `~/Library/Application Support/lawbar/theme-preference.json` (or equivalent — exact path defers to the framework WI). Is naming a concrete file path acceptable when the framework isn't chosen? Plan picks: name it as a placeholder pattern; the framework WI may relocate it.

5. **Lint enforcement**: §4 proposes a lint rule + a CI check on the token-module boundary. The actual lint tool depends on the framework (Electron-renderer typically eslint; Tauri-webview may use eslint or Biome). Plan picks: framework-agnostic rule definition; tool selection follows framework choice.

6. **Contrast checking strategy**: §6 documents contrast ratios INLINE in the doc (computed by hand against the palette in §2). No external tool is invoked. Is hand-computed contrast acceptable for a plan-only doc? Plan picks: yes; a follow-up WI may add a CI contrast check once the tooling story is chosen.

7. **Brief §20 hard-stop coverage**: §7 lists the STOP-AND-ASK items relevant to this work. Are any missing? Specifically: "new runtime dependency" is triggered if the first UI WI adds a color-manipulation library; the plan flags this explicitly.

---

### §1 Semantic theme tokens

12 tokens total: 10 user-requested + 2 derived (per review question 2 above).

| # | Token | Semantic role | Used for (examples) | WCAG-AA contrast target |
|---|---|---|---|---|
| 1 | `background` | App-level base canvas | Window background, full-screen empty states | n/a (base layer) |
| 2 | `surface` | First-level container above `background` | Card / panel backgrounds, dialog bodies | ≥ 1.2:1 vs `background` (visual separation only) |
| 3 | `surface-elevated` (DERIVED) | Second-level container above `surface` | Floating menus, popovers, modal dialogs, tooltips | Visual elevation via color **OR** shadow (per rev-1 reviewer M D1#1). Light palette uses pure-white surface + shadow for elevation; Dark palette uses distinct lighter color. When elevation is shadow-only, the token shares `#FFFFFF` with `surface`. |
| 4 | `text` | Primary body text | Paragraphs, labels, list items, table cells | **≥ 4.5:1** vs `background` AND `surface` AND `surface-elevated` |
| 5 | `muted-text` | De-emphasized text | Captions, secondary labels, placeholder text, helper text | **≥ 4.5:1** vs `background` AND `surface` AND `surface-elevated` |
| 6 | `border` | Hairline borders + dividers | Card outlines, table row dividers, input borders (default) | **≥ 3:1** vs `background` AND `surface` (non-text per WCAG §1.4.11) |
| 7 | `accent` | Primary interactive color | Primary buttons, links, selected state, active tabs, progress fills | **≥ 3:1** vs `background` AND `surface` (non-text) |
| 8 | `text-on-accent` (DERIVED) | Text on top of an `accent`-filled element | Button label, link inverse text | **≥ 4.5:1** vs `accent` (text on accent fill) |
| 9 | `danger` | Destructive / error state | Delete buttons, error banners, invalid input borders, critical audit findings | **≥ 3:1** vs `background` AND `surface` (non-text); when used as text, **≥ 4.5:1** vs the surface it sits on |
| 10 | `warning` | Cautionary state | Pending-review banners, deferred-Low audit findings, unsaved-changes indicator | **≥ 3:1** vs `background` AND `surface` (non-text); when used as text, **≥ 4.5:1** |
| 11 | `success` | Confirmation / positive state | Saved badge, passed-test indicator, "shipped" status pill | **≥ 3:1** vs `background` AND `surface`; when used as text, **≥ 4.5:1** |
| 12 | `focus-ring` | Keyboard focus indicator | 2px outer ring around any focused interactive element | **≥ 3:1** vs the adjacent surface (per WCAG §1.4.11 + macOS NSFocusRingType convention) |

#### Token-module shape (framework-agnostic)

Whatever framework is chosen, the token module exposes ONE shape. The TypeScript interface below is **the canonical shape if the renderer toolchain is TypeScript-capable** (Electron-renderer + Tauri-webview with a TS-capable bundler); otherwise an equivalent schema (JSON, Rust struct, etc.) must mirror the same fields and semantics (per rev-1 reviewer L D3#1):

```ts
// Conceptual shape; actual file path + tooling chosen by the first UI WI.
export interface ThemeTokens {
  readonly background: string;
  readonly surface: string;
  readonly surfaceElevated: string;
  readonly text: string;
  readonly mutedText: string;
  readonly border: string;
  readonly accent: string;
  readonly textOnAccent: string;
  readonly danger: string;
  readonly warning: string;
  readonly success: string;
  readonly focusRing: string;
}

export interface Theme {
  readonly mode: "light" | "dark";
  readonly tokens: ThemeTokens;
}
```

No raw color values flow out of the token module. Every UI component reads tokens via the module's exports (or CSS custom properties hydrated from the module).

---

### §2 Light + Dark palettes (sRGB hex values)

Opinion: **cool-neutral surfaces with warm-blue accent**. Rationale: warm-blue accent reads well against both light and dark cool-neutral backgrounds; cool-neutral surfaces avoid yellow-cast eye strain in long lawyer working sessions; the accent hue is distinct from typical macOS system accents to avoid confusion with system UI chrome.

The reviewer may push to "contrast-ratio targets only; defer actual values to a follow-up WI" (review question 3). Plan picks: declare values to give the first UI WI a concrete starting point. The values below are STARTING-POINT recommendations and are **NOT brand / design final** (per rev-1 reviewer L D4#4 wording fix); the first UI WI may adjust them ±10 lightness while preserving contrast targets in §6. Final palette + brand approval is a separate user-authorized decision.

#### §2.1 Light palette

| Token | Hex | Purpose |
|---|---|---|
| `background` | `#F8F9FA` | Window canvas — near-white with slight cool tint |
| `surface` | `#FFFFFF` | Cards, panels — pure white above the canvas |
| `surface-elevated` | `#FFFFFF` (with shadow) | Popovers / modals — elevation via box-shadow, not color |
| `text` | `#1A1D21` | Body text — near-black, not pure black to reduce contrast harshness |
| `muted-text` | `#6B7280` | Captions, secondary labels |
| `border` | `#E1E4E8` | Hairlines |
| `accent` | `#1E5EBA` | Warm blue |
| `text-on-accent` | `#FFFFFF` | Inverse text on accent-filled elements |
| `danger` | `#B42318` | Deep red |
| `warning` | `#B54708` | Burnt orange |
| `success` | `#1B7A3B` | Deep green |
| `focus-ring` | `#2B7FFF` | Bright blue ring; visible on both light surfaces and accent-filled buttons |

#### §2.2 Dark palette

| Token | Hex | Purpose |
|---|---|---|
| `background` | `#0F1216` | Window canvas — near-black with cool tint |
| `surface` | `#171B21` | Cards, panels — one step lighter than background |
| `surface-elevated` | `#1F242C` | Popovers / modals — two steps lighter |
| `text` | `#EDEEF0` | Body text — near-white, not pure white |
| `muted-text` | `#9CA3AF` | Captions, secondary labels |
| `border` | `#2A3038` | Hairlines |
| `accent` | `#5594E8` | Lighter warm blue — bright enough on dark surfaces |
| `text-on-accent` | `#0F1216` | Inverse dark text on accent-filled elements |
| `danger` | `#F87171` | Light red — readable on dark surface |
| `warning` | `#FBBF24` | Amber |
| `success` | `#34D399` | Light green |
| `focus-ring` | `#7AAFFF` | Light blue ring |

---

### §3 System / Light / Dark mode behavior

#### §3.1 Tri-state semantic

The user-facing preference is a tri-state: **System | Light | Dark**.

- **System** (default for new installs): app follows the OS appearance. On macOS, this means tracking `NSAppearance.currentAppearance` (Electron exposes this as `nativeTheme.shouldUseDarkColors`; Tauri exposes equivalent via `window.theme()` or system events).
- **Light**: app uses the Light palette regardless of OS.
- **Dark**: app uses the Dark palette regardless of OS.

#### §3.2 Persistence

The user's preference persists locally. **Suggested persistence location pattern** (per rev-1 reviewer L D4#3 — wording softened to avoid accidental implementation authority; the exact path defers to the framework WI):

```
~/Library/Application Support/lawbar/theme-preference.json
```

Contents: `{ "version": 1, "mode": "system" | "light" | "dark" }`.

NOT persisted to the case-box SQLite database (theme preference is a UI concern, not a domain entity). NO cloud sync of theme preference. NO telemetry.

#### §3.3 Precedence rules

When the app launches:
1. If the preference file exists AND `mode === "light"` → use Light palette.
2. If the preference file exists AND `mode === "dark"` → use Dark palette.
3. If the preference file exists AND `mode === "system"` → query OS appearance and use the matching palette.
4. If the preference file does NOT exist → treat as `mode === "system"` (default).

When the OS appearance changes mid-session (e.g., automatic Night Shift / appearance schedule):
- If `mode === "system"`, switch palettes live without restart.
- If `mode === "light"` or `mode === "dark"`, ignore the OS change.

#### §3.4 Initial render race

The first render of the renderer process MUST pick the palette BEFORE first paint. Otherwise the user sees a flash of unstyled (or wrong-styled) content. The token module supplies the active palette synchronously at module load; the renderer's bootstrap reads the preference file via IPC (Electron) or Tauri command BEFORE first render.

---

### §4 No-hard-coded-color rule

#### §4.1 Design rule

Every UI component reads colors ONLY from `ThemeTokens` (or from CSS custom properties hydrated from `ThemeTokens`). Raw color values (hex, rgb(), hsl(), named colors except `transparent` and `currentColor`) are FORBIDDEN outside:
- The token module itself.
- A small set of explicitly-excepted files (e.g., contrast-debug tools).

#### §4.2 Lint enforcement (framework-agnostic)

The first UI WI must configure a lint rule that:
- Disallows raw color literals in `src/**` outside `src/theme/**`.
- Suggests `theme.tokens.<token>` as the replacement.
- Treats violations as build-time errors (not warnings).

Concrete tooling depends on the framework (eslint with `stylelint-no-color-literals` analog, or Biome equivalent). The plan does NOT pick the tool.

#### §4.3 CSS custom properties bridge

For CSS-styled components, the token module emits CSS custom properties:

```css
:root {
  --color-background: #F8F9FA;
  --color-surface: #FFFFFF;
  /* ... */
}

:root[data-theme="dark"] {
  --color-background: #0F1216;
  --color-surface: #171B21;
  /* ... */
}
```

Components reference `var(--color-background)` etc. Switching `data-theme` swaps all tokens atomically.

---

### §5 Migration-target inventory

**Zero existing components to migrate.** Per `docs/ui/current-ui-map.md` + survey at HEAD `b5c7d9f`: the repo contains no UI code.

Therefore the migration plan is: **the first UI WI builds on the token system from line 1**. The acceptance criteria for the first UI WI MUST include:
- Token module exists and exports `ThemeTokens` + `Theme` + light + dark palettes.
- System / Light / Dark switching works per §3.
- No raw color literals outside the token module — enforced in the same WI either via lint (preferred; per §4.2) OR via a manual raw-color audit if the lint tool isn't yet selected (per rev-1 reviewer M D2#2 — to avoid the "lint promised but scheduled later" gap; the first UI WI MUST cover the guarantee one way or the other before merge).
- Every component is theme-aware (no component "looks broken" in Dark mode).
- Focus ring is visible on every interactive element in both modes.

When a future UI WI adds a new screen / component, the WI plan MUST include a "theme-token compliance" acceptance criterion citing this foundation plan.

---

### §6 Contrast verification

Computed contrast ratios for load-bearing token pairs against WCAG-AA targets. Computed by hand using the WCAG 2.1 §1.4.3 relative luminance formula; values are **approximate, accurate to ±0.05** (per rev-1 reviewer L D1#2). The first UI WI's CI contrast check (§8 WI 5) is the authoritative source; hand values here are sanity-check guidance.

#### §6.1 Light palette

| Pair | Ratio | Target | Pass? |
|---|---|---|---|
| `text` on `background` | 16.0:1 | 4.5:1 | ✓ AAA |
| `text` on `surface` | 16.7:1 | 4.5:1 | ✓ AAA |
| `text` on `surface-elevated` | 16.7:1 | 4.5:1 | ✓ AAA |
| `muted-text` on `background` | 4.5:1 | 4.5:1 | ✓ AA |
| `muted-text` on `surface` | 4.7:1 | 4.5:1 | ✓ AA |
| `border` on `background` | 1.3:1 | 3:1 (non-text) | **✗** — see §6.3 |
| `accent` on `background` | 5.5:1 | 3:1 (non-text) / 4.5:1 (if text) | ✓ |
| `text-on-accent` on `accent` | 5.5:1 | 4.5:1 | ✓ AA |
| `danger` on `background` | 5.7:1 | 4.5:1 (text) | ✓ AA |
| `warning` on `background` | 5.7:1 | 4.5:1 (text) | ✓ AA |
| `success` on `background` | 5.0:1 | 4.5:1 (text) | ✓ AA |
| `focus-ring` on `background` | 3.8:1 | 3:1 (non-text) | ✓ |
| `focus-ring` on `accent` | 1.5:1 | 3:1 (non-text) | **✗** — see §6.3 |

#### §6.2 Dark palette

| Pair | Ratio | Target | Pass? |
|---|---|---|---|
| `text` on `background` | 15.2:1 | 4.5:1 | ✓ AAA |
| `text` on `surface` | 14.3:1 | 4.5:1 | ✓ AAA |
| `text` on `surface-elevated` | 12.4:1 | 4.5:1 | ✓ AAA |
| `muted-text` on `background` | 6.7:1 | 4.5:1 | ✓ AA |
| `muted-text` on `surface` | 6.3:1 | 4.5:1 | ✓ AA |
| `border` on `background` | 1.5:1 | 3:1 (non-text) | **✗** — see §6.3 |
| `accent` on `background` | 5.8:1 | 3:1 (non-text) | ✓ |
| `text-on-accent` on `accent` | 5.8:1 | 4.5:1 | ✓ AA |
| `danger` on `background` | 7.1:1 | 4.5:1 (text) | ✓ AAA |
| `warning` on `background` | 10.2:1 | 4.5:1 (text) | ✓ AAA |
| `success` on `background` | 9.6:1 | 4.5:1 (text) | ✓ AAA |
| `focus-ring` on `background` | 9.3:1 | 3:1 (non-text) | ✓ |
| `focus-ring` on `accent` | 1.6:1 | 3:1 (non-text) | **✗** — see §6.3 |

#### §6.3 Known failures + mitigation

Two pair-failures need mitigation in the first UI WI:

1. **`border` on `background` fails 3:1 in both modes.** Hairline borders are intentionally subtle; the WCAG 3:1 non-text minimum applies to "graphical objects required to understand content". A hairline that merely groups visually-distinct content does NOT trigger §1.4.11. **Mitigation**: where a border is the SOLE indicator of state (e.g., an input's invalid border), use `danger` / `warning` / `success` (which DO pass 3:1) instead of `border`.

2. **`focus-ring` on `accent` fails 3:1 in both modes.** This is the case where a focused button is already filled with `accent` color, and the focus ring layered directly on top is invisible. **Mitigation**: focus ring renders OUTSIDE the button (offset = 2px, gap between button edge and ring) so it sits on the adjacent surface (`background` / `surface`), where it does pass 3:1.

Both mitigations are STANDARD macOS focus-ring conventions; the plan codifies them so the first UI WI implements them from day one.

---

### §7 STOP-AND-ASK gates (inherited from brief §20)

This work inherits these hard-stops without modification. None is pre-approved by THIS plan:

1. **Desktop framework decision** (Electron / Tauri / native) — STOP-AND-ASK. The token module shape in §1 is framework-agnostic precisely so this decision can be deferred.
2. **Renderer UI framework choice** (React / Solid / Vue / Svelte / etc.) — STOP-AND-ASK. The token module exports plain TS interfaces + plain CSS custom properties; no UI-framework binding is required.
3. **New runtime dependency** — STOP-AND-ASK per autonomy hard-stops + brief §20. The first UI WI must NOT add a color library (e.g., `chroma-js`, `polished`) without explicit user authorization. Hand-computed palette + CSS custom properties cover v1 needs.
4. **Code-signing identity + notarization profile + Apple Developer ID acquisition** — STOP-AND-ASK. Orthogonal to theme but listed for completeness; the first UI WI's `.app` bundle requires this to ship to lawyers.
5. **Mac App Store vs direct vs in-firm IT distribution** — STOP-AND-ASK. Theme work is unaffected, but the first UI WI's distribution path is gated.

The plan does NOT change any of the above. Each follow-up WI in §8 that touches a STOP-AND-ASK item must stop and ask first.

**All other brief §20 hard-stops remain inherited even if not theme-relevant** (per rev-1 reviewer L D5#2 — explicit non-relaxation of items like auth provider, cloud vendor, LLM enablement, sync bridge, real-data migration, etc.). The 23 STOP-AND-ASK items in blueprint §4 are inherited verbatim.

---

### §8 Suggested follow-up WIs (each requires SEPARATE explicit authorization)

This plan does NOT execute any of these. The user authorizes each individually.

| # | Suggested follow-up WI (plan-only OR impl as marked) | Closes | Risk | Predecessors |
|---|---|---|---|---|
| 1 | Plan: desktop framework decision (Electron vs Tauri vs native; impact on theme implementation specifically) | §7 gate #1 | **STOP-AND-ASK** | brief §20 |
| 2 | Plan: renderer UI framework + token-module file layout (depends on WI 1) | §7 gate #2 | **STOP-AND-ASK** | WI 1 |
| 3 | Impl: first UI WI — minimum greenfield app shell + token module + System/Light/Dark switching + a single screen demonstrating all 12 tokens (depends on WIs 1 + 2) | §5 acceptance | Medium; **STOP-AND-ASK** on new runtime deps | WIs 1 + 2 |
| 4 | Impl: lint rule enforcing no-hard-coded-colors per §4 (depends on WI 3's tooling choice) | §4.2 | Low | WI 3 |
| 5 | Impl: contrast CI check (computes ratios from the token module + fails build if any required pair drops below target) | §6 | Low; STOP-AND-ASK if a new runtime dep is needed | WI 3 |
| 6 | Plan: palette adjustment if reviewer pushes "contrast-ratio targets only; defer values" (alternative to §2.1/§2.2 hex values) | §2 | Low | None |
| 7 | Plan: high-contrast / accessibility mode (post-v1; orthogonal to night mode) | n/a | Low | None |

---

### §9 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Medium | Plan is read as authorization to implement night mode. | Top-of-file ENUMERATION + DESIGN ONLY banner; explicit §"Scope discipline"; every follow-up WI flagged as SEPARATE authorization. |
| 2 | Medium | Concrete hex values in §2 lock in palette choices prematurely; reviewer may push to "targets only". | §2 preface explicitly invites the reviewer to push to targets-only; §8 WI 6 covers that alternative. |
| 3 | Low | Contrast ratios in §6 are hand-computed; an arithmetic error could mislabel a failing pair as passing. | §8 WI 5 (CI contrast check) catches drift; reviewer can spot-check 2-3 pairs to validate the method. |
| 4 | Low | The 2 derived tokens (`text-on-accent`, `surface-elevated`) may not be load-bearing for v1. | §1 review-question #2 surfaces this explicitly; reviewer may push to defer. |
| 5 | Low | Framework choice may invalidate the token-module shape (e.g., Tauri's CSS pipeline differs from Electron's). | §1 token-module shape is plain TS + CSS custom properties — both Electron-renderer and Tauri-webview support the same shape. Framework-agnostic by design. |

No Critical / High risks.

---

### §10 References

- `docs/product/product-definition.md` Part I (READY revision 5) §3, §4, §20.
- `dev-memo/plan-client-00.md` §3-§6.
- `docs/ui/current-ui-map.md` (baseline zero — no UI in repo).
- `docs/ui/ui-state-contract.md`.
- `docs/ui/ui-gap-report.md`.
- `dev-memo/plan-go-live-readiness-00.md` gate #3 (Mac-client surface) + gate #4 (distribution).
- WCAG 2.1 §1.4.3 (contrast minimum) + §1.4.11 (non-text contrast). Referenced by name only.

---

### §11 Stop condition

This plan is stale or superseded when:
- A follow-up WI from §8 ships a token module and the first UI WI's components consume it — the plan transitions to "superseded by `<WI commit hash>`".
- Brief §3-§4 is amended in a way that changes the Mac-app posture (e.g., browser-SPA becomes v1).
- Framework choice (Electron / Tauri / native) lands and invalidates the framework-agnostic token-module shape.
- A future UI redesign WI replaces the semantic-token approach with a different theming model.

---

## Forms-spec design note — T4 举证质证表 (proof / cross-examination table) (FORMS-T4-SPEC-00)

*Absorbed 2026-08-12 from dev-memo/forms-t4-spec-00.md (source deleted in the same commit). Content verbatim; heading levels shifted one deeper.*


**Date**: 2026-07-04. **Type**: design/spec note (documentation only — no implementation, no schema, no
code/tests, no product-scope decision made here). **Lane**: WI-FORMS-T4-SPEC-GOVERNANCE (design/spec +
governed-WI authoring). **Status**: framing note for the still-gated T4 form — **NOT
implementation-authorizing** and **NOT a product-scope decision**. Predecessor: `dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md`
§C (T4 is "fully design-gated"; the proof model does not exist as data or as a decided rule) + §F Q6/Q7.

> **Binding inputs.** `dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md` §C (T4 proof-model gaps) + §F Q6
> (M0-vs-post-v1 `RECONCILIATION-NEEDED`) + Q7 (new persisted fields need a schema ADR + explicit approval);
> `docs/product/product-definition.md` Part I (status `READY`) §12 "Export (post-v1)" + §14 "Post-v1 export
> candidates" — **"PDF chronology / proof matrix / privilege log … each is a separate STOP-AND-ASK ADR"**;
> the completed forms-T3 track (S0–S3) as the reuse baseline; `.claude/rules/{autonomy,project-brief,evidence-genie,client-local-first}.md`.

### 0. Scope of THIS note (and what it does NOT do)

This note **frames** T4 so a future lane can proceed *once the blockers below are resolved by the user*. It
does **not** implement T4, does **not** design the proof-model fields (that would be invention, forbidden by
`ADR-evidence-a10-court-fileable-export.md` §10 and forms-spec §E), and does **not** decide whether T4 is in
M0 or post-v1 (that is a product-scope decision reserved to the user — see §4 Blocker B1). It records the
target, the source-data gaps, candidate structure (decision-pending), the hard blockers, and the smallest safe
first slice.

### 1. Purpose (from the real-sample context)

举证质证表 is a **proof / cross-examination matrix**: it organizes the case's evidence by what each piece is
meant to prove and captures the opposing party's 质证 (cross-examination) stance on it. Where T3 (证据目录及说明)
is a flat catalogue of one party's evidence, T4 adds the **argument structure** — 争议焦点 / 证明对象 →
supporting evidence → 对方质证意见 (三性 stance + reasons). Per DR-00 (forms-spec §H), T4 — like T3/T5 — is an
**internal lawyer trial-review work product**, NOT a court-filing artifact in this phase; the audience +
court-facing/export scope are part of the B1 product-scope decision (§4), not assumed here. The T5 sample (`【一审】质证意见-示例20260101.docx`, a narrative 质证意见 brief) shows the *content* of a
质证 stance (三性: 真实性/合法性/关联性 as accept/reject/partial + reasons cross-referencing evidence numbers) but
NOT a normalized table.

### 2. Source data — what exists vs what is missing

**Exists today (post forms-T3 S0–S3):**
- Evidence rows per matter (`case_box_evidence_items`) with the S0 fields (`evidence_title`, `proof_statement`,
  `display_order`) + `exhibit_page_range` + `status`; the S1 `T3CatalogModel` + S2 preview + S3 DOCX export.
- Matter `litigation_position` (原告/被告) and `parties`.

**Missing — none of these exist as data OR as a decided rule (forms-spec §C):**
- **争议焦点 / claim / issue** — the disputed points the table is organized around.
- **证明对象** — what each claim/element must prove (distinct from the per-item `proof_statement`, which is the
  lawyer's free-text purpose for ONE evidence item, not a claim-level proof target).
- **evidence↔证明对象 linkage** — which evidence items support each 证明对象 (a many-to-many relation).
- **对方质证意见 (三性 stance)** — per opposing item: 真实性/合法性/关联性 as accept/reject/partial + reasons. No
  persisted 质证 model exists; `party_side` marks who introduced an item, not a cross-examination stance.
- **proof-gap rule** — the rule flagging a 证明对象 with insufficient/absent supporting evidence.
- **citation** — 卷X页Y (A10-T1) and/or the T3-style 页码 range, per link.

**Consequence:** T4 cannot be a table "over existing data" the way T3 was. It requires **new persisted data +
a new proof model**, not just a rendering.

### 3. Candidate structure (DECISION-PENDING — not designed here)

Recorded as candidates to frame the decision, NOT as an approved design (the real column set + field semantics
are the proof-model decision, §4 B2):
- A proof-matrix row is plausibly keyed by **证明对象 / 争议焦点**, listing the linked evidence (序号 + 证据名称),
  the 证明目的/证明对象 text, and the opposing 质证意见 (三性 + reasons), possibly with a proof-gap flag.
- OR (the T5 fork) the cross-examination could be a **narrative 质证意见 brief** rather than a structured table
  (forms-spec §F Q5). Whether T4 is a *structured matrix* vs a *narrative* is itself part of the proof-model
  decision and overlaps T5.
- No column set, enum, or field name is approved by this note.

### 4. Hard blockers (must be resolved by the USER before any T4 implementation)

**B1 — Product scope: M0 vs post-v1 (STOP-AND-ASK + RECONCILIATION-NEEDED).** The `READY` project brief
(`docs/product/product-definition.md` Part I §12 "Export (post-v1)" + §14) explicitly lists the **proof
matrix** among **post-v1 export candidates, "each a separate STOP-AND-ASK ADR."** The PRD/forms-spec treated the
three forms as an M0 promise (forms-spec §F Q6 flagged this exact conflict as `RECONCILIATION-NEEDED`). Per the
`project-brief` authority hierarchy, the `READY` brief governs → **T4 is post-v1 + STOP-AND-ASK by default**.
This is a product-direction decision reserved to the user (autonomy hard-stop); it is NOT decided here and MUST
be resolved (M0-in-scope vs post-v1, and the STOP-AND-ASK cleared) before any T4 implementation WI.

**B2 — Proof-model product/legal decision.** The 争议焦点/证明对象/linkage/质证-三性/proof-gap model (§2) is a
product+legal decision, not an engineering one. Designing these fields absent that decision would be invention
(forbidden). Overlaps the T5 structured-vs-narrative fork (forms-spec §F Q5).

**B3 — Schema/contract additions (forms-spec §F Q7).** Once B1+B2 resolve, the new persisted fields (证明对象,
per-opposing 三性, evidence↔object links, proof-gap) require their own **schema/contract ADR + explicit
approval**, following the S0-style additive precedent — a HIGH-RISK persistence lane, not part of this note.

### 5. Verdict — smallest safe first slice

Because B1 is an unresolved **post-v1 STOP-AND-ASK** in the `READY` brief and B2 (the proof model) does not
exist, **no T4 implementation slice (preview or DOCX export) is eligible**, and even a schema ADR is premature
(it would presume B1+B2). The smallest safe first slice is therefore a **design/decision-foundation** lane, NOT
implementation:

> **First T4 slice = produce a T4 proof-model + scope-reconciliation DECISION ADR** (design-only) that (a)
> surfaces the B1 M0-vs-post-v1 STOP-AND-ASK for the user to resolve against the `READY` brief, (b) frames the
> B2 proof-model product/legal options (structured matrix vs narrative; the 证明对象/争议焦点/三性/proof-gap
> model) for a user/legal decision, and (c) specifies the B3 schema additions *conditionally* (only if/after
> B1+B2 resolve). It writes ONE ADR + governance; it implements nothing, changes no schema, and makes no
> product-scope decision on the agent's own authority. **The ADR's ONLY decision is the status itself — "T4
> remains blocked pending the user's resolution of B1 (M0-vs-post-v1 STOP-AND-ASK) and B2 (proof model)";**
> every option in §3/§4 is *recorded, not selected*. It is a decision-*foundation* / STOP-AND-ASK packet, not a
> final product decision.

This mirrors the T3 chain (spec/DR-00 → plan → S0 schema ADR → impl) but starts one step earlier because T4's
product scope + proof model are still open, whereas T3's were resolved by DR-00.

### 6. Forbidden scope (the first T4 WI approves NONE of these)

- **No T4 implementation** (no preview, no DOCX/PDF, no table code) — design/decision only.
- **No product-scope decision by the agent** — B1 (M0 vs post-v1) is a user STOP-AND-ASK per the `READY` brief.
- **No proof-model field design as final** — B2 is a user/legal decision; candidates in §3 are non-binding.
- **No schema/migration/contract/persistence change** — `CURRENT_SCHEMA_VERSION` stays 12; B3 is a later ADR.
- **No T5** work (the narrative 质证意见 / structured 质证记录 fork is its own gated design lane).
- **No PDF; no native; no custody/marker/seal; no JS shim; no A8; no raw client samples / tracked intake
  fixtures; no broad renderer/UI redesign.**
- **No change to the completed T3 behavior** except reuse of shared safe helpers (e.g. the S1 model / S3 export
  patterns) *if explicitly justified* in a future slice — never a T3 behavior change.

### 7. References
- `dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md` §C/§E/§F (T4 proof-model gaps; non-decisions; open questions).
- `docs/product/product-definition.md` Part I (status `READY`) §12/§14 (proof matrix = post-v1 STOP-AND-ASK).
- `dev-memo/plan-forms-t3-evidence-catalog-00.md` + `dev-memo/adr-forms-t3-s0-schema.md` + the S1/S2/S3
  artifacts (the reuse baseline + the ADR/schema/impl chain pattern T4 will echo one step later).
- `docs/product/product-definition.md` Part I §20 (product-direction + new-runtime-dependency hard stops),
  the deleted .claude/rules/project-brief.md rule (authority hierarchy; `READY` brief governs product direction),
  `docs/product/product-definition.md` Part II §5 (Evidence invariants, migrated there when the rule was deleted) (manual-truth invariant), `docs/product/product-definition.md` Part I §3 (local-first posture).

---

## macOS Developer-ID signing + notarization — lane (READY, not executed)

*Absorbed 2026-08-12 from dev-memo/desktop-macos-signing-notarization.md (source deleted in the same commit). Content verbatim; heading levels shifted one deeper.*


**WI**: `WI-DESKTOP-MACOS-SIGNING-NOTARIZATION-07`. **Status**: config + docs prepared; **NOT signed / NOT
notarized** — no Developer-ID certificate or notary credentials are present on this machine (verified below).
No secrets are committed. This doc + the env-gated config make the lane runnable the moment credentials are supplied.

### 1. Current state (verified by command)

```
security find-identity -v -p codesigning     # → 0 valid identities found
codesign -dv --verbose=2 release/mac-arm64/lawbar.app
##   → CodeDirectory flags=0x20002(adhoc,linker-signed); Signature=adhoc; TeamIdentifier=not set
spctl -a -vv -t exec release/mac-arm64/lawbar.app   # → rejected (Gatekeeper cannot assess)
```

⇒ the default build is **adhoc-signed only** (unsigned for distribution). Env vars `CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_API_KEY*` are all **unset**.

Run `npm --prefix apps/lawbar-desktop run verify:signing` any time to re-check a build.

### 2. Recommended artifact target: **dmg (primary) + zip**

- Keep `target: dir` for the **dev / smoke** path (direct `.../MacOS/lawbar` launch; unchanged default build).
- The **release** config produces **`dmg`** (standard macOS drag-to-Applications install; notarizable + staple-able)
  **+ `zip`** (smaller transferable; the notarization ticket staples to the `.app` inside). Both arm64 + x64.
- Rationale: a `.dmg` is the least-friction install for a non-technical lawyer; the `.zip` is a convenient
  fallback / CI artifact. A universal (single fat) binary is deferred (larger; per-arch is fine for a small team).

### 3. What was added (no secrets, default build untouched)

| File | Purpose |
|---|---|
| `apps/lawbar-desktop/electron-builder.signed.cjs` | Release config — **extends** the package.json `build` (no drift), drops `identity:null` (→ auto-detect Developer ID), adds `hardenedRuntime`, `forceCodeSigning: true` (release build FAILS if no valid identity), entitlements, `dmg`+`zip` targets, **env-gated** `notarize`. Not the default-named config, so plain `electron-builder` ignores it. |
| `apps/lawbar-desktop/build/entitlements.release.mac.plist` | Hardened-runtime entitlements (allow-jit, allow-unsigned-executable-memory, disable-library-validation) — required for Electron V8 + the `better-sqlite3` native module. **Not** App Sandbox; **no** network entitlement. Named `entitlements.release.*` (not the magic auto-discovered `entitlements.mac.plist`) so it can NEVER couple to the default unsigned build. |
| `apps/lawbar-desktop/scripts/release-preflight.sh` | **Fail-closed** credential check run by `dist:release` — aborts (exit 1) unless a Developer ID identity + a complete notarization credential set are present. Reads no secret values. |
| `apps/lawbar-desktop/scripts/verify-macos-signing.sh` | Credential-free `codesign`/`spctl`/`stapler` verifier. |
| `package.json` scripts | `dist:release` (preflight → build → sign/notarize), `postdist:release`, `verify:signing`. |

> **Fail-closed release** (cc-suite audit `audit-mrd7idvu-18bq91`, Medium — resolved): `dist:release` runs
> `release-preflight.sh` first (aborts on missing creds) AND the config sets `forceCodeSigning: true`, so a
> command named "release" can never silently emit an unsigned / un-notarized artifact. The hardened-runtime
> entitlements are the standard Electron-with-native-module compatibility set (audit Low, accepted); they
> may be narrowed once a real signed build proves which are removable.

### 4. Required credentials / env vars (NOT committed; supplied at build time)

**A. Developer ID Application certificate** (Apple Developer Program membership required):
- Either import the `Developer ID Application: <Name> (<TEAMID>)` cert into the **login keychain**
  (electron-builder auto-detects it), OR provide it as a file:
  - `CSC_LINK` = path to (or base64 of) the `.p12` export of the cert+key.
  - `CSC_KEY_PASSWORD` = the `.p12` export password.

**B. Notarization credentials** — one of:
- **Apple-ID method**: `APPLE_ID` (Apple account email), `APPLE_APP_SPECIFIC_PASSWORD`
  (an app-specific password from appleid.apple.com), `APPLE_TEAM_ID` (10-char Team ID).
- **App Store Connect API key** (preferred for CI): `APPLE_API_KEY` (path to the `AuthKey_XXXX.p8`),
  `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` — plus `APPLE_TEAM_ID`.

`APPLE_TEAM_ID` is what gates notarization in `electron-builder.signed.cjs` (`notarize: { teamId }`).

> ⚠️ Never commit the `.p12`, `.p8`, passwords, Team ID, Apple ID, or generated `release/**`. In CI, inject
> these as masked secrets; locally, export them in the shell only.

### 5. Command sequences

**Unsigned dev build (current default — no creds needed):**
```
npm --prefix apps/lawbar-desktop run dist
LAWBAR_MODE=dev apps/lawbar-desktop/release/mac-arm64/lawbar.app/Contents/MacOS/lawbar
```

**Signed + notarized release build (requires §4 credentials in the env):**
```
## export CSC_LINK=… CSC_KEY_PASSWORD=…  (or cert in login keychain)
## export APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… APPLE_TEAM_ID=…   (or APPLE_API_KEY* + APPLE_TEAM_ID)
npm --prefix apps/lawbar-desktop run dist:release
## → release-preflight.sh checks creds (fail-closed), then signs with Developer ID + hardened
##   runtime (forceCodeSigning), submits to Apple notary, staples the ticket,
##   emits release/lawbar-<ver>-<arch>.dmg and .zip
```

**Verification after signing/notarization:**
```
npm --prefix apps/lawbar-desktop run verify:signing -- release/mac-arm64/lawbar.app
## expect:  Authority=Developer ID Application: <Name> (<TEAMID>)
##          codesign verify: OK
##          spctl … : accepted   (source=Notarized Developer ID)
##          stapler … : The validate action worked!
## also verify the .dmg is stapled:
xcrun stapler validate release/lawbar-<ver>-arm64.dmg
```

### 6. STOP-AND-ASK — what is needed to actually sign + notarize

The lane is ready but **cannot be executed here**: there is no Developer-ID certificate in the keychain and
no notary credentials in the environment. To complete real signing + notarization, provide:

1. An **Apple Developer Program** membership (gives the **Team ID** + the ability to create certs).
2. A **Developer ID Application** certificate (`.p12` export + password, or installed in the login keychain).
3. **Notarization credentials** — either an app-specific password (`APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD`)
   or an App Store Connect **API key** (`.p8` + key id + issuer).
4. The **Team ID** (`APPLE_TEAM_ID`).

Until these are supplied, `npm run dist:release` **aborts at the fail-closed preflight** (exit 1) and
`forceCodeSigning: true` would fail the build anyway — it will **never** silently "succeed" as signed or emit
an unsigned/adhoc artifact from the release command. The only unsigned build is the dev `npm run dist`; do not
distribute that adhoc build to off-machine users without accepting the Gatekeeper friction documented in the
RC1 handoff.

### References
- §8 of this plan — RC1 artifacts + Gatekeeper open steps.
- §11 of this plan — the release checklist.
- electron-builder code signing / notarization docs (v25).

---

## Desktop production-launch readiness

*Absorbed 2026-08-12 from dev-memo/desktop-production-launch-readiness.md (source deleted in the same commit). Content verbatim; heading levels shifted one deeper.*


**WI**: `WI-DESKTOP-PRODUCTION-LAUNCH-READINESS-09`. **`main` @** `7d96a7b`. **Docs/verification only — no product change.**
Verifies the **production** launch path (no `LAWBAR_MODE=dev`): FileVault enforcement, first-run, local data
location, and Chinese UI. The app is an **unsigned** RC (see §5 of this plan).

### TL;DR

- Without `LAWBAR_MODE=dev` the app launches in **production** mode (fail-closed: any value other than `dev`
  → production; unit-tested `resolveMode`).
- Production mode **requires FileVault ON**. FileVault OFF (or unknown) → the app shows a **"FileVault
  required"** error dialog and **quits before opening any window or creating any data** (Tier-1 enforcement).
- This build machine has **FileVault OFF**, so the production block was verified directly; the **FileVault-ON**
  proceed-path is covered by the unit-tested `decideAction` matrix + the manual checklist in §7.
- Data lives only under `~/Library/Application Support/lawbar/`; nothing is written into the repo tree.

### 1. Verified on this machine (2026-07-09, main 7d96a7b)

| Check | Result |
|---|---|
| `npm --prefix apps/lawbar-desktop test` | **819 pass / 0 fail** |
| `npm --prefix apps/lawbar-desktop run test:smoke-matrix` | **1 pass** (M1–M9, dev mode) |
| `npm --prefix apps/lawbar-desktop run dist` | **success** (arm64 + x64) |
| `fdesetup status` (this machine) | **FileVault is Off** |
| Production launch (no `LAWBAR_MODE=dev`) | **BLOCKED** — process stayed at the "FileVault required" dialog, **never reached the app UI** |
| Data in the launch's temp userData after the block | **none** — no `case-box.sqlite` / `case-box-documents/` (block quits before DB creation) |
| Repo-tree data | **none** created |
| Chinese UI | verified via the smoke matrix (dev mode; M1 `案件台账`, etc.); production UI not reachable on this FileVault-OFF machine — see §7 |
| Product behavior changed | **no** |

### 2. Production launch / open commands

**Open (normal user, Finder — production mode):**
```
open apps/lawbar-desktop/release/mac-arm64/lawbar.app     # Apple Silicon
open apps/lawbar-desktop/release/mac/lawbar.app           # Intel
```
Unsigned build → first open needs **right-click → Open → Open** (or System Settings → Privacy & Security →
Open Anyway). No `LAWBAR_MODE` = production = FileVault-enforced.

**Direct executable (production, e.g. to see terminal output):**
```
apps/lawbar-desktop/release/mac-arm64/lawbar.app/Contents/MacOS/lawbar   # arm64, NO LAWBAR_MODE=dev
apps/lawbar-desktop/release/mac/lawbar.app/Contents/MacOS/lawbar         # x86_64
```

**Dev mode (FileVault bypass — separate, for development only):**
```
LAWBAR_MODE=dev apps/lawbar-desktop/release/mac-arm64/lawbar.app/Contents/MacOS/lawbar
```

### 3. FileVault enforcement (Tier-1)

At `app.whenReady()` the app resolves the launch mode and probes FileVault, then `decideAction(state, mode)`:

| FileVault state | production mode | dev mode |
|---|---|---|
| `on` | **proceed** | proceed |
| `off` | **block** (dialog + quit, before window/DB) | warn (stderr) + proceed |
| `unknown` | **block** | warn + proceed |
| `non-macos` | proceed | proceed |

The block: `dialog.showErrorBox("FileVault required", …)` then `app.quit()` — it returns **before**
`registerCaseBoxIpcHandlers` / `getCaseBoxRuntime`, so **no database or document storage is created** on a
blocked launch. All of this is unit-tested (`main.test.mjs`: `decideAction: full matrix`, `resolveMode`
fail-closed default, `parseFdesetupStatus`).

### 4. First-run behavior

- **FileVault ON:** window opens to the zh-CN matter list (`案件台账`); on first use, the local DB +
  document storage are created lazily under the data dir (§5). Local-first: nothing leaves the Mac.
- **FileVault OFF/unknown (production):** the "FileVault required" dialog appears — *"lawbar requires
  FileVault to be enabled before launch in production mode. Detected state: off … Enable FileVault in System
  Settings → Privacy & Security → FileVault, or set LAWBAR_MODE=dev for development builds."* — then the app
  quits. No window, no data.

### 5. Local data location

`app.getPath("userData")` for productName `lawbar` →
```
~/Library/Application Support/lawbar/
    case-box.sqlite           # the local case-box SQLite database
    case-box-documents/       # app-managed document storage (path.join(userData, "case-box-documents"))
```
Nothing is written into the repo working tree (verified — the packaged smoke's post-run scan also asserts
this, and the production-block launch created no files at all).

### 6. Confirm the UI is Chinese

On a successful (FileVault-ON) launch: sidebar **案件 / 新建案件 / 设置**; list title **案件台账**; New-matter
form **名称 / 案件类型 / 管辖 / 当事人** (role & kind dropdowns 委托人 / 个人 …) / **保密级别**; Settings **版本 /
数据位置 / 本地优先 / FileVault / 不收集遥测数据**. Automatically asserted by the smoke matrix (M1/M2/M3/M5/M8/M9)
in dev mode; identical renderer runs in production.

### 7. Manual verification checklist — FileVault ON (this machine is OFF, so untested here)

On a Mac with **FileVault ON** (System Settings → Privacy & Security → FileVault → On), run the same build:
- [ ] `fdesetup status` → `FileVault is On.`
- [ ] Open the `.app` for your arch (production mode, no `LAWBAR_MODE`). It should **launch to the zh-CN list**,
      NOT show the FileVault dialog.
- [ ] The UI is Chinese per §6.
- [ ] `~/Library/Application Support/lawbar/case-box.sqlite` is created after first use; `case-box-documents/`
      appears when a document is added.
- [ ] No files are written into the repo tree.
- [ ] Quit and relaunch → data persists (local-first).

### 8. Caveats / blockers

1. **Unsigned build** — Gatekeeper friction off the build machine (right-click → Open, or `xattr -dr
   com.apple.quarantine …`). Signing/notarization is READY-only (separate WI).
2. **Production requires FileVault ON** — deliberate encryption-at-rest enforcement; the block is a **feature**,
   not a bug. Dev machines use `LAWBAR_MODE=dev`.
3. **This machine has FileVault OFF** — the ON proceed-path (and production Chinese-UI) could not be exercised
   here; it is covered by the unit-tested `decideAction` matrix + the §7 checklist. Honest limitation.
4. **Version 0.1.0** placeholder; no auto-update.

### References
- §8 of this plan, §5 of this plan,
  §7 of this plan, §11 of this plan.
- `apps/lawbar-desktop/electron/main.ts` (whenReady block), `src/security/fileVaultProbe.ts`
  (`probeFileVault` / `resolveMode` / `decideAction`), `tests/main.test.mjs` (enforcement unit tests).

---

## Desktop release smoke matrix — WI-DESKTOP-RELEASE-SMOKE-MATRIX-05

*Absorbed 2026-08-12 from dev-memo/desktop-release-smoke-matrix.md (source deleted in the same commit). Content verbatim; heading levels shifted one deeper.*


A small, durable **packaged-app** smoke that proves the core lawyer workflows still work after
i18n / settings / error-surface changes. It runs against the real `release/mac-*/lawbar.app`
(electron-builder output) via Playwright-Electron — the same path a lawyer runs — so it exercises the
real preload/IPC boundary, the packaged asar, and the zh-CN renderer end to end.

**One test, one launch** (`tests/casebox-ui.electron.test.mjs`), ~3s: `release smoke matrix: launch → nav
→ create → list → detail → sub-screen → archive → settings → localized-error (M1-M9)`.

### Run

```
npm --prefix apps/lawbar-desktop run dist            # build the packaged app first (if stale)
npm --prefix apps/lawbar-desktop run test:smoke-matrix   # alias of test:ui-packaged
```

The wrapper (`apps/lawbar-desktop/scripts/test-packaged-wrapper.mjs`) launches the packaged bundle with a temp
`--user-data-dir` and `LAWBAR_MODE=dev` (FileVault bypass in dev), and post-scans for stray DB files
in the repo tree (local-first / no-leak guard).

### Matrix

| # | Workflow | How it's proven | Key hooks |
|---|---|---|---|
| M1 | App launches in **zh-CN** | `h1` == `案件台账`; empty-state contains `仅保存在本机` | `h1`, `[data-test-id=list-empty]` |
| M2 | Sidebar nav: **案件 / 新建案件 / 设置** | click `新建案件` → create form; click `案件` → list; click `设置` → settings | `button.list-new-btn`, `a.sidebar-link[data-nav=list|settings]` |
| M3 | **Create matter** via enum dropdowns | fill name/jurisdiction, `selectOption` role=`client` + party_kind=`individual`, submit | `#cm-name`, `#cm-party-0-role`, `#cm-party-0-party-kind`, `[data-test-id=create-submit]` |
| M4 | Created matter **appears in list** | after create, nav to `案件`; `a.matter-name` text set includes `matter-fixture-A` | `a.matter-name` |
| M5 | **Matter detail opens** (zh-CN) | `view-title` == name; fields show `诉讼` / `test-jx` / `普通`; active status pill | `[data-test-id=view-title]`, `[data-test-id=view-fields]`, `.status-pill--active` |
| M6 | At least one **sub-screen renders** | deadlines disclosure present on the detail view (+ audit chain head expands, count ≥ 1) | `[data-test-id=view-deadlines-details]`, `[data-test-id=view-chain-*]` |
| M7 | **Archive flow** | archive form (`归档案件 — …`), fill reason, submit → `.status-pill--archived`, reason recorded, archive button gone | `[data-test-id=archive-*]`, `.status-pill--archived` |
| M8 | **Settings** via real preload/IPC | `设置` screen renders `app:info` — version `0.1.0`, privacy `不收集遥测数据`, `FileVault` | `[data-test-id=settings-title|settings-section-app|settings-body]` |
| M9 | A **localized error path** without English/raw leak | submit New Matter EMPTY → validation banner is visible, Chinese, and contains no `required/invalid/persistence/schema/Error` | `[data-test-id=create-form-error]` |

Plus the **local-first invariant**: post-run scan asserts the SQLite DB lives only under the temp
`--user-data-dir`, and no DB file appeared in the repo tree.

### Design choices

- **Reachable, deterministic error surface (M9)** = the client-side New-Matter validation banner (zh-CN),
  not an injected IPC failure — an IPC error would need a failure-injection seam the packaged app does not
  expose. The IPC error → zh-CN mapping itself is covered by unit tests (`renderer-error-message.test.mjs`
  + the per-screen envelope-error tests).
- **One launch** keeps runtime ~3s; each electron launch is the expensive part, so the matrix threads all
  workflows through a single window rather than many tests.
- **Assert on visible Chinese text + stable `data-test-id` hooks**, not implementation details — resilient
  to refactors.

### Intentionally deferred

- Deep sub-screen CRUD (add document / deadline / fact / link) — covered by the pure-Node renderer unit
  tests; adding them to the packaged smoke would lengthen it without new release-risk signal.
- Multiple-matter / pagination / cursor flows — unit-tested; not a launch-smoke concern.
- Windows/Linux packaged runs — v1 is macOS-only (`docs/product/product-definition.md` Part I §3 (local-first posture)).
- IPC-failure error banners in the packaged app — no failure-injection seam; unit-tested instead.

---

## Lawbar desktop — RC1 artifact handoff

*Absorbed 2026-08-12 from dev-memo/desktop-rc1-artifact-handoff.md (source deleted in the same commit). Content verbatim; heading levels shifted one deeper.*


**WI**: `WI-DESKTOP-RC1-ARTIFACT-HANDOFF-06`. **`main` @** `16a8f85`. **App version** 0.1.0 (`io.lawbar.desktop`, productName `lawbar`).
**Status**: internal release candidate. **Docs only — no product change.** ⚠️ **Unsigned / not notarized** (see §Signing).

Repeatable handoff for the macOS desktop build: what to build, what it produces, how to verify it, and how to open + confirm it. The `.app` bundles are **not** committed (`release/` is gitignored — 300 MB+ each); this doc + the deleted dev-memo/release/rc1-checksums.txt record are the committed handoff; the artifacts are produced locally by `npm run dist`.

### 1. Verification sequence (run from clean `main`)

```
cd <repo root>
git status --short                                     # only .mcp.json + pre-existing untracked clutter
npm --prefix apps/lawbar-desktop test                  # unit/renderer/electron-in-list suite
npm --prefix apps/lawbar-desktop run dist              # electron-builder → release/  (build first)
npm --prefix apps/lawbar-desktop run test:smoke-matrix # packaged M1-M9 smoke against the fresh release/
```

**Recorded results (this RC):** unit **819 pass / 0 fail**; smoke matrix **1 pass** (M1–M9, ~2.5 s); `dist` **success** (arm64 + x64; `postdist` restored the arm64 host binding). user-facing English = **0** (i18n guard). No product behavior changed.

> `test:smoke-matrix` runs against whatever is currently in `release/`; run `dist` first (or after any source change) so the smoke exercises the current build.

### 2. Built artifacts (`apps/lawbar-desktop/release/`)

`electron-builder` is configured `target: dir`, `arch: [arm64, x64]` → it emits **`.app` bundles in per-arch directories** (no `.dmg` / `.zip`). Contents of `release/`:

| Path | Arch | Bundle size | Open on |
|---|---|---|---|
| `release/mac-arm64/lawbar.app` | arm64 (Mach-O arm64) | 318 MB | **Apple Silicon** Macs (M1/M2/M3/M4) |
| `release/mac/lawbar.app` | x86_64 (Mach-O x86_64) | 328 MB | **Intel** Macs |
| `release/builder-effective-config.yaml` | — | — | build config (appId, target, `identity: null`) |
| `release/builder-debug.yml` | — | — | build debug log |

### 3. Checksums (SHA256)

The `.app` is a **directory bundle**, so the manifest checksums its single-file, content-bearing parts (`Contents/Resources/app.asar` — the bundled renderer+main code; and the arch-specific electron launcher stub). Full manifest: **the deleted dev-memo/release/rc1-checksums.txt record**.

| Arch | `app.asar` SHA256 | bytes |
|---|---|---|
| arm64 | `ee07d7c0c8aa47b105813ee4d4dd0fdd5ad95d5013c18eb787c9524853c5ed89` | 40 387 041 |
| x86_64 | `322f0c82a9ee03b24dbea9f0b4e150a454782c24499c8a794dfc624e76b9e00d` | 40 387 041 |

> ⚠️ **Not a reproducible-build hash.** A fresh `npm run dist` yields different hashes (adhoc signature + asar/bundle timestamps). These verify **this specific RC build's transfer integrity** (recipient re-hashes the file they received). For a transferable, checksummed archive:
> ```
> ditto -c -k --keepParent apps/lawbar-desktop/release/mac-arm64/lawbar.app /tmp/lawbar-arm64.app.zip
> shasum -a 256 /tmp/lawbar-arm64.app.zip
> ```

### 4. Which artifact to open

- **Apple Silicon (most Macs since 2020):** `release/mac-arm64/lawbar.app`.
- **Intel:** `release/mac/lawbar.app`.
- Unsure? `uname -m` → `arm64` = Apple Silicon, `x86_64` = Intel.

### 5. Signing / notarization status — ⚠️ UNSIGNED

`identity: null` in the build config → **adhoc / linker-signed only**, **NOT** Developer-ID signed and **NOT** notarized:

```
codesign -dv --verbose=2 release/mac-arm64/lawbar.app   # → Signature=adhoc, flags=…(adhoc,linker-signed)
spctl -a -vv -t exec  release/mac-arm64/lawbar.app      # → REJECTED (Gatekeeper cannot assess)
```

**Consequence:** Gatekeeper will block the app on any Mac other than the build machine, and even locally if the bundle carries the `com.apple.quarantine` attribute (e.g. after AirDrop/download). This is expected for an internal RC. Signing + notarization is a **separate, deliberately-out-of-scope** future WI (needs a Developer-ID identity + Apple notary credentials — a Stop-and-Ask hard-stop, not solved here).

### 6. macOS opening instructions (unsigned app)

Copy the `.app` for your arch to `/Applications` (or anywhere), then:

- **From Finder:** right-click (or Control-click) `lawbar.app` → **Open** → **Open** in the dialog. (Double-clicking an unsigned/quarantined app just shows "cannot be opened".)
- **If macOS still blocks** ("lawbar can't be opened because Apple cannot check it for malicious software"): System Settings → **Privacy & Security** → scroll to the blocked-app notice → **Open Anyway**.
- **If it was downloaded/AirDropped** and Gatekeeper hard-blocks, strip the quarantine flag:
  ```
  xattr -dr com.apple.quarantine /path/to/lawbar.app
  ```
  (Only run this on a build you trust — i.e. one you built or whose checksum matches §3.)

### 7. Where local app data is stored

`app.getPath("userData")` for productName `lawbar` →

```
~/Library/Application Support/lawbar/
    case-box.sqlite           # the local case-box database
    case-box-documents/       # app-managed document storage
```

**Local-first / offline:** the lawyer's data never leaves the Mac unless the user takes a deliberate action. The smoke's post-run scan asserts no DB file is created outside the chosen data dir.

### 8. Run the built `.app` in dev mode (FileVault bypass)

Production launch **requires FileVault ON** (Tier-1 enforcement blocks otherwise). To run the built bundle on a dev machine without FileVault, use dev mode:

```
LAWBAR_MODE=dev apps/lawbar-desktop/release/mac-arm64/lawbar.app/Contents/MacOS/lawbar
```

(Runs the executable directly with the dev env var; logs go to the terminal. A normal Finder open uses production mode and enforces FileVault.)

### 9. Confirm the UI is Chinese after launch

On launch the app should show:
- Sidebar: **案件** / **新建案件** / **设置**.
- Matter list title: **案件台账**; empty state mentions **仅保存在本机**.
- New matter form: **名称 / 案件类型 / 管辖 / 当事人** (role & party-kind are dropdowns: 委托人 / 个人 …) / **保密级别**.
- Settings (设置): **版本 0.1.0**, **数据位置**, **本地优先 / 离线优先**, **FileVault**, **隐私: 不收集遥测数据**.

This is asserted automatically by the packaged smoke matrix (M1/M2/M3/M5/M8/M9): `npm --prefix apps/lawbar-desktop run test:smoke-matrix`.

### Release blockers / caveats

1. **Unsigned / not notarized** (§5) — cannot be distributed outside the build machine without Gatekeeper friction; signing+notarization is a separate WI.
2. **Production launch requires FileVault ON** — deliberate Tier-1 encryption-at-rest enforcement; dev machines use `LAWBAR_MODE=dev`.
3. **`target: dir` (no `.dmg`)** — the handoff is the `.app` directory; wrap with `ditto` (§3) to transfer. A `.dmg`/`.zip` distributable target is a separate packaging decision.
4. **Checksums are per-build, not reproducible** (§3).
5. **App version is 0.1.0** — placeholder RC version; a real release-version bump is a separate decision.

---

## Desktop local data — schema migration / upgrade compatibility

*Absorbed 2026-08-12 from dev-memo/desktop-data-migration-compat.md (source deleted in the same commit). Content verbatim; heading levels shifted one deeper.*


**WI**: `WI-DESKTOP-DATA-MIGRATION-COMPAT-16`. Confidence that an existing local case-box SQLite store created by
an **earlier app version** opens under the current app/runtime **without data loss**. Data-integrity/readiness
work — no new feature, no product/UI/schema change.

### 1. Schema / version mechanism (there IS a formal one)

Source: `services/case-box-persistence/src/sqlite/schema.ts`.

- **Version store:** a `schema_version(version, applied_at)` table is the single source of truth — **not**
  `PRAGMA user_version`. `CURRENT_SCHEMA_VERSION` is the target the current build knows how to reach (12 at time
  of writing; V1 base tables … V12 additive `case_box_links` columns).
- **Runner:** `applySchema(db)` reads `MAX(version)` and:
  - **refuses** a DB whose version is **newer** than this build (`invalid_payload`, before any mutation) —
    forward-incompat is a hard stop, never a silent downgrade;
  - **early-returns** if already current (idempotent no-op);
  - otherwise applies **each missing version's DDL in ONE transaction** and records it (`INSERT OR IGNORE`),
    rolling back on any error. Upgrades are **additive** (`CREATE TABLE IF NOT EXISTS`, additive `ALTER TABLE`),
    so existing rows are preserved.

### 2. How migrations are applied at runtime

`openSqliteCaseBoxPersistence({ path })` (`.../sqlite/openSqliteCaseBoxPersistence.ts`) opens the DB, sets the
desktop pragmas (`journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`), and **runs `applySchema`
unconditionally** on every open. The desktop app calls exactly this entrypoint via
`apps/lawbar-desktop/src/caseBox/caseBoxRuntime.ts`. So "the app opens an old DB" == "`openSqliteCaseBoxPersistence`
runs `applySchema`, which upgrades old→current in one transaction."

- **First open (empty):** version 0 → applies v1..current.
- **Re-open (existing, older):** version N → applies vN+1..current, preserving data.
- **Re-open (existing, current):** no-op.
- **Newer-than-build:** refused before mutation.

### 3. What the compatibility test verifies

Test: `services/case-box-persistence/tests/data-migration-compat.test.mjs` (2 cases, in the persistence suite).

It exercises the **real runtime entrypoint** with **synthetic data** in temp files:
1. Write synthetic data **through the persistence API** on a current DB (`createMatter` + `registerDocument` with a
   synthetic `storage_uri` + `appendDocketEntry`) — the authentic-row source.
2. **Build a frozen-DDL v8 store** (FIX1): a fresh DB whose schema is created from a **frozen v1–v8 DDL snapshot**
   embedded in the test (a versioned fixture generated at test time, not a committed binary), populated with the
   authentic API rows copied in via `ATTACH` (early-table columns are identical v8↔current, never altered). Self-
   checks assert it is a v8 store (marker = 8, no v9+ table) holding the synthetic rows.
3. **Reopen via `openSqliteCaseBoxPersistence`** and assert: the DB opens; schema reaches `CURRENT_SCHEMA_VERSION`;
   the synthetic **matter** is readable through the API with deep fields intact; the **document + its `storage_uri`
   directory reference + fields** are intact; the **audit / deadline / docket** tables are **not dropped**, the
   docket row survives **by id**, and the **audit chain head + events** survive and stay consistent
   (`event_count == COUNT`); and the v9–v12 tables the old store lacked are created by the upgrade.
   A second case proves reopening an already-current DB is an idempotent no-op (stable `schema_version` rows + data).

**Synthetic only, and guarded.** An `assertSafeTempRoot()` **preflight** refuses to run if `os.tmpdir()` resolves
inside the repo tree or `~/Library`. Everything is a temp file under `os.tmpdir()`; nothing is written into the repo
tree or `~/Library`, and no real client data / the deleted dev-memo/run/intake/ tree is touched.

### 4. Test-layer decision (why the persistence package, not `apps/lawbar-desktop`)

The migration mechanism **and** `openSqliteCaseBoxPersistence` live in `services/case-box-persistence`, and that
package's `better-sqlite3` is the **node-ABI** binding. The desktop app's own `better-sqlite3` is an **Electron-ABI**
binding that a plain `node --test` **cannot load** (`ERR_DLOPEN_FAILED`) — the desktop unit tests use a fake DB for
that reason. So a real-DB migration test must run at the persistence layer. The desktop calls the **same**
entrypoint, so a green test here **is** the desktop compatibility guarantee.

### 5. Honest gaps / follow-ups

- **Fidelity bound of the old-store fixture (FIX1; residual of audit M2 — tracked in
  `dev-memo/deferred-audit-findings.md`).** FIX1 replaced the earlier "create-at-current-then-rewind" approach with a
  **frozen v1–v8 DDL** fixture, so the store's schema is built from the historical v8 DDL, not derived from a current
  DB. The remaining, deliberately-accepted limitation: the rows copied into it use the **current serialized
  `payload_json` shape** (they come from the current API), so the test still does **not** prove compatibility with an
  actual older app binary's persisted-JSON quirks. Fully closing that needs a **pinned old-app snapshot fixture**,
  which the repo has chosen not to commit as a binary (WI guidance: prefer generated fixtures). Recorded as a
  deferred finding with a "pinned old-app fixture" follow-up. A `V8_TABLES` self-check also fails the test loudly if
  the fixture/schema drift (e.g. a post-v8 table appears), so it cannot silently rot.
- **No CI runs the persistence package** today (only `apps/lawbar-desktop`, `evidence-core-swift`, and the UI-design
  gate have workflows). This test therefore runs locally / in `npm --prefix services/case-box-persistence test`,
  **not** in PR CI. Recommend a follow-up SCAFFOLD/CI WI to add a `case-box-persistence` (and sibling services) CI
  workflow so migration + conformance suites gate PRs. Out of scope for this data-integrity WI.
- A true end-to-end desktop-under-Electron migration open (rather than the identical persistence entrypoint) would
  need an Electron test harness; deferred as heavier than the value, since the entrypoint is identical.

### References
- `services/case-box-persistence/src/sqlite/schema.ts` (`CURRENT_SCHEMA_VERSION`, `applySchema`).
- `services/case-box-persistence/src/sqlite/openSqliteCaseBoxPersistence.ts` (runtime entrypoint + WAL pragmas).
- `services/case-box-persistence/tests/hardening-schema.test.mjs` (version-level upgrade/refusal tests this builds on).
- `apps/lawbar-desktop/src/caseBox/caseBoxRuntime.ts` (desktop calls the same entrypoint).

---

## Desktop CI release gates

*Absorbed 2026-08-12 from dev-memo/desktop-ci-release-gates.md (source deleted in the same commit). Content verbatim; heading levels shifted one deeper.*


**WI**: `WI-DESKTOP-CI-RELEASE-GATES-10`. **Docs + CI workflow only — no product change.** Adds an automated
macOS gate so future PRs prove the desktop release path (tests, unsigned packaged build, packaged smoke)
before merge. **No Apple signing/notarization in CI** and no secrets.

### Workflow

`.github/workflows/desktop-release-gates.yml` — job **`desktop-release-gates`**.

- **Triggers:** `pull_request` touching `apps/lawbar-desktop/**` or the workflow file; plus `workflow_dispatch`.
- **Runner:** `macos-14` (Apple Silicon / arm64 — the primary v1 target; GitHub macOS runners are GUI-capable,
  required because electron-builder emits the mac `.app` and the packaged smoke launches a real GUI Electron app).
- **Node/npm:** Node **22** via `actions/setup-node@v4` (Node engine is `>=22 <26`), with **npm cache** keyed on
  `apps/lawbar-desktop/package-lock.json`.
- **Permissions:** `contents: read` (least-privilege; no secrets). **Concurrency:** cancels superseded runs per ref.
- **`LAWBAR_CI: "true"`** — makes CI explicit so the packaged-smoke wrapper keeps its **strict** posture
  (crash-attribution required, 30s settle floor, no dev-only observe/relaxations).

#### Steps (in order)
1. `actions/checkout@v4`.
2. `actions/setup-node@v4` (Node 22 + npm cache).
3. `npm --prefix apps/lawbar-desktop ci` — installs from `package-lock.json` + the **committed** internal
   tarballs (`dist-tarballs/case-box-contract-*.tgz`, `case-box-persistence-*.tgz`); **no** `bootstrap` rebuild.
4. `npm --prefix apps/lawbar-desktop test` — the full unit/renderer/electron-in-list suite (**819**), including
   the i18n **user-facing-English guard** (must stay 0) and the FileVault-enforcement unit tests.
5. `npm --prefix apps/lawbar-desktop run dist` — electron-builder packages the app for **arm64 + x64**,
   **UNSIGNED** (`identity: null`; `skipped macOS code signing`). No `dist:release`, no credentials.
6. `npm --prefix apps/lawbar-desktop run test:smoke-matrix` — the packaged **M1–M9** smoke against the fresh
   build (launch zh-CN → nav → create → list → detail → sub-screen → archive → settings → localized-error),
   plus the local-first no-DB-leak scan and (in CI) strict crash attribution.

#### Which commands run in CI
`npm ci` → `npm test` → `npm run dist` → `npm run test:smoke-matrix`. All three required checks (2/3/4 of the
WI) run; the packaged smoke (2) **runs in CI** — the wrapper is designed for it (its CI guard *enforces* strict
attribution + 30s settle rather than blocking).

#### Caching
npm cache via `setup-node` (`cache: npm`, `cache-dependency-path: apps/lawbar-desktop/package-lock.json`).
Native `better-sqlite3` is rebuilt per run (fast; `postdist` restores the host binding).

#### Signing / notarization
**None in CI.** The default `dist` is unsigned (`identity: null`); `dist:release` (the signed path) is **not**
invoked and would fail-closed without credentials anyway. No Apple secrets are referenced, read, or required.
The signing lane stays credential-gated (§5 of this plan).

#### Artifacts
Generated `release/**` bundles are **not** uploaded or committed (300 MB+, gitignored). The gate proves the
release path builds + smokes; it does not publish artifacts.

### `check-ui-design-artifact`
**Unchanged.** It remains a separate workflow (the deleted .github/workflows/ui-design-artifact.yml gate), untouched by this WI.

### Local verification (this machine, before push)
- `npm --prefix apps/lawbar-desktop ci` → exit 0 (lock in sync; committed tarballs install).
- `npm --prefix apps/lawbar-desktop test` → **819 pass / 0 fail**.
- `npm --prefix apps/lawbar-desktop run dist` → success (arm64 + x64; unsigned).
- `LAWBAR_CI=true npm --prefix apps/lawbar-desktop run test:smoke-matrix` → **M1–M9 pass**, `0 UNATTRIBUTED`.

### Why full packaged smoke IS suitable for CI here
The `test-packaged-wrapper` was built CI-aware: under `CI=true`/`LAWBAR_CI=true` it *enforces* the strict
crash-attribution guard + a 30s settle floor (Phase-1 `ciFail` on any relaxation), rather than refusing to run.
A clean run reports `0 UNATTRIBUTED` (verified locally in CI mode), so the full M1–M9 matrix is the gate — no
subset needed. Runtime is dominated by `dist` (~1–2 min) + the 30s settle; total well within the 40-min timeout.

### Guardrails
No product/schema/backend/UI/auto-update change; existing tests / i18n guard / smoke / FileVault enforcement /
signing fail-closed behavior are unchanged (the gate *runs* them). No secrets; no `release/**` committed.
The new gate is **required for merge** by policy (do not merge a PR whose desktop-release-gates run fails).

---

## Lawbar desktop — release checklist

*Absorbed 2026-08-12 from dev-memo/release-checklist.md (source deleted in the same commit). Content verbatim; heading levels shifted one deeper.*


A repeatable pre-release checklist for the macOS desktop app. Tick top-to-bottom. Companion docs:
§8 of this plan (artifacts + open steps), §5 of this plan
(signing/notarization lane), §7 of this plan (smoke matrix).

### 0. Preconditions
- [ ] On a clean `main` (or the release branch): `git status --short` shows no unexpected changes.
- [ ] Node 22+/24.x (contract + `ocr-persistence` require it; `better-sqlite3` ABI smoke passes).
- [ ] Decide the version (`apps/lawbar-desktop/package.json` `version`) — currently `0.1.0` (placeholder).

### 1. Quality gates
- [ ] `npm --prefix apps/lawbar-desktop test` → all pass.
- [ ] i18n guard green (user-facing English = 0) — part of the suite.
- [ ] `npm --prefix apps/lawbar-desktop run dist` → succeeds (arm64 + x64; `postdist` restores host binding).
- [ ] `npm --prefix apps/lawbar-desktop run test:smoke-matrix` → M1–M9 pass against the fresh build.

### 2. Artifacts
- [ ] `apps/lawbar-desktop/release/` contains the intended bundles for the chosen target (dev: `mac-arm64`/`mac` `.app`; release: `.dmg` + `.zip`).
- [ ] Record filenames, sizes, arch, SHA256 → refresh the deleted dev-memo/release/rc1-checksums.txt record (or a versioned copy).
- [ ] Confirm `release/**` is NOT committed (gitignored).

### 3. Signing / notarization (release builds only)
- [ ] Credentials present (see §5 of this plan §4): Developer ID cert (keychain or `CSC_LINK`/`CSC_KEY_PASSWORD`) + notary creds (`APPLE_ID`+`APPLE_APP_SPECIFIC_PASSWORD`+`APPLE_TEAM_ID`, or `APPLE_API_KEY*`+`APPLE_TEAM_ID`).
- [ ] `npm --prefix apps/lawbar-desktop run dist:release` → signs + notarizes + staples.
- [ ] `npm --prefix apps/lawbar-desktop run verify:signing -- release/mac-arm64/lawbar.app`:
  - [ ] `Authority=Developer ID Application: <Name> (<TEAMID>)`
  - [ ] `codesign verify: OK`
  - [ ] `spctl … : accepted` (source = Notarized Developer ID)
  - [ ] `stapler … : validated`
- [ ] `xcrun stapler validate release/lawbar-<ver>-arm64.dmg` → validated (dmg ticket stapled).
- [ ] NEVER commit certs / `.p12` / `.p8` / passwords / Team ID / generated `release/**`.

> If credentials are absent, STOP: the build is adhoc-signed only (Gatekeeper friction off-machine). Do not
> claim signed/notarized. See the signing doc §6.

### 4. Manual sanity (packaged app)
- [ ] Launch (dev): `LAWBAR_MODE=dev …/release/mac-arm64/lawbar.app/Contents/MacOS/lawbar`.
- [ ] UI is Chinese: 案件台账 / 案件 / 新建案件 / 设置; New-matter dropdowns (委托人 / 个人 …).
- [ ] Create → appears in list → detail → archive works; 设置 shows 版本 / 数据位置 / FileVault / 不收集遥测数据.
- [ ] Data lives only under `~/Library/Application Support/lawbar/`; nothing written into the repo tree.
- [ ] Production launch (Finder open, no `LAWBAR_MODE=dev`) enforces FileVault ON (blocks if off).

### 5. Security / posture
- [ ] Local-first / offline: no network surface added; no telemetry / crash reporting.
- [ ] `OcrQueueError` codes unchanged; no schema/contract enum value localized or renamed.
- [ ] No secrets in the repo/diff.

### 6. Sign-off
- [ ] Commit hash + `git log --oneline -4` recorded.
- [ ] Handoff doc + checksums refreshed for this build.
- [ ] Known caveats listed (unsigned? FileVault requirement? version placeholder?).
- [ ] Go / No-go recorded. (Sub-WI completion never implies go-live; go-live is an explicit user decision.)
