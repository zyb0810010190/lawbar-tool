# Queue review — WI-FORMS-T4-S0-SPEC-FOUNDATION-00

Lane: Forms T4 (举证质证表) **design/spec note + governed-WI authoring** (Type: PLAN, future design/decision-foundation ADR). Governance-authoring only — this lane produces the T4 spec note + the governed queue WI so a FUTURE design lane can produce the T4 proof-model + scope-reconciliation decision ADR. It implements nothing, changes no schema, and makes NO product-scope decision.
Date: 2026-07-04. Branch: `forms-t4-spec-governance` (from synced `main` @ `755160e`). Batch: 2/3 since marker `b6597ce` — no batch closeout this lane.

## What this is
T4 (举证质证表 / proof matrix) is deeply gated: the `READY` project brief (`docs/product/project-requirements-brief.md` §12/§14) lists the **proof matrix among post-v1 export candidates, "each a separate STOP-AND-ASK ADR"** (authoritative product direction), while the forms-spec §F Q6 treated the forms as an M0 promise — a `RECONCILIATION-NEEDED`; and the forms-spec §C states the T4 proof model (争议焦点/证明对象/evidence-linkage/对方质证-三性/proof-gap) does NOT exist as data or as a decided rule. Spec note: `dev-memo/forms-t4-spec-00.md` (target, source-data gaps, candidate structure decision-pending, hard blockers B1 post-v1-STOP-AND-ASK / B2 proof-model / B3 schema, first-slice verdict). Governed WI `WI-FORMS-T4-S0-SPEC-FOUNDATION-00` (Type: PLAN): the FUTURE design lane produces ONE T4 decision-foundation ADR that SURFACES B1 (without deciding it), FRAMES B2 options (without designing final fields), and CONDITIONALLY specifies B3 (a gated later schema ADR) — design-only, no implementation, no schema, no product-scope decision by the agent.

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
All Path 1 runner foreground, resolved runner path `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`, retrievable YES (all envelopes `status:"completed"`), no failure class, no fallback. Governance-authoring lane → review-plan only (audit/verify are post-implementation and belong to the future ADR/impl lanes).

### review-plan (gpt-5.5/high/read-only; on the T4 spec note + the T4 WI)
- Attempt 1: `review-plan-mr66qm2o-e0hmeq` · **NEEDS-FIX** (1 High, 1 Medium, 1 Low; confirmed the design-foundation ADR IS governable — not blocked-pending-user — and the post-v1 STOP-AND-ASK surfacing is correct) · sha256 `92c3dae8f58b9249516efd1e80f4a7a7b7fe621ed471d7a7ae32ab69f448c56e`.
  - **H1** the WI `Allowed files` mixed the authoring-lane files (spec/queue/review-126) with the future ADR-lane file → FIXED: Allowed files are now ONLY the future T4 ADR + its own review artifact; the spec note + this queue governance + queue-review-126.md are committed by the SEPARATE authoring lane and NOT re-staged in the future ADR lane (S3 two-lane precedent).
  - **M1** spec §1 "court-work-product" ambiguous vs DR-00 internal-trial-review baseline → FIXED: §1 now states T4 is an internal lawyer trial-review work product (not a court-filing artifact), court-facing/export scope deferred to the B1 decision.
  - **L1** "DECISION ADR" label overloaded → FIXED: spec §5 now states the ADR's ONLY decision is the status "T4 remains blocked pending the user's resolution of B1/B2", options recorded not selected (a decision-foundation / STOP-AND-ASK packet).
- Attempt 2 (re-review after fixes): `review-plan-mr66us33-9ulvks` · **NEEDS-FIX** — all substantive points confirmed correct; ONE residual: the `Acceptance criteria` line still mixed lanes ("new ADR + spec note + queue governance + review artifact" in the same WI) · sha256 `b6cbb9bcfada9783fdbb2b56abca4d36b2e8894b5fb32c9c043f05cc72c99543`. → FIXED: the Acceptance criteria now states the future ADR lane's committed diff is ONLY the new T4 ADR + its own future review artifact, EXCLUDING the spec note / queue governance / queue-review-126.md.
- Attempt 3 (confirmatory): `review-plan-mr66wyfb-ql3xyv` · **READY** — the Acceptance criteria, Allowed files, and Commit boundary are now mutually consistent on the two-lane boundary; substantive points not reopened · sha256 `e7181dca58621179fb8469ba917a690ec311be645a0f6cea4529f4e1003a007d`.

## Verdict: READY (design-foundation WI governable; post-v1 STOP-AND-ASK correctly surfaced, not decided)

QUEUE_REVIEW_VERDICT=PASS

## Gates (this authoring lane)
- `scripts/workflow/check-queue.sh` → PASS.
- `scripts/workflow/check-contract-integrity.sh` → PASS.
- `CURRENT_SCHEMA_VERSION` unchanged (12); no app/native/schema/contract/persistence/dependency code touched — this lane commits ONLY the T4 spec note + queue governance + this review artifact. No product-scope decision made.

## Deferred findings
None. Both review Highs + the Medium + the Low fixed before governance; re-review READY. The FUTURE T4 design lane still owes its own review-plan on the produced ADR (recorded then), and T4 implementation remains gated behind the user's resolution of B1 (M0-vs-post-v1 STOP-AND-ASK per the READY brief) and B2 (the proof model). T5 remains a separate design-gated lane.
