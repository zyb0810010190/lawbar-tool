// T3 证据目录及说明 DOCX builder tests (WI-FORMS-T3-S3-DOCX-EXPORT-00).
//
// Per dev-memo/adr-forms-t3-s3-docx-export.md §5 + A10 invariant 9: the reproducibility
// unit is a NORMALIZED-OOXML assertion, NEVER a raw `.docx`-byte hash (a `.docx` is a
// ZIP whose container carries volatile timestamps). This suite locks BOTH:
//   (a) a STRUCTURAL assertion — header text present; the four ordered columns
//       序号/证据名称/证明内容/页码; one table row per model row; 序号 1..n; the
//       explicit reviewNeeded marker for missing/blank values.
//   (b) a focused NORMALIZED-OOXML assertion — pack to a Buffer, unzip word/document.xml,
//       extract the ordered <w:t> text runs, and assert the table header + row text
//       (Chinese multi-clause text verbatim; NO 卷X页Y; no notes/source/party_side promotion).
//
// The builder reads ONLY a synthetic T3CatalogModel (no persistence / contract / docs).

import test from "node:test";
import assert from "node:assert/strict";
import { extractZipEntryText } from "./_docx-unzip.mjs";
import {
  buildT3CatalogDocx,
  packT3CatalogDocx,
} from "../dist/src/caseBox/export/t3DocxExport.js";

const REVIEW_MARKER = "⟨需复核⟩";

function model(overrides = {}) {
  return {
    formType: "证据目录及说明",
    matterId: "01J0MATTER0000000000000001",
    litigationPosition: { value: "plaintiff" },
    submitterName: { text: "张三" },
    rows: [],
    ...overrides,
  };
}

function row(seq, overrides = {}) {
  return {
    sequence: seq,
    evidenceId: `E${seq}`,
    evidenceName: { text: `名称${seq}` },
    proofStatement: { text: `内容${seq}` },
    pageRange: { text: `${seq}` },
    ...overrides,
  };
}

// Unzip the packed `.docx` and return the main document part as a string. The ZIP entry
// is extracted with a dependency-free Node-built-in reader (tests/_docx-unzip.mjs) — the
// test never imports jszip (a reviewed TRANSITIVE of `docx`, not a declared dependency).
async function documentXml(model) {
  const buffer = await packT3CatalogDocx(model);
  assert.ok(Buffer.isBuffer(buffer), "packT3CatalogDocx must return a Buffer");
  return extractZipEntryText(buffer, "word/document.xml");
}

// Extract the ordered <w:t> text runs (one per cell/paragraph run) — the normalized
// text projection of the OOXML main part.
function extractTextRuns(xml) {
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
}

// ---------- (a) structural assertion ----------

test("structural: builds a Document (header + four-column table, one row per model row)", async () => {
  const m = model({ rows: [row(1), row(2), row(3)] });
  const doc = buildT3CatalogDocx(m);
  assert.ok(doc !== null && typeof doc === "object", "buildT3CatalogDocx returns a Document object");

  const xml = await documentXml(m);
  // exactly one table
  assert.equal((xml.match(/<w:tbl>/g) ?? []).length, 1, "exactly one table");
  // one header row + one row per model row
  const rowCount = (xml.match(/<w:tr[ >]/g) ?? []).length;
  assert.equal(rowCount, 1 + m.rows.length, "header row + one row per model row");
});

test("structural: header carries 提交人诉讼地位 (原告) + 名称/姓名 submitter", async () => {
  const runs = extractTextRuns(await documentXml(model({ rows: [row(1)] })));
  const joined = runs.join("");
  assert.match(joined, /提交人诉讼地位：原告/);
  assert.match(joined, /名称\/姓名：张三/);
  assert.match(joined, /证据目录及说明/, "title present");
});

test("structural: 序号 is 1..n in model order; the four column headers are present", async () => {
  const m = model({ rows: [row(1), row(2), row(3), row(4)] });
  const runs = extractTextRuns(await documentXml(m));
  // the four DR-00 columns, in order
  for (const label of ["序号", "证据名称", "证明内容", "页码"]) {
    assert.ok(runs.includes(label), `column header ${label} present`);
  }
  // 序号 cells 1..n appear in order
  const headerIdx = runs.indexOf("页码");
  const body = runs.slice(headerIdx + 1);
  const seqCells = m.rows.map((r) => String(r.sequence));
  // each sequence label appears, and the first body cell of each row is its 序号
  for (const s of seqCells) assert.ok(body.includes(s), `序号 ${s} present`);
  assert.deepEqual(seqCells, ["1", "2", "3", "4"]);
});

test("structural: reviewNeeded cells render the explicit marker (never blank-as-data)", async () => {
  const m = model({
    rows: [
      row(1, {
        evidenceName: { reviewNeeded: true },
        proofStatement: { reviewNeeded: true },
        pageRange: { reviewNeeded: true },
      }),
    ],
  });
  const runs = extractTextRuns(await documentXml(m));
  const markerCount = runs.filter((r) => r === REVIEW_MARKER).length;
  assert.equal(markerCount, 3, "three reviewNeeded cells → three explicit markers");
  // never a blank/empty data cell in place of a value
  assert.ok(!runs.includes(""), "no empty text run stands in for a value");
});

test("structural: reviewNeeded litigationPosition renders the marker in the header", async () => {
  const runs = extractTextRuns(await documentXml(model({ litigationPosition: { reviewNeeded: true }, rows: [] })));
  const joined = runs.join("");
  assert.match(joined, new RegExp(`提交人诉讼地位：${REVIEW_MARKER}`));
});

test("structural: defendant position renders 被告", async () => {
  const runs = extractTextRuns(await documentXml(model({ litigationPosition: { value: "defendant" }, rows: [] })));
  assert.match(runs.join(""), /提交人诉讼地位：被告/);
});

// ---------- (b) normalized-OOXML assertion ----------

test("ooxml: table header + row text extract verbatim; Chinese multi-clause text preserved (NFC)", async () => {
  const multi = "1、证明借款关系成立；2、证明金额。";
  const m = model({
    litigationPosition: { value: "plaintiff" },
    rows: [
      { sequence: 1, evidenceId: "E1", evidenceName: { text: "借条" }, proofStatement: { text: multi }, pageRange: { text: "1-3" } },
      { sequence: 2, evidenceId: "E2", evidenceName: { text: "银行流水" }, proofStatement: { text: "证明款项交付。" }, pageRange: { text: "4-7" } },
    ],
  });
  const runs = extractTextRuns(await documentXml(m));
  // header labels appear before any body cell (thead precedes tbody)
  const headerSlice = runs.slice(runs.indexOf("序号"), runs.indexOf("序号") + 4);
  assert.deepEqual(headerSlice, ["序号", "证据名称", "证明内容", "页码"]);
  // multi-clause proof text round-trips VERBATIM (no mojibake, no clause splitting)
  assert.ok(runs.includes(multi), "multi-clause proof text verbatim");
  assert.ok(runs.includes("借条") && runs.includes("银行流水"), "evidence names verbatim");
  assert.ok(runs.includes("1-3") && runs.includes("4-7"), "page ranges verbatim");
});

test("ooxml: NO 卷X页Y / citation column — 页码 is the exhibit_page_range passthrough only", async () => {
  const m = model({ rows: [row(1, { pageRange: { text: "5-9" } })] });
  const xml = await documentXml(m);
  assert.ok(!/卷.*页|citation|citationVolume|citationPageLabel/.test(xml), "no citation column/text");
  assert.ok(extractTextRuns(xml).includes("5-9"), "页码 equals exhibit_page_range");
});

test("ooxml: no notes/source_document_id/party_side promotion — absent S1 fields render markers", async () => {
  // The model already omits these — the builder must render reviewNeeded, never invent text.
  const m = model({
    rows: [
      {
        sequence: 1,
        evidenceId: "E1",
        evidenceName: { reviewNeeded: true },
        proofStatement: { reviewNeeded: true },
        pageRange: { reviewNeeded: true },
      },
    ],
  });
  const xml = await documentXml(m);
  assert.ok(!/notes|source_document_id|party_side|filename/.test(xml), "no promoted metadata");
  assert.equal(extractTextRuns(xml).filter((r) => r === REVIEW_MARKER).length, 3);
});

test("ooxml: empty model renders the header + an empty table (header row only, no invented rows)", async () => {
  const xml = await documentXml(model({ rows: [] }));
  assert.equal((xml.match(/<w:tbl>/g) ?? []).length, 1, "table present");
  assert.equal((xml.match(/<w:tr[ >]/g) ?? []).length, 1, "only the header row — no invented data rows");
  const runs = extractTextRuns(xml);
  assert.deepEqual(runs.slice(runs.indexOf("序号"), runs.indexOf("序号") + 4), ["序号", "证据名称", "证明内容", "页码"]);
});

test("ooxml: no T4/T5 surface (证明对象 / 三性 / 质证) leaks into the document", async () => {
  const m = model({ rows: [row(1), row(2)] });
  const xml = await documentXml(m);
  assert.ok(
    !/证明对象|三性|质证|真实性|合法性|关联性|proofObject|crossExam|admissibility/.test(xml),
    "no T4/T5 columns or labels",
  );
});
