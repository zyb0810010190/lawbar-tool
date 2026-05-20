# UI Gap Report (UI-00)

**Date**: 2026-05-20
**Status**: **The entire UI is a gap. No UI code exists in this repo.**

## Summary

| Inferred surface (from `current-ui-map.md`) | Implementation status | Test status | Backend prerequisite | Classification |
|---|---|---|---|---|
| S1 Job submission | not implemented | none | HTTP API in front of `ocr-ingestion` | **defer** |
| S2 Job list | not implemented | none | HTTP API in front of `ocr-review.listOcrJobsForDocument` | **defer** |
| S3 Job detail | not implemented | none | HTTP API in front of `ocr-review.getOcrJobLifecycle` | **defer** |
| S4 Per-page review (read) | not implemented | none | HTTP API in front of `ocr-review.getReviewableOcrPage` | **defer** |
| S4-write Per-page corrections | not implemented; not even contracted | none | new persistence + contract surface for corrections — **does not exist** | **defer** (and needs design WI first) |
| S5 Manual-review worklist | not implemented | none | HTTP API in front of `ocr-review.listPagesNeedingManualReview` | **defer** |
| S6 Job cancel | not implemented | none | coordinator-mediated cancel endpoint (web_app actor) | **defer** |
| S7 Tenant / auth | not implemented; auth surface itself does not exist | none | identity provider integration | **defer** |
| Design system / theme / tokens | not implemented | n/a | n/a | **defer** |
| HTTP API gateway | not implemented; **blocker for every UI screen** | n/a | n/a | **defer** — but see below |

The classification options were keep / behavior-fix first / redesign / replace / defer. **Every surface is "defer"** because there is nothing to keep, fix, redesign, or replace. "Replace" would imply something exists to be replaced.

## Critical observation: UI work is gated on a missing backend prerequisite

Every UI screen above depends on **an HTTP / RPC gateway that does not exist in this repo today**. All five services are TypeScript library APIs — they expose functions like `getOcrJobLifecycle(job_id)`, not REST endpoints. The contract's `web_app` actor names a UI role but nothing translates that role's intent to writes.

Before any UI sub-WI (UI-01+) is buildable, one of two things must happen:

1. **An API gateway service is added** — e.g. a new `services/ocr-api/` package that wraps `ocr-ingestion`, `ocr-review`, and the coordinator's cancel surface as HTTP endpoints. This would be a major backend WI, not a UI WI.
2. **The UI runs in-process** (e.g. an Electron / Tauri app, or a Node-side rendered web app that imports the libraries directly). This avoids the gateway but adds packaging + distribution complexity and changes the tenant-scoping story.

Either path is a **multi-day backend decision** that should land before any UI-01 design work. Choosing without the gateway designed risks UI-01 being designed against a hypothetical API and then redone.

## Lesser observations

- **No design research exists.** "Lawyer-facing" is data-shape framing in the read model; no validated lawyer-user research is in this repo. UI-01 design work should start from a brief usability discovery, not from this map.
- **No internationalization.** OCR target is Chinese (`zh-Hans` per worker default), but no UI strings exist to translate. UI work should pick i18n strategy on day one.
- **No accessibility baseline.** Lawyer-facing tools serve high-volume reviewers; keyboard-navigation, screen-reader, and high-contrast support should be in-scope from day one, not retrofitted.
- **No telemetry / error-reporting integration.** A UI without instrumentation makes future audits and triage hard.
- **`ocr-review` Step 8B already covers cross-job reads.** S2 (job list) and S5 (worklist) have ready data APIs. Step 8A single-job reads cover S3 and S4. Backend coverage of the read path is good.
- **The write path is uneven.** Submission (`ocr-ingestion`) and cancel (`web_app` actor named in contract; concrete endpoint unspecified) both lack a network surface. Corrections (a likely lawyer use-case at S4) lack a contract surface entirely.

## Recommended UI-01+ starting points

This report does NOT design the UI. It identifies the order in which design / build work would be safest to schedule:

1. **Decide the gateway strategy** (HTTP API service vs in-process app). This is a backend / architecture WI, not a UI WI. Without it, the rest of the order is undefined.
2. **Spec the cancel endpoint** (the only contract-named UI write today) and its coordinator-mediated semantics. Small, well-scoped, satisfies AGENTS.md "Coordinator owns lifecycle".
3. **Scope corrections** (S4 write path) explicitly: either declare them out-of-scope for v1, or add a contract surface for them. Don't let this drift into UI implementation.
4. **Tenant / auth surface** before any read screen ships. Reading without scoping is a leak risk.
5. **UI-01a Job list (S2) — read-only, single-tenant slice.** Smallest screen that proves the gateway + read path end-to-end. Defer cancel until S2 is stable.
6. **UI-01b Job detail (S3) + per-page read (S4).** Reuses the gateway from UI-01a.
7. **UI-02 Submission (S1).** Larger because of validation surface; needs the ingestion gateway.
8. **UI-03 Cancel action (S6).** Adds the first UI write to the cancel endpoint from step 2.
9. **UI-04 Manual-review worklist (S5).** Cross-job paginated list; depends on cursor handling.
10. **UI-05 Corrections (S4 write path)** — only if step 3 declared it in-scope.

The cli.spawn-flake risk note carried in the WI-03 series is unrelated and out-of-scope for the UI track.

## What this report intentionally does NOT do

- Design any component, layout, color, or interaction.
- Pick a UI framework. The framework choice depends on the gateway decision (in-process apps prefer Electron/Tauri/web; gateway-fronted apps can be SPA or SSR).
- Pick a state-management library, a router, or a styling approach.
- Claim that UI-00 closes any user-visible gap. UI-00 is a baseline document; the lawyer-user experience is not improved by it.

## Honest caveats (also in `current-ui-map.md`)

- Every "screen" above is **inferred from contracts**, not validated with users.
- The gateway-vs-in-process decision will reshape this report. If the project picks in-process, screens collapse (no S7 auth as a separate surface, for example).
- If the project pivots away from the lawyer-review use case, large portions of S4 / S5 become wrong and should be redone.

## Files in this UI-00 deliverable

- `docs/ui/current-ui-map.md` — per-screen detail of the inferred surface
- `docs/ui/ui-state-contract.md` — derivation from backend state machine + read-model types
- `docs/ui/ui-gap-report.md` — this file
