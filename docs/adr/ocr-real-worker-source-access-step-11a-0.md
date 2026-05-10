# ADR: Real OCR Worker — Source Access + Confidentiality Threat Model (Step 11A.0)

## Status

Accepted. Decision-only. Pins the fetcher contract, the source-kind
strategy, the SSRF/credential/log-redaction posture, the
temp-file lifecycle, the rasterization tooling, the all-pages-rejected
semantics, and the production fail-closed flag for the real OCR
worker series. No code lands in this step.

## Context

ADR-10H staging is closed (10I → 10L on `main` at `1da4c8c`). The
queue/persistence/coordinator pipeline now composes across two real
processes against one SQLite file. The fake worker remains the test
seam.

The next arc replaces the fake worker with a real OCR engine behind
`OcrWorker.process(job)`. Three audit rounds against
`dev-memo/real-ocr-worker-brainstorm.md` (threads `019e0f4e`,
`019e0f56`, `019e0f60`) surfaced the structural decisions that have
to be pinned before any engine work begins. This ADR pins the
non-engine subset; downstream ADRs cover:

| ADR | Scope |
|---|---|
| **11A.0 (this)** | Source access + confidentiality threat model. Fetcher contract. Temp-file lifecycle. Rasterization. All-pages-rejected. Production fail-closed. |
| 11A.1 | Engine bakeoff (PaddleOCR-Python vs RapidOCR-ONNX-Node vs Tesseract baseline). Outputs lockfile. |
| 11A.5 | Engine-output → `OcrResult` mapping + idempotency. Outputs `OcrJobOutcome` JSON Schema. |
| 11B | Runtime / transport per 11A.1 winner. Pins `WORKER_REGISTRY` allowlist + dependency graph. |
| 11C | Implementation + tests. Code lands. |

The ordering is deliberate: this ADR locks the threat-model floor
before any engine choice or runtime detail.

## Decision

### 1. `PageSourceFetcher` ownership

A new type in `ocr-worker-contract` (production surface, NOT under
`testing/`). Node ≥22 inherited from the contract package:

```ts
export interface FetchedPage {
  /** Raw bytes of the page image. Always present. */
  bytes: Uint8Array;
  /** Computed SHA-256 of `bytes`, lowercase hex. Always present. */
  sha256: string;
  /** Validated declared MIME type, OR sniff-derived MIME if the source
   *  did not declare one. Always validated against the resolved bytes
   *  (magic-byte check) before this field is set. */
  mime_type: string;
}

export interface PageSourceFetcher {
  /** Resolve one page's source to bytes. Throws `SourceFetchError`
   *  on rejection. Implementations MUST honour ADR-11A.0's
   *  threat-model rules (SSRF, hash, size, MIME, log redaction). */
  fetch(page: PageRef, opts?: FetchOptions): Promise<FetchedPage>;
}

export interface FetchOptions {
  /** Hard cap on bytes returned. Optional; default 25 MB applied at
   *  the implementation layer. The effective cap is
   *  `min(maxBytes, page.source.byte_size)` when `byte_size` is
   *  declared — declared sizes over the cap are rejected before the
   *  network read begins. */
  maxBytes?: number;
  /** Hard cap on wall-clock time per fetch. Optional; default 30 s
   *  applied at the implementation layer. */
  timeoutMs?: number;
  /** Cancellation signal. Coordinator wires this through the
   *  lease-renewal heartbeat in ADR-11B. */
  signal?: AbortSignal;
}

export class SourceFetchError extends Error {
  /** Stable reason codes (extend post-v1 only with ADR amendment). */
  readonly code:
    | "ssrf_blocked"
    | "tls_required"
    | "expired_url"
    | "size_exceeded"
    | "hash_mismatch"
    | "mime_mismatch"      // declared MIME disagrees with magic-byte sniff
    | "unsupported_mime"   // declared/sniffed MIME is structurally valid but not allowed in v1 (e.g. application/pdf)
    | "decode_failed"
    | "timeout"
    | "transport_error";
  /** Carrier for typed cause without leaking secrets. */
  readonly cause_kind?: string;
  constructor(code: SourceFetchError["code"], message: string, cause_kind?: string);
}
```

`SourceFetchError.message` MUST be redactor-clean (see §6); structured
cause data goes into `cause_kind` (a short tag), never raw.

`PageSourceFetcher` lives in the contract package because it is
engine-agnostic. The implementation lives in `services/ocr-worker/`
(or a sibling `services/ocr-source-fetcher/` if cross-cutting use
emerges; not required for v1). Engine packages do NOT depend on the
fetcher implementation; they receive a `PageSourceFetcher` instance
via constructor injection.

### 2. Source kinds

Per `docs/contracts/schemas/ocr-submission.schema.json`, three kinds
exist: `s3`, `https`, `inline`. ADR-11A.0 supports all three. Each
has its own strategy:

| Kind | Strategy | Hash validation | Notes |
|---|---|---|---|
| `s3` | AWS SDK v3 `GetObjectCommand` against the configured client. Credentials from env or ambient SDK chain. | If `expected_sha256` present → strict match; else compute + audit-log only. | `etag` recorded in audit log but not used for content validation. |
| `https` | Node `fetch` with explicit options (no redirects, scheme allowlist, private-IP rejection). | If `expected_sha256` present → strict match; else compute + audit-log only. | `url_expires_at` checked against system clock with 60 s skew tolerance. Reject if expired. |
| `inline` | Decode `base64` directly. No network. | Schema has NO `expected_sha256` field; integrity = compute SHA-256, log hash + `byte_size` for audit. Verify decoded length matches `byte_size`. | Schema enforces 1 MB max. Skips all SSRF rules (no network involved). |

Future `local-fs` is OUT OF SCOPE for v1. Adding it requires its own
threat-model amendment (path-traversal, symlink-following, mount-
point boundaries).

### 3. SSRF defenses (https source only)

The `https` fetcher MUST:

- **Scheme allowlist**: only `https://`. The schema already enforces
  this via `pattern: "^https://"`; the fetcher re-checks at the
  client side, defence-in-depth.
- **Canonical IP normalization**: every resolved address is
  normalized BEFORE comparison. IPv4-mapped IPv6 (`::ffff:a.b.c.d`)
  is normalized to its IPv4 form so `::ffff:127.0.0.1` rejects on
  the IPv4 loopback rule. IPv6 zone identifiers stripped before
  range matching.
- **Reject non-routable / sensitive ranges** after canonicalization:
  - IPv4: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10` (CGNAT),
    `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`,
    `192.0.0.0/24`, `192.0.2.0/24`, `192.168.0.0/16`,
    `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`,
    `224.0.0.0/4`, `240.0.0.0/4`.
  - IPv6: `::1/128`, `::/128`, `fc00::/7`, `fe80::/10`, `ff00::/8`,
    plus IPv4-mapped equivalents per the normalization rule above.
- **No redirects**: the underlying client sets `redirect: "error"`.
  Operators that need 30x redirects (typical S3 presigned + CDN
  flows) MUST pre-resolve the URL upstream of submission. **HTTPS
  sources that rely on redirects are NOT supported in v1.**
- **TLS minimum**: TLS 1.2. System CA store only; never
  `rejectUnauthorized: false`.
- **DNS pinning mechanism (security boundary)**: implementation MUST
  use undici's `buildConnector` (or an equivalent low-level connector
  whose tests prove the dialed socket address equals the validated
  DNS result) that performs DNS resolution ONCE, validates the
  resolved address against the rules above, and dials that address.
  The hook MUST NOT rewrite the URL host to the IP; it MUST PRESERVE:
  - the original URL `Host` header (sent in the HTTP request line),
  - the TLS `servername` (SNI) derived from the original hostname.
  Rewriting the URL to use the IP would break SNI and certificate
  hostname verification. Plain `fetch(url, { redirect: "error" })`
  alone is INSUFFICIENT — it does not guarantee the underlying
  socket goes to the resolved IP. Because no redirects are followed,
  per-hop pinning is not required.

  ADR-11C tests MUST include:
  - a synthetic DNS-rebind probe (initial DNS reply is public,
    second reply is private) where only the first resolution is
    used and the dialed socket address is asserted to be the public
    one;
  - an assertion that the dialed socket's remote address equals the
    validated DNS result (not just that headers look right);
  - an assertion that the request `Host` header matches the original
    hostname;
  - an assertion that the TLS `servername` (SNI) matches the
    original hostname.
- **`url_expires_at` check**: reject if `now > url_expires_at + 60s`.

The `s3` fetcher relies on the AWS SDK v3's connection management;
the SDK does not follow arbitrary redirects to non-S3 hosts. SSRF
risk is bounded by the SDK's hostname construction.

The `inline` source bypasses NETWORK SSRF rules only. Parser-exploit
risk (malicious PDF / image content) is NOT bypassed: MIME validation,
size cap, and rasterizer/decoder sandbox + timeout rules in §8 still
apply to inline-supplied bytes.

### 4. Hash / size / MIME validation

For all source kinds:

- **Size cap**: effective cap = `min(FetchOptions.maxBytes ?? 25_000_000, page.source.byte_size)` when `byte_size` is declared.
  - If declared `byte_size > maxBytes` → reject BEFORE any network read with `size_exceeded`.
  - During the read, abort + reject as soon as the cap is exceeded.
  - For `inline`, the schema's 1 MB cap and declared `byte_size` provide the cap before any decode.
- **`expected_sha256` (s3/https only)**: if present, the fetcher MUST
  compute SHA-256 of the fetched bytes and reject (`hash_mismatch`)
  on disagreement.
- **`byte_size` (all kinds when present)**: the fetcher MUST verify
  resolved bytes match this length exactly. Reject (`size_exceeded`)
  on mismatch. Required by schema for `inline`; optional for
  `s3` / `https`.
- **`mime_type` (when declared)**: the fetcher MUST verify the
  resolved bytes' magic-bytes are consistent with the declared MIME.
  Reject (`mime_mismatch`) on integrity disagreement (e.g. declared
  `image/png` but bytes are JPEG).
- **MIME allowlist (v1)**: after magic-byte validation, the resolved
  MIME MUST be one of `image/png`, `image/jpeg`, `image/tiff`,
  `image/webp`. Any other structurally-valid MIME — including
  `application/pdf` — is rejected with `unsupported_mime` (NOT
  `mime_mismatch`; the bytes-vs-declaration check passed, but the
  v1 worker policy rejects the type). See §8 for the PDF deferral.
- If `mime_type` is absent, magic-byte sniff produces a derived
  MIME used downstream. The fetcher SHALL NOT attempt content-
  sniffing fallback for arbitrary unknown types; sniff failure
  rejects with `mime_mismatch`.

Audit-log fields per fetch (REDACTED; see §6):

```
{
  job_id, page_id, kind, hash_sha256, byte_size, mime_type,
  fetch_ms, outcome: "ok" | "rejected:<reason>"
}
```

### 5. Confidentiality posture

C5 (default = local OCR; cloud opt-in PER DOCUMENT) is restated
here as a hard rule. Concretely:

- **No cloud OCR backend in v1.** ADR-11A.1 bakeoff is local
  candidates only.
- **Cloud opt-in policy SHAPE** (deferred substantive impl to
  post-v1):

  ```
  submission.metadata.cloud_authorization?: {
    backend: "aliyun" | "google_vision" | "...";
    authorized_by: string;       // user id
    authorized_at: string;       // ISO-8601
    scope: "this_submission";    // narrowest possible
  }
  ```

  The fetcher itself does NOT consume this field — cloud OCR routes
  the submission to a different worker entirely. The fetcher's job
  ends at "bytes in hand"; what happens next depends on the worker.
  Adding the field to the contract schema is its own ADR.
- **Audit-log destination**: ADR-11A.0 does not pin storage; that's
  ADR-11B (it depends on whether audit lives in `ocr-persistence`,
  a side-channel, or both). v1 audit logging targets stderr +
  optional persistence, with redaction below.

### 6. Log redaction

The fetcher MUST NOT log:

- Presigned `https://` URLs verbatim (they may contain auth tokens).
- AWS access keys, session tokens, role ARNs.
- Page content bytes or partial decodings.
- Inline `base64` payloads.

The fetcher SHALL log:

- Resolved hostname (after DNS, for SSRF audit) — but only for the
  `https` kind, and only the host, not the full URL path/query.
- `s3://<bucket>/<hmac-of-key>` for s3 fetches. The key is run
  through HMAC-SHA-256 with a per-process random key minted at
  worker startup; the same key produces stable HMACs within a run
  (so the same object logs identically), but the original key never
  appears in logs and cannot be reversed across runs. The HMAC key
  itself is never logged.
- SHA-256 hash of the fetched bytes.
- Numeric size + MIME type.
- `outcome: "ok" | "rejected:<reason_code>"`.

**Redactor boundary (enforced sink, not just a verbal rule)**:
ADR-11C MUST introduce a single audit-sink wrapper (e.g.
`writeFetcherEvent(event)`) used by every fetcher / rasterizer /
worker code path that would otherwise touch stderr or persistence
audit. Direct `process.stderr.write`, `console.error`, or raw
persistence inserts from fetcher/worker paths are FORBIDDEN.
`SourceFetchError.message` is pre-cleaned at construction so the
sink wrapper sees no secrets even on error paths. ADR-11C test
coverage MUST include negative tests that feed presigned URLs, AWS
credentials, S3 keys, inline base64, and decoder error messages
through the sink and assert no secret leaks. A linting rule (or
test) MUST flag direct stderr writes from fetcher / worker code.

**HMAC restart tradeoff (S3 key)**: the per-process random HMAC key
in §6 makes the same S3 key produce identical hashes WITHIN a worker
run but DIFFERENT hashes across worker restarts. This is intentional
— it prevents long-lived plaintext key disclosure via log
correlation. Operators that need cross-restart correlation MUST
provide a deployment-secret HMAC key via the `OCR_AUDIT_HMAC_KEY`
env var (seam exposed by ADR-11C).

**HMAC key validation requirements**:
- Minimum 32 bytes of entropy.
- Accepted encodings: base64url, base64, or lowercase hex; the
  decoder MUST reject invalid encodings strictly.
- Decoded length below 32 bytes → fail startup with a clear error.
- Per-process random key (when `OCR_AUDIT_HMAC_KEY` is unset) is
  always generated with 32 bytes from `crypto.randomBytes(32)`.
- The HMAC key itself is NEVER logged.

### 7. Temp-file lifecycle

When the runtime path uses temp files (e.g., the fetcher writes to
disk for the rasterizer or sidecar to read; ADR-11B may pick a
different path):

- **Per-process root**: `tmpRoot = mkdtempSync(join(tmpdir(),
  "ocr-worker-"))` once per worker bin process. Mode `0o700`.
- **Per-page files**: `pageFile = join(tmpRoot, sha256(bytes) +
  ".bin")` written with mode `0o600`.
- **Cleanup on success**: `rmSync(pageFile, { force: true })` immediately
  after the page is processed (success OR per-page failure). NEVER
  retain on success.
- **Cleanup on shutdown**:

  ```
  process.once("exit", () => fs.rmSync(tmpRoot, { recursive: true, force: true }))
  ```

  PLUS coordination with the existing 10G graceful shutdown chain:
  the SIGINT/SIGTERM handler must NOT delete files mid-OCR. Order
  of operations on a signal is:

  1. Signal arrives → mark `stopRequested = true`.
  2. In-flight `processOne` finishes (worker reads its temp files).
  3. Worker loop exits its iteration.
  4. `process.exit` listener fires → `rmSync(tmpRoot, …)`.

  The exit-listener is registered at process boot, NOT inside a
  signal handler, so signal-arrival ordering does not race with
  in-flight reads.

- **Cleanup on uncaughtException / unhandledRejection**: best-effort
  synchronous `rmSync(tmpRoot, { recursive: true, force: true })`,
  then re-throw. Diagnostics are logged WITHOUT page contents.

- **Legal-hold semantics**: OUT OF SCOPE for v1. If a future legal-
  hold mechanism requires preserving certain temp files past
  shutdown, it lands in its own ADR.
- **Multi-tenant host posture**: v1 assumes a single-user / single-
  tenant host OR an encrypted local disk. Mode `0o700` on the temp
  root is sufficient under that assumption. Multi-tenant deployment
  (shared host, untrusted local users) requires a deployment-
  hardening ADR (out of scope for v1).

### 8. Rasterization tooling — DEFERRED to v2

Question Q1 — "is `PageRef.source` always image bytes, or sometimes
PDF?" — has a forced answer in v1.

Round-3 plan-review (thread `019e0f6c`) flagged that `pdf.js`
("pure JS") is not pure JS in Node: rendering a PDF page to PNG
requires a Canvas backend, which means a native dep
(`@napi-rs/canvas` or `node-canvas`), bringing back the
cross-platform install friction this ADR chose to avoid. Plus PDF.js
JavaScript-execution / DOS / asset-retention guardrails open a
sub-ADR's worth of decisions.

**Decision**: v1 rejects PDF MIME at the fetcher boundary. The
fetcher's MIME validation (§4) accepts `image/png`, `image/jpeg`,
`image/tiff`, `image/webp` only. `application/pdf` produces an
`unsupported_mime` rejection (the bytes-vs-declaration integrity
check passes; v1 worker policy declines the type). Submitters
needing PDF ingestion MUST rasterize upstream of submission (the
submission producer / ingestion boundary owns this; case-box is the
expected future owner — its own ADR series).

PDF rasterization re-enters scope when v2 adds a
`PdfRasterizer` ADR with:
- Choice of canvas backend (`@napi-rs/canvas` or revisit Poppler).
- PDF parser sandbox: JS execution disabled, render timeout, page-
  count cap, max-pixel cap, font/asset retention rules.
- Multi-page PDF page-mapping: which PDF page corresponds to
  `PageRef.page_number`.

The fetcher contract (§1) returns raw bytes for ALLOWED MIMEs
(image/png, image/jpeg, image/tiff, image/webp). PDF MIME is
rejected at the fetcher boundary in v1 (§4); the worker therefore
never dispatches PDF bytes. v2 may re-enable PDF: at that point a
new `PdfRasterizer` ADR moves the dispatch decision to the worker
layer and the fetcher's MIME allowlist widens.

### 9. All-pages-rejected semantics (Q5 resolution)

Per the brainstorm's R3 audit finding D2#3, mapping
"all-pages-fetcher-rejected" to `terminal_state=partial_succeeded`
is contract abuse — `partial_succeeded` requires at least one
successful page.

**Decision**: the worker MUST throw when all pages of a job fail to
fetch. The 10C coordinator catches the throw and immediately calls
`queue.requeueClaim(claim)`. The coordinator returns the `requeued`
outcome. Persistence remains non-terminal (no `terminal_state`
written; the coordinator-owned `queued → claimed` edge stays as the
last persisted transition). The queue row returns to the waiting
set; the next claim retries.

Trade-offs accepted:

- A perpetually-unreachable submission requeues forever. 10C does
  NOT have a redelivery cap. Operator manual intervention is
  required. A future ADR may add a redelivery-count + dead-letter
  rule; this ADR records that as a known limitation, not a v1 fix.
- Single-page fetcher failure (1 of N) does NOT throw — it produces
  a per-page `partial_failure` and the worker continues, mapping
  the job's terminal_state to `partial_succeeded` via the existing
  contract path.

**Operational visibility requirement (v1, before ADR-11C lands)**:
the worker MUST log a redactor-clean `outcome: rejected:<reason>`
line per fetcher rejection (§6). Operators inspecting persistence
see redelivery via the receipt ledger (`ocr_queue_receipts`) — each
fresh claim mints a new receipt; counting receipts for a `job_id`
yields the redelivery count. (Note: the queue's `enqueue_seq` is an
ordering key, NOT a redelivery count; do not use it for that.)

**Warning threshold (v1)**: ADR-11C MUST log a redactor-clean warning
once the receipt count for a `job_id` exceeds 3 redeliveries. The
warning is informational; no DLQ behavior is triggered. This gives
operators a concrete signal to invoke the runbook below.

An in-tree runbook for clearing wedged jobs — manually resolving the
queue row + appending a terminal status to persistence — lands
alongside ADR-11C. Automatic dead-lettering remains a post-v1 ADR.

**Upstream rasterization requirement (submission producer / ingestion
boundary)**: because v1 fetcher rejects PDF MIME (§8), a PDF-only
submission would loop forever in the requeue path above. Therefore
the submission producer (the layer that builds OcrSubmissions and
hands them to the queue) MUST rasterize PDF inputs BEFORE building
the submission — i.e. produce per-page image sources only. The
case-box plan is the expected future owner of this layer; until
that ADR series codifies it, callers of `ingestDocumentForOcr` are
responsible.

ADR-11C MUST include a probe that submits a PDF directly (bypassing
any upstream rasterizer) and asserts: bin exits 0, fetcher rejects
each page with `unsupported_mime`, worker throws, coordinator
returns `requeued`, persistence remains non-terminal — i.e. NO
silent terminal success. The probe pins the contract that
`unsupported_mime` is the rejection code, and that the rejection
does NOT silently produce a `partial_succeeded` terminal state.

This decision is deliberately conservative. It preserves the 10C
admit-set (success + partial_failure only) and avoids a coordinator
amendment in v1.

### 10. Production fail-closed (Q3 / C12)

ADR-11B's bin startup adds two env-var checks, evaluated in the
config-parser BEFORE `buildDefaultDeps` instantiates any worker:

1. `OCR_WORKER_REQUIRE_REAL=1` → if `--worker=fake` is selected,
   exit 2 with a clear stderr message.
2. `NODE_ENV=production` → if `OCR_WORKER_REQUIRE_REAL` is unset OR
   `--worker=fake`, exit 2 with a clear stderr message.

Production deployments MUST set BOTH `NODE_ENV=production` AND
`OCR_WORKER_REQUIRE_REAL=1`. With either missing, the bin refuses
to start in production mode. This is fail-closed by default for
the production profile.

Dev/test deployments leave both unset; default `--worker=fake`
remains the path of least resistance.

**Sequencing requirement** (binding for ADR-11B):

```
parseConfig(env, argv)
  └→ rejectMalformedWorkerSelector(argv):
       --worker without value          → exit 2 (config error)
       --worker=                       → exit 2 (config error)
       --worker=<unknown>              → exit 2 (config error)
  └→ resolveWorkerSelector(config):
       if --worker omitted entirely    → set config.worker = "fake"
       else                            → use parsed value verbatim
  └→ validateProductionProfile():
       if OCR_WORKER_REQUIRE_REAL=1 AND config.worker is "fake" → exit 2
       if NODE_ENV=production AND OCR_WORKER_REQUIRE_REAL is unset → exit 2
       if NODE_ENV=production AND config.worker is "fake" → exit 2
  └→ if invalid → return 2 BEFORE deps construction
  └→ else buildDefaultDeps(config)
```

Critical: empty (`--worker=`) and missing-value (`--worker` without
a following token) are explicit config errors, NOT silent omissions.
Only fully-omitted `--worker` resolves to `"fake"`. This closes the
omitted-vs-empty selector ambiguity the plan-review caught (thread
`019e10b5`). Validation runs strictly between config parsing and
dep construction. No worker is instantiated under an invalid
profile.

### 11. Engine selection mechanism

Future `WORKER_REGISTRY` (pinned in ADR-11B) is an allowlisted
static map keyed by a discriminated union (e.g. `type WorkerKey =
"paddleocr" | "rapidocr" | "tesseract"`). `cli.ts` will not perform
`import(name)` with caller-supplied strings.

**Current state (acknowledgement)**: as of `main` at `1da4c8c`,
`services/ocr-worker/src/cli.ts`, `adapter.ts`, `types.ts`, and
`outcomeValidation.ts` import from `ocr-worker-contract/testing`
(specifically `processFakeOcrJob`, `FakeJobOutcome`,
`FakeScenario`). The fake worker IS the current production default.
This violates C3 today. ADR-11A.0 records C3 as the *target*
invariant, not a satisfied one.

**Refactor responsibility**: ADR-11A.5 introduces the production
`OcrJobOutcome` type (currently `FakeJobOutcome` minus `scenario`)
under `ocr-worker-contract` proper. ADR-11B introduces the
production `WORKER_REGISTRY` excluding fake. Tests inject the fake
worker via the existing `buildDeps` override seam. The full
refactor that satisfies C3 lands across the 11A.5 → 11B → 11C
sequence; this ADR-11A.0 only pins the target.

**Engine package missing-deps handling**: when ADR-11B's runtime
calls `WORKER_REGISTRY[selected]()` and the engine package is not
installed (Node ESM raises `ERR_MODULE_NOT_FOUND`), the registry
loader MUST distinguish between the engine package itself missing
(emit a clear "install ocr-worker-<engine> to use --worker=<engine>"
error) and a transitive import failure inside an engine package
(propagate the original diagnostic).

Discrimination uses ONLY portable Node fields:
- `err.code === "ERR_MODULE_NOT_FOUND"`, AND
- anchored regex match on `err.message`:
  `/^Cannot find package '<enginePkg>'/` where `<enginePkg>` is the
  exact package name the registry attempted to import.

The `err.specifier` / `err.url` properties MAY be present and MAY
narrow further when present, but MUST NOT be required — older Node
versions and custom loaders may omit them. ADR-11C tests MUST run
on the project's pinned Node version (≥22) and cover:
- Missing engine package itself → friendly install message.
- Missing transitive dependency inside the engine package → original
  diagnostic propagated (so operators can see WHICH transitive failed,
  unmodified by the registry loader).

**C3 refactor timing relative to 11A.1**: ADR-11A.1 (engine bakeoff)
is exploratory work running OUTSIDE the production source tree —
fixture-driven probes against candidate engines. It produces a
verdict + lockfile, NOT production code changes. The C3-satisfying
type/registry refactor lands across ADR-11A.5 (production
`OcrJobOutcome` type) and ADR-11B (production `WORKER_REGISTRY`
excluding fake). 11A.1 is a no-source-touch step.

## What 11A.0 does NOT decide

- Engine choice (PaddleOCR vs RapidOCR vs Tesseract). → ADR-11A.1.
- Sidecar vs in-process runtime. → ADR-11B.
- `OcrJobOutcome` field-by-field type and JSON Schema. → ADR-11A.5.
- Engine-output → contract-`OcrResult` mapping rules. → ADR-11A.5.
- Audit-log persistence destination. → ADR-11B.
- Cloud OCR backend (only the contract SHAPE is mentioned; impl
  deferred).
- Multi-host / network-FS / multi-tenant.
- Whole-job retry / DLQ / redelivery cap.
- Legal-hold mechanism.

## Acceptance — 11A.0 itself

| Criterion | Result |
|---|---|
| ADR file exists at `docs/adr/ocr-real-worker-source-access-step-11a-0.md` | ✅ |
| `PageSourceFetcher` + `FetchedPage` + `FetchOptions` + `SourceFetchError` types pinned; reason-code set includes `unsupported_mime` distinct from `mime_mismatch` | ✅ |
| Three source kinds covered (s3 / https / inline) with per-kind strategy | ✅ |
| SSRF defenses pinned for `https` (canonical IP normalization, IPv4-mapped IPv6, undici Agent custom connect with explicit Host-header + TLS-SNI preservation, no redirects, TLS≥1.2, expiry check) | ✅ |
| Hash/size/MIME validation rules pinned (effective cap = `min(maxBytes, byte_size)`; image MIMEs only in v1) | ✅ |
| Log-redaction rules enumerated; ADR-11C MUST introduce a single audit-sink wrapper (direct stderr writes from fetcher/worker FORBIDDEN); HMAC restart tradeoff recorded | ✅ |
| Temp-file lifecycle pinned (root `0o700`, files `0o600`, cleanup after graceful drain, fatal-path best-effort, multi-tenant deferred) | ✅ |
| Rasterization tooling: PDF deferred to v2 with rationale; v1 image MIMEs only | ✅ |
| All-pages-rejected → worker throws → coordinator returns `requeued` (immediate `requeueClaim`); persistence non-terminal; redelivery count visible via `ocr_queue_receipts` ledger; upstream rasterization required at case-box for PDF inputs; ADR-11C must include a PDF-rejection probe asserting NO silent terminal success | ✅ |
| Production fail-closed pinned: omitted-`--worker` resolves to `fake` BEFORE validation; `--worker=` empty / `--worker=<unknown>` reject as config error; `OCR_WORKER_REQUIRE_REAL=1` AND `NODE_ENV=production` both checked; `parseConfig → rejectMalformedWorkerSelector → resolveWorkerSelector → validateProductionProfile → buildDefaultDeps` sequence | ✅ |
| Fake-worker C3 claim corrected: target invariant, currently unsatisfied; refactor responsibility split across 11A.5 → 11B → 11C | ✅ |
| Engine package missing-vs-transitive error discrimination required for 11B registry loader | ✅ |
| ZERO production source files modified | ✅ |
| ZERO contract schemas modified (cloud authorization SHAPE is illustrative, not contract-bound until a future ADR) | ✅ |

## Consequences

- ADR-11A.1 (engine bakeoff) inherits a fixed fetcher contract; the
  bakeoff does NOT need to invent fetcher semantics, only consume
  `FetchedPage` outputs.
- ADR-11A.5 (mapping + idempotency) inherits a fixed temp-file
  lifecycle; mapping spec assumes bytes-in-hand and pinned cleanup.
- ADR-11B (runtime) inherits a fixed engine-selection shape (no
  raw `import(name)`; allowlisted registry).
- ADR-11C (implementation) inherits a fixed test-surface scope:
  fetcher security tests, temp lifecycle tests, redaction tests,
  rasterization tests are all named here.
- A perpetually-unreachable submission is a known limitation in v1.
  Operator manual intervention is required to clear stuck jobs. A
  future ADR adds a redelivery cap + DLQ.
- Production deployments MUST set `NODE_ENV=production` AND
  `OCR_WORKER_REQUIRE_REAL=1` — encoded in deployment runbooks.

## Non-goals (strict)

- Implement the fetcher.
- Pick the rasterization tool's exact API.
- Validate against real fixture pages.
- Pick the engine.
- Pin sidecar vs in-process.
- Define `OcrJobOutcome` field-by-field.
- Modify any production source file or contract schema.
- Introduce redelivery cap / DLQ.
- Land any test.

These are 11A.1+ concerns. They are listed here so future readers do
not infer them from "the ADR has fetcher decisions."
