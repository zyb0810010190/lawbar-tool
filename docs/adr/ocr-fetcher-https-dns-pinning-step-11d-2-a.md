# ADR: Fetcher — Bind HTTPS Connect to Vetted DNS Address (Step 11D.2-A)

## Status

Proposed. Not yet implemented.

## Context

ADR-11D.2 wired the `kind: "https"` source with DNS-resolution-based
private-IP blocking: `fetchFromHttps` calls `deps.dnsLookup(hostname)`
and rejects the fetch if any returned address is non-globally-routable
(`isPrivateIp`). The intent is to prevent SSRF against private
infrastructure.

Audit `019e3dd3-20b5-7b33-b5a6-1f5448919ee6` (mini, 2026-05-18) flagged
that the vetted addresses are not bound to the actual transport
connection. `fetchFromHttps`:

```
addresses = await dnsLookup(url.hostname);     // first resolution → vetted
...
response = await transport.fetch(url, { signal });
```

The default transport (`makeNodeFetchHttpsTransport`) calls global
`fetch(url, …)`, which performs its **own** DNS resolution under the
hood (undici). A DNS-rebinding attacker can answer the first lookup
with a public address (passes `isPrivateIp`) and the second lookup
with a private address (`127.0.0.1`, `169.254.169.254`, internal
RFC1918, etc.). The vetted check is bypassed.

This is a real SSRF gap. Severity: High (D1 Logic & Correctness +
implicit Security).

This ADR **amends ADR-11D.2 §2**. ADR-11D.2's transport seam used
`fetch(url, { signal })`; that is insufficient because production
transport can resolve DNS again after the fetcher has vetted a
different answer set.

## Decision

Bind the HTTPS connection to a fetcher-vetted DNS answer without
weakening the existing "any private answer rejects" invariant.

### §1 Fetcher/transport ownership

Fetcher owns:
- DNS lookup through the existing injected `dnsLookup` seam.
- Empty-result rejection.
- Private-IP rejection across the complete answer set.
- Passing the fully vetted public answer list into transport.

Transport owns:
- Connecting to exactly one supplied vetted address.
- Failing closed if `allowedAddresses` is absent or empty at runtime.
- Preserving URL hostname semantics for Host, SNI, and certificate
  verification while the socket connects to the vetted IP.

### §2 DNS validation order

DNS handling remains two-phase:

1. Fetcher resolves all addresses with `dnsLookup(url.hostname)`.
2. Fetcher rejects if the result is empty.
3. Fetcher validates **every** returned address with `isPrivateIp`.
   If any address is non-globally-routable, reject the hostname with
   `host_resolves_to_private_ip`.
4. Only after the complete set passes may transport select one address
   from the fully vetted public list.

Do not change this to "pick a public answer and ignore private
answers." Mixed public + private answers are a hostile or misconfigured
resolution result and must fail closed.

### §3 ADR-11D.2 §2 replacement interface

Replace ADR-11D.2 §2's `HttpsTransport` interface with:

```ts
export interface HttpsTransport {
  fetch(
    url: URL,
    init: {
      signal: AbortSignal;
      allowedAddresses: ReadonlyArray<{ address: string; family: 4 | 6 }>;
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
```

`allowedAddresses` is required in the type and in production behavior.
Production transport must fail closed if the list is empty or missing.
Test stubs may ignore the parameter but must implement the required
signature.

### §4 Production transport

Default transport switches from global `fetch` to `node:https.request`.
It must not TLS-connect to an IP literal as the request hostname.
Instead, it connects the socket to a vetted IP via custom lookup while
preserving the original URL hostname for Host, SNI, and certificate
verification.

Required `https.request` behavior:
- Select exactly one entry from `allowedAddresses` for this request
  (v1: first vetted address; no separate IPv4/IPv6 preference policy).
- Provide a custom `lookup(host, options, cb)` that returns exactly
  that entry via `cb(null, address, family)`.
- Keep request `hostname` and the Host header as `url.hostname`
  (including port handling per Node's normal URL/options behavior).
- Set `servername: url.hostname` so SNI uses the original hostname.
- Keep `rejectUnauthorized: true`.
- Preserve manual redirect handling: 3xx responses are surfaced to the
  fetcher, not followed.
- Wire `signal` to the request and to body consumption; on abort,
  destroy the request so both connect/header wait and mid-body stalls
  terminate under the existing deadline.

Connection pooling remains per-call/no shared agent so pinned lookup
state cannot leak across hosts.

### §5 Error-code mapping

No new public fetcher error codes are introduced by this ADR.

- DNS lookup failures and connection/TLS failures map to
  `https_network_error`.
- Timeout or abort during connect, headers, or body maps to
  `https_timeout`.
- Private DNS answers remain `host_resolves_to_private_ip`.
- Empty DNS answer set continues to reject before transport; current
  behavior maps it to `https_network_error`.

TLS certificate failures caused by a cert valid only for the IP, or for
the wrong hostname, are network failures and map to
`https_network_error`. Retry classification is not amended here.

## Consequences

- Required test surface:
  - Mixed public + private DNS answers rejects with
    `host_resolves_to_private_ip`.
  - Zero vetted addresses rejects before transport, preserving today's
    behavior.
  - Cert valid for the hostname passes when socket is pinned to a
    vetted IP.
  - Cert valid only for the IP, or for the wrong hostname, fails TLS
    verification and maps to `https_network_error`.
  - Timeout, abort, and mid-body socket destroy map to
    `https_timeout` / `https_network_error` per existing rules.
  - Manual 3xx handling survives the rewrite, including existing
    fetcher tests plus one transport-level local-HTTPS-server 302 case.
  - Integration tests use a local HTTPS server with a self-signed cert,
    not only fetcher stub tests.
- All existing `HttpsTransport` stubs gain the required
  `allowedAddresses` parameter in their signature, even if ignored.
- `node:https.request` brings in `IncomingMessage` semantics — body
  streaming, headers shape — divergent from `fetch`'s Web stream
  surface; conversion lives entirely in the default transport.
- No new dependency (pure `node:https` + `node:dns`).

## References

- ADR-11D.2 — original `https` source admission and DNS-blocking design.
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

## Not in scope

- Connection-pooling redesign (out of scope; agent per call is fine
  for v1 fetch volume).
- IPv4/IPv6 preference policy beyond "use the first fully vetted
  address."
- Replacing the `dnsLookup` injection seam with a registry — keep the
  function injection as is.
- New retry-classification or public error-code changes.
- ADR-11D.2-B split; this ADR revises Step 11D.2-A in place.
- Undici dispatcher spike result is a prerequisite before committing to
  the full `fetch` -> `https.request` rewrite: verify whether undici's
  public `Dispatcher` API in Node 22.x can pin connect to a vetted IP
  while preserving fetch's stream/header surface. If it has no public
  pre-resolved-IP API, record that conclusion explicitly and proceed
  with `https.request`; if it can do this cleanly, prefer the dispatcher
  path instead.
