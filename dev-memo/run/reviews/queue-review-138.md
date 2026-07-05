# Queue review — WI-GATE3-R2-OVERDUE-DASHBOARD-BANNER-00 (authoring/governance)

Lane: Gate-3 residual **R2** — global overdue-deadline dashboard-banner **WI authoring/governance** (Type: UI, release-readiness MEDIUM risk). Governance-authoring only — this lane produces the governed queue WI + its committed design artifact so a FUTURE lane implements the banner; it implements NOTHING, edits no renderer/source/test, and makes NO gate-4/go-live decision.
Date: 2026-07-05. Branch: `gate3-r2-overdue-dashboard-banner-governance` (from synced `main` @ `3aa1fb4`). Batch: 1/3 since marker `fb8756e` — no batch closeout this lane.

## What this is
Authorizes (per explicit user authorization 2026-07-05) a FUTURE execution lane to implement gate-3 residual **R2** — the missing **global (cross-matter) overdue-deadline dashboard banner** (brief §10: shown when any deadline in any matter is overdue or due within 7 days, visible on app open), DISTINCT from the already-existing per-matter urgency banner (`renderer/screens/viewMatterDeadlines.ts`, brief §18, which stays unchanged). The `Type: UI` design-artifact gate (`UI-GATES.md`) is satisfied by the committed design spec `dev-memo/design/2026-07-05-global-overdue-dashboard-banner.md`. Key boundaries the WI + design lock in: a `role="status"` banner at the app-open matter-list home; **client-side aggregation over the EXISTING `casebox:matter:list` + `casebox:deadline:list` channels** (NO new IPC/handler/persistence/contract/DTO); **REUSE of `classifyDeadlineUrgency` + `DEADLINE_DUE_SOON_WINDOW_MS` from `renderer/format.ts`** (no reimplemented urgency rule; the banner module must import it directly); shown/hidden/loading/degraded states; a11y + i18n + tokenised colour; a new renderer test; the per-matter banner + `format.ts` untouched; gate 3 kept honest (PARTIAL/advance without collapsing the gate-4 STOP-AND-ASK; no go-live).

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
Path 1 runner foreground, resolved runner path `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`. Governance-authoring lane → review-plan only (the exec lane's review-plan/audit on the produced UI diff belongs to the future execution lane).

### /cc-suite:review-plan (on the WI + design artifact)
- Attempt 1: `review-plan-mr7uhf7p-hxnm64` · **FAILED — TIMEOUT** (`spawnSync codex ETIMEDOUT`; gpt-5.5/medium/read-only; the read-only sandbox walk of the `apps/lawbar-desktop` tree — node_modules + many renderer files — is expensive, the same class as the ocr-worker audits). Failure class **TIMEOUT** per `.claude/rules/cc-suite.md`.
- Attempt 2 (retry): `review-plan-mr7vks3q-cbi13e` · gpt-5.5/medium/read-only, **the WI + design artifact + the load-bearing source facts inlined into the prompt** (classifyDeadlineUrgency in `format.ts`, the per-matter banner in `viewMatterDeadlines.ts`, the per-matter-only `casebox:deadline:list`/`casebox:matter:list` channels, `listMatters.ts` home) so codex reviews without a filesystem walk · **READY** (all five dimensions PASS — internal consistency incl. the concrete Type:UI Design-artifact reference; completeness of surface/data-boundary/reuse/states/a11y/i18n/tests; feasibility of client-side aggregation over existing channels + the STOP boundary; ambiguity control against rebuilding the per-matter banner / changing format.ts / adding IPC-persistence / touching signing; risk & sequencing keeping gate 3 honest) · sha256 `03beb9941d51261a8c7c62be51364b5c99b108df68335fbc872cff0b50e7222b`.
  - One non-blocking improvement folded: make "no reimplemented urgency rule" mechanically reviewable — the acceptance criteria now require the banner/aggregation module to `import { classifyDeadlineUrgency } from "../format.js"` so the diff contains that import.

## Verdict: READY (governed R2 dashboard-banner UI WI; design-artifact-gated; reuse-not-rebuild; UI-only data; go-live-independent)

QUEUE_REVIEW_VERDICT=PASS

## Gates (this authoring lane)
- `scripts/workflow/check-queue.sh` → PASS (incl. the `Type: UI` design-artifact gate — the committed `dev-memo/design/2026-07-05-global-overdue-dashboard-banner.md` is referenced).
- `scripts/workflow/check-contract-integrity.sh` → PASS.
- `CURRENT_SCHEMA_VERSION` unchanged (12); no renderer/source/test/native/schema/contract/dependency code touched — this lane commits ONLY the queue governance + the design artifact + this review artifact. No implementation, no gate-4/gate-6/go-live decision.

## Deferred findings
None. The one non-blocking improvement was folded before governance. The FUTURE execution lane owes: the banner implementation per the design artifact, the new renderer test, the full desktop-suite pass, the PR-body Design-artifact line (CI gate), and its own review-plan/audit. Implementing R2 closes that residual but gate 3 STILL depends on gate 4 (STOP-AND-ASK) + R3; clearing gate 3 does NOT imply go-live — the final GO/NO-GO verdict + the three STOP-AND-ASK hard-stops remain the user's.
