QUEUE_REVIEW_VERDICT=PASS

# Queue review — BATCH-CASEBOX-DOCKET-PROPOSAL-EDIT-ADR-00 (WI-DPE1 ASSET, ADR-only)

ADR authoring only — `docs/adr/docket-proposal-edit.md`. No contract/persistence/IPC/renderer/test/source
change. The ADR governs a future high-risk contract change (a new `DOCKET_ENTRY_REVISED` audit-event
kind) on the audit-chain/security boundary → broker review-plan.

## cc-suite review-plan (Path 1 runner v0.2.18 native --background, gpt-5.5/high/read-only)
- `review-plan-mq5d1s3x-r149nn`: **ACCEPTABLE / READY — no Critical/High.** Confirmed the ADR decides all
  eight required areas and is faithful to the repo (proposed-only editability, terminal confirmed/dismissed,
  confirm-reads-current-payload, the three existing docket audit kinds, in-place update pattern), the audit
  strategy (`DOCKET_ENTRY_REVISED` update/docket_entry/reasonRequired:false + hash-based) is proportionate,
  and the renderer label belongs in DPE2 (the shipped sync test requires exact coverage). Three
  clarifications:
  - Medium: `source_rule_citation` is immutable but flows to the confirmed deadline → state the operational
    consequence (a wrong legal source is corrected by dismiss+recreate, not edit). Folded into §4.
  - Low: `updateDocketEntryRow` updates only confirmation_state/confirmed_deadline_id/payload_json, not the
    lifted `proposed_kind` → DPE3 extends it / adds an edit-specific UPDATE + tests lifted↔payload consistency.
    Folded into §7.
  - Low: date_only edit/confirm ambiguity → the v1 date_only-confirm ban is unchanged; a date_only entry stays
    confirm-blocked until upgraded to datetime+timezone; DPE5 must not present "edit then confirm" as valid.
    Folded into §3.
- `review-plan-mq5d5myz-97vr9b` (confirm): **READY / ACCEPT — no remaining findings.**

## Confirmations
- Queue-lint PASSED (1 ASSET WI; no deps).
- Allowed = docs/adr/docket-proposal-edit.md (+ governance artifacts). Forbidden = docs/contracts/**,
  services/**, apps/**, .claude/**, scripts/workflow/**, dev-memo/run/**.
- No forbidden-path intersection with `dev-memo/run/forbidden-paths.txt`.
- ADR is docs-only; the broker review-plan satisfied the security-boundary gate. Implementation is
  explicitly deferred to the downstream governed WIs (DPE2 contract-first / DPE3 persistence / DPE4 IPC /
  DPE5 UI).
- Governance follows the documented rule: mark-reviewed + govern STANDALONE (a single Bash call, NOT bundled
  with the dependent git commit — `batch-commit-guard` checks the pre-refresh governed hash), content-bind
  verified, THEN commit in a SEPARATE Bash call.
