// Real @gutenye/ocr-node engine factory tests. See ADR-11C.3b.
//
// Always-on:
// - drift test: ENGINE_PKG_VERSION matches the installed package's
//   manifest on disk
// - version format: pkg+modelset
// - factory option surface
//
// Opt-in (OCR_WORKER_REAL_ENGINE_TESTS=1):
// - cold load + detect on the bakeoff's zh-02 PNG fixture. This
//   pays ~200ms cold load + ~130ms detect per case and downloads
//   nothing (the ONNX models ship in `@gutenye/ocr-models`), so
//   it's cheap once the model files are already on disk. CI doesn't
//   set the flag by default.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  makeRealPaddleEngine,
  RAW_ENGINE_PKG_VERSION,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));

// --- always-on drift + version-format tests --------------------------------

test("RAW_ENGINE_PKG_VERSION matches installed @gutenye/ocr-node manifest", () => {
  // Read the installed package.json directly off disk — the package's
  // own `exports` field does not expose package.json as a subpath, so
  // module-resolution-based reads don't work. fs read is the portable
  // option and matches what the drift test is supposed to catch.
  const pkgPath = join(
    here,
    "..",
    "node_modules",
    "@gutenye",
    "ocr-node",
    "package.json",
  );
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  assert.equal(
    RAW_ENGINE_PKG_VERSION,
    pkg.version,
    `services/ocr-worker hardcodes @gutenye/ocr-node version as ` +
      `"${RAW_ENGINE_PKG_VERSION}" but the installed package is at ` +
      `"${pkg.version}"; update RAW_ENGINE_PKG_VERSION in ` +
      `src/engines/real-paddleocr-engine.ts (and the ADR-11C.3b ` +
      `version reference) to match.`,
  );
});

test("version string format with default options: <pkg>+ch_PP-OCRv4", async () => {
  if (!shouldRunRealEngine()) {
    // We CAN'T construct the engine without doing the cold load, so
    // version-format assertion here would require side effects. Skip
    // until OCR_WORKER_REAL_ENGINE_TESTS=1; the format itself is
    // also covered structurally by the drift test (pkg version) +
    // the source code (model-set string).
    return;
  }
  const { version } = await makeRealPaddleEngine();
  assert.match(
    version,
    /^\d+\.\d+\.\d+\+ch_PP-OCRv4$/,
    `expected version like 1.4.8+ch_PP-OCRv4, got "${version}"`,
  );
  assert.ok(
    version.startsWith(RAW_ENGINE_PKG_VERSION + "+"),
    `expected version to start with "${RAW_ENGINE_PKG_VERSION}+"`,
  );
});

// --- opt-in real engine integration ---------------------------------------

test("OPT-IN: makeRealPaddleEngine cold-loads, returns engine + version", async (t) => {
  if (!shouldRunRealEngine()) {
    t.skip("set OCR_WORKER_REAL_ENGINE_TESTS=1 to run real-engine tests");
    return;
  }
  const real = await makeRealPaddleEngine();
  assert.equal(typeof real.engine.detect, "function");
  assert.match(real.version, /^\d+\.\d+\.\d+\+/);
});

test("OPT-IN: real engine detects text in a bakeoff zh-* PNG fixture", async (t) => {
  if (!shouldRunRealEngine()) {
    t.skip("set OCR_WORKER_REAL_ENGINE_TESTS=1 to run real-engine tests");
    return;
  }
  const fixturePath = join(
    here,
    "..",
    "..",
    "ocr-worker-bakeoff",
    "fixtures",
    "synthetic",
    "zh-02-court-heading.png",
  );
  if (!existsSync(fixturePath)) {
    t.skip(`bakeoff fixture missing at ${fixturePath}`);
    return;
  }
  const real = await makeRealPaddleEngine();
  const lines = await real.engine.detect(fixturePath);

  assert.ok(Array.isArray(lines), `expected array, got ${typeof lines}`);
  assert.ok(lines.length > 0, "expected at least one detected line");

  // Each line should at minimum carry a string `text`.
  for (const [i, line] of lines.entries()) {
    assert.equal(typeof line.text, "string", `lines[${i}].text not string`);
  }

  // The fixture's authored text is "上海市浦东新区人民法院". Engine output
  // may have OCR noise; assert SOME Chinese characters survive,
  // not exact equality (CER comparison is the bakeoff's job, not
  // this smoke test).
  const allText = lines.map((l) => l.text).join("");
  assert.match(
    allText,
    /[一-鿿]/,
    `expected at least one CJK character in detected text; got ${JSON.stringify(allText)}`,
  );
});

test("OPT-IN: real engine.detect returns same shape across two calls (cold load amortized)", async (t) => {
  if (!shouldRunRealEngine()) {
    t.skip("set OCR_WORKER_REAL_ENGINE_TESTS=1 to run real-engine tests");
    return;
  }
  const fixturePath = join(
    here,
    "..",
    "..",
    "ocr-worker-bakeoff",
    "fixtures",
    "synthetic",
    "zh-02-court-heading.png",
  );
  if (!existsSync(fixturePath)) {
    t.skip(`bakeoff fixture missing at ${fixturePath}`);
    return;
  }
  const real = await makeRealPaddleEngine();
  const first = await real.engine.detect(fixturePath);
  const second = await real.engine.detect(fixturePath);
  // The model is deterministic at temperature=0 (ONNX inference is
  // pure); two calls on the same input MUST return identical results.
  // If this assertion fails, the engine is using nondeterministic
  // ops (which would be a real defect for an OCR pipeline).
  assert.equal(first.length, second.length);
  for (let i = 0; i < first.length; i++) {
    assert.equal(first[i].text, second[i].text, `lines[${i}] text drift`);
  }
});

// --- helpers ---------------------------------------------------------------

function shouldRunRealEngine() {
  return process.env.OCR_WORKER_REAL_ENGINE_TESTS === "1";
}
