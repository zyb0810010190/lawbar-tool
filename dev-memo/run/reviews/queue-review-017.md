QUEUE_REVIEW_VERDICT=PASS

# Queue review — BATCH-CASEBOX-DTO-SPLIT-00 (WI-DTO1): split dto.ts behind a barrel (closes DTO-LOC-797)

- One-WI behavior-preserving SOURCE refactor: split `apps/lawbar-desktop/src/caseBox/dto.ts` (797/800 raw LOC) into per-entity modules under `src/caseBox/dto/` behind a thin barrel (`dto.ts` = `export * from "./dto/<entity>.js"`), preserving behavior + the public import surface. Closes DTO-LOC-797.
- Proposal: `dev-memo/plan-batch-casebox-dto-split-00.md` (untracked; queue is authority).
- cc-suite review-plan (per the §"Retry policy"):
  - **Attempt 1** (`review-plan-mq3u8bef-nlcw1r`, Path 1 runner v0.2.18, gpt-5.5, full packet): **TIMEOUT-class** — codex hung ~22+ min with empty output (the embedded full-queue prompt was too wide); the orchestrating call was terminated and the runner returned `status:"completed"` with empty `rawOutput` (no verdict). Classified TIMEOUT per §"Timeout / failure classification".
  - **Attempt 2** (`review-plan-mq3v327m-ps3zc6`, Path 1 runner v0.2.18, gpt-5.5, **COMPACT packet** — review-packet only, not the full verbatim queue): **PASS, no Critical/High/Medium**. The retry-with-compact-packet policy succeeded.
- Codex verdict (attempt 2): all 5 dimensions PASS. Barrel-preserving split keeps all 9 importers unchanged; the one required coupling change is the `renderer-dto-sync.test.mjs` canonical reader (read split `dto/*.ts`, assert every canonical pair exists + non-empty so an empty extraction cannot false-pass); feasible under NodeNext `export *` (re-exports types+values); circular-import avoided by entity->shared->contract (no entity imports the barrel); main risks (missed re-export, entity-imports-barrel, weakened regex) are caught by the stated gates/acceptance if implemented literally.

# Confirmations
- Queue-lint (check-queue.sh) PASSED on the live queue (1 WI: WI-DTO1).
- Allowed/Forbidden coherent: importers + `dto-contract.test.mjs` Forbidden (enforce no-churn); `dto.ts` + `dto/**` + `renderer-dto-sync.test.mjs` + ledger Allowed.
- No product behavior / DTO-field / IPC-channel / renderer-UX / persistence / contract change; no new dependency; no migrations.
- Operational note: a 9-DAY-OLD orphaned `codex exec` process (gpt-5.3-codex, unrelated "S2.5 editorial token-tier" audit, baseline `41ca489`) was observed alive during this review; it is NOT this batch's process and was left untouched (out of scope; reaping it is a separate operational decision).
