QUEUE_REVIEW_VERDICT=PASS

# Queue review — BATCH-CASEBOX-DOCKET-PROPOSAL-EDIT-IPC-00 (WI-DPE4 IMPL, IPC/DTO)

Single WI-DPE4: the IPC/DTO layer (`casebox:docket:edit` handler + `EditDocketEntryDto`) authorized by
`docs/adr/docket-proposal-edit.md` §9, consuming the merged DPE3 `editDocketEntry` persistence op + the DPE2
contract. HIGH-RISK — IPC security boundary (tenant isolation + server-side authority derivation +
forbidden-field input-reject + no-leak error mapping) → broker review-plan before code, broker audit +
verify after. NO renderer UI/call sites (DPE5), NO persistence/contract change. Plan:
`dev-memo/plan-batch-casebox-docket-proposal-edit-ipc-00.md`.

## cc-suite review-plan (Path 1 runner v0.2.18 native --background, gpt-5.5/high/read-only)
- `review-plan-mqa9a907-cqu5g3`: **READY-with-clarifications** — no Critical/High. All 7 review questions
  validated (8-field DTO + forbidden complement is exhaustive when the handler constructs the opts itself;
  proposed-only is correct read-only defense-in-depth with persistence re-enforcement as the real safety
  property; adding only `revised_at` to the projection is correct, input-forbidden/output-safe; no error
  path leaks tenant/matter/id and a cross-tenant `entryId` is indistinguishable from non-existent; DTO
  naming matches create/confirm/dismiss; preload addition is renderer-screen-free; sequencing correct with
  no design-artifact UI gate). Three non-blocking clarifications, FOLDED into plan + queue:
  1. Input policy is REJECT, not "strip" — forbidden/unknown INPUT fields are rejected before persistence;
     "strip" applies ONLY to the OUTPUT response projection. (Wording corrected throughout.)
  2. Snake_case scope aliases `matter_id` + `entry_id` added to `EDIT_DOCKET_FORBIDDEN_FIELDS` (alongside
     `tenant_id`) for sharper tests — the camelCase `matterId`/`entryId` are the only accepted scope form.
  3. Added an adversarial DTO test for `__proto__` (+ `constructor`/`prototype`) from JSON input — proves
     `isPlainJsonObject` + the unknown/forbidden guards reject them at this high-risk boundary.
  Also folded (b): the proposed-only TOCTOU safety property is DPE3 PERSISTENCE re-enforcing before
  mutation, NOT a single-threaded-main assumption.
  rawOutput sha256 `0a637e05cbd7b884e27b86d4830cf14d6fea126643730582ca5a7c2bfc068c2f`.

### cc-suite recording (per .claude/rules/cc-suite.md)
- Kind/scope: review-plan ×1 on WI-DPE4 (the 8 IPC/DTO files + plan). Resolved runner:
  `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs` (Path 1). Model/effort/sandbox:
  gpt-5.5 / high / read-only. Job above, `status:"completed"`, retrievable. Failure class: none.

## Confirmations
- Queue-lint PASSED (1 IMPL WI; deps = merged DPE2 `52e5b1b` + DPE2-FIX1 `e86747f` + DPE3 `f680d2e`;
  concrete scope/allowed-files/gates/acceptance).
- Allowed files = the 8 declared `apps/lawbar-desktop/{src/caseBox,electron,tests}/**` surfaces. Forbidden =
  `renderer/**` (DPE5), `services/case-box-persistence/**`, `docs/contracts/**`, `security/activeTenant|
  activeActor.ts`, `errorMap.ts` (no new code), any channel beyond `casebox:docket:edit`.
- No forbidden-path intersection with `dev-memo/run/forbidden-paths.txt`.
- No `check-ui-design-artifact` gate (touches `src/caseBox` + `electron`, NOT `apps/*/renderer/*`;
  `Type: IMPL`).
- HIGH-RISK security-boundary gate satisfied by the broker review-plan (required pre-impl); the mandatory
  broker audit + verify on the impl scope are owed AFTER implementation.
- Governance follows the documented rule: mark-reviewed + govern STANDALONE, content-bind verified. This
  governance step writes `queue.reviewed`/`queue.governed` only; it does NOT commit (no impl authorized).

## Post-review scope addendum (mechanical loc-split; user-directed 2026-06-11)
During WI-DPE4 implementation, the edit HANDLER unit tests cannot fit in
`tests/ipc-casebox-handlers.unit.test.mjs` (1167 raw at baseline; loc-guardian test-fail = 1200) without
crossing the threshold — exactly the loc-split the plan anticipated. With explicit user authorization, two
files were added to WI-DPE4 allowed-files SOLELY for this mechanical split: a NEW sibling
`apps/lawbar-desktop/tests/ipc-casebox-docket-edit.unit.test.mjs` (the edit handler unit tests) and
`apps/lawbar-desktop/package.json` (mechanical: add that file to the existing `test` script's file list, no
behavior change). Edit PROJECTION tests stay in the already-in-scope `ipc-list-projection.unit.test.mjs`.
This is a test-layout reflection of the already-reviewed IPC/DTO design — review-plan
`review-plan-mqa9a907-cqu5g3` (READY-with-clarifications) stands and no fresh review-plan was run (per the
user's mechanical-only condition). QUEUE_REVIEW_VERDICT=PASS.
