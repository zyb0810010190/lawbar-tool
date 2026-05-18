// Pure projection: @gutenye/ocr-node `Line[]` -> contract-shaped `OcrResult`.
//
// See ADR-11C.1 (docs/adr/ocr-engine-to-result-mapper-step-11c-1.md) for
// every projection rule pinned here. This file MUST stay pure: no I/O, no
// clock, no randomness. All time + ULIDs flow in via `MapperInput`.

import type { OcrResult } from "ocr-worker-contract";

export type EngineLine = {
  readonly text: string;
  readonly mean: number;
  readonly box?: ReadonlyArray<readonly [number, number]>;
};

export type MapperJobMeta = {
  readonly contract_version: string;
  readonly job_id: string;
  readonly tenant_id: string;
  readonly document_id: string;
  readonly document_revision?: number;
  readonly page_id: string;
  readonly page_number: number;
};

export type MapperEngineMeta = {
  readonly name: "paddleocr-onnx";
  readonly version: string;
};

export type MapperTiming = {
  readonly processing_duration_ms: number;
  readonly queued_duration_ms?: number;
  readonly completed_at: string;
};

export type MapperPageGeometry = {
  readonly page_width_px?: number;
  readonly page_height_px?: number;
};

export interface MapperInput {
  readonly lines: ReadonlyArray<EngineLine>;
  readonly job: MapperJobMeta;
  readonly engine: MapperEngineMeta;
  readonly timing: MapperTiming;
  readonly geometry: MapperPageGeometry;
}

const BLOCK_ID_WIDTH = 4;

function padBlockIndex(zeroBased: number): string {
  const oneBased = (zeroBased + 1).toString();
  return "b_" + oneBased.padStart(BLOCK_ID_WIDTH, "0");
}

function clampNonNegativeInt(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function deriveBboxAndPolygon(
  box: ReadonlyArray<readonly [number, number]>,
): { bbox: { x: number; y: number; w: number; h: number }; polygon: Array<[number, number]> } | undefined {
  if (box.length < 4) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const polygon: Array<[number, number]> = [];
  for (const point of box) {
    const px = point[0];
    const py = point[1];
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
    polygon.push([clampNonNegativeInt(px), clampNonNegativeInt(py)]);
  }
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return undefined;
  }
  const x = clampNonNegativeInt(minX);
  const y = clampNonNegativeInt(minY);
  const w = Math.max(1, Math.ceil(maxX) - x);
  const h = Math.max(1, Math.ceil(maxY) - y);
  return { bbox: { x, y, w, h }, polygon };
}

export function mapEngineLinesToOcrResult(input: MapperInput): OcrResult {
  const blocks = input.lines.map((line, index) => {
    const block: Record<string, unknown> = {
      block_id: padBlockIndex(index),
      type: "line",
      text: line.text,
      confidence: line.mean,
    };
    if (line.box) {
      const derived = deriveBboxAndPolygon(line.box);
      if (derived) {
        block.bbox = derived.bbox;
        block.polygon = derived.polygon;
      }
    }
    return block;
  });

  const raw_text = input.lines.map((l) => l.text).join("\n");

  const page_metrics: Record<string, unknown> = {
    processing_duration_ms: input.timing.processing_duration_ms,
  };
  if (input.timing.queued_duration_ms !== undefined) {
    page_metrics.queued_duration_ms = input.timing.queued_duration_ms;
  }
  if (input.geometry.page_width_px !== undefined) {
    page_metrics.page_width_px = input.geometry.page_width_px;
  }
  if (input.geometry.page_height_px !== undefined) {
    page_metrics.page_height_px = input.geometry.page_height_px;
  }

  const result: Record<string, unknown> = {
    contract_version: input.job.contract_version,
    job_id: input.job.job_id,
    tenant_id: input.job.tenant_id,
    document_id: input.job.document_id,
    page_id: input.job.page_id,
    page_number: input.job.page_number,
    status: "succeeded",
    engine: {
      name: input.engine.name,
      version: input.engine.version,
    },
    page_metrics,
    raw_text,
    blocks,
    partial_failure: null,
    metadata: {},
    completed_at: input.timing.completed_at,
  };

  if (input.job.document_revision !== undefined) {
    result.document_revision = input.job.document_revision;
  }

  return result as OcrResult;
}
