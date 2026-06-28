# ADR — A3 link real-db Electron round-trip closure (D1-ROUNDTRIP-00)

**Status:** Proposed (design-only; authorizes no implementation).
**Date:** 2026-06-28.
**Author:** Claude Code (WI-A3-LINK-D1-DESIGN-00).
**Closes (when its impl WI lands):** deferred finding `LINK-IPC-T1-D1`.
**Composes under:** `AGENTS.md` §"Evidence-Genie M0 workflow composition"; `.claude/rules/evidence-genie.md` (invariants #3/#4/#6/#10); `.claude/rules/cc-suite.md`; `.claude/rules/security-boundary.md`; `.claude/rules/client-local-first.md`.

---

## Review packet (compact)

- **Active plan summary.** WI-A3-LINK-D1-DESIGN-00 is a DESIGN-ONLY lane producing this single ADR. It chooses and justifies the closure path for `LINK-IPC-T1-D1`: the real-db Electron `casebox:link:*` create→list→export→unlink→relink round-trip is uncovered because `createLink` requires a scoped `case_box_anchors` row, there is no anchor write path or `casebox:anchor:*` IPC, and a plain-`node` DB seed is Electron-ABI-blocked. It authorizes no code; it defines the next impl WI.
- **Exact target files (this lane).** `docs/adr/ADR-evidence-a3-link-d1-roundtrip-closure.md` (this file, new); `dev-memo/deferred-audit-findings.md` (D1 "Planned closure path" clarification — NOT a closure); governance artifacts.
- **Exact acceptance criteria.** §10 (Decision), §11 (Security analysis), §12 (Test plan), §13 (D1 closure criteria), §14 (next-WI file scope) all present and concrete; D1 stays open; `check-contract-integrity` clean.
- **Exact out-of-scope.** No anchor IPC implementation; no test-seed implementation; no Electron-harness edit; no renderer/persistence/schema/audit-contract/dependency change; D1 not marked closed; no product anchor-creation/geometry-capture work (that is a separate A0.7-gated A-phase).
- **Essential ADR references.** `ADR-evidence-a3-link-ipc-surface.md` §4 (A0.7 is dev/commit-time, not runtime); `ADR-evidence-a3-anchor-link-contract.md` §3-4 (headless `createAnchor` geometry contract, design-only); `ADR-evidence-a07-renderer-conformance-gate.md` (the A0.7 gate, itself future).
- **Review questions.** (1) Are the three options fairly compared? (2) Is the recommended option's security analysis sound (no production backdoor; renderer not the boundary; trusted-main identity; full scope enforcement)? (3) Is the A0.7-first dependency for any real anchor-creation path correctly surfaced? (4) Should this be split into a product-anchor-IPC ADR vs a test-harness ADR? (5) Are the next-WI scope + D1-closure criteria concrete and testable?

---

## 1. Context

The A3 evidence-link surface is on `main`: persistence lifecycle (`case_box_links`, V11/V12), the resolver/export queries, the five `casebox:link:*` IPC channels + preload methods, and the renderer UI. Its unit tests are green.

One coverage gap remains, recorded as `LINK-IPC-T1-D1`: the **real-db Electron round-trip** for `casebox:link:list` / `casebox:link:export` is not exercised. The list/export handlers call the real `resolveLinkStatuses` / `buildExportCitations`, which need a real `better-sqlite3` DB **and** a real `case_box_anchors` row (a link points at an anchor). The handlers are unit-tested with a mocked DB; the resolver/export functions are unit-tested in the `case-box-persistence` package; only the thin handler→real-DB→projected-DTO round-trip is uncovered.

## 2. The precise blocker

1. **`createLink` requires a scoped anchor.** `services/case-box-persistence/src/sqlite/linkRepoQueries.ts:211` calls `existsScoped(db, "case_box_anchors", anchor_id, tenant_id, matter_id)` and throws `invalid_argument "unknown anchor"` if absent. For `source_type='evidence'` it additionally requires a scoped `case_box_evidence_items` row.
2. **There is no anchor write path at all.** A full search of `services/case-box-persistence/src` finds **no** `createAnchor`/`insertAnchor`/`INSERT INTO case_box_anchors`. `case_box_anchors` is only read (resolver, export, delete-guard). Anchors are populated **only** by direct SQL `INSERT` in the persistence package's own tests (e.g. the local `insertAnchor` helper in `tests/hardening-anchor-delete-guard.test.mjs:21`).
3. **No `casebox:anchor:*` IPC exists.** Registered casebox channels: matter/document/audit/deadline/docket/fact/link. None creates an anchor.
4. **Plain-`node` DB seed is ABI-blocked.** The desktop `better-sqlite3` is built for the Electron ABI (`NODE_MODULE_VERSION` mismatch under plain `node --test`), so the unit suites mock the DB (`tests/ipc-link-handlers.unit.test.mjs:27-35`). Only the Electron integration harness (Playwright `_electron`, `tests/casebox-ipc.electron.test.mjs`) runs against a real DB, and it currently covers matter ops only — it has no way to seed an anchor.

## 3. The geometry nature of anchors (decisive constraint)

`case_box_anchors` (schema.ts:579, V11) is **geometry-bearing**: `document_id`, `physical_page_index`, `geometry_captured_at`, `rect_x/y/width/height` (page-ratio strings), `coordinate_space='page_ratio'` (CHECK), `origin_ref='DocumentPageGeometry'` (CHECK), `page_rotation IN (0,90,180,270)`. The headless `createAnchor(documentId, physicalPageIndex, geometry, rect, label?)` contract (`ADR-evidence-a3-anchor-link-contract.md` §3) binds identity + a captured geometry version + a page-ratio rect.

Therefore **creating a *real* anchor is geometry-capture work**, governed by `.claude/rules/evidence-genie.md`:
- #3 — A0.7 renderer-conformance is the **first** real Evidence architecture gate; nothing builds on it until it is green and its failures classified.
- #4 — **No Evidence UI before A0.7 is green** (STOP-grade).
- #6 — anchors persist page-ratio geometry against captured page geometry.

A0.7 itself is still a **future** gate (`ADR-evidence-a07-renderer-conformance-gate.md` is design; the harness is not yet green). This means a *product* anchor-creation path cannot be built now without violating the A0.7-first invariant — independent of the D1 test gap.

## 4. What D1 actually is

D1 is a **test-coverage gap on already-merged behavior** (the link round-trip), not a missing product capability. The objective is to *prove the existing wiring works end-to-end against a real DB*, not to ship anchor creation. This framing is what separates the options.

## 5. A0.7 gating model (relevant to both options)

`ADR-evidence-a3-link-ipc-surface.md` §4: **"A0.7 is a development/commit-time governance gate, NOT a runtime gate."** There is no runtime A0.7 marker check; mutating link ops rely on the OS App Sandbox offline entitlement, the local-first single-user posture, and main-process actor/tenant injection. A new anchor IPC, *if* built, would be commit-time A0.7-gated with **no** runtime marker — but introducing a runtime A0.7 mechanism would itself need a separate ADR and is out of scope.

---

## 6. Option 1 — minimal PRODUCT `casebox:anchor:*` IPC surface (real anchor creation)

Add a real anchor write path: a `createAnchor` persistence operation + a `casebox:anchor:create` IPC channel + preload method + DTO projection + audit event, then seed a real anchor in the Electron test before the link round-trip.

- **Pros.** Closes D1 with a fully realistic round-trip; advances the eventual product need (anchors must become creatable someday).
- **Cons (decisive).**
  - **A0.7-blocked.** A real anchor binds captured page geometry (§3); building it is geometry-capture, which evidence-genie #3/#4 forbid before A0.7 is green. A0.7 is not yet built. This is a hard STOP-grade conflict, not a preference.
  - **Disproportionate.** It is a whole A-phase (geometry capture, `DocumentPageGeometry` provenance, the headless `createAnchor` contract impl, audit chain, DTO surface, a UI to actually place anchors) — far larger than a test-coverage fix, and high-risk (new court-facing mutating IPC over evidence geometry).
  - **Premature product surface.** Shipping `casebox:anchor:create` before the geometry/UI story exists adds a court-facing mutating channel with no product consumer.
- **Verdict.** **Rejected for D1.** Real anchor creation is a legitimate *future* A-phase (its own ADR, gated on A0.7 green), but it is not the right vehicle to close a test-coverage gap, and it cannot proceed now without weakening the A0.7-first invariant.

## 7. Option 2 — sanctioned Electron integration-test anchor seed (test-only) — RECOMMENDED

Seed a synthetic `case_box_anchors` (+ `case_box_evidence_items`) row into the Electron test's isolated DB from the **test driver**, then drive the real `casebox:link:*` round-trip. Use the repo's already-proven mechanism: Playwright `_electron` + `electronApp.evaluate(fn)`, which runs `fn` **inside the Electron main process** (used today in `tests/smoke.electron.test.mjs:139`, `tests/smoke.packaged.electron.test.mjs:181`). Inside `evaluate`, open the app's SQLite file with the Electron-ABI `better-sqlite3` and `INSERT` the synthetic anchor/evidence rows — the same direct-INSERT shape the persistence package tests already use (`insertAnchor`/`opEvidence`).

- **Pros.**
  - **Zero product surface.** The seed is **test-driver code injected via `electronApp.evaluate`**, not shipped product code, not an IPC channel, not a preload hook. Nothing new is reachable from the renderer or from a packaged build.
  - **Mirrors an accepted pattern.** Direct synthetic-anchor INSERT is exactly how `case-box-persistence` tests seed anchors today; the synthetic row satisfies the schema CHECK constraints (`page_ratio` / `DocumentPageGeometry`) and is test data, not a real geometry-capture claim — no Evidence invariant is asserted falsely.
  - **A0.7-clean.** It builds no product anchor-creation path and no Evidence UI, so it does not engage evidence-genie #3/#4. It is pure test infrastructure over already-merged behavior.
  - **Proportionate + isolated.** One Electron integration test file; the DB is a fresh `--user-data-dir` temp per run (`tests/casebox-ipc.electron.test.mjs`).
- **Cons / risks.**
  - A second `better-sqlite3` connection to the app's open DB risks WAL lock contention → mitigation: seed via `electronApp.evaluate` using main's own already-open persistence handle, OR seed before/around the app's DB use; resolved at impl time (§12).
  - The seed code, though test-only, writes a real DB → mitigation: it lives only in `*.electron.test.mjs` under the existing `LAWBAR_TEST_PID_LOG`/`LAWBAR_WRAPPER_VERSION` sentinel; it is never imported by `src/**`/`renderer/**`/`electron/**`; CI/lint asserts no product module references it (§11).
- **Verdict.** **Recommended.** Smallest, safest closure of the actual gap with no production attack surface.

## 8. Option 3 — keep D1 deferred

Leave the round-trip uncovered; rely on the layered unit tests (handler projection unit-tested; resolver/export unit-tested in persistence).

- **Pros.** Zero work; no new test infra.
- **Cons.** The handler→real-DB→DTO seam stays unproven end-to-end; a future regression in wiring (channel registration, projection, resolver invocation order) could pass all unit suites yet break the real app.
- **Verdict.** **Not preferred**, but acceptable as the status quo until Option 2's impl WI is scheduled. Option 2 is cheap enough to prefer.

## 8b. Option 4 — a test-only/dev-conditional PRODUCT IPC seed (explicitly rejected)

A tempting middle path: add a `casebox:anchor:create` (or `casebox:test:seed`) IPC that is registered only under a `NODE_ENV`/build flag, so the Electron test can seed via a real channel.

- **Why rejected (worse than both 1 and 2).** It puts a mutating, geometry-writing path into the **product** main process and (build-conditionally) the IPC registry. A build-conditional or env-gated channel is a *product-reachable surface* whose presence depends on a flag — exactly the "production seed backdoor" the security analysis forbids: a packaging mistake or a flipped flag exposes synthetic-geometry mutation in a shipped build, and it still writes geometry-bound anchors (so it is also A0.7-governed like Option 1). Option 2 achieves the same test outcome with **no** product/IPC/preload code at all (the seed is test-driver-injected and absent from any build). Option 4 is therefore strictly dominated.

## 9. Comparison

| | Closes D1 round-trip | Product surface added | A0.7 dependency | Size / risk |
|---|---|---|---|---|
| **1 product anchor IPC** | Yes (realistic) | New court-facing mutating IPC | **Blocked** (geometry capture; A0.7-first) | Whole A-phase; high |
| **2 test-only seed** (rec.) | Yes (synthetic anchor) | **None** (test-driver only) | None | One test file; low |
| **3 keep deferred** | No | None | None | Zero; seam unproven |
| **4 dev-conditional product seed IPC** | Yes | **Build-conditional product IPC** (backdoor risk) | Same as 1 | Dominated; rejected |

## 10. Decision

**Adopt Option 2** — close `LINK-IPC-T1-D1` with a **sanctioned, test-only Electron integration anchor seed** implemented as **test-driver code injected via Playwright `electronApp.evaluate()`** (zero product/IPC/preload surface), driving the real `casebox:link:*` round-trip. A real product `casebox:anchor:*` creation path (Option 1) is explicitly **deferred to a separate future A-phase ADR**, gated on the A0.7 renderer-conformance gate being green; it is **not** part of D1 closure.

## 11. Security analysis

- **Renderer is not the security boundary.** The seed is never exposed to the renderer; it is injected into the Electron **main** process by the test driver. No `casebox:*` channel, no preload method, no `window`-reachable surface is added. The renderer’s existing posture is unchanged (it strips outgoing DTOs; identity is main-injected).
- **Trusted-main actor/tenant.** The round-trip still exercises the real handlers, which inject `actor_user_id`/`tenant_id` main-side (`getActiveActorUserId`/`getActiveTenantId`); the test does not forge identity through the renderer. The seed sets a synthetic `tenant_id`/`matter_id` and the test asserts the handlers honor the active tenant/matter scope.
- **Full scope enforcement still tested.** The seed creates the anchor (and evidence item) under a specific `tenant_id`+`matter_id`+`document_id`+`physical_page_index`; the round-trip proves `createLink` enforces `existsScoped` (anchor + evidence) and that `unknown_matter`/`tenant_mismatch`/`invalid_argument` fire on mismatched scope.
- **No production backdoor.** The load-bearing guarantee is that the seed is **driver-only code that is not present in the product at all**: it lives only in `apps/lawbar-desktop/tests/*.electron.test.mjs`, is `electronApp.evaluate`-injected into main from the test driver, and adds **no** `src/**`/`renderer/**`/`electron/**` module, no IPC channel, and no preload method — so a packaged build ships no seed code path. (Note the honest limit: `electronApp.evaluate()` can inject arbitrary main-process code whenever Playwright already controls the app; this is not a product surface precisely because Playwright control + the un-shipped driver code are the prerequisites.) The test sentinel (`LAWBAR_TEST_PID_LOG` + `LAWBAR_WRAPPER_VERSION`) is a **defense-in-depth** layer — it prevents accidental unwrapped test execution, not the backdoor itself; the impl WI SHOULD also re-check the sentinel inside the evaluated function. The impl WI MUST add a guard test/lint asserting no product module imports or references the seed helper.
- **No evidence content.** The seed uses synthetic ids. Non-page rows (anchor, geometry, evidence item) use empty `payload_json` (`'{}'`); the `case_box_document_pages.payload_json` carries ONLY synthetic citation labels (`{ citationVolume, citationPageLabel, isCitable: true }`) — synthetic page-number identity, never real evidence body/PDF/OCR text. The round-trip assertions check identifiers/status/flags and the synthetic citation identity only. No real evidence content is introduced, logged, or snapshotted (Evidence confidentiality / invariant; `check-no-real-data` stays green).
- **Offline / local-first preserved.** No network, no cloud, no new entitlement; the test runs against a local temp DB.

## 12. Test plan (for the impl WI)

1. Extend (or add a sibling to) `apps/lawbar-desktop/tests/casebox-ipc.electron.test.mjs`:
   - Launch the packaged app with an isolated `--user-data-dir` (existing pattern).
   - Create a matter via the real `casebox:matter:create` IPC; register a document via `casebox:document:register` (so `document_id` scope is real).
   - **Seed the FULL resolver/export dependency set** via `electronApp.evaluate`, scoped to that tenant/matter/document, mirroring the persistence test INSERT shapes (`insertAnchor`/`opEvidence`). The `resolveLinkStatuses` `valid` ladder (`linkStatusResolverQueries.ts` `COMPUTE_SQL`) LEFT-JOINs links→anchors→`case_box_document_pages`→`case_box_document_page_geometries`, so a missing page or geometry row resolves to `broken`. To prove the **clean** path the seed MUST include, all consistently scoped:
     - `case_box_anchors` — with `geometry_captured_at = X`, `coordinate_space='page_ratio'`, `origin_ref='DocumentPageGeometry'`.
     - `case_box_document_pages` — at the same `document_id`+`physical_page_index`, with a `payload_json` carrying a citation identity `{ citationVolume: "<v>", citationPageLabel: "<l>", isCitable: true }` (non-empty strings; `isCitable !== false`) so `readCitationIdentity` (`exportCitationQueries.ts`) treats the page as citable. NOTE: the citation `text` is NOT stored — `buildExportCitations` synthesizes it as `卷<citationVolume>页<citationPageLabel>`; do not seed a `text` field. Keep the label unique within the document so the page is not `AMBIGUOUS`.
     - `case_box_document_page_geometries` — at the same page, with `captured_at = X` **equal to the anchor's `geometry_captured_at`** (a mismatch yields `needs_review`, not `valid`).
     - `case_box_evidence_items` — for `source_type='evidence'` (scoped existence).
     - NO superseding `case_box_documents.supersedes_document_id` pointing at the anchor's document (that yields `needs_review`).
     Resolve the WAL/connection approach at impl time (prefer reusing main's open handle; otherwise a short-lived second connection).
   - Drive the round-trip via the real IPC: `casebox:link:create` → `casebox:link:list` → `casebox:link:export`, then (if included) `casebox:link:unlink` → `casebox:link:relink`.
2. **Clean-path assertions:** link created; `listLinks` returns the link with resolver status **`valid`**; `exportLinkCitations` returns `{citations, byFlag}` with the citation's **`exportFlag === null`**, **`byFlag.CLEAN === 1`**, `citationVolume`/`citationPageLabel` equal to the seeded page identity, and the synthesized **`citation.text === "卷<citationVolume>页<citationPageLabel>"`**; DTOs carry no authority/internal fields; no evidence content anywhere. (Optionally also assert a degraded path in a second case: drop the geometry row → status **`broken`** (missing `g.id`), OR seed a geometry row whose `captured_at` differs from the anchor's `geometry_captured_at` → status **`needs_review`** — each with its corresponding non-CLEAN `byFlag`.)
3. Negative scope checks: a link create against a mismatched tenant/matter is rejected (`unknown_matter`/`tenant_mismatch`); an unknown anchor yields `invalid_argument` "unknown anchor".
4. Guard: a test/lint asserting no `src/**`/`renderer/**`/`electron/**` module references the seed helper.
5. Gates: the Electron integration suite runs under the existing wrapper; `npm --prefix apps/lawbar-desktop test`; `check-contract-integrity`; broker audit/verify. Native-ABI restore (`postdist` / `install-app-deps`) per `AGENTS.md` test-env notes.

## 13. Exact criteria to mark D1 closed

D1 (`LINK-IPC-T1-D1`) is marked `closed` **only** when an Electron integration test proves, against a real DB, ALL of:
1. the seeded dependency set exists and is consistently scoped — `case_box_anchors` + `case_box_document_pages` (with citation identity) + `case_box_document_page_geometries` (`captured_at` == the anchor's `geometry_captured_at`) + `case_box_evidence_items`, no superseding document;
2. `casebox:link:create` succeeds against it;
3. `casebox:link:list` (with `resolveLinkStatuses`) returns the link with resolver status **`valid`**;
4. `casebox:link:export` (via `buildExportCitations`) returns the citation with **`exportFlag === null`** and **`byFlag.CLEAN === 1`**, `citationVolume`/`citationPageLabel` equal to the seeded page identity, and the synthesized `citation.text === "卷<citationVolume>页<citationPageLabel>"`;
5. the unlink→relink lifecycle remains coherent (if included in the WI);
6. no evidence content leaks into logs, fixtures, or UI snapshots; DTOs expose identifiers/status/flags only;
and the test passes in the orchestrated Electron harness with the deferred-findings row flipped to `closed` citing the impl commit. (A "broken-link-only" round-trip — anchor seeded but page/geometry omitted, asserting `broken`/`BROKEN` — is NOT sufficient to close D1; the clean `valid`/CLEAN path above is the bar.)

## 14. Next-WI proposal

**WI-A3-LINK-D1-ROUNDTRIP-T1** (`Type: TEST`, impl): implement the §12 plan.
- **Expected file scope:** `apps/lawbar-desktop/tests/casebox-ipc.electron.test.mjs` (or a new sibling `casebox-link-roundtrip.electron.test.mjs`) + possibly a small test-only helper under `apps/lawbar-desktop/tests/` (NOT under `src/`/`renderer/`/`electron/`); `apps/lawbar-desktop/package.json` test-list registration (additive) if a new file; `dev-memo/deferred-audit-findings.md` (flip D1 to closed). **No** `src/caseBox/**`, `electron/**`, `services/**`, schema, contract, or dependency change.
- **LOC budget hint:** ≲ 250 LOC test file.
- **Gates:** review-plan (test-harness security review), the Electron integration run, audit/verify, contract-integrity.

## 15. Stop condition

This ADR is "done" when the recommended path (Option 2) is reviewed READY and WI-A3-LINK-D1-ROUNDTRIP-T1 is opened. It is superseded if A0.7 ships and a product anchor-creation A-phase subsumes the round-trip with a real anchor.
