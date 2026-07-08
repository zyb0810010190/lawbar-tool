# Gate 8 — Deferred-Lows Reconfirmation (gate-close triage)

**Status:** deferred-Lows reconfirmation **PASS** — all **37** open deferred findings reconfirmed **Low + Safe=YES + not an M0-product blocker**; **0 Medium-or-higher** open; 0 require escalation. **Gate 8 stays `PARTIAL`** (enriched with the reconfirmed marker — a triage is not a go-live sign-off, and the registry accrues new Lows that the next gate-close re-triages). This is **NOT** a clearance of gates 2/6/12/13/16/19/20, and is **NOT** a go-live decision. **Date:** 2026-07-07. **Author:** Claude Code (WI-RELEASE-G8-DEFERRED-LOWS-RECONFIRM-00 execution lane). **Governed by:** `dev-memo/run/queue.md` (queue.governed sha256 `1a151c5c…`, PR #212 merge `55365de`), review `dev-memo/run/reviews/queue-review-158.md`.

Read-only factual reconfirmation of `dev-memo/deferred-audit-findings.md` (analysis read-only; the only writes are this doc + the gate-8 evidence row). No Low was implemented/fixed, no finding invented, no severity changed, no wholesale rewrite. No product source/test/dependency change. `CURRENT_SCHEMA_VERSION` 12.

---

## 1. Authoritative recount
`dev-memo/deferred-audit-findings.md` (mixed-format registry) has **37 open findings** — **35** in the wide multi-row tables (the enforcement-hook + Phase-A/B SQLite series) + **2** in the newer vertical single-finding tables (`G7-DRILL-AUD-L1`, `G12-STUDY235-AUD-L1`). This **reconfirms** the gate-8 row's "37 open" snapshot. Every open finding is **Low**; a scan for open `Critical`/`High`/`Medium` returned **none** (consistent with the registry's own rule that security-adjacent above-Low findings escalate, not defer). The other vertical entries (`LINK-IPC-T1-D1`, `T2-AUD-L1`, `DESKTOP-DEPS-STALE-LOCK-01`, `LINK-IPC-T1-D2`, `LINK-UI-DESIGN-D4`, `LINK-UI-T1-D5`, `A1T6-AUD-L1`) are already `closed` with cited resolution commits.

## 2. Per-finding disposition (grouped; all still-valid carry-forward, Safe=YES, not-M0-blocker)
No open finding was found to be actually-closed-but-unmarked, duplicate-across-phase (see the ID-collision note in §4), or unsafe. All 37 are **still-valid / carry-forward**; the sub-groups + their proposed follow-up WIs:

### 2.1 Enforcement-hook defense-in-depth (workflow tooling — NOT the shipped client)
| Finding ID | What | Safe=YES basis | M0-blocker? |
|---|---|---|---|
| `BGAA/BCSA-2` | staging guards inherit the bounded command-substitution / arg-taking-wrapper limits | guard threat model is "cooperative agent + direct-write block, NOT cryptographic"; bounded, consistent with the guard suite | No (dev tooling) |
| `BCG-8` | git alias-invoked commit (`git -c alias.x=commit x`) evades subcommand detection | esoteric; user-authorized deferral (2026-05-31) | No |
| `BCG-10` | arg-taking wrapper flags (`env -u NAME`) can miss `git` | bounded unwrap only; user-authorized deferral | No |
| `BRCBW-9` | interpreter-internal writes (`awk`/`ex`/`ruby`/`python`) to a protected path aren't lexically detectable | **ESCALATED to user during WI-A** — explicitly outside the guard's stated threat model; closing it is an unbounded interpreter allow-list or a threat-model change → **user security-policy decision** | No (dev tooling; recommend accept-as-known-gap) |
Follow-up: a shared "shell-aware parsing" WI (BGAA/BCSA-2 + BCG-8/10 + BRCBW path-indirection); **BRCBW-9 needs an explicit user threat-model authorization** (not agent-fixable).

### 2.2 Desktop-client convention / coverage (behavior correct + tested)
| Finding ID | What | Safe=YES basis | M0-blocker? |
|---|---|---|---|
| `CBW-601-BARREL` | docket/fact create handlers imported directly, not via the `handlers.ts` barrel | functional + tested; convention-only; `handlers.ts` was outside the originating WIs' Allowed-files | No |
| `CBW-602-PURPOSE-ENUM` | `FACT_PURPOSES` manually re-lists the contract enum | `persistence.appendFact` applies the schema enum on write (fail-closed defense-in-depth); values currently match | No |
| `AT1-L2` | no Electron-level smoke asserting `BrowserWindow` does not open after a FileVault `block` verdict | `decideAction` matrix + code ordering are correct + tested; the gap is a pin-with-test, not a behavior gap; needs an env flag to force-block or CI gating | No |
Follow-up: a barrel-reconciliation WI + an enum-parity/contract-constants WI + a Tier-1/CI FileVault block-smoke WI.

### 2.3 Phase A/B SQLite — LOC / cleanup / perf debt (structural, non-behavioral)
`D2#1`/`D2#2`/`D4#1`/`D4#2` across B6–B11, `D1#2`, `D2#1`, `D4#1`/`D4#2` (Phase A) + `F2.1`, `F3.1`, `F3.2`, `F4.2`, `F5.1`/`F5.2`/`F5.3`, `FACTS-AUD-2`. All are cleanup-only / LOC-under-cap / perf-if-measured / cross-tenant-defense-in-depth-noted — every one `cleanup-accepted (no follow-up planned)` or `re-evaluate at Phase C / if the class grows`. **Safe=YES** (no behavioral/security/correctness impact; the SQLite conformance suite is green — see gate 2 / gate 5). **Not M0-blockers.**

### 2.4 Release-doc precision residuals (documentary)
| Finding ID | What | Safe=YES basis | M0-blocker? |
|---|---|---|---|
| `G7-DRILL-AUD-L1` | the gate-7 crash-recovery drill doc's "no torn write" PASS wording vs its disclosed `wal=0`-at-kill caveat | wording narrowing on an already-disclosed residual (R-DRILL-2); does not touch gate-7 clearance | No |
| `G12-STUDY235-AUD-L1` | study-235's STOP-AND-ASK gate framing "(4/11/21) + 17 if legal" vs the flat "4/11/17/21" | gate 17 is user-owned in every artifact; a framing nit in a closed batch's study doc | No |
Follow-up: optional future doc-precision WIs (non-functional).

## 3. Reconfirmation result
**PASS.** Every one of the 37 open deferred findings is reconfirmed **Low + Safe=YES + NOT an M0-product blocker**: they are workflow-tooling defense-in-depth gaps (some user-authorized-deferred, one — BRCBW-9 — a user threat-model decision), desktop-client convention/coverage (behavior correct + tested), Phase-A/B SQLite LOC/cleanup/perf debt (non-behavioral), and release-doc precision nits. **None is a court-facing correctness or security defect in the shipped v1 Mac client.** 0 findings **newly** required STOP-and-escalate (BRCBW-9 was already escalated to the user at its origin and remains a **standing** user security-policy decision, not a newly-surfaced M0 blocker). No registry `Status` update was required — no open row was found to be demonstrably-closed-but-unmarked.

## 4. Notes
- **ID-collision caveat (greppability):** the per-phase finding IDs `F3.2` and `F4.2` recur across the Phase A2/A3/A4 registry sections (same auditor-label reused per phase, different contexts) — these are NOT duplicates to merge; they are distinct per-phase findings. Recorded so a future grep does not mistake them for one row.
- **Registry writes made:** none (Status-field-only updates were authorized but no demonstrably-closed open row was found).

## 5. How the result feeds gate 8 without clearing unrelated gates
A PASS supplies the "each Safe=YES re-confirmed; none are M0-product blockers" evidence. Per the governed WI, **gate 8 MUST remain `PARTIAL`** — the row is enriched with a `[Δ] deferred-Lows reconfirmed: 37 open, all Safe=YES, 0 M0-blockers` marker (roll-up bucket unchanged); a `PARTIAL → CLEARED` move is NOT made here (it belongs to a separate holistic readiness-refresh WI, and the registry keeps accruing new Lows). This reconfirmation does **NOT** clear gates **2/6/12/13/16/19/20** or imply any cleared; **gate 6** (the full-project audit) consumes this registry later; go-live independence is kept (the final GO/NO-GO + the STOP-AND-ASK hard-stops 4/11/17/21 remain the user's).

## 6. Residual risks / follow-up (separate future WIs — not opened here)
- **Shell-aware-parsing WI** (BGAA/BCSA-2 + BCG-8/10 + BRCBW path-indirection) — bounded workflow-guard hardening.
- **BRCBW-9 user threat-model decision** — accept-as-known-gap (recommended) OR an unbounded-interpreter-deny security-policy change (user-authorization required).
- **Barrel-reconciliation WI** (CBW-601-BARREL) + **enum-parity/contract-constants WI** (CBW-602-PURPOSE-ENUM) + **FileVault block-smoke WI** (AT1-L2).
- **Optional doc-precision WIs** (G7-DRILL-AUD-L1, G12-STUDY235-AUD-L1).
- The reconfirmation is a **snapshot**; new Lows accrue and the next gate-close re-triages. None of the above is an M0-product blocker.
