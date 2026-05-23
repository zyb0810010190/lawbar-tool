# Plan: CASE-BOX-PERSISTENCE B11 — SQLite replay-safe Once variants + Phase B FINAL sweep

**Status**: READY (revision 2 — Path 1 native --background rev-1 review returned READY (Low-risk clarifications). 3 Lows applied opportunistically: §6 risk #3 sequencing rephrased (baseline B10-filtered → impl B11 → add Sqlite-Final no-filter); §1.4 test skeleton import-complete; §1.6 acceptance #11 reframed to "Phase B SQLite implementation complete" with explicit go-live-stays-separately-gated note).
**Date**: 2026-05-23.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Umbrella plan**: `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` (READY at `1ac26b1`) §2 row B11.
**Predecessors**: ABI gate (`d02fff8`); B1 (`601d74c`); B2 (`6b5d5f6`); B3 (`5400637`); B4 (`bb285ca`); B5 (`fcfc816`); B6 (`8fe0b04` / `667bb9c`); B7 (`adae300` / `69db974`); B8 (`767f1a4` / `bfda127`); B9 (`1357481` / `6289d89`); B10 (`5d77058` / `bb40855`); CCSUITE-PATH1-RCA-01 (`d3e1cbc`); WORKFLOW-HARDEN-ECHO-SLEUTH-PATH1-01 (`8d3bb0b`); execution-discipline (`9c0966f`).
**Lane**: NIGHT-RUN-SQLITE-B11-PLAN (planning only; no implementation).
**Risk**: MEDIUM. B11 is the LAST Phase B sub-WI. The implementation risk concentrates in three areas: (a) replay semantics — byte-identical canonical projection must match in-memory exactly; (b) tenant defense — replay must fall through to strict path on tenant mismatch, never short-circuit into a cross-tenant read; (c) full-harness no-filter sweep — the entire conformance suite (~299+ cases across Sqlite-B1..B11 labels) must pass under the full SQLite implementation as the **Phase B completion gate**.

## Review packet (compact)

### Active plan summary

B11 is the ELEVENTH (and FINAL) SQLite sub-WI of Phase B. Per the umbrella's §2 row B11:

> Replay-safe `*Once` variants (Phase A9 SQLite mirror): `appendFactOnce`, `upsertOcrLink` (R-5 absorbs R5.16-R5.18 fact canonical-projection equivalence). R-6 doc-asset preservation already in B2; B11 verifies it still passes under full impl. **Final**: full conformance harness (no filter) runs against `SqliteCaseBoxPersistence`; all 299+ tests + R-5 + R-6 cases pass.

**Scope clarification — only 1 NEW method body is needed** in B11. The umbrella's listing of two `*Once` variants is misleading by the rev-3 plan resolution of the umbrella-divergence note pattern (matches B6 plan §"Umbrella-divergence note"):

| Method | Status | Shipped in |
|---|---|---|
| `appendFactOnce` | NOT yet implemented | **B11 (this plan)** |
| `upsertOcrLink` | SHIPPED with byte-identical idempotent-replay semantics | B9 (`6289d89`) — `applyUpsertOcrLink` already has the 3-way upsert (create/refresh/idempotent-replay) via `deepEqualLink(prior, link)` canonical comparison. The B9 ship satisfies the umbrella's "Once variant" intent for OCR links. |

B11 therefore implements **only `appendFactOnce`** (1 new stub → impl). NO schema changes. NO new write paths (reuses B6's `case_box_facts` table v5).

**Phase B completion gate**: B11 ships a **full-harness no-filter conformance run** that exercises EVERY 6.x.x case (~299+) + every R5.* + every R6.* against `SqliteCaseBoxPersistence`. This is the umbrella's Phase B completion criterion.

Plan-only file: `dev-memo/plan-case-box-persistence-B11-once-variants.md` (THIS FILE).

### Exact target files (this plan-WI)

CREATED (single file):
- `dev-memo/plan-case-box-persistence-B11-once-variants.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- `services/case-box-persistence/**`.
- `docs/contracts/case-box-contract/**`.
- Any OCR package.
- AGENTS.md.
- Umbrella / B1..B10 plans.
- `dev-memo/plan-case-box-persistence-00.md`.

### Exact acceptance criteria (this plan-WI itself)

1. Plan committed alone (one file).
2. Plan enumerates B11 scope per umbrella §2 row B11 verbatim + clarifies that `upsertOcrLink` is ALREADY shipped (B9) so B11 implements only `appendFactOnce`.
3. Plan declares NO schema changes.
4. Plan declares the conformance label filter regex (extends B10 with `6.A9.*` + `R5.16` + `R5.17` + `R5.18`).
5. Plan declares the **full-harness no-filter sweep** as the Phase B completion gate — a NEW test file `tests/sqlite-final.conformance.test.mjs` runs the conformance harness with a `Sqlite-Final` label and NO `--test-name-pattern` filter against `SqliteCaseBoxPersistence`.
6. Plan declares hardening invariants (3+ — byte-identical replay; cross-tenant fall-through; same-id-different-payload duplicate_id).
7. Plan declares HARD-STOP categories that DO and DO NOT trigger.
8. Plan declares LOC budget per touched file.
9. Plan declares cc-suite audit + verify expectations for the impl WI.
10. Plan declares execution-discipline compliance per `.claude/rules/execution-discipline.md`.
11. Plan addresses each deferred Low explicitly (see §5).
12. cc-suite review-plan returns READY (or only Low-risk clarifications) via Path 1 native `--background`.

### Exact out-of-scope list (B11)

- **No new entities**. B11 is the FINAL sub-WI.
- **No public-API change** (B11 implements 1 EXISTING interface method).
- **No schema changes** (reuses B6's `case_box_facts` table v5).
- **No new top-level dep.**
- **No real-data migration.**
- **No API / UI / mini-program / auth / cloud / sync / LLM / OCR runtime changes.**
- **No broad refactor of `SqliteCaseBoxPersistence.ts`** beyond 1 thin call-through.
- **No `requireMatterTenant` extraction** (B7 L D2#1 stays deferred — see §5).
- **No DDL extraction** (B9 D4#2 stays deferred).
- **No upsertOcrLink reimplementation** (B9 already shipped its Once semantics).
- **No "Phase C" planning** in this WI.
- **No git push** (separate explicit authorization).
- **No committed rollback.**

### Essential references

- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` §2 row B11.
- `services/case-box-persistence/src/inMemoryFact.ts` line ~602 — `applyAppendFactOnce` behavioral target. 3-branch logic:
  1. Same id + same tenant + byte-identical canonical projection → REPLAY (return stored verbatim; NO audit).
  2. Same id + different tenant → fall through to strict `applyAppendFact` (defensive; never silent cross-tenant short-circuit; audit Dim 5 #1 fix).
  3. Same id + same tenant + different canonical projection → fall through to strict `applyAppendFact` → throws `duplicate_id` (A4 semantics).
  4. No prior row OR canonicalization throws → fall through to strict `applyAppendFact`.
- `services/case-box-persistence/src/inMemoryFact.ts` `factCanonicalProjection` — canonical JSON with sorted keys, depth cap 64, cycle defense.
- `services/case-box-persistence/src/sqlite/factsRepoQueries.ts` — existing B6 helper module to extend.
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` — B11 cases `6.A9.1`..`6.A9.13` (13 ids; no variants) + R5.16 + R5.17 + R5.18. **16 new ids total**.
- B10 audit `audit-mphygc7h-vsklaa` deferred Lows (D2#1 / D2#2 / D4#1).
- CCSUITE-PATH1-RCA-01 (`d3e1cbc`).
- `.claude/rules/cc-suite.md`, `echo-sleuth.md`, `autonomy.md`, `loc-guardian.md`, `execution-discipline.md`.

### Review questions for the reviewer

1. **B11 method-count clarification**: only `appendFactOnce` is new. `upsertOcrLink` is ALREADY shipped at B9 with byte-identical idempotent-replay semantics via `applyUpsertOcrLink`'s 3-way branching (create / refresh / replay). The umbrella's row B11 wording predates B9's design; the rev-3 plan documents this resolution (mirror of B6 plan's "Umbrella-divergence note" precedent). Is this clarification adequate? Plan does NOT propose to amend the umbrella in B11 (docs-only follow-up).

2. **`appendFactOnce` SQLite strategy** (per B11 plan §1.2):
   - Light pre-parse to extract `input.id`.
   - If id is a non-empty string: `SELECT payload_json FROM case_box_facts WHERE id = ?` (PK lookup).
   - If row found:
     a. Check input.tenant_id vs stored.tenant_id. If differ → fall through to strict `applyAppendFactSqlite`.
     b. Compute `factCanonicalProjection(stored)` and `factCanonicalProjection(input)`. If equal → return stored row verbatim (NO INSERT, NO audit).
     c. If canonicalization throws → fall through to strict.
     d. If projections differ → fall through to strict (which throws `duplicate_id`).
   - If id missing or no row: fall through to strict `applyAppendFactSqlite`.

3. **Cross-tenant defense**: replay must NEVER short-circuit when `input.tenant_id !== stored.tenant_id`. This is a load-bearing security invariant per the in-memory audit Dim 5 #1 fix. SQLite path inherits this behavior verbatim.

4. **Canonicalization throw**: per `factCanonicalProjection` line ~579, hostile payloads (depth > 64, cycles) throw `RangeError`. The B11 path catches and falls through to strict — strict path's `validateOcrLink`/`validateFact` returns `invalid_payload`. Matches in-memory.

5. **NO new file needed**: `appendFactOnce` implementation extends existing `factsRepoQueries.ts` with one new export `applyAppendFactOnceSqlite`. Estimated +50-80 LOC. Stays well under warn.

6. **Full-harness no-filter sweep** (Phase B completion gate per umbrella row B11): NEW test file `tests/sqlite-final.conformance.test.mjs` runs `runConformance("Sqlite-Final", () => ({Persistence: SqliteCaseBoxPersistenceTestWrapper}))` with NO `--test-name-pattern` filter. Exercises EVERY 6.x.x case (~299+) + R5.* + R6.* under the SQLite implementation. **All cases must pass under the FULL SQLite impl.**

7. **Conformance regex**: `^Sqlite-B11: (?:6\.1\.(...)|6\.A2\.(...)|6\.A3\.(...)|6\.A4\.(...)|6\.A5\.(...)|6\.A6\.(...)|6\.A7\.(...)|6\.A8\.(...)|6\.A9\.(?:1[0-3]|[1-9])|R5\.(?:[1-9]|9b|1[0-8]|19|20|2[1-4])|R6\.[1-4])(?:\s|$)`. Adds 6.A9.* (13 cases) + R5.16/17/18 (3 cases). **16 new ids total**.

8. **Deferred-Low handling**: see §5.

---

## §1 B11 scope

### §1.1 NO schema changes

CURRENT_SCHEMA_VERSION stays at **8**. B11 does NOT add any DDL. `appendFactOnce` reuses the existing `case_box_facts` table from B6 (schema v5).

`schema.ts` stays at 547 LOC. B9 D4#2 deferred Low does NOT progress.

### §1.2 `appendFactOnce` SQLite strategy (extend `factsRepoQueries.ts`)

Add one new export to `factsRepoQueries.ts` (estimated +50-80 LOC):

```ts
export function applyAppendFactOnceSqlite(
  db: Database,
  input: unknown,
  deps: AppendDeps,  // re-use existing applyAppendFact deps shape
): CaseBoxFact {
  // Light pre-parse to find input.id.
  if (input !== null && typeof input === "object") {
    const candidateId = (input as { id?: unknown }).id;
    if (typeof candidateId === "string" && candidateId.length > 0) {
      const priorRow = db
        .prepare("SELECT payload_json FROM case_box_facts WHERE id = ?")
        .get(candidateId) as { payload_json: string } | undefined;
      if (priorRow !== undefined) {
        const stored = JSON.parse(priorRow.payload_json) as CaseBoxFact;
        // Tenant defense: fall through to strict on mismatch.
        const inputTenant = (input as { tenant_id?: unknown }).tenant_id;
        if (typeof inputTenant === "string" && inputTenant !== stored.tenant_id) {
          return applyAppendFactSqlite(db, input, deps);
        }
        // Byte-identical canonical projection check.
        try {
          if (factCanonicalProjection(stored) === factCanonicalProjection(input)) {
            // REPLAY: return stored row verbatim. NO INSERT, NO audit.
            return stored;
          }
        } catch {
          return applyAppendFactSqlite(db, input, deps);
        }
        // Different payload, same id → fall through to strict (throws duplicate_id).
      }
    }
  }
  return applyAppendFactSqlite(db, input, deps);
}
```

Imports needed:
- `factCanonicalProjection` from `../inMemoryFact.js` (REUSED VERBATIM; no canonical re-implementation).
- `CaseBoxFact` type.

The helper is **PURE READ on the replay path** (no INSERT, no audit emit). On any fall-through, it calls `applyAppendFactSqlite` which IS transaction-wrapping via the caller's `#runImmediateWrite`.

Transaction-scope nuance: `appendFactOnce` itself is called from `SqliteCaseBoxPersistence#appendFactOnce` which wraps in `#runImmediateWrite`. The replay path does a SELECT inside the transaction (safe), and the fall-through path invokes `applyAppendFactSqlite` from within the same transaction (also safe; `applyAppendFactSqlite` does NOT open its own transaction).

### §1.3 `SqliteCaseBoxPersistence.ts` method impl

1 stub → thin call-through:

```ts
async appendFactOnce(input: unknown): Promise<CaseBoxFact> {
  const row = this.#runImmediateWrite((db, deps) => applyAppendFactOnceSqlite(db, input, deps));
  return structuredClone(row) as CaseBoxFact;
}
```

**Net LOC delta on `SqliteCaseBoxPersistence.ts`: estimated +3** (1 stub × ~2 LOC removed; 1 thin call-through × ~3 LOC added). Class lands at ~612 LOC. **B10 D4#1 stays deferred at same band.**

### §1.4 Phase B completion gate — full-harness no-filter sweep

Per umbrella row B11 "Final": NEW test file `services/case-box-persistence/tests/sqlite-final.conformance.test.mjs` (estimated ~50 LOC). Sample skeleton (per rev-1 reviewer L D2#2 — imports SHOWN COMPLETE so impl is import-ready):

```js
// Phase B FINAL conformance sweep. Per B11 plan §1.4 + umbrella row B11.
// Runs the FULL conformance harness with NO --test-name-pattern filter.
// All ~299+ cases (6.x.x + R5.* + R6.*) must pass under the SQLite impl.

import { openSqliteCaseBoxPersistence } from "../dist/index.js";
import { runConformance } from "./conformance/runCaseBoxPersistenceConformance.mjs";

// SqliteCaseBoxPersistenceTestWrapper from sqlite.conformance.test.mjs.
class SqliteCaseBoxPersistenceTestWrapper {
  constructor(opts) {
    const { persistence, db } = openSqliteCaseBoxPersistence({
      path: ":memory:",
      now: opts?.now,
      generateId: opts?.generateId,
    });
    Object.assign(this, persistence);
    Object.getOwnPropertyNames(Object.getPrototypeOf(persistence))
      .filter((m) => m !== "constructor" && typeof persistence[m] === "function")
      .forEach((m) => { this[m] = persistence[m].bind(persistence); });
    this._db = db;
  }
}

// "Sqlite-Final" label = NO filter regex. Every harness case runs.
runConformance("Sqlite-Final", () => ({ Persistence: SqliteCaseBoxPersistenceTestWrapper }));
```

`package.json` `--test` command adds this file at the END (no `--test-name-pattern`).

**This is the Phase B completion gate.** If ANY harness case fails under the full SQLite implementation, the B11 commit blocks.

### §1.5 Tests

- **`tests/sqlite.conformance.test.mjs`** — package.json `--test-name-pattern` widened with `6\\.A9\\.(?:1[0-3]|[1-9])` + `R5\\.(?:16|17|18)`. `B11_EXPECTED_CASE_IDS` extends B10's with 16 new ids. Label `Sqlite-B10` → `Sqlite-B11`. Outside-scope smoke updated (`6.A9.14+` → out; `6.A10+` → out; R5.* now complete).

- **NEW `tests/sqlite-final.conformance.test.mjs`** (per §1.4) — Phase B completion gate; full-harness no-filter sweep under `Sqlite-Final` label.

- **NEW `tests/hardening-once.test.mjs`** — 3 new B11 invariant tests:
  1. **Byte-identical replay**: append → re-append same payload → returns stored verbatim; NO audit event added (event_count unchanged); row in DB byte-identical.
  2. **Cross-tenant fall-through**: append fact under tenant-local-v1; replay same id under tenant-evil → throws (strict path handles cross-tenant; NO silent short-circuit cross-tenant read).
  3. **Same-id-different-payload duplicate_id**: append → re-append same id with different field → throws `duplicate_id` via strict path.

- **NEW `tests/impl-parity-once.test.mjs`** — 3 new B11 scenarios:
  1. `appendFactOnce` create path identical.
  2. `appendFactOnce` byte-identical replay identical (both impls return stored row; no audit added).
  3. `appendFactOnce` same-id-different-payload identical (both impls throw `duplicate_id`).

- **`tests/impl-parity-stub-frontier.test.mjs`** — DELETED. After B11, there is NO next still-stubbed method in the Phase B surface; the stub-frontier test is no longer applicable. The deletion is documented in the B11 impl commit.

- **`tests/invariants.test.mjs`** — 6.2.6b retargets `appendFactOnce` (now B11-implemented) → **DELETED test 6.2.6b** OR retargeted to a method that genuinely stays stubbed beyond Phase B (likely Phase C territory; no stub remains in B11). Plan picks: **DELETE 6.2.6b** (no stub remaining). Add a one-line comment in invariants.test.mjs noting that Phase B is complete and the stub-frontier invariant is retired.

### §1.6 Acceptance criteria (impl WI; this plan-WI does NOT execute)

1. `npm --prefix services/case-box-persistence test` exits 0.
2. SQLite impl passes shared conformance cases `6.A9.*` + `R5.16` + `R5.17` + `R5.18`.
3. The 3 B11 hardening tests pass.
4. The 3 B11 impl-parity scenarios deep-compare across both impls.
5. **The full-harness no-filter sweep passes** — every `Sqlite-Final: ...` case (the entire ~299+ test surface) green.
6. All Phase A in-memory tests stay green.
7. B1-B10 SQLite tests stay green.
8. ocr-persistence + ocr-worker + case-box-contract + docs/contracts unchanged green.
9. loc-guardian: 0 over fail. `SqliteCaseBoxPersistence.ts` lands at ~612 LOC (B10 D4#1 same band).
10. cc-suite audit (mini) via Path 1 native `--background`: PASS or NEEDS-FIX-fixed-and-verified.
11. **Phase B SQLite implementation declared COMPLETE** by the B11 impl commit message. Per rev-1 reviewer L D4#3 clarification: "Phase B SQLite implementation complete" is the precise framing; **go-live readiness remains separately gated** (per `.claude/rules/autonomy.md` §"Hard-stop list" — final go-live approval and production data operations are explicit STOP-AND-ASK items, NOT auto-conferred by Phase B completion).

---

## §2 LOC budget per file (post-B11)

Current state (post-B10 commit `bb40855`):

| File | Current LOC | B11 estimated delta | Threshold |
|---|---|---|---|
| `src/sqlite/schema.ts` | 547 | 0 (no DDL changes) | over warn (no progression) |
| `src/sqlite/SqliteCaseBoxPersistence.ts` | 609 | +3 (1 thin call) → ~612 | OVER warn 500, under fail 800 |
| `src/sqlite/factsRepoQueries.ts` | 378 | +50-80 (applyAppendFactOnceSqlite) → ~430-460 | source warn 500 |
| Other sibling repo-queries | 89-458 each | 0 | |
| `src/sqlite/aggregationsRepoQueries.ts` | 413 | 0 | |
| `tests/sqlite.conformance.test.mjs` | 170 | +5 (regex + 16 ids) | test warn 700 |
| `tests/sqlite-final.conformance.test.mjs` (NEW) | ~30-50 | new | test warn 700 |
| `tests/hardening-once.test.mjs` (NEW) | ~100 | new | test warn 700 |
| `tests/impl-parity-once.test.mjs` (NEW) | ~80 | new | test warn 700 |
| `tests/impl-parity-stub-frontier.test.mjs` | 21 | **DELETED** | |
| `tests/invariants.test.mjs` | ~-12 (6.2.6b removal) | | |

LOC-growth-prevention posture: `SqliteCaseBoxPersistence.ts` stays at warn band (+3 LOC). `schema.ts` does NOT change. `factsRepoQueries.ts` lands at ~430-460 LOC, comfortably under warn.

---

## §3 Hard-stop alignment

- **SQLite / better-sqlite3 / native-module work** — TRIGGERED. No new dep.
- **New runtime dependency** — NOT triggered.
- **Schema migration on PERSISTED REAL DATA** — NOT triggered (no schema changes at all).
- **Public API break** — NOT triggered (B11 implements 1 EXISTING stub).
- **Auth / cloud / sync / LLM / external exposure** — NOT triggered.
- **Cross-package boundary** — B11 stays inside `services/case-box-persistence/**`. No OCR-package dependency.
- **Push / deploy / secrets / production data** — NOT triggered.

Per the no-revert posture: fix-forward; STOP-FOR-ROLLBACK if necessary.

---

## §4 Execution-discipline compliance (per `.claude/rules/execution-discipline.md`)

### §4.1 Think before coding
- WI scope: 1 method impl + 1 helper extension + 3 new test files + 1 test file deletion + invariants.test.mjs trim. No schema changes.
- Assumptions:
  - `factCanonicalProjection` REUSED VERBATIM from in-memory.
  - `applyAppendFactSqlite` REUSED VERBATIM via fall-through.
  - `upsertOcrLink` is NOT touched (B9 already shipped Once semantics).
- Hard stops cross-checked: no triggers.

### §4.2 Simplicity first
- Smallest slice: 1 new helper function + 1 thin call-through + tests.
- Reuse: `factCanonicalProjection`, `applyAppendFactSqlite`, contract validators.
- No speculative abstractions. No new file unless the helper grows beyond ~80 LOC (then extract to a sibling).

### §4.3 Surgical changes
- WI authored file list:
  - MODIFIED: `services/case-box-persistence/src/sqlite/factsRepoQueries.ts` (extend with applyAppendFactOnceSqlite); `SqliteCaseBoxPersistence.ts` (1 thin call-through + import); `package.json` (filter regex + label + test paths); `tests/sqlite.conformance.test.mjs`; `tests/invariants.test.mjs` (6.2.6b removal).
  - NEW: `services/case-box-persistence/tests/sqlite-final.conformance.test.mjs`; `tests/hardening-once.test.mjs`; `tests/impl-parity-once.test.mjs`.
  - DELETED: `tests/impl-parity-stub-frontier.test.mjs` (no remaining stub frontier).
  - MODIFIED: `dev-memo/deferred-audit-findings.md` (B11 entry).

### §4.4 Goal-driven execution
- Acceptance criteria testable (§1.6).
- cc-suite audit via Path 1 native `--background` on impl commit.
- **Phase B completion declared in the B11 impl commit message.**

### §4.5 Relationship to existing rules
- B11 plan does NOT bypass cc-suite review-plan (this is the review).
- B11 plan does NOT relax loc-guardian thresholds.
- B11 plan respects autonomy hard-stops, rollback policy, night-run policy.
- B11 plan honors CCSUITE-PATH1-RCA-01 + WORKFLOW-HARDEN-ECHO-SLEUTH-PATH1-01.

---

## §5 Deferred-Low handling

Per lane constraint: account for ALL existing deferred Lows.

| Finding | B11 plan position |
|---|---|
| **B10 D2#1** (matter-guard duplication via local `loadMatterChecked`) | NOT touched (B11 reuses factsRepoQueries.ts; no new matter+tenant validation surface). **Stays deferred**. |
| **B10 D2#2** (8 inline bucket queries in getMatterSummary) | NOT touched. **Stays deferred**. |
| **B10 D4#1** (`SqliteCaseBoxPersistence.ts` 609 LOC band) | B11 adds +3 LOC → ~612. **Stays deferred** at same band. |
| **B9 D4#1** (carried forward; SqliteCaseBoxPersistence band) | Same as B10 D4#1; **stays deferred**. |
| **B9 D4#2** (`schema.ts` 547 LOC over warn) | NOT touched (no DDL changes). **Stays deferred** at same LOC. |
| **B8 D2#1** (conformance regex duplication) | NATURALLY touched (alternation extension). **Stays deferred**; preflight inventory continues to enforce parity. |
| **B7 L D2#1** (`requireMatterTenant` duplicated) | NOT touched. **Stays deferred**. |
| **B5 D1#2** (getPrivilegeStatus perf) | NOT touched. **Stays deferred**. |
| **B5 D2#1** (privilege shadow-state shim duplication) | NOT touched. **Stays deferred**. |
| **B5 D4#2** (global id scan pattern) | NOT touched. B11's appendFactOnce uses targeted PK SELECT only. **Stays deferred** at existing 2 occurrences. |

No deferred Low is naturally closed by B11. The Phase B FINAL completion does NOT auto-close deferred Lows; each Low remains a future cleanup target (post-Phase B).

---

## §6 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Medium | Canonical projection drift between SQLite-stored row (after JSON.parse) and input — extra fields stripped by the schema validator on the stored row's create path could cause "byte-identical" canonical projections to subtly differ. Result: legitimate replays would emit duplicate_id instead of returning stored. | Per in-memory line 626 `factCanonicalProjection(stored) === factCanonicalProjection(input)` already handles this — both inputs flow through the SAME canonical projection function. SQLite's stored payload_json is the SAME JSON that the in-memory state holds (B6 plan §1.2: `payload_json` is canonical). Reuse the in-memory `factCanonicalProjection` verbatim. Impl-parity test #2 enforces. |
| 2 | Medium | Cross-tenant defense: if input.tenant_id differs from stored.tenant_id, SQLite path MUST fall through to strict (NOT short-circuit into a cross-tenant read). A subtle bug here is a tenant-isolation leak. | Per §1.2 step 2a: explicit `if (input.tenant_id !== stored.tenant_id) return applyAppendFactSqlite(db, input, deps)`. Hardening test #2 enforces. |
| 3 | Medium | Full-harness no-filter sweep (Phase B completion gate) — if any Sqlite-Final case fails, B11 cannot ship. The failure could be in any of B1-B11's surface (~299+ cases), not just B11's new code. | **Correct sequencing per rev-1 reviewer L D1#3** (the "run full sweep BEFORE B11 tests" framing is wrong because the no-filter sweep should INCLUDE B11 behavior and would fail before impl lands): (a) Run B10 filtered baseline (current `Sqlite-B10:` regex) BEFORE starting B11 changes — confirm B1-B10 is green. (b) Implement `applyAppendFactOnceSqlite` + the `Sqlite-B11:` filter extension. (c) Run B11 filtered (`Sqlite-B11:` regex includes 6.A9.* + R5.16..18). (d) Add `sqlite-final.conformance.test.mjs` (no-filter sweep under `Sqlite-Final` label). (e) Run full no-filter sweep — only safe to expect green AFTER B11 impl + filter extension are in place. |
| 4 | Low | The `applyAppendFactOnceSqlite` extension may push `factsRepoQueries.ts` over warn 500 (currently 378 → estimated ~430-460). Margin is comfortable but watch for accumulation. | Track LOC in the impl commit; if over warn, extract `applyAppendFactOnceSqlite` to a NEW sibling file `factsOnceRepoQueries.ts`. Plan picks the in-file extension as the simplest path. |
| 5 | Low | Deletion of `impl-parity-stub-frontier.test.mjs` removes the stub-frontier invariant. Future Phase-C work may want to re-introduce it. | Acceptable; Phase B has no remaining stubs to track. If Phase C adds new stubs, that WI can re-add the file. |
| 6 | Low | 6.2.6b in invariants.test.mjs is removed (no remaining stub). | Acceptable per §5 above. |

No Critical / High risks.

---

## §7 cc-suite audit / verify expectations

For the impl WI (NOT this plan-WI):
- **cc-suite audit (mini)** via Path 1 native `--background` on the impl commit's scope. Expected: PASS or NEEDS-FIX with C/H/M fixed + verify.
- **cc-suite verify** ONLY if audit produces C/H/M findings the WI fixes.
- **Recording** per `.claude/rules/cc-suite.md` §"Required recording" 11-field block in the impl commit's message.
- Lows: append per-finding rows to `dev-memo/deferred-audit-findings.md` under a new "Phase B11" entry.

cc-suite execution rule per lane authorization + `.claude/rules/cc-suite.md` §"Background-invocation discipline": **NEVER** wrap the runner in Claude Code Bash `run_in_background: true`. Use runner foreground OR runner native `--background` flag.

---

## §8 References

- `dev-memo/plan-case-box-persistence-phase-b-sqlite.md` §2 row B11 (umbrella).
- B1-B10 plans + impls.
- CCSUITE-PATH1-RCA-01 (`d3e1cbc`).
- WORKFLOW-HARDEN-ECHO-SLEUTH-PATH1-01 (`8d3bb0b`).
- `services/case-box-persistence/src/inMemoryFact.ts` lines ~577-640 (canonical projection + applyAppendFactOnce).
- `services/case-box-persistence/src/sqlite/factsRepoQueries.ts` (existing B6 helper module).
- `services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs` lines for 6.A9.* + R5.16/17/18.
- B10 audit `audit-mphygc7h-vsklaa` deferred Lows.
- `.claude/rules/cc-suite.md`, `echo-sleuth.md`, `autonomy.md`, `loc-guardian.md`, `execution-discipline.md`.

---

## §9 Stop condition

This plan is stale or superseded when:
- B11 impl commits — plan transitions to "superseded by B11 impl commit `<hash>`".
- Umbrella plan revision changes B11 scope.
- `applyAppendFactOnce` in-memory contract changes.
- **Phase B is declared complete** by the B11 impl commit.
