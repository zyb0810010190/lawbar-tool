# Gate-7 Robustness Policy (v1 local-first) — DECISION SURFACE, NOT A CLEAR

> **Status: POLICY AUTHORED — gate 7 remains NOT CLEARED.** This document converts M0
> go-live **gate 7** (`docs/release/go-live-readiness-report.md` §1 gate 7 = "Mutation-test /
> robustness policy", previously OPEN/undecided) from an ambiguous blocker into an explicit,
> reviewable **v1 local-first robustness policy** with named closure criteria. It **RECOMMENDS**
> a v1 posture and **SURFACES** the load-bearing risk-acceptance as a **USER decision**. It does
> **NOT** unilaterally clear gate 7, does **NOT** run the gate-6 full-project audit, implements
> **NO** robustness / mutation / fuzz / crash-injection code, and asserts **NO** final GO / NO-GO.
> Produced by `WI-RELEASE-G7-ROBUSTNESS-POLICY-00` (Type: EVIDENCE, release-governance MEDIUM).

## 0. Scope + framing

- **Product posture** (`.claude/rules/client-local-first.md`, brief §4): v1 is a **macOS-only,
  local-first, offline-first, single-lawyer** case-prep tool. Data lives at
  `~/Library/Application Support/lawbar/` (`case-box.sqlite` + `audit-log.sqlite` +
  content-hash-addressed `blobs/`). No cloud, no sync, no multi-tenant runtime, no telemetry,
  crash reporting OFF by default.
- **Therefore the robustness bar is "a lawyer's local case data survives a crash and is
  recoverable, and the audit chain stays intact" — NOT distributed-system fault tolerance.**
  There is no network partition, no replica divergence, no consensus surface in v1. Robustness =
  crash-safety + local recovery + audit-chain integrity + a stable, fail-closed error surface.
- **This is not a go-live gate.** Per `.claude/rules/security-boundary.md` §"Go-live
  independence" and blueprint §1 gate 21, authoring a gate policy does not imply readiness; the
  final GO / NO-GO verdict and the three STOP-AND-ASK hard-stops (gates 4/11/21) remain the
  user's.

## 1. v1 robustness properties + existing evidence

| Property | Mechanism (v1) | Existing evidence |
|---|---|---|
| Atomic writes | `better-sqlite3` transactions; WAL journal + `synchronous` durability posture | persistence conformance + hardening + impl-parity suites (contract 455/0, persistence 573+273+288/0) |
| Audit-chain integrity | append-only hash-chained `audit-log.sqlite`; `event_count == COUNT(*) == MAX(sequence)` invariant | `auditChain.ts`; case-box-step-4-audit-log-shape ADR; gate 12 (PARTIAL) |
| Startup integrity check | schema integrity check + audit-chain verification on startup (brief §14) | brief §14; gate 1 CLEARED (`CURRENT_SCHEMA_VERSION=12`) |
| Fail-closed error surface | stable `CaseBoxPersistenceError` / `OcrQueueError` codes; `not_implemented` FAILS; tenant/matter guards; response-projection strips server-authority fields | AGENTS.md §"Critical invariants"; gate 10 CLEARED-pending; gate 9 CLEARED |
| Graceful shutdown | ocr-worker SIGINT/SIGTERM handlers armed + stderr readiness marker | gate 5 CLEARED (`audit-mr7f42oq-jaqa51`) |
| Backup / recovery | backup-as-directory over the data dir; macOS Time Machine; "drop directory back, run integrity check" | brief §14; gates 14/15 (OPEN/PARTIAL) |

## 2. Closure criteria (what gate 7 must prove before it can clear)

Gate 7 clears (or partially clears) only when each criterion below is met **and** the user
accepts the residual risk in §4.

1. **Crash / data-loss tolerance.** A crash (`kill -9` / power loss) mid-write MUST NOT corrupt
   `case-box.sqlite`, `audit-log.sqlite`, or the blob store. Acceptance bar: an in-flight
   transaction rolls back atomically (WAL + `synchronous`); no partial-write / torn-page
   corruption; the startup schema-integrity check + audit-chain verification pass after an
   uncleanly-killed process is restarted.
2. **Local-first persistence / recovery.** The backup-as-directory model (brief §14) MUST
   support a recovery drill: restore the data directory (Time Machine or a manual copy), start
   the app, and have the startup integrity check + audit-chain verification pass with all matters
   / documents / audit events intact. Acceptance bar: a documented recovery drill that
   round-trips the three-file manifest without data loss (overlaps gates 14/15).
3. **Offline / online reconciliation = N/A for v1.** v1 is fully offline (no cloud sync, no
   replica). There is no reconciliation surface, so reconciliation is **explicitly out of scope**
   and is **not a gate-7 blocker**. (If a sync surface is ever added post-v1, this criterion
   re-opens as a separate gate.)
4. **Audit / event integrity under failure.** The hash-chained audit log's tamper-evidence and
   the `event_count == COUNT(*) == MAX(sequence)` invariant MUST hold across a crash/restart.
   Acceptance bar: the invariant is verified after an unclean restart (overlaps gate 12).
5. **Failure-mode handling.** The stable error-code surface MUST remain fail-closed:
   `CaseBoxPersistenceError` / `OcrQueueError` codes are stable (no rename without an ADR),
   `not_implemented` FAILS (never silently passes), tenant/matter guards reject cross-scope
   access, and the ocr-worker shuts down gracefully. Acceptance bar: no code path degrades a
   failure into a silent success; no fail-open.
6. **Sufficient evidence to clear / partially clear.** Gate 7 needs a DECISION on whether v1's
   existing deterministic evidence (conformance + hardening + impl-parity suites + the
   audit-chain invariants + the crash-safety posture) is sufficient to accept v1 **without**
   mutation testing, **plus** a documented crash-recovery drill — OR whether a bounded
   mutation / fuzz sweep on the critical modules is required first. Either way the residual is
   recorded and the risk-acceptance is the user's (§4).

## 3. Recommended v1 policy (recommendation only — not a clear)

For a manual-truth, local-first, offline, single-lawyer v1, this policy **RECOMMENDS**:

- **Accept v1 WITHOUT mutation testing.** Rationale (the specific mechanism, per first
  principles): mutation testing measures test-suite sensitivity to injected code faults; its
  value is highest where behavior is broad and under-specified. v1's critical modules
  (persistence, audit chain, tenant/matter guards) are already covered by **deterministic
  conformance + hardening + impl-parity suites** that assert exact error codes, exact invariants
  (`event_count == COUNT == MAX(sequence)`), and exact projection boundaries — i.e. the suites
  already pin behavior tightly. Mutation testing would add marginal assurance at the cost of a
  new dev dependency + harness (a hard-stop: new runtime/dev dependency). Defer it post-v1.
- **REQUIRE a documented crash-recovery drill as the gate-7 closure deliverable** (a separate
  future WI): a scripted `kill -9` (or simulated power loss) mid-write + restart + startup
  integrity check + audit-chain verification + a data-directory restore round-trip. This is the
  cheap, high-value evidence that directly exercises criteria 1/2/4 — and it overlaps gates
  14/15, so one drill closes robustness evidence for three gates.
- **Defer a bounded mutation / fuzz sweep to post-v1** as an optional hardening WI (not
  M0-blocking), scoped to the persistence + audit-chain modules if ever pursued.

**This is a recommendation. It is NOT a decision to ship, and NOT a clear of gate 7.**

## 4. User-owned risk-acceptance decision points (STOP-AND-ASK)

Gate 7 cannot clear until the user explicitly decides:

- **D-G7-1 — Accept v1 without mutation testing?** YES → gate 7's mutation-testing requirement is
  waived for v1 (mutation/fuzz deferred post-v1). NO → a bounded mutation/fuzz sweep WI becomes
  an M0 blocker before gate 7 can clear. *Recommended: YES (per §3), but this is the user's
  risk-acceptance to own — it is not decided here.*
- **D-G7-2 — Is a documented crash-recovery drill required before gate 7 clears?** *Recommended:
  YES (per §3) — it is the load-bearing closure evidence for criteria 1/2/4.* The drill itself is
  a **separate future WI**; it is NOT run in this policy lane.

Until D-G7-1 and D-G7-2 are answered and the crash-recovery drill (if required) is run and
passes, **gate 7 remains NOT CLEARED**.

## 5. Dependencies (mapped, NOT cleared by this policy)

- **Gate 6** (full-project cc-suite audit — OPEN): a robustness lens belongs in that sweep; this
  policy informs it but does not run it.
- **Gate 12** (tamper-evidence / audit-chain integrity — PARTIAL): overlaps closure-criterion 4.
- **Gate 14** (backup + recovery procedure — OPEN): the recovery drill in criterion 2 is the
  shared deliverable.
- **Gate 15** (rollback procedure tested — PARTIAL): the crash-recovery drill overlaps.
- **Gate 5** (all package tests pass — CLEARED): the existing deterministic suites are the
  baseline evidence this policy leans on.

None of these gates is cleared by this document.

## 6. Verdict

Gate 7 is now **policy-authored with explicit closure criteria**, but **remains NOT CLEARED**:
its clear is **BLOCKED on the user risk-acceptance decisions (D-G7-1, D-G7-2)** and, if required,
a documented crash-recovery drill (a separate future WI). This policy makes **no final
GO / NO-GO** and resolves **no** STOP-AND-ASK gate. The final go-live verdict (gate 21) and the
three user hard-stops (gates 4/11/21) remain the user's.
