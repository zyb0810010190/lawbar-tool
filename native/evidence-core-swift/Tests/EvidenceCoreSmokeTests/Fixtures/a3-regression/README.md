# A3-T10 anchor-regression fixtures (WI-EVIDENCE-A3-T10-ANCHOR-REGRESSION-GATE-00)

Deterministic, synthetic, **non-confidential** anchor/link resolution fixture + an INDEPENDENT oracle
for the A3-T10 anchor-resolution regression gate. This covers the **data-resolution slice** of A3-T10
(deterministic replay / reopen-identical resolution) — NOT PDF geometry capture (A0.7) and NOT the A8
restore pipeline. A3 link resolution is DATA-driven; no PDFs, no A8/A10, no `CanonicalExportModel`.

`anchor-regression.json` holds synthetic documents / pages / geometries / anchors / links.
`anchor-regression.oracle.json` records the expected per-link `{status, unlinked}`, derived from the
fixture's known construction + the built resolver ladder in
`services/case-box-persistence/src/sqlite/linkStatusResolverQueries.ts` (NOT back-filled from harness
output — A07-GATE-00 §3 oracle-independence applied to A3):

| link | scenario | status | unlinked |
|---|---|---|---|
| L1-valid | present anchor+page+geometry, version matches, not superseded | valid | false |
| L2-stale-version | anchor `geometryCapturedAt=t0` ≠ current `t1` | needs_review | false |
| L3-superseded | anchor's document (`docOld`) superseded by `docNew` | needs_review | false |
| L4-missing-page | anchor on `docA/7` with no DocumentPage | broken | false |
| L5-missing-geometry | anchor on `docC/0` (page present, no geometry) | broken | false |
| L6-unknown-anchor | link references a non-existent anchor | broken | false |
| L7-unlinked | V12 `unlinked_at` set on the otherwise-valid `aValid` | broken | **true** |
| L8-relinked | same `aValid`, `unlinkedAt` cleared (relinked) | valid | false |

Resolver ladder (replicated, drift-guarded by rung-by-rung tests): `unlinked_at` → broken; missing
anchor → broken; missing page → broken; missing geometry → broken; geometry-version mismatch →
needs_review; document superseded (reverse `supersedesDocumentId` lookup) → needs_review; else valid.
`broken` for both explicit-unlink and structural breakage; the separate `unlinked` flag carries the
distinction (mirrors export's UNLINKED). `inconclusive`, `not_implemented`, malformed fixture/oracle, and
mismatch are NEVER pass.
