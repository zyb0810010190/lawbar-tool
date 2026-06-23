# A0.7 renderer-conformance — fixture/oracle artifacts (design-only data, WI-ENA7)

**Data + docs only. Not a harness, not an A0.7 run, not a marker, not production anchor geometry.**

This directory materializes the synthetic fixture reference + the independent oracle that the **future** A0.7
renderer-conformance gate will be measured against. It is authored per
`docs/adr/ADR-evidence-native-core-a07-feasibility.md` (ENA-00) and, specifically, the gate design
`docs/adr/ADR-evidence-a07-renderer-conformance-gate.md` (A07-GATE-00) §2 (fixtures) and §3 (oracle).

These files contain **no executable logic** — only JSON data and this README. WI-ENA7 adds no Swift, no JS/TS,
no harness, no marker, no provenance/HMAC, and no tamper guard. Those are separate, individually-authorized
WIs (A07-GATE-00 §8); none is authorized by ENA7.

## Files
- `manifest.json` — the fixture record: path, provenance, sha256, byte size, page count, page-index convention,
  page-box (mediaBox) origin + per-page extent. Reuses the existing
  `../synthetic-twopage.pdf` (the WI-ENA3 fixture); the PDF is **not** duplicated.
- `oracle.json` — the expected values defined **before** any harness exists and **independent of the code under
  test**: page count, per-page mediaBox extent (612 x 792), the normalization formula, deterministic
  sample-point normalize/denormalize expectations, the numeric tolerance (`1e-9` absolute), and the
  pass / fail / **inconclusive (≠ pass)** interpretation.

## Fixture (reused)
- Path: `../synthetic-twopage.pdf`
- sha256: `63d91a6c75cc10350c0a15df19a12620d938637acf3529c15cab7d4e6e0d9276`
- Size: 432 bytes — two empty US-Letter pages, no content stream/fonts/images/text/metadata, synthetic &
  non-confidential.

## Hard constraints (carried from A07-GATE-00)
- **Inconclusive is not pass.** A harness that cannot produce a comparable value reports inconclusive, which
  does not advance the gate.
- **`not_implemented` is fail.** Until a real A0.7 harness runs against this oracle, A0.7 status is
  `not_implemented` = FAIL, never pass.
- **No marker from these artifacts alone.** An A0.7 marker requires a real harness producing provenance-valid
  classified-pass evidence; the tamper/fabrication guard must land before any marker-write path; and
  `dev-memo/run/evidence/**` stays absent until that authorized WI. Touching a file cannot fabricate a marker.
- **Not production anchor geometry.** The normalized values here are an oracle for an invertibility/stability
  check, not the production anchor implementation (no rotation, captured-geometry versioning, persistence, or
  viewport mapping).
