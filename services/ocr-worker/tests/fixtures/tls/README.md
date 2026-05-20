# TLS Test Fixtures — WI-03d

**TEST-ONLY. NOT SECRETS. DO NOT REUSE IN PRODUCTION.**

These checked-in PEM files drive the WI-03d local HTTPS test harness in
`services/ocr-worker/tests/`. They exist only inside `node --test` runs
of this package. Production code never reads them. The private keys
are committed deliberately — they are not secrets and there is no
operational risk to disclosing them. Do NOT treat any file here as a
credential.

The keys and the test CA MUST NOT be:
- copied into any production, staging, or shared-environment trust store;
- reused as credentials for any service, internal or external;
- imported into a developer's local OS / browser / Node trust store;
- included in any container image or deployment artifact.

Regenerate (see "Regeneration" below) if any of the above happens by
accident — the in-repo fixtures are then considered compromised by
exposure, even though no real secret was lost.

## Fixture set

| File | Role | Subject | SAN | Signed by |
|------|------|---------|-----|-----------|
| `ca.crt` / `ca.key` | TEST-ONLY root CA | `CN=WI-03d Test Root CA` | n/a (self-signed CA) | self |
| `server-hostname.crt` / `.key` | Hostname-success leaf | `CN=allowed-host.test` | `DNS:allowed-host.test` | `ca.crt` |
| `server-ip-only.crt` / `.key` | Hostname-mismatch leaf with only an IP SAN | `CN=127.0.0.1` | `IP:127.0.0.1` | `ca.crt` |
| `server-wrong-host.crt` / `.key` | Wrong-hostname leaf (mismatch with CA-trust intact) | `CN=other-host.test` | `DNS:other-host.test` | `ca.crt` |

All certs:
- Key type: ECDSA `prime256v1` (P-256). Modern, small (~241-byte PEM), and matches Node's `tls.createSecureContext` defaults without RSA padding edge cases.
- Validity: 10 years from generation. `notBefore`/`notAfter` are baked into the cert; check `notAfter` against `Date.now()` before WI-03d execution. The fixture self-check test in `services/ocr-worker/tests/fixtures/tls/fixture-self-check.test.mjs` flags any cert whose validity window does not cover `Date.now() + 30 days`.
- Serial numbers (CA-issued leaves): `01` (server-hostname), `02` (server-ip-only), `03` (server-wrong-host). Deterministic so regeneration produces equivalent fixtures.
- Extended key usage: `serverAuth` only.
- Basic constraints: `CA:FALSE`.

## Regeneration

See `dev-memo/regen-tls-fixtures.md` for the exact one-time OpenSSL commands. The script is developer maintenance only — `node --test` MUST NOT shell out to OpenSSL.

Regenerate when:
- `notAfter` is within 12 months of `Date.now()` (the self-check test will flag this earlier — at the 30-day buffer — so you have time to refresh).
- A new SAN profile is required by a new test case (extend the table above, then run the regen script).
- Cryptographic-algorithm policy changes (e.g., move from P-256 to a larger curve).

## Self-check

`services/ocr-worker/tests/fixtures/tls/fixture-self-check.test.mjs` runs as part of the ocr-worker test suite and verifies:

- Each leaf's SAN matches the table above (parsed via Node's `crypto.X509Certificate`).
- Each leaf is signed by the test CA (issuer DN match + signature verification via the CA's public key).
- Each leaf's validity window covers `Date.now()` and at least 30 days into the future.
- Wronghost fixture is trusted by the test CA — so the failure mode in WI-03d Case 4 is hostname-mismatch, NOT CA-trust.

If the self-check fails, WI-03d test runs must NOT proceed. Regenerate fixtures and retry.

## Source of truth

The OpenSSL config files used for one-time regeneration live in `dev-memo/regen-tls-fixtures.md`. They are NOT in this directory — committing OpenSSL config files alongside fixtures invites accidental edits that diverge silently from the regenerated PEM contents.
