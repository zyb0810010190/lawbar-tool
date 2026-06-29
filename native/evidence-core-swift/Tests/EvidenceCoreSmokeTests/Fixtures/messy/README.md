# A0.7 messy renderer-conformance fixtures (WI-EVIDENCE-A0.7-FIXTURE-COVERAGE-00)

Deterministic, synthetic, **non-confidential** PDF fixtures + independent oracles that exercise the
messy real-world A0.7 cases the handover §13 demands beyond the trivial `../synthetic-twopage.pdf`:
rotated pages, cropBox/mediaBox mismatch, non-zero mediaBox origin, and mixed page sizes.

These are fixtures/oracle DATA only — **NOT production anchor geometry**, NOT a marker, NOT an A0.7
run. Expected oracle values are derived ONLY from each fixture's known construction (below) and are
INDEPENDENT of the harness output (`ADR-evidence-a07-renderer-conformance-gate.md` §3 — never
back-fill harness output into an oracle). Fixtures are hand-authored minimal PDF byte streams (PDF
1.4, no timestamps, no fonts/images) with explicit, correct `xref` offsets — byte-stable and
deterministic, mirroring the original 432-byte `synthetic-twopage.pdf`.

| Fixture | Construction | PDFKit-observed | sha256 |
|---|---|---|---|
| `synthetic-rotated.pdf` | 1 page, `/MediaBox [0 0 612 792]`, `/Rotate 90` | mediaBox o(0,0) 612x792, rotation 90, cropBox=mediaBox | `d05e3425a3ef6e628b64829ec791bc3a29a16b856539ece5351f18de620a2b04` |
| `synthetic-cropbox.pdf` | 1 page, `/MediaBox [0 0 612 792]`, `/CropBox [50 50 562 742]` | mediaBox o(0,0) 612x792, cropBox o(50,50) 512x692 | `d72df48131c1307a4cf007c010e8fe98502873c7ce0955d386fae5550b3a0870` |
| `synthetic-nonzero-origin.pdf` | 1 page, `/MediaBox [50 50 662 842]` | mediaBox o(50,50) 612x792; samples normalized as (x-50)/612,(y-50)/792 | `159a490459993edefc224a68f2dd7e7a7e627135616272c239bc27843c3e1b57` |
| `synthetic-mixed-sizes.pdf` | 2 pages: `[0 0 612 792]` (Letter) + `[0 0 595 842]` (A4) | page0 612x792, page1 595x842 | `550f1d44aa2d8ebbbe00cf2fcb91bee03e8e6d1027df00c78ba6869e99e59b42` |

Each `synthetic-*.oracle.json` records the expected values above. The harness (`EvidenceCoreA07Harness`)
observes per-page mediaBox extent+origin, cropBox, and rotation, and normalizes sample points with
origin subtraction; a renderer-structure disagreement (extent/origin/cropBox/rotation/page-count) is
Class-2 (geometry-source instability, STOP), a correct box with a wrong derived value (e.g. origin not
subtracted) is Class-1. `inconclusive` and `not_implemented` are never pass.
