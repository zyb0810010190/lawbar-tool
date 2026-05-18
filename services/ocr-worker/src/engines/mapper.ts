// Pure projection: @gutenye/ocr-node `Line[]` -> contract-shaped `OcrResult`.
//
// See ADR-11C.1 (docs/adr/ocr-engine-to-result-mapper-step-11c-1.md) for
// every projection rule pinned here. This file MUST stay pure: no I/O, no
// clock, no randomness. All time + ULIDs flow in via `MapperInput`.

import type { OcrResult } from "ocr-worker-contract";

export type EngineLine = {
  readonly text: string;
  readonly mean?: number | null;
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
  return Math.max(0, Math.floor(n));
}

// Schema requires confidence in [0, 1] when present (or null). Anything
// non-finite, out-of-range, missing, or explicit null collapses to null.
// Engine output is treated as hostile at this boundary even though
// @gutenye/ocr-node 1.4.8 always emits a finite mean in range.
function normalizeConfidence(mean: number | null | undefined): number | null {
  if (mean === null || mean === undefined) return null;
  if (!Number.isFinite(mean)) return null;
  if (mean < 0 || mean > 1) return null;
  return mean;
}

type Polygon4Plus = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
  ...[number, number][]
];

type DerivedGeometry = {
  bbox: { x: number; y: number; w: number; h: number };
  polygon: Polygon4Plus;
};

// Returns undefined when geometry cannot be honestly derived: too few
// corners, or any non-finite coordinate. We do NOT emit a partial polygon
// — that would silently produce a schema-invalid <4-point polygon
// alongside a derived bbox.
function deriveBboxAndPolygon(
  box: ReadonlyArray<readonly [number, number]>,
): DerivedGeometry | undefined {
  if (box.length < 4) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const points: Array<[number, number]> = [];
  for (const point of box) {
    const px = point[0];
    const py = point[1];
    if (!Number.isFinite(px) || !Number.isFinite(py)) return undefined;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
    points.push([clampNonNegativeInt(px), clampNonNegativeInt(py)]);
  }
  const x = clampNonNegativeInt(minX);
  const y = clampNonNegativeInt(minY);
  const w = Math.max(1, Math.ceil(maxX) - x);
  const h = Math.max(1, Math.ceil(maxY) - y);
  // Safe cast: `box.length >= 4` guarded above and every iteration pushes
  // one point, so `points` has >= 4 entries here.
  const polygon = points as unknown as Polygon4Plus;
  return { bbox: { x, y, w, h }, polygon };
}

type MapperBlock = OcrResult["blocks"] extends ReadonlyArray<infer B> | undefined
  ? B
  : never;

function buildBlock(line: EngineLine, index: number): MapperBlock {
  const base = {
    block_id: padBlockIndex(index),
    type: "line" as const,
    text: line.text,
    confidence: normalizeConfidence(line.mean),
  };
  if (line.box) {
    const derived = deriveBboxAndPolygon(line.box);
    if (derived) {
      return { ...base, bbox: derived.bbox, polygon: derived.polygon } satisfies MapperBlock;
    }
  }
  return base satisfies MapperBlock;
}

type MapperPageMetrics = OcrResult["page_metrics"];

function buildPageMetrics(
  timing: MapperTiming,
  geometry: MapperPageGeometry,
): MapperPageMetrics {
  const out: Record<string, number> = {
    processing_duration_ms: timing.processing_duration_ms,
  };
  if (timing.queued_duration_ms !== undefined) {
    out.queued_duration_ms = timing.queued_duration_ms;
  }
  if (geometry.page_width_px !== undefined) {
    out.page_width_px = geometry.page_width_px;
  }
  if (geometry.page_height_px !== undefined) {
    out.page_height_px = geometry.page_height_px;
  }
  return out as MapperPageMetrics;
}

export function mapEngineLinesToOcrResult(input: MapperInput): OcrResult {
  const blocks = input.lines.map((line, index) => buildBlock(line, index));
  const raw_text = input.lines.map((l) => l.text).join("\n");

  const base = {
    contract_version: input.job.contract_version,
    job_id: input.job.job_id,
    tenant_id: input.job.tenant_id,
    document_id: input.job.document_id,
    page_id: input.job.page_id,
    page_number: input.job.page_number,
    status: "succeeded" as const,
    engine: {
      name: input.engine.name,
      version: input.engine.version,
    },
    page_metrics: buildPageMetrics(input.timing, input.geometry),
    raw_text,
    blocks,
    partial_failure: null,
    metadata: {},
    completed_at: input.timing.completed_at,
  } satisfies OcrResult;

  if (input.job.document_revision !== undefined) {
    return { ...base, document_revision: input.job.document_revision } satisfies OcrResult;
  }
  return base;
}
