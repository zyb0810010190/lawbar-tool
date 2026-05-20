# PLAN-CLIENT-00 — Client Application Surface (Reconciliation)

**Status**: CLIENT-00a (track plan), CLIENT-00c (GW-00 split), and CLIENT-00b (case-box boundary promotion) **complete**. This document is the historical reconciliation record; the authoritative product summary now lives at `docs/product/product-target-architecture.md`, and the architecture decisions live in `docs/adr/client-application-surface.md`, `docs/adr/sync-bridge-architecture.md`, and `docs/adr/case-box-step-0-boundary.md`.

**Date**: 2026-05-20. CLIENT-00b promotion: 2026-05-20.

**Branch**: `gw-00-ui-gateway-architecture` (the GW-00 ADR was uncommitted on this branch; PLAN-CLIENT-00 reconciled it before commit and the GW-00 draft is now archived at `dev-memo/superseded/gw-00-ocr-ui-gateway-architecture.md`).

**Purpose**: Decide the v1 lawyer-client application surface and reconcile two existing-but-conflicting design directions: the GW-00 ADR (HTTP API gateway primary) and `dev-memo/case-box-plan.md` (local-only, no HTTP, single-user MVP). Both predate PLAN-CLIENT-00; both contain correct pieces; neither alone is the right v1 framing.

---

## §1 Inputs

### 1.1 User-supplied D2 answers (authoritative)

| Q | Answer | Implication |
|---|---|---|
| Q1 user | Lawyer / law-firm staff on Mac. WeChat is a companion channel. Browser users and multi-firm SaaS are NOT v1 primary. | v1 client = Mac desktop app for one lawyer at a time |
| Q2 device | Mac desktop primary; WeChat mini-program companion; browser deferred; Windows/iPad/native-mobile deferred | Mac-only v1; companion mini-program is read-mostly + minimal write |
| Q3 data | Local-first on Mac. Cloud is opt-in PER DOCUMENT / PER MATTER / per explicit sync action. Mini-program only sees what's intentionally exposed. | Default = no cloud, no network for the lawyer's documents. Sync is a deliberate user-driven act. |
| Q4 tenancy | Single local user v1; `tenant_id` retained for forward compatibility; single-firm multi-user is near-future; multi-firm SaaS is NOT v1; auth provider remains Stop-and-Ask | v1 ships without a real auth provider; data shape stays multi-user-ready |

### 1.2 Existing repo evidence (read-only inputs)

| Source | Posture extracted |
|---|---|
| `docs/ui/current-ui-map.md`, `docs/ui/ui-state-contract.md`, `docs/ui/ui-gap-report.md` | Inferred S1–S7 UI surface; gateway named as blocker for *any UI* (HTTP or in-process embedding both qualify) |
| `docs/adr/ocr-ui-gateway-architecture.md` (GW-00, uncommitted) | Recommends HTTP API gateway as primary; uses WeChat as Option-B disqualifier |
| `docs/ui/ui-gateway-contract-draft.md` (uncommitted) | 9 endpoint families against the existing library APIs |
| `dev-memo/case-box-plan.md` (untracked, 462 lines) | **Local-only by default. No HTTP yet. Multi-user readiness baked into data shape; auth deferred. LLM extraction feature-flagged off.** MVP-1 is a programmatic vertical slice for ONE case, single-user, local-only. Defines the actual product layer above OCR (case / document / fact / issue / claim / evidence / deadline / privilege / audit). |
| `dev-memo/real-ocr-worker-brainstorm.md` C5 | "Default = local OCR. Cloud is opt-in PER DOCUMENT." |
| `docs/release/wi-03-security-signoff.md` | WI-03 sign-off is outbound-only; gateway / inbound surface requires its own sign-off |
| AGENTS.md | Coordinator owns lifecycle; mutation policy; stop-and-ask gates (auth, runtime deps, public API, security-sensitive rewrites) |

### 1.3 Direction decisions (user-supplied for this turn)

1. PLAN-CLIENT-00 MAY revise or supersede the uncommitted GW-00 ADR.
2. `dev-memo/case-box-plan.md` is treated as authoritative-pending-promotion.
3. WeChat mini-program remains a desired companion surface but does **not** force cloud-first architecture.
4. Do **not** commit the GW-00 ADR until PLAN-CLIENT-00 reconciles it with local-first Mac app + opt-in companion sync.

---

## §2 Reframe

The right product framing for v1, distilled from §1:

- **Primary client = Mac desktop app, embedding the existing TypeScript libraries in-process.** OCR ingestion, OCR review, OCR persistence, the coordinator, and the future `case-box-*` packages all live inside the desktop process. No network for the default workflow.
- **Default data residency = local.** SQLite under the lawyer's user-controlled path. Documents on the lawyer's filesystem. OCR runs locally via the existing `paddleocr-onnx` engine. Nothing leaves the machine unless the lawyer opts in per document or matter.
- **Companion HTTP surface is optional and additive.** When (and only when) the lawyer wants WeChat mini-program access, cloud sync, or any device-to-device flow, the desktop app exposes a *narrow, opt-in* HTTP surface — either as a local-loopback API to a hosted relay, as a publicly-signed endpoint, or via a hosted sync service. The exact bridge form is a follow-up decision; this plan only fixes the architecture so the option exists.
- **Auth/tenancy stay deferred.** v1 ships single-user with `actor_user_id = "local-user"` (per case-box-plan's pre-Phase-0 acceptance). Data shape preserves `tenant_id` everywhere. No auth provider is chosen.
- **Browser web UI is deferred.** The Electron renderer IS a Chromium browser, but it is Mac-app-local, not a published web app. A standalone browser SPA can be added later atop the same companion HTTP surface; not a v1 goal.

The bottom line: GW-00 ADR's HTTP gateway architecture is **correct as a companion bridge** and **wrong as the primary v1 surface**. The case-box-plan's local-first MVP is **correct as the primary v1 posture** and **incomplete** because it does not address the companion-channel question at all. PLAN-CLIENT-00 closes that gap.

---

## §3 Architecture decision matrix (D2-informed)

Applied to the four axes from the discovery report.

| Axis | v1 choice | Reasoning |
|---|---|---|
| **A. Deployment topology** | Local-laptop only by default; opt-in cloud/relay for companion channels | D2 Q3 = local-first; D2 Q2 = Mac primary |
| **B. Client form-factor** | Mac desktop-native shell (likely Electron, see §6 caveat) + later WeChat mini-program companion | D2 Q1+Q2; mini-program is deferred from v1-day-one but the architecture must not preclude it |
| **C. Data residency** | Local by default; per-document and per-matter cloud opt-in; mini-program sees only intentionally-synced subsets | D2 Q3 |
| **D. Gateway shape** | **None** for the lawyer's default workflow (in-process IPC inside the desktop app). **Narrow opt-in HTTP** for the companion channel(s) — a SUBSET of GW-00's drafted endpoints, not the full surface | D2 Q3 + Q4; case-box-plan local-first; GW-00 ADR's HTTP shape is reusable in this narrowed role |

---

## §4 Recommendation

### 4.1 Primary v1 architecture: Mac desktop app, in-process embedding

Build a Mac desktop application whose main process embeds the existing ocr-* libraries (and the future case-box-* libraries) directly as Node modules. The desktop renderer (browser-equivalent UI layer) communicates with the main process via Electron-style IPC or equivalent in-process channel.

Concrete shape:

```
apps/lawbar-desktop/        (NEW — exact location TBD; under apps/ to avoid services/ confusion)
├── package.json            (private, type:module; depends on ocr-* and case-box-* via file:)
├── electron/               (or tauri-sidecar/, see §6)
│   ├── main.ts             (Node main process — owns coordinator, persistence, case-box engine)
│   ├── ipc.ts              (typed IPC bridge between main and renderer)
│   └── preload.ts          (contextBridge — exposes only the allowed IPC surface)
├── renderer/               (UI; framework TBD, see §6)
│   ├── screens/            (S1–S7 plus case-box screens)
│   ├── components/
│   └── state/
└── tests/
```

Why an in-process desktop main process:

1. **Existing services are already Node** with native deps (`better-sqlite3`). Embedding them in an Electron main is the lowest-friction path — no extra deployment surface, no extra wire protocol, no extra security boundary for the lawyer's default workflow.
2. **Coordinator-ownership rule (AGENTS.md) is preserved trivially**: the main process IS the coordinator host. No risk of UI bypassing the coordinator because the UI cannot speak to persistence directly — IPC routes only through coordinator-aware handlers.
3. **WI-03 SSRF posture is preserved**: the worker's outbound HTTPS pinning lives unchanged in the main process. The renderer never makes outbound HTTPS calls of its own.
4. **Audit and confidentiality become local-machine concerns**: easier to reason about than a network-fronted multi-tenant deployment.

### 4.2 Companion v1+ surface: narrow opt-in HTTP bridge

When the lawyer chooses to enable mini-program access OR cloud sync for a specific document/matter, the Mac desktop app may spawn (or connect to) a companion HTTP surface that re-exposes a **subset** of the operations to the mini-program / sync target. The bridge is:

- **Opt-in.** Off by default. Per-document or per-matter opt-in matches `dev-memo/case-box-plan.md` cross-cutting invariant #4 ("documents never leave local storage unless `confidentiality_class=normal` AND user explicitly authorized external worker for that doc").
- **Narrow.** v1 mini-program needs a small surface: read case summary, read OCR job status, view a specific reviewable page, accept/reject a candidate fact, attach a quick note. NOT submit-new-document, NOT bulk-export, NOT privilege-log export.
- **Auditable.** Every operation through the bridge produces an audit event in the same hash-chain `case-box-plan.md` D2.1 already defines.
- **Authenticated** when v1+ ships the bridge — but the auth provider is a separate Stop-and-Ask gate.
- **Architecturally compatible with GW-00 ADR's `services/ocr-api/` shape**, but materially narrower in surface and posture. The HTTP routes and error envelope from `docs/ui/ui-gateway-contract-draft.md` are reusable; the framing in `docs/adr/ocr-ui-gateway-architecture.md` is not.

### 4.3 What v1 does NOT need

- A public-internet API.
- Multi-tenant auth.
- Cloud storage.
- A WeChat mini-program at day one (architecture must not preclude it, but day-one ship can be Mac-only).
- A standalone browser SPA.
- Production-grade rate limiting, IdP integration, or audit-log retention policy.

---

## §5 Disposition of the GW-00 ADR

The GW-00 ADR is currently:

- Uncommitted, on branch `gw-00-ui-gateway-architecture`.
- Status: `proposed`.
- Framed with "HTTP API gateway" as the primary architecture for the v1 client surface.
- Disqualifies in-process desktop (its Option B) on the grounds that WeChat mini-program is a stated future surface.

Given D2's reframing, **the GW-00 ADR's framing is wrong but its drafted endpoint surface is reusable**. Three concrete options for handling it:

### Option α — Revise GW-00 in place

Edit the existing ADR to:
- Reframe Decision: "Adopt an in-process Mac desktop app as the v1 primary client. Reserve an HTTP API gateway as an opt-in companion bridge for WeChat mini-program and cloud sync, scoped narrower than the originally-drafted surface."
- Demote Option A (HTTP gateway) to "secondary / opt-in companion" status.
- Promote Option B (in-process desktop) to "primary v1 architecture".
- Rewrite the WeChat-as-disqualifier reasoning.
- Keep `docs/ui/ui-gateway-contract-draft.md` as a companion-bridge endpoint reference, with a header note clarifying scope.

**Pro**: minimal new files; preserves the work already drafted; one ADR per architecture decision.
**Con**: forces one ADR to carry two architectures (primary + companion). Future readers may conflate them. The ADR's title (`ocr-ui-gateway-architecture`) becomes a misnomer.

### Option β — Split GW-00 into two ADRs (recommended)

Replace the GW-00 ADR with two narrower ADRs that each handle exactly one architecture decision:

1. `docs/adr/client-application-surface.md` — v1 primary = Mac desktop, in-process embedding. Owns: app shell, IPC boundary, coordinator-in-main posture, default data residency, S1–S7 + case-box screens delivered via in-process IPC.
2. `docs/adr/sync-bridge-architecture.md` — companion HTTP bridge for mini-program + cloud sync. Owns: opt-in semantics, narrow endpoint scope (subset of `ui-gateway-contract-draft.md`), auth/tenant posture (deferred), per-doc/per-matter opt-in enforcement, audit logging through the same hash chain.

Discard `docs/adr/ocr-ui-gateway-architecture.md` (delete from the branch before committing) and rewrite `docs/ui/ui-gateway-contract-draft.md` as a companion-bridge reference for ADR-2 above.

**Pro**: each ADR has one decision and one scope. Future readers see "client surface" and "sync bridge" as separate decisions, which they are. Aligns with the existing repo ADR style (one decision per ADR, see `docs/adr/ocr-*-step-NN-*.md` pattern).
**Con**: two ADRs instead of one; PLAN-CLIENT-00 must explicitly delete the in-progress GW-00 file.

### Option γ — Supersede GW-00 entirely

Delete `docs/adr/ocr-ui-gateway-architecture.md` and `docs/ui/ui-gateway-contract-draft.md` from the branch. Replace with one new ADR `docs/adr/client-application-surface.md` that names the v1 desktop architecture and explicitly defers the sync-bridge decision to a future ADR.

**Pro**: simplest. Removes the gateway-first framing entirely until the sync bridge is actually needed.
**Con**: throws away the contract-draft work; mini-program / cloud sync architecture is left as "TBD" with no recorded thinking.

### Recommendation

**Option β (split)**. It preserves the work, names the two decisions cleanly, and matches the existing ADR-per-decision pattern in `docs/adr/`.

This plan does NOT execute that split — it recommends it as a follow-up WI (see §7 Phasing). The GW-00 ADR file and the contract draft stay untouched on this branch for now.

---

## §6 Open questions / Stop-and-Ask gates

The following must each clear before the architecture decision can land as code. PLAN-CLIENT-00 does NOT resolve any of them.

1. **Desktop app framework** — Electron, Tauri, or native Mac (Swift/AppKit) with a sidecar Node process? *Stop-and-Ask: new runtime dependency, AGENTS.md gate.* My quick analysis:
   - **Electron** — natural fit. Main process IS Node; existing ocr-* libraries embed directly; native modules (`better-sqlite3`) already work in Node. ~130MB baseline binary. Mature Mac codesigning + notarization path.
   - **Tauri** — Rust backend, system webview frontend. Smaller binary (~20MB). Does NOT trivially embed Node libraries; would require running Node as a sidecar child process and talking to it via stdio or local-loopback HTTP — which re-introduces a network surface the architecture is trying to avoid by default.
   - **Native Swift/AppKit + sidecar Node** — best Mac integration; highest development cost; still needs a stdio or loopback channel to the Node sidecar.
   - **My recommendation when this gate opens**: Electron, on the "embed existing Node libraries directly" criterion. Tauri's binary-size win does not outweigh the architectural cost of re-introducing an IPC-over-network boundary.

2. **Renderer UI framework** — React, Vue, Svelte, Solid, plain HTML? *Stop-and-Ask: new runtime dependency.* No strong preference from existing repo; recommend deferring to the implementation WI.

3. **Auth provider** — *Stop-and-Ask, gate stays open.* v1 ships with `actor_user_id = "local-user"` per case-box-plan. Real auth deferred until either (a) cloud sync ships, (b) single-firm multi-user lands, or (c) mini-program ships — whichever first.

4. **Cloud storage backend** for opt-in sync — *Stop-and-Ask: external account.* Defer. Architecture must support pluggable backend (S3, R2, OSS, private object store).

5. **WeChat mini-program account / registration** — *Stop-and-Ask: external account / regulatory.* WeChat mini-program publication requires a registered Chinese business entity and WeChat developer account. Out of v1 day-one scope.

6. **LLM extractor for candidate facts** — case-box-plan Phase 8. Defer.

7. **macOS code-signing + notarization** — operational. Required before any non-dev distribution; not blocking architecture decisions.

8. **Document storage on local disk** — case-box-plan §"Open decisions" #3: filesystem with content_hash vs blob inside SQLite. Recommended in case-box-plan: filesystem. PLAN-CLIENT-00 inherits this.

9. **Encryption at rest** — case-box-plan §"Open decisions" #2. Defer. Mac FileVault is the v1 reliance.

10. **Sync conflict resolution** — when the companion mini-program writes (e.g. accept/reject a candidate fact) and the Mac app also writes the same record, who wins? Architecture decision deferred to the sync-bridge ADR (Option β follow-up).

---

## §7 Phasing

This plan does NOT authorize execution. It sketches the order in which downstream WIs would land.

| Step | Output | Authorization gate | Status |
|---|---|---|---|
| **CLIENT-00a** | `dev-memo/plan-client-00.md` tracked (commit `a07e5d1`) | user-authorized 2026-05-20 | **done** |
| **CLIENT-00c** | GW-00 reconciliation per §5 Option β: archived `docs/adr/ocr-ui-gateway-architecture.md` to `dev-memo/superseded/`, created `docs/adr/client-application-surface.md` and `docs/adr/sync-bridge-architecture.md`, renamed `docs/ui/ui-gateway-contract-draft.md` to `docs/ui/sync-bridge-contract-draft.md` with re-scoped endpoints, updated `docs/ui/ui-gap-report.md` (commit `cc2071e`) | user-authorized 2026-05-20 | **done** |
| **CLIENT-00b** | Promote `dev-memo/case-box-plan.md` authoritative content to `docs/adr/case-box-step-0-boundary.md` + `docs/product/product-target-architecture.md`; archive case-box-plan.md to `dev-memo/superseded/` | user-authorized 2026-05-20 | **done** |
| **CLIENT-01** | Desktop-app framework Stop-and-Ask (Electron vs Tauri vs native) | Stop-and-Ask: new runtime dependency |
| **CLIENT-02** | Renderer UI framework Stop-and-Ask | Stop-and-Ask: new runtime dependency |
| **CLIENT-03** | `apps/lawbar-desktop/` scaffold (main process, IPC bridge, empty renderer). No screens yet. | regular implementation WI after CLIENT-01 + CLIENT-02 |
| **CLIENT-04+** | Per-screen implementation, in roughly UI-00's recommended order: job list (S2) → job detail (S3) + per-page (S4) → submission (S1) → cancel (S6) → manual-review (S5) → case-box screens once Phase-1 case-box landed | regular implementation WIs |
| **SYNC-01** | Sync bridge scaffold per ADR `docs/adr/sync-bridge-architecture.md`. Initially read-only mini-program surface. | Stop-and-Ask: inbound network surface; security sign-off (separate from WI-03) |
| **SYNC-02+** | Mini-program client itself; WeChat integration | Stop-and-Ask: external account, third-party SDK |

---

## §8 Reconciliation summary

| Existing artifact | PLAN-CLIENT-00 disposition |
|---|---|
| `docs/ui/current-ui-map.md` | Keep. S1–S7 surface remains valid; delivery mechanism changes from "HTTP gateway" to "in-process IPC for primary + narrow HTTP for companion". Add one-line forward reference to PLAN-CLIENT-00 only if no over-edit risk |
| `docs/ui/ui-state-contract.md` | Keep. State contract derived from `transitions.ts` is mechanism-independent |
| `docs/ui/ui-gap-report.md` | Already contains a forward reference to GW-00 (added during GW-00 drafting). Update minimally to point at PLAN-CLIENT-00 when CLIENT-00c executes |
| `docs/adr/ocr-ui-gateway-architecture.md` | **Done in CLIENT-00c**: archived to `dev-memo/superseded/gw-00-ocr-ui-gateway-architecture.md` (gitignored) |
| `docs/ui/ui-gateway-contract-draft.md` | **Done in CLIENT-00c**: renamed to `docs/ui/sync-bridge-contract-draft.md` with endpoints re-scoped by SYNC step |
| `docs/release/wi-03-security-signoff.md` | Keep. The Q10 paragraph about GW-00 still references the deleted ADR name; a one-line edit may be made in a future docs WI to point at the new ADR names |
| `dev-memo/case-box-plan.md` | **Done in CLIENT-00b**: authoritative content promoted to `docs/adr/case-box-step-0-boundary.md` + `docs/product/product-target-architecture.md`; original archived to `dev-memo/superseded/case-box-plan.md` (gitignored) |
| `dev-memo/real-ocr-worker-brainstorm.md` | Keep as historical brainstorm. Constraint C5 (local-OCR-by-default) aligns with PLAN-CLIENT-00; no edit needed |

---

## §9 Non-goals

This plan does NOT:

- Implement any code.
- Choose a desktop app framework (Electron / Tauri / native).
- Choose a UI framework.
- Choose an auth provider.
- Choose a cloud storage backend.
- Register or design WeChat mini-program integration.
- Modify any existing ADR, schema, contract, persistence layer, or public package surface.
- Touch `docs/adr/ocr-ui-gateway-architecture.md` or `docs/ui/ui-gateway-contract-draft.md` (Option β execution happens in CLIENT-00c, a separate authorization).
- Promote `dev-memo/case-box-plan.md` to a tracked doc (CLIENT-00b, a separate authorization).
- Widen WI-03's security sign-off.
- Authorize execution of any downstream WI.

---

## §10 Open questions for the user (Stop-and-Ask)

Listed for the next turn, not resolved here:

1. **Approve §5 Option β** (split GW-00 into client-application-surface + sync-bridge ADRs)? Or prefer Option α (revise in place) or γ (supersede entirely)?
2. **Approve promoting `dev-memo/case-box-plan.md` to tracked ADRs** as CLIENT-00b before any further cross-doc reference?
3. **Confirm desktop-app framework Stop-and-Ask should default to Electron** at CLIENT-01 time, or do you want a fuller comparison (Tauri / native Swift) first?
4. **Confirm v1 ships without WeChat mini-program** (architecture preserves the option; day-one ship is Mac-only)?
5. **Confirm `actor_user_id = "local-user"` is acceptable for v1** until either cloud sync, multi-user, or mini-program lands?

---

## §11 References

- `docs/ui/current-ui-map.md`
- `docs/ui/ui-state-contract.md`
- `docs/ui/ui-gap-report.md`
- `docs/adr/ocr-ui-gateway-architecture.md` (uncommitted; pending §5 reconciliation)
- `docs/ui/ui-gateway-contract-draft.md` (uncommitted; pending §5 reconciliation)
- `docs/release/wi-03-security-signoff.md`
- `docs/release/go-live-plan.md`
- `dev-memo/case-box-plan.md` (untracked; pending CLIENT-00b promotion)
- `dev-memo/real-ocr-worker-brainstorm.md` (untracked; constraint C5)
- `AGENTS.md` — coordinator-ownership, mutation policy, stop-and-ask gates
- `docs/contracts/src/transitions.ts` — `web_app` actor, `ALLOWED_EDGES`
- `services/ocr-review/src/index.ts`, `services/ocr-review/src/types.ts` — read-model exports
- `services/ocr-ingestion/src/index.ts` — submission entry point
