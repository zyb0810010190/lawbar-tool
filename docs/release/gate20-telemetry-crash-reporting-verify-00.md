# Gate 20 — Telemetry / Crash-Reporting Verification (v1 Mac client)

**Status:** telemetry / crash-reporting verification **PASS** — the v1 Mac client ships **no telemetry** and **crash reporting OFF by default**. **Gate 20 stays `PARTIAL`** (enriched with the verified marker — a code verification is not a go-live sign-off, and dependent gates remain unresolved). This is **NOT** a clearance of gates 4/6/7/11/12/14/15/18/19/21, and is **NOT** a go-live decision. **Date:** 2026-07-07. **Author:** Claude Code (WI-RELEASE-G20-TELEMETRY-CRASH-REPORTING-VERIFY-00 execution lane). **Governed by:** `dev-memo/run/queue.md` (queue.governed sha256 `c904ab6b…`, PRs #207/#208), review `dev-memo/run/reviews/queue-review-154.md`.

This is a **read-only** inspection (grep + dependency listing) of the shipped client surface; it changed **no** source/test/package/config and added **no** dependency. Environment of record: macOS · git 2.53.0 · Node v24.14.0 · date 2026-07-07 · `CURRENT_SCHEMA_VERSION = 12`. Verifies the brief §4 posture (fully offline; no telemetry; crash reporting OFF by default) + `.claude/rules/evidence-genie.md` invariant 1 (App Sandbox no-network entitlement is the OS-enforced offline backstop — verified at gate-4 packaging, see §5).

---

## 1. Files / packages inspected
- Client surface: `apps/lawbar-desktop/electron/main.ts` + `apps/lawbar-desktop/electron/preload.mts` + `apps/lawbar-desktop/src/**` + `apps/lawbar-desktop/renderer/**`.
- Packaging: `apps/lawbar-desktop/package.json` + `apps/lawbar-desktop/package-lock.json` (the tracked lockfile).
- Bundled internal deps (`case-box-persistence`, `case-box-contract`) as they appear in the client (`file:dist-tarballs/*.tgz`).

## 2. Inspection results (per telemetry surface)
All greps used `grep -rniE` — recursive, **case-insensitive** (`-i`), extended-regex (`-E`) — so `Sentry`/`SENTRY`/`sentry` and similar case variants are all covered. "NO MATCHES" below means the grep produced zero lines for that pattern (excluding the disclosed CSS `--tracking-*` false positives called out in row 8).

| # | Surface | Grep pattern (case-insensitive) | Result |
|---|---|---|---|
| 1 | Electron `crashReporter` (esp. `crashReporter.start`) | `crashReporter` | **NO MATCHES** — `crashReporter` is never imported or started; Electron's crash reporter is opt-in, so **absent = crash reporting OFF by default** |
| 2 | Crash-reporting SDKs | `sentry\|bugsnag\|crashpad\|@sentry` | **NO MATCHES** |
| 3 | Analytics / metrics / telemetry **libraries** (NOT the bare word "tracking" — that standalone term is the false-positive check in row 8) | `analytics\|mixpanel\|amplitude\|posthog\|google-analytics\|gtag\|metrics\|telemetry` | **NO MATCHES** |
| 4 | Network beacons / remote logging + `fetch()` | `sendBeacon\|XMLHttpRequest\|WebSocket`; `fetch\s*\(` | **NO MATCHES** for beacons/XHR/WebSocket; **NO `fetch()` calls** in the client surface |
| 5 | Auto-update telemetry | `autoUpdater\|electron-updater\|auto.?update` | **NO MATCHES** |
| 8 | Bare word `tracking` (false-positive check) | `tracking` | **ONLY** the CSS `--tracking-*` letter-spacing custom properties: `src/theme/tokens.ts:196-199` (`--tracking-mono/label/tight/snug`) + `renderer/index.css:237-240` (definitions) + `index.css:326,335` (`letter-spacing: var(--tracking-…)`). **These are CSS typography, NOT telemetry — excluded as false positives per the governed WI. There are NO telemetry-relevant `tracking` hits.** |

## 3. Package / dependency inspection
`apps/lawbar-desktop/package.json`:
- **runtime `dependencies`**: `better-sqlite3@^12.9.0`, `case-box-contract` (`file:dist-tarballs/case-box-contract-0.1.0.tgz`), `case-box-persistence` (`file:dist-tarballs/case-box-persistence-0.1.0.tgz`), `docx@9.7.1`.
- **`devDependencies`**: `@playwright/test`, `@types/node`, `electron`, `electron-builder`, `playwright`, `typescript`.
- **NONE** is a telemetry / crash-reporting / analytics library. A scan of `package-lock.json` for telemetry/crash package names (`sentry`/`bugsnag`/`crashpad`/`mixpanel`/`amplitude`/`posthog`/`analytics`/`electron-updater`) returned **no matches**.

## 4. Renderer / main / preload
- `electron/main.ts`: no `crashReporter.start()`, no analytics/telemetry init, no external network call (the client wires local IPC case-box handlers + local SQLite via `getCaseBoxRuntime`).
- `electron/preload.mts`: no telemetry/tracking bridge exposed to the renderer.
- `renderer/**`: no `sendBeacon` / external `fetch` / analytics call; the only `tracking` references are CSS letter-spacing (§2 #8).

## 5. Network / API surface + App Sandbox (scope note)
The client's network surface is **local-only** (in-process / local-loopback per `.claude/rules/client-local-first.md` GW-00 framing — the gateway is a loopback transport, not a public endpoint); no `fetch`/beacon/WebSocket to any **external host** (external = non-loopback [not `127.0.0.1`/`localhost`/`::1`], non-`file://`, non-app-local) was found. The **App Sandbox no-network entitlement** (the OS-enforced offline backstop per evidence-genie invariant 1) is verified at **gate-4 packaging/signing** (STOP-AND-ASK, user) — **NOT** this lane; this lane verifies the CODE ships no telemetry.

## 6. Explicit PASS / FAIL conclusion
**PASS.** All criteria hold: (a) no telemetry / analytics / metrics library or init; (b) no crash-reporting SDK; (c) no `crashReporter.start()` — Electron crash reporting is opt-in, so absent = **OFF by default**; (d) no external beacon / analytics network call (no `fetch()` in the client surface); (e) the dependency list + lockfile carry no telemetry/crash library. The only `tracking` matches are CSS `--tracking-*` letter-spacing false positives, excluded. A telemetry surface present-and-on-by-default, or a crash reporter started by default, would have been a FAIL surfaced as a privacy/offline-posture finding.

## 7. How the result feeds gate 20 without clearing unrelated gates
A PASS supplies the "ships no telemetry + crash-reporting disabled" verification. Per the governed WI, the gate-20 status uses ONLY the report's existing vocabulary and is **kept `PARTIAL`**, enriched with a `[Δ] no-telemetry + crash-reporting-off verified` marker (roll-up bucket unchanged); a `PARTIAL → CLEARED` move is NOT made here (it belongs to a separate holistic readiness-refresh WI). This verification:
- does **NOT** clear gates 4/6/7/11/12/14/15/18/19/21 or imply any cleared;
- notes the **App Sandbox no-network entitlement is gate-4 packaging** (verified there, not here) and cross-references **gate 19** (dependency/supply-chain overlap);
- keeps **go-live independence**: a code verification is not a go-live sign-off. The final GO/NO-GO and the STOP-AND-ASK hard-stops (gate 4 signing/distribution, gate 11 律师法, gate 17 license/business, gate 21 final sign-off) remain the user's.

## 8. Residual risks / follow-up (separate future WIs — not run here)
- **R-G20-1** — this is a **static** code + dependency inspection; a **runtime network-egress observation** (e.g. launching the packaged app under a network monitor and confirming zero outbound connections) would be a stronger, dynamic follow-up.
- **R-G20-2** — the **App Sandbox no-network entitlement** is the OS-enforced offline backstop; its verification is part of **gate 4** packaging/signing (STOP-AND-ASK), not this lane.
- **R-G20-3** — a full **dependency-provenance / supply-chain** sweep (transitive deps) is **gate 19**; this lane confirmed the direct deps + a lockfile name-scan only.
- No product/source follow-up WI is required; these are documentary notes.
