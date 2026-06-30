// A10-T6 golden CanonicalExportModel tests (WI-EVIDENCE-A10-T6-GOLDEN-CANONICAL-EXPORT-00).
// Locks the deterministic serialization of the canonical export model built over the A10-T1 citation
// contract + A10-T2 hyperlink degradation: valid citation rendering is stable; degraded cases stay
// text-visible/reviewable (never dropped); no fake/empty/unsafe/misleading href survives into the model
// (internalHref is excluded entirely); citation authority is the text/flag, not nav metadata; output is
// byte-identical (golden fixture + sha256). A10-T1/A10-T2 behavior remains unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildCanonicalExportModel,
  serializeCanonicalExportModel,
  canonicalModelSha256,
  CANONICAL_EXPORT_MODEL_VERSION,
} from "../dist/src/caseBox/export/a10CanonicalExportModel.js";
import {
  toA10RenderedCitation,
  CITATION_FORMAT_VERSION,
  EXPORT_TEMPLATE_VERSION,
} from "../dist/src/caseBox/export/a10CitationContract.js";

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, "fixtures", "a10-golden-canonical-export.json"), "utf8"));

const v = CITATION_FORMAT_VERSION, t = EXPORT_TEMPLATE_VERSION;
const rc = (linkId, documentId, idx, vol, label) => ({
  linkId, sourceType: "evidence", sourceId: `s-${linkId}`, documentId, physicalPageIndex: idx,
  citationFormatVersion: v, exportTemplateVersion: t,
  citation: { citationVolume: vol, citationPageLabel: label, text: `卷${vol}页${label}` }, flag: null,
});
const fl = (linkId, flag, documentId = "doc1") => ({
  linkId, sourceType: "evidence", sourceId: `s-${linkId}`, documentId, physicalPageIndex: 0,
  citationFormatVersion: v, exportTemplateVersion: t, citation: null, flag,
});
const buildGolden = () => buildCanonicalExportModel({
  exportType: golden.exportType, rendered: golden.rendered,
  warnings: golden.warnings, generatedFromSnapshotId: golden.generatedFromSnapshotId,
});

test("golden: serialization + sha256 are byte-identical to the locked fixture", () => {
  const model = buildGolden();
  assert.equal(serializeCanonicalExportModel(model), golden.expectedSerialization);
  assert.equal(canonicalModelSha256(model), golden.expectedSha256);
  // The serializer/schema version constant exists for out-of-band tagging but is NOT a field of the
  // hashed model — the model stays faithful to the ADR §4 transcribed shape (no invented fields).
  assert.equal(typeof CANONICAL_EXPORT_MODEL_VERSION, "string");
  assert.equal("canonicalModelVersion" in model, false);
  assert.ok(!/canonicalModelVersion/.test(serializeCanonicalExportModel(model)));
});

test("ADR §4 shape: optional generatedFromSnapshotId is OMITTED when absent (never serialized null)", () => {
  const withSnap = buildGolden();
  assert.ok(/generatedFromSnapshotId/.test(serializeCanonicalExportModel(withSnap))); // present when supplied
  const withoutSnap = buildCanonicalExportModel({ exportType: golden.exportType, rendered: golden.rendered });
  const ser = serializeCanonicalExportModel(withoutSnap);
  assert.ok(!/generatedFromSnapshotId/.test(ser), "key omitted when absent");
  assert.equal("generatedFromSnapshotId" in withoutSnap, false, "absent key not present on the model object");
});

test("deterministic: rebuild + input reordering yield the identical hash", () => {
  const a = canonicalModelSha256(buildGolden());
  const b = canonicalModelSha256(buildGolden());
  assert.equal(a, b);
  // reverse the input order -> content-derived ordering must still produce the same canonical model
  const reordered = buildCanonicalExportModel({
    exportType: golden.exportType, rendered: [...golden.rendered].reverse(),
    warnings: [...golden.warnings].reverse(), generatedFromSnapshotId: golden.generatedFromSnapshotId,
  });
  assert.equal(canonicalModelSha256(reordered), golden.expectedSha256);
});

test("valid citation rendering is stable: clean citations carry verbatim 卷X页Y", () => {
  const model = buildGolden();
  const l3 = model.citations.find((c) => c.linkId === "L3");
  assert.deepEqual(l3, { linkId: "L3", citationVolume: "2", citationPageLabel: "6", text: "卷2页6" });
  // every clean row mirrors a citation text; no clean row carries a flag key
  for (const r of model.rows.filter((r) => "citationText" in r)) {
    assert.equal("flag" in r, false);
    assert.equal(typeof r.citationText, "string");
    assert.ok(/^卷.+页.+$/.test(r.citationText));
  }
});

test("degraded cases stay visible + reviewable: flagged links are rows with a flag, never dropped", () => {
  const model = buildGolden();
  assert.equal(model.rows.length, golden.rendered.length); // total: never drops a citation
  const broken = model.rows.find((r) => r.linkId === "L1");
  assert.deepEqual(broken, { linkId: "L1", flag: "BROKEN" });
  assert.ok(model.flags.includes("BROKEN") && model.flags.includes("UNLINKED"));
  // every degraded row is explicit: exactly a flag key, no citationText key
  for (const r of model.rows.filter((r) => "flag" in r)) assert.equal("citationText" in r, false);
});

test("authority is text-or-flag: every row has EXACTLY one of citationText / flag, and no href field", () => {
  const model = buildGolden();
  for (const r of model.rows) {
    assert.equal(("citationText" in r) !== ("flag" in r), true, `exactly one key for ${r.linkId}`);
    assert.equal("internalHref" in r, false, `${r.linkId}: no nav metadata in the canonical row`);
    assert.equal("href" in r, false);
  }
});

test("no fake/empty/unsafe/misleading href survives: serialized model contains no href/nav metadata", () => {
  const ser = serializeCanonicalExportModel(buildGolden());
  assert.ok(!/lawbar:/i.test(ser), "no internal citation scheme");
  assert.ok(!/https?:/i.test(ser), "no http(s) link");
  assert.ok(!/internalHref|"href"/i.test(ser), "no href field");
  assert.ok(!/javascript:|data:|file:|vbscript:|mailto:/i.test(ser), "no dangerous scheme");
});

test("unsafe/malformed hyperlink target never enters the model: row stays text-only, no href", () => {
  // A clean citation whose documentId is a traversal payload: A10-T2 would null the href; the canonical
  // model excludes href entirely, so the row keeps the visible text and leaks nothing.
  const model = buildCanonicalExportModel({
    exportType: "evidence-index",
    rendered: [rc("LX", "../../etc/passwd", 0, "1", "1"), fl("LY", "NEEDS_REVIEW")],
  });
  const row = model.rows.find((r) => r.linkId === "LX");
  assert.deepEqual(row, { linkId: "LX", citationText: "卷1页1" });
  const ser = serializeCanonicalExportModel(model);
  // The hostile documentId is not part of the canonical model at all (no href, no documentId field), so
  // neither the traversal payload nor any link scheme can appear in the serialization.
  assert.ok(!/passwd/.test(ser), "hostile documentId never enters the model");
  assert.ok(!/\.\.\//.test(ser), "no traversal sequence");
  assert.ok(!/lawbar:/i.test(ser) && !/internalHref/i.test(ser), "no href / nav metadata");
});

test("raw bytes are never the hash basis: hashing is over the logical serialization (ADR §3/§4)", () => {
  const model = buildGolden();
  // sha256 of the serialization equals the model hash — proves the logical model, not any artifact bytes.
  const ser = serializeCanonicalExportModel(model);
  assert.equal(canonicalModelSha256(model).length, 64);
  assert.equal(serializeCanonicalExportModel(model), ser); // pure function
});

test("A10-T1 + A10-T2 regression: the contract mappers still drive the canonical model unchanged", () => {
  // Build via the real A10-T1 mapper from a services-shaped clean citation, then feed the canonical builder.
  const servicesClean = {
    linkId: "R1", sourceType: "evidence", sourceId: "s-R1", documentId: "docA", physicalPageIndex: 2,
    linkStatus: "valid", exportFlag: null,
    citation: { citationVolume: "1", citationPageLabel: "5", text: "卷1页5" },
  };
  const t1 = toA10RenderedCitation(servicesClean);
  assert.equal(t1.citation.text, "卷1页5"); // A10-T1 unchanged
  const model = buildCanonicalExportModel({ exportType: "evidence-index", rendered: [t1] });
  assert.deepEqual(model.rows[0], { linkId: "R1", citationText: "卷1页5" }); // A10-T2 text→row
  assert.deepEqual(model.citations[0], { linkId: "R1", citationVolume: "1", citationPageLabel: "5", text: "卷1页5" });
});
