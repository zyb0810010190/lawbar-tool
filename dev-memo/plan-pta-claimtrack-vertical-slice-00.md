# PLAN — PTA resequencing: a ClaimTrack vertical slice before PTA-07

**Type:** PLAN (resequencing). **Status:** DRAFT — non-authorizing until cc-suite `review-plan`
returns READY. **Branch base:** `main` (`b0e2948`). **Supersedes sequencing only** of
`dev-memo/plan-pretrial-trial-addon-01.md` (the PTA umbrella); it does NOT change any contract
already shipped, nor cancel any umbrella WI.

## 1. Problem statement (evidence-based)

The PTA umbrella (`plan-pretrial-trial-addon-01.md:13`, WI breakdown `:98-151`) is sequenced
**horizontally**: all four contract models → persistence v13/v14 → IPC read → IPC write →
pre-trial UI → trial UI → localization. Three of the four contract models have shipped to `main`
(ClaimTrack, EvidencePreparation, CrossExaminationOpinion — schema + validator + typed invariants
+ fixtures + desktop tarball). But **persistence is still `CURRENT_SCHEMA_VERSION = 12`**
(`services/case-box-persistence/src/sqlite/schema.ts:51`): there is **zero persistence, zero IPC,
zero UI** for any of the three shipped models.

That is the classic horizontal-integration risk: the unproven part is no longer contract modelling
(proven three times) — it is whether the contract vocabulary survives the SQLite migration, the
append-only audit-chain write, IPC authority-stripping, preload/renderer DTOs, the Electron test
harness, `better-sqlite3` native-module ABI, and real single-lawyer workflow pressure. Adding a
fourth contract model (PTA-07, LegalOpinionCard) exercises the already-proven path and does **not**
reduce the risk most likely to delay go-live.

## 2. Decision (converged with a cc-suite Codex strategy consult)

**Insert a thin ClaimTrack VERTICAL slice — persistence → IPC → minimal UI — before PTA-07.**
PTA-07 is **deferred, not cancelled**; the umbrella's horizontal tail (PTA-08…17) is re-expressed
as incremental per-model slices.

Rationale (load-bearing):
- The first vertical slice validates the entire pipeline end-to-end on the smallest real feature,
  surfacing any integration failure **now** — before four models, two batched migrations, and a
  much larger IPC/UI surface are entangled. Discovering the first integration failure after that
  entanglement is far more expensive than a plan revision.
- ClaimTrack is the right first slice: it is the most foundational model (EvidencePreparation,
  CrossExaminationOpinion, and LegalOpinionCard all reference `claim_track_id`), and it can be
  integrated **without** committing to the v14 evidence-ref junction that LegalOpinionCard drives.
- A fourth unbacked contract is a real (not catastrophic) risk: `LegalOpinionCard`'s nullable
  `claim_track_id`, ordered supporting/opposing evidence arrays, trial filtering, and the v14
  junction impose storage/query/atomicity choices — exactly where persistence can push back on the
  contract. Because no user data depends on it yet, deferring it keeps that contract cheap to
  change once persistence reality is known. That argues for waiting, not for adding it now.
- The slice is deliberately **thicker than read-only**: a read-only list proves IPC reads and
  rendering but is not a usable local-first feature and does not exercise the hard loop
  (user action → IPC → SQLite transaction + audit-chain write → readback → UI). Slice #1 includes a
  minimal create so the write path — the high-risk part — is validated first.

Strategy consult: cc-suite Codex, thread `019fae0c-ffde-7871-b786-3fb3e5793cb4` (Option V over
Option H; ClaimTrack first; slice thicker than read-only; merge the workflow gate before product
implementation). This plan records that input; it is not authorization.

**Review record:** cc-suite `review-plan` job `review-plan-ms64jns2-iedenj` (gpt-5.5 / high /
read-only) — **verdict READY (Low-risk clarifications)**: resequencing justified on all four review
questions. One MEDIUM (`ensureMatterPartyIds` under-specified) + three LOWs (VS-1 audit-event scope;
migration-renumbering safety statement; VS-2 persistence-backed integration test) — all applied into
§3 above before this plan is committed, so VS-1's docket inherits sharp specs.

## 3. The ClaimTrack vertical slice (proposed WI sequence)

Migrations are re-expressed **incrementally** (one model per migration) rather than the umbrella's
batched v13 (2 tables) / v14 (3 tables + junction): this slice defines **v13 = `case_box_claim_tracks`
ONLY**. Later slices add v14 (evidence_preparations), v15 (cross_exam), v16 (cards + junction). This
is smaller-blast-radius than the batched umbrella migrations and each is independently tested.
**Renumbering safety (review-plan LOW):** the umbrella's batched v13/v14 numbering was
**proposed-only — never committed schema history** (`main` is at `CURRENT_SCHEMA_VERSION = 12`; no
released or user-visible v13 exists). This slice's v13 therefore becomes the first real v13, and once
it lands every later slice is **forward-only** (v14/v15/v16 — never re-cut v13).

- **VS-1 — Persistence v13: `case_box_claim_tracks` + `ensureMatterPartyIds`** (HIGH-RISK; cc-suite
  `review-plan` + `audit` + `verify`; broker required).
  - Migration `DDL_STATEMENTS_V13` adding `case_box_claim_tracks` ONLY (bump `CURRENT_SCHEMA_VERSION`
    12 → 13). Lifted filter columns (`matter_id`, `track_type`, `status`, `sort_order`) + `payload_json`
    canonical; indices `(matter_id)`, `(matter_id, sort_order)`. No FKs (queue/persistence invariant).
  - `claimTrackRepoQueries.ts`: `create` / `get` / `list(matter)` on the **shared `CaseBoxPersistence`
    interface**, mirrored in the in-memory impl (in-memory ↔ SQLite parity is a tested invariant).
  - Atomic append-only audit-event write: **`CLAIM_TRACK_CREATED` only.** The `_UPDATED` /
    `_WITHDRAWN` / `_RESOLVED` event kinds already exist in the audit vocabulary (shipped in PTA-03),
    but VS-1 exposes no update/withdraw/resolve write path and therefore emits none of them; those
    kinds return with the update slice. VS-1 must not add write paths for the excluded lifecycle ops.
  - `ensureMatterPartyIds` matter-update helper — constraints the VS-1 docket must finalize
    (review-plan MEDIUM, job `review-plan-ms64jns2-iedenj`):
    - **Trigger:** an explicit helper call invoked by the ClaimTrack-create path when a referenced
      `claimant_party_id` / `respondent_party_id` maps to an id-less party — NOT a blanket
      migration-time sweep of every matter.
    - **ID generation:** server-side ULID, one per id-less party, written into the matter's
      `parties[]` / `$defs.party` `id` field (optional-additive, already in the contract from PTA-03).
    - **Audit + atomicity:** the backfill and the ClaimTrack create are one atomic transaction with an
      append-only audit event; a failure rolls back both.
    - **Idempotency:** re-running when all parties already have ids is a no-op (no new audit event).
    - **Test/fixture impact:** persistence-only (no schema change — `Party.id` is already optional in
      the contract); the semantic test asserts backfill idempotent + audited and that existing
      id-less-party fixtures still validate. No fixture mutation without a matching schema+semantic
      test (invariant preserved).
  - `data-migration-compat` extended to v13 (upgrade v1→v13; refuses-future; idempotent).
  - Gates: `npm --prefix services/case-box-persistence test` (abi-smoke pretest) + contract suite.
  - Excludes: EvidencePreparation/CrossExam/card tables; the v14 junction; delete-guard/hard-delete.

- **VS-2 — IPC read + minimal create channel** (cc-suite `audit` + `verify`).
  - `listClaimTracks` read channel + a single `createClaimTrack` write channel (full validation chain:
    preflight matter+tenant fail-closed; authority-field strip; **reject `claimant_party_id` /
    `respondent_party_id` not present in the matter's `parties[]`**; expose `ensureMatterPartyIds`).
  - Preload shims + `renderer/api.ts` wrappers.
  - Gates: `npm --prefix apps/lawbar-desktop test` (ipc-handlers unit: validation, authority-strip,
    preflight fail-closed, unknown-party rejection) **plus at least one integration-style test**
    (review-plan LOW) proving `createClaimTrack` writes through the REAL persistence interface — not a
    handler mock — and readback resolves from the same source of truth.
  - Excludes: update/withdraw/resolve writes, hard-delete, all other models' channels.

- **VS-3 — Renderer: ClaimTrack list + minimal add flow** (UI WI — needs a `Design artifact:` per
  `UI-GATES.md`; cc-suite `audit` + `verify`).
  - Preparation-view entry point + route; ClaimTrack list (main-claim / counterclaim grouping) with an
    empty state; a minimal "add claim / counterclaim" form calling `createClaimTrack` via VS-2.
  - i18n: only the enum labels this slice surfaces (`track_type`, `our_role`, `status`) — no literals.
  - Gates: `npm --prefix apps/lawbar-desktop test` (renderer-view + drift-guard). Existing evidence
    screen untouched.
  - Excludes: inspector detail, edit/withdraw/resolve forms, trial mode, the full pre-trial 3-region
    surface (those return with EvidencePreparation/CrossExam slices).

## 4. Preserved / deferred (not cancelled)

- **PTA-07 (LegalOpinionCard contract)** — DEFERRED until the v14 junction design is informed by
  persistence reality (it drives the junction; specifying it before any persistence exists is the
  risk §2 names). Re-enters after the CrossExamination slice.
- **PTA-08…17 (umbrella horizontal tail)** — superseded *as a sequence* by the incremental
  per-model slices; each umbrella WI's scope content is reused, not discarded.
- **EvidencePreparation, CrossExaminationOpinion backing; delete-guard / hard-delete; trial-card
  bundle; rich editors; localization completion** — each its own later slice.

## 5. Governance / sequencing (hard requirements)

1. **Gated base first.** The slice implementation is exactly the class of work the pre-execution
   green-baseline gate (branch `chore/workflow-pretest-gate`, commit `fc93693`, UNMERGED) was built
   for: SQLite, `better-sqlite3` ABI, IPC, desktop tests. **The gate should be merged to `main`
   first (a user-authorized push/PR/merge — hard-stop), then the product branch rebased onto the
   gated `main`,** so every slice WI runs under the green-baseline enforcement. Merging the gate is a
   separate WORKFLOW action, never bundled with product changes.
2. **This resequencing plan needs cc-suite `review-plan` READY before any VS-* implementation.**
   Generating a resequenced queue and executing it are different authorities (`AGENTS.md`
   §"Queue governance"). This doc is a proposal, not permission.
3. **VS-1 is HIGH-RISK persistence** → cc-suite broker `review-plan` + `audit` + `verify` mandatory;
   one revertable commit per VS-WI; explicit-path staging; `/loc-guardian:scan` before + after.
4. **Critical invariants preserved** (`AGENTS.md` §"Critical invariants"): no FK from new tables;
   persistence = source of truth; audit chain append-only + atomic; in-memory ↔ SQLite parity;
   `OcrQueueError`/audit codes untouched; no fixture mutation without schema + semantic test updates.
5. **Push is a hard-stop** — no VS-WI pushes without explicit per-instance authorization.

## 6. Acceptance criteria (for the slice as a whole)

1. Persistence at v13 with `case_box_claim_tracks`; create/get/list green on BOTH the SQLite and
   in-memory impls (parity); `data-migration-compat` v1→v13 green; existing matters open unaffected.
2. `ensureMatterPartyIds` backfills id-less parties idempotently + audited.
3. A ClaimTrack created through the UI is stored, audited (`CLAIM_TRACK_CREATED`), and read back into
   the list — the full loop (UI → IPC → SQLite txn + audit → readback → UI) demonstrated by a test.
4. Unknown party refs rejected at the handler; authority fields stripped; preflight fail-closed.
5. Every gate green (`docs/contracts/case-box-contract`, `services/case-box-persistence`,
   `apps/lawbar-desktop`); each VS-WI cc-suite audited + verified; UI WI carries a `Design artifact:`.
6. No umbrella contract changed; PTA-07 remains deferred, not deleted.

## 7. Review packet (compact) — for cc-suite `review-plan`

- **Active plan summary:** Resequence the reviewed horizontal PTA umbrella to insert a thin ClaimTrack
  vertical slice (persistence v13 claim_tracks-only + create/get/list + audit + `ensureMatterPartyIds`
  → IPC read + minimal create → renderer list + add form) before PTA-07, to de-risk the unproven
  persistence/IPC/UI pipeline on the smallest real feature. PTA-07 and the umbrella tail are deferred,
  not cancelled.
- **Exact target files (plan/docs only for THIS WI):** `dev-memo/plan-pta-claimtrack-vertical-slice-00.md`.
  (VS-1/2/3 name their own target files in §3; those are implemented under separate WIs after READY.)
- **Acceptance criteria:** §6.
- **Out of scope:** any product code in THIS plan WI; EvidencePreparation/CrossExam/card backing;
  delete-guard/hard-delete; trial bundle; rich editors; i18n completion; PTA-07 (deferred).
- **Essential references:** `dev-memo/plan-pretrial-trial-addon-01.md` (umbrella + horizontal
  sequence, `:13`, `:98-151`); `services/case-box-persistence/src/sqlite/schema.ts:51`
  (`CURRENT_SCHEMA_VERSION = 12`); `AGENTS.md` §"Critical invariants" + §"Queue governance".
- **Review questions:**
  1. Is inserting a ClaimTrack vertical slice before PTA-07 the right risk-reduction move, or does the
     horizontal order genuinely reduce total risk more than it defers integration reckoning?
  2. Is narrowing v13 to `case_box_claim_tracks` only (incremental per-model migrations) sound versus
     the umbrella's batched v13/v14 — any migration-numbering or compat hazard?
  3. Is including a minimal create in slice #1 (vs read-only) the right scope for validating the write
     path, given VS-1 is HIGH-RISK persistence?
  4. Is the gated-base sequencing (merge the pre-execution gate to `main` before VS implementation)
     correct, and are the invariant preservations in §5 sufficient?

## 7.6 VS-1 planning discovery (post-review) — a party-identity foundation WI (VS-0) is required FIRST

Grounding VS-1 against the real persistence code (planner pass) surfaced two Critical blockers in the
`ensureMatterPartyIds` step that §3 had folded into VS-1. This is exactly the integration reality the
vertical slice exists to surface early — and it lands at slice #1, before four models are entangled.

**The blockers.**
- **O1 — audit-vocabulary gap.** Parties live only inside `case_box_matters.payload_json`. Backfilling
  a ULID onto an id-less party REWRITES that payload = a matter mutation. But the matter audit kinds are
  only `MATTER_REGISTERED` / `MATTER_ARCHIVED` / `MATTER_UNARCHIVED` / OCR-sync-LLM-export flags — there
  is NO "matter updated" / "party ids assigned" kind. Leaving the mutation unaudited breaks the
  every-mutation-audited invariant; adding a kind is a **contract/schema change (hard-stop)**.
- **O2 — circular identity.** "assign an id to the party that `claimant_party_id` references" is circular:
  an id-less party has no ULID to be referenced by. Assignment must happen BEFORE the ClaimTrack stores a
  reference.

**Resolution (cc-suite Codex consult, thread `019fae2a-280f-7973-ad4c-9f97eae8d8ff`; I concur).**
Adopt **resolution A**, and **shift the slice boundary** — a small **VS-0 party-identity foundation WI
precedes VS-1**:
1. **New matters** — the persistence create path assigns a server-side ULID to any id-less party at
   matter creation (populates the already-optional `Party.id`; audited by the existing `MATTER_REGISTERED`
   because ids exist before the create is hashed). **No schema change** on this path.
2. **Legacy id-less matters** — an explicit, audited backfill via a **NEW `MATTER_PARTY_IDS_ASSIGNED`
   audit-event kind** (specific, not a generic `MATTER_UPDATED`; reusing `MATTER_ARCHIVED`/flag kinds would
   be semantically false). This is the **one schema change** — a hard-stop.
3. **VS-1 is revised**: `ensureMatterPartyIds` is REMOVED from VS-1; VS-1's `createClaimTrack` REQUIRES the
   referenced `claimant_party_id` / `respondent_party_id` to already exist on the matter's parties.

**Why not a migration-time backfill (candidates B/E), the tempting shortcut** — it is **unsafe**: rewriting
an audited entity's persisted payload inside a schema migration would leave `case_box_matters.payload_json`
no longer matching the last matter event's `after_state_hash`. It might pass the structural chain check
(`event_count == COUNT == MAX(sequence)`) and `prev_event_hash` linkage, but it silently breaks
**state-hash continuity** — the precise class of undetectable drift a court-facing audit log must never
permit. A migration may transform audited entity state ONLY by appending an audit event per affected matter.

**Status / hard-stop.** VS-0's item 2 (the new `MATTER_PARTY_IDS_ASSIGNED` audit-event kind) is a
**public schema change** → `AGENTS.md` hard-stop + `security-boundary.md` §"No silent surface changes":
requires an ADR + **explicit user approval** + its own cc-suite `review-plan`. Detailed VS-0 planning is
**BLOCKED pending that approval**. VS-1 does not begin until VS-0 lands.

## 8. Stop condition

Superseded when cc-suite `review-plan` returns READY and the VS-1 docket is opened; or revised if
review-plan flags the resequencing itself. Stale if the umbrella is otherwise re-planned.
