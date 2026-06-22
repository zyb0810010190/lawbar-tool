# Evidence M0 product-definition lane — closeout (EPD-CLOSEOUT-00)

**Date**: 2026-06-22. **Type**: CLOSURE (documentation only; no production code).
**Lane**: `evidence-m0-product-definition` (branch, from `main` after PR #100 merged, `6dc2526`).
**Status: lane complete.** The four product-definition docs are authored, governed, and audited. **No
Evidence product behavior, UI, real A0.7, marker, Swift/PDFKit, macOS CI, or hard hooks were built** — all
remain gated behind explicit hard-stop authorizations.

## 1. Lane summary
- **EPD0** — tracked the M0 developer handover as reference material at
  `docs/reference/evidence-genie-m0-developer-handover.md` (faithful copy; root duplicate preserved).
- **EPD1** — `dev-memo/plan-batch-casebox-evidence-product-definition-00.md` (the governed product-definition
  plan packet; 9 sections).
- **EPD2** — `docs/product/evidence-m0-prd.md` (the M0 PRD; 10 sections).
- **EPD3** — `docs/product/evidence-m0-user-flows.md` (manual evidence + hearing workflows F1–F8).
- **EPD4** — `docs/product/evidence-m0-content-inventory.md` (11 surfaces + CN↔EN terminology).
- **EPD5** — `docs/product/evidence-m0-acceptance-scenarios.md` (given/when/then acceptance, 10 scenario
  groups + traceability matrix).

## 2. Commit table
| WI | Governance | Execution | Audit closeout (study packet) |
|---|---|---|---|
| Lane open (PR #100 merge) | — | `6dc2526` | `4967023` (122) |
| EPD0 intake-disposition | `1841486` | `277e455` | `edd5508` (123) |
| EPD1 plan packet | `a82b9cf` | `4248efc` | `5af3dad` (124) |
| EPD2 PRD | `eff4435` | `c04d68c` | `d61b769` (125) |
| EPD3 user flows | `da5a243` | `33c6f5a` | `0248ffd` (126) |
| EPD4 content inventory | `3a6fdba` | `e8e9a10` | `a855bb3` (127) |
| EPD5 acceptance scenarios | `c27a077` | `0445e82` (+ fix `98cdd20`) | `b0b6b0f` (128) · `67f53fa` (129) |
| EPD-CLOSEOUT (this) | `d61519b` | (this doc) | — |

Every per-WI step passed `check-queue.sh` lint + cc-suite `/review-plan` (governed, content-bound queue
hash) and a Layer-B batch audit between every three commits (study packets 122–129, all BATCH-PASS).

## 3. Product-definition posture
- The four docs are **official product-definition content** — they define what the product should say and do.
- **They authorize no implementation.** Building Evidence behavior is gated by the engineering lanes.
- **All UI / anchor / export behavior remains gated behind A0.7.** `renderer-conformance` currently returns
  `not_implemented` (the `native/evidence-core` shim). **No A0.7 marker exists; no doc claims A0.7 is green.**

## 4. Hard-stop boundaries (require separate explicit authorization)
- **Swift / SwiftPM / PDFKit native Evidence Core** — new runtime/toolchain.
- **macOS CI** — current CI is `ubuntu-latest` only.
- **Real A0.7 renderer-conformance harness** — a separate governed lane (the first real Evidence gate).
- **A0.7 marker provenance / tamper protection** — the green marker is produced only by the real harness,
  never hand-authored.
- **Hard hooks EVW5a / EVW5b** — deferred until the real surfaces + marker provenance exist.
- **Evidence UI / product behavior** — no UI before A0.7 is green.

## 5. Remaining unresolved items
- **Root handover duplicate** `Evidence-Genie-M0-Developer-Handover.md` — still untracked; its deletion /
  disposition is a separate explicit cleanup decision (the faithful tracked copy is committed in EPD0).
- **`xiaolai-dev-workflow-study.md`** — still untracked; out of scope for this lane; disposition pending.
- **EPD docs may need future updates** after the A0.7 feasibility lane resolves geometry-source stability
  (class-1 vs class-2) and the real harness exists.
- **EVW9** (tdd-guardian teeth + cross-model stop-review gate) — still pending, after the hard hooks.

## 6. Process lesson from EPD5
- The **EPD5 first commit (`0445e82`) omitted 原告 / 被告 / 法院**, which the WI-EPD5 acceptance required (the
  eight key CN legal terms); the doc had used English "party". I committed it despite a verification grep
  showing MISSING — a "verify-and-commit in one shell call" pattern that did not fail closed.
- The **Layer-B audit caught it as `L1`** (`audit-mqpepo1z-g1cu0x`, disclosed to the auditor). It was
  **fixed forward in `98cdd20`** (the three terms added to AS-A1 / AS-A5); EPD5-L1 is **closed**.
- **Going forward:** verification must **stop before commit** if any required grep fails; avoid
  "verify-and-commit in one call" unless the shell command is genuinely fail-closed (e.g. `grep -q ... &&
  git commit`), so a missing requirement blocks the commit rather than being printed and ignored.

## 7. PR readiness
This branch (`evidence-m0-product-definition`) is **ready for a PR after closeout verification** — the four
product-definition docs + the tracked reference + the governed plan + this closeout, internally consistent
and fully gated. It ships **no** Evidence product behavior; everything past product definition is behind the
§4 hard-stops. **No push or merge happens without explicit instruction.**
