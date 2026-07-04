// t3DocxExport.ts — T3 证据目录及说明 DOCX builder (WI-FORMS-T3-S3-DOCX-EXPORT-00).
//
// Per dev-memo/adr-forms-t3-s3-docx-export.md (BINDING) §2.2 + §5: a deterministic
// projection of the ALREADY-MERGED S1 `T3CatalogModel` into a Word document via the
// maintained `docx` library. This module reads ONLY the T3CatalogModel — it does NOT
// read persistence / contract / documents, does NOT re-implement buildT3CatalogModel,
// does NOT attach a 卷X页Y / citation column, and does NOT couple to any a10* module.
//
// Rendered surface (ADR §2.2): a heading (证据目录及说明 title), a header block
// (提交人诉讼地位 + 名称/姓名), then ONE table with DR-00's four columns
// 序号 / 证据名称 / 证明内容 / 页码, one row per S1 model row IN S1 ORDER (never
// re-sorted), 序号 = row.sequence (1..n). A `reviewNeeded` cell renders an explicit
// needs-review marker — never blank-as-data, never a fabricated/substituted value
// (.claude/rules/evidence-genie.md invariant 2). Model text is already NFC (produced
// by the S1 model); it is emitted verbatim, so multi-clause Chinese proof text
// round-trips unchanged.
//
// Reproducibility (ADR §5 / A10 invariant 9): raw `.docx` bytes are NEVER the golden.
// The unit test asserts BOTH a structural mapping AND a normalized-OOXML extraction of
// the main document part; this module only builds + packs.

import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  HeadingLevel,
  WidthType,
} from "docx";

import type { T3CatalogModel, T3Cell, T3PositionCell } from "./t3CatalogModel.js";

// The explicit lawyer-review marker for a missing/blank value. Mirrors the S2
// renderer marker (renderer/i18n/catalog.ts "viewT3.reviewNeeded") so the DOCX and
// the in-app preview show the same non-fabricated needs-review token.
const REVIEW_NEEDED_MARKER = "⟨需复核⟩";

const TITLE = "证据目录及说明";
const HEADER_POSITION_LABEL = "提交人诉讼地位：";
const HEADER_SUBMITTER_LABEL = "名称/姓名：";
// DR-00's four columns, in fixed order (page column is exhibit_page_range — NO 卷X页Y).
const COLUMN_HEADERS = ["序号", "证据名称", "证明内容", "页码"] as const;
const POSITION_LABELS: Record<"plaintiff" | "defendant", string> = {
  plaintiff: "原告",
  defendant: "被告",
};

// A resolved text value renders verbatim; a needs-review marker renders the explicit
// token (never blank, never substituted).
function cellText(cell: T3Cell): string {
  return "text" in cell ? cell.text : REVIEW_NEEDED_MARKER;
}

// 提交人诉讼地位 → the localized position when present, else the needs-review marker.
function positionText(cell: T3PositionCell): string {
  return "value" in cell ? POSITION_LABELS[cell.value] : REVIEW_NEEDED_MARKER;
}

function textTableCell(text: string): TableCell {
  return new TableCell({ children: [new Paragraph({ children: [new TextRun(text)] })] });
}

function headerTableRow(): TableRow {
  return new TableRow({ children: COLUMN_HEADERS.map((h) => textTableCell(h)) });
}

/**
 * Build the T3 证据目录及说明 `docx` Document from the S1 model. The table always
 * carries the four-column header row; an empty model yields the header + the header
 * row ONLY (no invented data rows). Rows are emitted in `model.rows` order.
 */
export function buildT3CatalogDocx(model: T3CatalogModel): Document {
  const titleParagraph = new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun(TITLE)],
  });
  const positionParagraph = new Paragraph({
    children: [new TextRun(`${HEADER_POSITION_LABEL}${positionText(model.litigationPosition)}`)],
  });
  const submitterParagraph = new Paragraph({
    children: [new TextRun(`${HEADER_SUBMITTER_LABEL}${cellText(model.submitterName)}`)],
  });

  const dataRows = model.rows.map((row) =>
    new TableRow({
      children: [
        textTableCell(String(row.sequence)),
        textTableCell(cellText(row.evidenceName)),
        textTableCell(cellText(row.proofStatement)),
        textTableCell(cellText(row.pageRange)),
      ],
    }),
  );

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerTableRow(), ...dataRows],
  });

  return new Document({
    sections: [{ children: [titleParagraph, positionParagraph, submitterParagraph, table] }],
  });
}

/** Pack the built Document to a `.docx` Buffer (deterministic logical structure; the
 * container's volatile metadata is why the golden is normalized-OOXML, not a byte hash). */
export async function packT3CatalogDocx(model: T3CatalogModel): Promise<Buffer> {
  return Packer.toBuffer(buildT3CatalogDocx(model));
}
