# BATCH-CASEBOX-DOCKET-PROPOSAL-EDIT-ADR-00 (proposal)

**Status**: proposal memo (untracked). The governed `dev-memo/run/queue.md` is the authority.
**Date**: 2026-06-08. **ADR-only** (Batch A, step 1 of the docket-proposal-edit feature). No
contract/persistence/IPC/UI implementation in this batch.

## Purpose
Author + govern the ADR deciding how a user edits a PENDING docket proposal before confirming, without
weakening auditability, confirmation semantics, or persistence integrity. Discovery
(`/tmp/claude-501/response.md`, 2026-06-08) mapped all five surfaces; this WI records the design as an
ADR so the downstream contract/persistence/IPC/UI WIs are governable.

## Single WI — WI-DPE1 (ASSET, ADR)
Author `docs/adr/docket-proposal-edit.md`. No source edits. The ADR decides: content-only edit of
`proposed` entries (provenance + lifecycle immutable; confirmed/dismissed terminal); the editable field
set; a new `DOCKET_ENTRY_REVISED` audit kind (action update, entity_type docket_entry,
reasonRequired false) with hash-based (not literal-value) auditability; an optional `revised_at`
payload field for an "(edited)" UI marker; no persistence migration (in-place payload_json UPDATE);
confirm-after-edit confirms the current edited proposal; and the cross-package coupling decision (the
renderer `auditEventLabels` map must gain "Docket proposal revised" when the kind lands — ADR assigns
that one line to DPE2 or defers it).

## Review
ADR governs a future contract change on the audit-chain/security boundary (a new audit-event kind) →
**broker** cc-suite review-plan required. Relates to `docs/adr/case-box-step-6-deadline-docketing-rules.md`
and `docs/adr/audit-event-kind-preservation.md`.

## Hard stops
Editing any contract/persistence/IPC/renderer/test file (ADR-only); deciding any confirmed/dismissed
mutation, provenance overwrite, ambiguous confirmation semantics, an ungoverned migration, or scope
creep into reminders/scheduling/audit-filtering/event-kind-UX/workflow-cleanup.
