Status: scaffold. Content lands in WI-09b after WI-07 completes and either WI-06 completes or the WI-06-deferral decision is recorded (per the round-4 plan's WI-09b conditional predecessor rule).

## HTTPS Source Policy (Allowlist, Pre-Signed URL Expiry, No Redirects, No Proxy, Why S3 Direct Stays Rejected in v1)
_To be filled in WI-09b after WI-06/WI-07 land. See [`docs/release/go-live-plan.md`](../release/go-live-plan.md) WI-09b acceptance criteria._

## Production Profile (env vars: `NODE_ENV=production`, `OCR_WORKER_REQUIRE_REAL=1`, `OCR_WORKER=paddleocr-onnx`, `OCR_FETCHER_FILE_ROOT`, `OCR_FETCHER_HTTPS_HOSTS`, SQLite path, queue selector, persistence selector)
_To be filled in WI-09b after WI-06/WI-07 land. See [`docs/release/go-live-plan.md`](../release/go-live-plan.md) WI-09b acceptance criteria._

## Production Fail-Closed Behavior (Exit Code 2 for Invalid Profile)
_To be filled in WI-09b after WI-06/WI-07 land. See [`docs/release/go-live-plan.md`](../release/go-live-plan.md) WI-09b acceptance criteria._

## Retry / Dead-Letter Observability (`OCR_LOG_OUTCOMES`, Structured Event Schema, Conservative `max_attempts` Recommendation)
_To be filled in WI-09b after WI-06/WI-07 land. See [`docs/release/go-live-plan.md`](../release/go-live-plan.md) WI-09b acceptance criteria._

## Pending-Retry Recovery (Reconciler Flow When WI-06 Lands; Manual Workaround if WI-06 Deferred)
_To be filled in WI-09b after WI-06/WI-07 land. See [`docs/release/go-live-plan.md`](../release/go-live-plan.md) WI-09b acceptance criteria._

## Source-Kind Policy (File / Inline / HTTPS Admitted; S3 Rejected; Use Pre-Signed HTTPS)
_To be filled in WI-09b after WI-06/WI-07 land. See [`docs/release/go-live-plan.md`](../release/go-live-plan.md) WI-09b acceptance criteria._

## Day-0 Operations (Startup, Log Location, Healthcheck, Shutdown Signals)
_To be filled in WI-09b after WI-06/WI-07 land. See [`docs/release/go-live-plan.md`](../release/go-live-plan.md) WI-09b acceptance criteria._

## No PDF Support in v1 Note + Upstream Rasterization Responsibility
_To be filled in WI-09b after WI-06/WI-07 land. See [`docs/release/go-live-plan.md`](../release/go-live-plan.md) WI-09b acceptance criteria._

## Adding Proxy or Connection Pooling Requires a New ADR Note
_To be filled in WI-09b after WI-06/WI-07 land. See [`docs/release/go-live-plan.md`](../release/go-live-plan.md) WI-09b acceptance criteria._
