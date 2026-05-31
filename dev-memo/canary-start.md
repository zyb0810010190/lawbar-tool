# Canary start note

This records the first non-UI canary run of the multi-agent autonomous-batch scaffold
described in `HANDOVER.md`.

## Location

- Branch: `workflow-scaffold-migration`
- Queue: `dev-memo/run/queue.md` (governed: lint + Codex review)
- Mode: canary batch (`AUTO_ADVANCE_MAX=3`)
- Batch start: `dev-memo/run/batch-start`

## Purpose

Prove the governed queue executes soundly on a small, low-risk, doc-only run before a full
autonomous batch. The canary touches only `dev-memo/` notes — no UI, no product source — so
the workflow itself (plan → execute → Codex audit → verify → gates → exact-path commit →
audit-trail log) can be validated without product-change risk.
