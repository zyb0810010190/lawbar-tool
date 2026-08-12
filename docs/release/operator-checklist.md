# Operator Checklist — lawbar v1 (macOS desktop, local-first)

**Status:** completed for the v1 Mac-client surface (WI-RELEASE-G13-OPERATOR-CHECKLIST-RUNBOOK-00 execution). Supersedes the prior `scaffold` state. The OCR-worker *service* operator sections that the original scaffold anticipated (node-version / dependency-audit / production-config-preflight / fail-closed-probes / queue+persistence checks) are reconciled as **post-v1 / deferred** below — the OCR worker is **not wired into the v1 Mac desktop client**, so those service-operator checks are not part of the v1 day-one operator surface. **Date:** 2026-07-07.

This checklist is operator-facing evidence for **gate 13** of `docs/release/go-live-readiness-report.md`. It does **not** clear gate 13 (it stays `OPEN`) and does **not** clear any referenced gate; the gate 14/15/2/20 references below are **references, not clearances**.

---

## 1. v1 Mac-client operator section

The v1 product is a **macOS desktop application**, single lawyer at a time, **local-first / offline-first** (`.claude/rules/client-local-first.md`). There is no server to operate, no account to provision, no network endpoint to expose.

**Install / launch**
- Ship + launch the `lawbar` desktop app (app display name `lawbar`; `app.setName("lawbar")` — `apps/lawbar-desktop/electron/main.ts`).
- **FileVault gate (production):** production launch requires macOS FileVault to be enabled. `main.ts` runs a FileVault probe at startup; in production a disabled FileVault state **blocks launch**, and in dev mode (`LAWBAR_MODE=dev`) it emits a `[lawbar:fileVault] WARNING … Production launch would block.` and proceeds. Operator action: confirm FileVault is ON before a production launch.
- No sign-in, no cloud account. (Auth provider is a user STOP-AND-ASK decision, gate 17 — not shipped in v1.)

**Where case data lives (verified against shipped source)**
- macOS user-data directory: `~/Library/Application Support/lawbar/` (`app.getPath("userData")`, product name `lawbar` — `main.ts`).
- `case-box.sqlite` — the single case-box database (audit tables live **inside** this one file; `CASE_BOX_DB_FILENAME` — `apps/lawbar-desktop/src/caseBox/caseBoxRuntime.ts`).
- `case-box-documents/` — the app-controlled document blob directory beside the DB (`documentStorageRoot` — `main.ts`).
- `theme-preference.json` — UI theme preference (`apps/lawbar-desktop/src/persistence/themePreference.ts`).

**First run**
- On first launch the app creates `~/Library/Application Support/lawbar/` and initialises `case-box.sqlite`. No external migration, no network fetch.

**Normal operation**
- Work matters, documents, facts, and evidence locally. Document files are added through a **main-process file chooser**; the renderer never supplies a filesystem path (`dialog.showOpenDialog`, single-file `openFile` — `main.ts`), so the operator selects files through the OS dialog only.
- Data does not leave the Mac unless the operator takes a deliberate export/backup action (see §3).

**Quit / restart**
- Quit normally (⌘Q). SQLite runs in WAL mode; a clean quit flushes the WAL. On restart the app reopens the same `case-box.sqlite`. Crash-recovery of an abrupt process-kill is drill-verified — see the gate-7 crash-recovery drill (`docs/release/gate7-crash-recovery-drill-00.md`).

**Offline / local-first operating assumption**
- v1 runs fully offline. There is no telemetry and crash reporting is OFF by default — verified in §4. The **intended** production posture (not a certified shipped fact here) is an App-Sandbox build with **no network entitlement** (OS-enforced offline); that entitlement is confirmed at gate 4 (signing/distribution — user STOP-AND-ASK), not by this checklist.

## 2. Case-box local-first operating procedures

- **Single-user, local-first.** One lawyer, one Mac, one `case-box.sqlite`. `tenant_id` is retained in the schema for forward compatibility only — v1 is **not** multi-firm SaaS.
- **Opening / working a matter.** Matters, documents, facts, evidence, and the audit chain all persist in the one `case-box.sqlite`; document blobs in `case-box-documents/`.
- **No cloud / no sync by default.** Cloud or sync is **opt-in per document / per matter / per explicit action**, and is **post-v1** — no cloud sync ships in v1 day-one.
- **Deliberate-action invariant.** Lawyer documents do not leave the Mac unless the operator explicitly exports or backs up. Preserve this invariant in any operating procedure.

## 3. Backup, recovery, and rollback references

These sections are completed by **reference** to the already-landed evidence. Each reference is a pointer, **not** a clearance of the referenced gate.

- **Backup + recovery (references gate 14, NOT cleared).** The authoritative operator backup + recovery procedure is `docs/release/gate14-backup-recovery-00.md` — backup-as-directory (with the WAL-sidecar caveat), drop-directory restore, `PRAGMA integrity_check`, and the audit-chain `event_count == COUNT(*) == MAX(sequence)` verification. Gate 14 remains **OPEN**.
- **Rollback (references gate 15, NOT cleared).** The committed-rollback procedure is `docs/release/gate15-rollback-dry-run-00.md` + `dev-memo/rollback-00.md` (`git revert`, **never** `git reset --hard`; dry-run PASS on a disposable scratch commit with `main` proven unmutated). This completes the scaffold's former "Rollback Procedure" section by pointing at that evidence. Gate 15 remains **PARTIAL**.

## 4. OCR + telemetry operating references

- **OCR operational behavior (references gate 2, NOT cleared).** OCR pipeline behavior is verified by `docs/release/gate2-ocr-pipeline-verify-00.md` (per-package test sweep 771 pass / 0 fail / 3 env-gated skip across `services/ocr-{worker,persistence,ingestion,review}`). **Reconciliation (see §6):** the OCR worker is **not wired into the v1 Mac desktop client**, and the real-PaddleOCR engine path is model-gated / post-v1 (gate-2 residual R-G2-3). The OCR *service* operating profile is therefore **post-v1 / deferred** (see the runbook `docs/release/ocr-worker-runbook.md`). Gate 2 remains **PARTIAL**.
- **Telemetry / crash reporting (references gate 20, NOT cleared).** The operating posture — **no telemetry; crash reporting OFF by default; no external egress** — is verified by `docs/release/gate20-telemetry-crash-reporting-verify-00.md`. Gate 20 remains **PARTIAL**.

## 5. Reconciled scaffold sections — post-v1 / deferred (OCR-service operator)

The original scaffold anticipated an OCR-worker **service** operator surface. Because the OCR worker is **not part of the v1 Mac-client day-one surface** (not wired into `apps/lawbar-desktop/`; verified — no OCR import in the desktop app), these checks are **post-v1 / deferred**, not v1 operator steps. They are retained here as labelled deferrals, not silently dropped (audit trail per `.claude/rules/client-local-first.md` §"Reconciliation duty"):

- **Node version check** — `post-v1 / deferred` (a service-runtime concern; the packaged Mac app bundles its own runtime). The build/runtime pin (Node 22+) is a developer/CI concern, not a v1 operator step.
- **Dependency audit** (`npm audit --omit=dev`) — `post-v1 / deferred` here; supply-chain auditing is **gate 19** (a separate lane), not this operator checklist.
- **Production config preflight / fail-closed probes** (`OCR_WORKER_REQUIRE_REAL`, `OCR_WORKER=fake`, production profile) — `post-v1 / deferred`; these are OCR-service env-profile checks (see the runbook §"post-v1 server-mode"), not v1 Mac-client operation.
- **Queue + persistence checks** (OCR queue rows, orphaned pending-retry) — `post-v1 / deferred`; these are OCR-service persistence checks. The v1 Mac client's own persistence integrity is covered by the gate-14 recovery verification + the gate-12 tamper-evidence drill.
- **Commit / diff-hash evidence + audit checks** — **RECONCILIATION-NEEDED (2026-08-12).** This was
  previously marked "no separate operator action" because per-WI review artifacts lived under
  `dev-memo/run/reviews/`. That tree was deleted on 2026-08-10; the artifacts remain recoverable from
  git history at `49dd7ad^` but are not in the working tree. `dev-memo/batch-closeout-log.md` does still
  exist. Until an evidence location is re-established, treat this as an **explicit operator action**:
  record the commit range and diff hashes for the release yourself. Do not mark it satisfied by a
  workflow that no longer runs.

## 6. Reconciliation note (RECONCILIATION-NEEDED)

**RECONCILIATION-NEEDED (logged here + in the exec commit message + in the exec review artifact).** The stale OCR-worker *service* framing carried by this checklist's original scaffold (and by `ocr-worker-runbook.md`) predates the locked v1 posture. **What was stale:** an OCR-worker service operator surface (production env profile, dependency-audit-as-operator-step, OCR queue/persistence checks). **Why deferred:** the OCR worker is not wired into the v1 Mac desktop client, and per `.claude/rules/client-local-first.md` the OCR worker — when integrated — is an **in-process / local-loopback** transport for the Mac client, **not** a public/deployed service. The service-mode content is labelled `post-v1 / deferred` above, not rewritten to erase the prior posture. A future ADR / reconciliation WI owns any decision to change the locked direction; this checklist does not decide it.

## 7. Gate-13 completion checklist (what must be present before gate 13 can move)

A future **holistic readiness-refresh WI** (not this lane) may move gate 13 out of `OPEN`. The auditable "gate 13 ready to move" condition is:

- [x] v1 Mac-client operator section present (§1).
- [x] Case-box local-first operating procedures present (§2).
- [x] Gate 14 (backup/recovery) + gate 15 (rollback) references present, not clearing those gates (§3).
- [x] Gate 2 (OCR) + gate 20 (telemetry) references present, not clearing those gates (§4).
- [x] Stale OCR-service framing reconciled — labelled `post-v1 / deferred` with a RECONCILIATION-NEEDED audit trail (§5, §6).
- [x] No dangling `_To be filled_` placeholder in a v1-relevant section.
- [ ] **(readiness-refresh WI, not this lane)** roll-up bucket move OPEN → PARTIAL/CLEARED, evaluated together with the other OPEN/PARTIAL gates and the STOP-AND-ASK gates (4/11/17/21).

## 8. Residual / post-v1 follow-ups

- The OCR-service reconciliation (§6) may need a follow-up ADR / reconciliation WI when/if OCR is wired into the client (post-v1).
- A full illustrated operator manual (screenshots, step-by-step recovery walk-throughs) is post-v1.
- Gate 13's roll-up move belongs to the holistic readiness refresh.

**Go-live independence:** a completed operator checklist does **not** imply go-live. The final GO/NO-GO and the STOP-AND-ASK hard-stops (gate 4 signing/distribution; gate 11 律师法; gate 17 license/business; gate 21 final sign-off) remain the user's.
