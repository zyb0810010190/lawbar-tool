# Privacy Notice — lawbar v1 (local-only, internal use)

**Status:** internal-use v1 privacy posture (WI-RELEASE-USER-DECISION-RECORD-00). **Date:** 2026-07-08. This notice describes the v1 Mac desktop client's data handling; it is not a legal sufficiency review for any external/public release (that review is deferred — gate 11 律师法 + gate 17 external license/privacy review remain the user's).

## Data stays on your Mac
lawbar v1 is a **local-first, offline-first** macOS desktop application. Your case data does not leave your Mac unless you take a deliberate export or backup action.

- **Where data lives:** `~/Library/Application Support/lawbar/` — a single `case-box.sqlite` database (matters, documents metadata, facts, evidence, deadlines, and the tamper-evident audit chain all inside it), a `case-box-documents/` directory for document blobs, and `theme-preference.json`. (Verified against `apps/lawbar-desktop/electron/main.ts` + `src/caseBox/caseBoxRuntime.ts`.)
- **Document files** are added through a macOS file chooser; the app copies them into the app-controlled `case-box-documents/` directory.

## No telemetry, no crash reporting, no network egress
Verified by the gate-20 telemetry/crash-reporting review (`docs/release/gate20-telemetry-crash-reporting-verify-00.md`):

- **No telemetry / analytics / metrics** — no analytics SDK, no `sendBeacon`, no usage tracking.
- **No crash reporting** — Electron's `crashReporter` is not started (it is opt-in; absent = OFF), no Sentry/Bugsnag/Crashpad.
- **No auto-update / no external network calls** from the v1 client — no `autoUpdater`, no `fetch()` to external hosts.
- The intended production posture is a macOS App-Sandbox build with **no network entitlement** (OS-enforced offline); that entitlement is confirmed at gate 4 (packaging), not asserted here.

## No cloud / no sync (v1)
There is no cloud storage, no sync, no multi-tenant server, and no account in v1. Any future cloud or sync would be opt-in per document/matter and is a separate post-v1 decision (`.claude/rules/client-local-first.md`).

## Backup / export = your deliberate action
Backups (backup-as-directory) and the T3 证据目录及说明 DOCX export happen only when you initiate them (`docs/release/gate14-backup-recovery-00.md`, `gate18-export-backup-format-cert-00.md`). Where those artifacts go, and who they are shared with, is under your control.

## Scope of this notice
This notice covers the **internal-use v1 Mac client**. It is not a privacy policy for a public/distributed product. If the tool is ever distributed externally, a full privacy policy + the 律师法 confidentiality/compliance review (gate 11) + the external license/attribution review (gate 17) must be completed first — these are the user's decisions and remain pending.
