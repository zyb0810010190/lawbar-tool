# ADR — A3 link real-db Electron round-trip closure (D1-ROUNDTRIP-00)

**Status:** Proposed (design-only; authorizes no implementation). **Revised rev-1 (2026-06-28, WI-A3-LINK-D1-DESIGN-REV-00)** — the rev-0 seed mechanism was infeasible; see §0.
**Date:** 2026-06-28 (rev-0); 2026-06-28 (rev-1).
**Author:** Claude Code (rev-0 WI-A3-LINK-D1-DESIGN-00; rev-1 WI-A3-LINK-D1-DESIGN-REV-00).
**Closes (when its impl WI lands):** deferred finding `LINK-IPC-T1-D1`.
**Composes under:** `AGENTS.md` §"Evidence-Genie M0 workflow composition"; `.claude/rules/evidence-genie.md` (invariants #3/#4/#6/#10); `.claude/rules/cc-suite.md`; `.claude/rules/security-boundary.md`; `.claude/rules/client-local-first.md`.

---

## 0. Feasibility correction (rev-1) — supersedes the rev-0 seed mechanism

**rev-0 was wrong about *how* the test seeds the DB.** rev-0 chose "Option 2" but specified the seed as a direct `electronApp.evaluate(() => require('better-sqlite3') / await import('better-sqlite3'))` call running inside the Electron main process. That is **infeasible** in this app:

- The desktop main is **ESM** (`apps/lawbar-desktop/package.json` `"type": "module"`) → there is **no `require`** in main.
- A dynamic `import()` evaluated **inside the `app.evaluate` VM** is empirically **falsified**: it fails with *"A dynamic import callback was not specified."* This is a recorded repo finding — `dev-memo/plan-casebox-ipc-impl-01.md` §"ESM `app.evaluate` limitation": *"IPC tests MUST NOT rely on `app.evaluate` to dynamic-import case-box-*."* `app.evaluate` can only call functions/values **already present** in main's scope; it cannot itself load a native module.

This was caught by `review-plan-mqxfalb5-h0mkf3` (WI-A3-LINK-D1-ROUNDTRIP-T1 review-plan) **before any test code was written**.

**Corrected mechanism (rev-1): a default-off, env-gated `globalThis` TEST HOOK installed in `electron/main.ts`.** Modeled exactly on the proven tarball-PoC pattern (`electron/main.ts:137`, `LAWBAR_TARBALL_POC_TEST_HOOK`): when (and only when) a named test env var is set, main's top-level code `await import(...)`s the seed module **in the main process's native ESM loader** (NOT the `app.evaluate` VM) and installs a single seed function on `globalThis`. The Electron integration-test driver then invokes it via `app.evaluate(() => globalThis.__lawbarCaseBoxLinkSeed(...))` — `app.evaluate` only *calls an already-installed global*, which is what it can do.

**This is NOT the rev-0 "Option 4" product-IPC backdoor.** §8b is hereby narrowed: the rejected thing is a *dev-conditional product **IPC channel*** (registry surface + renderer-reachable + geometry mutation). The rev-1 hook is materially different and is the established, accepted repo test pattern:

| Property | rev-1 env-gated `globalThis` test hook | rejected Option-4 product seed IPC |
|---|---|---|
| IPC channel registered | **No** | Yes |
| Preload / `contextBridge` exposure | **No** | Often |
| Renderer-reachable / user-triggerable | **No** | Yes (build-conditional) |
| Default state | **Off (fail-closed); installs nothing** | Present, flag-gated |
| Present/active in production launch | **No (env var unset → inert)** | Yes (build-conditional) |
| Precedent | tarball-PoC `LAWBAR_TARBALL_POC_TEST_HOOK` (sanctioned) | none |

Because the rev-1 hook touches `electron/main.ts`, the **future impl lane is a small PRODUCT change** (no longer "zero product surface") and is therefore **likely A0.7-commit-gated** — see §14. The rest of the ADR (Option 1 rejected as A0.7-geometry work; Option 3 deferred fallback; the resolver/export seed *content*; the closure criteria) stands; only the seed *delivery mechanism* and §10/§11/§12/§14 are revised below.

---

## Review packet (compact)

- **Active plan summary.** WI-A3-LINK-D1-DESIGN-00 is a DESIGN-ONLY lane producing this single ADR. It chooses and justifies the closure path for `LINK-IPC-T1-D1`: the real-db Electron `casebox:link:*` create→list→export→unlink→relink round-trip is uncovered because `createLink` requires a scoped `case_box_anchors` row, there is no anchor write path or `casebox:anchor:*` IPC, and a plain-`node` DB seed is Electron-ABI-blocked. It authorizes no code; it defines the next impl WI.
- **Exact target files (this lane).** `docs/adr/ADR-evidence-a3-link-d1-roundtrip-closure.md` (this file, new); `dev-memo/deferred-audit-findings.md` (D1 "Planned closure path" clarification — NOT a closure); governance artifacts.
- **Exact acceptance criteria.** §10 (Decision), §11 (Security analysis), §12 (Test plan), §13 (D1 closure criteria), §14 (next-WI file scope) all present and concrete; D1 stays open; `check-contract-integrity` clean.
- **Exact out-of-scope (this design lane).** No anchor IPC; no test-seed/hook implementation; no `electron/**` edit; no renderer/persistence/schema/audit-contract/dependency change; D1 not marked closed; no product anchor-creation/geometry-capture work (a separate A0.7-gated A-phase). (The rev-1 `electron/main.ts` seed hook is *designed* here and *implemented* in WI-A3-LINK-D1-ROUNDTRIP-T1 — §14.)
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

Seed a synthetic `case_box_anchors` (+ `case_box_document_pages`/`case_box_document_page_geometries`/`case_box_evidence_items`) set into the Electron test's isolated DB, then drive the real `casebox:link:*` round-trip. **Delivery mechanism — see §0 (rev-1):** a default-off, env-gated `globalThis` test hook installed in `electron/main.ts` performs the `INSERT`s in main's native ESM loader; the test driver triggers it via `app.evaluate(() => globalThis.__<hook>(...))`. (rev-0 wrongly proposed having `app.evaluate` itself `require`/`import` `better-sqlite3` — withdrawn as infeasible per §0.) The INSERT shapes mirror the persistence package tests (`insertAnchor`/`insertPage`/`insertGeom`/`opEvidence`).

- **Pros.**
  - **No product *IPC/renderer* surface; minimal, contained product code.** The seed adds a small env-gated hook to `electron/main.ts` (per §0/§11 containment) — default-off, no IPC channel, no preload/`contextBridge`, not renderer-reachable, inert in production. It is the sanctioned tarball-PoC test pattern, not a product backdoor.
  - **Mirrors an accepted pattern.** Direct synthetic-anchor INSERT is exactly how `case-box-persistence` tests seed anchors today; the synthetic row satisfies the schema CHECK constraints (`page_ratio` / `DocumentPageGeometry`) and is test data, not a real geometry-capture claim — no Evidence invariant is asserted falsely.
  - **A0.7-clean.** It builds no product anchor-creation path and no Evidence UI, so it does not engage evidence-genie #3/#4. It is pure test infrastructure over already-merged behavior.
  - **Proportionate + isolated.** One Electron integration test file; the DB is a fresh `--user-data-dir` temp per run (`tests/casebox-ipc.electron.test.mjs`).
- **Cons / risks.**
  - A second `better-sqlite3` connection to the app's open DB risks WAL lock contention → mitigation: the hook can reuse main's already-open persistence handle, OR open a short-lived second connection with `busy_timeout`; resolved at impl time (§12).
  - The seed code, though test-only, writes a real DB and (rev-1) is reached via a small hook in `electron/main.ts` → mitigation (per §0/§11): the hook is installed ONLY behind a named test env var (default-off / fail-closed), runs via main's native ESM `import()`, exposes NO IPC channel / preload / `contextBridge` / renderer global / UI path, accepts NO raw SQL / arbitrary DB path / arbitrary fixture payload (only the minimal scoped synthetic-row insert), and a containment guard test asserts the env-gate + non-exposure. In a production launch (env var unset) the hook installs nothing and the seed module is never imported.
- **Verdict.** **Recommended.** Smallest, safest closure of the actual gap with no production attack surface.

## 8. Option 3 — keep D1 deferred

Leave the round-trip uncovered; rely on the layered unit tests (handler projection unit-tested; resolver/export unit-tested in persistence).

- **Pros.** Zero work; no new test infra.
- **Cons.** The handler→real-DB→DTO seam stays unproven end-to-end; a future regression in wiring (channel registration, projection, resolver invocation order) could pass all unit suites yet break the real app.
- **Verdict.** **Not preferred**, but acceptable as the status quo until Option 2's impl WI is scheduled. Option 2 is cheap enough to prefer.

## 8b. Option 4 — a test-only/dev-conditional PRODUCT IPC seed (explicitly rejected)

A tempting middle path: add a `casebox:anchor:create` (or `casebox:test:seed`) IPC that is registered only under a `NODE_ENV`/build flag, so the Electron test can seed via a real channel.

- **Why rejected (vs the rev-1 Option-2 hook).** Option 4 registers a *renderer-reachable IPC channel* (preload/`contextBridge` + the IPC registry) for seeding — a product surface a user/renderer can invoke, build-conditional. That is the "production seed backdoor" the security analysis forbids. The **rev-1 Option-2 mechanism (§0/§11)** is materially narrower: a default-off env-gated `globalThis` function in `electron/main.ts`, with **no IPC channel, no preload/`contextBridge`, not renderer-reachable, no user-triggerable path**, invoked only by the test driver via `app.evaluate`. It is the sanctioned tarball-PoC pattern (`LAWBAR_TARBALL_POC_TEST_HOOK`). So Option 4 (a seed *IPC channel*) stays rejected; the rev-1 hook is not Option 4.

## 9. Comparison

| | Closes D1 round-trip | Product surface added | A0.7 dependency | Size / risk |
|---|---|---|---|---|
| **1 product anchor IPC** | Yes (realistic) | New court-facing mutating IPC | **Blocked** (geometry capture; A0.7-first) | Whole A-phase; high |
| **2 test-only seed** (rec., rev-1) | Yes (synthetic anchor) | **Minimal** (default-off env-gated `globalThis` hook in `electron/main.ts`; no IPC/preload/renderer surface) | None | One hook + one test; low |
| **3 keep deferred** | No | None | None | Zero; seam unproven |
| **4 dev-conditional product seed IPC** | Yes | **Build-conditional product IPC** (backdoor risk) | Same as 1 | Dominated; rejected |

## 10. Decision

**Adopt Option 2** — close `LINK-IPC-T1-D1` with a **sanctioned, test-only Electron integration anchor seed**, driving the real `casebox:link:*` round-trip. **rev-1 mechanism (per §0):** the seed is delivered by a **default-off, env-gated `globalThis` test hook installed in `electron/main.ts`** (tarball-PoC pattern) whose `await import(...)` runs in main's native ESM loader; the test driver invokes it via `app.evaluate(() => globalThis.__<hook>(...))`. (The rev-0 "direct `app.evaluate` import" delivery is withdrawn as infeasible.) A real product `casebox:anchor:*` creation path (Option 1) remains **deferred to a separate future A-phase ADR**, gated on A0.7 green; it is **not** part of D1 closure.

## 11. Security analysis

- **Renderer is not the security boundary.** The seed is never exposed to the renderer; it is injected into the Electron **main** process by the test driver. No `casebox:*` channel, no preload method, no `window`-reachable surface is added. The renderer’s existing posture is unchanged (it strips outgoing DTOs; identity is main-injected).
- **Trusted-main actor/tenant.** The round-trip still exercises the real handlers, which inject `actor_user_id`/`tenant_id` main-side (`getActiveActorUserId`/`getActiveTenantId`); the test does not forge identity through the renderer. The seed sets a synthetic `tenant_id`/`matter_id` and the test asserts the handlers honor the active tenant/matter scope.
- **Full scope enforcement still tested.** The seed creates the anchor (and evidence item) under a specific `tenant_id`+`matter_id`+`document_id`+`physical_page_index`; the round-trip proves `createLink` enforces `existsScoped` (anchor + evidence) and that `unknown_matter`/`tenant_mismatch`/`invalid_argument` fire on mismatched scope.
- **No production backdoor (rev-1 — the hook lives in `electron/main.ts`, so containment is explicit).** The seed mechanism is a small amount of code in the product main process, so the no-backdoor guarantee is enforced by **hard containment requirements** the impl WI MUST satisfy (verified by review/audit):
  - **Named test-only env var, fail-closed default.** The hook installs **nothing** unless a dedicated env var (e.g. `LAWBAR_CASEBOX_LINK_SEED_TEST_HOOK=true`) is set. Production/package launches (var unset) install nothing — the code path is inert.
  - **No reachable surface.** The hook is a function on `globalThis` invoked only via `app.evaluate` by the test driver. It MUST NOT be registered as an IPC channel, exposed via `contextBridge`/preload, attached to any renderer global, or reachable from any UI/user action.
  - **Native-loader import.** The hook's `await import(...)` of the seed module runs in main's native ESM loader (this is the whole point — `app.evaluate` cannot do the import itself).
  - **Minimal op, synthetic data only, no injectable surface.** The hook exposes only the minimal seed operation D1 needs (insert the scoped anchor/page/geometry/evidence rows) using synthetic/no-real-data fixtures; it MUST NOT bypass audited production user flows except for this fixture setup; it MUST NOT accept raw SQL, an arbitrary DB path (it targets only the app's resolved DB), or an arbitrary caller-supplied fixture payload (the row shapes are fixed/synthetic) — so it cannot be coerced into a general DB-write primitive even if reached.
  - **Containment test.** The impl WI MUST add a guard test/lint asserting the hook is gated by the env var and is not exposed through preload/IPC/contextBridge/renderer globals.
  Defense-in-depth: the existing test sentinel (`LAWBAR_TEST_PID_LOG` + `LAWBAR_WRAPPER_VERSION`) plus the dedicated seed env var both gate execution.
- **Trusted-main / scope / no-evidence-content / offline** properties are unchanged from rev-0: the round-trip still exercises the real handlers (main-injected `actor_user_id`/`tenant_id`); the seed reads the matter's main-injected `tenant_id` from the DB and scopes all rows; only synthetic citation labels (no real evidence content) are used; no network/entitlement.
- **No evidence content.** The seed uses synthetic ids. Non-page rows (anchor, geometry, evidence item) use empty `payload_json` (`'{}'`); the `case_box_document_pages.payload_json` carries ONLY synthetic citation labels (`{ citationVolume, citationPageLabel, isCitable: true }`) — synthetic page-number identity, never real evidence body/PDF/OCR text. The round-trip assertions check identifiers/status/flags and the synthetic citation identity only. No real evidence content is introduced, logged, or snapshotted (Evidence confidentiality / invariant; `check-no-real-data` stays green).
- **Offline / local-first preserved.** No network, no cloud, no new entitlement; the test runs against a local temp DB.

## 12. Test plan (for the impl WI)

1. Extend (or add a sibling to) `apps/lawbar-desktop/tests/casebox-ipc.electron.test.mjs`:
   - Launch the packaged app with an isolated `--user-data-dir` (existing pattern).
   - Create a matter via the real `casebox:matter:create` IPC; register a document via `casebox:document:register` (so `document_id` scope is real).
   - **Seed the FULL resolver/export dependency set** via the env-gated `globalThis` hook (§0/§11), scoped to that tenant/matter/document, mirroring the persistence test INSERT shapes (`insertAnchor`/`insertPage`/`insertGeom`/`opEvidence`). The `resolveLinkStatuses` `valid` ladder (`linkStatusResolverQueries.ts` `COMPUTE_SQL`) LEFT-JOINs links→anchors→`case_box_document_pages`→`case_box_document_page_geometries`, so a missing page or geometry row resolves to `broken`. To prove the **clean** path the seed MUST include, all consistently scoped:
     - `case_box_anchors` — with `geometry_captured_at = X`, `coordinate_space='page_ratio'`, `origin_ref='DocumentPageGeometry'`.
     - `case_box_document_pages` — at the same `document_id`+`physical_page_index`, with a `payload_json` carrying a citation identity `{ citationVolume: "<v>", citationPageLabel: "<l>", isCitable: true }` (non-empty strings; `isCitable !== false`) so `readCitationIdentity` (`exportCitationQueries.ts`) treats the page as citable. NOTE: the citation `text` is NOT stored — `buildExportCitations` synthesizes it as `卷<citationVolume>页<citationPageLabel>`; do not seed a `text` field. Keep the label unique within the document so the page is not `AMBIGUOUS`.
     - `case_box_document_page_geometries` — at the same page, with `captured_at = X` **equal to the anchor's `geometry_captured_at`** (a mismatch yields `needs_review`, not `valid`).
     - `case_box_evidence_items` — for `source_type='evidence'` (scoped existence).
     - NO superseding `case_box_documents.supersedes_document_id` pointing at the anchor's document (that yields `needs_review`).
     Resolve the WAL/connection approach at impl time (prefer reusing main's open handle; otherwise a short-lived second connection).
   - Drive the round-trip via the real IPC: `casebox:link:create` → `casebox:link:list` → `casebox:link:export`, then (if included) `casebox:link:unlink` → `casebox:link:relink`.
2. **Clean-path assertions:** link created; `listLinks` returns the link with resolver status **`valid`**; `exportLinkCitations` returns `{citations, byFlag}` with the citation's **`exportFlag === null`**, **`byFlag.CLEAN === 1`**, `citationVolume`/`citationPageLabel` equal to the seeded page identity, and the synthesized **`citation.text === "卷<citationVolume>页<citationPageLabel>"`**; DTOs carry no authority/internal fields; no evidence content anywhere. (Optionally also assert a degraded path in a second case: drop the geometry row → status **`broken`** (missing `g.id`), OR seed a geometry row whose `captured_at` differs from the anchor's `geometry_captured_at` → status **`needs_review`** — each with its corresponding non-CLEAN `byFlag`.)
3. Negative scope checks: a link create against a mismatched tenant/matter is rejected (`unknown_matter`/`tenant_mismatch`); an unknown anchor yields `invalid_argument` "unknown anchor".
4. Containment guard (rev-1): a test/lint asserting the `globalThis` seed hook is installed ONLY when the named test env var is set (default-off), and is NOT exposed via any IPC channel, preload/`contextBridge`, renderer global, or UI path.
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

**WI-A3-LINK-D1-ROUNDTRIP-T1** (`Type: TEST`, impl): implement the §12 plan with the rev-1 hook mechanism.
- **Expected file scope (rev-1):**
  - a **bounded, env-gated `globalThis` seed hook in `electron/main.ts`** (+ a small seed module it `import()`s, e.g. under `apps/lawbar-desktop/src/caseBox/testSeed/` or `electron/`) — default-off, contained per §11. This makes the lane a small PRODUCT change to `electron/**` (rev-0's "no `electron/**`" scope is corrected here).
  - a new Electron integration test `apps/lawbar-desktop/tests/casebox-link-roundtrip.electron.test.mjs` (+ optional test-only helper under `tests/`).
  - `apps/lawbar-desktop/package.json` additive test-script registration.
  - a **containment guard test** (asserts the hook is env-gated and not exposed via IPC/preload/`contextBridge`/renderer globals).
  - `dev-memo/deferred-audit-findings.md` — flip D1 to `closed` ONLY after the test passes.
  - **No** `services/**`, schema/`CURRENT_SCHEMA_VERSION`, contract, dependency, `casebox:anchor:*` IPC, or preload/renderer change.
- **A0.7:** because this lane edits `electron/main.ts` (product main process), treat it as **likely A0.7-commit-gated (custody 9b)** — confirm at its review-plan; the hook itself is test-only and default-off, but it is product code over the evidence surface.
- **LOC budget hint:** ≲ 250 LOC test + ≲ 60 LOC hook/seed.
- **Gates:** review-plan (test-harness + containment security review), `npm run dist` + the packaged Electron run, `npm test`, audit/verify, contract-integrity.

## 15. Stop condition

This ADR is "done" when the recommended path (Option 2) is reviewed READY and WI-A3-LINK-D1-ROUNDTRIP-T1 is opened. It is superseded if A0.7 ships and a product anchor-creation A-phase subsumes the round-trip with a real anchor.
