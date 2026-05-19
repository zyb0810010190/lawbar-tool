# Spike — Undici Dispatcher vs `node:https.request` for ADR-11D.2-A

## Question

Can Node 22.x/Undici replace the proposed `node:https.request` rewrite
while pinning HTTPS connect to one fetcher-vetted DNS address?

## Method

Consulted Node.js 22.x docs for `globalThis.fetch` custom dispatchers,
`node:http.request` options (`lookup`, `signal`, `agent`),
`node:https.request` TLS options (`servername`, `rejectUnauthorized`,
`ca`), and `node:tls` SNI / certificate identity behavior. Consulted
Undici published API docs for `fetch` `dispatcher`, `Client`/`Agent`
custom `connect` / connector surface, and local
`undici-types@6.21.0` declarations. Grepped local code: ADR-11D.2,
ADR-11D.2-A, `httpsTransport.ts`, `fetchPageBytes.ts`, `types.ts`,
`fetcher.https.test.mjs`, and `services/ocr-worker/package.json`.

Sources:
- Node 22.x `fetch` custom dispatcher:
  https://nodejs.org/docs/latest-v22.x/api/globals.html#fetch
- Node 22.x `http.request` options include `lookup`, `agent`, and
  `signal`:
  https://nodejs.org/docs/latest-v22.x/api/http.html#httprequesturl-options-callback
- Node 22.x `https.request` accepts `http.request` options and TLS
  options, including `ca`, `rejectUnauthorized`, and `servername`:
  https://nodejs.org/docs/latest-v22.x/api/https.html#httpsrequesturl-options-callback
- Node 22.x `tls.connect()` options:
  https://nodejs.org/docs/latest-v22.x/api/tls.html#tlsconnectoptions-callback
- Node 22.x TLS hostname verification:
  https://nodejs.org/docs/latest-v22.x/api/tls.html#tlscheckserveridentityhostname-cert
- Undici `Client` custom connector docs:
  https://app.unpkg.com/undici@6.11.1/files/docs/docs/api/Client.md
- Local type surface:
  `services/ocr-worker/node_modules/undici-types/{fetch,client,connector}.d.ts`
- Local dependency check:
  `services/ocr-worker/package.json` has no `undici` dependency;
  `import("undici")` fails from `services/ocr-worker`.

## Findings (against requirements A–J)

| Req | Description | Undici dispatcher path | `https.request` path |
|-----|-------------|------------------------|----------------------|
| A | One vetted IP at connect | partial — Node `fetch` accepts a dispatcher, and Undici `Client` accepts a custom `connect`, but Node does not expose `Agent`/`buildConnector` from the bundled Undici as importable public API; no documented `fetch`/`Agent` per-request `lookup` or pre-resolved-IP option analogous to Node `lookup`. | yes — `http.request` options include custom `lookup`; `https.request` accepts `http.request` options, so custom lookup can return exactly one `{ address, family }`. |
| B | SNI = original hostname | partial — a custom Undici connector can receive `servername` in local `undici-types` and connector docs list TLS options, but the Node-bundled path does not expose the connector constructor without importing `undici`. Needs code proof if attempted. | yes — keep `hostname: url.hostname` and explicitly set `servername: url.hostname`; Node `https.request` accepts `servername` from `tls.connect()` options. |
| C | Host header = hostname | partial — if the request URL/origin remains the original hostname, Undici should generate the original Host / authority, but this spike did not find a Node 22 doc that pins Host / HTTP/2 `:authority` behavior for a custom connector returning a socket to a different IP. | yes — keep request `hostname` / URL as original hostname and do not make the IP literal the request host; Node request options distinguish request host from custom DNS lookup. |
| D | rejectUnauthorized + cert verifies against hostname | partial — Undici connector docs expose TLS options, but the no-new-dependency Node-bundled path does not expose a public Agent/connector constructor; certificate identity under a socket connected to a substituted IP would need implementation proof. | yes — `https.request` accepts `rejectUnauthorized` and `servername`; TLS docs document `tls.checkServerIdentity(servername, cert)` for certificate identity checks. |
| E | One-AbortSignal deadline | yes — `fetch(url, { signal })` is current behavior and existing code already maps `AbortError` / aborted signal across transport + body iteration. | yes — `http.request` options include `signal`; implementation must also destroy the request/body stream on abort, preserving the fetcher's one deadline. |
| F | Manual 3xx handling | yes — current `fetch(..., { redirect: "manual" })` exposes 3xx to `fetchPageBytes`; existing tests pin `redirect_unsupported`. | yes — `https.request` does not auto-follow redirects; 3xx response status is surfaced. |
| G | Error-code mapping preserved | partial — possible at wrapper level for `AbortError` vs generic errors, but custom connector/TLS errors need normalization and tests; direct Undici error classes are not part of current fetcher contract. | yes — wrapper can map request `AbortError`/abort to `https_timeout` and DNS/connect/TLS/socket/input-validation failures to `https_network_error`; private DNS remains fetcher-owned. |
| H | No re-resolution / no fallback IP | partial — a hand-written Undici custom connector could connect to one IP, but no documented Node-bundled `fetch` API exposes per-request allowed address injection; using default Undici resolution or `autoSelectFamily` would violate this. | yes — custom `lookup` returns only the selected vetted address; `agent: false` prevents reuse of any prior socket and avoids fallback resolver paths. |
| I | No new dependency (Node-22-bundled or already-present) | no — Node docs say `fetch` is based on bundled Undici and accepts compatible dispatchers, but constructing `Agent`/`buildConnector` requires installing/importing `undici`; `ocr-worker-adapter` does not depend on `undici`, and local `import("undici")` fails. Hand-rolling a Dispatcher is not a documented stable surface for this security boundary. | yes — pure Node core: `node:https`, `node:http`, `node:tls`, `node:net`; no package change. |
| J | HTTP/1.1-only acceptable for v1 | partial — current fetch/undici may negotiate HTTP/2 via ALPN depending on runtime behavior, but preserving that is not a v1 requirement. | yes — `https.request` is HTTP/1.1-only, and that is acceptable because the fetcher only does single-request GETs against pre-signed object-storage URLs; it does not need H2 multiplexing, server push, or HPACK. |

## Where each path breaks (if anywhere)

Undici dispatcher path:
- A/H are only partial on documented surface. The documented `fetch`
  option accepts a Dispatcher, but Node 22.x does not document a
  built-in import path for Undici `Agent` or a first-class
  per-request `lookup` / pre-resolved-IP option. Undici's custom
  `connect` can probably be made to return a socket connected to a
  chosen IP, but that relies on importing `undici` and proving
  Host/SNI/cert behavior with tests.
- B/D are partial for the same reason: Undici connector/TLS options
  exist in the package API, but the no-new-dependency Node-bundled
  path does not expose the constructor surface needed to use them.
- C is partial because the request origin should preserve Host /
  `:authority`, but this spike did not find a Node 22.x doc that
  explicitly pins Host / HTTP/2 authority when a custom connector
  socket is connected elsewhere.
- G is partial because wrapper-level mapping is feasible, but custom
  Undici connector errors need normalization tests before relying on
  it.
- I is a hard no in this repo: `undici` is not a direct dependency,
  and adding it is forbidden.
- J is not a security blocker. HTTP/2 feature parity is unnecessary
  for v1's single GET workload.

Because A, D, and H are security requirements and the documented
no-new-dependency Undici path cannot prove them end-to-end, reject the
Undici path for v1.

`https.request` path:
- No hard break found on documented surface.
- Implementation must avoid shared pooling for v1 with `agent: false`
  because `https.request` otherwise defaults to `https.globalAgent`.
- It must select exactly one vetted address: the first element of the
  already-vetted `allowedAddresses` array supplied by the fetcher.
  The transport must not re-sort, filter, or re-prefer any family.
- It must pass a per-request `lookup`, preserve `hostname` and
  `servername`, keep `rejectUnauthorized: true`, and test TLS hostname
  verification against a local HTTPS server.
- It must adapt `IncomingMessage` to the existing transport response
  shape and normalize errors.

## Recommendation

Use the `https.request` path.

Reason: `https.request` has the exact documented knobs this boundary
needs: custom `lookup` for one vetted IP, original `hostname` / Host,
explicit `servername`, certificate verification, AbortSignal support,
and per-request TLS `ca`, all from Node core. The Undici dispatcher
route is attractive because it preserves the current fetch
response/body surface, but without adding `undici` it lacks an
importable documented Agent/connector surface, and without deeper proof
it cannot carry security requirements A/D/H.

Production requirements:
- Use `agent: false`, not the default `https.globalAgent`. This is
  simpler than constructing a per-request `https.Agent` and prevents
  socket reuse across hostnames for v1. If pooling is later needed,
  it needs its own design proof.
- Support GET only. `HttpsTransport.fetch` gets no Method parameter.
  POST/PUT/DELETE and request bodies are out of scope.
- Support no HTTP/HTTPS proxy in v1. Proxies move DNS resolution to
  the proxy and undermine this IP-pinning model. Future proxy support
  needs a separate ADR.
- Tighten the typed surface from current `DnsAddress.family: number`
  to `family: 4 | 6`, and still validate at runtime.

Runtime fail-closed address validation:
- `allowedAddresses` must be a non-empty array.
- Every element must be a plain object with string `address` and
  numeric `family`.
- `family` must be exactly `4` or `6`.
- Reject malformed literals: anything that does not parse as plain
  IPv4 dotted decimal or plain IPv6 hex.
- Reject family/address mismatches.
- Reject IPv4-mapped IPv6 literals in dotted or hex form.
- Reject scoped link-local or other scoped IPv6 literals with a
  `%zone` suffix.
- Repeat `isPrivateIp(address)` in the transport and reject failures
  as `https_network_error`. This is defense in depth for JS callers
  and stale stubs; fetcher remains the primary owner of private-IP
  rejection.

Response adapter requirements:
- Convert `IncomingMessage.headers` to a `Headers` object. Node's
  parsed headers are lowercased and may represent duplicate values as
  comma-joined strings.
- Use `IncomingMessage.rawHeaders` where needed to preserve legitimate
  duplicate headers via `Headers.append`, especially `set-cookie`.
  V1 object-storage GETs are unlikely to need repeated headers, but
  the adapter should not drop them silently.
- Parse `content-length` strictly: decimal integer, no leading zero
  unless exactly `"0"`, >= 0, and single-valued. Reject `"0123"`,
  negative, non-integer, or duplicate values with
  `https_network_error`.
- If `content-length` is absent, treat size as unknown and let the
  existing streamed size cap enforce the limit.
- Convert the Node `Readable` to `AsyncIterable<Uint8Array>`. Node 22
  Readable is already async-iterable, but chunks may be `Buffer`; do
  not pass `Buffer` through. Convert each chunk to `Uint8Array`, e.g.
  `new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)`
  or an equivalent copy.
- Abort during body iteration must terminate with `https_timeout`, not
  a partial-content success.

Abort test plan:
- Abort before socket connect resolves -> `https_timeout`.
- Abort before response headers are received -> `https_timeout`.
- Abort mid-body after some chunks are delivered -> `https_timeout`;
  stream iteration must terminate cleanly with the timeout code.

TLS fixture plan:
- Local HTTPS server using a self-signed CA.
- Cert #1: SAN includes `localhost` or the selected test hostname
  (cert-valid-for-hostname -> pass).
- Cert #2: SAN includes only IP literal `127.0.0.1`
  (IP-only cert -> fail with certificate error).
- Cert #3: SAN includes only `other-host.test`
  (wrong-host cert -> fail with certificate error).
- V1 uses per-request `ca` passed through `https.request` /
  `tls.connect` options, not `NODE_EXTRA_CA_CERTS`, so the test
  process's global TLS trust is unaffected.

## Implications for ADR-11D.2-A

ADR-11D.2-A should proceed with the `fetch` -> `node:https.request`
rewrite, but only after a standalone TLS proof-of-concept passes.

Prototype gate:
- Build a small standalone script, roughly 50 lines plus certificate
  fixture generation/helper code.
- Start a local HTTPS server on `127.0.0.1` using a self-signed CA.
- Call `https.request` against a URL whose hostname is the original
  allowed hostname.
- Use custom `lookup` to return exactly `127.0.0.1`.
- Set `servername` to the original hostname.
- Use `agent: false`.
- Inject the CA with per-request `ca`.
- Prove the socket connects to the vetted IP.
- Prove SNI and Host are the original hostname.
- Prove a cert valid for the hostname succeeds.
- Prove a cert valid only for the IP fails with a certificate error
  that the production wrapper will map to `https_network_error`.

Only after that prototype passes should the production transport be
rewritten. This sequencing reduces the risk that the rewrite looks
plausible in unit tests while missing the actual TLS identity property
the ADR depends on.

## Open questions

- If the project later permits a direct `undici` dependency, a second
  spike could prototype `new Agent({ connect })` or
  `new Client(origin, { connect })` with a connector that calls
  `tls.connect({ host: vettedIp, servername: url.hostname,
  rejectUnauthorized: true })`, then prove Host / `:authority`, SNI,
  certificate identity, abort, and no fallback resolution with
  integration tests.
- Node's bundled Undici version varies by Node patch release and is
  discoverable via `process.versions.undici`; this spike does not rely
  on undocumented bundled internals.
- This spike did not inspect Node/Undici source. Any claim that
  `globalThis.fetch` plus a custom connector is security-equivalent
  to `https.request` would require source review or executable proof,
  not just public docs.
