# WI-PTA-03b — Scope docket: desktop package integration of the WI-PTA-03 audit vocabulary

**Status:** UNTRACKED pre-implementation scope docket. **NOT authorized for implementation** — requires its own
cc-suite `review-plan` approval first. Do NOT run any packaging command before this scope is reviewed + committed.
**Parent:** `dev-memo/plan-pretrial-trial-addon-01.md` (READY umbrella) + `dev-memo/plan-pretrial-trial-addon-01-pta03.md`
(contract-only WI-PTA-03, landed at `f835673`; §"Scope amendment (2026-07-15)" deferred the desktop portion here).
**Branch:** `feature/pretrial-trial-addon-01`. **Type:** BUILD-INTEGRATION / desktop, HIGH-RISK (touches checked-in
internal tarballs + `package-lock.json` + the `check-internal-tarballs` gate).

## Review packet (compact)

**Summary.** Deliver the desktop-side of the WI-PTA-03 audit vocabulary: refresh the desktop-consumed
`case-box-contract` tarball from committed contract source `f835673`, add the renderer label/catalog mappings +
exhaustive guards for the 18 new event kinds + 4 entity types, and prove the desktop compiles against the resulting
71-kind union. This unavoidably intersects a **pre-existing** stale `case-box-persistence` tarball that the shared
`check-internal-tarballs` gate also enforces; the docket separates that reconciliation (class B) from the WI-PTA-03
integration (class A) and forbids everything else (class C).

**Essential references.** `apps/lawbar-desktop/scripts/pack-internal-packages.mjs` (packaging), `scripts/workflow/check-internal-tarballs.mjs`
(gate), `apps/lawbar-desktop/dist-tarballs/{*.tgz,manifest.json}`, `apps/lawbar-desktop/package.json` (`bootstrap`/`pack:internal`
scripts, `file:dist-tarballs/*.tgz` deps), `apps/lawbar-desktop/package-lock.json`, `renderer/i18n/{labels.ts,catalog.ts}`,
`case-box-contract` `CaseBoxAuditEventKind` (now 71 kinds at `f835673`).

**Review questions.** (1) Given the actual packaging scripts, is class-A's contract refresh achievable via the
repo's deterministic workflow, and is class-B's persistence refresh **actually required** for `check-internal-tarballs`
to pass (vs. avoidable)? (2) Is the diagnosis in §"Pre-existing condition" correct that persistence is payload-drifted
since `3b644a7` and the gate cannot pass without refreshing it? (3) Do the exclusions (class C) + stop rules
adequately prevent scope creep beyond the two tarballs + manifest + lockfile + renderer? (4) Are the acceptance
criteria correct that a persistence byte change is required ONLY because the diagnosis proves it, not by convenience?

---

## Scope class A — WI-PTA-03 integration work

* Refresh the desktop-consumed `case-box-contract` tarball (`apps/lawbar-desktop/dist-tarballs/case-box-contract-0.1.0.tgz`)
  from committed contract source at **`f835673`**.
* Add renderer labels/catalog mappings for all **18** new event kinds and **4** new entity types where applicable
  (`renderer/i18n/labels.ts` `EVENT_KIND_ID` +18 / `AUDIT_ENTITY_TYPE_ID` +4; `renderer/i18n/catalog.ts` +18
  `eventKind.*` + 4 `auditEntityType.*` zh-CN entries).
* Add/keep exhaustive renderer audit-label, catalog, and i18n guards green (`renderer-audit-labels.test.mjs`,
  `renderer-i18n.test.mjs`, and the compile-time exhaustive `Record<CaseBoxAuditEventKind, CatalogId>` check).
* Prove the desktop TypeScript compiles against the **71-kind** union (53 existing + 18 new).
* Update the **contract-related** `manifest.json` entry and `package-lock.json` integrity data — but ONLY as produced
  by the approved installation mechanism (no hand-editing).

## Scope class B — Pre-existing packaging drift (conditional; diagnosis-gated)

* **Diagnose** the exact source-versus-tarball difference for `case-box-persistence` (the `check-internal-tarballs`
  payload-drift set).
* **Identify** the source commit that first made the checked-in persistence tarball stale — preliminary diagnosis:
  **`3b644a7`** (2026-07-04, WI-SEC-CASEBOX-TENANT-SCOPING-DEFENSE-00), the first `case-box-persistence` source
  change after the tarball's `93ab4e5` (2026-07-03) commit; later compounded by `915ffb7`, `2063b0d`, and the
  WI-PTA-02 persistence characterization test.
* **Determine** whether the stale persistence artifact must actually be refreshed for the relevant gate to pass —
  preliminary diagnosis: **YES**, `check-internal-tarballs` currently reports **~22 persistence findings** (≈20
  payload content-drift + 2 missing test files) **plus ~9 `case-box-contract` payload content-drift findings**, so
  the gate cannot go green without refreshing both tarballs. **These counts are non-authoritative snapshots** — the
  implementation MUST re-run the gate and **paste the fresh output** in its report before acting.
* **Refresh it only if required** by the established deterministic packaging workflow or gate (if the re-confirmed
  diagnosis shows it is NOT required, do NOT touch the persistence tarball).
* **Classify** every persistence tarball change as **reconciliation of pre-existing drift**, NOT implementation of
  new persistence behavior (no persistence source is edited here).

## Scope class C — Explicit exclusions

* No persistence **source** changes.
* No schema, feature-model, IPC, storage, migration, or UI-workflow changes.
* No new audit vocabulary (that landed in WI-PTA-03 at `f835673`).
* No unrelated dependency upgrades.
* No hand-editing of tarballs, integrity hashes, manifest entries, or lockfile records.
* No suppression or weakening of `check-internal-tarballs`.

---

## Required specifications

1. **Exact anticipated file paths.** `apps/lawbar-desktop/dist-tarballs/case-box-contract-0.1.0.tgz`;
   `apps/lawbar-desktop/dist-tarballs/case-box-persistence-0.1.0.tgz` (only if diagnosis-required);
   `apps/lawbar-desktop/dist-tarballs/manifest.json`; `apps/lawbar-desktop/package-lock.json`;
   `apps/lawbar-desktop/renderer/i18n/labels.ts`; `apps/lawbar-desktop/renderer/i18n/catalog.ts`; and the renderer
   guard tests — expected exact paths `apps/lawbar-desktop/tests/renderer-audit-labels.test.mjs`,
   `apps/lawbar-desktop/tests/renderer-i18n.test.mjs`, and possibly `apps/lawbar-desktop/tests/renderer-i18n-guard.test.mjs`
   (most guards derive exhaustiveness from the contract, so they may need **no** edit). **No other paths** — any
   additional test file or path is a STOP (spec 6).
2. **Authoritative packaging + installation commands.** The repo's established deterministic workflow —
   `apps/lawbar-desktop` `bootstrap` (`npm --prefix ../../docs/contracts/case-box-contract run build` +
   persistence build + `pack:internal` + `npm install`) or its constituent sanctioned steps. Record the exact
   command(s) actually run. No manual `.tgz`/hash construction.
3. **Before/after SHA-256** for BOTH tarballs — **before** captured in this docket, **after** captured in the
   implementation report. Baselines (as of `f835673`): contract `d4d1a27c…`, persistence `1a43369e…`, manifest
   `0e545260…`.
4. **Tarball-content comparison against source HEAD.** Extract each repacked tarball; confirm the contract tarball
   payload equals contract source `f835673` (71-kind `dist/audit-log.d.ts`, `delete-hard` schema) and the
   persistence tarball payload equals current persistence source HEAD.
5. **Semantic classification of every `package-lock.json` hunk** — each hunk must map to a `case-box-contract` or
   `case-box-persistence` integrity/resolution refresh from the sanctioned workflow. Any other hunk → stop.
6. **Stop rule.** Unexpected files, or unrelated dependency-resolution changes, or a persistence tarball byte change
   without a diagnosed source-content reason, cause an immediate STOP + report before proceeding.
7. **Full verification** (exact commands in §"Verification commands (exact)"): contract tests; internal packaging
   checks (`check-internal-tarballs`); desktop typecheck/build (proving the 71-kind union resolves); targeted
   renderer guards (`renderer-audit-labels`, `renderer-i18n`, `renderer-i18n-guard`); full desktop suite; the
   release gate `scripts/workflow/check-gates.sh` (which runs the internal-tarball drift guard).
8. **Acceptance criteria.** WI-PTA-03b is accepted when class-A integration lands, the renderer compiles against the
   71-kind union, and all gates in spec 7 pass — **without requiring byte changes to the persistence tarball UNLESS
   the (re-confirmed) diagnosis proves them necessary for `check-internal-tarballs`.** Per the current diagnosis
   (20 payload-drift findings) the persistence refresh IS required; if a fresh diagnosis at implementation time
   shows otherwise, persistence is left untouched.

## Pre-existing condition (evidence)

- Persistence tarball last committed `93ab4e5` (2026-07-03); manifest `packedAt` `2026-07-03T05:56Z`.
- First stale-making persistence source commit: `3b644a7` (2026-07-04); compounded by `915ffb7` (2026-07-09),
  `2063b0d` (2026-07-09), and the WI-PTA-02 persistence characterization test.
- `check-internal-tarballs` at HEAD (non-authoritative snapshot — impl report MUST paste fresh output): **~22
  `case-box-persistence` findings** (≈20 payload content-drift + 2 missing test files) **plus ~9 `case-box-contract`
  payload content-drift findings** (the committed contract tarball is stale versus source `f835673`, since WI-PTA-03
  committed the contract *source* but not the desktop tarball). **The `package-lock.json` integrity currently MATCHES
  the committed (stale) tarballs** — it is not a lock-vs-tarball mismatch at HEAD; the lock must be refreshed *after*
  the repack so it matches the new tarball bytes. Red for ~11 days for the persistence portion, independent of
  WI-PTA-03.

## Change-cause classification (maintained in the WI-PTA-03b report)

- **Class A (WI-PTA-03 integration):** contract tarball payload delta (71-kind types + `delete-hard` schema + metas);
  contract `manifest.json` `integrity`/`sizeBytes`; contract `package-lock.json` integrity; renderer labels/catalog +
  guard updates.
- **Class B (pre-existing drift reconciliation):** persistence tarball payload delta (source `3b644a7`+); persistence
  `manifest.json` + `package-lock.json` integrity. NOT new persistence behavior.
- **Class C (unrelated → OUT):** anything else; revert if the workflow touches it.

## Stop rules (restate)
Any of these → STOP + report, do not proceed: an unexpected modified/untracked file; a `package-lock.json` hunk not
attributable to a contract/persistence integrity refresh; a persistence tarball byte change without a diagnosed
source reason; a manifest change beyond `integrity`/`sizeBytes`/`packedAt`; any need to weaken `check-internal-tarballs`.

## Verification commands (exact)
- `npm --prefix docs/contracts/case-box-contract test`
- `npm --prefix apps/lawbar-desktop run check:internal-tarballs` (internal packaging drift gate)
- `npm --prefix apps/lawbar-desktop run build` (desktop typecheck/build; proves the 71-kind union resolves)
- targeted renderer guards: `node --test apps/lawbar-desktop/tests/renderer-audit-labels.test.mjs apps/lawbar-desktop/tests/renderer-i18n.test.mjs apps/lawbar-desktop/tests/renderer-i18n-guard.test.mjs` (run against built `dist`)
- full desktop suite: `npm --prefix apps/lawbar-desktop test`
- release gate: `bash scripts/workflow/check-gates.sh` — the aggregate gate that runs the internal-tarball drift
  guard (`check-internal-tarballs.mjs`, "DESKTOP-DEPS-00", `scripts/workflow/check-gates.sh:21-22`).

## Open question for review-plan
Whether reconciling the pre-existing persistence-tarball drift belongs INSIDE this WI (because the shared gate forces
it) or should be a separate persistence-hygiene WI that lands first — and, if the sanctioned `pack:internal` repacks
both packages by design, whether that is the intended mechanism for class B or whether a narrower persistence-only
refresh path exists.

## Review record (cc-suite review-plan)

- Job `review-plan-mrlo88gd-bhin4t` (Path 1, gpt-5.5/high/read-only) — **verdict: Approve after docket amendment**
  (scope split sound; corrections required before implementation). Findings + dispositions:
  - **High** — persistence drift count wrong (said 20; reviewer's read-only compare found 22 = 20 content + 2
    missing tests) → **fixed**: counts corrected to ~22 persistence + ~9 contract, marked **non-authoritative**, with
    an explicit requirement that the impl report paste fresh gate output.
  - **High** — the "contract `package-lock.json` integrity mismatch" claim was false at HEAD (the lock matches the
    committed *stale* tarball; the real issue is contract-tarball payload drift vs source `f835673`) → **fixed**:
    reworded — contract tarball is stale vs source; lock matches the stale tarball and is refreshed *after* repack.
  - **Medium** — loose "any renderer guard test files" → **fixed**: listed exact paths (`renderer-audit-labels`,
    `renderer-i18n`, possibly `renderer-i18n-guard`) + a STOP for any additional file.
  - **Medium** — verification "commands" were labels → **fixed**: exact `node --test …` invocations + the release
    gate identified as `scripts/workflow/check-gates.sh` (runs `check-internal-tarballs`).
  - **Low** — before/after SHA-256 only "before" present pre-implementation → **fixed**: added "before in docket,
    after in implementation report."
  - **Confirmed architecture (reviewer):** `pack-internal-packages.mjs` always packs BOTH packages (no narrower
    selector); `check-internal-tarballs.mjs` validates both against source; class B is required for the shared gate,
    not convenience churn; the `93ab4e5`/`3b644a7` diagnosis + the 71-kind contract source are directionally correct.
- This docket remains a **pre-implementation plan**; nothing (tarballs, renderer mappings, packaging drift) has been
  corrected yet.
