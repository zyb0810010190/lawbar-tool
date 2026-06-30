# A1-T6 citation-stability fixtures (WI-EVIDENCE-A1-T6-CITATION-STABILITY-GATE-00)

Deterministic, synthetic, **non-confidential** DocumentPage citation-map fixture + an INDEPENDENT oracle
for the A1-T6 citation-stability gate. A1 citation identity derives SOLELY from DocumentPage data
(`{documentId, physicalPageIndex, citationVolume?, citationPageLabel?, citationPageSortKey?, isCitable}`)
— no geometry, no anchors, no links, no A10 CanonicalExportModel.

`citation-map.json` is the DocumentPage citation map under test. `citation-map.oracle.json` records the
expected per-page outcomes, derived from the fixture's known construction + the A1 contract (NOT
back-filled from harness output — A07-GATE-00 §3 oracle-independence applied to A1):

| documentId / page | input | outcome |
|---|---|---|
| d1 / 0 | vol 1, label 5, citable | **clean** `卷1页5` (golden — matches the built TS `卷${citationVolume}页${citationPageLabel}`) |
| d1 / 1 | vol 1, label 6, citable | clean `卷1页6` |
| d2 / 0 | vol 2, label 3, citable | **ambiguous** ((2,3) appears on 2 physical pages in d2) |
| d2 / 1 | vol 2, label 3, citable | ambiguous |
| d3 / 0 | isCitable=false | **non_citable** |
| d3 / 1 | empty citationVolume | non_citable |

The harness (`EvidenceCoreA1CitationGate`) renders citations from DocumentPage only, derives twice and
requires byte-identical serialization (close/reopen stability), orders deterministically by
(documentId, citationPageSortKey ?? physicalPageIndex, physicalPageIndex), and classifies. `inconclusive`,
`not_implemented`, ambiguity-refuse, and a malformed fixture/oracle are NEVER pass. The 卷X页Y format and
the ambiguity/non-citable rules mirror the built TS contract in
`services/case-box-persistence/src/sqlite/exportCitationQueries.ts`; A10-T1 is the future single
production format authority.
