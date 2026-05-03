// Step 10I-A — verify the queue transport surface ships from the
// `ocr-worker-contract` main entry. This is a build/export-shape pin only;
// behavior of `OcrJobQueueBackend` implementations is exercised by
// `runOcrQueueConformance` against each backend (in-memory in
// `ocr-worker-adapter`, SQLite in `ocr-persistence` per 10I-B).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { OcrQueueError } from "../dist/index.js";
import { runOcrQueueConformance } from "../dist/testing/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");

test("OcrQueueError is exported as a constructible class", () => {
  assert.equal(typeof OcrQueueError, "function");
  const err = new OcrQueueError("dedupe_conflict", "x");
  assert.equal(err.name, "OcrQueueError");
  assert.equal(err.code, "dedupe_conflict");
  assert.ok(err instanceof Error);
});

test("OcrQueueError preserves all five contract codes via runtime construction", () => {
  const codes = [
    "dedupe_conflict",
    "unknown_receipt",
    "stale_receipt",
    "lease_expired",
    "invalid_claim",
  ];
  for (const code of codes) {
    const e = new OcrQueueError(code, code);
    assert.equal(e.code, code);
  }
});

test("runOcrQueueConformance is exported from ocr-worker-contract/testing", () => {
  assert.equal(typeof runOcrQueueConformance, "function");
});

// ---------------------------------------------------------------------------
// Packaging smoke (Step 10I-A audit fix).
//
// `runOcrQueueConformance` reads `fixtures/valid/submission-s3.json` at
// runtime via the JSON-import attribute baked into the compiled
// `dist/testing/queue-conformance.js`. `fake-worker.ts` likewise loads
// `result-chinese-litigation.json` and `result-partial-failure.json` from
// `fixtures/valid/`. If `fixtures/` is not in the package manifest's
// `files` array, a packed/install consumer (`npm pack` → `npm install
// .tgz`) gets a tarball without the fixtures, and either harness fails at
// import-time inside the consumer with an opaque ENOENT / module-not-found.
//
// Pin the manifest declaration AND the on-disk presence of every fixture
// the runtime importers reach for. A drift in either surface is now a
// failing test rather than a downstream consumer crash.
// ---------------------------------------------------------------------------

test("package.json `files` array includes 'fixtures' so runtime fixture imports survive packaging", () => {
  const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
  assert.ok(Array.isArray(pkg.files), "package.json `files` must be an array");
  assert.ok(
    pkg.files.includes("fixtures"),
    `package.json \`files\` must include "fixtures"; got ${JSON.stringify(pkg.files)}`,
  );
});

test("runtime-imported fixtures exist on disk under fixtures/valid/", () => {
  // These three fixtures are reached for at runtime by compiled testing
  // modules: queue-conformance imports submission-s3, fake-worker imports
  // both result fixtures. The list is exhaustive for runtime imports —
  // not a general fixture inventory.
  const runtimeFixtures = [
    "fixtures/valid/submission-s3.json",
    "fixtures/valid/result-chinese-litigation.json",
    "fixtures/valid/result-partial-failure.json",
  ];
  for (const rel of runtimeFixtures) {
    const abs = join(pkgRoot, rel);
    assert.ok(
      existsSync(abs),
      `expected runtime fixture to exist: ${rel}`,
    );
  }
});
