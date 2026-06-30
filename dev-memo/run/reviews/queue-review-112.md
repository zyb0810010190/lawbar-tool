# Queue review — WI-EVIDENCE-A10-T2-HYPERLINK-DEGRADATION-00

Lane: implement the A10-T2 hyperlink-degradation slice over the A10-T1 contract (Type: IMPL; apps-layer module + tests; HIGH-RISK Evidence-invariant lane).
Date: 2026-06-30. Branch: `evidence-a10-t2-hyperlink-degradation` (from synced `main` @ `cad012c`). Batch: 1/3 since marker `13f10eb` — no batch closeout this lane.

## What A10-T2 is
A standalone apps-layer mapper `toA10HyperlinkCitation(A10RenderedCitation) -> A10HyperlinkCitation` OVER the merged A10-T1 contract. Citation rendering must not fail hard merely because a hyperlink target is missing/unavailable/malformed/intentionally-unavailable. Court-fileable AUTHORITY stays the textual 卷X页Y `text` (verbatim, single-source from A10-T1) OR the explicit degradation `flag`. `internalHref` is APP-INTERNAL, NON-AUTHORITATIVE in-app navigation metadata only — minted strictly from the citation's own `documentId`+`physicalPageIndex` (`lawbar://citation/<encodeURIComponent(doc)>/<idx>`), validated by `isSafeCitationHref`, else `null` (text-only). Never an empty/fake/unsafe/external href; never drops a citation; total+bijective; deterministic. Does NOT edit `a10CitationContract.ts`, services, native, schemas, contracts, renderer/electron, link handlers, the live export IPC pipeline, or invent CanonicalExportModel.

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
### review-plan
- Kind: review-plan · Path 1 runner 0.2.18, gpt-5.5/high/read-only.
- Attempt 1: Job ID `review-plan-mr09ymaa` · **NEEDS-FIX** — (#1) the href must be modeled as NON-authoritative `internalHref`, never the court-fileable authority (which is text-or-flag); (#2) validation must be strict, not prefix-alone. **Both fixed in queue.md** and reflected in the module design before implementation.
- Attempt 2: Job ID `review-plan-mr0a2r38-lzha98` · completed (retrievable YES) · **READY** · rawOutput sha256 `2aff538cf955913cd17373f4f7d8fe29a64536fcd1163028685eb078bc521f1d`. Confirmed both prior blockers resolved; standalone apps-layer slice over A10-T1 without editing services/contract; strict mint+validation acceptable.

## Verdict: READY (both review-plan blockers resolved pre-implementation)

QUEUE_REVIEW_VERDICT=PASS

## Post-implementation cc-suite records
### audit (Path 1 runner 0.2.18, read-only; pre-commit working-tree, exact-path scope)
- Attempt 1 — Job ID `audit-mr0aciwf-32ldzh` · gpt-5.5/high · **High + Medium** (real defects, both FIXED in-WI):
  - High: double-encoded traversal (`%252e%252e` / `%252f` / `%255c`) bypassed the single-encoded `%2e|%2f|%5c` check + single-decode canonical round-trip. FIX: added `fullyPercentDecode()` (iterative decode) + `isUnsafeDecodedSegment()` applied to both the single-decode and fully-decoded forms.
  - Medium: control reject covered only C0+DEL; C1 (e.g. U+0085 as `%C2%85`) slipped through after decode. FIX (initial): broadened `UNSAFE_CHARS` to C0/DEL/C1 + separators + bidi + BOM.
- Attempt 2 — Job ID `audit-mr0algfj-qt3q68` · gpt-5.5/high · **High (residual)** FIXED in-WI: `fullyPercentDecode` 8-pass bound returned the still-encoded value as safe, so an over-deeply-nested traversal could pass. FIX: fail-closed — return `null` if any `%XX` survives the bound (or on malformed). Confirmed the prior C1/separator/bidi/BOM fix closed.
- Attempt 3 — Job ID `audit-mr0ar5an-4f9y77` · gpt-5.5/high · **Medium** FIXED in-WI: `UNSAFE_CHARS` missed bidi isolates (U+2066-U+2069) + some zero-width/word-joiner while the comment claimed coverage. FIX: comprehensive set `[U+0000-U+001F, U+007F-U+009F, U+061C, U+200B-U+200F, U+2028, U+2029, U+202A-U+202E, U+2060-U+206F, U+FEFF, U+FFF9-U+FFFB]` on raw + both decoded forms; comment aligned to code. Over-depth High confirmed closed.
- Attempt 4 — Job ID `audit-mr0ax8cz-m6o4y8` · gpt-5.5/high · **TIMEOUT** (`spawnSync codex ETIMEDOUT`, classified TIMEOUT). Re-run on Path 1 with a clean compact prompt.
- Attempt 5 — Job ID `audit-mr0c1bqt-w8b5c8` · gpt-5.5/**medium** · **CLEAN — no code findings** · rawOutput sha256 `ded51c7c0d28ac696e8e2a310cfcd5e2f1103eba320b7e29a27d2f13c3d846ec`. Confirmed: double-encode/over-depth/bidi-zero-width-control all rejected; CJK id + literal-percent `a%b` mint+validate; authority text-or-flag, internalHref non-null only on clean text citations with safe href; `flag null + citation null` throws; package.json only the one-line test script (build.mac.target unchanged); forbidden product areas unchanged; targeted test 12/12. The lone "Medium" was the EXPECTED pre-commit governance ordering (queue.md/queue.linted bookkeeping IN scope; pre-existing untracked residue not staged) — PROMPT_CONTEXT_ERROR class, not a defect.
### verify
- Kind: verify · Path 1 runner 0.2.18, gpt-5.5/medium · consumed the audit-5 report · Job ID `verify-mr0c59ib-y3kv5t` · rawOutput sha256 `f9ae028ac5c290032b2ccefb1c38605cb07173bebf04045acb91d38bf4b4c412`.
- Verdict: **ALL CLOSED** — governance-ordering Medium is expected/out-of-scope. No undocumented Critical/High/Medium open.

## Local verification
`npm --prefix apps/lawbar-desktop test` → **686/686 pass** (was 674; +12 A10-T2 hyperlink tests; incl. Electron smoke). Targeted `node --test tests/a10-hyperlink-degradation.unit.test.mjs` → 12/12. `check-contract-integrity` PASS (14 docs); `CURRENT_SCHEMA_VERSION` unchanged. package.json diff = exactly the one-line test registration (no reformat; build.mac.target intact). No services/native/renderer/electron/schema/contract change; no custody/marker/key; `dev-memo/run/evidence/**` untouched.

## Deferred findings
None. All audit findings (1 High double-encode, 1 High over-depth, 2 Medium control/bidi) were FIXED in-WI and verified closed.
