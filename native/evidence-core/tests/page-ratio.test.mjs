// page-ratio.test.mjs — WI-A3-T2 tests for the pure page-ratio normalization math.
// Run: npm --prefix native/evidence-core test  (node --test tests/*.test.mjs)
//
// Oracle values are hand-computed independently of the implementation (e.g. a half-box rect -> 0.5), not
// produced by calling the function under test, so the tests genuinely pin the contract.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  normalizePageSpaceToRatio,
  denormalizeRatioToPageSpace,
  canonicalizeRatio,
  roundHalfToEven,
  PageRatioError,
  ROUNDTRIP_TOLERANCE,
  SUPPORTED_ROTATIONS,
} from "../lib/page-ratio.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.join(HERE, "..", "..", "..", "dev-memo", "run", "evidence");

// A0.7 synthetic page size 612 x 792, zero origin, upright, with valid provenance.
function geom(overrides = {}) {
  return {
    documentId: "doc-1",
    physicalPageIndex: 0,
    geometryCapturedAt: "2026-06-23T00:00:00Z",
    boundsX: 0,
    boundsY: 0,
    boundsWidth: 612,
    boundsHeight: 792,
    rotation: 0,
    ...overrides,
  };
}

const throwsCode = (code) => (err) => err instanceof PageRatioError && err.code === code;

// ── round-half-to-even primitive (exact, deterministic) ─────────────────────────────────────────────
test("roundHalfToEven: exact ties round to even", () => {
  assert.equal(roundHalfToEven(0.5), 0);
  assert.equal(roundHalfToEven(1.5), 2);
  assert.equal(roundHalfToEven(2.5), 2);
  assert.equal(roundHalfToEven(3.5), 4);
  assert.equal(roundHalfToEven(-0.5), 0);
  assert.equal(roundHalfToEven(-1.5), -2);
  assert.equal(roundHalfToEven(-2.5), -2);
});
test("roundHalfToEven: non-ties round to nearest", () => {
  assert.equal(roundHalfToEven(0.4), 0);
  assert.equal(roundHalfToEven(0.6), 1);
  assert.equal(roundHalfToEven(2.4), 2);
  assert.equal(roundHalfToEven(2.6), 3);
});

// ── canonical 12-dp fixed-point string ──────────────────────────────────────────────────────────────
test("canonicalizeRatio: fixed-point 12-dp format", () => {
  assert.equal(canonicalizeRatio(0), "0.000000000000");
  assert.equal(canonicalizeRatio(1), "1.000000000000");
  assert.equal(canonicalizeRatio(0.5), "0.500000000000");
  assert.equal(canonicalizeRatio(0.25), "0.250000000000");
});
test("canonicalizeRatio: -0 normalizes to 0 (no negative ratio)", () => {
  assert.equal(canonicalizeRatio(-0), "0.000000000000");
  assert.equal(canonicalizeRatio(-1e-15), "0.000000000000"); // clamps into [0,1]
});
test("canonicalizeRatio: every output has exactly 12 fractional digits, no exponent", () => {
  for (const v of [0, 1, 0.5, 1 / 612, 1 / 792, 0.123456789012, 0.999999999999]) {
    assert.match(canonicalizeRatio(v), /^\d+\.\d{12}$/);
  }
});

// ── normalize: exact independent oracle cases (612 x 792, rotation 0) ────────────────────────────────
test("normalize: full-box rect -> (0,0,1,1)", () => {
  const r = normalizePageSpaceToRatio({ x: 0, y: 0, width: 612, height: 792 }, geom());
  assert.equal(r.x, "0.000000000000");
  assert.equal(r.y, "0.000000000000");
  assert.equal(r.width, "1.000000000000");
  assert.equal(r.height, "1.000000000000");
  assert.equal(r.coordinateSpace, "page_ratio");
  assert.equal(r.originRef, "DocumentPageGeometry");
  assert.equal(r.pageRotation, 0);
});
test("normalize: half-box lower-left quarter -> (0,0,0.5,0.5)", () => {
  const r = normalizePageSpaceToRatio({ x: 0, y: 0, width: 306, height: 396 }, geom());
  assert.deepEqual([r.x, r.y, r.width, r.height], ["0.000000000000", "0.000000000000", "0.500000000000", "0.500000000000"]);
});
test("normalize: centered half rect -> (0.25,0.25,0.5,0.5)", () => {
  const r = normalizePageSpaceToRatio({ x: 153, y: 198, width: 306, height: 396 }, geom());
  assert.deepEqual([r.x, r.y, r.width, r.height], ["0.250000000000", "0.250000000000", "0.500000000000", "0.500000000000"]);
});
test("normalize: box-origin subtraction (non-zero origin)", () => {
  const g = geom({ boundsX: 100, boundsY: 50 });
  const full = normalizePageSpaceToRatio({ x: 100, y: 50, width: 612, height: 792 }, g);
  assert.deepEqual([full.x, full.y, full.width, full.height], ["0.000000000000", "0.000000000000", "1.000000000000", "1.000000000000"]);
  const centered = normalizePageSpaceToRatio({ x: 253, y: 248, width: 306, height: 396 }, g);
  assert.deepEqual([centered.x, centered.y], ["0.250000000000", "0.250000000000"]);
});
test("normalize: edge/corner rect at lower-left -> small ratios", () => {
  const r = normalizePageSpaceToRatio({ x: 0, y: 0, width: 1, height: 1 }, geom());
  assert.equal(r.x, "0.000000000000");
  assert.equal(r.y, "0.000000000000");
  assert.equal(r.width, "0.001633986928"); // 1/612
  assert.equal(r.height, "0.001262626263"); // 1/792, round-half-to-even at 12dp
});

// ── rotation: exact independent oracle (lower-left quarter under each rotation) ──────────────────────
test("normalize: rotation 90 maps lower-left quarter -> (0,0.5,0.5,0.5)", () => {
  const r = normalizePageSpaceToRatio({ x: 0, y: 0, width: 306, height: 396 }, geom({ rotation: 90 }));
  assert.deepEqual([r.x, r.y, r.width, r.height], ["0.000000000000", "0.500000000000", "0.500000000000", "0.500000000000"]);
  assert.equal(r.pageRotation, 90);
});
test("normalize: rotation 180 maps lower-left quarter -> (0.5,0.5,0.5,0.5)", () => {
  const r = normalizePageSpaceToRatio({ x: 0, y: 0, width: 306, height: 396 }, geom({ rotation: 180 }));
  assert.deepEqual([r.x, r.y, r.width, r.height], ["0.500000000000", "0.500000000000", "0.500000000000", "0.500000000000"]);
});
test("normalize: rotation 270 maps lower-left quarter -> (0.5,0,0.5,0.5)", () => {
  const r = normalizePageSpaceToRatio({ x: 0, y: 0, width: 306, height: 396 }, geom({ rotation: 270 }));
  assert.deepEqual([r.x, r.y, r.width, r.height], ["0.500000000000", "0.000000000000", "0.500000000000", "0.500000000000"]);
});

// ── round-trip within tolerance, all rotations, non-zero origin, fractional rect ────────────────────
test("roundtrip: denormalize(normalize(rect)) within tolerance for every rotation", () => {
  const rect = { x: 137, y: 251, width: 83, height: 42 };
  for (const rotation of SUPPORTED_ROTATIONS) {
    const g = geom({ boundsX: 12, boundsY: 7, boundsWidth: 600, boundsHeight: 780, rotation });
    const ratio = normalizePageSpaceToRatio(rect, g);
    const back = denormalizeRatioToPageSpace(ratio, g);
    const tolX = ROUNDTRIP_TOLERANCE * g.boundsWidth;
    const tolY = ROUNDTRIP_TOLERANCE * g.boundsHeight;
    assert.ok(Math.abs(back.x - rect.x) <= tolX, `rot ${rotation} x: ${back.x} vs ${rect.x}`);
    assert.ok(Math.abs(back.y - rect.y) <= tolY, `rot ${rotation} y: ${back.y} vs ${rect.y}`);
    assert.ok(Math.abs(back.width - rect.width) <= tolX, `rot ${rotation} w: ${back.width} vs ${rect.width}`);
    assert.ok(Math.abs(back.height - rect.height) <= tolY, `rot ${rotation} h: ${back.height} vs ${rect.height}`);
  }
});
test("roundtrip: fractional rect", () => {
  const rect = { x: 10.5, y: 20.25, width: 30.5, height: 40.5 };
  const g = geom();
  const back = denormalizeRatioToPageSpace(normalizePageSpaceToRatio(rect, g), g);
  assert.ok(Math.abs(back.x - rect.x) <= ROUNDTRIP_TOLERANCE * g.boundsWidth);
  assert.ok(Math.abs(back.height - rect.height) <= ROUNDTRIP_TOLERANCE * g.boundsHeight);
});

// ── fail-closed: invalid rect ───────────────────────────────────────────────────────────────────────
test("normalize: zero/negative width or height rejected", () => {
  assert.throws(() => normalizePageSpaceToRatio({ x: 0, y: 0, width: 0, height: 10 }, geom()), throwsCode("invalid_rect"));
  assert.throws(() => normalizePageSpaceToRatio({ x: 0, y: 0, width: -5, height: 10 }, geom()), throwsCode("invalid_rect"));
  assert.throws(() => normalizePageSpaceToRatio({ x: 0, y: 0, width: 5, height: -1 }, geom()), throwsCode("invalid_rect"));
});
test("normalize: NaN/Infinity rejected", () => {
  assert.throws(() => normalizePageSpaceToRatio({ x: NaN, y: 0, width: 5, height: 5 }, geom()), throwsCode("invalid_rect"));
  assert.throws(() => normalizePageSpaceToRatio({ x: 0, y: 0, width: Infinity, height: 5 }, geom()), throwsCode("invalid_rect"));
  assert.throws(() => normalizePageSpaceToRatio({ x: 0, y: 0, width: 5, height: 5 }, geom({ boundsWidth: Infinity })), throwsCode("invalid_geometry"));
});
test("normalize: rect not an object rejected", () => {
  assert.throws(() => normalizePageSpaceToRatio(null, geom()), throwsCode("invalid_rect"));
  assert.throws(() => normalizePageSpaceToRatio([0, 0, 5, 5], geom()), throwsCode("invalid_rect"));
});
test("normalize: rect outside the resolved box rejected (out_of_bounds)", () => {
  assert.throws(() => normalizePageSpaceToRatio({ x: 600, y: 0, width: 100, height: 10 }, geom()), throwsCode("out_of_bounds"));
  assert.throws(() => normalizePageSpaceToRatio({ x: -1, y: 0, width: 10, height: 10 }, geom()), throwsCode("out_of_bounds"));
});

// ── fail-closed: geometry provenance ────────────────────────────────────────────────────────────────
test("normalize: absent geometry provenance rejected", () => {
  const { geometryCapturedAt, ...noVer } = geom();
  assert.throws(() => normalizePageSpaceToRatio({ x: 0, y: 0, width: 5, height: 5 }, noVer), throwsCode("invalid_geometry"));
  assert.throws(() => normalizePageSpaceToRatio({ x: 0, y: 0, width: 5, height: 5 }, geom({ geometryCapturedAt: "" })), throwsCode("invalid_geometry"));
});
test("normalize: ambiguous geometry provenance rejected", () => {
  assert.throws(() => normalizePageSpaceToRatio({ x: 0, y: 0, width: 5, height: 5 }, [geom(), geom()]), throwsCode("ambiguous_geometry"));
  assert.throws(() => normalizePageSpaceToRatio({ x: 0, y: 0, width: 5, height: 5 }, geom({ candidates: [1, 2] })), throwsCode("ambiguous_geometry"));
  assert.throws(() => normalizePageSpaceToRatio({ x: 0, y: 0, width: 5, height: 5 }, geom({ geometryCapturedAt: ["a", "b"] })), throwsCode("ambiguous_geometry"));
});
test("normalize: geometry not an object rejected", () => {
  assert.throws(() => normalizePageSpaceToRatio({ x: 0, y: 0, width: 5, height: 5 }, null), throwsCode("invalid_geometry"));
  assert.throws(() => normalizePageSpaceToRatio({ x: 0, y: 0, width: 5, height: 5 }, geom({ boundsWidth: 0 })), throwsCode("invalid_geometry"));
});

// ── fail-closed: rotation + viewport ────────────────────────────────────────────────────────────────
test("normalize: unsupported rotation rejected", () => {
  assert.throws(() => normalizePageSpaceToRatio({ x: 0, y: 0, width: 5, height: 5 }, geom({ rotation: 45 })), throwsCode("invalid_rotation"));
  assert.throws(() => normalizePageSpaceToRatio({ x: 0, y: 0, width: 5, height: 5 }, geom({ rotation: 360 })), throwsCode("invalid_rotation"));
});
test("normalize: viewport/screen coordinate provenance rejected", () => {
  assert.throws(() => normalizePageSpaceToRatio({ x: 0, y: 0, width: 5, height: 5, viewport: { w: 1 } }, geom()), throwsCode("viewport_coordinates"));
  assert.throws(() => normalizePageSpaceToRatio({ x: 0, y: 0, width: 5, height: 5, coordinateSpace: "viewport" }, geom()), throwsCode("viewport_coordinates"));
  assert.throws(() => normalizePageSpaceToRatio({ x: 0, y: 0, width: 5, height: 5 }, geom({ devicePixelRatio: 2 })), throwsCode("viewport_coordinates"));
});

// ── fail-closed: denormalize ratio domain ───────────────────────────────────────────────────────────
test("denormalize: ratio outside [0,1] rejected", () => {
  assert.throws(() => denormalizeRatioToPageSpace({ x: 1.5, y: 0, width: 0.1, height: 0.1 }, geom()), throwsCode("invalid_ratio_domain"));
  assert.throws(() => denormalizeRatioToPageSpace({ x: -0.2, y: 0, width: 0.1, height: 0.1 }, geom()), throwsCode("invalid_ratio_domain"));
});
test("denormalize: ratio rect extending beyond unit square rejected", () => {
  assert.throws(() => denormalizeRatioToPageSpace({ x: 0.8, y: 0, width: 0.5, height: 0.1 }, geom()), throwsCode("invalid_ratio_domain"));
});
test("denormalize: zero/negative ratio dims rejected", () => {
  assert.throws(() => denormalizeRatioToPageSpace({ x: 0, y: 0, width: 0, height: 0.1 }, geom()), throwsCode("invalid_ratio_domain"));
});
test("denormalize: pageRotation mismatch rejected", () => {
  assert.throws(() => denormalizeRatioToPageSpace({ x: 0, y: 0, width: 0.1, height: 0.1, pageRotation: 90 }, geom({ rotation: 0 })), throwsCode("invalid_rotation"));
});
test("denormalize: accepts canonical string components", () => {
  const r = normalizePageSpaceToRatio({ x: 153, y: 198, width: 306, height: 396 }, geom());
  const back = denormalizeRatioToPageSpace(r, geom()); // r.x etc are strings
  assert.ok(Math.abs(back.x - 153) <= ROUNDTRIP_TOLERANCE * 612);
});

// ── purity: no I/O, nothing written under dev-memo/run/evidence/ ─────────────────────────────────────
test("pure: calling the math writes nothing under dev-memo/run/evidence/", () => {
  const before = existsSync(EVIDENCE_DIR) ? readdirSync(EVIDENCE_DIR).sort() : null;
  const g = geom({ rotation: 180 });
  denormalizeRatioToPageSpace(normalizePageSpaceToRatio({ x: 10, y: 10, width: 20, height: 20 }, g), g);
  const after = existsSync(EVIDENCE_DIR) ? readdirSync(EVIDENCE_DIR).sort() : null;
  assert.deepEqual(after, before);
});
