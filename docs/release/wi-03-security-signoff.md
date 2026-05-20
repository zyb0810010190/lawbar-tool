# WI-03 HTTPS DNS-Pinning Security Sign-Off

**Date**: 2026-05-20
**Author**: Claude Opus 4.7 (assistant), under user authorization
**Scope**: HTTPS DNS-pinning / SSRF socket-pinning closure, WI-01 → WI-03d
**Outcome**: **SIGN-OFF GRANTED for the WI-03 series only.** Go-live readiness still requires the residual items listed in §10.

---

## 1. Scope and chain of evidence

This sign-off covers the closure of the SSRF / DNS-rebinding implementation
gap flagged in audit `019e3dd3-20b5-7b33-b5a6-1f5448919ee6` and resolved
across the following commits on `main` (HEAD = `ce3f287`):

| Commit  | Work item | Role |
|---------|-----------|------|
| `f96be47` | WI-01     | HTTPS DNS-pinning prototype gate (proof-of-concept) |
| `4dfc612` | WI-02t    | Transport regression spec — locks WI-02 seam contract |
| `df81b43` | WI-02     | Fetcher → transport `allowedAddresses` seam |
| `0c8211f` | WI-03a    | Pinned `node:https.request` production transport core |
| `1a9f55c` | WI-03b    | Runtime `allowedAddresses` validation + internal `HttpsTransportError` codes |
| `74ac1db` | WI-03c    | Strict response adapter — Content-Length, `Uint8Array` body, abort, 3xx |
| `ce3f287` | WI-03d    | TLS test harness + un-skip of remaining 8 cases + native-TLS `cause` preservation |

Authoritative reference docs:
- `docs/adr/ocr-fetcher-https-dns-pinning-step-11d-2-a.md` — ADR for Step 11D.2-A.
- `docs/release/test-and-audit-report.md` — Post-WI-03 readiness summary, residual baseline issues, targeted-suite counts.

---

## 2. Validation executed at sign-off

All commands run from repository root on `main @ ce3f287`, Node 24, against
the post-rebase tree (WI-03d fast-forwarded onto UI-00).

### 2.1 Build

```
npm --prefix services/ocr-worker run build      # tsc -p tsconfig.json → clean exit
```

### 2.2 Targeted WI-03d suites (4 files, per WI-03d plan)

| File | Tests | Pass | Fail | Skip |
|------|------:|-----:|-----:|-----:|
| `services/ocr-worker/tests/fetcher.https.transport.test.mjs`            | 41 | 41 | 0 | 0 |
| `services/ocr-worker/tests/fetcher.https.test.mjs`                      | 51 | 51 | 0 | 0 |
| `services/ocr-worker/tests/fetcher.public-surface.test.mjs`             |  5 |  5 | 0 | 0 |
| `services/ocr-worker/tests/fixtures/tls/fixture-self-check.test.mjs`    | 11 | 11 | 0 | 0 |
| **Total**                                                                | **108** | **108** | **0** | **0** |

The single deliberate runtime branch in `fetcher.https.transport.test.mjs`'s
no-reorder test (sub-case 2 — pin to `127.0.0.2`) emits a node:test
diagnostic and returns early when the `127.0.0.2` loopback alias is
unavailable on the host. This is documented in the test body and in the
WI-03d plan; it is NOT counted as a node:test `skipped` and does not weaken
sub-case 1, which is unconditional and was exercised on the validation host
(`ℹ 127.0.0.2 capability unavailable: 127.0.0.2 bind failed: EADDRNOTAVAIL — running sub-case 1 only`).

### 2.3 Full `services/ocr-worker` suite

| Tests | Pass | Fail | Skip |
|------:|-----:|-----:|-----:|
| 475   | 469  | 3    | 3    |

- **3 failures** — all baseline `better-sqlite3` ABI mismatch
  (`NODE_MODULE_VERSION 127 ≠ 137`, Node 22-built native binding under Node 24
  runtime). Locations: `tests/cli.sqlite.test.mjs:38`, `tests/cli.sqlite.test.mjs:101`,
  `tests/pipeline.real-engine.e2e.test.mjs:217`. Mitigation already documented
  in `docs/release/test-and-audit-report.md` Operational Notes #1
  ("Native module ABI" — run `npm rebuild` after every Node-version change).
  **Not introduced by WI-03 and not blocking this sign-off.**
- **3 skips** — all are opt-in real-engine tests gated on
  `OCR_WORKER_REAL_ENGINE_TESTS=1`
  (`OPT-IN: real engine detects CJK text…`,
  `OPT-IN: engine.detect is deterministic…`,
  `E2E real engine: bin -> real paddle -> persisted succeeded result with CJK text`).
  Intentional; unrelated to WI-03.

---

## 3. Question-by-question sign-off

### Q1. Is the DNS-rebinding / SSRF socket-pinning implementation gap closed?

**YES — for the production HTTPS fetcher's default transport path.**

Evidence:
- WI-02 (`df81b43`) routes the fetcher-vetted `allowedAddresses` list into the
  transport seam as a typed contract (`services/ocr-worker/src/fetcher/types.ts`
  `HttpsTransport.fetch(url, { signal, allowedAddresses })`).
- WI-03a (`0c8211f`) replaces the global-`fetch`-backed default transport with
  `makeNodeHttpsRequestTransport`, which uses `node:https.request` with a
  custom `lookup` that returns exactly `allowedAddresses[0]`, sets
  `agent: false` to defeat socket pooling, preserves the original URL
  hostname for SNI / Host / certificate identity, and keeps
  `rejectUnauthorized: true`.
- WI-03b (`1a9f55c`) adds preflight `allowedAddresses` validation that
  runs **synchronously inside `transport.fetch` before any `https.request`
  call**, with stable internal `HttpsTransportError` codes
  (`ADDRESS_PRIVATE`, `LITERAL_INVALID`, `FAMILY_MISMATCH`, etc.) that the
  fetcher maps to public `https_network_error` with `cause` preserved.
  Defense in depth: the transport repeats the private-IP check even though
  the fetcher already performed it (ADR §1).
- WI-03d (`ce3f287`) proves end-to-end against a real TLS server that:
  - the original URL hostname (not the pinned IP literal) is sent as SNI
    (asserted via the harness's `SNICallback` capture);
  - the original URL hostname is sent in the `Host` header
    (asserted via the harness's `req.headers.host` capture);
  - certificate verification rejects a leaf whose SAN omits the URL
    hostname (`server-ip-only` → `ERR_TLS_CERT_ALTNAME_INVALID`-class);
  - certificate verification rejects a CA-trusted leaf whose SAN is the
    wrong hostname (`server-wrong-host` → `ERR_TLS_CERT_ALTNAME_INVALID`-class,
    NOT `UNKNOWN_CA` / `BAD_CERT` / `SELF_SIGNED_CERT_IN_CHAIN`);
  - the no-reorder property holds — the transport connects to
    `allowedAddresses[0]` regardless of the input ordering.

The earlier TOCTOU window between `fetchPageBytes`' DNS lookup and the
default transport's own `fetch()`-driven DNS resolution is closed: the
production transport never re-resolves; the only DNS that runs is the
fetcher's, and only its first vetted address reaches the socket.

### Q2. Are all WI-03d non-platform-skipped tests active and green?

**YES.** 108 / 108 across the four WI-03d-relevant files. The only
conditional path is sub-case 2 of the no-reorder test, which depends on
the `127.0.0.2` loopback-alias capability per the WI-03d plan; sub-case 1
runs unconditionally and was exercised on the validation host.

### Q3. Are public error codes unchanged?

**YES.** `FETCHER_ERROR_CODES` in
`services/ocr-worker/src/fetcher/types.ts:11` is `Object.freeze`-d and
unchanged across WI-03a/b/c/d. The HTTPS-family codes remain exactly two:

- `HTTPS_TIMEOUT = "https_timeout"`
- `HTTPS_NETWORK_ERROR = "https_network_error"`

WI-03d's `fetchPageBytes.ts` change is additive (`cause: err` on the
generic catch-all branch) and does not introduce a new public code.
Runtime-frozen registry is also asserted in `fetcher.https.test.mjs`
("FETCHER_ERROR_CODES is runtime-frozen").

### Q4. Are public exports preserved, including `makeNodeFetchHttpsTransport`?

**YES.** Both names are exported from both public barrels:

| Symbol | `src/index.ts` | `src/fetcher/index.ts` |
|--------|----------------|------------------------|
| `makeNodeHttpsRequestTransport` | line 94 | line 16 |
| `makeNodeFetchHttpsTransport` (legacy compatibility wrapper) | line 95 | line 17 |

`fetcher.public-surface.test.mjs` actively asserts
"public barrel still exports the WI-02 / WI-03a fetcher surface" against
the built `dist/` output, so a renamed or removed export would fail CI.

### Q5. Are internal errors and test seams absent from public barrels?

**YES.** `fetcher.public-surface.test.mjs` enforces five claims, all
passing:

1. `dist/index.js` does NOT re-export WI-03b internal symbols.
2. `dist/fetcher/index.js` does NOT re-export WI-03b internal symbols.
3. The internal test seam `makeNodeHttpsRequestTransportForTest` is
   reachable ONLY via internal `dist/fetcher/...` paths (the test imports
   it directly to prove "tests are not lying about absence").
4. WI-03c internal error codes (`RESPONSE_ABORTED`,
   `RESPONSE_CONTENT_LENGTH_INVALID`, `RESPONSE_CONTENT_LENGTH_DUPLICATE`,
   `RESPONSE_BODY_CHUNK_INVALID`) are constructible internally and pass
   the type guard, but are not exposed publicly.
5. The legacy `makeNodeFetchHttpsTransport` and the new
   `makeNodeHttpsRequestTransport` remain public.

### Q6. Are TLS fixtures test-only, static, and safe from runtime OpenSSL dependency?

**YES.**

- All seven PEM files (`ca.{crt,key}`, `server-hostname.{crt,key}`,
  `server-ip-only.{crt,key}`, `server-wrong-host.{crt,key}`) are checked
  in under `services/ocr-worker/tests/fixtures/tls/` and consumed by
  the in-process `tls-fixtures.mjs` / `tls-server.mjs` helpers.
- `services/ocr-worker/tests/fixtures/tls/README.md` documents them as
  TEST-ONLY, marks them "DO NOT REUSE IN PRODUCTION", and lists explicit
  prohibitions (no copy into prod/staging trust stores, no use as
  credentials, no import into developer/browser/Node trust stores, no
  inclusion in container images or deployment artifacts).
- Regeneration is gated to developer maintenance in
  `dev-memo/regen-tls-fixtures.md`; the README and the dev-memo both
  state that `node --test` MUST NOT shell out to OpenSSL.
- `fixture-self-check.test.mjs` asserts at every test run that each
  leaf is signed by the CA, has the documented SAN profile, and is
  valid for at least 30 days into the future from `Date.now()` —
  preventing silent expiry.
- Verified at sign-off time by recursive grep: no
  `exec(File)?Sync.*openssl`, no `spawn.*openssl`, no
  `child_process.*openssl` anywhere under
  `services/ocr-worker/src` or `services/ocr-worker/tests`.

### Q7. Are local HTTPS tests loopback-only with no external network?

**YES.**

- `tls-server.mjs` has an explicit `if (!/^127\./.test(bindAddress))`
  guard at line 47 that refuses to bind to anything outside
  `127.0.0.0/8`, with the error message
  `tls-server.mjs is loopback-only; refusing to bind to ${bindAddress}`.
- All harness binds use `127.0.0.1` (default) or `127.0.0.2` (gated on
  the alias-capability probe).
- Ports are dynamic (`server.listen(0, bindAddress)`) by default; the
  new optional `port` parameter exists only so the no-reorder test can
  share a port across two loopback aliases for stronger proof.
- The `127.0.0.2` probe (`probe127_0_0_2_loopback`) catches
  `EADDRNOTAVAIL` and `EACCES` as deterministic-unsupported, and
  rejects on any other code per the WI-03d plan's "fail on unknown"
  rule.
- No DNS resolution of external hostnames occurs in any WI-03d test.
  The custom transport pins `lookup` to a loopback IP literal supplied
  by the test, and the URL hostname (`allowed-host.test`) is used only
  for SNI and Host assertions — it is never resolved.

### Q8. Are known residual risks documented?

**YES.** Documented in `docs/release/test-and-audit-report.md` under
"Residual baseline issues" and in the ADR's §"Not in scope" and
§"Protocol-surface guardrails" blocks. The risks recognised at this
sign-off are:

1. **`better-sqlite3` native-module ABI mismatch** — surfaces 3 test
   failures (`cli.sqlite.test.mjs:38/101`,
   `pipeline.real-engine.e2e.test.mjs:217`) when active Node ABI ≠
   compile-time ABI. **Pre-existing baseline. Not introduced by WI-03.**
   Mitigation: `npm rebuild` per
   `docs/release/test-and-audit-report.md` Operational Notes #1.
   Must be re-applied after any Node-version change in the operator
   checklist (WI-09b) and final sweep (WI-12).
2. **`cli.spawn.test.mjs:260` SIGINT flake** — pre-existing baseline,
   tracked separately, not introduced by WI-03.
3. **HTTP/2, proxy support, pooled `https.Agent`, keep-alive socket
   reuse** are explicitly *out of scope* and listed in the ADR's
   "Protocol-surface guardrails" as changes that require a fresh
   ADR + audit + sign-off before landing, because each one could
   silently re-introduce the DNS-rebinding / TOCTOU surface this WI
   closes.
4. **Address ordering policy** — v1 uses the order returned by
   `dnsLookup` after validation. No IPv4/IPv6 preference policy is
   implemented; this is a deliberate scope exclusion documented in
   the ADR.
5. **POST/PUT/DELETE and request bodies** — out of scope for v1.
6. **`127.0.0.2` loopback alias** — sub-case 2 of the no-reorder test
   is skipped on hosts without the alias (e.g. default macOS). This
   is platform capability, not test weakness; sub-case 1 still proves
   pinning unconditionally.

### Q9. Is any work still required before go-live?

**YES.** This sign-off covers the WI-03 series only. The following must
clear before a go-live readiness claim:

| Item | Owner | Blocker for go-live? |
|------|-------|----------------------|
| WI-04 and any later WIs listed in `docs/release/go-live-plan.md` that are still open | Per the go-live plan | Yes |
| Operator checklist (WI-09b) carrying the `npm rebuild` step for `better-sqlite3` after every Node-version change | WI-09b owner | Yes |
| Final cross-package sweep (WI-12) green on the pinned Node version | WI-12 owner | Yes |
| External security review (if required by the release process) — this sign-off is a developer-tier sign-off based on the in-repo evidence, not a third-party penetration test | Release process | If your release process requires it |
| Production deployment, secret/credential changes, and any other items in AGENTS.md's "Required stop-and-ask gates" | User | Yes |

The ADR itself is now consistent: §3 and §4 status blocks were
rewritten in WI-03d's audit-fix loop to remove the
landed-vs-pending contradiction that earlier review flagged.

### Q10. Is GW-00 allowed to start after this sign-off?

**Conditional on user authorization.** This sign-off does not by itself
authorize GW-00. AGENTS.md's "Required stop-and-ask gates" requires
explicit user authorization to start new work, and per the user's
preceding turn, GW-00 is explicitly deferred ("Do not start GW-00").

**Recommendation:** GW-00 may start from a clean branch off
`main @ ce3f287` once the user gives explicit authorization. The WI-03
series no longer blocks subsequent work — the only known WI-03-adjacent
concern is the protocol-surface guardrails list in the ADR, which
applies to future changes, not to GW-00 unless GW-00 touches HTTP/2,
proxy, agent pooling, or keep-alive.

---

## 4. Sign-off

**WI-03 series (WI-01 → WI-03d) — DNS-pinning / SSRF closure: SIGNED OFF
on developer-tier evidence at `main @ ce3f287`, 2026-05-20.**

This sign-off:

- **does** confirm that the implementation gap flagged in audit
  `019e3dd3-20b5-7b33-b5a6-1f5448919ee6` is closed at the level of the
  production HTTPS fetcher's default transport;
- **does** confirm that the WI-03d test matrix exercises the relevant
  TLS, Host, SNI, no-reorder, abort, content-length, and error-mapping
  properties end-to-end via local TLS servers;
- **does** confirm that no public error code, public export, or test
  seam regressed;
- **does NOT** constitute a go-live readiness claim;
- **does NOT** authorize starting GW-00;
- **does NOT** substitute for any third-party security review your
  release process requires.

---

## 5. Cross-references

- `docs/adr/ocr-fetcher-https-dns-pinning-step-11d-2-a.md`
- `docs/release/test-and-audit-report.md`
- `docs/release/go-live-plan.md`
- `dev-memo/regen-tls-fixtures.md`
- `services/ocr-worker/tests/fixtures/tls/README.md`
- Codex audit thread for WI-03d: `019e44cd-00a6-7531-bfb2-8a79bf9ddcca`
