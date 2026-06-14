# PLAN — WeChat Mini Program companion (Gate 0)

**Status**: Gate-0 plan (doc-only). **Authorizes nothing.**
**Type**: PLAN (doc-only).
**Date**: 2026-06-13.
**Author**: Claude Code.
**WI**: WI-WX0 (Gate 0 inspection + plan). No WI-WX1 is authorized by this document.

> This plan exists to record a Gate-0 finding and to scope the decision work that must
> precede any WeChat Mini Program effort. It does **not** authorize implementation, a Mini
> Program skeleton, a bridge, an API service, new dependencies, cloud/public deployment, or
> any contact with real matter data. Every item below that touches a hard stop in
> `.claude/rules/autonomy.md` remains an explicit STOP-AND-ASK.

## 1. Backend / API finding — **Category B**

Shared DTOs / handlers / contracts exist, but **no deployable internet-ready backend
exists** — the only product transport is desktop Electron IPC.

### 1.1 Reusable surfaces that DO exist (path evidence)

- `docs/contracts/case-box-contract/` — typed contract package (`src/`, `schemas/`,
  `fixtures/`, `dist/`). Vocabulary owner; reusable DTO/wire-shape source.
- `services/case-box-persistence/` — persistence **library** (`package.json`
  `main: ./dist/index.js`; no server entrypoint). In-memory + SQLite repos.
- `apps/lawbar-desktop/electron/ipc/caseBoxHandlers.ts` — typed, payload-validated request
  handlers (matter / document / deadline / docket / audit), reusable as a handler layer.

### 1.2 Production surface that is MISSING (path evidence)

- **No deployable authenticated HTTPS backend.** No product `express` / `fastify` / `koa` /
  `http.createServer` entrypoint anywhere in `services/*` or `apps/*`. The only
  `.listen(` / `createServer` matches are TLS **test fixtures**
  (`services/ocr-worker/tests/helpers/tls-server.mjs`, `tls-fixtures.mjs`).
- **Transport is Electron IPC only.** Every handler is `ipcMain.handle(CHANNEL.*, …)`
  (`apps/lawbar-desktop/electron/ipc/caseBoxHandlers.ts`, `electron/main.ts`,
  `electron/preload.mts`). A Mini Program cannot reach Electron IPC.
- **No product HTTP route / server.** No inbound API server; the only gateway-shaped ADRs
  (`docs/adr/ocr-fetcher-https-*`) are *outbound*-fetch security, not an inbound API. The
  `ocr-ui-gateway-architecture.md` ADR referenced by `client-local-first.md` does **not**
  exist on disk.
- **No auth provider / session surface.** No `passport` / `jsonwebtoken` / `jwt` / `oauth` /
  `bcrypt` / `bearer`. Apparent "auth" grep hits are domain vocabulary only
  (`EXTERNAL_OCR_AUTHORIZED` event kinds, the word `session`).
- **Persistence is local SQLite / in-memory, not a network data plane**
  (`better-sqlite3`; `services/case-box-persistence/src/sqlite/`, `…/inMemory*`).

### 1.3 Why B, not A or C

- **Not A** — Category A requires a deployable authenticated HTTP service with tenant/matter
  authorization. None exists.
- **Not C** — Category C is raw local IPC with nothing reusable. Reusable contracts,
  handlers, and a persistence library *do* exist beyond IPC.
- → **B**: reusable DTO/handler/persistence surfaces present; no deployable internet-ready
  backend; desktop IPC only.

## 2. Gate 0 outcome — **HOLD**

The repo was inspectable and this plan could be written, so Gate 0 is **HOLD**, not BLOCKED.

`Gate 0: HOLD` means: planning may proceed; *implementation* may not. The implementation
block is recorded separately in §3 — do not conflate the two. (Gate 0 = "could we inspect
and plan?" → yes → HOLD. Implementation gate = "may we build?" → no → blocked, §3.)

## 3. Implementation status — **BLOCKED**

Blocked pending explicit user authorization for the backend / auth / cloud / legal / entity /
filing decisions enumerated in §4.

**Reason.** Reusable DTO / handler / persistence surfaces exist (§1.1), but:

1. The required **Category-A authenticated HTTPS backend does not exist** (§1.2). A WeChat
   Mini Program can only talk to an internet-reachable HTTPS API with auth and tenant/matter
   authorization — there is nothing for it to consume.
2. **Legal / entity / filing / compliance prerequisites are not proven** — no China business
   entity, no ICP filing, no 小程序备案 (Mini Program registration), no service-category
   qualification, no PIPL / sensitive-PI review, no attorney-confidentiality analysis.
3. **Local-first confidentiality constraints remain unresolved.** `client-local-first.md`
   makes WeChat a *deferred companion only*, makes cloud/sync opt-in and never default-on,
   and lists "Public HTTP API" as a **forbidden v1 framing**. A Mini Program backend would
   expose legal-document data off the lawyer's Mac — the exact posture the rule forbids
   without deliberate, per-action authorization.

### 3.1 Hard-stop gates that block implementation (`.claude/rules/autonomy.md`)

- Choosing an auth provider.
- Choosing a cloud vendor / any public deployment mode.
- Exposing legal documents (real or production-shaped) to external/cloud services.
- New runtime dependencies.
- Public API / wire-format / schema / CLI surface introduction.

Each is an independent STOP-AND-ASK. None is satisfied. None is granted by this plan.

## 4. Next action — decision memo (not implementation)

Before any WeChat Mini Program WI may be proposed for `/cc-suite:review-plan`, author a
**decision memo** that resolves, with explicit user authorization per item:

1. **Backend-service ownership** — who builds/operates the Category-A authenticated HTTPS
   backend; in-house vs managed; reuse of `case-box-contract` DTOs + `case-box-persistence`
   handlers vs a separate service.
2. **Auth-provider choice** — identity, session model, tenant/matter authorization
   (`tenant_id` is retained in schemas for forward-compat only today).
3. **Cloud / public deployment** — vendor, region, network exposure model, and how it
   reconciles with local-first (sync bridge vs server-of-record).
4. **China entity + filings** — business entity, ICP filing, 小程序备案, service-category
   qualification required for a legal-services Mini Program.
5. **Sensitive-PI / PIPL review** — lawful basis, data minimization, cross-border transfer
   rules for legal-matter personal information.
6. **Attorney confidentiality** — privilege / confidentiality obligations when matter data
   leaves the Mac; what a companion channel may ever see (read-mostly, intentionally exposed
   subset per `client-local-first.md`).
7. **Reconciliation with local-first product promises** — explicit divergence record vs
   `client-local-first.md` + `docs/product/`, resolved through the
   client-architecture-reconcile flow, before any ADR.

The decision memo is the prerequisite artifact. Only after it is authored, its hard-stop
items explicitly authorized by the user, and any resulting ADR passes `/cc-suite:review-plan`,
may a concrete implementation WI be drafted.

## 5. Explicitly NOT authorized by this plan

- No **WI-WX1**.
- No Mini Program skeleton / source.
- No bridge / adapter / API-service implementation.
- No production-data wiring.
- No new dependency, endpoint, or deployment.

This is a Gate-0 record. It authorizes no work. The decision memo of §4 is the recommended
prerequisite next artifact (itself doc-only); it is not authorized by this plan and requires
its own go-ahead.

## Appendix A — illustrative, non-binding cost surface (NOT plan-of-record)

> **Non-binding.** The following is an *illustrative* sketch of where effort/cost would land
> IF the §4 decisions were resolved affirmatively. It is **not** a plan of record, is **not**
> estimated, and **must not be implemented in this WI**. It exists only to make the scope of
> the §4 decision memo legible.

- **Backend service** — stand up a Category-A authenticated HTTPS API (reuse contract DTOs +
  persistence handlers, or a separate service); auth + tenant/matter authorization; transport
  hardening.
- **Sync / exposure layer** — define the intentionally-exposed read-mostly subset; opt-in,
  per-matter/per-document grants; audit-event coverage for external exposure.
- **Mini Program client** — WeChat Mini Program shell consuming the HTTPS API (read-mostly +
  minimal write, per `client-local-first.md`).
- **Ops / compliance** — hosting, ICP + 小程序备案, PIPL controls, key custody, monitoring.

Each line above re-triggers one or more §3.1 hard stops and is gated accordingly.

## References

- `.claude/rules/client-local-first.md` — WeChat deferred companion; cloud opt-in; no public
  HTTP API in v1.
- `.claude/rules/autonomy.md` — hard-stop list (auth provider, cloud vendor, external
  document exposure, new deps, public API).
- `.claude/rules/security-boundary.md` — security-sensitive surface discipline.
- `.claude/rules/cc-suite.md` — review-plan broker; required before any high-risk impl WI.
- `docs/contracts/case-box-contract/`, `services/case-box-persistence/`,
  `apps/lawbar-desktop/electron/ipc/caseBoxHandlers.ts` — Category-B evidence (§1.1).
