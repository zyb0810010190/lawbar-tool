# A3-T2 page-ratio math audit report

AUDIT-SCOPE: native/evidence-core/lib/page-ratio.mjs + native/evidence-core/tests/page-ratio.test.mjs
AUDIT-VERDICT: PASS C0 H0 M0 L3

## Attempts
- audit-mqqty8tn-xvy22o (Path 1, full-rigor prompt): TIMEOUT (spawnSync codex ETIMEDOUT; class TIMEOUT).
- audit-mqqv21xt-mtxik9 (Path 1 retry, tighter file-scoped prompt): PASS C0 H0 M0 L3. rawOutput sha256
  9a057a64849fae07b63618f6024a4a2c7b12c365e13155a89edf35cef092340a.

## Confirmed (no C/H/M)
- Coordinate math correct: box origin subtracted; 0/90/180/270 maps correct; denormalize uses the exact
  inverse maps.
- Determinism: 12 fractional digits, round-half-to-even (ties + negatives), -0 -> 0, roundtrip <= 1e-9.
- Top-level normalize/denormalize fail closed on all listed invalid inputs.
- Library pure + scoped; nothing under dev-memo/run/evidence/; confined to the two files.
- Tests use independent hand-computed oracles.

## Deferred Lows (cleanup / test-robustness; safe to proceed; out-of-scope for this pure-math WI)
- L1: canonicalizeRatio() clamps finite out-of-domain values if called DIRECTLY instead of throwing. The
  public normalize/denormalize validate the domain (out_of_bounds / invalid_ratio_domain) before
  canonicalize is reached, so the contract path never passes out-of-domain values; the helper's clamp is the
  DOMAIN_TOL design. Reason: cleanup-only, no contract-path impact. Target: a future A3 hardening WI.
  Safe-to-proceed: YES.
- L2: the test file does I/O (reads dev-memo/run/evidence/) to assert the library writes nothing. Intentional
  — the no-side-effect assertion must read the namespace. It is the TEST, not the library. Reason: accepted
  as-is. Target: none. Safe-to-proceed: YES.
- L3: denormalize's inverse is pinned mainly by the roundtrip; a matching wrong forward/inverse pair could
  co-survive. Mitigated by the per-rotation normalize oracles (which independently pin the forward maps) + the
  roundtrip. Reason: test-strengthening, out-of-scope for this WI. Target: a future A3 test-hardening WI
  (add an independent denormalize oracle). Safe-to-proceed: YES.

verify: N/A — audit returned C0 H0 M0 (no Critical/High/Medium findings to close).
