# PHASE LANE — ClaimTrack completion (VS-2 IPC + VS-3 UI + tenant handler)

**Type:** LANE AUTHORIZATION (governance envelope). **Status:** DRAFT — non-authorizing until (a) cc-suite
`review-plan` READY and (b) Frank approves this envelope as the product intent for the phase. Branch base:
`feature/pta-claimtrack-vertical-slice` (VS-0 + VS-1 complete; nothing pushed).

## 0. Why a lane (the efficiency mechanism)

The dominant cost of autonomous product work here is authorization + verification latency *per WI*, not code.
A phase lane amortizes it: **Frank approves this envelope once**, then the agent executes every WI inside it
without per-WI product re-approval, stopping only at the reserved human gates (§5) and product-direction
discoveries (§4). This is the "approve the plan of record, not each step" lever (Codex thread `019fcceb`).
It preserves the load-bearing boundary — *the agent executes approved terrain; it does not expand the map.*

**Review record:** cc-suite `review-plan` `review-plan-mseoy322-7h7gk4` → NEEDS-FIX (the "amortize once" idea is
sound for a 2-WI, persistence-already-shipped, push-still-gated phase, BUT the child-WI escape hatch was a
self-expansion path). Applied: (#2) child WIs now inherit the FULL tier gates — lint is necessary-not-sufficient,
no new wire/DTO/legal/design meaning; (#1) VS-3 focused audit must cover legal-semantic display + no-misleading-
status; (#3) tenant enforcement reworded to handler-enriches-persistence (defense-in-depth) + richer party-ref
defined as handler preflight against `matter.parties[]` with the same `unknown_party` semantics; (#4) VS-2
plumbing files added (`handlerShared`/`errorMap`/`dto`/`renderer/types`), and VS-3's design artifact must
pre-exist (agent may not invent design direction mid-lane). Re-review pending.

## 1. Phase goal + WI list (with risk tiers)

Complete the ClaimTrack vertical slice into a **usable local-first feature**: a lawyer can add claim/
counterclaim tracks and see them listed. Persistence (VS-0 + VS-1) is done; this lane is the IPC + UI on top.

| WI | Scope (one line) | Risk tier | Gate matrix (per tier, §3) |
|---|---|---|---|
| **VS-2** — IPC read + create channel + tenant enforcement | `listClaimTracks` read channel + a single `createClaimTrack` write channel: preflight matter existence + **reject a foreign caller tenant before calling the persistence** (closes deferred `VS0-TENANT-1`, mirroring the `archiveMatter` precedent — the handler ENRICHES/REPEATS, it is not the only source of truth); inject `tenant_id`/`actor_user_id`; strip authority fields; **handler party-ref preflight against `matter.parties[]` using the SAME error-code semantics as VS-1's `unknown_party`** (defense-in-depth, not a separate product rule — VS-1 persistence still owns the source-of-truth existence check); preload + `renderer/api.ts` wrappers; one integration test through real persistence. | **Tier 1** (IPC / data boundary / legal-workflow surface) | review-plan (full) + audit (full) + verify; test matrix narrowed to the desktop ipc-handlers + one persistence-backed integration test if file ownership is clean |
| **VS-3** — renderer ClaimTrack list + minimal add form | Preparation-view entry point + route; ClaimTrack list (main-claim / counterclaim grouping) + empty state; a minimal "add claim / counterclaim" form calling `createClaimTrack`; i18n for only the enum labels this slice surfaces (`track_type`, `our_role`, `status`) — no literals. | **Tier 1.5** (UI, but ClaimTrack display carries legal semantics) | review-plan (full) + **focused** audit — UI scope, no audit-chain/security claims, but MUST cover the legal-semantic display risks: party-name rendering, main-claim/counterclaim grouping correctness, enum-label accuracy, empty/error states, and **no misleading status text** (a `withdrawn`/`resolved` track must never read as `active`) + verify; renderer + i18n-drift-guard tests; **requires a concrete `Design artifact:` that already EXISTS before VS-3 opens** (per `UI-GATES.md`; the agent MUST NOT invent its own design direction mid-lane — if no artifact exists, STOP for Frank, §4 product-direction) |

**Out of the lane** (need a new envelope / new phase): EvidencePreparation / CrossExam / LegalOpinionCard
backing; ClaimTrack update/withdraw/resolve/delete + hard-delete; trial-mode; read-aggregation bundle;
the v14 junction; any push/merge/release. PTA-07 (LegalOpinionCard contract) stays deferred.

## 2. Allowed / forbidden files (per WI)

- **VS-2 allowed:** `apps/lawbar-desktop/src/caseBox/*Handlers.ts` + `dto/*` (+ `handlerShared.ts`,
  `errorMap.ts`, `dto.ts` for the legitimate plumbing — review-plan #4), `electron/ipc/caseBoxHandlers.ts`,
  `electron/preload.mts`, `renderer/api.ts`, `renderer/types.ts`, the desktop ipc-handler tests. **Forbidden:** any
  `services/case-box-persistence/**` change (VS-1 is the persistence contract — consume it, don't edit it);
  any `docs/contracts/**`; renderer UI (that's VS-3); any other case-box entity's channels.
- **VS-3 allowed:** `apps/lawbar-desktop/renderer/screens/*`, `renderer/router.ts`, `renderer/index.*`,
  `renderer/i18n/{catalog,labels}.ts`, the renderer tests. VS-3 **reads/references** the pre-existing
  `dev-memo/design/*` artifact but MUST NOT create or materially revise it (that is a separate approved
  Design/UI WI). **Forbidden:** IPC/persistence/contract; the existing evidence/matter screens; new enum literals.
- **Both forbidden (lane-wide):** `.claude/**` enforcement, `dev-memo/run/**`, secrets, any new runtime
  dependency, any schema/DDL change, any push/merge.

## 3. Gate matrix by risk tier (declared here, reviewed before execution; the agent MUST NOT self-downgrade)

- **Tier 0** (court/audit-chain/schema/security/persistence) — *none in this lane*. Full chain, non-negotiable.
- **Tier 1** (VS-2): full `review-plan` + full `audit` + `verify`; per-WI local commit; batch-closeout on cadence.
- **Tier 1.5** (VS-3): full `review-plan` + **focused** `audit` (UI scope, no security/audit-chain claims) +
  `verify`; UI-GATES design-artifact gate; renderer + drift-guard tests.
- The tier is fixed in this envelope. A WI cannot be executed at a lower tier than declared without a new
  review of *this* lane doc.

## 4. Discovery-envelope rules (how mid-flight findings are handled — the queue-authorship reconciliation)

When a WI surfaces work not in its acceptance criteria, classify it:
- **Inline** — fully inside the WI's allowed files + acceptance. The agent handles it in-WI.
- **Child WI** — needed inside this phase, same source-of-truth, **no product decision, no §5 gate**. The
  agent drafts a queue *amendment* (a bounded WI added to this lane). The amortization is **"no new PRODUCT
  approval," NOT weaker verification** (review-plan `review-plan-mseoy322` finding #2). A child WI is
  eligible ONLY if ALL hold: (i) it touches only files already in this lane's allowed set (§2); (ii) it
  introduces **no new user-visible or legal semantics, no new DTO/wire meaning, no new persistence contract,
  no new design direction**; (iii) it inherits the **same-or-higher tier gates** as its parent WI —
  including the full cc-suite `review-plan` + `audit` + `verify`, not `check-queue.sh` lint alone (lint is
  structural and NECESSARY-but-NOT-sufficient). If any of (i)-(iii) fails, it is not a child WI — it is
  either inline (if trivially in-scope) or a §4 product-direction checkpoint. (Example that IS a child WI:
  an internal helper refactor inside VS-2's allowed files with no wire/DTO change. Example that is NOT:
  adding a field to a DTO — that is new wire meaning → checkpoint Frank.)
- **Product-direction** — schema meaning, legal-workflow semantics, audit-chain behavior, privilege/
  confidentiality, a new party-model rule, release posture → **STOP and checkpoint Frank.** The agent may
  not expand the map. (Example: "should a ClaimTrack allow >1 counterclaim?" is Frank's call.)

## 5. Reserved human gates (unchanged; this lane cannot override them)

Push / PR / merge / release / deploy; any breaking schema/wire change; audit-chain invariant changes;
privilege/confidentiality policy; security-boundary changes; irreversible migrations; the `human.override`
token; accepting any Critical/High/Medium defect; choosing between legally-meaningful alternatives. Everything
this lane authorizes is a SUBSET of what is globally permitted (`autonomy.md`).

## 6. Commit / push / report policy

Per-WI: one revertable local commit after its tier gates pass + cc-suite audit/verify, exact-path staging,
`dev-memo/run/log.md` append, deferred-findings recorded. **Push stays a hard-stop** — the lane produces local
commits only; publishing the branch is Frank's decision. Batch-closeout on the existing cadence (behavioral
mitigation: batch planning edits into fewer commits to reduce closeout frequency; the structural lane-scope of
the cadence is deferred — see the phase report).

## 7. Stop / report conditions

Stop and report to Frank on: a §4 product-direction discovery; any §5 reserved gate; a cc-suite FAIL/stall; a
gate failure whose fix is outside the lane; a forbidden-file need; queue ambiguity; or lane completion (both
WIs merged-ready). Report per WI: commit + files + tier + gates + cc-suite jobs + deferred backlog + next WI.

## 8. Review packet (compact) — for cc-suite `review-plan`

- **Active plan summary:** A governance envelope to execute the last two ClaimTrack-slice WIs (VS-2 IPC +
  VS-3 UI) autonomously under one approval, with per-WI risk tiers, allowed/forbidden files, a discovery
  envelope that lets the agent add bounded child-WIs but not product decisions, and unchanged reserved human
  gates. Persistence (VS-0/VS-1) is done; nothing here touches the audit chain, schema, or security.
- **Exact target files (this lane WI = docs only):** `dev-memo/plan-pta-claimtrack-completion-lane-00.md`.
- **Acceptance criteria:** the two WIs' scopes (§1) + the tier gates (§3) hold; no forbidden-file touch;
  discovery stays inside §4; no reserved gate crossed.
- **Out of scope:** everything in §1 "Out of the lane"; push/merge.
- **Essential references:** `dev-memo/plan-pta-claimtrack-vertical-slice-00.md` §3 (VS-2/VS-3 scope);
  `dev-memo/plan-pta-vs1-claimtrack-persistence-00.md` (the persistence contract VS-2 consumes);
  `dev-memo/deferred-audit-findings.md` `VS0-TENANT-1` (VS-2 must close it); `UI-GATES.md`; `autonomy.md`
  §"Overnight lane policy" (lane-authorization concept).
- **Review questions:**
  1. Are the risk tiers correct — is VS-2 truly Tier 1 (no audit-chain/security surface, since it consumes
     VS-1's already-audited persistence and adds only IPC + tenant enforcement), and VS-3 Tier 1.5?
  2. Is the discovery-envelope boundary safe — a child WI skips only a new PRODUCT approval, NEVER the tier
     gates (full review-plan+audit+verify) and never new wire/DTO/legal/design meaning — or does any
     plausible VS-2/VS-3 discovery actually cross into §4 product-direction?
  3. Is the VS0-TENANT-1 tenant enforcement correctly placed in VS-2's handler (per the archiveMatter
     precedent), and is "richer party-ref validation on top of VS-1's unknown_party" well-defined?
  4. Does anything in this envelope weaken a reserved gate (§5) or broaden file permissions beyond the two
     WIs' legitimate needs?

## 9. Stop condition
Superseded when review-plan is READY and Frank approves the envelope; then VS-2's docket opens under it.
Revised if review-plan flags a tier, a boundary, or the discovery model.
