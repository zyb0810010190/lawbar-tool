// Step 10I-A regression tests for queue contract relocation.
//
// What this pins:
//   1. Queue transport types/errors are exported from `ocr-worker-contract`.
//   2. `ocr-worker-adapter` re-exports them.
//   3. `OcrQueueError` is the *same class identity* through both paths —
//      not a wrapper, not a copy. `instanceof` must work regardless of
//      where the importer reached for the class.
//   4. Errors thrown by `InMemoryOcrQueue` (constructed via the adapter
//      surface) are `instanceof` the contract-imported `OcrQueueError`.
//
// Why this matters: the adapter and the future SqliteOcrQueue (10I-B in
// `ocr-persistence`) both throw `OcrQueueError`, and the conformance
// harness lives in `ocr-worker-contract/testing`. If the worker re-export
// were a wrapper class, `instanceof` checks would diverge across the two
// import paths and the conformance suite would silently weaken to
// "rejects with anything" for the worker.

import { test } from "node:test";
import assert from "node:assert/strict";

import * as ContractMain from "ocr-worker-contract";
import * as Adapter from "../dist/index.js";

test("queue types are exported from ocr-worker-contract main entry", () => {
  // Value export.
  assert.equal(typeof ContractMain.OcrQueueError, "function");
  assert.equal(ContractMain.OcrQueueError.name, "OcrQueueError");
  // Type-only exports cannot be observed at runtime, but the named export
  // surface is still asserted via the adapter's re-export below.
});

test("ocr-worker-adapter re-exports queue types", () => {
  assert.equal(typeof Adapter.OcrQueueError, "function");
  assert.equal(Adapter.OcrQueueError.name, "OcrQueueError");
});

test("OcrQueueError class identity is preserved across contract import and adapter re-export", () => {
  assert.strictEqual(
    Adapter.OcrQueueError,
    ContractMain.OcrQueueError,
    "adapter must re-export the same class, not a wrapper",
  );
});

test("OcrQueueError(code) instances satisfy instanceof through both import paths", () => {
  const err = new ContractMain.OcrQueueError("dedupe_conflict", "x");
  assert.ok(err instanceof ContractMain.OcrQueueError);
  assert.ok(err instanceof Adapter.OcrQueueError);
  assert.equal(err.code, "dedupe_conflict");
});

test("InMemoryOcrQueue (constructed via adapter) throws errors that are instanceof the contract OcrQueueError", async () => {
  // Reach into the running InMemoryOcrQueue surface and provoke a known
  // contract-error path (renewClaim with a malformed claim).
  const q = new Adapter.InMemoryOcrQueue();
  const malformed = {
    job_id: "01jrk8m4q4xv2v8d4d4ymf5xnk",
    job: {
      id: "transport-x",
      submission: { job_id: "01jrk8m4q4xv2v8d4d4ymf5xnk" },
      enqueued_at: "2030-01-01T00:00:00.000Z",
    },
    worker_id: "w",
    claimed_at: "2030-01-01T00:00:00.000Z",
    lease_expires_at: "2030-01-01T00:00:30.000Z",
    receipt: "", // empty → invalid_claim
  };

  await assert.rejects(
    q.renewClaim(malformed),
    (err) =>
      err instanceof ContractMain.OcrQueueError &&
      err instanceof Adapter.OcrQueueError &&
      err.code === "invalid_claim",
    "InMemoryOcrQueue must throw the same class identity that ocr-worker-contract exports",
  );
});
