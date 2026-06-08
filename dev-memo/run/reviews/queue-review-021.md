QUEUE_REVIEW_VERDICT=PASS

# Queue review — BATCH-CASEBOX-AUDIT-PROJECTION-00 (WI-AP1)

Security-adjacent one-WI batch: close a live authority-field leak on the `casebox:audit:listEvents` IPC channel. `listAuditEventsHandler` returns the raw persistence page (no projection), so `CaseBoxAuditEvent`'s `tenant_id`/`actor_user_id`/`matter_id`/`id` + open-index extras cross the IPC boundary on the live audit panel channel. Same class as the fixed FACTS-AUD-3/GET-AUD-1; the audit LIST channel was missed. Fix mirrors FACTS-AUD-3 (response allowlist + `projectPage`). NO persistence/contract/renderer/electron change.

## cc-suite review-plan (Path 1 runner v0.2.18, gpt-5.5/high/read-only)
- First attempt (foreground, harness auto-backgrounded the long call): the orchestrating shell was reaped — codex+runner died with a 0-byte sink and NO job registered (reap-class; no orphan job to recover). Re-run per the cc-suite background-invocation discipline using the runner's **native `--background`**.
- `review-plan-mq4kc7jy-bswp51` (native `--background`, tracked): **PASS, no C/H/M.** Confirmed: WI boundaries + allowed/forbidden coherent; the response field set includes every renderer-consumed audit field (`timestamp/action/entity_type/entity_id/reason`) and excludes `tenant_id/actor_user_id/id/matter_id` correctly (panel is matter-scoped); including the 3 chain hashes is appropriate (verification/display, not authority); `projectPage`→`projectRow` copies only allowlisted keys so the open `[k:string]: unknown` index cannot leak extras; FACTS-AUD-3 pattern directly reusable; security-adjacent → review-plan+audit+verify required, no renderer path → no design gate; no plan-level hard stop. Operational note: stage explicit paths only — do NOT stage the already-dirty `dev-memo/run/*` (outside the WI allowed set).

## Confirmations
- Queue-lint PASSED (1 WI, no deps).
- Allowed/forbidden coherent; `renderer/**`, `electron/**`, `services/**`, `docs/contracts/**`, `handlerShared.ts`, `handlers.ts`, all other tests forbidden.
- loc pre-scan: 0 over limit (`auditHandlers.ts` 124 pure, `dto/audit.ts` 28 pure, `ipc-list-projection` 228 pure / cap 1200).
- Security boundary → cc-suite audit + verify REQUIRED at impl (self-review NOT acceptable).
