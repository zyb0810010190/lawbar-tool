# OCR fetcher security boundaries

**WI**: `WI-OCR-FETCHER-SECURITY-23`. Verifies + hardens the OCR fetcher's SSRF / local-file / TLS / redirect /
error-disclosure boundaries. **Investigation outcome: the fetcher is comprehensively hardened + tested** (the
WI-01→WI-03d DNS-pinning sign-off chain); one **fail-open inconsistency** in the SSRF-core predicate was found and
fixed (defense-in-depth), plus a direct `isPrivateIp` regression test was added.

## Inventory

| # | Surface | Behavior | Verdict |
|---|---|---|---|
| 1 | **Supported schemes** | `source.kind` ∈ {`file`, `inline`, `https`} only; any other → `source_kind_unsupported`. A non-`https:` URL scheme → rejected (schema-bypass defense) | ✓ allow-list |
| 2 | **file fetch** | `pathContainment.ts` enforces the source path is contained under the configured `fetcher_file_root` (realpath, `path_escape` on traversal); fd-based `open`/`fstat`/`read`; regular-file gate (dirs/FIFOs/sockets/devices → `file_not_regular`) | ✓ contained |
| 3 | **HTTP/HTTPS** | **https only** (no plain http). Per-request CA injection; size + content-length checks | ✓ |
| 4 | **Redirects** | 3xx is **not followed** — surfaced as `redirect_unsupported` (transport returns the status, never chases `Location`). No redirect-based SSRF bypass; "re-check final target" is moot | ✓ safest posture |
| 5 | **DNS / IP** | DNS-pin (WI-03b): the resolved address is pinned into `allowedAddresses[0]`, connected by IP while preserving the SNI hostname; the resolved address is re-validated (`isPrivateIp` defense-in-depth in the transport) | ✓ pinned + re-checked |
| 6 | **Private / loopback / link-local / metadata** | `privateIp.ts` (`BlockList`) blocks: `0/8`, `10/8`, **`100.64/10` (CGNAT)**, `127/8`, **`169.254/16` (link-local + `169.254.169.254` metadata)**, `172.16/12`, `192.0.0/24`, `192.0.2/24`+`198.51.100/24`+`203.0.113/24` (TEST-NETs), `198.18/15`, `192.168/16`, `224/4`, `240/4`, `255.255.255.255/32`; IPv6 `::`, `::1`, `fe80::/10`, `fc00::/7`, `ff00::/8`, `2001:db8::/32`, plus (WI-23) `64:ff9b:1::/48` (NAT64-local), `100::/64`, `100:0:0:1::/64`, `2001:2::/48`, `3fff::/20`, `5f00::/16`. **IPv4-mapped IPv6** (dotted AND hex `::ffff:7f00:1`) is normalized + re-checked (audit 019e3af0). **Fail-closed** on unparseable/non-string | ✓ comprehensive |
| 7 | **IPv6 local/private** | `::1`, `fe80::/10`, `fc00::/7`, `::` — all blocked (see #6) | ✓ |
| 8 | **TLS** | `httpsTransport.ts` validates the certificate against the real SNI hostname (default Node TLS verification; per-request `ca`); tests use a local synthetic TLS server (`tests/helpers/tls-server.mjs`) — no external network | ✓ |
| 9 | **Timeout / size limits** | phase-1 abort / timeout (`https_timeout`); content-length + streamed body size checks (`https_network_error` on malformed/oversize) | ✓ |
| 10 | **Error / log disclosure** | Stable `FETCHER_ERROR_CODES`; the raw fetcher message (which can carry a path/URL) is **substituted** with a path-free `SANITIZED_FETCHER_MESSAGES` string in the durable `partial_failure.message` (audit 019e3a2e D2) and is **not logged** (engines/loop/coordinator have zero `console`/`writeErr`); config paths in the worker startup log are `fp:<hash>`-redacted (WI-22) | ✓ (WI-21/22) |

**Tests (deterministic, loopback-only):** DNS-seam SSRF rejections — `127.0.0.1`, `192.168.1.5`, **`169.254.169.254`
(metadata)**, `fe80::1`, `::ffff:7f00:1` (mapped hex); `3xx → redirect_unsupported`; path-containment; content-length
/ body-shape / abort. All via a local synthetic TLS server (`tests/helpers/tls-server.mjs`) — **no external network**.

## What was fixed

**1. `isPrivateIp` failed OPEN on empty / non-string.** The top guard `address.length === 0` returned **`false`**
(allowed), inconsistent with the fail-closed treatment of every other malformed literal. Changed to **`return true`
(fail-closed)**. Not exploitable in practice — real callers pass a *resolved DNS address*, and `httpsTransport`
gates on `net.isIP(address) === family` **before** `isPrivateIp`; an empty address also cannot be connected to. A
defense-in-depth uniformity fix; no caller/test relied on `""→false`.

**2. IPv6 blocklist completed (audit H1).** The prior IPv6 set covered the main private/local ranges but missed
several newer IANA "Globally Reachable: False" special-use ranges. Added `64:ff9b:1::/48` (NAT64 **local-use**),
`100::/64` (discard-only), `100:0:0:1::/64` (dummy), `2001:2::/48` (benchmarking), `3fff::/20` (documentation),
`5f00::/16` (SRv6 SIDs). All are non-globally-routable, so blocking them cannot break a legitimate public fetch;
the NAT64-local one closes a plausible SSRF residual in NAT64 translation environments. **Deliberately NOT blocked:**
the well-known NAT64 prefix `64:ff9b::/96` (RFC 6052) — it translates to *global* IPv4, so blocking it would break
legitimate NAT64 fetches.

**Over-block note (audit L1, accepted).** IPv4 `192.0.0.0/24` (IETF protocol assignments) is blocked as a whole,
which conservatively over-blocks the two globally-reachable anycast addresses `192.0.0.9`/`192.0.0.10` (PCP / TURN
anycast). This is the **safe direction** (those are not OCR document hosts) and is intentional; the SSRF policy is
"block all non-globally-routable ranges, erring conservative on special-use blocks" rather than an exact
globally-reachable partition.

## What was added

- `services/ocr-worker/tests/fetcher.privateIp.test.mjs` — a **direct** unit test of `isPrivateIp` pinning the full
  contract: **blocks** every private/special-use range (loopback, RFC1918, CGNAT, link-local/metadata, IPv6
  local/ULA/multicast/doc, TEST-NETs, IPv4-mapped dotted+hex, zone-id); **allows** public/global addresses incl.
  boundary cases just outside blocked ranges (so the blocklist can't silently over-block legitimate fetches); and
  **fails closed** on unparseable/empty input. Wired into the ocr-worker suite.
- `services/ocr-worker/src/fetcher/privateIp.ts` — the fail-closed fix above.
- this doc + the plan.

## What remains intentionally allowed / out of scope

- Public/global addresses are **allowed** (that is the point — the fetcher must reach real hosts). Only
  non-globally-routable ranges are blocked.
- `file` + `inline` sources bypass the network SSRF path by design (local/embedded), gated by path containment.
- No product change beyond the SSRF-core fail-closed fix; no accuracy work; no cloud/remote behavior.

## References
- `services/ocr-worker/src/fetcher/{privateIp,fetchPageBytes,httpsTransport,pathContainment}.ts`.
- `.claude/rules/security-boundary.md` (the WI-01→WI-03d sign-off chain + no-silent-surface-change rules).
- `docs/release/wi-03-security-signoff.md` (the HTTPS DNS-pinning sign-off).
