// A10-T1 citation-render contract tests (WI-EVIDENCE-A10-T1-CITATION-RENDER-CONTRACT-00).
// Unit-tests the apps-layer contract over the services ExportCitation output: it pins versions, owns the
// canonical flag vocabulary, reuses the DocumentPage-derived 卷X页Y text verbatim (single source; drift
// throws), is deterministic + total+bijective, retains UNLINKED, and never emits the spec-pending REPLACED.
import test from "node:test";
import assert from "node:assert/strict";
import {
  toA10RenderedCitation,
  toA10RenderedCitations,
  A10_EXPORT_CITATION_FLAGS,
  EMITTABLE_A10_FLAGS,
  CITATION_FORMAT_VERSION,
  EXPORT_TEMPLATE_VERSION,
  A10CitationContractError,
} from "../dist/src/caseBox/export/a10CitationContract.js";

const clean = (linkId, vol, label) => ({
  linkId, sourceType: "evidence", sourceId: `s-${linkId}`, documentId: "doc1", physicalPageIndex: 0,
  linkStatus: "valid", exportFlag: null,
  citation: { citationVolume: vol, citationPageLabel: label, text: `卷${vol}页${label}` },
});
const flagged = (linkId, flag) => ({
  linkId, sourceType: "evidence", sourceId: `s-${linkId}`, documentId: "doc1", physicalPageIndex: 0,
  linkStatus: flag === "UNLINKED" ? "broken" : flag.toLowerCase(), exportFlag: flag, citation: null,
});

test("clean citation: reuses services text verbatim, flag null, versions pinned", () => {
  const r = toA10RenderedCitation(clean("L1", "1", "5"));
  assert.equal(r.flag, null);
  assert.deepEqual(r.citation, { citationVolume: "1", citationPageLabel: "5", text: "卷1页5" });
  assert.equal(r.citationFormatVersion, CITATION_FORMAT_VERSION);
  assert.equal(r.exportTemplateVersion, EXPORT_TEMPLATE_VERSION);
  assert.equal(r.linkId, "L1");
});

test("each emittable flag maps to the canonical flag with no citation", () => {
  for (const flag of ["NEEDS_REVIEW", "BROKEN", "NON_CITABLE", "AMBIGUOUS", "UNLINKED"]) {
    const r = toA10RenderedCitation(flagged(`L-${flag}`, flag));
    assert.equal(r.flag, flag);
    assert.equal(r.citation, null);
  }
});

test("UNLINKED is retained + emittable (V12 durable marker, distinct from BROKEN)", () => {
  assert.equal(A10_EXPORT_CITATION_FLAGS.UNLINKED.emittable, true);
  assert.ok(EMITTABLE_A10_FLAGS.includes("UNLINKED"));
  assert.notEqual("UNLINKED", "BROKEN");
});

test("REPLACED is in the canonical vocabulary but spec-pending and NEVER emitted", () => {
  assert.ok("REPLACED" in A10_EXPORT_CITATION_FLAGS, "REPLACED present for vocabulary completeness");
  assert.equal(A10_EXPORT_CITATION_FLAGS.REPLACED.emittable, false);
  assert.ok(!EMITTABLE_A10_FLAGS.includes("REPLACED"), "REPLACED excluded from emittable set");
  // A (hypothetical) services flag of REPLACED must be refused, not emitted.
  assert.throws(() => toA10RenderedCitation(flagged("Lx", "REPLACED")), A10CitationContractError);
});

test("drift guard: clean text != 卷{vol}页{label} throws loudly (never repaired)", () => {
  const drifted = clean("Ld", "2", "3");
  drifted.citation = { citationVolume: "2", citationPageLabel: "3", text: "卷2页9" }; // wrong text
  assert.throws(() => toA10RenderedCitation(drifted), A10CitationContractError);
});

test("inconsistent inputs throw, never a silent default", () => {
  // clean (exportFlag null) but no citation payload
  assert.throws(() => toA10RenderedCitation({ ...clean("Lc", "1", "1"), citation: null }), A10CitationContractError);
  // unknown flag
  assert.throws(() => toA10RenderedCitation(flagged("Lu", "WAT")), A10CitationContractError);
  // both set: a flagged citation that also carries a citation payload (inconsistent) must throw
  assert.throws(
    () => toA10RenderedCitation({ ...flagged("Lb", "BROKEN"), citation: { citationVolume: "1", citationPageLabel: "5", text: "卷1页5" } }),
    A10CitationContractError,
  );
});

test("total + bijective: every output has exactly one of citation / flag", () => {
  const out = toA10RenderedCitations({
    citations: [clean("L1", "1", "5"), flagged("L2", "BROKEN"), flagged("L3", "UNLINKED"), clean("L4", "2", "6")],
    byFlag: {},
  });
  assert.equal(out.length, 4);
  for (const r of out) {
    assert.equal((r.citation === null) !== (r.flag === null), true, `exactly one of citation/flag for ${r.linkId}`);
  }
});

test("deterministic: same input maps byte-identically (no timestamps/paths/locale)", () => {
  const input = clean("L1", "1", "5");
  assert.deepEqual(toA10RenderedCitation(input), toA10RenderedCitation(input));
  const s = JSON.stringify(toA10RenderedCitations({ citations: [clean("L1","1","5"), flagged("L2","NON_CITABLE")], byFlag: {} }));
  assert.ok(!s.includes("/Users"), "no machine paths in output");
});
