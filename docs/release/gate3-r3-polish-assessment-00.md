# Gate 3 — R3 Error / Empty-State Polish Assessment

**Status:** R3 assessment **COMPLETE** — decision outcome **(b) `R3 non-M0 / deferred with evidence`**. A read-only inspection of the 11 v1 Mac-client renderer screens found **no M0-blocking error/empty-state defect** (no crash-on-empty, no white-screening unhandled rejection on the happy path, no silent loss of lawyer-entered input). R3 reduces to **bounded post-v1 polish** (a transport-error-`catch` inconsistency on 3 list-load paths + cosmetic copy/i18n consistency), documented as a residual. This **CONFIRMS** the gate-3 doc's prior ("none is an M0 correctness blocker"). **Gate 3 stays `PARTIAL`** and remains at-least-partially blocked by **gate 4** (R1 signing/distribution, user-owned). This is **NOT** a gate-3 clearance, **NOT** a gate-4 decision, **NOT** a gate-6 run, and **NOT** a go-live decision. **Date:** 2026-07-08. **Author:** Claude Code (WI-RELEASE-G3-R3-POLISH-ASSESS-00 execution lane). **Governed by:** `dev-memo/run/queue.md` (queue.governed sha256 `a515ee2a…`, amended rev 1, PR #224 merge `e3cbd51`), review `dev-memo/run/reviews/queue-review-169.md`.

Read-only inspection of the renderer screens + the gate-3 docs; **no UI/source/test edited.** No product change. `CURRENT_SCHEMA_VERSION` 12.

---

## 1. Gate-3 source documents inspected
- `docs/release/gate3-client-release-readiness-00.md` §2 (the R1/R2/R3 residual table — R3's "bounded polish items … no single blocker identified … none is an M0 correctness blocker" characterisation) + §3 (the R2 overdue-surfacing gap).
- `docs/release/go-live-readiness-report.md` §1 gate-3 row (PARTIAL; the R1/R2/R3 disposition + the R2-shipped record) + gate-4 row (STOP-AND-ASK).

## 2. Inspection surface (READ-ONLY) — the exact files
The **11 renderer screens** under `apps/lawbar-desktop/renderer/screens/`, plus the shared renderer infrastructure they depend on (the IPC envelope type in `renderer/types.ts`, the router `renderer/index.ts`, and each screen's shared error/empty helpers). **`auditEventLabels.ts` is a label map, NOT a screen** (a renderer-only `event_kind`→human-label lookup; no error/empty-state surface) — inspected only as context, excluded from the screen assessment.

**Shared pattern (the design baseline):** every IPC call returns an `IpcEnvelope<T>` (`renderer/types.ts` ~220-229) = `{ok:true,value}` | `{ok:false,error}`. The **designed error path** is the `{ok:false}` envelope, which every screen surfaces via a `role="alert"` error node. A raw transport-layer *throw* (the envelope never resolving) is the rare, off-design path.

## 3. Error-state criteria
"Product-grade error handling" = an IPC/async failure surfaces a **visible, non-crashing** error (a `role="alert"` message region), does not silently swallow a failure, and — critically for write paths — does not leave lawyer-entered input lost without feedback. Consistency of the error surface across screens is a secondary (cosmetic) axis.

## 4. Empty-state criteria
"Product-grade empty-state" = an empty data set (no matters / deadlines / documents / facts / links / docket proposals / catalog rows / audit events) renders a **clear empty-state message**, not a blank or broken surface.

## 5. What counts as M0-blocking vs post-v1
- **M0-blocking (ONLY these):** a screen **crashes on empty data**; an **unhandled rejection white-screens** the app on a normal workflow; a **silent IPC failure loses lawyer-entered input** with no feedback; a core day-one workflow is unusable.
- **Post-v1 (polish):** transport-throw resilience niceties on read/list paths that degrade to a *stuck loading state* (not a crash/loss); inconsistent toast wording/styling; plainer empty-state copy; incomplete i18n parity.

## 6. Per-screen evidence (all 11 screens)
| # | Screen | Error-state | Empty-state | M0 gap? |
|---|---|---|---|---|
| 1 | `listMatters.ts` | `!env.ok` → `renderError()` `role="alert"` `list-error` | `rows.length===0` → `renderEmpty()` (context copy) | No |
| 2 | `createMatter.ts` | `!env.ok` → `formError` `role="alert"` + a11y announce | N/A (form) | No |
| 3 | `archiveMatter.ts` | `!env.ok` → `renderEnvelopeError()`; submit errors → `formError` | `value===null` → `renderNotFound()`; "already archived" guard | No |
| 4 | `viewMatter.ts` | `!env.ok` → `renderEnvelopeError()` `role="alert"` | `value===null` → `renderNotFound()` | No |
| 5 | `viewMatterAudit.ts` | `!env.ok` → `role="alert"` `view-chain-error` | `head===null \|\| count===0` → empty message | **transport-catch gap** (read; §7) |
| 6 | `viewMatterDeadlines.ts` | `!env.ok` → `role="alert"`; pagination-guard alert; add/confirm errors → inline `role="alert"` | `total===0` → "No deadlines recorded" | No |
| 7 | `viewMatterDocketProposals.ts` | `!env.ok` → `role="alert"`; repeated-cursor guard | `total===0` → section hidden | **transport-catch gap** (read; §7) |
| 8 | `viewMatterDocuments.ts` | `!env.ok` → `role="alert"` `view-docs-error`; add-doc errors → `role="alert"` | `total===0` → "No documents in this matter yet." | **transport-catch gap** (read; §7) |
| 9 | `viewMatterFacts.ts` | `!env.ok` → `role="alert"`; **add-fact write path has full try/catch/finally** → `showError("Could not add the fact. Please try again.")` + re-enables button | `total===0` → "No facts recorded" | No |
| 10 | `viewMatterLinks.ts` | list load wrapped in **explicit try/catch** (envelope AND transport) → `role="alert"`; `!env.ok` alert | `rows.length===0` → empty message | No (exemplar) |
| 11 | `viewMatterT3Catalog.ts` | `!env.ok` → `role="alert"`; export errors → try/catch alert | `rows.length===0` → empty message | No |

**Independently spot-verified (this lane):** (a) the write path `viewMatterFacts.ts` `createFact` has `try { … !env.ok → showError } catch { showError("Could not add the fact…") } finally { re-enable }` — lawyer input is protected against BOTH envelope errors AND transport throws (no silent-input-loss). (b) `viewMatterDocuments.ts` `loadPage()` handles the envelope error (`view-docs-error` alert) + empty state (`view-docs-empty`), and only the rare transport *throw* lacks a `catch` (a `try/finally` without `catch`) → degrades to a stuck loading state, not a crash/white-screen/loss.

## 7. Classification + the one residual
**No M0-blocking defect.** Every screen surfaces the designed envelope-error path (`role="alert"`) and renders a clear empty state; the write paths that carry lawyer input (create matter, add fact, add document, add/confirm deadline) additionally catch transport throws. There is **no crash-on-empty, no white-screening unhandled rejection on a normal workflow, and no silent loss of lawyer input**.

**Residual (post-v1 polish, non-M0):** three **read/list** loads — `viewMatterAudit.ts`, `viewMatterDocuments.ts`, `viewMatterDocketProposals.ts` — call their list IPC inside a `try/finally` (or bare `await`) **without a `catch`**, so a rare transport-layer throw (the envelope never resolving) would surface as an unhandled rejection and leave the section on a **stuck loading state** (no crash, no data corruption, no input loss — these are read paths). The exemplar fix already exists in `viewMatterLinks.ts` (an explicit `try/catch` around the list load). Plus cosmetic consistency: empty-state copy tone varies; some screens i18n error strings, others use hardcoded English. These are **post-v1 polish**, tracked as a follow-up (§10).

## 8. R1 (gate-4-blocked) + R2 (shipped, not re-litigated)
- **R1** — signing / notarization / public-distribution / release-posture is a **gate-4 STOP-AND-ASK user decision**, NOT touched by this assessment. Gate 3's release posture stays at-least-partially blocked by gate 4 regardless of the R3 outcome.
- **R2** — the global overdue-deadline dashboard banner is **SHIPPED** (WI-GATE3-R2-OVERDUE-DASHBOARD-BANNER-00, per the readiness-report gate-3 row) and is **not re-assessed** here. The `gate3-client-release-readiness-00.md` §2 R2 row ("separate Type: UI WI") is a pre-ship snapshot — a documentation-lag reconciliation, not a finding.

## 9. Decision outcome
**(b) `R3 non-M0 / deferred with evidence`.** No R3 implementation WI is required before gate 6; R3 is a documented post-v1 residual. **Gate 6 may be prepared next** (a separate user-directed lane — this assessment does NOT start it and does NOT auto-authorize it). **Gate 3 stays `PARTIAL`**, still gate-4-blocked (R1). Not outcome (a) (no M0-blocking defect found) and not outcome (c) (the per-screen evidence supports a confident classification).

## 10. Residual / follow-up (separate post-v1 WIs — not opened here)
- **R3-FUP-1 (post-v1, `Type: UI`, design-artifact-gated if it changes UI):** add a transport-error `catch` to the three list loads (`viewMatterAudit`/`viewMatterDocuments`/`viewMatterDocketProposals` `loadPage`), matching the `viewMatterLinks` exemplar, so a transport throw shows a `role="alert"` instead of a stuck spinner. Non-M0 resilience polish.
- **R3-FUP-2 (post-v1):** standardise error/empty-state copy + complete i18n parity across screens.
- Optional defensive: a global `unhandledrejection` handler as belt-and-suspenders.
- Gate 3's `PARTIAL → CLEARED` move belongs to a holistic readiness refresh, and stays gated on the gate-4 (R1) user decision.

**Go-live independence:** an R3 assessment does **not** imply go-live. The final GO/NO-GO + the STOP-AND-ASK hard-stops (gate 4 signing/distribution; gate 11 律师法; gate 17 license/business; gate 21 final sign-off) remain the user's.
