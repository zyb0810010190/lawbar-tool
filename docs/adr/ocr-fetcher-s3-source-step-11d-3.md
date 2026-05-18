# ADR: Fetcher — `s3` Source Kind Stays Rejected in v1 (Step 11D.3)

## Status

Accepted. **Decision-only**. Third unit of the ADR-11D sequence
(source-kind admission expansion). The schema-admitted `kind: "s3"`
source stays REJECTED by the fetcher in v1 with stable code
`source_kind_unsupported`. Callers who need to OCR objects stored in
S3 pre-sign in their submission pipeline and submit as
`kind: "https"` per ADR-11D.2.

No new code. No new dependencies. No new tests (the existing
"s3 source kind: still rejected" test continues to pass; its
description gets a small drift fix in the companion commit).

## Context

ADR-11D.2 opened `kind: "https"` with full SSRF + hash + redirect
defense. The remaining schema-admitted kind is `kind: "s3"`, which
carries `{ bucket, key, etag?, expected_sha256?, byte_size?,
mime_type? }`. Admitting it in the fetcher requires one of three
paths:

A. **Pull in AWS SDK** (`@aws-sdk/client-s3` ~20 MB or
   `@aws-sdk/s3-request-presigner` ~5 MB) — true s3 admission with
   credential management, region config, IAM-role detection, retry
   policy, bucket allowlist.
B. **SigV4 in-house** — hand-write the SigV4 signer + construct the
   S3 URL + fetch via the existing https stack. ~150 LOC of
   security-critical crypto that has to be exactly right.
C. **Punt** — `kind: "s3"` keeps rejecting. Callers pre-sign in
   their own infrastructure (which usually already has AWS SDK +
   creds) and submit as `kind: "https"` with a signed URL.

User decision this session: **C — punt**. Rationale below.

## Decisions

### §1 No change to the fetcher

`fetchPageBytes`'s dispatch switch already handles `kind: "s3"` via
the default arm:

```ts
default:
  throw new FetcherError(
    `source kind ${JSON.stringify(...)} is not supported in v1 ` +
      `(admitted: "file", "inline", "https"; ...)`,
    { code: FETCHER_ERROR_CODES.SOURCE_KIND_UNSUPPORTED },
  );
```

Stable error code stays `source_kind_unsupported`. No new code lands.

### §2 Recommended deployment pattern for s3 backends

Submission pipeline (upstream of the worker — typically the web
app or batch importer) generates a pre-signed URL for the S3
object using AWS SDK in that layer's own dependency graph. Then
submits a job with:

```json
{
  ...,
  "pages": [{
    "page_id": "...",
    "page_number": 1,
    "source": {
      "kind": "https",
      "url": "https://my-bucket.s3.us-east-1.amazonaws.com/path/to/page.png?<sigv4-query>",
      "url_expires_at": "2026-05-18T11:00:00Z",
      "byte_size": 1234567,
      "mime_type": "image/png",
      "expected_sha256": "<lowercase-64-hex>"
    }
  }]
}
```

The worker treats this exactly like any other https submission:
allowlist check, DNS + private-IP block, AbortController-bounded
fetch, hash verification, etc. The deployer's
`OCR_FETCHER_HTTPS_HOSTS` must include the S3 host
(e.g. `my-bucket.s3.us-east-1.amazonaws.com`).

### §3 Why C and not A

(A) needs:
- A new ~5 MB-20 MB runtime dep in the production graph.
- Credential management at the worker (env vars + IAM-role
  detection + rotation).
- Region configuration per bucket (a bucket lives in exactly one
  region; mis-configured region surfaces as opaque 301 redirects).
- Bucket allowlist with its own ADR-style design (exact bucket
  names vs prefix patterns vs account-id scoping).
- Retry/backoff policy on s3 fetches that interacts with ADR-11E
  (still unwritten).
- New config validation surface in `OcrWorkerConfig`.
- New error codes (credentials_missing, region_misconfigured,
  bucket_not_allowlisted, etc.).

(C) needs:
- Zero new code in the worker.
- Zero new deps.
- An ADR (this one) documenting the pattern.

The functional gap closed by (A) over (C) is **near zero** for
deployments that already have AWS SDK in their submission
pipeline. The relevant questions are:

- Q: Can callers pre-sign URLs? In every real S3 deployment I've
  seen: yes. The submission pipeline already has the SDK + creds
  to enumerate / index / dispatch s3 objects.
- Q: Are signed-URL expiry windows enough? For OCR jobs that
  typically complete in seconds: yes. A 15-minute pre-signed URL
  covers worst-case queue depth.
- Q: Does this lose any audit-trail value? No. The pre-signed URL
  carries the bucket + key + signer identity in the path/query;
  any downstream audit can extract it.

The cost/benefit doesn't justify (A) until a real driver appears.

### §4 Why C and not B

(B) — hand-written SigV4 — is rejected outright. SigV4 has many
known footguns (canonical-request construction, query-parameter
sort order, payload-hash handling, region-specific URL formats,
session-token handling). A bug here is a security defect.
@aws-sdk/s3-request-presigner exists precisely because the
ecosystem learned this lesson. If we ever go path (A), we pull the
SDK; we don't reinvent SigV4.

### §5 Sanitized message stays generic

The fetcher's existing
`SANITIZED_FETCHER_MESSAGES.source_kind_unsupported`:

> "Submission source kind is not admitted by the v1 fetcher."

Tempting to make it s3-specific ("use https with a pre-signed URL")
but the same message handles any future rejected kind. Operators
who hit it consult the docs (this ADR + ADR-11D.2). The error
*code* is the stable contract; the message is diagnostic.

## Consequences

- The fetcher's admitted source-kind set stays
  `{file, inline, https}` for v1.
- Deployers wanting to OCR S3 objects configure their submission
  pipeline to pre-sign and dispatch as `kind: "https"`.
- `OCR_FETCHER_HTTPS_HOSTS` allowlist must include the S3
  hosts the deployment uses (e.g.,
  `my-bucket.s3.us-east-1.amazonaws.com`).
- No new runtime deps.
- The "s3 source kind: still rejected" test in
  `fetcher.test.mjs` keeps passing; its description gains a
  drift fix in the companion commit (previously said
  "admission set: file, inline", now correct as
  "file, inline, https").

## Open questions (for post-v1)

- Q1: when (A) is justified, do we use `@aws-sdk/client-s3` (full
  client) or `@aws-sdk/s3-request-presigner` + the existing https
  stack (sign-then-fetch-via-https)? Provisional: the latter —
  smaller dep, reuses the SSRF/timeout/hash defenses.
- Q2: bucket allowlist shape — exact bucket names, or account-id
  scoping via the SDK's `endpoint` config? Account-id scoping is
  stronger but more rigid.
- Q3: how do `etag` and `expected_sha256` interact for S3? Etag is
  S3-side; sha256 is content-side. Verify both, one of, or pick
  the strongest signal? Provisional: sha256 only (consistent with
  the https path).

## Rejected alternatives

- **(A) Pull in AWS SDK now** — premature; no real driver yet, and
  the deployment pattern callers already use (pre-sign in
  submission pipeline) closes the same gap with zero worker-side
  complexity.
- **(B) SigV4 in-house** — security footgun. Not justified by any
  win over (A) and not justified by the v1 scope.
- **Make the rejection message s3-specific** — handles future
  rejected kinds badly. Generic message + ADR pointer is the
  right shape.
- **Remove `kind: "s3"` from the schema** — schema is the
  vocabulary owner per the project invariant. Vocabulary stays;
  admission policy is engine-local. Removing the schema kind
  would force a major contract version bump for no v1 benefit.

## Closes

ADR-11D admission expansion complete: `file` + `inline` + `https`
admitted; `s3` rejected with documented deployment pattern.
Source-kind dispatch is closed for v1.

Next paths (post-v1):
- ADR-11E: retry classification (transient vs permanent fetcher
  errors → coordinator requeue mapping).
- ADR-11F (hypothetical): true `kind: "s3"` admission when a
  real driver appears.
- ADR-11G (hypothetical): multi-page lift (N>1 cap removal).
- ADR-11H (hypothetical): PDF source support via raster pipeline.
