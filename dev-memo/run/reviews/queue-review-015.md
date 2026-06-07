QUEUE_REVIEW_VERDICT=PASS

# Queue review — BATCH-CASEBOX-DOCKET-LIFECYCLE-00 WI-D4 boundary-correction amendment

- Amends ONLY the WI-D4 block (boundary correction; no product-scope change). WI-D1/D2/D3 substance unchanged. WI-D1 + WI-D2 are already merged; WI-D3 (design) + WI-D4 (UI) remain to land.
- Trigger: the WI-D3 design review (`review-plan-mq33imd0-bdmap1`, NEEDS-FIX) surfaced that WI-D4's governed boundary was defective — Allowed listed `apps/lawbar-desktop/renderer/preload.mts` (which does not exist) and Forbidden listed `apps/lawbar-desktop/electron/**`, which forbids the REAL renderer IPC bridge `apps/lawbar-desktop/electron/preload.mts` (where every casebox invoke binding lives; the WI-804 fact-review WI edited it). WI-D4 as governed could not wire the bridge without a forbidden path → governed hard stop. User approved a boundary-correction amendment (2026-06-07).
- Amendment (file boundary only):
  - WI-D4 Allowed: `renderer/preload.mts` → **`apps/lawbar-desktop/electron/preload.mts`**.
  - WI-D4 Forbidden: `apps/lawbar-desktop/electron/**` → **`apps/lawbar-desktop/electron/ipc/**` + `apps/lawbar-desktop/electron/main.ts`** (main-process handler wiring + entrypoint stay forbidden; only the preload bridge is touchable).
  - WI-D4 Scope/Acceptance: corrected bridge path (invoke binding only; no main-process handler / ipc change); **added PAGINATION** — `casebox:docket:list` returns `{rows,next_cursor}`; render first page + an explicit "Show more" on non-null `next_cursor` (mirror `viewMatterFacts.ts`), append-on-fetch, no silent truncation, no unbounded eager-fetch, with an acceptance test.
  - WI-D3 design doc (`dev-memo/design/2026-06-06-casebox-docket-pending-dismiss.md`) updated to match (electron/preload.mts; out-of-scope now `electron/ipc/**` + `electron/main.ts`, not `electron/**`; pagination section + acceptance hook added).
- cc-suite review-plan: design review `review-plan-mq33imd0-bdmap1` (NEEDS-FIX: High preload-boundary + Medium pagination) → fixes applied → amendment re-review `review-plan-mq3rjkvu-m4pz0t` (**PASS**, no C/H/M). Path 1 runner v0.2.18, gpt-5.5, effort high, sandbox read-only.

# Confirmations
- Queue-lint PASSED on the amended queue (4 WIs); WI-D4 Type-UI `Design artifact:` field intact.
- Boundary correction only — NO product-scope change (still list-proposed + dismiss-proposed; no edit/transition/reminders/confirm-from-list; no `src/**`/`services/**`/`docs/contracts/**`; no `src/caseBox/dto.ts`). `DTO-LOC-797` stays open (no DTO split in this amendment).
- Allowed files do not intersect `dev-memo/run/forbidden-paths.txt`.
- The reviewer confirmed: preload contradiction resolved (bridge-only wiring possible without crossing the main-process boundary); pagination resolved (first page + Show-more + test, no unbounded fetch); dependency order holds (D4 depends on D1+D2+D3).
