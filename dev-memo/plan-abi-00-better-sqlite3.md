# Plan: ABI-00 — `better-sqlite3` ABI remediation before case-box-persistence Phase B

> **Historical snapshot (provenance note, added 2026-06-02).** This is a planning record from
> 2026-05. Point-in-time status statements below — such as "Phase A9 / in-memory only", "SQLite
> Phase B has not started", or "does not depend on `better-sqlite3`" — were accurate when written
> but have since been **superseded**: this plan's ABI remediation landed (gate closed) and SQLite
> Phase B (`services/case-box-persistence/src/sqlite/*`) subsequently landed, so
> case-box-persistence now uses `better-sqlite3` and the desktop runtime persists to SQLite.
> Original wording is preserved as the dated record, not a claim about current behavior; the
> plan's design value is unchanged.

**Status**: READY (revision 2 — review-plan v2 returned READY (Low-risk) at jobId `review-plan-mpgmzfz9-tdripy`; 3 Lows applied opportunistically: stale "version bump" + "≤4 files" prose corrected; review Q4 / risk-6 cross-refs fixed; §6 closing sentence "no Critical/High"; explicit rollback path added to §3.1 Step 1).
**Date**: 2026-05-22.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Promoted from**: `dev-memo/spark/2026-05-21-abi-remediation-before-sqlite-phase-b-spark.md` (spark spec; non-authoritative; superseded by this plan once `READY`).
**Source plan**: `dev-memo/plan-case-box-persistence-00.md` §7 (native-module / ABI baseline gate); §10 phase table row "GATE — ABI remediation WI (separate authorization)".
**Risk**: HIGH (native module / framework / runtime-dependency per `.claude/rules/cc-suite.md` §"High-risk WIs").

## Review packet (compact)

### Active plan summary

Repair the pre-existing `better-sqlite3` native-module ABI mismatch in `services/ocr-persistence/` so that SQLite-backed tests run green under the current Node 24 runtime. Today the installed prebuilt binary was compiled against `NODE_MODULE_VERSION 127` (Node 22 LTS) and the active host runs Node 24 (`NODE_MODULE_VERSION 137`), surfacing as `ERR_DLOPEN_FAILED` in every `tests/sqlite*.test.mjs` file under `services/ocr-persistence/`. The mismatch is documented in `docs/release/wi-03-security-signoff.md` §"Known baseline failures" and acknowledged in `dev-memo/plan-case-box-persistence-A1.md` §6.6 as a deliberate "do not block A-series; gate Phase B on a separate ABI WI."

The plan picks the spark's **Option O2** reframed to "reinstall first; version bump only if reinstall fails": engines pin + ABI smoke script + AGENTS.md sentence + (conditional) minimal `better-sqlite3` version bump. One bounded WI; ≤ 3 authored files + 1 mechanical lockfile delta = total ≤ 4 files changed; no source code under `src/` modified; no new runtime dependency added.

This plan is **plan-only**: it does not modify any package.json, does not run `npm rebuild`, does not create the smoke script, does not change AGENTS.md. The implementation is a SEPARATE follow-up WI (WI-ABI-01-impl) opened after this plan returns READY.

### Exact target files (this plan-WI)

CREATED (single file):
- `dev-memo/plan-abi-00-better-sqlite3.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- `services/ocr-persistence/package.json`.
- `services/case-box-persistence/package.json`.
- `services/ocr-persistence/scripts/abi-smoke.mjs` (does not exist yet).
- `services/ocr-persistence/package-lock.json`.
- `services/case-box-persistence/package-lock.json`.
- `node_modules/**` anywhere in the repo.
- `AGENTS.md`.
- Any `src/**` or `tests/**` file.
- `.nvmrc`, `.tool-versions`, `Dockerfile`, `.github/workflows/**` (none of these exist today; this WI does NOT introduce them).
- `dev-memo/spark/2026-05-21-abi-remediation-before-sqlite-phase-b-spark.md` (spark spec stays for historical reference; superseded once this plan reaches READY).

### Exact acceptance criteria (for the plan-WI itself; impl WI has its own ACs below)

1. The plan is committed alone (one file). No package.json, no AGENTS.md, no script, no `node_modules/` change.
2. The plan accurately diagnoses the current state by quoting:
   - The live `node -v` reading.
   - The `better-sqlite3` version present in `services/ocr-persistence/package.json`.
   - The location of the existing prebuilt `.node` binary.
   - The existing failure-log citations in `docs/release/wi-03-security-signoff.md`.
3. The plan picks ONE remediation path (O2) and explicitly rejects O1 (rebuild-only) and O3 (postinstall rebuild) with reasoning.
4. The plan lists every implementation-WI file edit by exact path + intent.
5. The plan names the verification tests for the impl WI (existing `npm --prefix services/ocr-persistence test`; `npm --prefix services/case-box-persistence test` for unchanged A-series).
6. The plan declares HARD-STOP categories that DO and DO NOT trigger.
7. The plan records the cc-suite recording fields per `.claude/rules/cc-suite.md` §"Required recording" so the follow-up impl WI inherits them.
8. cc-suite review-plan returns READY (or only Low-risk clarifications). CCSUITE-02 retry policy applies if attempt 1 times out.

### Exact out-of-scope list (for the plan-WI AND the impl WI it queues)

- **Phase B implementation.** This WI unblocks Phase B; it does NOT begin Phase B. The case-box-persistence Phase B plan is its own separate WI with its own cc-suite review-plan cycle.
- **Driver swap.** `better-sqlite3` stays. No `sql.js`, no `node:sqlite` (Node 22.5+ experimental), no Postgres, no SQLite-wasm. Driver swap, if anyone wants to revisit it, is a separate `/spark` request.
- **New runtime dependency.** No new top-level dep introduced. A patch/minor version bump of `better-sqlite3` is acceptable; introducing a sibling package (`node-pre-gyp`, `node-gyp-build`, etc.) is NOT.
- **CI infrastructure.** No `.github/workflows/` introduction in this WI. A local `pretest` smoke script is the deliverable.
- **Migration of existing SQLite data.** None exists (case-box-persistence is in-memory; OCR persistence ships no populated DB).
- **Node version pinning beyond engines field.** No `.nvmrc`, no Volta config, no Docker image, no `.tool-versions`.
- **AGENTS.md restructure.** Only the supported-Node sentence (and its companion note about the smoke step) changes.
- **Schema changes, contract changes, API/wire changes.** Native-module remediation is purely a build-time / install-time concern; no consumer of `better-sqlite3` sees a different interface.
- **Authorization for the impl WI itself.** The user must separately authorize WI-ABI-01-impl after this plan returns READY.
- **Push.** No git push from this plan-WI.

### Essential references

- `dev-memo/spark/2026-05-21-abi-remediation-before-sqlite-phase-b-spark.md` (spark spec; the recommendation, options analysis, and risk list are reproduced verbatim where possible to avoid divergence).
- `dev-memo/plan-case-box-persistence-00.md` §7 (Native-module / ABI baseline three-option matrix); §7.4 sketch of "ABI remediation WI shape".
- `services/ocr-persistence/package.json` (current versions).
- `services/ocr-persistence/node_modules/better-sqlite3/package.json` (currently-installed package).
- `docs/release/wi-03-security-signoff.md` §"Known baseline failures" (`NODE_MODULE_VERSION 127 ≠ 137`).
- `dev-memo/plan-loc-01.md` §"Test baseline" (documents the same ABI baseline).
- `.claude/rules/cc-suite.md` §"High-risk WIs" + §"Required recording".
- `.claude/rules/autonomy.md` (SQLite / better-sqlite3 / native-module work is a hard-stop item; this WI is the explicit authorization request).
- `.claude/rules/spark.md` §"Hard stops" (same).
- `.claude/rules/client-local-first.md` (locks v1 to local-first → `better-sqlite3` driver stays).
- `.claude/rules/loc-guardian.md` (impl WI well under thresholds).

### Review questions for the reviewer

1. Is Option O2 (engines pin + smoke script + version bump + AGENTS.md sentence) the right remediation, given the locked v1 client posture and the user's "no rebuild yet" instruction for THIS plan-WI?
2. Is the engines upper bound (`<26.0.0`) defensible, or too restrictive given Node 24 is current LTS-track and Node 26 is not yet released?
3. Is the `pretest` `scripts/abi-smoke.mjs` correctly scoped to detect the failure mode without false positives (i.e., a 10-15-LOC `:memory:` open-and-close)?
4. Does the impl WI need to touch `services/case-box-persistence/package.json` even though case-box-persistence does not yet depend on `better-sqlite3`? Per reviewer Dim-4 #2 of attempt 1, this plan now picks **"no — defer to Phase B"**. The engines symmetry is preparatory policy that belongs with the dep introduction, not this WI.
5. Should the impl WI also touch `docs/contracts/package.json` / `docs/contracts/case-box-contract/package.json` for engines symmetry? They are not consumers of `better-sqlite3` but are at the same Node-version sensitivity for JSON import assertions. Plan picks "no — contract packages already pin `>=22.0.0` and have no native deps; adding the upper bound is a separate cleanup."
6. Are the cc-suite review-plan retry policy (CCSUITE-02) expectations correctly recorded for the impl WI to inherit?

---

## §1 Diagnosis

### §1.1 Live host state (captured 2026-05-22)

```
$ node --version
v24.14.0

$ npm --version
11.9.0

$ uname -sm
Darwin arm64
```

### §1.2 Installed `better-sqlite3` state

```
$ ls services/ocr-persistence/node_modules/better-sqlite3/build/Release/
better_sqlite3.node          # prebuilt binary compiled against NODE_MODULE_VERSION 127

$ cat services/ocr-persistence/node_modules/better-sqlite3/package.json | head -10
{
  "name": "better-sqlite3",
  "version": "12.9.0",
  ...
  "engines": { "node": "20.x || 22.x || 23.x || 24.x || 25.x" },
  ...
}

$ cat services/ocr-persistence/package.json | grep '"better-sqlite3"'
    "better-sqlite3": "^12.9.0",
```

The `better-sqlite3` 12.9.0 package itself officially advertises a Node range of `20.x || 22.x || 23.x || 24.x || 25.x` in its `engines` field. The **published 12.9.0 prebuilt** that landed in `node_modules/` was, however, compiled against Node 22's ABI (NODE_MODULE_VERSION 127). When the active host is Node 24 (NODE_MODULE_VERSION 137), the binding fails to load:

```
Error: dlopen(...services/ocr-persistence/node_modules/better-sqlite3/build/Release/better_sqlite3.node):
  Symbol not found in flat namespace
  (or NODE_MODULE_VERSION mismatch — 127 vs 137)
```

Manual verification per the spark spec §3 "Inferred from repo state" (`node -v` → `v24.14.0`; running the ocr-persistence test command reproduces the failure exactly).

### §1.3 Test-script surface impacted

`services/ocr-persistence/package.json` `"test"` script:

```
node --test
  tests/inMemory.conformance.test.mjs                # ABI-free — passes
  tests/sqlite.conformance.test.mjs                  # ABI-blocked
  tests/sqlite.hardening.test.mjs                    # ABI-blocked
  tests/sqliteQueue.schema.test.mjs                  # ABI-blocked
  tests/sqliteQueue.lineage.test.mjs                 # ABI-blocked
  tests/sqliteQueue.conformance.test.mjs             # ABI-blocked
  tests/sqliteQueue.contention.test.mjs              # ABI-blocked
  tests/sqliteAtomicEnqueue.step10k.test.mjs         # ABI-blocked
```

8 of 9 test files in the ocr-persistence package depend on the native binding. Only the in-memory test runs green today.

`services/case-box-persistence/` does NOT depend on `better-sqlite3` (Phase A1-A9 in-memory only; `package.json` description confirms "SQLite gated on ABI remediation. No native dependency."). It is unaffected and is the precise reason the case-box A-series shipped in 9 WIs without blocking on this.

### §1.4 Existing documentation acknowledging the gap

- `docs/release/wi-03-security-signoff.md` §"3 failures — all baseline `better-sqlite3` ABI mismatch (`NODE_MODULE_VERSION 127 ≠ 137`, Node 22-built native binding under Node 24 ('Native module ABI' — run `npm rebuild` after every Node-version change))." Pre-existing baseline; not introduced by WI-03.
- `dev-memo/plan-case-box-persistence-A1.md` §6.6 ABI baseline handling: A1 deliberately decoupled from `better-sqlite3`; OCR persistence ABI mismatch NOT inherited.
- `dev-memo/plan-case-box-persistence-A1.md` §8.4 acceptance criterion: A1 test command must NOT load `better-sqlite3` (grep for `NODE_MODULE_VERSION` / `ERR_DLOPEN_FAILED` — neither must appear). Continues to hold through A9.
- `dev-memo/plan-loc-01.md` §"Test baseline" acknowledges the documented ABI mismatch as a known baseline.

### §1.5 What is unblocked once this WI lands

Case-box-persistence Phase B (the SQLite-backed implementation, planned per `dev-memo/plan-case-box-persistence-00.md` §10 phase table) is currently gated explicitly on this WI. Once `npm --prefix services/ocr-persistence test` exits 0 cleanly on Node 24, Phase B can open its own WI with its own cc-suite review-plan cycle.

The R-5, R-6 (doc-asset), and matter-type chains are all already closed in-memory; Phase B's job is the SQLite implementation of the same conformance suite. Nothing in this WI implies Phase B's design — that's a separate plan.

---

## §2 Options considered (reproduced from spark §5, with the same conclusions)

| Option | Description | Verdict |
|---|---|---|
| **O1** — Reinstall / rebuild only | Delete the stale `services/ocr-persistence/node_modules/better-sqlite3` and re-run `npm install` (which triggers `prebuild-install`), OR run `npm rebuild better-sqlite3` directly; add `pretest` smoke; document Node range. | **Rejected as the sole approach** but **adopted as the FIRST step** of the impl WI per Dimension-3 reviewer feedback: `better-sqlite3@12.9.0` already publishes a `node-v137-darwin-arm64` prebuild, so the existing local failure is **a stale binary compiled under a prior Node 22 install** — not a missing prebuild. A clean reinstall on Node 24 SHOULD resolve it. O1 alone is rejected because it leaves no engines pin, no smoke script, and no AGENTS.md guidance — future Node majors will silently break again. |
| **O2** — Reinstall + engines pin + smoke script + AGENTS.md note (NO version bump unless O1 fails) | Step 1: clean reinstall against Node 24 (drops the stale binary; pulls the existing 12.9.0 prebuild). Step 2: add `engines.node: ">=22.0.0 <26.0.0"` on `ocr-persistence`. Step 3: add `pretest scripts/abi-smoke.mjs`. Step 4: update AGENTS.md Repo Brief sentence. **No version bump** unless Step 1 fails. **No `case-box-persistence/package.json` engines edit** in this WI (deferred to Phase B per Dim-4 reviewer feedback — case-box-persistence does not yet import `better-sqlite3`, so engines symmetry now is preparatory policy that belongs with the dep introduction). | **Recommended**: addresses root cause (stale binary cleared by reinstall); surfaces future ABI gaps via engines pin; fast-fail smoke step beats opaque `ERR_DLOPEN_FAILED` per plan-00 §7.4 bullet 4; minimum-blast-radius (no version bump unless required). |
| **O3** — Hybrid: O2 plus `postinstall` `npm rebuild better-sqlite3` | Belt-and-braces: forces rebuild even if a future fresh clone hits a prebuild gap. | **Rejected for the default path**: adds install-time complexity, surprises CI / sandbox environments where `npm install --ignore-scripts` is common, and is unnecessary because Step 1 of O2 already exercises `prebuild-install`. **Reserved as fallback** if WI execution discovers `prebuild-install` fails to fetch a prebuild for the target Node/platform combination (Risk 1 below — now Medium severity per reviewer feedback). |

This plan recommends **O2 with a no-version-bump-by-default posture**. The impl WI's first execution step is **verify clean reinstall fixes the ABI**; only if that step fails does the impl bump `better-sqlite3` to the smallest patch/minor version that publishes the missing prebuild. O3 remains the deeper fallback.

---

## §3 Recommended direction (O2) — impl-WI scope

### §3.1 Impl-WI execution sequence

**Step 0 (diagnosis, no commits)**: verify that `better-sqlite3@12.9.0` publishes a `node-v137-darwin-arm64` prebuild (and Node 22 ABI equivalent). The reviewer's Dim-3 finding confirms this is already the case for current host; impl WI re-verifies at execution time.

**Step 1 (reinstall, no commits)**:
- **Pre-step snapshot for rollback** (per reviewer Dim-3 #1): capture `git status --short` and `git diff services/ocr-persistence/package-lock.json` before any mutation. If reinstall worsens local state or mutates the lockfile in unexpected ways, restore via `git restore services/ocr-persistence/package-lock.json` then `rm -rf services/ocr-persistence/node_modules` and re-run `npm install` from the checked-in manifest BEFORE attempting any fallback bump.
- `rm -rf services/ocr-persistence/node_modules/better-sqlite3`
- `npm --prefix services/ocr-persistence install` (this re-runs `prebuild-install` and fetches the binary matching the active Node ABI).
- Run `npm --prefix services/ocr-persistence test` to confirm the SQLite suite passes.
- IF Step 1 succeeds: proceed to Step 2 with NO `better-sqlite3` version bump in `package.json`.
- IF Step 1 fails (prebuild missing OR fetch fails): fall back to **smallest 12.x version that publishes a verified Node 22/24 prebuild AND keeps the OCR SQLite suite green** (per reviewer Dim-3 #2 + Dim-4 #1). Bump explicitly to that version (NOT "latest 12.x"). If even O2-with-bump fails, fall back to O3 (postinstall rebuild). At each fallback transition, capture a `git status` snapshot before mutating anything; rollback via `git restore` paths if a fallback worsens state.

**Step 2 (file edits, single commit)**: the impl WI then touches:

1. `services/ocr-persistence/package.json`
   - Add `"engines": { "node": ">=22.0.0 <26.0.0" }`.
   - Add `"pretest": "node scripts/abi-smoke.mjs"` to scripts.
   - IF Step 1 fallback was triggered: bump `better-sqlite3` (and `@types/better-sqlite3` if needed) to the smallest verified version.

2. `services/ocr-persistence/scripts/abi-smoke.mjs` (NEW; ~10-15 LOC)
   - Imports `better-sqlite3`, **constructs `new Database(':memory:')`** (not just `require()`, per reviewer Dim-2 #4), runs `db.prepare('SELECT 1').get()`, closes the handle, prints `[abi-smoke] OK`, exits 0.
   - On any throw: print `[abi-smoke] FAIL: <error>` and exit 1.
   - No filesystem I/O beyond `:memory:`. No environment dependencies. No temp files.

3. `AGENTS.md` Repo Brief section
   - Replace any current Node-range sentence with: `Node 22.x or 24.x (LTS line; 23.x / 25.x permitted by engines semver but not exercised in repo). Upper bound enforced via engines until this repo chooses to support Node 26. ABI smoke runs as pretest in services/ocr-persistence.` (Reviewer Dim-1 #3 + Dim-3 #4: be explicit about which Node majors are exercised vs merely permitted; reword "when Node 26 ships" → "when this repo chooses to support Node 26".)
   - No other AGENTS.md edits.

`services/case-box-persistence/package.json` is **NOT touched in this WI** (reviewer Dim-4 #2). Engines symmetry for case-box-persistence is queued for Phase B's WI, which is when `better-sqlite3` actually becomes a case-box dep. Adding the engines bound now would be a preparatory policy edit without a current functional purpose; deferring keeps the impl WI's blast radius minimal.

### §3.2 What the impl WI does NOT touch

- No file under `services/*/src/**`.
- No file under any `tests/**` directory (the existing ocr-persistence SQLite test files are the verification gate; they remain unchanged).
- No `package-lock.json` hand edits. `npm install` will mechanically update `services/ocr-persistence/package-lock.json` (binary integrity + engines metadata). These deltas are committed alongside the authored files but are NOT counted toward the "authored files" budget below.
- No `node_modules/**` (gitignored).
- No `.nvmrc` / `.tool-versions` / `Dockerfile`.
- No contract packages (`docs/contracts/**`).
- No `case-box-persistence/**` (deferred per §3.1).
- No `services/ocr-worker/`, `services/ocr-ingestion/`, `services/ocr-review/` package.json edits (they import `ocr-persistence` by file path, so the engines pin reaches them via dependency resolution; explicit engines duplication is preparatory cleanup, not required by this WI).
- No OCR package source.

### §3.3 Impl-WI acceptance criteria

1. `npm --prefix services/ocr-persistence test` exits 0 on Node 24. (Node 22 verification is documented if a Node 22 host is available; otherwise the engines range plus prebuild coverage is the textual guarantee.)
2. **`npm --prefix services/ocr-worker test` exits 0 on Node 24.** Per reviewer Dim-2 #1 + Dim-5 #1: `docs/release/wi-03-security-signoff.md` §"Known baseline failures" records that ocr-worker also has 3 ABI-mismatch failures from the same `better-sqlite3` baseline; resolving ocr-persistence alone would leave worker red. (ocr-worker imports `ocr-persistence` via `file:` link, so the binary fix transitively reaches it once `ocr-persistence/node_modules/better-sqlite3` is repaired.)
3. `npm --prefix services/case-box-persistence test` continues to exit 0 (A1-A9 in-memory tests remain green).
4. `npm --prefix docs/contracts/case-box-contract test` continues to exit 0.
5. `npm --prefix docs/contracts test` continues to exit 0.
6. `node scripts/abi-smoke.mjs` (from `services/ocr-persistence/`) exits 0 with a single OK line on Node 24.
7. `pretest` runs the smoke step before the test suite.
8. `engines.node` pin present on `services/ocr-persistence/package.json` (NOT on case-box-persistence in this WI — see §3.1).
9. AGENTS.md Repo Brief reflects the new supported-Node range and the smoke step.
10. **`git diff --name-only` shows ≤ 3 authored files** (`services/ocr-persistence/package.json`, `services/ocr-persistence/scripts/abi-smoke.mjs`, `AGENTS.md`) **plus** the mechanical `services/ocr-persistence/package-lock.json` delta. Total: ≤ 4 files. (Reviewer Dim-2 #2 + Dim-4 #3: "≤ 4 changed files" original phrasing was misleading because it conflated authored vs lockfile.)
11. No new top-level dependency added. A `better-sqlite3` patch/minor bump is allowed only if §3.1 Step 1 fails; in that case the bump is the smallest version that restores green.

---

## §4 Verification matrix (for the impl WI; this plan does NOT execute)

| Test command | Pre-impl expected | Post-impl expected |
|---|---|---|
| `npm --prefix services/ocr-persistence test` | FAIL — `ERR_DLOPEN_FAILED` in every `sqlite*.test.mjs` | GREEN |
| **`npm --prefix services/ocr-worker test`** | **FAIL — 3 baseline ABI failures per WI-03 signoff §"Known baseline failures"** | **GREEN** |
| `node services/ocr-persistence/scripts/abi-smoke.mjs` | not present | GREEN — single OK line, exit 0 |
| `npm --prefix services/case-box-persistence test` | GREEN (in-memory only) | GREEN (unchanged) |
| `npm --prefix services/ocr-ingestion test` | (verify pre-impl baseline; expected GREEN since it does NOT import better-sqlite3 directly, but does import ocr-persistence by file: ref) | GREEN |
| `npm --prefix services/ocr-review test` | (verify pre-impl baseline) | GREEN |
| `npm --prefix docs/contracts/case-box-contract test` | GREEN | GREEN (unchanged) |
| `npm --prefix docs/contracts test` | GREEN | GREEN (unchanged) |

No new test file is added. The existing OCR SQLite suites (in ocr-persistence + ocr-worker) ARE the gate.

---

## §5 What must remain untouched (canonical, restated)

- Case-box-persistence Phase B implementation (separate WI).
- Driver swap (separate spark / decision).
- Schema changes (none in this WI).
- API / UI / auth / cloud / sync / LLM (none in this WI).
- CI workflow infrastructure (none in repo; not introducing).
- Migration of existing SQLite data (no DB on disk).
- AGENTS.md restructure beyond the one supported-Node sentence + smoke note.
- New runtime deps beyond a `better-sqlite3` patch/minor bump.
- Contract packages (`docs/contracts/**`).
- Node version pinning beyond `engines`.

---

## §6 Risks (reproduced from spark §7 with the same severities)

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Medium | Prebuilds may not cover the full engines range for a future Node major (e.g., Node 26 LTS). Today, `better-sqlite3@12.9.0` publishes `node-v137-darwin-arm64` (and the Node 22 ABI equivalent), per reviewer Dim-3 finding — so the current local failure is a stale local binary, NOT a missing prebuild. | Impl WI Step 0 verifies the prebuild for the active Node version exists. If absent (Node 26+ scenario), fall back to a minimal version bump per O2 Step 1 fallback, or O3 (postinstall rebuild) and record the Xcode CLT prereq. Likelihood: low for Node 22/24/arm64 today; medium for the next Node major. Impact: forces an additional version bump OR a postinstall step. |
| 2 | Medium | Engines upper bound (`<26.0.0`) ages. The pin catches the next ABI gap as a clean failure, but a developer running Node 26+ before the WI is updated cannot install. | When this repo chooses to support Node 26, a follow-up WI (~5-LOC bump) slides the bound forward after verifying prebuilds (`better-sqlite3@12.10.0` already adds Node 26 prebuilds per reviewer Dim-3 #4, so the bump can be small). Acceptable cost; explicit pin is the whole point. |
| 3 | Medium | `pretest` smoke step adds friction. Adds ~30 ms to every test run; new failure mode if smoke script crashes for an unrelated reason. | Keep the script under 20 LOC, no I/O beyond `:memory:`, no temp files, no environment dependencies. Exit codes 0 / 1 only. |
| 4 | Medium | Bump to a newer `better-sqlite3` minor may include SQLite engine point-release changes. SQLite is very stable but tail-risk exists (e.g. JSON1 behavior, FTS5 tokenizer). | Impl WI runs the full ocr-persistence test suite as the verification gate; if anything beyond the ABI failure regresses, narrow the bump or pin to the smallest version that fixes ABI. |
| 5 | Low | case-box-persistence Phase A test runner is unaffected (no `better-sqlite3` import yet), so the impl WI's "verify green" must include both packages' suites to catch any unintended coupling from the engines bound. | §4 verification matrix includes both. |
| 6 | Low | AGENTS.md edit is one sentence. Risk only that a docs-only edit lands without the package.json work; mitigated by the impl WI's explicit acceptance criterion that all four touched files land in one commit. | §3.3 acceptance criterion #10 enforces the ≤4-file budget (3 authored + 1 lockfile). |
| 7 | Low | `package-lock.json` deltas may be large after the bump. The lockfile is checked-in; reviewers may need to inspect the delta. | Acceptable. Mechanical lockfile updates from `npm install` are normal in node ecosystems; explicit-staging hygiene per `.claude/rules/staging-hygiene.md` ensures the diff is reviewed before commit. |

No Critical or High risks (Risk 1 downgraded to Medium per revision 2). Future Node-major support remains an intentional follow-up gate via engines + prebuild verification.

---

## §7 Hard-stop triggered

Per `.claude/rules/autonomy.md` hard-stop list AND `.claude/rules/cc-suite.md` §"High-risk WIs", this WI involves:

- **SQLite / better-sqlite3 / native-module work** — TRIGGERED.
- **No new runtime dependency** — NOT triggered (a `better-sqlite3` version bump is within an existing dep range; no new top-level dep is added).
- **Public API / wire-format / schema / CLI break** — NOT triggered (purely build-time / install-time).
- **Auth / cloud / sync / LLM / push / deploy** — NOT triggered.

This plan IS the explicit authorization request for the native-module category. cc-suite review-plan is required (this commit). The follow-up impl WI requires its own explicit user authorization before any package.json or `node_modules/` mutation.

---

## §8 cc-suite review (this plan-WI)

HIGH-RISK per §6 risk #1 + the hard-stop category above. cc-suite review-plan via Path 1 broker. CCSUITE-02 retry policy applies: attempt 1 = full packet; attempt 2 = compact packet (this plan's §"Review packet (compact)" section); attempt 3 = Path 2 direct MCP; attempt 4 = stop and ask.

Recording per `.claude/rules/cc-suite.md` §"Required recording" — to be inherited by the impl WI's commit message.

After cc-suite returns READY (or only Low-risk clarifications), the plan is committed. Implementation is the SEPARATE follow-up WI-ABI-01-impl, opened after explicit user authorization (per §7 hard-stop trigger).

---

## §9 References

- `dev-memo/spark/2026-05-21-abi-remediation-before-sqlite-phase-b-spark.md` (spark spec; superseded by this plan once READY).
- `dev-memo/plan-case-box-persistence-00.md` §7, §10.
- `dev-memo/plan-case-box-persistence-A1.md` §6.6, §8.4.
- `dev-memo/plan-loc-01.md` §"Test baseline".
- `services/ocr-persistence/package.json`.
- `services/case-box-persistence/package.json`.
- `services/ocr-persistence/node_modules/better-sqlite3/package.json` (installed version).
- `docs/release/wi-03-security-signoff.md` §"Known baseline failures".
- `.claude/rules/cc-suite.md` §"High-risk WIs" + §"Required recording" + §"Retry policy".
- `.claude/rules/autonomy.md` hard-stop list.
- `.claude/rules/spark.md` §"Hard stops" (native-module).
- `.claude/rules/client-local-first.md` (locks `better-sqlite3` driver).
- `.claude/rules/loc-guardian.md` (impl WI well under thresholds).

---

## §10 Stop condition

This plan is stale or superseded when:

- **WI-ABI-01-impl commits** under explicit user authorization → plan transitions from `READY` to "superseded by impl commit `<hash>`" recorded inline; the file stays at this path as historical reference.
- **Driver-swap spark** materializes and supersedes the better-sqlite3 commitment → this plan is retired; the spark spec stays as the new starting point.
- **Node 26 LTS lands and prebuilds catch up** → the engines bound bump becomes its own follow-up WI; this plan's lessons inform the next bump's plan but this file is retired.
- **`better-sqlite3` removed from the repo entirely** → unlikely under current local-first posture; this plan retires with the dep.
