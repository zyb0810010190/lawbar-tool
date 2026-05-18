// Mapper tests — pure projection from @gutenye/ocr-node Line[] -> OcrResult.
// All cases validate against the contract schema via validateOcrResult to
// catch any drift between the mapper output shape and the schema.

import { test } from "node:test";
import assert from "node:assert/strict";

import { mapEngineLinesToOcrResult } from "../dist/engines/mapper.js";
import { validateOcrResult } from "ocr-worker-contract";

const baseJob = {
  contract_version: "1.0.0",
  job_id: "01jrk8m4q4xv2v8d4d4ymf5xnk",
  tenant_id: "01jrk8m4q4xv2v8d4d4ymf5tnt",
  document_id: "01jrk8m4q4xv2v8d4d4ymf5doc",
  page_id: "01jrk8m4q4xv2v8d4d4ymf5p01",
  page_number: 1,
};

const baseEngine = {
  name: "paddleocr-onnx",
  version: "1.4.8+rapidocr-ch_PP-OCRv4",
};

const baseTiming = {
  processing_duration_ms: 250,
  completed_at: "2026-05-18T10:00:00.000Z",
};

const baseGeometry = {};

function makeInput(overrides = {}) {
  return {
    lines: [],
    job: baseJob,
    engine: baseEngine,
    timing: baseTiming,
    geometry: baseGeometry,
    ...overrides,
  };
}

function assertValidResult(result) {
  const verdict = validateOcrResult(result);
  if (!verdict.ok) {
    assert.fail("OcrResult schema validation failed:\n" + verdict.summary);
  }
}

test("empty lines -> succeeded with empty blocks and empty raw_text", () => {
  const result = mapEngineLinesToOcrResult(makeInput({ lines: [] }));
  assertValidResult(result);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.blocks, []);
  assert.equal(result.raw_text, "");
  assert.equal(result.partial_failure, null);
});

test("single line with bbox -> block_id=b_0001, type=line, integer bbox", () => {
  const result = mapEngineLinesToOcrResult(
    makeInput({
      lines: [
        {
          text: "上海市浦东新区人民法院",
          mean: 0.95,
          box: [
            [100.4, 50.6],
            [500.9, 50.6],
            [500.9, 130.1],
            [100.4, 130.1],
          ],
        },
      ],
    }),
  );
  assertValidResult(result);
  assert.equal(result.blocks.length, 1);
  const b = result.blocks[0];
  assert.equal(b.block_id, "b_0001");
  assert.equal(b.type, "line");
  assert.equal(b.text, "上海市浦东新区人民法院");
  assert.equal(b.confidence, 0.95);
  assert.deepEqual(b.bbox, { x: 100, y: 50, w: 401, h: 81 });
  assert.equal(b.bbox.x, Math.trunc(b.bbox.x));
  assert.equal(b.bbox.y, Math.trunc(b.bbox.y));
  assert.equal(b.bbox.w, Math.trunc(b.bbox.w));
  assert.equal(b.bbox.h, Math.trunc(b.bbox.h));
  assert.deepEqual(b.polygon, [
    [100, 50],
    [500, 50],
    [500, 130],
    [100, 130],
  ]);
  assert.equal(result.raw_text, "上海市浦东新区人民法院");
});

test("line without box -> block emitted without bbox or polygon", () => {
  const result = mapEngineLinesToOcrResult(
    makeInput({
      lines: [{ text: "no position", mean: 0.42 }],
    }),
  );
  assertValidResult(result);
  assert.equal(result.blocks.length, 1);
  const b = result.blocks[0];
  assert.equal(b.block_id, "b_0001");
  assert.equal(b.type, "line");
  assert.equal(b.text, "no position");
  assert.equal(b.confidence, 0.42);
  assert.equal("bbox" in b, false);
  assert.equal("polygon" in b, false);
});

test("multiple lines -> ordered block_ids, raw_text newline-joined, mixed bbox presence", () => {
  const result = mapEngineLinesToOcrResult(
    makeInput({
      lines: [
        { text: "line A", mean: 0.99, box: [[0, 0], [10, 0], [10, 10], [0, 10]] },
        { text: "line B", mean: 0.5 },
        { text: "line C", mean: 0.7, box: [[20, 20], [50, 20], [50, 40], [20, 40]] },
      ],
    }),
  );
  assertValidResult(result);
  assert.equal(result.blocks.length, 3);
  assert.equal(result.blocks[0].block_id, "b_0001");
  assert.equal(result.blocks[1].block_id, "b_0002");
  assert.equal(result.blocks[2].block_id, "b_0003");
  assert.equal("bbox" in result.blocks[0], true);
  assert.equal("bbox" in result.blocks[1], false);
  assert.equal("bbox" in result.blocks[2], true);
  assert.equal(result.raw_text, "line A\nline B\nline C");
});

test("zero-width / zero-height polygon clamps bbox w/h to >=1", () => {
  const result = mapEngineLinesToOcrResult(
    makeInput({
      lines: [
        {
          text: "thin",
          mean: 0.8,
          box: [
            [100, 100],
            [100, 100],
            [100, 100],
            [100, 100],
          ],
        },
      ],
    }),
  );
  assertValidResult(result);
  assert.deepEqual(result.blocks[0].bbox, { x: 100, y: 100, w: 1, h: 1 });
});

test("negative polygon coords clamp to 0; bbox stays non-negative", () => {
  const result = mapEngineLinesToOcrResult(
    makeInput({
      lines: [
        {
          text: "edge",
          mean: 0.6,
          box: [
            [-5, -3],
            [20, -3],
            [20, 15],
            [-5, 15],
          ],
        },
      ],
    }),
  );
  assertValidResult(result);
  const bbox = result.blocks[0].bbox;
  assert.equal(bbox.x, 0);
  assert.equal(bbox.y, 0);
  // ceil(max) - clamped(min). maxX=20 -> ceil=20; x=0; w=20-0=20.
  assert.equal(bbox.w, 20);
  assert.equal(bbox.h, 15);
});

test("malformed box (fewer than 4 corners) -> bbox/polygon omitted, block still emitted", () => {
  const result = mapEngineLinesToOcrResult(
    makeInput({
      lines: [{ text: "broken", mean: 0.3, box: [[0, 0], [10, 10]] }],
    }),
  );
  assertValidResult(result);
  assert.equal(result.blocks.length, 1);
  assert.equal("bbox" in result.blocks[0], false);
  assert.equal("polygon" in result.blocks[0], false);
});

test("optional job + timing + geometry fields propagate when set", () => {
  const result = mapEngineLinesToOcrResult({
    lines: [{ text: "x", mean: 1.0 }],
    job: { ...baseJob, document_revision: 7 },
    engine: baseEngine,
    timing: {
      processing_duration_ms: 250,
      queued_duration_ms: 870,
      completed_at: "2026-05-18T10:00:00.000Z",
    },
    geometry: { page_width_px: 2480, page_height_px: 3508 },
  });
  assertValidResult(result);
  assert.equal(result.document_revision, 7);
  assert.equal(result.page_metrics.queued_duration_ms, 870);
  assert.equal(result.page_metrics.page_width_px, 2480);
  assert.equal(result.page_metrics.page_height_px, 3508);
});

test("omitted optional fields stay omitted (not undefined / not null)", () => {
  const result = mapEngineLinesToOcrResult(makeInput({ lines: [{ text: "x", mean: 0.5 }] }));
  assertValidResult(result);
  assert.equal("document_revision" in result, false);
  assert.equal("queued_duration_ms" in result.page_metrics, false);
  assert.equal("page_width_px" in result.page_metrics, false);
  assert.equal("page_height_px" in result.page_metrics, false);
});

test("determinism: same input -> deepEqual output across two calls", () => {
  const input = makeInput({
    lines: [
      { text: "A", mean: 0.9, box: [[0, 0], [5, 0], [5, 5], [0, 5]] },
      { text: "B", mean: 0.8 },
    ],
  });
  const a = mapEngineLinesToOcrResult(input);
  const b = mapEngineLinesToOcrResult(input);
  assert.deepEqual(a, b);
});

test("engine metadata pinned: name=paddleocr-onnx, version carries +model-set", () => {
  const result = mapEngineLinesToOcrResult(makeInput({ lines: [] }));
  assertValidResult(result);
  assert.equal(result.engine.name, "paddleocr-onnx");
  assert.match(result.engine.version, /^\d+\.\d+\.\d+\+/);
});

test("partial_failure is explicitly null on succeeded (mapper invariant; stronger than schema's when-present-only constraint)", () => {
  const result = mapEngineLinesToOcrResult(makeInput({ lines: [] }));
  assertValidResult(result);
  assert.equal(result.partial_failure, null);
  assert.equal(result.status, "succeeded");
});

test("metadata defaults to empty object", () => {
  const result = mapEngineLinesToOcrResult(makeInput({ lines: [] }));
  assertValidResult(result);
  assert.deepEqual(result.metadata, {});
});

test("block_id zero-pad to width 4 (b_0001 .. b_0010+)", () => {
  const lines = Array.from({ length: 12 }, (_, i) => ({
    text: "L" + i,
    mean: 0.5,
  }));
  const result = mapEngineLinesToOcrResult(makeInput({ lines }));
  assertValidResult(result);
  assert.equal(result.blocks[0].block_id, "b_0001");
  assert.equal(result.blocks[8].block_id, "b_0009");
  assert.equal(result.blocks[9].block_id, "b_0010");
  assert.equal(result.blocks[11].block_id, "b_0012");
});

// --- Adversarial inputs (audit 019e39cc, ADR-11C.1 fix-up) -----------------
// TypeScript `number` admits NaN, Infinity, and out-of-range values. The
// engine boundary is treated as hostile: anything non-finite or
// out-of-range for confidence collapses to null; any non-finite polygon
// coord aborts geometry derivation for that line.

test("non-finite polygon coord (NaN) in any corner -> bbox + polygon both omitted", () => {
  const result = mapEngineLinesToOcrResult(
    makeInput({
      lines: [
        {
          text: "bad-corner",
          mean: 0.9,
          box: [
            [0, 0],
            [10, 0],
            [Number.NaN, 10],
            [0, 10],
          ],
        },
      ],
    }),
  );
  assertValidResult(result);
  assert.equal(result.blocks.length, 1);
  assert.equal("bbox" in result.blocks[0], false);
  assert.equal("polygon" in result.blocks[0], false);
  assert.equal(result.blocks[0].text, "bad-corner");
});

test("non-finite polygon coord (Infinity) -> bbox + polygon both omitted", () => {
  const result = mapEngineLinesToOcrResult(
    makeInput({
      lines: [
        {
          text: "inf-corner",
          mean: 0.5,
          box: [
            [0, 0],
            [10, 0],
            [10, 10],
            [Number.POSITIVE_INFINITY, 10],
          ],
        },
      ],
    }),
  );
  assertValidResult(result);
  assert.equal("bbox" in result.blocks[0], false);
  assert.equal("polygon" in result.blocks[0], false);
});

test("mean=NaN -> confidence: null", () => {
  const result = mapEngineLinesToOcrResult(
    makeInput({ lines: [{ text: "x", mean: Number.NaN }] }),
  );
  assertValidResult(result);
  assert.equal(result.blocks[0].confidence, null);
});

test("mean=Infinity -> confidence: null", () => {
  const result = mapEngineLinesToOcrResult(
    makeInput({ lines: [{ text: "x", mean: Number.POSITIVE_INFINITY }] }),
  );
  assertValidResult(result);
  assert.equal(result.blocks[0].confidence, null);
});

test("mean out of range (-0.1) -> confidence: null", () => {
  const result = mapEngineLinesToOcrResult(
    makeInput({ lines: [{ text: "x", mean: -0.1 }] }),
  );
  assertValidResult(result);
  assert.equal(result.blocks[0].confidence, null);
});

test("mean out of range (1.1) -> confidence: null", () => {
  const result = mapEngineLinesToOcrResult(
    makeInput({ lines: [{ text: "x", mean: 1.1 }] }),
  );
  assertValidResult(result);
  assert.equal(result.blocks[0].confidence, null);
});

test("mean omitted (engine drops the field) -> confidence: null, not undefined", () => {
  const result = mapEngineLinesToOcrResult(
    makeInput({ lines: [{ text: "x" }] }),
  );
  assertValidResult(result);
  assert.equal(result.blocks[0].confidence, null);
  // Property must exist and be explicit null — not absent. JSON.stringify
  // drops undefined keys; null survives.
  const reparsed = JSON.parse(JSON.stringify(result));
  assert.equal("confidence" in reparsed.blocks[0], true);
  assert.equal(reparsed.blocks[0].confidence, null);
});

test("mean explicitly null -> confidence: null", () => {
  const result = mapEngineLinesToOcrResult(
    makeInput({ lines: [{ text: "x", mean: null }] }),
  );
  assertValidResult(result);
  assert.equal(result.blocks[0].confidence, null);
});

test("mean at the legal boundaries (0 and 1) passes through unchanged", () => {
  const result = mapEngineLinesToOcrResult(
    makeInput({
      lines: [
        { text: "lo", mean: 0 },
        { text: "hi", mean: 1 },
      ],
    }),
  );
  assertValidResult(result);
  assert.equal(result.blocks[0].confidence, 0);
  assert.equal(result.blocks[1].confidence, 1);
});

test("sub-pixel rounding rule pinned: polygon uses floor, not round", () => {
  // ADR-11C.1 §3: polygon coords go through clampNonNegativeInt
  // (Math.floor + clamp to >= 0). Value 0.6 must become 0, not 1.
  const result = mapEngineLinesToOcrResult(
    makeInput({
      lines: [
        {
          text: "subpixel",
          mean: 0.7,
          box: [
            [0.6, 0.6],
            [10.4, 0.6],
            [10.4, 10.4],
            [0.6, 10.4],
          ],
        },
      ],
    }),
  );
  assertValidResult(result);
  // floor(0.6) = 0, floor(10.4) = 10 → polygon stays at integer multiples
  // of the floor rule. bbox.x = floor(0.6) = 0; bbox.w = ceil(10.4) - 0 = 11.
  assert.deepEqual(result.blocks[0].polygon, [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]);
  assert.deepEqual(result.blocks[0].bbox, { x: 0, y: 0, w: 11, h: 11 });
});
