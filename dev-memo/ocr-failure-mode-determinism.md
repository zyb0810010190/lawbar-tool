# OCR failure-mode determinism & sanitization

**WI**: `WI-OCR-FAILURE-MODE-DETERMINISM-24`. Verifies OCR failure paths are **deterministic**, **sanitized**, and
safe for CI + local legal-data handling. **Outcome: the failure model is comprehensively hardened + tested** — no
real gap; one confidentiality edge (the `file_not_found` sanitized message) got an added regression, plus this
consolidated inventory.

## Design (how failures flow)

- Each failure has a **stable code** (`FETCHER_ERROR_CODES` + `engine_failed`).
- The raw error message (which can carry a path/URL) is **substituted** with a static path-free
  `SANITIZED_FETCHER_MESSAGES[code]` before it lands in the durable `OcrResult.partial_failure.message`
  (audit 019e3a2e D2). Exhaustiveness is **type-enforced**: `Record<FetcherErrorCode, string>` — a new code without
  a message fails `tsc`.
- The code is classified **transient vs permanent** by `classifyFetcherError` (membership-or-default; unknown codes
  fail closed to **permanent** → no retry storms). The retry signal (`is_transient`) rides the data layer.
- Persistence depends on retryability: a **transient** failure is **requeued** (`failed→queued`) and the failed
  result is **NOT** saved on that attempt (`coordinator.ts` skips `saveOcrResultOnce` on the retry path;
  `coordinator.retryWiring.test.mjs` pins `saveOcrResultOnce === 0`). A **permanent** failure (or a transient one
  whose retries are exhausted → **dead-lettered**) **persists** a `status:"failed"` `OcrResult` with
  `partial_failure:{code,message,is_transient}` to the **local store** (retained locally like OCR text — not
  logged). Temp input files are removed in a `finally` on every path.
- Downstream (`ocr-review`) maps a persisted failed result to a `PartialFailureDigest` = `{code, message,
  is_transient, attempted_count}` — the `message` is the **upstream-sanitized** one (path-free by construction),
  never raw text/path.

## Failure-mode inventory

| # | Mode | Stable code | Message | Path/URL/text hidden? | Retryable? | Partial output | Temp cleanup | Tested |
|---|---|---|---|---|---|---|---|---|
| 1 | unsupported scheme | `source_kind_unsupported` / `http_scheme_unsupported` | sanitized | ✓ | permanent | failed result persisted | ✓ | `fetcher.test.mjs` |
| 2 | blocked SSRF / private target | `host_resolves_to_private_ip` / `host_not_allowlisted` | sanitized | ✓ | permanent | failed | ✓ | `fetcher.https.test.mjs` (DNS seam) + `fetcher.privateIp.test.mjs` |
| 3 | missing file | `file_not_found` | "Source file not found." | ✓ (regression added — WI-24) | permanent | failed | ✓ | `engines.paddleocr-onnx.test.mjs` (D2 + WI-24) |
| 4 | file outside root | `path_escape` | "Source path failed containment check." | ✓ (D2 — no `/etc/passwd`/root) | permanent | failed | ✓ | D2 |
| 5 | oversized input | `size_cap_exceeded` / `size_mismatch` | sanitized | ✓ | permanent | failed | ✓ | `fetcher.https.transport.test.mjs` (content-length) |
| 6 | timeout | `https_timeout` | sanitized | ✓ | **transient** | **requeued** (persist only on final/dead-letter) | ✓ | `fetcher.https.transport.test.mjs` (abort) |
| 7 | corrupt / unsupported image | `mime_unsupported` / `mime_signature_mismatch` / `engine_failed` | sanitized | ✓ | permanent (mime) / transient (engine) | permanent→persist; transient→requeue | ✓ | `fetcher.test.mjs` + engine tests |
| 8 | engine failure | `engine_failed` | `ENGINE_FAILED_MESSAGE` (sanitized) | ✓ (rawError not logged) | **transient** | **requeued** (persist only on final/dead-letter) | ✓ | `engines.paddleocr-onnx.test.mjs` |
| 9 | persistence write failure | coordinator outcome `persistence_failed` / `dead_lettered` | code + short error msg in the **observability event** | code ✓; message is the obs "short error string" (WI-21 surface) — sanitize persistence-error text if it ever carries a path* | per outcome | failed→dead_lettered | ✓ | `coordinator.test.mjs`; `ocr-persistence` surfaces `SQLITE_BUSY` as-is |
| 10 | duplicate / result-id collision | `saveOcrResultOnce` once-semantics (idempotent) | — | ✓ | n/a | single result | ✓ | `ocr-persistence` once/dedupe tests |
| 11 | downstream ingestion/review on OCR failure | `PartialFailureDigest` = `{code, message, is_transient, attempted_count}` | `message` is the **upstream-sanitized** one | ✓ (path-free by construction) | reads `is_transient` | digest exposed | n/a | `ocr-review` `crossprocess`/`crossjob` partial_failure tests |

\* Row #9 caveat (WI-24 audit L2): a persistence-failure observability event copies the error's short `message`
(per `observability.ts` §"No PII" — ids + counts + short error strings). For SQLite errors that string is normally a
condition (e.g. `SQLITE_BUSY` / "database is locked"), not a path, and it is the WI-21-documented "short error
string" surface — but it is **not** guaranteed path-free the way the fetcher `SANITIZED_FETCHER_MESSAGES` table is.
A dedicated persistence-error-message sanitization pass (if any DB error is found to carry a path) is a reasonable
follow-up; no concrete leak was confirmed here.

**Determinism:** codes + sanitized messages are static; `classifyFetcherError` is a pure membership check with a
type-enforced exhaustive input (`retryClassification.test.mjs` "every code classifies"); the observability event is
exhaustive over outcomes (`observability.test.mjs`). Same failing input → same `(code, message, is_transient)`.

## What was already safe

All 11 modes: stable coded, sanitized (no raw URL/path/header/OCR text in the durable envelope or logs — WI-21/22),
classified transient/permanent (exhaustively). A **final** failure's `partial_failure` is **persisted locally**
(intended, not logged); a **transient** one is **requeued** (not persisted on the retry attempt). Temp cleaned up
(`finally`); downstream digest carries only the upstream-sanitized message. Exhaustiveness is compile-time-enforced.

## What was fixed / added

- **Added regression** (`engines.paddleocr-onnx.test.mjs`): `file_not_found` — the most common path-carrying
  failure — now has the same sanitization assertion the D2 test gave `path_escape`: the durable
  `partial_failure.message` is the stable "Source file not found." with **no** missing-document path or allowed-root
  path. (The raw fetcher error names the path; the durable result must not.)
- This doc + the plan. No source change (no gap in behavior — the sanitization already worked; the test pins it).

## What remains intentionally allowed / documented

- A **final** failed `OcrResult` (permanent, or dead-lettered after retries) is **persisted** to the **local**
  store — intended local-first retention, not a leak (same boundary as OCR text); never logged. A **transient**
  failure is requeued and not persisted on the retry attempt.
- The retry signal (`is_transient`) is intentionally exposed to downstream consumers (they drive `failed→queued`).
- No product change; no accuracy work; no cloud/remote behavior.

## References
- `services/ocr-worker/src/engines/paddleocr-onnx.ts` (`SANITIZED_FETCHER_MESSAGES`, `classifyFetcherError`,
  `assembleFailedOutcome`), `src/fetcher/types.ts` (codes), `src/coordinator.ts` (persistence-failure outcomes).
- `services/ocr-review/src/page.ts` (downstream `partial_failure` digest).
- `dev-memo/ocr-fetcher-security.md`, `dev-memo/ocr-confidentiality-retention.md` (WI-21/22/23).
