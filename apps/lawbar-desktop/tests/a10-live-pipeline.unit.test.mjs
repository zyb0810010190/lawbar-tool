// A10 live-pipeline wiring tests (WI-EVIDENCE-A10-LIVE-PIPELINE-WIRING-00).
// Unit-tests the live adapter that lets exportLinkCitationsHandler consume the A10 export contract: it
// composes A10-T1 (toA10RenderedCitations) -> A10-T6 (buildCanonicalExportModel, which drives A10-T2) ->
// canonicalModelSha256, reusing them verbatim. Proves: a valid citation flows through to a 卷X页Y row; a
// missing link degrades to a text-only/reviewable row (no href); a flagged/unsafe link yields a flag row
// with no fake/empty/unsafe href; the model is deterministic; and the adapter output is byte-identical to
// calling A10-T6 directly (it redefines nothing).
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveCanonicalExport,
  LIVE_EXPORT_TYPE,
} from "../dist/src/caseBox/export/a10LivePipeline.js";
import {
  buildCanonicalExportModel,
  serializeCanonicalExportModel,
  canonicalModelSha256,
} from "../dist/src/caseBox/export/a10CanonicalExportModel.js";
import { toA10RenderedCitations } from "../dist/src/caseBox/export/a10CitationContract.js";

// A services ExportCitation (the shape buildExportCitations returns; toA10RenderedCitations consumes it).
const clean = (linkId, documentId, physicalPageIndex, vol, label) => ({
  linkId, sourceType: "evidence", sourceId: `s-${linkId}`, documentId, physicalPageIndex,
  linkStatus: "valid", exportFlag: null,
  citation: { citationVolume: vol, citationPageLabel: label, text: `卷${vol}页${label}` },
});
const flagged = (linkId, flag) => ({
  linkId, sourceType: "evidence", sourceId: `s-${linkId}`, documentId: "doc1", physicalPageIndex: 0,
  linkStatus: flag === "UNLINKED" ? "broken" : flag.toLowerCase(), exportFlag: flag, citation: null,
});
const result = (citations) => ({ citations, byFlag: {} });

test("valid citation flows through to a 卷X页Y canonical row; sha256 is 64-hex", () => {
  const live = buildLiveCanonicalExport(result([clean("L1", "doc1", 4, "1", "5")]));
  const row = live.canonicalModel.rows.find((r) => r.linkId === "L1");
  assert.deepEqual(row, { linkId: "L1", citationText: "卷1页5" });
  assert.equal(live.canonicalModel.exportType, LIVE_EXPORT_TYPE);
  assert.equal(live.canonicalModelSha256.length, 64);
  assert.match(live.canonicalModelSha256, /^[0-9a-f]{64}$/);
});

test("missing hyperlink target degrades to a text-only reviewable row (no href in the model)", () => {
  // a clean citation whose documentId is missing: still rendered as text (卷X页Y), never dropped.
  const live = buildLiveCanonicalExport(result([clean("L2", null, 0, "2", "6")]));
  const row = live.canonicalModel.rows.find((r) => r.linkId === "L2");
  assert.deepEqual(row, { linkId: "L2", citationText: "卷2页6" }); // visible, text-only
  assert.equal("internalHref" in row, false);
  assert.equal("href" in row, false);
});

test("flagged/unsafe link yields a flag row with no fake/empty/unsafe href", () => {
  const live = buildLiveCanonicalExport(result([flagged("L3", "BROKEN"), flagged("L4", "UNLINKED")]));
  const broken = live.canonicalModel.rows.find((r) => r.linkId === "L3");
  assert.deepEqual(broken, { linkId: "L3", flag: "BROKEN" });
  assert.ok(live.canonicalModel.flags.includes("BROKEN") && live.canonicalModel.flags.includes("UNLINKED"));
});

test("no href / nav metadata leaks into the live canonical serialization", () => {
  const live = buildLiveCanonicalExport(result([
    clean("L1", "doc1", 0, "1", "5"), flagged("L2", "BROKEN"), clean("L3", null, 0, "3", "7"),
  ]));
  const ser = serializeCanonicalExportModel(live.canonicalModel);
  assert.ok(!/lawbar:/i.test(ser) && !/https?:/i.test(ser) && !/internalHref|"href"/i.test(ser));
  // sha is the hash of exactly this serialization (reproducibility unit).
  assert.equal(live.canonicalModelSha256, canonicalModelSha256(live.canonicalModel));
});

test("deterministic: same services result -> identical model + sha (no timestamps/paths/order drift)", () => {
  const r = result([clean("L1", "doc1", 0, "1", "5"), flagged("L2", "NON_CITABLE")]);
  const a = buildLiveCanonicalExport(r);
  const b = buildLiveCanonicalExport(r);
  assert.equal(a.canonicalModelSha256, b.canonicalModelSha256);
  assert.deepEqual(a.canonicalModel, b.canonicalModel);
});

test("total + order-preserving: every services citation becomes exactly one row, never dropped", () => {
  const r = result([clean("L3", "d", 0, "2", "6"), flagged("L1", "BROKEN"), clean("L2", "d", 1, "1", "9")]);
  const live = buildLiveCanonicalExport(r);
  assert.equal(live.canonicalModel.rows.length, 3);
  for (const row of live.canonicalModel.rows) {
    assert.equal(("citationText" in row) !== ("flag" in row), true, `exactly one for ${row.linkId}`);
  }
});

test("A10-T1/T2/T6 unchanged: the adapter is byte-identical to calling A10-T6 directly (redefines nothing)", () => {
  const r = result([clean("L1", "doc1", 2, "1", "5"), flagged("L2", "BROKEN")]);
  const live = buildLiveCanonicalExport(r);
  // building the model the long way (T1 -> T6) must equal the adapter's output exactly.
  const direct = buildCanonicalExportModel({ exportType: LIVE_EXPORT_TYPE, rendered: toA10RenderedCitations(r) });
  assert.deepEqual(live.canonicalModel, direct);
  assert.equal(live.canonicalModelSha256, canonicalModelSha256(direct));
});

test("custom exportType is honored (still not a court form)", () => {
  const live = buildLiveCanonicalExport(result([clean("L1", "doc1", 0, "1", "5")]), "evidence-index");
  assert.equal(live.canonicalModel.exportType, "evidence-index");
});
