# ADR: Client Application Surface (CLIENT-00)

## Status

**Proposed** — 2026-05-20. Supersedes the uncommitted GW-00 ADR (`docs/adr/ocr-ui-gateway-architecture.md`, removed in the same commit as this ADR).

This ADR does NOT authorize implementation. It selects the v1 primary client architecture. Sibling ADR `docs/adr/sync-bridge-architecture.md` handles the opt-in companion HTTP surface decision. Framework, UI library, auth provider, cloud backend, and code-signing remain Stop-and-Ask gates per `AGENTS.md`.

## Context

This ADR is the execution of CLIENT-00c from `dev-memo/plan-client-00.md` (commit `a07e5d1`). The reconciliation plan distilled four authoritative D2 answers from the user:

| D2 | Lock |
|---|---|
| Q1 user | Lawyer / law-firm staff on Mac. WeChat is companion. Browser users and multi-firm SaaS are NOT v1 primary. |
| Q2 device | Mac desktop primary; WeChat mini-program companion; browser deferred; Windows/iPad/native-mobile deferred. |
| Q3 data | Local-first on Mac. Cloud is opt-in PER DOCUMENT / PER MATTER / per explicit sync action. |
| Q4 tenancy | Single local user v1; `tenant_id` retained for forward compatibility; multi-firm SaaS is NOT v1; auth provider remains Stop-and-Ask. |

The uncommitted GW-00 ADR proposed an HTTP API gateway as the v1 primary client surface. That framing is wrong for v1 under the D2 answers: the lawyer's default workflow must not require a network surface, and the WeChat mini-program is a deferred companion, not a v1-day-one client. The GW-00 ADR's drafted endpoint surface (`docs/ui/ui-gateway-contract-draft.md`) is preserved and re-scoped under `docs/adr/sync-bridge-architecture.md` as a companion-bridge reference.

Relevant adjacent state:

- **UI-00** (`docs/ui/current-ui-map.md`, `docs/ui/ui-state-contract.md`, `docs/ui/ui-gap-report.md`) — inferred seven UI surfaces (S1–S7) from contract + read-model. Surface inventory stays valid; only the delivery mechanism changes from "HTTP gateway" to "in-process IPC for primary + narrow opt-in HTTP for companion".
- **`dev-memo/case-box-plan.md`** (untracked, pending CLIENT-00b promotion) — defines the case / document / fact / issue / claim / evidence / deadline / privilege / audit layer above OCR, framed as local-only single-user MVP with multi-user-ready data shape and deferred auth. Its cross-cutting invariants (local-by-default, per-document opt-in for external workers, audit hash-chain) align with this ADR.
- **WI-03 security sign-off** (`docs/release/wi-03-security-signoff.md`, commit `5ae5b61`) closed SSRF / DNS-rebinding on the worker's outbound fetcher. It is scoped to WI-03 only. Any future inbound network surface (sync bridge, etc.) requires its own security sign-off; that is the sync-bridge ADR's concern, not this one's.
- **Coordinator ownership rule** (`AGENTS.md`) — `OcrProcessingCoordinator` owns lifecycle. The in-process desktop main process inherits this role for the lawyer's local workflow.

## Decision

**Adopt a Mac desktop application with in-process embedding of the existing TypeScript libraries as the v1 primary client surface.**

The desktop application's main process directly imports and runs:

- `ocr-worker-contract` (validators, state machine, retry classifier).
- `services/ocr-ingestion` (submission entry point).
- `services/ocr-persistence` (SQLite source of truth).
- `services/ocr-worker` (coordinator + outbound fetcher with WI-03 hardening).
- `services/ocr-review` (read-model).
- Future `case-box-*` packages (per `dev-memo/case-box-plan.md`).

The renderer (UI layer) communicates with the main process via in-process IPC. No HTTP, no localhost, no network surface for the lawyer's default workflow.

Concrete package shape:

```
apps/lawbar-desktop/                 (NEW — under apps/ to avoid services/ confusion)
├── package.json                     (private, type:module, depends on ocr-* and case-box-* via file:)
├── electron/                        (or alternative shell — see §"Framework decision deferred")
│   ├── main.ts                      (Node main process — owns coordinator, persistence, case-box engine)
│   ├── ipc.ts                       (typed IPC bridge between main and renderer)
│   └── preload.ts                   (contextBridge — exposes only the allowed IPC surface)
├── renderer/                        (UI; framework TBD)
│   ├── screens/                     (S1–S7 plus case-box screens)
│   ├── components/
│   └── state/
└── tests/
```

The exact desktop-shell framework (Electron / Tauri / native Swift+Node-sidecar) and renderer UI framework are Stop-and-Ask gates per `AGENTS.md` and remain unresolved by this ADR. Recommended defaults are listed in §"Framework decision deferred" for the next user authorization turn.

## Options considered

This ADR reuses the option analysis from `dev-memo/plan-client-00.md` §3 and the GW-00 ADR §"Options considered". The four-option set is restated below with the D2-informed outcome.

### Option A — HTTP API gateway as primary

The framing originally chosen by the GW-00 ADR. **Rejected under D2.**

| Criterion | Verdict under D2 |
|---|---|
| Q3 local-first by default | ❌ — gateway puts network on the default path |
| Q2 Mac desktop primary | ⚠️ — gateway can be consumed by Mac desktop, but adds a network boundary the desktop did not need |
| Q1 v1 lawyer-on-Mac user | ❌ — adds operational complexity (TLS, deployment, auth) for a single-user-on-Mac workflow |
| WeChat mini-program day-one | N/A — D2 Q2 defers mini-program from v1-day-one |
| Multi-tenant auth burden | ❌ — D2 Q4 explicitly defers auth provider and multi-firm SaaS |

The endpoint surface drafted in `docs/ui/ui-gateway-contract-draft.md` is **not discarded**. It is reused in narrower form by `docs/adr/sync-bridge-architecture.md` as the companion-bridge reference.

### Option B — In-process desktop shell (chosen)

UI bundled in a desktop app that imports `ocr-review`, `ocr-ingestion`, the coordinator, and the future `case-box-*` packages directly via Node IPC.

| Criterion | Verdict under D2 |
|---|---|
| Q3 local-first by default | ✅ — zero network on the default path |
| Q2 Mac desktop primary | ✅ — Mac-app-native delivery |
| Q1 v1 lawyer-on-Mac user | ✅ — one binary, no deployment complexity, no inbound surface |
| Future WeChat mini-program path | ✅ — companion bridge (sibling ADR) adds the surface when needed; architecture does not preclude it |
| Auth/tenant boundary | ✅ — single-user single-machine; `tenant_id` retained in data shape per D2 Q4; auth deferred |
| AGENTS.md coordinator ownership | ✅ — main process IS the coordinator host; renderer cannot bypass |
| WI-03 SSRF posture | ✅ — outbound HTTPS-pinning lives unchanged in main process; renderer never makes outbound calls |
| Audit + confidentiality | ✅ — local-machine concerns, reuses `case-box-plan.md` hash-chain |
| UI-00 S1–S6 surfaces | ✅ — each maps directly to an IPC handler |
| UI-00 S7 tenant/auth | ⚠️ — irrelevant in v1; `tenant_id` stays in data shape for future multi-user |

GW-00 ADR's original disqualification of Option B was "WeChat mini-program is a stated future surface, mini-programs cannot consume Node libraries". Under D2 Q2 the mini-program is **deferred** (companion, not v1-day-one), and the sibling sync-bridge ADR handles the companion surface when it ships. The original disqualification no longer applies.

### Option C — Minimal RPC adapter (tRPC / JSON-RPC over HTTP)

A typed RPC layer that re-exports library functions over HTTP, sharing types between server and client.

**Rejected** for the same reason as Option A under D2: it puts a network surface on the default path. Reusable inside the sync-bridge ADR as a framework choice (the sync bridge MAY use tRPC or JSON-RPC); not an architecture choice for v1 primary.

### Option D — Defer gateway, build mock UI only

Visual prototype with hard-coded data. Allowed only for visual exploration per GW-00. Not a production path. Unchanged from GW-00 evaluation.

## Recommendation

**Option B — Mac desktop app with in-process embedding.**

Reasoning, distilled from D2:

1. The lawyer's default workflow must not require network connectivity (D2 Q3 local-first).
2. The default product is a single lawyer on a Mac (D2 Q1 + Q2) — adding a network boundary for that case is unjustified complexity.
3. WeChat mini-program access is a deferred companion (D2 Q2), addressed by the sibling sync-bridge ADR when it ships. The architecture preserves the option.
4. Existing libraries are already Node and depend on native modules (`better-sqlite3`). Embedding them in a Node main process is the lowest-friction path — no extra deployment surface, no extra wire protocol, no extra security boundary for the default workflow.
5. Coordinator-ownership (`AGENTS.md`) is preserved trivially: the main process IS the coordinator host. The renderer cannot speak to persistence directly; IPC routes only through coordinator-aware handlers.
6. WI-03 outbound SSRF posture is preserved: outbound HTTPS pinning lives unchanged in the main process. The renderer never makes outbound calls of its own.

## Consequences

### Positive

- Default workflow has zero inbound or outbound network surface. WI-03's posture (outbound only, pinned) is the entire network story for v1.
- Single deployable: one Mac application. No reverse proxy, no TLS termination, no inbound auth, no multi-tenant deployment.
- Existing per-package tests stay green; the new desktop app is additive.
- Coordinator ownership rule is enforced by code structure: renderer cannot reach persistence except via main-process IPC handlers.
- Audit and confidentiality become local-machine concerns; easier to reason about than a network-fronted multi-tenant deployment.
- WeChat mini-program access is not blocked — the sibling sync-bridge ADR opens that path when the user authorizes it.

### Negative

- A future browser SPA, a multi-device review workflow, or a paralegal-on-different-machine handoff requires the sync bridge to ship first. v1-day-one is single-machine only.
- Desktop signing + notarization (macOS) is required before non-developer distribution. Operational, not architectural.
- Desktop-shell framework choice (Electron / Tauri / native) is a new runtime dependency Stop-and-Ask. This ADR does not pre-commit, but `dev-memo/plan-client-00.md` §6.1 recommends Electron as the default proposal at the gate, on the criterion "embed existing Node libraries with native modules".
- Renderer UI framework choice (React / Vue / Svelte / Solid / plain) is a new runtime dependency Stop-and-Ask. No strong preference; defer to the implementation WI.

### Neutral

- `tenant_id` stays on every persistence record (already true). Multi-user readiness is preserved for the future without forcing a v1 auth provider.
- The OCR pipeline's wire-format contract (`ocr-worker-contract`) is unchanged. The desktop app consumes it as a library, same as today's tests.

## Framework decision deferred

The following choices are Stop-and-Ask gates and are NOT resolved by this ADR. Recommended defaults are listed for the next user authorization turn.

### Desktop shell

| Option | Recommendation? |
|---|---|
| **Electron** | **Recommended default.** Main process IS Node; existing `ocr-*` libraries embed directly; `better-sqlite3` native modules already work in Node. ~130MB baseline binary. Mature Mac codesigning + notarization path. |
| Tauri | Smaller binary (~20MB) but does NOT trivially embed Node libraries. Would require running Node as a sidecar child process and talking via stdio or local-loopback HTTP, re-introducing the very network boundary this ADR avoids by default. |
| Native Swift/AppKit + Node sidecar | Best Mac integration; highest development cost; still needs a stdio or loopback channel to the Node sidecar. |

**Recommendation when this gate opens**: Electron, on the "embed existing Node libraries directly" criterion. Tauri's binary-size win does not outweigh the architectural cost of re-introducing an IPC-over-network boundary in the default workflow.

### Renderer UI framework

No strong preference. Recommend deferring to the implementation WI; choose a framework with strong TypeScript support and a small dependency surface. React, Solid, and Svelte are all viable.

### Other gates (unchanged from `plan-client-00.md` §6)

- Auth provider — Stop-and-Ask gate stays open. v1 ships with `actor_user_id = "local-user"` per `case-box-plan.md` pre-Phase-0 acceptance.
- Cloud storage backend (for opt-in sync) — Stop-and-Ask. Defer to sync-bridge implementation.
- WeChat mini-program account / registration — Stop-and-Ask. Out of v1 day-one scope.
- macOS code-signing + notarization — operational. Required before non-dev distribution.
- Document storage on disk vs SQLite blob — case-box-plan recommends filesystem; this ADR inherits.
- Encryption at rest — defer; v1 relies on macOS FileVault.

## Security considerations

The default workflow has no inbound network surface. The only network code that runs is the worker's outbound HTTPS fetcher, which retains WI-03's DNS-pinning / SSRF posture unchanged. Specifically:

1. **No inbound surface.** Renderer-to-main IPC is in-process only. No localhost socket. No loopback HTTP.
2. **No SSRF re-introduction.** The renderer MUST NOT make outbound HTTPS calls; URL fetching is delegated to `services/ocr-worker`'s `fetchPageBytes` exclusively. The contextBridge preload script MUST NOT expose `fetch`, `XMLHttpRequest`, or `node:http` to the renderer.
3. **Coordinator-mediated writes.** Every UI-driven state transition (cancel, future manual-correction) MUST go through `OcrProcessingCoordinator` and `appendOcrStatusOnce`. IPC handlers in the main process expose only coordinator-mediated entrypoints; direct `OcrPersistence` access is not surfaced to the renderer.
4. **Audit logging.** Every renderer-initiated write produces an audit event via the same hash-chain used by `case-box-plan.md` D2.1. The audit chain is local-machine only in v1.
5. **No widening of public error surface.** The IPC bridge MUST translate `OcrQueueError`, `IngestionError`, `OcrPersistenceError`, `FetcherError` to a stable renderer-facing error envelope WITHOUT exposing `HttpsTransportError` internal discriminators (WI-03b/c). The renderer sees the same public surface that any future HTTP gateway would expose.
6. **Renderer sandboxing.** When Electron is chosen (recommended default), the renderer MUST run with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. The preload script is the only bridge.
7. **Local-disk storage.** SQLite + document storage live under user-controlled paths (default: `~/Library/Application Support/lawbar/`). v1 relies on macOS FileVault for at-rest encryption; per-document encryption is deferred (`case-box-plan.md` "Open decisions" #2).
8. **Confidentiality opt-in matches case-box-plan invariant #4.** Documents never leave local storage unless `confidentiality_class == normal` AND the user explicitly authorized an external worker for that document. The desktop app enforces this at the IPC boundary; the future sync bridge enforces it at its inbound boundary.

The WI-03 sign-off is preserved without change. This ADR does NOT widen WI-03 and does NOT add a new security surface for v1. The sibling sync-bridge ADR is where any new inbound surface gets its own sign-off.

## Tenant / auth considerations

- v1 ships single-user. `actor_user_id = "local-user"` (per `case-box-plan.md` pre-Phase-0 acceptance) is the default.
- Every persistence record continues to carry `tenant_id`. v1 uses a single retained tenant id; data shape stays multi-user-ready for the future single-firm-multi-user phase.
- No auth provider is chosen. The auth-provider Stop-and-Ask gate stays open until either (a) the sync bridge ships, (b) single-firm multi-user lands, or (c) WeChat mini-program ships — whichever first.
- No external IdP integration. No JWT validation. No SAML. No OAuth2 / OIDC.

## Test strategy

The implementation WI inherits the existing project test posture: per-package `npm test`, `node:test` runner, strict TDD per `.claude/tdd-guardian/config.json` if present, file-backed temp DBs for any SQLite test that crosses connections.

New tests at the `apps/lawbar-desktop/` package:

1. **IPC boundary tests.** Each IPC handler tested with fake `ocr-ingestion` / `ocr-review` / coordinator deps. Asserts request shape, response shape, error envelope, and coordinator routing for writes.
2. **Preload-surface tests.** Asserts the contextBridge exposes ONLY the documented IPC channels — no `fetch`, no `node:*` modules, no direct persistence accessors.
3. **Coordinator-routing tests.** Mock coordinator; assert every write path that touches OCR lifecycle goes through the coordinator, never directly through persistence.
4. **Error-envelope tests.** Mirror `services/ocr-worker/tests/fetcher.public-surface.test.mjs`: assert no internal `HttpsTransportError` discriminator leaks into the renderer-facing error envelope.
5. **End-to-end smoke test.** Renderer → IPC → real `ocr-ingestion` → real `ocr-persistence` (file-backed temp DB) → real coordinator on a tiny scenario. Validates the full vertical without a live worker.

WI-03's existing tests stay untouched.

## Migration plan

No data migration. No contract migration. No persistence migration.

Code migration is fully additive:

1. **CLIENT-00c (this ADR + sync-bridge ADR + doc reconciliation):** decision recorded; companion-bridge reference attached. **No code.** Executed as the same commit that lands this ADR.
2. **CLIENT-01 (Stop-and-Ask):** desktop-shell framework selection (recommended default: Electron).
3. **CLIENT-02 (Stop-and-Ask):** renderer UI framework selection.
4. **CLIENT-03:** `apps/lawbar-desktop/` scaffold (main process, IPC bridge, preload script, empty renderer). No screens yet.
5. **CLIENT-04+:** per-screen implementation in UI-00's recommended order: S2 job list → S3 job detail → S4 per-page (read) → S1 submission → S6 cancel → S5 manual-review → case-box screens once case-box Phase-1 lands.
6. **CLIENT-05:** coordinator-mediated cancel IPC handler. Requires a small backend WI to expose a coordinator-cancel function (`OcrProcessingCoordinator` does not have one today; the contract names `web_app` as the cancel actor). Stop-and-Ask: contract / lifecycle change.
7. **CLIENT-06+:** case-box screens, depend on `case-box-*` packages landing per `case-box-plan.md` phasing.

The sync-bridge migration is separate; see `docs/adr/sync-bridge-architecture.md`.

This list is illustrative for the migration plan and is NOT an authorization to execute. Each step is a separate WI with its own predecessors and Stop-and-Ask gates.

## Non-goals

This ADR does NOT:

- Implement any desktop app code, IPC handler, preload script, or renderer screen.
- Choose a desktop-shell framework (Electron / Tauri / native).
- Choose a renderer UI framework.
- Choose an authentication provider.
- Choose a cloud storage backend for the future sync bridge.
- Design the WeChat mini-program integration.
- Add a runtime dependency.
- Change any existing package's exports, types, schemas, or persistence behavior.
- Authorize implementation. The implementation WI requires explicit user authorization per `AGENTS.md`.
- Widen WI-03's security sign-off.
- Decide deployment topology beyond "single Mac binary for v1".
- Specify rate limits, quotas, audit-log retention policies, or document encryption parameters.
- Take any position on the sync bridge's framework, auth provider, or deployment shape — that is the sibling ADR's concern.

## Open questions / explicit unknowns

Listed deliberately so they are not silently guessed:

1. **Desktop shell framework.** Recommendation: Electron. Stop-and-Ask gate at CLIENT-01.
2. **Renderer UI framework.** No strong preference. Stop-and-Ask gate at CLIENT-02.
3. **Auth provider.** Stays unresolved. Re-opens when sync bridge or multi-user phase lands.
4. **Document storage path.** Default proposal: `~/Library/Application Support/lawbar/`. Confirm at CLIENT-03 scaffold time.
5. **Cancel endpoint coordinator-mediated function.** Backend WI required (CLIENT-05). Lifecycle ownership change → Stop-and-Ask per `AGENTS.md`.
6. **Manual-corrections write path (S4-write per UI-00).** Not contracted today. Out of scope for CLIENT-00. Any decision is a contract change, not a client-app change.
7. **macOS code-signing + notarization.** Operational. Required before non-developer distribution.
8. **Encryption at rest.** v1 relies on FileVault. Per-document encryption is deferred (`case-box-plan.md` "Open decisions" #2).

## References

- `dev-memo/plan-client-00.md` — reconciliation plan; D2 source.
- `docs/adr/sync-bridge-architecture.md` — sibling ADR for the opt-in companion HTTP surface.
- `docs/ui/sync-bridge-contract-draft.md` — companion-bridge endpoint reference (formerly `ui-gateway-contract-draft.md`).
- `docs/ui/current-ui-map.md` — UI surface inferences (S1–S7).
- `docs/ui/ui-state-contract.md` — state-machine-derived UI contract.
- `docs/ui/ui-gap-report.md` — gap analysis updated to point at this ADR.
- `dev-memo/case-box-plan.md` — case-box layer (untracked, pending CLIENT-00b promotion).
- `docs/release/wi-03-security-signoff.md` — outbound-fetcher security sign-off (preserved unchanged).
- `docs/release/go-live-plan.md` — Stop-and-Ask gates, per-package test commands.
- `AGENTS.md` — coordinator-ownership rule, mutation policy, Stop-and-Ask gates.
- `docs/contracts/src/transitions.ts` — `web_app` actor, `ALLOWED_EDGES`.
- `services/ocr-review/src/types.ts`, `services/ocr-review/src/index.ts` — read-model surfaced via IPC.
- `services/ocr-ingestion/src/index.ts` — submission entry point invoked via IPC.
- `services/ocr-worker/src/index.ts` — coordinator owning lifecycle, hosted in the main process.
