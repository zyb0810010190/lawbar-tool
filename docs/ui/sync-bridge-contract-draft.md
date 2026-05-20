# Sync Bridge Contract Draft (SYNC-00 companion)

**Status**: **Draft.** Not implemented. Not authoritative. Companion to `docs/adr/sync-bridge-architecture.md`.

**History**: This file was originally drafted as `docs/ui/ui-gateway-contract-draft.md` companion to the uncommitted GW-00 ADR (`docs/adr/ocr-ui-gateway-architecture.md`). PLAN-CLIENT-00 (commit `a07e5d1`, recommendation Option β) reframed the architecture as:

- **Primary v1 client** = Mac desktop app, in-process embedding (`docs/adr/client-application-surface.md`). No HTTP, no network on the default workflow.
- **Companion surface** = opt-in narrow HTTP bridge for WeChat mini-program + per-document/per-matter cloud sync (`docs/adr/sync-bridge-architecture.md`).

This file is renamed and re-scoped accordingly. The endpoint sketches below are preserved as reference for the sync bridge; **none of them are v1-day-one** because the bridge itself is post-v1-day-one. The implementation WI MAY revise any shape below; this draft is a target, not a freeze.

**Conventions** (unchanged from the original GW-00 draft):

- Versioned URL prefix `/v1/...`. Future contract changes bump to `/v2/...`; `/v1/...` stays stable.
- All requests and responses are JSON unless noted.
- All routes require auth (see §0). The placeholder is `Authorization: Bearer <opaque-token>`; the auth provider is a Stop-and-Ask decision deferred to a follow-up WI.
- All routes are tenant-scoped. Either the URL/body carries `tenant_id` and the bridge verifies it against the principal, or the bridge derives `tenant_id` from the principal alone.
- All routes that surface a document, case, OCR job, or candidate fact are **additionally grant-scoped**: an explicit sync grant for the target document/matter must exist or the response is 404 (deliberately undifferentiated). See `docs/adr/sync-bridge-architecture.md` §"Security considerations" #3.
- Errors use a stable envelope (§E).

---

## §SCOPE — v1 sync-bridge endpoint inclusion

The bridge is opt-in and post-v1-day-one. The implementation WI ladder is sketched in `docs/adr/sync-bridge-architecture.md` §"Migration plan". The endpoints below are tagged by the first SYNC-step that surfaces them:

| Endpoint | v1-day-one? | First SYNC step | Notes |
|---|---|---|---|
| §1 POST /v1/ocr/jobs (submit) | No | post-v1-bridge | Submission via bridge is NOT v1-day-one. Default v1 path is desktop-app IPC → `ingestDocumentForOcr` directly. The bridge MAY add submission later for mini-program-originated submissions, post sign-off. |
| §2 GET /v1/ocr/documents/:document_id/jobs (job list) | Bridge: yes (read-only) | SYNC-02 | First mini-program read surface. |
| §3 GET /v1/ocr/jobs/:job_id (lifecycle) | Bridge: yes (read-only) | SYNC-02 | First mini-program read surface. |
| §4 GET /v1/ocr/jobs/:job_id/summary | Bridge: yes (read-only) | SYNC-02 | Compact summary call. |
| §5 GET /v1/ocr/jobs/:job_id/pages/:page_id | Bridge: yes (read-only) | SYNC-02 | First mini-program review surface. |
| §6 GET /v1/ocr/manual-review-pages | Bridge: yes (read-only) | SYNC-02 | Reviewer worklist surface. |
| §7 POST /v1/ocr/jobs/:job_id/cancel | No at SYNC-02; yes at SYNC-03 | SYNC-03 | First mini-program write surface. Depends on CLIENT-05 (coordinator-mediated cancel function) per `docs/adr/client-application-surface.md`. |
| §8 GET /healthz, GET /readyz | Bridge: yes when bridge runs | SYNC-01 | Operator surface. |

Endpoints not in this table (candidate-fact accept/reject, quick-note attach, sync-grants management, cloud-sync target adapters) are deferred to subsequent SYNC steps and have no draft shape here yet.

---

## §0 Auth + tenant header conventions

| Element | v1 placeholder | Notes |
|---|---|---|
| Auth header | `Authorization: Bearer <opaque-token>` | Provider TBD (Stop-and-Ask). The token must resolve to a principal with one or more allowed tenant IDs. Test-mode auth is the only seam in scope for SYNC-00. |
| Tenant scoping | URL/body `tenant_id` cross-checked against principal's allowed tenants | Mismatch → 403 with `code: "tenant_mismatch"`. Cross-tenant attempt logged as security event, not 4xx. |
| Sync grant scoping | Implicit on every record-bearing route | No grant present for the target document/matter → 404 with `code: "not_found"`. Differentiating "exists but no grant" from "does not exist" leaks confidentiality. |
| Request ID | `X-Request-Id` (client-supplied) OR bridge-generated ULID | Echoed in response header and audit log. Used for tracing through the worker. |
| Idempotency | `Idempotency-Key` on POST routes | v1 reserved; implementation WI defines the deduplication window. |

Cross-cutting headers on every response:
- `X-Request-Id`
- `Content-Type: application/json; charset=utf-8`

---

## §E Error envelope

All non-2xx responses share one shape:

```ts
interface ApiErrorBody {
  error: {
    code: string;            // stable, machine-readable; never a renamed internal code
    message: string;         // human-readable; safe to surface to operators
    details?: Record<string, unknown>; // optional structured detail (e.g. field-level validation)
    request_id: string;      // echoes X-Request-Id
  };
}
```

Mapping principles (unchanged from the original draft):

| Underlying error class | Mapped to | HTTP status |
|---|---|---|
| `IngestionError` (any code) | `code: <ingestion code or "ingestion_failed">` | 400 |
| `FetcherError` with code in `FETCHER_ERROR_CODES` | `code: <verbatim fetcher code>` | 400 (operator-input class) or 502 (network/source class). Mapping table TBD by implementation WI. |
| `OcrPersistenceError` | `code: "persistence_failed"` | 500 (internal); detail elided from message |
| `OcrQueueError` (`dedupe_conflict`/`unknown_receipt`/`stale_receipt`/`lease_expired`/`invalid_claim`) | `code: <verbatim queue code>` | 409 for `dedupe_conflict`; 500 for the rest (should not surface to UI callers, but defense in depth) |
| Auth/tenant failure | `code: "unauthorized"` / `code: "tenant_mismatch"` | 401 / 403 |
| Sync-grant absent for target record | `code: "not_found"` | 404 |
| Schema validation failure (`validateSubmission` returns `ok:false`) | `code: "schema_invalid"`, `details: { errors }` | 400 |
| Internal `HttpsTransportError` codes (WI-03b/c) | MUST NOT appear in `code` | — (enforced by an error-mapping test mirroring `fetcher.public-surface.test.mjs`) |

The bridge MUST NOT expose `HttpsTransportError` discriminators (e.g. `ADDRESS_PRIVATE`, `RESPONSE_ABORTED`). These are internal to the worker. Surfacing them would widen the public API surface beyond `FETCHER_ERROR_CODES` and violate the WI-03 boundary.

---

## §1 Job submission — POST /v1/ocr/jobs (post-v1-bridge)

**Surface served by**: not v1-day-one bridge. Desktop app IPC handles submission for v1; bridge submission is deferred until a mini-program submission flow is explicitly authorized.

| Aspect | Value |
|---|---|
| Method | `POST` |
| Path | `/v1/ocr/jobs` |
| Backing TS | `services/ocr-ingestion/src/ingest.ts` → `ingestDocumentForOcr(input, deps)` |
| First sync step | Post-v1-bridge (no SYNC step yet) |

**Request body** (JSON):

```ts
// Mirrors DocumentIngestionInput in services/ocr-ingestion/src/types.ts
{
  tenant_id: string;            // must match principal's allowed tenants
  case_id?: string;
  document_id: string;
  document_revision?: number;
  submitted_by: string;         // SHOULD equal principal.id; bridge warns on mismatch
  pages: Array<{
    page_id: string;
    page_number: number;
    source: OcrSubmission["pages"][number]["source"]; // file | https | inline per contract
  }>;
  ocr_options?: Partial<OcrSubmission["ocr_options"]>;
  preprocessing?: OcrSubmission["preprocessing"];
  priority?: number;
  deadline?: string;
  retry?: OcrSubmission["retry"];
  metadata?: Record<string, unknown>;
}
```

**Response 201** (Created):

```ts
{
  job_id: string;
  enqueued: boolean;
  atomic: boolean;
  created_at: string;
  current_state: "queued";
}
```

**Error mapping**: `validateSubmission` reject → 400 `schema_invalid`; `IngestionError` → 400; `OcrQueueError({ code: "dedupe_conflict" })` → 409; `OcrPersistenceError` → 500.

**Notes**:
- Bridge MUST NOT fetch `source.url` itself. SSRF posture is owned by the worker per WI-03.
- `submitted_by` may differ from the principal (paralegal submitting on a lawyer's behalf); bridge records the principal in the audit log regardless.
- When this endpoint ships, the lawyer must have an explicit per-matter "accept-inbound-submission" grant. Default = off.

---

## §2 Job list — GET /v1/ocr/documents/:document_id/jobs

**Surface served by**: SYNC-02 (first mini-program read).

| Aspect | Value |
|---|---|
| Method | `GET` |
| Path | `/v1/ocr/documents/:document_id/jobs` |
| Query | `tenant_id` (required if not derivable from principal), `cursor`, `limit` |
| Backing TS | `services/ocr-review/src/crossJob.ts` → `listOcrJobsForDocument` |

**Response 200**:

```ts
{
  rows: Array<OcrDocumentJobSummary>;  // services/ocr-review/src/types.ts:145
  next_cursor: string | null;
  total_known?: number;
}
```

`OcrDocumentJobSummary` fields are surfaced verbatim — field names are load-bearing per `docs/ui/ui-state-contract.md`.

**Error mapping**: standard. Tenant mismatch → 403. Sync grant absent → 404.

---

## §3 Job lifecycle — GET /v1/ocr/jobs/:job_id

**Surface served by**: SYNC-02.

| Aspect | Value |
|---|---|
| Method | `GET` |
| Path | `/v1/ocr/jobs/:job_id` |
| Backing TS | `services/ocr-review/src/lifecycle.ts` → `getOcrJobLifecycle` |

**Response 200**:

```ts
{
  job: OcrJobRecord;
  statuses: OcrStatusEvent[];
  results: OcrResultRecord[];
  current_state: OcrJobState | undefined;
  is_terminal: boolean;
  terminal_state: OcrJobState | undefined;
}
```

**Response 404**: `job_id` not within the principal's tenants OR no sync grant for the parent document. Body uses `code: "not_found"` deliberately to avoid leaking tenant-scoping or grant-state information.

**Polling**: clients poll while `is_terminal === false`. Cadence is client policy; the bridge may add `Cache-Control: max-age=N` once a job is terminal.

---

## §4 Document / job summary — GET /v1/ocr/jobs/:job_id/summary

**Surface served by**: SYNC-02.

| Aspect | Value |
|---|---|
| Method | `GET` |
| Path | `/v1/ocr/jobs/:job_id/summary` |
| Backing TS | `services/ocr-review/src/summary.ts` → `summarizeOcrIngestionOutcome` |

**Response 200**: `OcrIngestionOutcomeSummary` from `services/ocr-review/src/types.ts:106`. Per-page counts, `failed_page_ids`, `pages_needing_manual_review`, `dead_lettered`, `retry_count`.

Doubles as the failure / error summary surface: when `current_state === "failed"` or `terminal_state === "dead_lettered"`, the client uses `failed_page_ids` + a follow-up §5 fetch per failed page.

---

## §5 Reviewable page — GET /v1/ocr/jobs/:job_id/pages/:page_id

**Surface served by**: SYNC-02.

| Aspect | Value |
|---|---|
| Method | `GET` |
| Path | `/v1/ocr/jobs/:job_id/pages/:page_id` |
| Backing TS | `services/ocr-review/src/page.ts` → `getReviewableOcrPage` |

**Response 200**: `ReviewableOcrPage` from `services/ocr-review/src/types.ts:51`. Includes `outcome`, `text_preview`, `raw_text`, `manual_review_recommended`, `manual_review_reasons`, `detected_seals`, `detected_tables`, `evidence_index`, `partial_failure`.

**Response 204**: page exists in submission but no result persisted yet — `getReviewableOcrPage` returns `null`. Client shows "not yet OCR-ed".

**Response 404**: page_id not in submission OR tenant mismatch OR no sync grant.

**Note on manual corrections (S4-write)**: explicitly out of scope. UI-00 flagged this as needing a fresh contract surface. NOT in SYNC-00.

---

## §6 Pages needing manual review — GET /v1/ocr/manual-review-pages

**Surface served by**: SYNC-02.

| Aspect | Value |
|---|---|
| Method | `GET` |
| Path | `/v1/ocr/manual-review-pages` |
| Query | `tenant_id` (required if not derivable), `case_id?`, `cursor?`, `limit?` |
| Backing TS | `services/ocr-review/src/crossJob.ts` → `listPagesNeedingManualReview` |

**Response 200**: `ListPagesNeedingManualReviewResult`. Same cursor semantics as §2.

Results MUST be filtered to documents with active sync grants. Records outside granted documents are silently excluded.

---

## §7 Cancel job — POST /v1/ocr/jobs/:job_id/cancel

**Surface served by**: SYNC-03 (first mini-program write). Depends on CLIENT-05 (coordinator-mediated cancel function in `services/ocr-worker`).

| Aspect | Value |
|---|---|
| Method | `POST` (write — idempotent: cancel of already-cancelled returns 200) |
| Path | `/v1/ocr/jobs/:job_id/cancel` |
| Backing TS | **Does not exist yet.** The contract (`docs/contracts/src/transitions.ts`) names `web_app` as the cancel actor, but no coordinator-mediated cancel function exists in `services/ocr-worker/src/coordinator.ts`. CLIENT-05 is the small backend WI that adds it; SYNC-03 depends on it. |

**Request body**:

```ts
{
  tenant_id: string;
  reason?: string;
  expected_current_state?: OcrJobState;
}
```

**Response 200**:

```ts
{
  job_id: string;
  prior_state: OcrJobState;
  current_state: "cancelled";
  cancelled_at: string;
}
```

**Error mapping**:

- Job already terminal → 409 `already_terminal` with `details.terminal_state`.
- `expected_current_state` mismatch → 409 `state_changed` with current state in `details`.
- Coordinator write failure → 500 `coordinator_failed`. Never bypass coordinator — fail closed.
- No sync grant for parent document → 404 `not_found`.

**Critical**: this endpoint MUST route through the coordinator. It MUST NOT call `appendOcrStatusOnce` directly on persistence. `AGENTS.md` "Coordinator owns lifecycle. Adapter must not own lifecycle." applies fully to the bridge.

---

## §8 Health + readiness — GET /healthz, GET /readyz

**Surface served by**: SYNC-01 (when the bridge process runs).

| Aspect | /healthz | /readyz |
|---|---|---|
| Method | GET | GET |
| Auth | None | None |
| Tenant | None | None |
| Sync grant | None | None |
| 200 condition | Process up | Process up AND persistence reachable AND queue backend reachable |
| 503 condition | Never (200 or no answer) | Any dep unreachable |
| Body | `{ status: "ok" }` | `{ status: "ok" | "degraded", deps: { persistence: "ok" | "error", queue: "ok" | "error" } }` |

`/healthz` is a liveness probe — answers "is this process running?". Never depends on anything external.
`/readyz` is a readiness probe — answers "should this process receive traffic?". Checks persistence + queue.
Neither endpoint returns `tenant_id` or any data — safe to expose publicly.

---

## Coverage matrix vs UI-00 screens

UI-00's S1–S7 surface inventory is delivered primarily by the Mac desktop app's IPC layer (per `docs/adr/client-application-surface.md`). The bridge re-exposes a subset of those surfaces to the WeChat mini-program and to cloud-sync targets. Mapping below tracks bridge coverage only:

| UI-00 surface | Bridge endpoint(s) | Bridge coverage |
|---|---|---|
| S1 Job submission | §1 POST /v1/ocr/jobs | **deferred** post-v1-bridge — desktop app IPC handles v1 submission |
| S2 Job list | §2 GET /v1/ocr/documents/:document_id/jobs | SYNC-02 |
| S3 Job detail | §3 GET /v1/ocr/jobs/:job_id | SYNC-02 |
| S3 header / failure summary | §4 GET /v1/ocr/jobs/:job_id/summary | SYNC-02 |
| S4 Per-page review (read) | §5 GET /v1/ocr/jobs/:job_id/pages/:page_id | SYNC-02 |
| S4 Per-page corrections (write) | none | **out of scope** — needs new contract surface (UI-00 flagged this) |
| S5 Manual-review worklist | §6 GET /v1/ocr/manual-review-pages | SYNC-02 |
| S6 Cancel | §7 POST /v1/ocr/jobs/:job_id/cancel | SYNC-03 (depends on CLIENT-05) |
| S7 Tenant / auth | not a UI screen; cross-cutting auth header per §0 + sync-grant per §SCOPE | bridge-cross-cutting; auth provider Stop-and-Ask |
| operator health | §8 /healthz + /readyz | SYNC-01 |

The desktop app delivers ALL of S1–S7 in v1 via IPC. The bridge delivers a SUBSET to companion clients only, and only post-v1-bridge.

---

## Explicit unknowns / non-decisions

1. **Polling cadence.** Bridge is polling-friendly. SSE / WebSocket / long-poll deferred.
2. **Pagination cursor opacity.** Propagated verbatim from `ocr-persistence`. Implementation must NOT re-encode.
3. **Authorization model granularity.** v1 has principal + allowed-tenants + per-document/per-matter sync grants. Per-field ACLs deferred.
4. **Rate limits.** Required hooks, no values.
5. **Multipart upload for inline submissions.** v1 draft assumes JSON-encoded inline source. Multipart is a possible enhancement; revisit if base64 inflation is a problem. Submission via bridge is post-v1-bridge anyway.
6. **OpenAPI spec.** Optional — implementation WI may choose to publish one. Useful for the WeChat mini-program client generator.
7. **Per-request locale.** OCR target is `zh-Hans`. Error messages SHOULD be locale-aware; v1 may ship English-only and add locale negotiation later.
8. **Sync conflict resolution.** When the mini-program and the Mac desktop both write the same record. Deferred to SYNC-03 implementation per `docs/adr/sync-bridge-architecture.md` §"Open questions" #3.
9. **CORS posture.** Permissive for the registered WeChat mini-program origin. Browser-origin requests rejected until a browser SPA is explicitly authorized.

## Out of scope (companion to ADR Non-goals)

- Any client implementation (Mac desktop, WeChat mini-program, browser SPA).
- Server / framework selection.
- Authentication provider selection.
- Per-route TypeScript code stubs (route file scaffolding belongs to SYNC-01).
- Wire-format negotiation (REST vs JSON-RPC vs tRPC).
- Production deployment topology.
- Mock data for client prototyping.
- Sync-grants management UI surface (handled in the desktop app per `docs/adr/sync-bridge-architecture.md` §"Migration plan" SYNC-04).

## References

- `docs/adr/sync-bridge-architecture.md` — architecture decision this draft serves.
- `docs/adr/client-application-surface.md` — sibling ADR for the v1 primary client.
- `dev-memo/plan-client-00.md` — reconciliation plan; D2 source.
- `docs/ui/current-ui-map.md` §S1–S7 — UI surface this contract partially mirrors.
- `docs/ui/ui-state-contract.md` — state-machine-derived UI contract; all states referenced above derive from it.
- `services/ocr-review/src/types.ts` — read-model types surfaced verbatim.
- `services/ocr-ingestion/src/types.ts` — submission types + ingestion error codes.
- `services/ocr-worker/src/fetcher/types.ts` — `FETCHER_ERROR_CODES` (public).
- `services/ocr-worker/src/index.ts` — coordinator types (for §7 cancel implementation).
- `docs/contracts/src/transitions.ts` — `web_app` actor + `ALLOWED_EDGES`.
