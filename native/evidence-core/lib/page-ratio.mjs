// page-ratio.mjs — WI-A3-T2 pure headless page-ratio normalization math (Evidence-Genie M0 A3).
//
// PURE, dependency-free, side-effect-free: no I/O, no clock, no randomness, no PDFKit, no DOM. It implements
// ONLY the coordinate contract from docs/adr/ADR-evidence-a3-anchor-link-contract.md §4 + INV-A3-4/5/7. It is
// NOT the anchor resolver, link-status engine, persistence layer, or export layer. It is the dependency-free
// JS oracle the future Swift/PDFKit implementation must match (cross-language determinism).
//
// ── Coordinate model (explicit, so JS and a future Swift/PDFKit impl cannot diverge — review Medium) ────────
//
// Geometry (persisted DocumentPageGeometry; passed as DATA, never fetched/inferred):
//   { documentId, physicalPageIndex, geometryCapturedAt, boundsX, boundsY, boundsWidth, boundsHeight, rotation }
//   - boundsX/boundsY/boundsWidth/boundsHeight describe the resolved page box in UNROTATED PDF page space
//     (lower-left origin, 72 dpi). boundsWidth/boundsHeight are the UNROTATED resolved-box dimensions.
//   - geometryCapturedAt is the geometry VERSION (provenance). A single scalar; absent/empty => fail closed
//     (INV-A3-7). An array of candidates / a `candidates` field with length != 1 => ambiguous => fail closed.
//   - rotation is the page's clockwise display rotation (PDF /Rotate), one of 0 | 90 | 180 | 270.
//
// Input page-space rect (UNROTATED PDF page space, lower-left origin): { x, y, width, height }, where (x, y)
// is the lower-left corner and width/height > 0. Viewport/screen/DOM/CSS-pixel coordinates are NEVER a valid
// persistence source and are rejected on sight (INV-A3-3/10).
//
// Normalization pipeline:
//   1. Subtract the resolved box origin and scale to the UNROTATED unit square [0,1]^2 (lower-left origin):
//        u = (x - boundsX) / boundsWidth ,  v = (y - boundsY) / boundsHeight   (per corner).
//   2. Apply the page rotation to map the UNROTATED unit square to the DISPLAYED unit square [0,1]^2
//      (lower-left origin), using the exact per-rotation corner map ROT below. Both corners are mapped, then
//      the axis-aligned displayed rect is min/max of the two mapped corners (for 90/270 width<->height swap).
//   3. The persisted page_ratio is in the DISPLAYED orientation, each component canonicalized to a fixed-point
//      decimal string with EXACTLY 12 fractional digits, round-half-to-even (INV-A3-5). Out-of-[0,1] corners
//      (beyond a 1e-9 tolerance) are INVALID (an anchor region must lie within the page) => fail closed.
//
// Per-rotation corner map ROT[θ]: UNROTATED unit point (u, v) -> DISPLAYED unit point (lower-left origin).
//   0:   (u, v) -> (u,     v    )
//   90:  (u, v) -> (v,     1 - u)        // page rotated 90° clockwise for display
//   180: (u, v) -> (1 - u, 1 - v)
//   270: (u, v) -> (1 - v, u    )
// Denormalization applies the exact inverse map INV_ROT[θ] (inverse of 90 is 270, 180 is its own inverse).

export const SUPPORTED_ROTATIONS = [0, 90, 180, 270];
export const RATIO_FRACTION_DIGITS = 12;
export const ROUNDTRIP_TOLERANCE = 1e-9; // absolute, in page_ratio units (relative to box dimensions)

const DOMAIN_TOL = 1e-9; // a corner may sit at most this far outside [0,1] before it is rejected
// Forbidden viewport/screen provenance keys — their presence on geometry OR rect is an immediate throw.
const VIEWPORT_KEYS = ["viewport", "screen", "devicePixelRatio", "cssPixel", "cssPixels", "renderScale", "dom", "screenX", "screenY"];

export class PageRatioError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PageRatioError";
    this.code = code; // invalid_geometry | ambiguous_geometry | invalid_rect | invalid_rotation |
    //                    out_of_bounds | viewport_coordinates | invalid_ratio_domain
  }
}

// Round x to the nearest integer, ties to even (banker's rounding). Exported for direct, exact unit testing.
export function roundHalfToEven(x) {
  if (!Number.isFinite(x)) throw new PageRatioError("invalid_rect", `roundHalfToEven: non-finite input ${x}`);
  const floor = Math.floor(x);
  const frac = x - floor;
  if (frac < 0.5) return floor;
  if (frac > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1; // exact .5 tie -> even
}

// Canonicalize a numeric ratio in [0,1] to a fixed-point string with EXACTLY 12 fractional digits,
// round-half-to-even, no exponent, no trailing-zero trim, leading "0." for values < 1, -0 normalized to 0.
export function canonicalizeRatio(value) {
  if (!Number.isFinite(value)) throw new PageRatioError("invalid_ratio_domain", `canonicalizeRatio: non-finite ${value}`);
  const clamped = Math.min(1, Math.max(0, value)); // values within DOMAIN_TOL of [0,1] are clamped exactly
  const scale = 10 ** RATIO_FRACTION_DIGITS;
  const units = roundHalfToEven(clamped * scale); // integer count of 1e-12 units, in [0, 1e12]
  const digits = String(Math.abs(units)).padStart(RATIO_FRACTION_DIGITS + 1, "0");
  const intPart = digits.slice(0, digits.length - RATIO_FRACTION_DIGITS);
  const fracPart = digits.slice(digits.length - RATIO_FRACTION_DIGITS);
  return `${intPart}.${fracPart}`; // sign dropped: ratios are in [0,1]; -0 -> "0.000000000000"
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function assertNoViewportKeys(obj, what) {
  for (const k of VIEWPORT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      throw new PageRatioError("viewport_coordinates", `${what} carries viewport/screen provenance key '${k}'; viewport/screen coordinates are never a persistence source`);
    }
  }
  if (typeof obj.coordinateSpace === "string" && /viewport|screen|css|device/i.test(obj.coordinateSpace)) {
    throw new PageRatioError("viewport_coordinates", `${what}.coordinateSpace='${obj.coordinateSpace}' is a viewport/screen space, never a persistence source`);
  }
}

function validateGeometry(geometry) {
  if (Array.isArray(geometry)) {
    throw new PageRatioError("ambiguous_geometry", "geometry resolved to multiple candidates (array); disambiguate to a single geometry version");
  }
  if (!isPlainObject(geometry)) {
    throw new PageRatioError("invalid_geometry", "geometry must be a single object");
  }
  assertNoViewportKeys(geometry, "geometry");
  if (Array.isArray(geometry.candidates) && geometry.candidates.length !== 1) {
    throw new PageRatioError("ambiguous_geometry", `geometry has ${geometry.candidates.length} candidate versions; exactly one is required`);
  }
  // Provenance: a single, non-empty scalar geometryCapturedAt (INV-A3-7).
  const ver = geometry.geometryCapturedAt;
  if (ver === undefined || ver === null || ver === "") {
    throw new PageRatioError("invalid_geometry", "absent geometry provenance: geometryCapturedAt is required");
  }
  if (Array.isArray(ver) || isPlainObject(ver)) {
    throw new PageRatioError("ambiguous_geometry", "ambiguous geometry provenance: geometryCapturedAt must be a single scalar version");
  }
  for (const f of ["boundsX", "boundsY", "boundsWidth", "boundsHeight"]) {
    if (!Number.isFinite(geometry[f])) {
      throw new PageRatioError("invalid_geometry", `geometry.${f} must be a finite number`);
    }
  }
  if (geometry.boundsWidth <= 0 || geometry.boundsHeight <= 0) {
    throw new PageRatioError("invalid_geometry", "geometry.boundsWidth and geometry.boundsHeight must be > 0");
  }
  if (!SUPPORTED_ROTATIONS.includes(geometry.rotation)) {
    throw new PageRatioError("invalid_rotation", `unsupported rotation ${geometry.rotation}; supported: ${SUPPORTED_ROTATIONS.join(", ")}`);
  }
  return geometry;
}

// ROT[θ]: unrotated unit point -> displayed unit point.
function rotateUnitPoint(u, v, rotation) {
  switch (rotation) {
    case 0: return [u, v];
    case 90: return [v, 1 - u];
    case 180: return [1 - u, 1 - v];
    case 270: return [1 - v, u];
    default: throw new PageRatioError("invalid_rotation", `unsupported rotation ${rotation}`);
  }
}

// INV_ROT[θ]: displayed unit point -> unrotated unit point (inverse of rotateUnitPoint).
function unrotateUnitPoint(u, v, rotation) {
  switch (rotation) {
    case 0: return [u, v];
    case 90: return [1 - v, u];   // inverse of (u,v)->(v,1-u)
    case 180: return [1 - u, 1 - v];
    case 270: return [v, 1 - u];  // inverse of (u,v)->(1-v,u)
    default: throw new PageRatioError("invalid_rotation", `unsupported rotation ${rotation}`);
  }
}

function withinUnit(value) {
  return value >= -DOMAIN_TOL && value <= 1 + DOMAIN_TOL;
}

// normalizePageSpaceToRatio(rect, geometry) -> page_ratio rect (canonical 12-dp string components).
export function normalizePageSpaceToRatio(rect, geometry) {
  validateGeometry(geometry);
  if (!isPlainObject(rect)) throw new PageRatioError("invalid_rect", "rect must be an object");
  assertNoViewportKeys(rect, "rect");
  for (const f of ["x", "y", "width", "height"]) {
    if (!Number.isFinite(rect[f])) throw new PageRatioError("invalid_rect", `rect.${f} must be a finite number`);
  }
  if (rect.width <= 0 || rect.height <= 0) {
    throw new PageRatioError("invalid_rect", "rect.width and rect.height must be > 0");
  }
  const { boundsX, boundsY, boundsWidth, boundsHeight, rotation } = geometry;
  // Unrotated unit-square corners (lower-left, upper-right).
  const u0 = (rect.x - boundsX) / boundsWidth;
  const v0 = (rect.y - boundsY) / boundsHeight;
  const u1 = (rect.x + rect.width - boundsX) / boundsWidth;
  const v1 = (rect.y + rect.height - boundsY) / boundsHeight;
  for (const c of [u0, v0, u1, v1]) {
    if (!withinUnit(c)) {
      throw new PageRatioError("out_of_bounds", "rect lies outside the resolved page box; an anchor region must be within the page");
    }
  }
  // Rotate both corners into the displayed unit square, then take the axis-aligned min/max.
  const [a0, b0] = rotateUnitPoint(u0, v0, rotation);
  const [a1, b1] = rotateUnitPoint(u1, v1, rotation);
  const dx = Math.min(a0, a1);
  const dy = Math.min(b0, b1);
  const dw = Math.abs(a1 - a0);
  const dh = Math.abs(b1 - b0);
  return {
    x: canonicalizeRatio(dx),
    y: canonicalizeRatio(dy),
    width: canonicalizeRatio(dw),
    height: canonicalizeRatio(dh),
    coordinateSpace: "page_ratio",
    originRef: "DocumentPageGeometry",
    pageRotation: rotation,
  };
}

function parseRatioComponent(v, name) {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof v === "string" && v.trim() === "") throw new PageRatioError("invalid_ratio_domain", `ratio.${name} is empty`);
  if (!Number.isFinite(n)) throw new PageRatioError("invalid_ratio_domain", `ratio.${name} must be a finite number`);
  return n;
}

// denormalizeRatioToPageSpace(ratioRect, geometry) -> page-space rect (numeric, unrotated PDF page space).
export function denormalizeRatioToPageSpace(ratioRect, geometry) {
  validateGeometry(geometry);
  if (!isPlainObject(ratioRect)) throw new PageRatioError("invalid_ratio_domain", "ratio rect must be an object");
  assertNoViewportKeys(ratioRect, "ratio");
  const rx = parseRatioComponent(ratioRect.x, "x");
  const ry = parseRatioComponent(ratioRect.y, "y");
  const rw = parseRatioComponent(ratioRect.width, "width");
  const rh = parseRatioComponent(ratioRect.height, "height");
  if (rw <= 0 || rh <= 0) throw new PageRatioError("invalid_ratio_domain", "ratio width/height must be > 0");
  for (const [val, nm] of [[rx, "x"], [ry, "y"], [rw, "width"], [rh, "height"]]) {
    if (val < -DOMAIN_TOL || val > 1 + DOMAIN_TOL) throw new PageRatioError("invalid_ratio_domain", `ratio.${nm}=${val} outside [0,1]`);
  }
  if (rx + rw > 1 + DOMAIN_TOL || ry + rh > 1 + DOMAIN_TOL) {
    throw new PageRatioError("invalid_ratio_domain", "ratio rect extends beyond the displayed unit square");
  }
  if (ratioRect.pageRotation !== undefined && ratioRect.pageRotation !== geometry.rotation) {
    throw new PageRatioError("invalid_rotation", `ratio.pageRotation=${ratioRect.pageRotation} != geometry.rotation=${geometry.rotation}`);
  }
  const { boundsX, boundsY, boundsWidth, boundsHeight, rotation } = geometry;
  // Inverse-rotate displayed corners back to the unrotated unit square.
  const [u0, v0] = unrotateUnitPoint(rx, ry, rotation);
  const [u1, v1] = unrotateUnitPoint(rx + rw, ry + rh, rotation);
  const uMin = Math.min(u0, u1);
  const vMin = Math.min(v0, v1);
  const uMax = Math.max(u0, u1);
  const vMax = Math.max(v0, v1);
  return {
    x: uMin * boundsWidth + boundsX,
    y: vMin * boundsHeight + boundsY,
    width: (uMax - uMin) * boundsWidth,
    height: (vMax - vMin) * boundsHeight,
  };
}
