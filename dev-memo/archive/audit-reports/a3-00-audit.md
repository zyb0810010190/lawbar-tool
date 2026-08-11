# A3-00 design audit report (audit-mqqpnb1m-kklf4h)

AUDIT-SCOPE: docs/adr/ADR-evidence-a3-anchor-link-contract.md + dev-memo/plan-batch-casebox-evidence-a3-anchor-contract-00.md
AUDIT-VERDICT (initial): FAIL C0 H0 M1 L0

## Finding (Medium) — to verify CLOSED
M1: INV-A3-5 said "fixed canonical precision" + round-half-to-even + roundtrip tolerance ≤ 1e-9, but never
    stated the precision VALUE (decimal places / significant digits). Two conforming implementations could
    choose different precisions while both claiming compliance, contradicting the byte-identical persistence
    goal.

## Fix applied (for verify to confirm)
INV-A3-5 now pins: page_ratio computed in IEEE-754 binary64; persisted at EXACTLY 12 fractional decimal
places (resolution 1e-12); round-half-to-even; serialized as a canonical fixed-point decimal string (always
12 fractional digits, leading 0. for <1, no exponent, no trailing-zero trim, -0 normalized to 0). Roundtrip
tolerance clarified as ≤ 1e-9 in page_ratio units; the 12-dp persistence resolution is 3 orders finer than
the tolerance so persistence rounding is never the dominant roundtrip error. The PageRatioRect API comment
updated to "12-dp canonical decimal string (INV-A3-5)".

## Confirmed PASS by initial audit (no change needed)
- INV-A3-7 absent/ambiguous provenance fail-closed present.
- All ten ADR §2 decisions enumerated.
- A3-T6 cascade preserved unresolved + stops-and-asks in both docs.
- Evidence invariants preserved (DocumentPage identity, page-ratio vs captured geometry, geometryCapturedAt,
  box-origin subtraction, rotation-aware, needs_review on mismatch/replacement, no OptimizedDocumentRendition
  basis, A0.7-first for implementation).
- A3-00 consistently design-only / not A0.7-gated; all A3 impl WIs require Requires-A07: yes + valid marker.
- Docs-only; no leaked code/schema/migration/dependency/UI/native/marker.

## Verify result
verify-mqqpqk65-p8jwh0 (Path 1 runner v0.2.18, gpt-5.5/high/read-only): VERIFY-VERDICT: ALL CLOSED; M1: CLOSED.
rawOutput sha256 7f10e5e60ae437d3b6ce668cbce92f3f2399d737c2026990803186f5f2ac7c8d.
Final audit posture: PASS C0 H0 M0 L0 (M1 fixed + verified).
