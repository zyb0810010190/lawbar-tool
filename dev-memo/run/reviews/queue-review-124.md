# Queue review — WI-FORMS-T3-S2-CATALOG-PREVIEW-00

Lane: Forms T3 slice S2 **design-artifact + governed-WI authoring** (Type: UI). Governance-authoring only — this lane implements NO code; it produces the design artifact + the governed queue WI so a FUTURE lane can implement the T3 catalog review/preview safely.
Date: 2026-07-04. Branch: `forms-t3-s2-preview-design-governance` (from synced `main` @ `b998572`). Batch: 2/3 since marker `dbcde38` — no batch closeout this lane.

## What this is
The S2 review/preview surface for the merged S1 T3 logical model. Design artifact: `dev-memo/design/2026-07-04-t3-catalog-review-preview.md` (satisfies the UI-GATES.md Type:UI design-artifact gate). The governed WI (`WI-FORMS-T3-S2-CATALOG-PREVIEW-00`) authorizes a FUTURE implementation of an in-app READ-ONLY 证据目录及说明 preview: ONE new read-only IPC channel `casebox:t3:previewCatalog` (main drains all `accepted` evidence pages via `listEvidenceItems`, calls the merged `buildT3CatalogModel`, returns a discriminated success value `{kind:"model",…}|{kind:"refusal",code}` under the strict `IpcEnvelope`) + a new renderer sibling `viewMatterT3Catalog.ts` read-only table. No DOCX/PDF, no export-renderer decision (S3), no evidence write path, no `卷X页Y` column, no contract/schema/persistence change, no T4/T5, no new dependency, no re-implementation of the S1 model.

Architecture note (confirmed by review as the correct minimal choice): there is no `casebox:evidence:*` IPC channel today and `t3CatalogModel.ts` is a main-process `node:crypto` module the renderer cannot import — so one new read-only preview channel is the sound minimal surface (avoiding it would force reimplementing S1 in the renderer or a broader evidence channel, both worse).

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
All Path 1 runner foreground, resolved runner path `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`, retrievable YES (all envelopes `status:"completed"`), no failure class, no fallback. Governance-authoring lane → review-plan only (audit/verify are post-implementation and belong to the future S2 impl WI, not this doc lane).

### review-plan (gpt-5.5/high/read-only; on the design artifact + the S2 WI)
- Attempt 1: `review-plan-mr5z8yvs-u6vf91` · **NEEDS-FIX** (2 High, 2 Medium; architecture confirmed sound as a Low) · sha256 `f6795d5ca2ad4437fd2c586e3ad489c02548886bf20e53424790b4e586763faf`.
  - **H1** DTO allowed/forbidden contradiction (allowed `src/caseBox/` but forbade `dto/` while carving out the request DTO) → FIXED: Allowed files now list the NEW `src/caseBox/dto/t3.ts` + the single `dto.ts` barrel export line; Forbidden files enumerate the existing per-entity DTO modules as unchanged (matches the per-entity barrel convention).
  - **H2** evidence pagination underspecified (silent truncation past the 50-row default page) → FIXED: design + WI now mandate draining all `status:"accepted"` pages until `next_cursor === null` before building once; acceptance adds a >50-accepted-rows test.
  - **M1** IPC result shape ambiguous / used `null` → FIXED: result is the existing strict `IpcEnvelope`; refusal is a SUCCESS value discriminated union `{kind:"model",model,modelSha256?}|{kind:"refusal",code}` (never `null`); read errors stay `{ok:false,error}`.
  - **M2** refusal/validation tests incomplete → FIXED: acceptance now covers all FOUR S1 refusal codes + unknown-DTO-field + malformed-`submitterSelection` → `invalid_payload`.
- Attempt 2 (re-review after fixes): `review-plan-mr5zf9xz-q3wh51` · **READY** (no residual findings; all four fixes confirmed correct and complete; one non-blocking impl note — keep the renderer T3 type structural in `renderer/types.ts`, no runtime import of the main module, already specified) · sha256 `bae328efd539e7b05b26f88690ebccc3cab84e4ef7c0a91b90e2492d69123baf`.

## Verdict: READY (governance-authoring lane; design artifact + WI governable)

QUEUE_REVIEW_VERDICT=PASS

## Gates (this authoring lane)
- `scripts/workflow/check-queue.sh` → PASS (Type:UI design-artifact gate satisfied — concrete `Design artifact:` reference).
- `scripts/workflow/check-contract-integrity.sh` → PASS.
- `CURRENT_SCHEMA_VERSION` unchanged (12); no app/native/schema/contract/persistence/test/package code touched — this lane commits ONLY the design artifact + queue governance + this review artifact.

## Deferred findings
None. Both review-plan Highs and both Mediums fixed in the design artifact + WI before governance; re-review READY. The FUTURE S2 implementation WI still owes its own audit + verify (recorded then). S3 (DOCX, renderer-decision-gated) and T4/T5 (design-gated) remain separate.
