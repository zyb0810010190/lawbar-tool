# Spark — ABI remediation before case-box-persistence Phase B (SQLite)

**Status**: spark spec (non-authoritative). Not implementation-authorizing.
**Date**: 2026-05-21.
**Author**: Claude Code (spark skill).

## 1. Problem statement

Case-box-persistence Phase A landed in nine bounded WIs (A1–A9) using only an in-memory implementation. The plan-corpus design (`dev-memo/plan-case-box-persistence-00.md` §7) deliberately gated SQLite (Phase B) behind a separate "ABI remediation WI" because `services/ocr-persistence`'s installed `better-sqlite3` was compiled for `NODE_MODULE_VERSION 127` (Node 22) and current developer hosts run Node 24 (`NODE_MODULE_VERSION 137`). With A9 now complete, Phase B is the next natural step — but it cannot start until the ABI baseline is repaired, otherwise the new SQLite conformance suite launches in a known-broken state and inherits OCR persistence's `ERR_DLOPEN_FAILED` failure. This spark scopes the bounded WI that unblocks Phase B without expanding into driver swaps or packaging changes.

## 2. Existing context used

- `AGENTS.md` §"Repo Brief" — Node ≥22, "Node 20 is insufficient for the contract package"; the test commands list includes `npm --prefix services/ocr-persistence test`.
- `AGENTS.md` §"CC-Suite Autonomous Execution Policy" — "New runtime dependencies" is a stop-and-ask gate.
- `dev-memo/plan-case-box-persistence-00.md` §7 (Native module / ABI baseline), §7.1 three options, §7.2 recommendation (Option B — in-memory first), §7.4 "ABI remediation WI shape (sketch only; not authorized here)", §8.4 (Phase B gated until ABI resolved), §10 phase table where row "GATE — ABI remediation WI (separate authorization)" sits between Phase A and B1+.
- `dev-memo/plan-case-box-persistence-A9.md` — A9 (replay-safe Once variants) landed in commit `1af6ca7`; Phase A is now closed.
- `services/ocr-persistence/package.json` — `"better-sqlite3": "^12.9.0"`, `"@types/better-sqlite3": "^7.6.13"`, no `engines` field, devDeps pin `@types/node: ^22.0.0`. Test script enumerates 8 SQLite test files (`sqliteQueue.schema`, `sqliteQueue.lineage`, `sqliteQueue.conformance`, `sqliteQueue.contention`, `sqliteAtomicEnqueue.step10k`, `sqlite.conformance`, `sqlite.hardening`, plus `sqliteQueue` siblings).
- `services/case-box-persistence/package.json` — engines `node >=22.0.0`; description explicitly states "Phase A1: in-memory only; SQLite gated on ABI remediation. No native dependency."
- `docs/contracts/package.json` — engines `node >=22.0.0`, types `@types/node ^22`.
- Live probe `node -v` → `v24.14.0`; `npm --prefix services/ocr-persistence test` → reproduces `ERR_DLOPEN_FAILED` exactly as plan-00 §7 described, with the stack pointing at `services/ocr-persistence/node_modules/better-sqlite3/build/Release/better_sqlite3.node`.
- `.claude/rules/autonomy.md` — hard-stop list: "New runtime dependencies", "Public API, wire-format, schema, CLI breaking changes". SQLite / better-sqlite3 / native-module work is explicitly called out by the spark rule (`.claude/rules/spark.md` §"Hard stops").
- `.claude/rules/cc-suite.md` §"High-risk WIs" — "Framework / runtime dependencies — Electron / Tauri / SQLite / native modules / new top-level deps" is high-risk; cc-suite review-plan with a `## Review packet (compact)` section is mandatory.
- `.claude/rules/client-local-first.md` — local-first Mac desktop posture; driver swap to a cloud/wasm path is incompatible with the locked direction, so the recommendation must keep `better-sqlite3` as the SQLite driver.
- `.claude/rules/loc-guardian.md` — pure-LOC fail threshold 800; this WI is well under that.
- `git log --oneline -30` — last 30 commits show Phases A1–A9, no prior ABI WI, no engines bumps.

## 3. Assumptions

- **Inferred from repo state**: ocr-persistence's SQLite test files genuinely fail today on Node 24 hosts (verified by running `npm --prefix services/ocr-persistence test` — stack matches plan-00 §7 verbatim). The WI's primary success criterion is making that suite green again.
- **Inferred from repo state**: `better-sqlite3` v12.x publishes prebuilt binaries via its release pipeline for the LTS Node line. Verification is part of WI execution, not part of this spark. If it does not, the WI fallback is a postinstall `npm rebuild better-sqlite3` requiring a working C++ toolchain — recorded as a Medium risk.
- **Inferred from repo state**: no CI workflow is present in the repo (no `.github/workflows/`); the ABI smoke check therefore lives as a `pretest` script, not a CI step. If/when CI lands, the same smoke command lifts up.
- **Safest local-first assumption** (`.claude/rules/client-local-first.md`): `better-sqlite3` stays as the driver. Driver swap to `sql.js` / `node:sqlite` / a wasm path is OUT of scope. v1 client is local-first Mac desktop; the existing OCR persistence SQLite implementation already commits to the synchronous-`better-sqlite3` pattern at multiple files, and Phase B will mirror it.
- **Safest local-first assumption**: engines pin gets an explicit upper bound (`>=22.0.0 <26.0.0`) so the next Node major bump surfaces as a contracted ABI gate rather than a silent `ERR_DLOPEN_FAILED` in random test files. Caller can loosen later if prebuilds keep up.
- **Inferred from repo state**: Phase B of case-box-persistence is not yet planned in a `plan-case-box-persistence-B*.md` file. This spark addresses ONLY the gate WI, not Phase B itself.

No load-bearing assumption is unresolved; §6 issues one recommendation without an open question to the user.

## 4. Non-goals

Excluded from the ABI remediation WI (each of these is a separate decision):

- **case-box-persistence Phase B implementation.** The ABI WI unblocks Phase B; it does not BEGIN Phase B. Phase B writes its own plan with its own cc-suite review-plan cycle.
- **Driver swap.** `better-sqlite3` stays. No `sql.js`, no `node:sqlite` (Node 22.5+ experimental), no Postgres, no SQLite wasm. Driver swap is a separate `/spark` if anyone wants to revisit it.
- **New runtime dependency.** No new top-level dep introduced beyond what's already in `package.json`. A version bump of `better-sqlite3` is allowed; a sibling package (e.g. `node-pre-gyp`) is NOT.
- **Electron / Tauri packaging.** Out of scope. The native module rebuild question for packaging is downstream of the Mac-app WI (per `client-local-first.md`).
- **CI infrastructure.** No `.github/workflows/` introduction in this WI. A local `pretest` smoke script is the deliverable; a CI step is a follow-up WI.
- **Migration of existing SQLite data.** None exists on disk yet for case-box-persistence (Phase A is in-memory); OCR persistence does not ship a populated DB. No migration risk to design around.
- **Node version pinning beyond engines field.** No `.nvmrc`, no Volta config, no Docker image. The repo doesn't have those today; this WI doesn't introduce them.
- **AGENTS.md restructure.** Only the supported-Node sentence and the `engines` note are updated.

## 5. Options considered

- **O1 — In-place rebuild only.** `npm rebuild better-sqlite3` in `services/ocr-persistence`; add `pretest` smoke; document Node range. *Considered* because it's the smallest possible change. *Dropped as sole approach* — `npm rebuild` requires a C++ toolchain on every developer machine and `npm install` does not re-run it on fresh clones. Without a version bump, the failure recurs the next time `node_modules/` is rebuilt against a newer Node major.
- **O2 — Version bump + engines pin + smoke script.** Bump `better-sqlite3` to the latest 12.x release that publishes Node 24 prebuilds (verify via npm registry metadata at WI execution time), add `engines.node: ">=22.0.0 <26.0.0"` to `services/ocr-persistence/package.json` and to `services/case-box-persistence/package.json` (the latter for Phase B's eventual `better-sqlite3` dep), add a `pretest` `scripts/abi-smoke.mjs` (`new (require("better-sqlite3"))(":memory:")` + close), update AGENTS.md Repo Brief with the supported Node range. *Considered* as the standard fix for native-module ABI drift in Node ecosystems. *Kept* as the recommendation — addresses the root cause (binary compiled for wrong Node), surfaces future ABI gaps explicitly via the engines pin, and produces a fast-failing smoke step that beats opaque `ERR_DLOPEN_FAILED` in one test file out of dozens (per plan-00 §7.4 bullet 4).
- **O3 — Hybrid: O2 plus a `postinstall` script that runs `npm rebuild better-sqlite3` automatically.** *Considered* as a belt-and-braces variant. *Dropped* — adds install-time complexity, surprises CI/sandbox environments where `npm install --ignore-scripts` is common, and is unnecessary if the version bump in O2 ships prebuilds for the engines range. Add this only if the WI discovers prebuilds do NOT cover the supported range.

Alternatives O1 and O3 do not materially change the WI's behavior versus O2; O2 is the single recommended path.

## 6. Recommended direction

**O2 — Version bump + engines pin + smoke script + AGENTS.md note.** One bounded WI, ~3 files touched, no code under `src/`, no new top-level dep.

Files that would change:

- `services/ocr-persistence/package.json` — bump `better-sqlite3` and `@types/better-sqlite3` to the latest 12.x line whose prebuilds explicitly cover Node 22 and Node 24; add `engines.node: ">=22.0.0 <26.0.0"`; add `"pretest": "node scripts/abi-smoke.mjs"`.
- `services/ocr-persistence/scripts/abi-smoke.mjs` (new, ~10–15 LOC) — opens an in-memory `better-sqlite3` Database, runs `SELECT 1`, closes, exits 0; non-zero exit + clear error message on any throw.
- `services/case-box-persistence/package.json` — add the same `engines.node` upper bound so the case-box package agrees with the OCR package on the supported Node range (the SQLite dep itself is added in Phase B's WI, not here).
- `AGENTS.md` Repo Brief — replace the single Node-range sentence with explicit `Node 22.x or 24.x (LTS line); upper bound enforced via engines until prebuilds cover newer majors. ABI smoke runs as pretest in ocr-persistence.` No other AGENTS.md edits.

Scope boundary: this WI does NOT modify `services/ocr-persistence/src/sqlite/**`, does NOT add a new dependency, does NOT touch any case-box-persistence `src/`. Verification is `npm --prefix services/ocr-persistence test` going fully green on Node 24, and (manual or documented) re-verification on Node 22 if a Node 22 host is available.

## 7. Risks

- **High — Prebuilds may not cover the full engines range.** `better-sqlite3`'s npm tarball publishes prebuilt binaries for a specific Node-LTS matrix at release time; a Node major already released (e.g. Node 24) may not have a prebuild if the better-sqlite3 release predates it. *Mitigation*: WI execution starts with `npm view better-sqlite3 dist.npm-versions` or equivalent registry inspection; if no prebuild for Node 24 exists, fall back to O3 (postinstall rebuild) and record the requirement that developers have Xcode CLT installed. Likelihood: medium. Impact: forces an additional script + a documented prereq.
- **Medium — Engines upper bound (`<26.0.0`) ages.** The pin catches the next ABI gap as a clean failure, but a developer running Node 26+ before the WI is updated cannot install. *Mitigation*: when Node 26 ships, a follow-up WI (~5-LOC bump) slides the bound forward after verifying prebuilds. Acceptable cost; explicit pin is the whole point.
- **Medium — `pretest` smoke step adds friction.** Adds ~30 ms to every test run and surfaces a new failure mode (smoke script crashes for an unrelated reason). *Mitigation*: keep the script under 20 LOC, no I/O beyond `:memory:`, no temp files, no environment dependencies. Exit codes 0 / 1 only.
- **Medium — Bump to a newer `better-sqlite3` minor may include SQLite engine point-release changes.** SQLite is very stable but tail-risk exists (e.g. JSON1 behavior, FTS5 tokenizer). *Mitigation*: run the full ocr-persistence test suite as the verification gate; if anything beyond the ABI failure regresses, narrow the bump or pin to the smallest version that fixes ABI.
- **Low — case-box-persistence Phase A test runner is unaffected** (no `better-sqlite3` import yet), so the WI's "verify green" must include both packages' suites (`npm --prefix services/case-box-persistence test` AND `npm --prefix services/ocr-persistence test`) to catch any unintended coupling from the engines bound.
- **Low — AGENTS.md edit is one sentence.** Risk only that a docs-only edit lands without the package.json work; mitigated by the WI's explicit acceptance criterion that all four touched files land in one commit.

## 8. Hard stops

- **SQLite / better-sqlite3 / native-module work** — TRIGGERED. Per `.claude/rules/autonomy.md` and `.claude/rules/spark.md` §"Hard stops", any native-module WI requires explicit user authorization before implementation. This spark surfaces the WI but does NOT authorize it; the user must opt in.

Not triggered: production deployment, secrets, destructive ops, real auth provider choice, cloud/sync, public-API break, LLM execution, Electron/Tauri packaging, push/branch-delete, schema breaking change (the OCR persistence SQLite schema and the case-box wire contract are untouched).

## 9. Required downstream artifact

Promote to `dev-memo/plan-abi-remediation-01.md` (single bounded WI plan). Because this is HIGH-RISK per `.claude/rules/cc-suite.md` §"High-risk WIs" (native module / framework / runtime dependencies), the WI plan MUST include a `## Review packet (compact)` block. Triggers the full cc-suite review-plan path (Path 1 runner; retry per CCSUITE-02 if `ETIMEDOUT`).

## 10. Required cc-suite review

**HARD STOP triggered.** This idea is NOT authorized for implementation. User must explicitly authorize each hard-stop item before any cc-suite review-plan is invoked.

This idea is not authorized for implementation until:
1. It is promoted into a tracked WI plan / ADR / dev-memo.
2. The plan includes a `## Review packet (compact)` section if high-risk.
3. cc-suite review-plan returns READY or only Low-risk clarifications remain.
4. Any Critical/High findings are fixed and re-reviewed.
5. Any hard-stop items are explicitly authorized by the user.

## 11. Next bounded WI suggestion

**WI-ABI-01 — ABI remediation for `better-sqlite3` across ocr-persistence (+ case-box-persistence engines pin).**

Scope (compact):

- Files: `services/ocr-persistence/package.json`, `services/ocr-persistence/scripts/abi-smoke.mjs` (new), `services/case-box-persistence/package.json`, `AGENTS.md`.
- LOC budget: < 60 net (well under `loc-guardian` fail threshold).
- Acceptance criteria:
  1. `npm --prefix services/ocr-persistence test` exits 0 on Node 24 (and on Node 22 if a host is available; otherwise documented as the supported range).
  2. `npm --prefix services/case-box-persistence test` still exits 0 (Phase A unaffected).
  3. `pretest` ABI smoke step prints a clear OK line and exits 0.
  4. `engines.node` pin present on both packages.
  5. AGENTS.md Repo Brief sentence updated to the new supported-Node range.
- Out of scope: anything in §4 above, especially Phase B itself.

## 12. Stop condition

- "Promoted to `dev-memo/plan-abi-remediation-01.md`; spec retired." (Normal case.)
- "Superseded by a driver-swap spark spec." (Only if v1 client posture changes.)
- "Stale after Node 26 LTS arrives and prebuilds catch up — engines bound bump becomes its own follow-up WI."
- "Obsolete if `better-sqlite3` is removed from the repo entirely." (Unlikely under current local-first posture.)
