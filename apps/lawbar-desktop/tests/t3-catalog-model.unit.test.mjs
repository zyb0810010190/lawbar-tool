// T3 证据目录及说明 logical export model tests (WI-FORMS-T3-S1-LOGICAL-EXPORT-ADAPTER-00).
//
// Locks the deterministic T3CatalogModel built over the already-merged S0 payload fields: column mapping
// (evidence_title→证据名称, proof_statement→证明内容, exhibit_page_range→页码), display_order ordering with a
// stable created_at/id fallback + explicit tie behavior, no promotion of notes/filename/party_side into
// display truth, explicit needs-review markers for missing/blank lawyer values, matter-level
// litigation_position at the header, refuse-not-guess submitter selection, byte-identical serialization +
// sha256 (golden), verbatim multi-clause Chinese proof text (NFC only), no 卷X页Y/citation field, and no
// T4/T5 leakage. Pure logical model — no renderer, DOCX/PDF, UI, IPC, or schema/contract/persistence touch.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildT3CatalogModel,
  serializeT3CatalogModel,
  t3CatalogModelSha256,
  T3CatalogRefusal,
  T3_FORM_TYPE,
} from "../dist/src/caseBox/export/t3CatalogModel.js";

const ev = (o) => ({ status: "accepted", ...o });

// The golden matter + evidence set exercises: valid-order rows first (E1/E9/E5), unordered fallback with a
// created_at tie broken by id (Ea before Eb), a superseded row filtered out, a whitespace-only proof +
// null page range → reviewNeeded, and a title-less row → reviewNeeded.
const goldenMatter = {
  id: "01J0MATTER0000000000000001",
  parties: [
    { role: "client", display_name: "张三", party_kind: "individual" },
    { role: "opposing", display_name: "某公司", party_kind: "organization" },
  ],
  litigation_position: "plaintiff",
};
const goldenEvidence = [
  ev({ id: "E5", created_at: "2026-01-05T00:00:00.000Z", evidence_title: "借条", proof_statement: "1、证明借款关系成立；2、证明金额。", exhibit_page_range: "1-3", display_order: 2 }),
  ev({ id: "E1", created_at: "2026-01-01T00:00:00.000Z", evidence_title: "银行流水", proof_statement: "证明款项交付。", exhibit_page_range: "4-7", display_order: 0 }),
  ev({ id: "E9", created_at: "2026-01-02T00:00:00.000Z", evidence_title: "微信记录", proof_statement: "   ", exhibit_page_range: null, display_order: 1 }),
  ev({ id: "Eb", created_at: "2026-01-03T00:00:00.000Z", proof_statement: "无标题证据。" }),
  ev({ id: "Ea", created_at: "2026-01-03T00:00:00.000Z", evidence_title: "同日证据", proof_statement: "同一时间戳，落到 id 排序。", exhibit_page_range: "8" }),
  ev({ id: "Ex", status: "superseded", created_at: "2026-01-01T00:00:00.000Z", evidence_title: "旧版被取代", proof_statement: "应被过滤。", exhibit_page_range: "99" }),
];
const buildGolden = () => buildT3CatalogModel({ matter: goldenMatter, evidenceItems: goldenEvidence });

const GOLDEN_SERIALIZATION =
  '{"formType":"证据目录及说明","litigationPosition":{"value":"plaintiff"},"matterId":"01J0MATTER0000000000000001","rows":[{"evidenceId":"E1","evidenceName":{"text":"银行流水"},"pageRange":{"text":"4-7"},"proofStatement":{"text":"证明款项交付。"},"sequence":1},{"evidenceId":"E9","evidenceName":{"text":"微信记录"},"pageRange":{"reviewNeeded":true},"proofStatement":{"reviewNeeded":true},"sequence":2},{"evidenceId":"E5","evidenceName":{"text":"借条"},"pageRange":{"text":"1-3"},"proofStatement":{"text":"1、证明借款关系成立；2、证明金额。"},"sequence":3},{"evidenceId":"Ea","evidenceName":{"text":"同日证据"},"pageRange":{"text":"8"},"proofStatement":{"text":"同一时间戳，落到 id 排序。"},"sequence":4},{"evidenceId":"Eb","evidenceName":{"reviewNeeded":true},"pageRange":{"reviewNeeded":true},"proofStatement":{"text":"无标题证据。"},"sequence":5}],"submitterName":{"text":"张三"}}';
const GOLDEN_SHA256 = "8cf54b401616df4f714248575f7d435b454dea7615bcf68df65f907ee45fdbb5";

test("golden: serialization + sha256 are byte-identical to the locked values", () => {
  const model = buildGolden();
  assert.equal(serializeT3CatalogModel(model), GOLDEN_SERIALIZATION);
  assert.equal(t3CatalogModelSha256(model), GOLDEN_SHA256);
  // Determinism: two independent builds hash identically.
  assert.equal(t3CatalogModelSha256(buildGolden()), GOLDEN_SHA256);
  assert.equal(model.formType, T3_FORM_TYPE);
});

test("columns: 证据名称←evidence_title, 证明内容←proof_statement, 页码←exhibit_page_range", () => {
  const model = buildT3CatalogModel({
    matter: goldenMatter,
    evidenceItems: [ev({ id: "A", created_at: "2026-01-01T00:00:00.000Z", evidence_title: "合同", proof_statement: "证明合意。", exhibit_page_range: "10-12" })],
  });
  const row = model.rows[0];
  assert.deepEqual(row.evidenceName, { text: "合同" });
  assert.deepEqual(row.proofStatement, { text: "证明合意。" });
  assert.deepEqual(row.pageRange, { text: "10-12" });
  assert.equal(row.sequence, 1);
  assert.equal(row.evidenceId, "A");
});

test("ordering: display_order controls order when present (valid non-negative integer)", () => {
  const model = buildT3CatalogModel({
    matter: goldenMatter,
    evidenceItems: [
      ev({ id: "z", created_at: "2026-01-01T00:00:00.000Z", display_order: 5 }),
      ev({ id: "a", created_at: "2026-01-02T00:00:00.000Z", display_order: 1 }),
      ev({ id: "m", created_at: "2026-01-03T00:00:00.000Z", display_order: 3 }),
    ],
  });
  assert.deepEqual(model.rows.map((r) => r.evidenceId), ["a", "m", "z"]);
  assert.deepEqual(model.rows.map((r) => r.sequence), [1, 2, 3]);
});

test("ordering: fallback created_at ASC then id ASC when display_order absent; explicit tie behavior", () => {
  const model = buildT3CatalogModel({
    matter: goldenMatter,
    evidenceItems: [
      ev({ id: "id_late", created_at: "2026-02-02T00:00:00.000Z" }),
      ev({ id: "id_b", created_at: "2026-01-01T00:00:00.000Z" }),
      ev({ id: "id_a", created_at: "2026-01-01T00:00:00.000Z" }), // same created_at as id_b → id ASC breaks tie
    ],
  });
  assert.deepEqual(model.rows.map((r) => r.evidenceId), ["id_a", "id_b", "id_late"]);
});

test("ordering: equal display_order AND equal created_at falls through to id (review-plan Low L3)", () => {
  const model = buildT3CatalogModel({
    matter: goldenMatter,
    evidenceItems: [
      ev({ id: "yy", created_at: "2026-01-01T00:00:00.000Z", display_order: 7 }),
      ev({ id: "xx", created_at: "2026-01-01T00:00:00.000Z", display_order: 7 }),
    ],
  });
  assert.deepEqual(model.rows.map((r) => r.evidenceId), ["xx", "yy"]);
});

test("ordering: rows with valid display_order sort BEFORE rows without", () => {
  const model = buildT3CatalogModel({
    matter: goldenMatter,
    evidenceItems: [
      ev({ id: "no_order", created_at: "2026-01-01T00:00:00.000Z" }),
      ev({ id: "ordered", created_at: "2026-12-31T00:00:00.000Z", display_order: 0 }),
    ],
  });
  assert.deepEqual(model.rows.map((r) => r.evidenceId), ["ordered", "no_order"]);
});

test("ordering: invalid display_order (negative / non-integer) is treated as absent", () => {
  const model = buildT3CatalogModel({
    matter: goldenMatter,
    evidenceItems: [
      ev({ id: "neg", created_at: "2026-01-01T00:00:00.000Z", display_order: -1 }),
      ev({ id: "frac", created_at: "2026-01-02T00:00:00.000Z", display_order: 1.5 }),
      ev({ id: "good", created_at: "2026-06-01T00:00:00.000Z", display_order: 0 }),
    ],
  });
  // Only "good" has a valid order → first; neg/frac fall back to created_at ASC.
  assert.deepEqual(model.rows.map((r) => r.evidenceId), ["good", "neg", "frac"]);
});

test("no promotion: notes / source_document_id (filename) / party_side never appear in display cells", () => {
  const model = buildT3CatalogModel({
    matter: goldenMatter,
    evidenceItems: [
      ev({
        id: "P",
        created_at: "2026-01-01T00:00:00.000Z",
        notes: "内部备注不应出现",
        source_document_id: "01J0DOC000000000000000001",
        party_side: "our",
        // no evidence_title, no proof_statement, no exhibit_page_range
      }),
    ],
  });
  const row = model.rows[0];
  assert.deepEqual(row.evidenceName, { reviewNeeded: true });
  assert.deepEqual(row.proofStatement, { reviewNeeded: true });
  assert.deepEqual(row.pageRange, { reviewNeeded: true });
  const ser = serializeT3CatalogModel(model);
  assert.ok(!ser.includes("内部备注不应出现"));
  assert.ok(!ser.includes("01J0DOC"));
  assert.ok(!/party_side|notes|source_document_id|filename/.test(ser));
});

test("missing / whitespace-only lawyer values render explicit reviewNeeded, not false data (Low L2)", () => {
  const model = buildT3CatalogModel({
    matter: goldenMatter,
    evidenceItems: [
      ev({ id: "blank", created_at: "2026-01-01T00:00:00.000Z", evidence_title: "   ", proof_statement: "　\n\t", exhibit_page_range: "  " }),
      ev({ id: "absent", created_at: "2026-01-02T00:00:00.000Z" }),
    ],
  });
  for (const row of model.rows) {
    assert.deepEqual(row.evidenceName, { reviewNeeded: true });
    assert.deepEqual(row.proofStatement, { reviewNeeded: true });
    assert.deepEqual(row.pageRange, { reviewNeeded: true });
  }
});

test("litigation_position: carried at header when present; reviewNeeded when absent or out-of-enum", () => {
  const present = buildT3CatalogModel({ matter: { ...goldenMatter, litigation_position: "defendant" }, evidenceItems: [] });
  assert.deepEqual(present.litigationPosition, { value: "defendant" });
  const absent = buildT3CatalogModel({ matter: { id: "m", parties: goldenMatter.parties }, evidenceItems: [] });
  assert.deepEqual(absent.litigationPosition, { reviewNeeded: true });
  const bad = buildT3CatalogModel({ matter: { ...goldenMatter, litigation_position: "third_party" }, evidenceItems: [] });
  assert.deepEqual(bad.litigationPosition, { reviewNeeded: true });
});

test("no 卷X页Y/citation field: 页码 is exhibit_page_range passthrough and cannot be replaced", () => {
  const model = buildT3CatalogModel({
    matter: goldenMatter,
    evidenceItems: [ev({ id: "C", created_at: "2026-01-01T00:00:00.000Z", exhibit_page_range: "5-9" })],
  });
  assert.deepEqual(model.rows[0].pageRange, { text: "5-9" });
  const ser = serializeT3CatalogModel(model);
  assert.ok(!/卷.*页|citation|citationText|citationVolume|citationPageLabel|linkId/.test(ser));
});

test("submitter: single client party auto-selects; name is an explicit text cell", () => {
  const model = buildT3CatalogModel({ matter: goldenMatter, evidenceItems: [] });
  assert.deepEqual(model.submitterName, { text: "张三" });
});

test("submitter: zero client parties refuses (submitter_selection_required)", () => {
  const matter = { id: "m", parties: [{ role: "opposing", display_name: "对方" }] };
  assert.throws(
    () => buildT3CatalogModel({ matter, evidenceItems: [] }),
    (e) => e instanceof T3CatalogRefusal && e.code === "submitter_selection_required",
  );
});

test("submitter: multiple client parties refuses without an explicit selection", () => {
  const matter = { id: "m", parties: [{ role: "client", display_name: "甲" }, { role: "client", display_name: "乙" }] };
  assert.throws(
    () => buildT3CatalogModel({ matter, evidenceItems: [] }),
    (e) => e instanceof T3CatalogRefusal && e.code === "submitter_selection_required",
  );
});

test("submitter: valid index+display_name echo resolves a multi-client matter", () => {
  const matter = { id: "m", parties: [{ role: "client", display_name: "甲" }, { role: "client", display_name: "乙" }] };
  const model = buildT3CatalogModel({ matter, evidenceItems: [], submitterSelection: { partyIndex: 1, displayNameEcho: "乙" } });
  assert.deepEqual(model.submitterName, { text: "乙" });
});

test("submitter: stale display_name echo refuses (submitter_selection_stale)", () => {
  const matter = { id: "m", parties: [{ role: "client", display_name: "甲" }, { role: "client", display_name: "乙" }] };
  assert.throws(
    () => buildT3CatalogModel({ matter, evidenceItems: [], submitterSelection: { partyIndex: 1, displayNameEcho: "丙" } }),
    (e) => e instanceof T3CatalogRefusal && e.code === "submitter_selection_stale",
  );
});

test("submitter: non-client index refuses (submitter_not_client)", () => {
  const matter = { id: "m", parties: [{ role: "client", display_name: "甲" }, { role: "opposing", display_name: "对方" }] };
  assert.throws(
    () => buildT3CatalogModel({ matter, evidenceItems: [], submitterSelection: { partyIndex: 1, displayNameEcho: "对方" } }),
    (e) => e instanceof T3CatalogRefusal && e.code === "submitter_not_client",
  );
});

test("submitter: out-of-range index refuses (submitter_index_out_of_range) (review-plan Low L4)", () => {
  const matter = { id: "m", parties: [{ role: "client", display_name: "甲" }, { role: "client", display_name: "乙" }] };
  for (const partyIndex of [2, -1, 1.5]) {
    assert.throws(
      () => buildT3CatalogModel({ matter, evidenceItems: [], submitterSelection: { partyIndex, displayNameEcho: "甲" } }),
      (e) => e instanceof T3CatalogRefusal && e.code === "submitter_index_out_of_range",
    );
  }
});

test("证明内容: multi-clause Chinese text round-trips verbatim (NFC only, not trimmed)", () => {
  const text = "1、证明借款合意；2、证明款项交付；3、证明利息约定。";
  const model = buildT3CatalogModel({
    matter: goldenMatter,
    evidenceItems: [ev({ id: "V", created_at: "2026-01-01T00:00:00.000Z", proof_statement: `  ${text}  ` })],
  });
  // Leading/trailing whitespace is NOT stripped from a non-blank value — only NFC-normalized.
  assert.deepEqual(model.rows[0].proofStatement, { text: `  ${text}  ` });
});

test("status filter: default accepted-only excludes proposed/rejected/superseded; override honored", () => {
  const items = [
    ev({ id: "acc", created_at: "2026-01-01T00:00:00.000Z" }),
    { id: "prop", status: "proposed", created_at: "2026-01-02T00:00:00.000Z" },
    { id: "rej", status: "rejected", created_at: "2026-01-03T00:00:00.000Z" },
    { id: "sup", status: "superseded", created_at: "2026-01-04T00:00:00.000Z" },
  ];
  const dflt = buildT3CatalogModel({ matter: goldenMatter, evidenceItems: items });
  assert.deepEqual(dflt.rows.map((r) => r.evidenceId), ["acc"]);
  const widened = buildT3CatalogModel({ matter: goldenMatter, evidenceItems: items, includeStatuses: ["accepted", "proposed"] });
  assert.deepEqual(widened.rows.map((r) => r.evidenceId), ["acc", "prop"]);
});

test("no T4/T5 leakage: no 证明对象 / 三性 / 质证 / proof-model field appears in the model", () => {
  const ser = serializeT3CatalogModel(buildGolden());
  assert.ok(!/证明对象|三性|质证|真实性|合法性|关联性|proofObject|crossExam|admissibility|authenticity|relevance/.test(ser));
});
