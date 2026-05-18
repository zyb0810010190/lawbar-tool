# ADR: Fetcher — Retry Classification Data Layer (Step 11E)

## Status

Accepted. **Decision + code (data-layer only)**. Classifies every
fetcher error code as `transient` (caller retry can succeed) or
`permanent` (caller error / invariant violation; retry pointless).
The adapter consumes the classification when assembling the
failed OcrResult so `partial_failure.is_transient` carries the
right signal.

**Scope-limited explicitly**: the coordinator-side retry behavior
(reading `is_transient` + driving `failed → queued` requeue) is
NOT wired in this commit. That's ADR-11F. This commit lands the
DATA LAYER — the labels are correct; consumers can be wired
later without re-touching the classification.

Companion code:
- `services/ocr-worker/src/fetcher/types.ts` —
  `HTTPS_STATUS_NOT_OK` split into `HTTPS_CLIENT_ERROR_4XX` +
  `HTTPS_SERVER_ERROR_5XX`.
- `services/ocr-worker/src/fetcher/fetchPageBytes.ts` — status
  branch in `fetchFromHttps`.
- `services/ocr-worker/src/engines/paddleocr-onnx.ts` —
  `classifyFetcherError(code)` + `assembleFailedOutcome` reads it.
- Updated `SANITIZED_FETCHER_MESSAGES`.

## Context

ADR-11C.3a §3 pinned `is_transient: false` for ALL fetcher errors
in v1, deferring classification to a separate ADR ("retry
classification is deferred to a future ADR. v1 keeps all per-job
fetcher errors terminal-failed"). ADR-11D.2 §8 reaffirmed the
deferral. This is that ADR.

User decisions captured this session:
1. Split `https_status_not_ok` into 4xx + 5xx variants so 5xx can
   classify as transient while 4xx stays permanent.
2. `engine_failed` classifies as **transient** (ONNX/GPU hiccups can
   resolve on retry; bounded by `submission.retry.max_attempts`).
3. `file_not_found` classifies as **permanent** (v1 has no
   async-upload pattern; missing file at fetch time means it'll
   stay missing).

Important constraint surfaced during analysis:
`docs/contracts/src/retryPolicy.ts:classifyOcrFailureForRetry`
exists in the contract package but **no service consumes it**.
The coordinator (`services/ocr-worker/src/coordinator.ts`) does
not inspect `is_transient`; the queue-side `failed → queued`
transition (controlled by `queue` per `transitions.ts:61`) is
unimplemented. Setting `is_transient: true` correctly today
DOES NOT cause retries today — but it sets up the data layer
ADR-11F's coordinator wiring will consume.

## Decisions

### §1 Classification map

Every `FETCHER_ERROR_CODE` + `ENGINE_FAILED_CODE` gets a
classification:

| Code | Class | Rationale |
|---|---|---|
| `source_kind_unsupported` | permanent | Caller schema-bypass; retry pointless. |
| `multi_page_unsupported` | permanent | N=1 cap; caller error. |
| `file_root_unconfigured` | permanent | Config fault; bin re-throws so this never reaches the adapter, but classify for completeness. |
| `path_escape` | permanent | Caller path-traversal attempt; retry pointless. |
| `file_not_found` | permanent | Per user decision §3 below + ADR-11C.2 Q1 provisional. |
| `file_not_regular` | permanent | Caller pointed at a directory / fifo; retry can't fix. |
| `size_mismatch` | permanent | Caller lied about size, or base64 malformed (inline); deterministic. |
| `size_cap_exceeded` | permanent | Caller exceeded cap; retry can't fix. |
| `mime_unsupported` | permanent | Caller-side MIME outside v1 allowlist. |
| `mime_signature_mismatch` | permanent | Bytes don't match declared MIME; deterministic. |
| `url_malformed` | permanent | Caller-side URL parse failure. |
| `http_scheme_unsupported` | permanent | Caller-side scheme mismatch. |
| `url_expired` | permanent | Signed URL expired; new URL needed (not retry). |
| `host_not_allowlisted` | permanent | Config error; retry pointless. |
| `host_resolves_to_private_ip` | permanent | DNS rebinding / misconfig; retry just hits the same defense. |
| `redirect_unsupported` | permanent | Caller-side server config. |
| `content_hash_mismatch` | permanent | Bytes don't match expected hash; deterministic. |
| **`https_client_error_4xx`** | permanent | 4xx = caller-side server response (404, 401, 403). Retry won't change the response. |
| **`https_server_error_5xx`** | **transient** | 5xx = server hiccup. Retry often succeeds. |
| `https_timeout` | transient | Network blip / slow server; retry can succeed. |
| `https_network_error` | transient | DNS hiccup / connection reset; can be temporary. |
| `engine_failed` | **transient** | Per user decision; ONNX/GPU recovery + bounded retries. |

### §2 Split `HTTPS_STATUS_NOT_OK` → 4xx / 5xx

The previous single code `HTTPS_STATUS_NOT_OK` couldn't carry the
transient/permanent distinction because the http status was lost
by the time partial_failure was assembled. The split makes the
code itself the classification carrier:

```ts
// types.ts
// REMOVED: HTTPS_STATUS_NOT_OK
// ADDED:
HTTPS_CLIENT_ERROR_4XX: "https_client_error_4xx",
HTTPS_SERVER_ERROR_5XX: "https_server_error_5xx",
```

`fetchFromHttps` branches on status:

```ts
if (response.status >= 300 && response.status < 400) {
  throw redirect_unsupported;
}
if (response.status >= 400 && response.status < 500) {
  throw https_client_error_4xx;
}
if (response.status >= 500 && response.status < 600) {
  throw https_server_error_5xx;
}
if (response.status !== 200) {
  // 1xx, 2xx-non-200 (204, 206), 6xx+
  throw https_client_error_4xx;  // group with caller errors
}
```

**Contract-breakage note**: `HTTPS_STATUS_NOT_OK` was first
admitted at `fd70547` (3 commits ago, all in this same session).
No downstream consumer outside the worker package has shipped
against it. Splitting now is the cheapest moment — every commit
that adds a consumer makes the split more expensive. The two new
codes ship with full sanitized messages + tests; the old code is
removed cleanly.

`url_malformed` was added at `c704e18` for the same forward-
compatibility reason (distinct from `https_network_error` so
retry classification can label it permanent). That foresight pays
off here.

### §3 `engine_failed` is transient

ONNX runtime + sharp native binaries are stable but not perfect.
Observed failure modes that should retry:
- Transient GPU memory pressure (Apple Silicon Neural Engine,
  CUDA OOM under load).
- Inference session corruption requiring a fresh worker cycle.
- Sharp's libvips OOM on large images that succeed when retried
  in a worker that hasn't accumulated buffer state.

Risk of misclassification: a genuinely-broken input (e.g.,
corrupted PNG bytes that crash decode) gets retried 3x before
terminal-failing. Acceptable: the cost of 3 retries on a bad
input is 3× ~150ms detect calls; the cost of mis-labeling a real
transient as permanent is a permanent failure + manual
re-submission.

The retry is bounded by `submission.retry.max_attempts` (default
3 from `ocr-ingestion`'s defaults; configurable per submission).

### §4 `file_not_found` is permanent

v1 has no async-upload-after-submit pattern. If the file isn't
at the path at fetch time, retrying doesn't help — it'll be the
same fetch + same miss. Same reasoning for `size_mismatch` (the
file's size is what it is at that moment; retry sees the same).

Future-proofing for an upload-after-submit pattern would
re-classify `file_not_found` as transient + add a coordinator
delay before requeue. That's its own ADR.

### §5 `classifyFetcherError` lookup table

Lives in `services/ocr-worker/src/engines/paddleocr-onnx.ts`:

```ts
type ClassifiedFetcherCode = string; // FetcherErrorCode | typeof ENGINE_FAILED_CODE

const TRANSIENT_CODES: ReadonlySet<ClassifiedFetcherCode> = new Set([
  FETCHER_ERROR_CODES.HTTPS_SERVER_ERROR_5XX,
  FETCHER_ERROR_CODES.HTTPS_TIMEOUT,
  FETCHER_ERROR_CODES.HTTPS_NETWORK_ERROR,
  ENGINE_FAILED_CODE,
]);

export function classifyFetcherError(
  code: ClassifiedFetcherCode,
): "transient" | "permanent" {
  return TRANSIENT_CODES.has(code) ? "transient" : "permanent";
}
```

Why a Set of transient codes (and default permanent) rather than
a full Map:
- The classification is closed: every code is one of two.
- A new code defaults to permanent. Forgetting to classify a new
  code degrades fail-safe (no retry storms); the alternative
  (defaulting transient) would amplify retry traffic on any
  un-classified addition.
- Adding a new transient code is a one-line addition to the Set.

Why exported (not internal): the coordinator (ADR-11F) will read
this for the requeue decision. Exporting from the adapter keeps
the classification with the codes it labels.

### §6 `assembleFailedOutcome` consumes the classification

```ts
partial_failure: {
  code: input.code,
  message: input.message,
  is_transient: classifyFetcherError(input.code) === "transient",
  attempted_count: 1,
}
```

Previously hardcoded `is_transient: false`. Now it reads the
classification.

`attempted_count: 1` stays as-is; the coordinator (ADR-11F) will
increment on retry.

### §7 Wiring gap documented (ADR-11F scope)

The coordinator does not currently inspect `is_transient`. A
failed outcome with `is_transient: true` is persisted as-is and
the queue does not requeue. This is a known v1 gap:

- The contract's `classifyOcrFailureForRetry` exists and is
  tested, but no service calls it.
- The state-machine admits the `failed → queued` edge controlled
  by `queue`, but no code drives the transition.
- The data layer (this ADR) labels correctly so ADR-11F can wire
  the behavior without re-touching the classification.

When ADR-11F lands: the coordinator inspects
`partial_failure.is_transient` post-worker, calls
`classifyOcrFailureForRetry({status, failure, retry})`, and on
`retry` triggers `failed → queued` via the queue. On
`dead_letter` it drives `failed → dead_lettered`.

For v1, even with this ADR, the user-visible behavior is the same
as before: all fetcher errors result in terminal failed jobs.
What changes is the data on the persisted result —
`is_transient: true` now appears for the transient codes,
preparing the ground for ADR-11F.

### §8 Test surface

- Update existing https tests that referenced
  `HTTPS_STATUS_NOT_OK` to use the new codes (4xx + 5xx).
- Add tests for status-class branching: 404 → 4xx, 503 → 5xx,
  302 still → redirect_unsupported.
- Add `classifyFetcherError` direct tests per code.
- Add adapter tests asserting `is_transient` is set correctly on
  the result for both transient codes (e.g., engine_failed → true)
  and permanent codes (e.g., path_escape → false).

## Consequences

- 1 fetcher error code removed (`https_status_not_ok`), 2 added
  (`https_client_error_4xx`, `https_server_error_5xx`). Net +1 on
  the public surface.
- `partial_failure.is_transient` carries meaningful data for the
  first time. v1 consumers (downstream review UI, audit log) see
  it; the coordinator's lack-of-action on it is the documented
  gap.
- ADR-11F has a clean foundation: classification done; only the
  behavior wiring remains.

## Open questions (for ADR-11F)

- Q1: how does the coordinator detect that a worker outcome's
  failed result is transient and drive `failed → queued`? Does it
  re-enqueue with `attempted_count + 1`, or does the queue re-claim
  the existing row?
- Q2: backoff between retries — fixed delay, exponential, or
  unbounded immediate retry? The submission carries
  `retry.backoff` + `retry.base_delay_ms` + `retry.max_delay_ms`;
  honor those values.
- Q3: when `attempted_count == max_attempts` and another transient
  failure occurs, the coordinator drives `failed → dead_lettered`
  via the queue. Does the dead_lettered state need a separate
  visibility signal (review-side flag), or is the terminal_state
  enough?

## Rejected alternatives

- **Classify all fetcher errors as transient** — would cause retry
  storms on permanent caller errors (404s, mismatched bytes, etc).
  Strict permanent-by-default policy avoids this.
- **Keep `https_status_not_ok` as a single code + add an
  `httpStatus` field on the FetcherError** — would require
  threading the status through the partial_failure assembly. The
  code split is the cleaner contract.
- **Make `file_not_found` transient** — premature for v1; no
  async-upload pattern exists. Easy to flip later if one appears.
- **Make `engine_failed` permanent** — would surface every
  transient engine hiccup as a permanent failure. The retry cost
  is bounded by `max_attempts`; the alternative cost is operator
  toil.
- **Wire the full retry behavior in this commit** — substantively
  larger scope; coordinator changes + queue transition + retry-
  round-trip tests. The data/behavior split keeps each ADR
  audit-able independently.
