# ADR: Fetcher — `https` Source Kind (Step 11D.2)

## Status

Accepted. **Decision + code**. Second staged unit of ADR-11D
(source-kind expansion beyond `file://`). Opens the fetcher to
`kind: "https"` submissions: the page bytes are fetched from a
signed HTTPS URL the caller supplies. Inherits the same temp-file
bridge to the engine; layers in URL parsing, host allowlist,
DNS-resolution-based private-IP blocking, redirect refusal, and
content-hash verification.

Companion code:
- `services/ocr-worker/src/fetcher/fetchPageBytes.ts` — `https`
  dispatch + post-fetch gates.
- `services/ocr-worker/src/fetcher/httpsTransport.ts` (new) —
  default transport using Node's `fetch` with manual redirects
  and AbortController-driven timeouts; injected via `FetcherDeps`
  so tests can stub the transport without doing real network I/O.
- `services/ocr-worker/src/fetcher/types.ts` — 10 new error codes
  (9 in the original commit + `URL_MALFORMED` added in the audit
  019e3af0 fix-up).
- `services/ocr-worker/src/config.ts` —
  `OCR_FETCHER_HTTPS_HOSTS` env + `--https-hosts` argv flag.
- `services/ocr-worker/src/cli.ts` — threads
  `fetcher_https_hosts` into `FetcherDeps.allowedHttpsHosts`.

## Context

ADR-11C.2 §1 admitted only `kind: "file"`. ADR-11D.1 added
`kind: "inline"`. The remaining schema-admitted kinds are `s3`
and `https`. This commit handles `https` — the typical "signed
URL" pattern for legal-doc workflows (S3 pre-signed URL, internal
document-management system, scan-as-a-service vendor).

User decisions captured this session:

1. **Host allowlist scope**: exact hosts only, env-configured. No
   CIDR, no DNS suffix patterns for v1. Allowlist is set-membership.
2. **Private/loopback IP blocking**: always block, even when the
   allowlist matches. Defense-in-depth against DNS rebinding +
   misconfigured allowlists.
3. **`expected_sha256` verification**: yes, compute SHA-256 over
   the fetched body and compare when the schema field is present.
   Closes the content-integrity gap the schema already documents.
4. **Max redirects**: 0. Signed URLs are expected to resolve
   directly. Any 3xx response = `redirect_unsupported`.

## Decisions

### §1 Dispatch arm + sequencing

`source.kind === "https"` routes to `fetchFromHttps(source, deps)`.
Gate order, cheap-before-expensive plus specific-before-general:

**Pre-network (CPU only)**:
1. `URL` parse — malformed URL surfaces with stable code via the
   constructor throw being caught.
2. **HTTPS-only scheme check**: `url.protocol === "https:"` or
   throw `http_scheme_unsupported`. Schema's pattern already
   enforces `^https://`, but a schema-bypass would otherwise let
   plain HTTP through.
3. **`url_expires_at` check**: if present, parse as ISO-8601 and
   compare against `deps.now()` (defaults to `Date.now()`). If in
   the past → `url_expired`. The schema makes this field optional;
   only callers that supply it get the protection.
4. **Host allowlist**: `url.hostname` (lower-cased, port stripped)
   must be in `deps.allowedHttpsHosts`. Matching on `hostname`
   not `host` means operators allowlist
   `signed.example.com`, not `signed.example.com:443` — saves
   them enumerating ports. Set absence or empty → throw
   `host_not_allowlisted` regardless of how clean the URL looks.
5. **MIME allowlist**: `source.mime_type` in
   `{image/jpeg, image/png}` or `mime_unsupported`. Same allowlist
   as file:// + inline; check before any network I/O.

**DNS / transport**:
6. **DNS lookup with `all: true`** via `dns.promises.lookup`. EVERY
   resolved address (v4 + v6) is checked against the private-IP
   block list (RFC 1918, link-local, loopback, ULA). Any one
   match → throw `host_resolves_to_private_ip`. This is the
   anti-SSRF defense; it runs AFTER the allowlist so a misconfig
   that lists an internal host still rejects.
7. **Transport call** via `deps.httpsTransport.fetch(url, signal)`:
   - `AbortController` with `setTimeout` (configurable; default
     30s overall).
   - `redirect: "manual"` — 30x responses are observable, not
     auto-followed.
   - The default transport uses Node's built-in `fetch` (undici).
     Tests inject a stub.

**Post-network**:
8. **Status check**: any 3xx → `redirect_unsupported` (max 0
   redirects). Any non-200 → `https_status_not_ok`.
9. **Content-Length cap (early)**: if the response advertises a
   `Content-Length` > 50 MB (`MAX_PAGE_BYTES`), throw
   `size_cap_exceeded` without reading the body. Defends against
   adversarial-sized responses that would exhaust memory.
10. **Body read with cap enforcement**: stream the response body
    into a Buffer; abort if the running byte total exceeds
    `MAX_PAGE_BYTES`. Throw `size_cap_exceeded`. Implementation
    note (audit 019e3af0 D6 Low): chunks are collected into a
    `Uint8Array[]` and concatenated via `Buffer.concat` at the
    end. Peak memory is briefly ~2x the final body size during
    the concat step (chunks array still live + new contiguous
    buffer allocated). Acceptable under the 50 MB cap and v1's
    single-job-at-a-time worker (~100 MB peak per job, single
    process). If multi-tenant batched workers ever come back,
    revisit by streaming directly to the adapter's temp file.
11. **`size_mismatch`**: actual body length vs `source.byte_size`.
12. **`content_hash_mismatch`**: if `source.expected_sha256` is
    present, compute `crypto.createHash("sha256").update(buf).digest("hex")`
    and compare lowercase-hex. Absent → skip (caller opted out).
13. **MIME signature sniff**: same PNG/JPEG magic-byte check.

Return `{ bytes, mimeType, sizeBytes }`.

### §2 `HttpsTransport` seam

```ts
export interface HttpsTransport {
  fetch(
    url: URL,
    init: { signal: AbortSignal },
  ): Promise<HttpsTransportResponse>;
}

export interface HttpsTransportResponse {
  readonly status: number;
  readonly headers: Headers;
  /** Async iterable of byte chunks. Caller is responsible for
      enforcing size caps. */
  readonly body: AsyncIterable<Uint8Array>;
}
```

Two-call surface, no more. Production wraps Node's `fetch`:

```ts
export function makeNodeFetchHttpsTransport(): HttpsTransport {
  return {
    async fetch(url, init) {
      const res = await fetch(url, {
        signal: init.signal,
        redirect: "manual",
      });
      return { status: res.status, headers: res.headers, body: res.body };
    },
  };
}
```

Tests inject a stub `HttpsTransport` that returns canned responses
with a synthetic async iterable. The fetcher's gates run unchanged
in tests; only the bytes-coming-off-the-wire step changes.

### §3 Non-globally-routable IP blocklist

Policy: "block any address that should never appear as a fetch
destination over the public internet." Audit 019e3af0 D2 Medium
fix widened the original private-shortlist to the full IANA
special-use list.

IPv4 blocks:
- `0.0.0.0/8` (this network)
- `10.0.0.0/8` (RFC 1918 private)
- `100.64.0.0/10` (CGNAT)
- `127.0.0.0/8` (loopback)
- `169.254.0.0/16` (link-local + cloud metadata)
- `172.16.0.0/12` (RFC 1918 private)
- `192.0.0.0/24` (IETF protocol assignments)
- `192.0.2.0/24` (TEST-NET-1)
- `192.168.0.0/16` (RFC 1918 private)
- `198.18.0.0/15` (benchmark testing)
- `198.51.100.0/24` (TEST-NET-2)
- `203.0.113.0/24` (TEST-NET-3)
- `224.0.0.0/4` (multicast)
- `240.0.0.0/4` (reserved for future use)
- `255.255.255.255/32` (broadcast)

IPv6 blocks:
- `::/128` (unspecified)
- `::1/128` (loopback)
- `fe80::/10` (link-local)
- `fc00::/7` (unique local addresses)
- `ff00::/8` (multicast)
- `2001:db8::/32` (documentation)
- IPv4-mapped IPv6 (`::ffff:0:0/96` range): expanded to the
  embedded IPv4 and re-checked. **Audit 019e3af0 D2 High fix**:
  previous code recognized only the dotted form
  (`::ffff:127.0.0.1`); the hex form (`::ffff:7f00:1`) bypassed
  the block. Implementation now expands IPv6 to its full
  8-group form, detects the IPv4-mapped pattern, and recurses
  on the embedded v4.

Implementation: `services/ocr-worker/src/fetcher/privateIp.ts`
uses `node:net.BlockList` for range membership and a custom
parser for IPv4-mapped IPv6 expansion. Pure function:
`isPrivateIp(address: string): boolean`. Returns `true` for
non-IP-literal input (fail-closed).

Why ALWAYS block, even when the allowlist matches:
- DNS rebinding (partial defense — see caveat below): an
  allowlisted host's DNS record can flip to a private IP between
  the allowlist check and the fetch. Resolving here catches the
  cases where the malicious flip has already happened before we
  look up.
- Misconfigured allowlist: an operator might add an internal host
  to the allowlist accidentally (e.g., a typo of an external
  host). The private-IP check is a separate guard.

**DNS-rebinding caveat (audit 019e3af0 D9 High fix)**: this gate
DOES NOT fully defend against DNS rebinding. The reason: after the
fetcher's `dns.lookup` returns a vetted address set, Node's
built-in `fetch` (undici) does its OWN DNS resolution under the
hood when connecting. There is no public undici API to pass a
pre-resolved IP to bypass that second lookup. A determined
attacker who controls a low-TTL DNS record can:

1. Return a public IP to our lookup (passes the block).
2. Flip the record to a private IP before undici's connect resolve.
3. undici connects to the now-private IP.

Mitigating this would require either:
- a custom HTTPS dispatcher that accepts a pre-resolved IP (real
  work; out of v1 scope), or
- moving to a different HTTP client that supports lookup
  injection (also out of v1 scope).

For v1 the block is best-effort and the threat is documented. The
defense IS effective against:
- DNS records that already point at a private IP at first lookup
  (typo, misconfigured allowlist).
- Stable-record allowlist bypass (no rebinding involved).

When real DNS-rebinding hardening becomes a requirement, a
separate ADR will swap the transport for one that pins the
connection IP from the vetted lookup result.

### §4 No support for redirects (v1)

`redirect: "manual"` means the fetcher's `fetch()` call returns
the 3xx response itself. Status >= 300 and < 400 → throw
`redirect_unsupported`. Operators see the actual code (e.g., 302)
in the sanitized message? Yes — code-keyed message says
"redirect not supported", optionally including the response status
when it doesn't leak sensitive info.

Why 0 redirects:
- Signed URLs (S3 pre-signed, signed-URL-as-a-service) are
  expected to be direct.
- Each follow opens new SSRF surface (each new URL needs allowlist
  + private-IP re-checks).
- Adding 3 redirects = +60 LOC of recheck code with negligible
  v1 use case.

If a real caller needs redirects, that's a separate ADR.

### §5 Content-hash verification (`expected_sha256`)

The schema admits `source.expected_sha256: string,
pattern: "^[0-9a-f]{32,128}$"` on `s3` and `https` sources. v1
fetcher consumed nothing from this field; with this ADR, present-
and-matches becomes a stable contract pin.

Implementation:
```ts
if (source.expected_sha256 !== undefined) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== source.expected_sha256.toLowerCase()) {
    throw new FetcherError(
      `content_hash_mismatch: expected ${source.expected_sha256}, got ${actual}`,
      { code: FETCHER_ERROR_CODES.CONTENT_HASH_MISMATCH },
    );
  }
}
```

Cost: SHA-256 over a ≤50 MB Buffer takes ~50ms on modern CPUs.
Negligible relative to the engine cold-load + detect cost.

Hex case: schema's `^[0-9a-f]` lowercase-only; the lowercase
comparison enforces canonical form.

Absent expected_sha256: caller opted out; fetcher does NOT compute
the hash (saves the ~50ms cost). Operators who want the integrity
check supply the field.

### §6 Timeouts

- **Single end-to-end deadline**: 30 seconds, hardcoded constant
  `HTTPS_FETCH_TIMEOUT_MS = 30_000`. The AbortController is
  created BEFORE the DNS lookup and stays armed through DNS +
  headers + body streaming. Audit 019e3af0 D3 High fix: previous
  code cleared the timer in a `finally` that ran before body
  iteration began, so a stalled body could have run indefinitely.
  Now the `clearTimeout` runs in the function's outermost
  `finally`, after the body has finished iterating (or thrown).
- **Connect timeout**: not separately configurable in Node's
  `fetch`. The single deadline covers all phases.

Why 30s: a 10 MB signed URL on a 5 Mbps connection takes ~16s; a
20 MB on the same connection ~32s. 30s covers typical legal-doc
scans on a slow link. Faster networks finish in seconds. Slower
networks should redo the submission (queue retry, not fetcher
retry — retry classification is ADR-11E scope).

Configurable via env later if real workloads demand it; v1 keeps
the contract small.

### §7 New error codes (10)

`services/ocr-worker/src/fetcher/types.ts`:

```ts
URL_MALFORMED:              "url_malformed",
HOST_NOT_ALLOWLISTED:       "host_not_allowlisted",
HOST_RESOLVES_TO_PRIVATE_IP: "host_resolves_to_private_ip",
URL_EXPIRED:                "url_expired",
REDIRECT_UNSUPPORTED:       "redirect_unsupported",
HTTPS_STATUS_NOT_OK:        "https_status_not_ok",
HTTPS_TIMEOUT:              "https_timeout",
HTTPS_NETWORK_ERROR:        "https_network_error",
CONTENT_HASH_MISMATCH:      "content_hash_mismatch",
HTTP_SCHEME_UNSUPPORTED:    "http_scheme_unsupported",
```

`url_malformed` (added in the audit 019e3af0 fix-up) is distinct
from `https_network_error` so a future retry classifier (ADR-11E)
doesn't treat caller-side malformed input as a transient network
blip retryable on the queue.

All sanitized-message entries added to `SANITIZED_FETCHER_MESSAGES`.
Raw URLs do NOT appear in messages that travel into
`OcrResult.partial_failure` (same path-redaction posture as
ADR-11C.3a §3).

### §8 Retry classification deferred (ADR-11E)

Per the user decision from ADR-11D.1: all per-job fetcher errors
remain `is_transient: false` in v1. Network blips, 5xx server
errors, timeouts — all map to terminal `failed` for now.
ADR-11E will classify which codes warrant queue requeue.

### §9 Out of scope (deferred)

- `s3` source kind — ADR-11D.3.
- Retry classification (transient vs permanent) — ADR-11E.
- CIDR / wildcard host allowlists — defer until a real caller
  needs them.
- Configurable timeouts via env — defer.
- HTTP/2 / HTTP/3 transport tuning — Node's default suffices.
- Cookie / auth-header handling — signed URLs carry auth in the
  query string by convention; cookies would expand the threat
  model.
- Streaming the body directly to the temp file (instead of
  buffering then writing) — premature under the 50 MB cap.

## Consequences

- Operators can deploy with `OCR_FETCHER_HTTPS_HOSTS=signed.example.com`
  and submit `https` source kinds against that allowlist.
- Real-world OCR via signed S3/HTTPS URLs is now functional.
- 10 new stable error codes enter the public fetcher surface.
- One new private file (`privateIp.ts`) + one new infrastructure
  file (`httpsTransport.ts`).
- No new runtime dependencies (Node's built-in `fetch` + `dns` +
  `crypto`).

## Open questions (for 11D.3 / 11E)

- Q1 (11D.3): does S3 reuse the HTTPS transport via signed URLs, or
  use the AWS SDK directly with its own SigV4? Provisional: signed
  URLs (no SDK), so 11D.3 is mostly a config + admission delta.
- Q2 (11E): which 11D.2 error codes are transient? Provisional set
  for ADR-11E: `https_timeout`, `https_network_error`, and
  `https_status_not_ok` when status is 5xx. Everything else stays
  permanent.

## Rejected alternatives

- **Allow http://** in v1 — signed URLs are HTTPS by industry
  convention; allowing http:// expands attack surface (MITM body
  injection) for marginal value.
- **CIDR allowlist v1** — needs a CIDR parser. Defer.
- **No private-IP block, trust the allowlist** — DNS rebinding +
  misconfigured allowlist make this fragile. Defense-in-depth is
  cheap.
- **Auto-follow 3 redirects** — each follow needs allowlist +
  private-IP re-check + per-hop timeout. Cost > value for v1.
- **Stream body to temp file directly** — premature. Buffer-then-
  write is 50 MB max; the savings are negligible.
- **Verify expected_sha256 only when caller demands it via a
  separate flag** — schema field's purpose IS to demand
  verification. Field present → verify.
- **Use undici dispatcher API directly instead of fetch** — fetch
  is the simpler surface; undici features are reachable via
  agent injection if needed later.
