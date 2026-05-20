# ADR: Sync Bridge Architecture (SYNC-00)

## Status

**Proposed** — 2026-05-20. Sibling to `docs/adr/client-application-surface.md`. Supersedes the uncommitted GW-00 ADR (`docs/adr/ocr-ui-gateway-architecture.md`, removed in the same commit as this ADR). Reuses (in narrower scope) the endpoint surface drafted at `docs/ui/sync-bridge-contract-draft.md` (formerly `ui-gateway-contract-draft.md`).

This ADR does NOT authorize implementation. It fixes the architecture so that the v1 Mac desktop app can later expose a narrow, opt-in HTTP surface for the WeChat mini-program companion and for per-document/per-matter cloud sync. The framework, auth provider, deployment topology, and concrete endpoint set are Stop-and-Ask gates per `AGENTS.md` and remain unresolved by this ADR.

## Context

`docs/adr/client-application-surface.md` (CLIENT-00) locks the v1 primary client as a Mac desktop application with zero network surface on the default workflow. The D2 answers in `dev-memo/plan-client-00.md` also lock:

- **D2 Q2 device** — WeChat mini-program is a deferred companion, NOT v1-day-one. Architecture must not preclude it.
- **D2 Q3 data** — Cloud is opt-in PER DOCUMENT / PER MATTER / per explicit sync action. The mini-program only sees what is intentionally exposed.
- **D2 Q4 tenancy** — `tenant_id` retained for forward compatibility; multi-firm SaaS is NOT v1; auth provider remains Stop-and-Ask.

To preserve these locks while leaving a clean architectural seam for the companion surface, the sync bridge is recorded as a separate, opt-in subsystem that the desktop app spawns (or connects to) only when the lawyer explicitly enables sync for a specific document/matter or attaches a mini-program client.

The uncommitted GW-00 ADR proposed a single HTTP gateway as the v1 primary surface. The GW-00 framing is split here: the **primary surface** decision lives in CLIENT-00; the **companion surface** decision lives in this ADR. GW-00's drafted endpoint shape (`docs/ui/ui-gateway-contract-draft.md`) is reused at narrower scope as `docs/ui/sync-bridge-contract-draft.md`.

Relevant adjacent state:

- **WI-03 security sign-off** (`docs/release/wi-03-security-signoff.md`) covers outbound only. The sync bridge introduces a NEW inbound network surface; it requires its own security sign-off, separate from WI-03 and separate from any sign-off attached to the Mac desktop app.
- **Coordinator ownership rule** (`AGENTS.md`) — every state-changing operation the bridge exposes MUST route through `OcrProcessingCoordinator` and `appendOcrStatusOnce`. The bridge MUST NOT own lifecycle.
- **`case-box-plan.md` cross-cutting invariant #4** — documents never leave local storage unless `confidentiality_class == normal` AND the user explicitly authorized an external worker for that document. The bridge inherits this constraint at its inbound boundary.
- **WeChat mini-program runtime** consumes HTTP/HTTPS only. It cannot consume Node `file:` library dependencies. The bridge is the WeChat-mini-program-accessible surface when the mini-program ships.

## Decision

**Adopt an opt-in narrow HTTP bridge subsystem that the Mac desktop app exposes only when the lawyer explicitly enables a companion channel** (WeChat mini-program access, cloud sync for a specific document/matter, or any device-to-device review handoff).

The bridge:

- **Is off by default.** No network listener runs in the v1 desktop app's default workflow. The bridge starts only when the lawyer enables a companion channel.
- **Exposes a narrow surface.** A strict subset of the endpoints drafted in `docs/ui/sync-bridge-contract-draft.md`. v1 mini-program needs: read case summary, read OCR job status, read a specific reviewable page, accept/reject a candidate fact, attach a quick note. NOT submit-new-document, NOT bulk-export, NOT privilege-log export.
- **Routes every write through the coordinator.** The bridge is a delivery layer; it owns no lifecycle. Coordinator-mediated cancel is the canonical example.
- **Enforces per-document/per-matter opt-in.** Every inbound read or write is checked against the lawyer's explicit sync grant for the target document/matter. No sync grant → 404 (deliberately undifferentiated from "does not exist" to avoid leaking the existence of unshared records).
- **Audits every operation.** Reads MAY log; writes MUST log. Audit events flow into the same hash-chain `case-box-plan.md` D2.1 already defines.
- **Authenticates** when v1+ ships the bridge — but the auth provider is a Stop-and-Ask gate. Test-mode auth is the only seam in scope here.
- **Validates submission payloads** when (and only when) the bridge ever surfaces a write to OCR ingestion (post-v1-day-one). The same `validateSubmission` invariant the desktop app uses at the IPC boundary applies here at the HTTP boundary.
- **Maps errors through a stable envelope.** Reuses the error-envelope shape from `docs/ui/sync-bridge-contract-draft.md` §E. Internal `HttpsTransportError` codes (WI-03b/c) MUST NOT leak.

Concrete package shape (NOT authorized for implementation here):

```
services/lawbar-sync-bridge/         (NEW — name TBD at CLIENT-01-style gate)
├── package.json                     (private, type:module, depends on ocr-ingestion + ocr-review + ocr-worker + ocr-persistence via file:)
├── src/
│   ├── routes/                      (one file per endpoint family; narrow subset of sync-bridge-contract-draft.md)
│   ├── auth/                        (auth provider seam — interface only in v1)
│   ├── grants/                      (per-document/per-matter opt-in enforcement)
│   ├── context/                     (request-scoped tenant / principal / request_id)
│   ├── errors/                      (HTTP error mapping + envelope)
│   ├── observability/               (audit log, request_id propagation)
│   └── index.ts                     (public entry: makeSyncBridgeServer(deps))
└── tests/
    ├── routes/                      (per-route contract tests with fake ingestion/review/coordinator/grants)
    ├── grants.test.mjs              (opt-in enforcement)
    ├── auth.placeholder.test.mjs    (auth seam — test-mode only in v1)
    └── error-mapping.test.mjs       (no HttpsTransportError leakage)
```

The HTTP framing choice (raw `node:http`, Fastify, Hono, tRPC, JSON-RPC, OpenAPI-generated, etc.) is deferred to the implementation WI. This ADR fixes the architecture; framework selection is the next layer down.

## Options considered

### Option α — Single primary HTTP gateway (GW-00's original framing)

Rejected by `docs/adr/client-application-surface.md`. Restated here for completeness: putting an HTTP surface on the v1 lawyer's default workflow contradicts D2 Q3 (local-first by default) and adds unnecessary operational complexity for a single-user-on-Mac workflow.

### Option β — Opt-in narrow companion bridge (chosen)

This ADR. Off by default; on per-document or per-matter opt-in. Narrow subset of GW-00's drafted endpoint set. Routes through coordinator. Inherits `case-box-plan.md` confidentiality invariant at inbound boundary.

| Criterion | Verdict |
|---|---|
| Preserves D2 Q3 local-first default | ✅ — bridge is off until the lawyer opts in |
| Preserves D2 Q4 deferred auth | ✅ — auth provider remains Stop-and-Ask; test-mode-only in this ADR |
| Enables WeChat mini-program (deferred companion) | ✅ — HTTP/HTTPS is the only surface a mini-program runtime can consume |
| Enables per-document/per-matter cloud sync | ✅ — bridge is the network seam for any cloud target |
| Coordinator ownership rule preserved | ✅ — every write goes through `OcrProcessingCoordinator` |
| WI-03 outbound posture preserved | ✅ — bridge does not change the worker's outbound fetcher |
| Adds inbound attack surface | ⚠️ — requires its own security sign-off (separate from WI-03 and separate from client-application-surface) |
| Auditability | ✅ — every operation produces an audit event in the same hash-chain |
| Multi-tenant SaaS forward compatibility | ✅ — `tenant_id` validated at the bridge boundary; data shape stays multi-user-ready |
| v1-day-one shipping requirement | ✅ — bridge does NOT need to ship at v1 day one |

### Option γ — Embed mini-program/sync logic in the desktop main process (no separate bridge)

Reject. The mini-program runtime is a separate sandboxed process on a different device; it cannot speak IPC to the Mac desktop main process. Cloud sync targets are also external. Either path requires a network boundary; that network boundary is what this ADR formalizes.

### Option δ — Defer the bridge decision entirely until the mini-program is actually being built

Considered. Rejected because:

- Two existing artifacts (`docs/adr/ocr-ui-gateway-architecture.md` and `docs/ui/ui-gateway-contract-draft.md`) already imply a framing. Leaving them in conflict with `client-application-surface.md` leaves the repo internally inconsistent.
- The mini-program and per-document cloud sync are stated future surfaces. Recording the architecture now (without authorizing implementation) is cheaper than re-deriving it under the pressure of an actual mini-program release.
- The endpoint draft (`sync-bridge-contract-draft.md` after rename) is already useful evidence; preserving it in narrower form is cheaper than discarding it.

## Recommendation

**Option β — opt-in narrow companion bridge.**

This ADR records the architecture only. No implementation is authorized. The first implementation WI (SYNC-01) is the bridge scaffold (read-only mini-program surface); subsequent WIs add writes, cloud sync, and the WeChat mini-program client itself.

## Consequences

### Positive

- The Mac desktop app's v1 architecture is unaffected — bridge is opt-in.
- WeChat mini-program access has a clear architectural home.
- Per-document/per-matter cloud sync has a clear architectural home.
- The existing endpoint draft (renamed to `sync-bridge-contract-draft.md`) gives the implementation WI a concrete target without freezing it.
- Coordinator-ownership and `case-box-plan.md` confidentiality invariants extend naturally to the bridge's inbound boundary.

### Negative

- The bridge introduces an inbound attack surface that needs its own security sign-off, separate from WI-03 (outbound only) and separate from the client-application-surface ADR.
- An auth provider must be chosen before the bridge can ship to production. v1 desktop can ship without one; the bridge cannot.
- The bridge adds a second deployable (a sync-bridge server) when sync ships. v1-day-one stays one-binary.
- Cross-device write conflict resolution (mini-program writes vs Mac desktop writes to the same record) is a new design problem the bridge's implementation WI must solve.

### Neutral

- The bridge is additive: existing per-package tests stay green. No change to `ocr-worker`, `ocr-persistence`, `ocr-ingestion`, `ocr-review`, or `docs/contracts/`.

## Security considerations

The bridge introduces a NEW inbound attack surface. WI-03's sign-off does NOT cover this surface. The following must each be addressed by a dedicated SYNC-00-followup security WI before any production exposure:

1. **Inbound authentication.** No provider chosen. v1 placeholder is `Authorization: Bearer <opaque-token>`. Provider choice (custom JWT, third-party IdP, WeChat-specific session, etc.) is a Stop-and-Ask decision per `AGENTS.md`. Test-mode auth seam is the only authentication allowed in this ADR's scope.
2. **Tenant isolation.** Every route either derives `tenant_id` from the principal or cross-checks a URL/body `tenant_id` against the principal's allowed tenants. Mismatch → 403 `tenant_mismatch`, logged as a security event.
3. **Per-document / per-matter opt-in enforcement.** The bridge MUST consult a `sync-grants` table before exposing ANY record. No grant → undifferentiated 404. This enforces `case-box-plan.md` cross-cutting invariant #4 ("documents never leave local storage unless authorized for external worker").
4. **Coordinator-mediated writes.** Every write that touches OCR or case-box lifecycle MUST route through the coordinator. Direct `OcrPersistence` writes from the bridge are forbidden. Mirrors the desktop app's IPC-layer rule.
5. **No SSRF re-introduction.** The bridge MUST NOT fetch URLs supplied in inbound requests. Submission URLs (if the bridge ever exposes submission, post-v1-day-one) flow to the worker's `fetchPageBytes`, which is already SSRF-hardened per WI-03. The bridge MUST NOT preview, validate, or otherwise GET them itself.
6. **Request validation.** Any submission payload accepted by the bridge MUST be re-validated against `ocr-submission.schema.json` via `validateSubmission` before invoking `ingestDocumentForOcr`.
7. **Error mapping.** `IngestionError`, `OcrPersistenceError`, `OcrQueueError`, and `FetcherError` codes map to HTTP status + the stable JSON error envelope from `docs/ui/sync-bridge-contract-draft.md` §E. Internal `HttpsTransportError` codes (WI-03b/c) MUST NOT leak. An error-mapping test mirroring `services/ocr-worker/tests/fetcher.public-surface.test.mjs` enforces this on the HTTP side.
8. **Rate limiting + quota.** Per-principal and per-tenant rate limits required as design hooks; concrete values deferred to operations.
9. **Audit logging.** Every operation produces a hash-chained audit event per `case-box-plan.md` D2.1. Reads MAY log; writes MUST.
10. **TLS termination.** Strategy (bridge-terminated vs reverse-proxy-terminated) deferred to the deployment WI. Bridge MUST run behind TLS in any production environment.
11. **No re-introduction of pooled HTTPS / HTTP/2 / proxy on the worker.** ADR-11D.2-A's protocol-surface guardrails stand. The bridge's existence does not authorize the worker to start pooling sockets.
12. **CORS.** Mini-program runtime CORS posture is permissive only for the registered mini-program origin. Browser-origin requests are out of v1 scope and MUST be rejected until a browser SPA is explicitly authorized.

The bridge's security sign-off goes under `docs/release/` (proposed file name: `docs/release/sync-00-security-signoff.md`) when the bridge implementation lands. WI-03's sign-off stays untouched.

## Tenant / auth considerations

This ADR treats auth and tenant as **unresolved but required before any production exposure of the bridge**. The implementation MAY start with a test-mode auth seam (interface-only) so that route shapes, contract tests, and error mapping can be developed without committing to a provider.

Test-mode posture (v1 pre-production):

- Auth seam exists as a TypeScript interface (`AuthProvider`) with one implementation: `TestModeAuthProvider({ allowedPrincipals })` for tests.
- All routes require the seam. There is no `--unsafe` flag or environment-driven auth bypass.
- Production-mode posture is a follow-up WI requiring user authorization (auth/authorization Stop-and-Ask gate).

Tenant model:

- Every route accepts `tenant_id` in URL/body OR derives it from the principal. Both forms must agree, or the request is rejected.
- The bridge never trusts a `tenant_id` from the request body without cross-checking against the principal's authorized tenant list.
- Per-document / per-matter scoping (`document_id`, `case_id`, `matter_id`) follows the same pattern; presence of a sync grant is required before the record is surfaced.

## Test strategy

Inherits the existing per-package test posture: `node:test`, file-backed temp DBs, strict TDD if configured.

Layers:

1. **Contract tests per route.** Asserts request shape, response shape, error mapping, and status codes against fake `ocr-ingestion` / `ocr-review` / coordinator / sync-grants deps. No live DB.
2. **Grant-enforcement tests.** Every route exercised under (a) grant present → success, (b) grant absent → 404, (c) grant present but for different tenant → 403.
3. **End-to-end tests.** Bridge → real `ocr-ingestion` → real `ocr-persistence` (file-backed temp DB) → real coordinator on a tiny scenario; sync-grants table populated.
4. **Auth-seam tests.** Test-mode provider rejects unknown principals, rejects cross-tenant requests, and propagates `tenant_id` correctly.
5. **Error-mapping tests.** No internal error discriminator leaks. Modelled on `services/ocr-worker/tests/fetcher.public-surface.test.mjs`.
6. **Schema-validation tests.** Bridge re-runs `validateSubmission` before invoking `ingestDocumentForOcr` (for any future submission endpoint).

## Migration plan

No data migration. No contract migration. No persistence migration. The sync-grants table is a NEW persistence table introduced when the bridge implementation begins; it does NOT touch existing OCR persistence schemas.

Code migration is fully additive:

1. **SYNC-00 (this ADR):** decision recorded. Endpoint draft renamed and re-scoped. **No code.** Executed as the same commit that lands this ADR.
2. **SYNC-01 (Stop-and-Ask: inbound network surface + framework dependency):** bridge scaffold (package.json, tsconfig, empty routes folder, test scaffolding, auth seam interface, sync-grants persistence schema). HTTP framework selection at this gate.
3. **SYNC-02:** read-only endpoints first (case summary, OCR job status, reviewable page). Mini-program clients can poll for status without any write surface.
4. **SYNC-03:** accept/reject candidate fact + quick-note write endpoints, routed through coordinator. First sync-bridge security sign-off prior to merge.
5. **SYNC-04:** sync-grants management UI surface (Mac desktop app), exposing per-document and per-matter opt-in to the lawyer.
6. **SYNC-05+:** cloud sync target adapters (Stop-and-Ask: external account / cloud vendor).
7. **SYNC-06+:** WeChat mini-program client (Stop-and-Ask: external account, third-party SDK, Chinese-business-entity registration).

This list is illustrative for the migration plan and is NOT an authorization to execute. Each step is a separate WI with its own predecessors and Stop-and-Ask gates.

## Non-goals

This ADR does NOT:

- Implement any bridge code.
- Choose an HTTP framework.
- Choose an authentication provider.
- Choose a cloud storage backend.
- Design the WeChat mini-program client itself.
- Add a runtime dependency.
- Change any existing package's exports, types, schemas, or persistence behavior.
- Authorize implementation.
- Widen WI-03's security sign-off.
- Decide deployment topology beyond "bridge runs behind TLS in production".
- Specify rate-limit values, quota policies, or audit-log retention.
- Pre-commit to a sync conflict resolution model.

## Open questions / explicit unknowns

1. **HTTP framework.** Implementation WI must pick. Prefer minimal-dependency options (raw `node:http` with a tiny router, or Hono on Node) to keep the dependency surface small.
2. **Auth provider.** Genuinely unknown without more product context. WeChat-session integration is plausible; lawyer-firm SSO via SAML/OIDC is plausible; custom token is plausible. Stop-and-Ask.
3. **Sync conflict resolution.** When the mini-program and the Mac desktop both write the same record, who wins? Architecture decision deferred to SYNC-03 implementation.
4. **Cancel endpoint write semantics.** The coordinator-mediated cancel function does not exist yet; CLIENT-05 in `client-application-surface.md` is the small backend WI that adds it. The bridge cancel endpoint depends on CLIENT-05.
5. **Polling vs streaming.** Mini-program runtime supports limited streaming. v1 contract draft assumes polling. Revisit when polling cadence becomes a problem.
6. **Pagination cursor format.** `ocr-persistence` already owns cursor format (`cursor.ts`); the bridge propagates it opaquely.
7. **Manual-corrections write path (S4-write per UI-00).** Not contracted today. Out of scope.
8. **Public-internet exposure vs intranet-only.** Affects rate-limit defaults, audit-log retention, TLS configuration.
9. **CORS posture for browser SPA.** Deferred until a browser client is authorized.

## References

- `dev-memo/plan-client-00.md` — reconciliation plan; D2 source.
- `docs/adr/client-application-surface.md` — sibling ADR for the v1 primary client.
- `docs/ui/sync-bridge-contract-draft.md` — companion-bridge endpoint reference (formerly `ui-gateway-contract-draft.md`).
- `docs/ui/current-ui-map.md`, `docs/ui/ui-state-contract.md`, `docs/ui/ui-gap-report.md` — UI surface inventory.
- `dev-memo/case-box-plan.md` — case-box layer + cross-cutting invariants (untracked, pending CLIENT-00b promotion).
- `docs/release/wi-03-security-signoff.md` — outbound-fetcher sign-off (does NOT cover the bridge).
- `docs/contracts/src/transitions.ts` — `web_app` actor, `ALLOWED_EDGES`, cancel ownership.
- `services/ocr-review/src/types.ts`, `services/ocr-review/src/index.ts` — read-model.
- `services/ocr-ingestion/src/types.ts`, `services/ocr-ingestion/src/index.ts` — submission types + ingestion error codes.
- `services/ocr-worker/src/fetcher/types.ts` — `FETCHER_ERROR_CODES`.
- `services/ocr-worker/src/index.ts` — coordinator types (required for cancel endpoint).
- `docs/release/go-live-plan.md` — Stop-and-Ask gates, per-package test commands.
- `AGENTS.md` — coordinator-ownership rule, mutation policy, security/auth/cloud Stop-and-Ask gates.
