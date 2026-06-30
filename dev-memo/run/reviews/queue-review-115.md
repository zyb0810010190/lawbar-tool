# Queue review — WI-EVIDENCE-A10-LIVE-PIPELINE-WIRING-00

Lane: wire the live export path to consume the A10 contract (Type: IMPL; apps-layer adapter + handler wiring + additive DTO + tests; HIGH-RISK Evidence-invariant lane — live export now produces the court-facing canonical model).
Date: 2026-06-30. Branch: `evidence-a10-live-pipeline-wiring` (from synced `main` @ `def660a`). Batch: 1/3 since marker `033e1cb` — no batch closeout this lane.

## What this is
Wires `exportLinkCitationsHandler` (`apps/lawbar-desktop/src/caseBox/linkHandlers.ts`) to CONSUME the merged A10 contract via a NEW narrow adapter `apps/lawbar-desktop/src/caseBox/export/a10LivePipeline.ts`. `buildLiveCanonicalExport(result, exportType?)` is PURE composition — `toA10RenderedCitations(result)` (A10-T1) → `buildCanonicalExportModel({exportType, rendered})` (A10-T6, internally A10-T2) → `canonicalModelSha256(model)` (A10-T6) — adding no citation/href/serialization logic. The handler returns `{ ...result, canonicalExport: buildLiveCanonicalExport(result) }` (ADDITIVE — the services `citations`/`byFlag` fields are preserved verbatim). `ExportLinkCitationsResult` is extended additively (apps-layer IPC DTO only — not a schema/persistence change). The live canonical model reuses the A10-T6 builder, so it is byte-identical to (compatible with) the native A10 golden-export gate by construction. NO new IPC channel, NO renderer/electron change, NO `.docx`/PDF, NO A8/forms/schema/custody/JS-shim; the A10-T1/T2/T6 modules + golden fixture + native gate are untouched.

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
### review-plan
- Kind: review-plan · Path 1 runner 0.2.18, gpt-5.5/high/read-only · Job ID `review-plan-mr0qskbj-o2t5ob` · completed (retrievable YES) · **READY-WITH-LOW** · rawOutput sha256 `5bdb93ef71cca95f941744beef579868229c47e7a8a10a4d5a717cd786d90f98`.
- Confirmed: additive attachment (`{ ...result, canonicalExport }`) is the correct non-breaking shape; the adapter is genuinely consume-not-redefine; reusing `buildCanonicalExportModel` keeps the live path compatible with the native gate (for equivalent input/exportType); the IPC DTO extension is apps-layer (not schema/persistence); no A1/A3/A8/A10 weakening or court-facing href leak.
- **Low (applied in-WI):** the live handler's `canonicalExport` attachment was under-tested (only the adapter was unit-tested). **Fixed**: an additive assertion was added to the Electron export round-trip (`apps/lawbar-desktop/tests/casebox-link-roundtrip.electron.test.mjs`) asserting `exported.value.canonicalExport` (sha 64-hex, canonical row = `{linkId, citationText: 卷X页Y}`, `internalHref` excluded, no href leak) while the pre-existing `citations`/`byFlag` remain. (Runs in the packaged gate `test:link-roundtrip-packaged`, where real export round-trips live; the adapter itself is fully unit-tested in-suite.)

## Verdict: READY-WITH-LOW → Low applied in-WI

QUEUE_REVIEW_VERDICT=PASS

## Post-implementation cc-suite records
### audit
- Kind: audit · Path 1 runner 0.2.18, gpt-5.5/high/read-only (pre-commit working-tree, exact-path scope) · Job ID `audit-mr0qxtws-zxnyn6` · **CLEAN — no Critical/High/Medium/Low findings** · rawOutput sha256 `1b00a13a29d8b3fac548f589157b68d64d5c1ffd0b32f4beb1cd2ad2e435a180`.
- Confirmed: adapter consume-only (no new citation/href/serialization logic); handler additive (`...result` + `canonicalExport`, no tenant/actor leak); DTO apps-layer additive; canonical model excludes `internalHref`/`href` (via A10-T6); tests cover valid flow / missing-target text-only / flagged no-href / no serialization href leak / determinism / total+XOR / direct-A10-T6 equivalence / custom exportType; roundtrip assertion correct; scope clean (no A10-T1/T2/T6 / golden / native / services / contracts / renderer / electron / lockfile diff); package.json only the test line (build.mac.target unchanged).
### verify
- Kind: verify · Path 1 runner 0.2.18, gpt-5.5/medium · consumed the audit report · Job ID `verify-mr0r0bni-bd9dbe` · rawOutput sha256 `5e9543a1fa6694e8f7e153b005a988e1f2217151fd518d9a26b5a7e316f28ce4`.
- Verdict: **ALL CLOSED** — no undocumented Critical/High/Medium open; the review-plan Low is addressed (roundtrip assertion present).

## Local verification
`npm --prefix apps/lawbar-desktop test` → **704/704 pass** (was 696; +8 A10 live-pipeline tests; incl. Electron smoke). Targeted `node --test tests/a10-live-pipeline.unit.test.mjs` → 8/8. A10-T1/T2/T6 regression → 30/30. Native A10 golden-export gate (`a10-golden-export-cli` on the golden) → `pass\tok\t5` exit 0 (compatibility). `check-contract-integrity` PASS (14). The Electron roundtrip assertion parses (`node --check`) and runs in the packaged gate. Only `linkHandlers.ts` + `dto/link.ts` + `package.json` modified + 2 new files (+ the additive roundtrip assertion); the A10-T1/T2/T6 modules, golden fixture, native, services, schema, renderer, electron untouched; `CURRENT_SCHEMA_VERSION` unchanged; `dev-memo/run/evidence/**` untouched; native surfaces untouched (no swiftpm-smoke needed).

## Deferred findings
None. The one review-plan Low was FIXED in-WI (roundtrip assertion); the audit was clean; verify ALL CLOSED.
