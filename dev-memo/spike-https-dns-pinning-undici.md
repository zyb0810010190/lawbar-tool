# Spike — Undici Dispatcher vs `node:https.request` for ADR-11D.2-A

## Question
Can Node 22.x/Undici replace the proposed `node:https.request` rewrite while pinning HTTPS connect to one fetcher-vetted DNS address?

## Method
Consulted Node.js v22.22.2 docs for `globalThis.fetch` custom dispatchers, `node:http.request` options (`lookup`, `signal`, `host`), `node:https.request` TLS options (`servername`, `rejectUnauthorized`), and `node:tls` SNI / certificate identity behavior. Consulted Undici published API docs for `fetch` `dispatcher`, `Client`/`Agent` custom `connect` / connector surface, and local `undici-types@6.21.0` declarations. Grepped local code: ADR-11D.2, ADR-11D.2-A, `httpsTransport.ts`, `fetchPageBytes.ts`, `types.ts`, `fetcher.https.test.mjs`, and `services/ocr-worker/package.json`.

Sources:
- Node 22.22.2 `fetch` custom dispatcher: https://nodejs.org/download/release/latest-jod/docs/api/globals.html#fetch
- Node 22.x `http.request` options include `lookup` and `signal`: https://nodejs.org/download/release/v22.16.0/docs/api/http.html
- Node 22.x `https.request` accepts `tls.connect()` options including `rejectUnauthorized` and `servername`: https://nodejs.org/download/release/latest-jod/docs/api/https.html#httpsrequesturl-options-callback
- Node 22.x TLS SNI / hostname verification: https://nodejs.org/download/release/latest-v22.x/docs/api/tls.html
- Undici `Client` custom connector docs: https://app.unpkg.com/undici@6.11.1/files/docs/docs/api/Client.md
- Local type surface: `services/ocr-worker/node_modules/undici-types/{fetch,client,connector}.d.ts`
- Local dependency check: `services/ocr-worker/package.json` has no `undici` dependency; `import("undici")` fails from `services/ocr-worker`.

## Findings (against requirements A–I)

| Req | Description | Undici dispatcher path | `https.request` path |
|-----|-------------|------------------------|----------------------|
| A | One vetted IP at connect | partial — Node `fetch` accepts a dispatcher, and Undici `Client` accepts a custom `connect`, but Node does not expose `Agent`/`buildConnector` from the bundled Undici as importable public API; no documented `fetch`/`Agent` per-request `lookup` or pre-resolved-IP option analogous to Node `lookup`. | ✓ — `http.request` options include custom `lookup`; `https.request` accepts `http.request` options, so custom lookup can return exactly one `{ address, family }`. |
| B | SNI = original hostname | partial — a custom Undici connector can receive `servername` in local `undici-types` and connector docs list TLS options, but the Node-bundled path does not expose the connector constructor without importing `undici`. Needs code proof if attempted. | ✓ — keep `hostname: url.hostname` and explicitly set `servername: url.hostname`; Node `https.request` accepts `servername` from `tls.connect()` options. |
| C | Host header = hostname | partial — if the request URL/origin remains the original hostname, Undici should generate the original Host / authority, but this spike did not find a Node 22 doc that pins Host / HTTP/2 `:authority` behavior for a custom connector returning a socket to a different IP. | ✓ — keep request `hostname` / URL as original hostname and do not make the IP literal the request host; Node request options distinguish request host from custom DNS lookup. |
| D | rejectUnauthorized + cert verifies against hostname | partial — Undici connector docs expose TLS options, but the no-new-dependency Node-bundled path does not expose a public Agent/connector constructor; certificate identity under a socket connected to a substituted IP would need implementation proof. | ✓ — `https.request` accepts `rejectUnauthorized` and `servername`; TLS docs state `checkServerIdentity(servername, cert)` verifies the certificate against the provided server name. |
| E | One-AbortSignal deadline | ✓ — `fetch(url, { signal })` is current behavior and existing code already maps `AbortError` / aborted signal across transport + body iteration. | ✓ — `http.request` options include `signal`; implementation can also destroy the request/body stream on abort, preserving the fetcher's one deadline. |
| F | Manual 3xx handling | ✓ — current `fetch(..., { redirect: "manual" })` exposes 3xx to `fetchPageBytes`; existing tests pin `redirect_unsupported`. | ✓ — `https.request` does not auto-follow redirects; 3xx response status is surfaced. |
| G | Error-code mapping preserved | partial — possible at wrapper level for `AbortError` vs generic errors, but custom connector/TLS errors need normalization and tests; direct Undici error classes are not part of current fetcher contract. | ✓ — wrapper can map request `AbortError`/abort to `https_timeout` and DNS/connect/TLS/socket failures to `https_network_error`; private DNS remains fetcher-owned. |
| H | No re-resolution / no fallback IP | partial — a hand-written Undici custom connector could connect to one IP, but no documented Node-bundled `fetch` API exposes per-request allowed address injection; using default Undici resolution or `autoSelectFamily` would violate this. | ✓ — custom `lookup` returns only the selected vetted address; no fallback resolver path if the request uses a per-call agent/request with that lookup. |
| I | No new dependency (Node-22-bundled or already-present) | ✗ — Node docs say `fetch` is based on bundled Undici and accepts compatible dispatchers, but constructing `Agent`/`buildConnector` requires installing/importing `undici`; `ocr-worker-adapter` does not depend on `undici`, and local `import("undici")` fails. Hand-rolling a Dispatcher is not a documented stable surface for this security boundary. | ✓ — pure Node core: `node:https`, `node:http`, `node:tls`; no package change. |

## Where each path breaks (if anywhere)
Undici dispatcher path:
- A/H are only partial on documented surface. The documented `fetch` option accepts a Dispatcher, but Node 22.x does not document a built-in import path for Undici `Agent` or a first-class per-request `lookup` / pre-resolved-IP option. Undici's custom `connect` can probably be made to return a socket connected to a chosen IP, but that relies on importing `undici` and proving Host/SNI/cert behavior with tests.
- B/D are partial for the same reason: Undici connector/TLS options exist in the package API, but the no-new-dependency Node-bundled path does not expose the constructor surface needed to use them.
- C is partial because the request origin should preserve Host / `:authority`, but this spike did not find a Node 22.x doc that explicitly pins Host / HTTP/2 authority when a custom connector socket is connected elsewhere.
- G is partial because wrapper-level mapping is feasible, but custom Undici connector errors need normalization tests before relying on it.
- I is a hard ✗ in this repo: `undici` is not a direct dependency, and adding it is forbidden.

Because A, D, and H are security requirements and the documented no-new-dependency Undici path cannot prove them end-to-end, reject the Undici path for v1.

`https.request` path:
- No hard break found on documented surface.
- Implementation must avoid shared pooling for v1, select exactly one vetted address, pass a per-request `lookup`, preserve `hostname` and `servername`, and test TLS hostname verification against a local HTTPS server.

## Recommendation
**https.request path**

Reason: `https.request` has the exact documented knobs this boundary needs: custom `lookup` for one vetted IP, original `hostname` / `Host`, explicit `servername`, certificate verification, and AbortSignal support, all from Node core. The Undici dispatcher route is attractive because it preserves the current fetch response/body surface, but without adding `undici` it lacks an importable documented Agent/connector surface, and without deeper proof it cannot carry security requirements A/D/H.

## Implications for ADR-11D.2-A
No ADR amendment needed; §4 stands as written. Remove the spike-pending note from §"Not in scope" and record this spike as the reason to proceed with the `fetch` → `node:https.request` rewrite.

## Open questions
- If the project later permits a direct `undici` dependency, a second spike could prototype `new Agent({ connect })` or `new Client(origin, { connect })` with a connector that calls `tls.connect({ host: vettedIp, servername: url.hostname, rejectUnauthorized: true })`, then prove Host / `:authority`, SNI, certificate identity, abort, and no fallback resolution with integration tests.
- Node's bundled Undici version varies by Node patch release and is discoverable via `process.versions.undici`; this spike does not rely on undocumented bundled internals.
- This spike did not inspect Node/Undici source. Any claim that `globalThis.fetch` plus a custom connector is security-equivalent to `https.request` would require source review or executable proof, not just the public docs.
