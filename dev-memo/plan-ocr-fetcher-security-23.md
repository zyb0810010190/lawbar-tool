# Plan — WI-OCR-FETCHER-SECURITY-23

**Type**: SECURITY hardening (fetcher SSRF core + test + docs). Touches the SSRF/TLS/DNS boundary
(`.claude/rules/security-boundary.md`) → cc-suite broker required (done, Path 1). **No schema/data-model/UI change.**
Follows the OCR confidentiality arc (WI-21/22). `main` @ `8e4977c`.

## First step (done)

Due Layer-B closeout for window `2c839ee..8e4977c` → `audit-mrem7ikh-0fm3sn` **BATCH-PASS C0 H0 M0 L1** (one
undescribed Low) → closeout `57e24ef`, marker → `8e4977c`.

## Goal

Verify + harden the OCR fetcher's SSRF / local-file / TLS / redirect / path-disclosure / deterministic-error
boundaries.

## Investigation (full inventory in `dev-memo/ocr-fetcher-security.md`)

The fetcher is **comprehensively hardened + tested** (WI-01→WI-03d chain): https-only + file/inline; path
containment; redirects **not followed** (`redirect_unsupported`); DNS-pin (`allowedAddresses`) + resolved-address
re-validation; a gold-standard `privateIp.ts` `BlockList` (loopback / RFC1918 / CGNAT / link-local+metadata / IPv6
local/ULA/multicast/doc / TEST-NETs / IPv4-mapped dotted+hex / fail-closed); TLS verified against the real SNI; size
+ timeout limits; stable sanitized error codes (WI-21/22). Deterministic tests via a local synthetic TLS server —
no external network.

## Gap found + fixed (smallest safe surface)

`isPrivateIp` **failed OPEN** on empty/non-string (`address.length === 0 → return false`), inconsistent with the
fail-closed treatment of every other malformed literal. Changed to **`return true`** (fail-closed). Not exploitable
(callers pass resolved DNS addresses; `httpsTransport` gates on `net.isIP` first; empty can't connect) — a
defense-in-depth uniformity fix. No caller/test relied on `""→false`.

## What was added / changed

- `services/ocr-worker/src/fetcher/privateIp.ts` — fail-closed on empty/non-string.
- `services/ocr-worker/tests/fetcher.privateIp.test.mjs` — a **direct** `isPrivateIp` regression: **block** every
  range, **allow** public/global (+ boundary cases just outside blocked ranges, so no silent over-block),
  **fail-closed** on unparseable/empty. Wired into the ocr-worker suite (`package.json`).
- `dev-memo/ocr-fetcher-security.md` (inventory + fix) + this plan.

## Requirements honored

No real client data (SSRF tests use synthetic/loopback addresses); no external network (local synthetic servers);
`dev-memo/run/intake/` untouched; OCR real-inference CI + confidentiality tests + config-path redaction unweakened;
stable error codes preserved; no cloud/remote; no accuracy work; no UI; no generated artifacts/secrets committed.

## Acceptance (met; live on PR)

Local: `fetcher.privateIp.test.mjs` 4/4 (block / allow+boundary / fail-closed str / fail-closed non-string); full
fetcher suites 130/130; full ocr-worker suite; real-engine smoke;
`case-box-persistence` ci + test. Live: the `ocr-chain` job on this PR runs the new SSRF test + the existing
DNS-seam SSRF tests.

## Out of scope

Following redirects (intentionally not supported); allowing public addresses (intended); any product/schema change;
OCR accuracy; cloud/remote fetch.
