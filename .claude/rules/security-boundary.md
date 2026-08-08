---
description: SSRF/TLS/DNS/fetcher work is bounded-WI only; audit+verify gates required; no silent error-surface changes
applies-to:
  - "services/ocr-worker/**"
  - "docs/adr/ocr-fetcher-https-dns-pinning-*.md"
  - "docs/adr/*ssrf*"
  - "docs/adr/*tls*"
  - "docs/adr/*dns*"
  - "docs/release/*security*"
  - "docs/release/wi-03-*"
---

# Security Boundary

Security-sensitive code paths require stricter discipline than ordinary WIs. The WI-01 → WI-03d HTTPS DNS-pinning sign-off chain is the canonical example (`docs/release/wi-03-security-signoff.md`).

## In-scope work

Any change touching:

- HTTP/HTTPS fetchers, undici agents, custom `connect`/`lookup` hooks.
- TLS handshake configuration, certificate validation, SNI, ALPN, session resumption.
- DNS resolution paths used by outbound network code (especially with pinning / `allowedAddresses` seam).
- SSRF defense: IP allow/deny lists, link-local / loopback / RFC1918 / IPv6 ULA filtering, redirect handling.
- Auth, authorization, tenant isolation, sandbox boundaries, signature verification, crypto.

## Required loop

Every security-sensitive change must go through:

1. **Bounded WI** — exactly one work item; no scope creep.
2. **Plan review** — `/cc-suite:review-plan` before implementation. Architecture / security-impacting plans cannot skip this gate.
3. **Tests first** — regression tests for the new invariant and for the prior failure mode (proof the gap actually closes).
4. **Implement** — minimal change satisfying the WI.
5. **Audit** — `/cc-suite:audit` (or `/cc-suite:audit-fix` when fixes are pre-authorized) on the changed scope.
6. **Verify** — `/cc-suite:verify` confirms the audit findings landed.
7. **Sign-off doc** — if the WI closes a security gap previously flagged in audit, append to or create a sign-off doc under `docs/release/`.

## No silent surface changes

- **Do not** rename, remove, or merge `OcrQueueError` codes (`dedupe_conflict`, `unknown_receipt`, `stale_receipt`, `lease_expired`, `invalid_claim`) without an ADR and explicit user approval.
- **Do not** change exported error classes, public types, or thrown error shapes from security boundaries without documenting the diff in an ADR.
- **Do not** collapse `unknown_receipt`, `stale_receipt`, `lease_expired` into one.
- **Do not** loosen `allowedAddresses` semantics, broaden socket-pinning scope, or relax TLS validation as a "fix" without explicit approval.

## Go-live independence

- Closing a security WI **does not** imply go-live readiness.
- Go-live readiness requires `docs/release/go-live-readiness-report.md` to clear all Critical / High audit findings AND explicit user approval.
- Never claim "ready to ship" from sub-WI completion. See [[autonomy]] hard-stop list.

Related: [[autonomy]], [[staging-hygiene]].
