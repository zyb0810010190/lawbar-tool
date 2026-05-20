# ADR: Fetcher — Bind HTTPS Connect to Vetted DNS Address (Step 11D.2-A)

## Status

Partial: seam (WI-02) landed; production transport rewrite (WI-03)
pending. SSRF closure is NOT complete until WI-03 ships.

## Context

ADR-11D.2 wired the `kind: "https"` source with DNS-resolution-based
private-IP blocking: `fetchFromHttps` calls `deps.dnsLookup(hostname)`
and rejects the fetch if any returned address is non-globally-routable
(`isPrivateIp`). The intent is to prevent SSRF against private
infrastructure.

Audit `019e3dd3-20b5-7b33-b5a6-1f5448919ee6` (mini, 2026-05-18) flagged
that the vetted addresses are not bound to the actual transport
connection. `fetchFromHttps`:

    addresses = await dnsLookup(url.hostname);     // first resolution -> vetted
    ...
    response = await transport.fetch(url, { signal });

The default transport (`makeNodeFetchHttpsTransport`) calls global
`fetch(url, ...)`, which performs its own DNS resolution under the
hood (undici). A DNS-rebinding attacker can answer the first lookup
with a public address (passes `isPrivateIp`) and the second lookup
with a private address (`127.0.0.1`, `169.254.169.254`, internal
RFC1918, etc.). The vetted check is bypassed.

This is a real SSRF gap. Severity: High (D1 Logic & Correctness +
implicit Security).

This ADR amends ADR-11D.2 §2 `HttpsTransport` seam. ADR-11D.2's
transport seam used `fetch(url, { signal })`; that is insufficient
because production transport can resolve DNS again after the fetcher
has vetted a different answer set.

## Decision

Bind the HTTPS connection to a fetcher-vetted DNS answer without
weakening the existing "any private answer rejects" invariant.

### §1 Fetcher/transport ownership

Fetcher owns:
- DNS lookup through the existing injected `dnsLookup` seam.
- Empty-result rejection.
- Private-IP rejection across the complete answer set.
- Passing the fully vetted public answer list into transport.
- Address ordering policy. V1 uses the order returned by `dnsLookup`
  after validation.

Transport owns:
- Runtime validation of the supplied `allowedAddresses`.
- Connecting to exactly one supplied vetted address.
- Failing closed if `allowedAddresses` is absent, empty, malformed,
  private, or contains an address family outside `4 | 6`.
- Preserving URL hostname semantics for Host, SNI, and certificate
  verification while the socket connects to the vetted IP.

The transport repeats the private-IP check even though the fetcher
already performed it. This is the only repeated fetcher validation in
the transport and exists as defense in depth against JS callers, stale
test doubles, or future call sites that bypass the typed path.

### §2 DNS validation order

DNS handling remains two-phase:

1. Fetcher resolves all addresses with `dnsLookup(url.hostname)`.
2. Fetcher rejects if the result is empty.
3. Fetcher validates every returned address with `isPrivateIp`.
   If any address is non-globally-routable, reject the hostname with
   `host_resolves_to_private_ip`.
4. Only after the complete set passes may transport connect to one
   address from the fully vetted public list.

Do not change this to "pick a public answer and ignore private
answers." Mixed public + private answers are a hostile or misconfigured
resolution result and must fail closed.

### §3 ADR-11D.2 §2 replacement interface

**WI-02 landing status**: the type/signature change below is in
production (`services/ocr-worker/src/fetcher/types.ts`,
`services/ocr-worker/src/fetcher/fetchPageBytes.ts`,
`services/ocr-worker/src/fetcher/httpsTransport.ts`,
commit history under `WI-02`). The runtime validation requirements
in §5 and the production transport behavior in §4 are NOT yet
implemented; those land in WI-03.

**WI-03a landing status**: WI-03a lands the pinned
`node:https.request` transport core and package exports only.
WI-03b runtime validation, WI-03c response adapter strictness, and
WI-03d full TLS harness/test activation remain pending. WI-03a does
not by itself complete the full WI-03 verification matrix or
go-live security sign-off. The canonical factory
`makeNodeHttpsRequestTransport` and the types `HttpsTransport` /
`DnsAddress` are re-exported from both
`services/ocr-worker/src/fetcher/index.ts` and
`services/ocr-worker/src/index.ts`.

Replace ADR-11D.2 §2 `HttpsTransport` seam with:

~~~ts
export interface DnsAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface HttpsTransport {
  fetch(
    url: URL,
    init: {
      signal: AbortSignal;
      allowedAddresses: ReadonlyArray<DnsAddress>;
    },
  ): Promise<HttpsTransportResponse>;
}

export interface HttpsTransportResponse {
  readonly status: number;
  readonly headers: Headers;
  /** Async iterable of byte chunks. Caller is responsible for
      enforcing size caps. */
  readonly body: AsyncIterable<Uint8Array>;
}
~~~

WI-02 tightened `DnsAddress.family` to `4 | 6` at compile time.
Runtime validation against malformed values from custom resolvers
or stale test stubs is still required and lands in WI-03 (§5),
since TypeScript does not protect JS callers.

`allowedAddresses` is required in the type and in production behavior.
Production transport must fail closed if the list is empty or missing.
Test stubs may ignore the parameter but must implement the required
signature.

### §4 Production transport

**WI-02 landing status**: the production default transport
(`makeNodeFetchHttpsTransport` in
`services/ocr-worker/src/fetcher/httpsTransport.ts`) currently
accepts `init.allowedAddresses` as a no-op and continues to use
global `fetch`. The behavior described below — `node:https.request`
with custom `lookup`, per-request `ca`, `agent: false`, etc. —
lands in WI-03. SSRF closure (no TOCTOU between fetcher DNS check
and socket DNS resolution) completes at WI-03, not WI-02.

**WI-03a landing status**: WI-03a lands the pinned
`node:https.request` transport core and package exports only.
WI-03b runtime validation, WI-03c response adapter strictness, and
WI-03d full TLS harness/test activation remain pending. WI-03a does
not by itself complete the full WI-03 verification matrix or
go-live security sign-off. The new canonical factory is
`makeNodeHttpsRequestTransport(options?: { ca?: string | Buffer |
Array<string | Buffer> })`; legacy `makeNodeFetchHttpsTransport()`
is retained as a thin compatibility wrapper that delegates to
`makeNodeHttpsRequestTransport({})`, so the existing
`fetchPageBytes.ts` default callsite continues unchanged. The
lookup callback pins to `allowedAddresses[0]` in both
`options.all === true` (single-element array) and legacy
single-address modes; the full vetted list is never returned
wholesale to Node's lookup. Strict runtime validation (§5), strict
Content-Length parsing + body adaptation (§6), and the abort-phase
mechanics + error mapping (§6/§7) remain WI-03b/c work and are not
yet implemented.

Default transport switches from global `fetch` to `node:https.request`.
`https.request(url, options)` accepts `http.request` options and TLS
options from `tls.connect()`, including `lookup`, `agent`, `signal`,
`ca`, `rejectUnauthorized`, and `servername` (Node 22.x docs:
https://nodejs.org/docs/latest-v22.x/api/https.html#httpsrequesturl-options-callback,
https://nodejs.org/docs/latest-v22.x/api/http.html#httprequesturl-options-callback,
https://nodejs.org/docs/latest-v22.x/api/tls.html#tlsconnectoptions-callback).

The transport must not TLS-connect to an IP literal as the request
hostname. It connects the socket to a vetted IP via custom `lookup`
while preserving the original URL hostname for Host, SNI, and
certificate verification. Node's TLS hostname verification uses
`tls.checkServerIdentity(servername, cert)` behavior for certificate
identity checks (Node 22.x docs:
https://nodejs.org/docs/latest-v22.x/api/tls.html#tlscheckserveridentityhostname-cert).

Required `https.request` behavior:
- Method is always `GET`; `HttpsTransport.fetch` has no method
  parameter. POST/PUT/DELETE are out of scope for v1.
- Select the first element of the already-vetted `allowedAddresses`
  array as supplied by the fetcher. The transport must not re-sort,
  filter, or re-prefer any family.
- Provide a custom `lookup(host, options, cb)` that returns exactly
  that entry via `cb(null, address, family)`.
- Keep request `hostname` and the Host header as `url.hostname`
  (including port handling per Node's normal URL/options behavior).
- Set `servername: url.hostname` so SNI and certificate verification
  use the original hostname, not the pinned IP.
- Keep `rejectUnauthorized: true`.
- Use `agent: false`. `https.request` otherwise defaults to
  `https.globalAgent`; disabling the agent gives each request an
  isolated socket and prevents pooled sockets or lookup state from
  crossing hostnames.
- Preserve manual redirect handling: 3xx responses are surfaced to the
  fetcher, not followed.
- Wire `signal` to the request and body consumption; on abort, destroy
  the request/response stream so connect wait, header wait, and
  mid-body stalls terminate under the existing deadline.

This is deliberately HTTP/1.1-only for v1. `https.request` uses the
HTTP/1.1 client path; that is acceptable because the fetcher performs
single-request GETs against pre-signed object-storage URLs and does
not need HTTP/2 multiplexing, server push, or HPACK. HTTP/2 support
would require a separate proof and ADR.

No HTTP/HTTPS proxy support in v1. Proxies move DNS resolution to the
proxy, which undermines this IP-pinning model. If proxies are later
required, that needs a separate ADR.

### §5 Runtime address validation

At transport entry, production must validate:
- `allowedAddresses` is a non-empty array.
- Every element is a plain object.
- `address` is a string.
- `family` is numeric and exactly `4` or `6`.
- `family: 4` parses as a plain IPv4 dotted-decimal literal.
- `family: 6` parses as a plain IPv6 hex literal.
- The parsed address family matches the declared family.

Fail closed with a transport error that the fetcher maps to
`https_network_error` on any violation.

The transport must also reject:
- Non-4 / non-6 family.
- IPv4-mapped IPv6 literals, including dotted and hex forms
  (`::ffff:1.2.3.4`, `::ffff:0102:0304`, etc.).
- Scoped link-local or scoped IPv6 literals with a `%zone` suffix.
- Malformed literals: any string that does not parse as plain IPv4
  dotted decimal or plain IPv6 hex.
- Addresses that fail `isPrivateIp`.

### §6 Response adapter

`https.request` returns `http.IncomingMessage`, not Web `Response`.
The default transport must adapt it to `HttpsTransportResponse`.

Header handling:
- Convert `IncomingMessage.headers` to a `Headers` object. Node's
  parsed headers object is lowercased and may represent duplicate
  values as comma-joined strings depending on the header.
- Use `IncomingMessage.rawHeaders` when needed to preserve legitimate
  duplicates by calling `Headers.append`, especially `set-cookie`.
  V1 object-storage GETs are unlikely to need repeated headers, but
  the adapter must not silently drop them.
- Parse `content-length` strictly before exposing the response:
  decimal integer, no leading zero unless exactly `"0"`, >= 0, and
  single-valued. Reject `"0123"`, negative values, non-integers, and
  multiple `content-length` values with a transport error mapped to
  `https_network_error`.
- If `content-length` is absent, expose no size hint; the fetcher's
  existing streamed byte cap remains authoritative.

Body handling:
- Convert the Node `Readable` body to `AsyncIterable<Uint8Array>`.
  Node 22 Readable streams are already async-iterable, but chunks may
  be `Buffer`.
- Do not pass `Buffer` through. Convert each chunk to a `Uint8Array`,
  e.g. `new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)`,
  or copy to an equivalent `Uint8Array`.
- If the abort signal fires during body iteration, iteration must throw
  a timeout-mapped error, not end as a partial-content success.

### §7 Error-code mapping

No new public fetcher error codes are introduced by this ADR.

- DNS lookup failures and connection/TLS failures map to
  `https_network_error`.
- Runtime transport input validation failures map to
  `https_network_error`.
- Strict `content-length` parse failures map to `https_network_error`.
- Timeout or abort during connect, headers, or body maps to
  `https_timeout`.
- Private DNS answers remain `host_resolves_to_private_ip`.
- Empty DNS answer set continues to reject before transport; current
  behavior maps it to `https_network_error`.

TLS certificate failures caused by a cert valid only for the IP, or for
the wrong hostname, are network failures and map to
`https_network_error`. Retry classification is not amended here.

## Consequences

### §1 Required sequencing

Before the full production transport rewrite, write and run a small
standalone TLS proof-of-concept, approximately 50 lines plus fixture
generation/helper code. It must use:
- A local self-signed-CA HTTPS server.
- `https.request`.
- Custom `lookup` returning `127.0.0.1`.
- Request URL hostname preserved as the original hostname.
- `servername` preserved as the original hostname.
- Per-request CA injection through the `ca` TLS option accepted by
  `https.request`/`tls.connect`; do not use `NODE_EXTRA_CA_CERTS`
  because that mutates the test process's global TLS trust.

The prototype is a prerequisite gate. Full transport rewrite begins
only after it proves:
1. Socket connects to the vetted IP.
2. SNI/Host are the original hostname.
3. Cert valid for the hostname succeeds.
4. Cert valid only for the IP fails with a certificate error that the
   implementation will map to `https_network_error`.

### §1.1 Prototype gate result (WI-01)

The prototype is implemented at
`dev-memo/prototypes/https-dns-pinning-poc.mjs` with its certificate
helper at `dev-memo/prototypes/https-dns-pinning-cert-helper.mjs`.

Command: `node dev-memo/prototypes/https-dns-pinning-poc.mjs`
Node: v22.22.1 LTS (darwin-arm64)
Result: **PASS** — all three scenarios behave as expected:

- `cert-valid-for-hostname` → TLS handshake succeeds; server observes
  `Host: allowed-host.test:<port>`, TLS SNI servername equal to
  `allowed-host.test`, AND the connected socket's local address
  (server side) equals `127.0.0.1`, confirming that the custom
  `lookup` directly pinned the connect.
- `cert-valid-only-for-ip-literal` → TLS handshake fails specifically
  with a HOSTNAME-VERIFICATION error (`ERR_TLS_CERT_ALTNAME_INVALID`
  / `ERR_OSSL_X509_HOST_MISMATCH`) because the cert's SAN lists only
  the pinned IP and Node's `checkServerIdentity` rejects it against
  the original URL hostname. The matcher in
  `https-dns-pinning-poc.mjs` accepts ONLY those two codes (or a
  hostname-altname mismatch message); a generic
  `UNKNOWN_CA` / `BAD_CERTIFICATE` / `DEPTH_ZERO_SELF_SIGNED_CERT`
  is treated as gate FAILURE because that would mask a broken CA
  setup instead of proving the hostname-verification property.
- `cert-valid-only-for-wrong-hostname` → TLS handshake fails the
  same way against an unrelated DNS SAN.

Per-request `ca` injection works through `tls.connect`'s options on
the request; `NODE_EXTRA_CA_CERTS` is NOT used and the test process's
global TLS trust remains unchanged.

Implementation notes captured during WI-01:
- Node 22's `http.request` invokes the custom `lookup` callback with
  `options.all = true`, which requires the callback signature
  `cb(err, [{ address, family }])`. The legacy
  `cb(err, address, family)` form is also accepted when `options.all`
  is falsy. Production transport must support both modes (or pin the
  `all: true` form once 22+ is the only supported Node line).
- Cert generation uses local `openssl` (OpenSSL 3.6.2 on the
  development host). No new runtime dependency added to any package.

Gate verdict: **GREEN**. WI-02t / WI-02 / WI-03 may proceed.

### §2 Required test surface

Transport/fetcher tests must cover:
- Mixed public + private DNS answers reject with
  `host_resolves_to_private_ip`.
- Zero vetted addresses rejects before transport, preserving today's
  behavior.
- Production transport rejects missing, empty, non-array, non-plain
  object, non-string `address`, nonnumeric `family`, non-4/6 family,
  malformed literals, scoped literals, IPv4-mapped IPv6, and private
  addresses with `https_network_error`.
- First vetted address means the first element of fetcher-supplied
  `allowedAddresses`; no transport reordering.
- Cert valid for hostname passes when socket is pinned to a vetted IP.
- Cert valid only for IP fails TLS verification and maps to
  `https_network_error`.
- Cert valid only for another hostname fails TLS verification and maps
  to `https_network_error`.
- Strict `content-length` parsing rejects leading zero, negative,
  non-integer, and duplicate values with `https_network_error`.
- Absent `content-length` streams under the existing size cap.
- Buffer chunks from `IncomingMessage` are exposed as `Uint8Array`.
- Manual 3xx handling survives the rewrite, including a
  transport-level local-HTTPS-server 302 case.
- Abort before socket connect resolves maps to `https_timeout`.
- Abort before response headers arrive maps to `https_timeout`.
- Abort mid-body after some chunks were delivered maps to
  `https_timeout`; stream iteration must not return partial success.

TLS fixtures:
- Local HTTPS server using a self-signed CA.
- Cert #1: SAN includes `localhost` or the chosen hostname
  (cert-valid-for-hostname -> pass).
- Cert #2: SAN includes only IP literal `127.0.0.1`
  (IP-only cert -> fail).
- Cert #3: SAN includes only `other-host.test`
  (wrong-host cert -> fail).
- CA injection uses the per-request `ca` option, keeping global TLS
  process state unaffected.

#### §2.1 Test files (authored by WI-02t)

- `services/ocr-worker/tests/fetcher.https.test.mjs` — fetcher-level
  tests against a stub transport. Existing tests cover scheme,
  expires, allowlist, MIME, DNS resolution, private-IP rejection,
  size cap, `expected_sha256`, byte-size mismatch, and abort
  mid-body via stub. WI-02t appended three seam-level tests for the
  `allowedAddresses` contract with full assertion bodies. **WI-02
  un-skipped these tests; they are active.** A regression that drops
  `allowedAddresses`, reorders it, or quietly subsets a mixed
  public+private answer set will fail one of the three.
- `services/ocr-worker/tests/fetcher.https.transport.test.mjs` —
  transport-level tests against the future production transport
  (export name `makeNodeHttpsRequestTransport` is provisional and may
  be renamed by WI-03; rename across the file before un-skipping).
  Coverage is split into two tiers:
    - **Full assertion bodies** today (15 cases): the runtime
      address-validation tests at the top of the file (missing,
      empty, non-array, non-plain-object, non-string address,
      nonnumeric family, non-4/6 family, malformed IPv4/IPv6,
      mapped IPv6 dotted + hex, scoped IPv6, family/address
      mismatch, private IPv4, private IPv6). Each calls
      `assert.rejects` on the transport with a message regex.
    - **Strategy stubs** today (18 cases): TLS scenarios,
      content-length parsing, body Uint8Array shape, manual 3xx,
      abort phases, e2e mapping. Each carries a detailed
      "Strategy when un-skipped" comment block describing the
      local-HTTPS-server + cert-suite setup, distinct response
      markers, and the assertion shape; the body is
      `assert.ok(makeNodeHttpsRequestTransport)` so the file
      compiles. These bodies will be fleshed out when WI-03 lands
      the production transport and the test infrastructure for a
      self-signed CA in the test process.
  All tests are `test.skip(..., { skip: "Unlocked by WI-03" })`
  regardless of tier. Imports of the future export are inside test
  bodies (via `await import(...)`) so the file loads cleanly today.

The skip-with-body / skip-with-strategy pattern keeps the
security-critical assertions and the setup requirements visible in
source, makes the constraints on WI-02 and WI-03 reviewable before
either ships, and minimizes the WI-02t-blast-radius by deferring
test-infrastructure (cert helper, local TLS server) to WI-03 where
it ships alongside the matching production code. Un-skip and replace
the strategy stub with the documented setup as each implementation
surface lands.

### §3 Operational consequences

- All existing `HttpsTransport` stubs gain the required
  `allowedAddresses` parameter in their signature, even if ignored.
- `node:https.request` brings in `IncomingMessage` semantics: body
  streaming, headers shape, strict length parsing, and abort behavior
  differ from `fetch`. Conversion lives entirely in the default
  transport.
- No new runtime dependency: pure `node:https`, `node:http`,
  `node:tls`, `node:net`, and existing fetcher code.
- Connection pooling is intentionally disabled for v1. If later fetch
  volume requires pooling, it needs a design that proves pinned lookup
  state cannot leak across hostnames.

## References

- ADR-11D.2 — original `https` source admission and DNS-blocking
  design, especially ADR-11D.2 §2 `HttpsTransport` seam.
- Node 22.x `https.request`: https://nodejs.org/docs/latest-v22.x/api/https.html#httpsrequesturl-options-callback
- Node 22.x `http.request` options: https://nodejs.org/docs/latest-v22.x/api/http.html#httprequesturl-options-callback
- Node 22.x `tls.connect` options: https://nodejs.org/docs/latest-v22.x/api/tls.html#tlsconnectoptions-callback
- Node 22.x `tls.checkServerIdentity`: https://nodejs.org/docs/latest-v22.x/api/tls.html#tlscheckserveridentityhostname-cert
- Plan-review NEEDS REVISION findings:
  - D1.1 / D2.1 — preserve any-private-answer rejection.
  - D1.2 — amend ADR-11D.2 §2 with exact replacement interface.
  - D1.3 — state fetcher vs transport ownership.
  - D2.2 / D5.1 — make TLS/SNI/hostname preservation a decision.
  - D2.4 / D2.5 — abort/body-stream wiring and error-code mapping.
  - D3.1 / D4.3 — specify `https.request` lookup behavior.
  - D3.4 / D5.2 — required test surface.
  - D4.1 / D4.2 — required `allowedAddresses` typing and fail-closed
    production behavior.
  - D5.3 — undici dispatcher spike.
- Audit `019e3dd3-20b5-7b33-b5a6-1f5448919ee6`:
  - `fetchPageBytes.ts:523` — D1 High
  - `httpsTransport.ts:13` — D1 High
- OWASP SSRF Prevention Cheat Sheet — DNS rebinding section.
- `dev-memo/spike-https-dns-pinning-undici.md`.

## Not in scope

- Connection-pooling redesign.
- IPv4/IPv6 preference policy beyond "use the first fully vetted
  address supplied by the fetcher."
- POST/PUT/DELETE or request bodies.
- HTTP/HTTPS proxy support.
- Replacing the `dnsLookup` injection seam with a registry.
- New retry-classification or public error-code changes.
- ADR-11D.2-B split; this ADR revises Step 11D.2-A in place.
- Undici dispatcher path. Spike resolved:
  `dev-memo/spike-https-dns-pinning-undici.md` rejects the Undici
  dispatcher route for v1 on three grounds: (i) Node 22.x does not
  expose the bundled Undici `Agent` / `buildConnector` as a documented
  importable surface; (ii) `ocr-worker-adapter` has no direct `undici`
  dependency and adding one is out of scope; (iii) on documented public
  surface alone the path cannot prove security requirements A (one
  vetted IP at connect), D (cert verifies against original hostname),
  and H (no fallback re-resolution). §4 (`https.request`) stands as
  the chosen path. Revisit if a direct `undici` dependency is later
  approved.

## Protocol-surface guardrails

The pinning model in §4 assumes a single, fresh socket per request
with the lookup callback firing exactly once at connect. Any future
change that breaks those assumptions can silently re-introduce the
DNS-rebinding / TOCTOU surface this ADR closes, even if the lookup
callback itself is unchanged. The following changes therefore
require a new ADR (or an explicit revision of this one) before
landing:

- HTTP/2 enablement on the fetcher's HTTPS transport (HTTP/2 reuses
  a single TLS connection for multiple streams; the per-stream
  lookup hook semantics are different from `http.request`'s).
- Re-introduction of HTTP/HTTPS proxy support (proxies move DNS
  resolution to the proxy and bypass the custom lookup entirely).
- Switching `agent: false` to a pooled or shared `https.Agent`
  (pooled sockets cache lookup results across requests and can
  reuse a connection after a rebind window).
- Any other form of socket reuse, keep-alive pooling, or
  connection multiplexing on the transport's HTTPS path.

These are deliberately listed as "guardrails" rather than "not in
scope" because they would each be a security-boundary change, not
merely a feature addition. A reviewer encountering such a change
in a PR should require a fresh ADR + audit + sign-off before
approving.
