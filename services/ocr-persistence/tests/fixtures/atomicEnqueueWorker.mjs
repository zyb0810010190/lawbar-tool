// Step 10K — worker fixture for true cross-thread contention test.
//
// Protocol with parent (atomicEnqueueWorker contract):
//   1. Worker opens its persistence + queue handles, then posts
//      `{ phase: "ready" }`.
//   2. Worker awaits a `{ phase: "go" }` message from the parent.
//      The parent only sends "go" once BOTH workers have reported
//      ready, so the two workers race their `BEGIN IMMEDIATE`s within
//      the same microsecond window.
//   3. Worker calls `persistence.enqueueNewOcrJob(sub, queue)`. On
//      success it posts `{ phase: "result", ok: true, deduped, job_id }`;
//      on failure it posts `{ phase: "result", ok: false, name, code, message }`.
//   4. Worker closes its DB handles BEFORE posting the result so the
//      parent's post-test cleanup cannot race a still-open writer.
//   5. Worker exits naturally after the result message; the parent
//      observes `exit` to confirm the file lock is released before
//      asserting on final state.

import { workerData, parentPort } from "node:worker_threads";

import {
  openSqliteOcrPersistence,
  openSqliteOcrQueue,
} from "../../dist/index.js";

const { path, sub } = workerData;

const { persistence, db } = openSqliteOcrPersistence({ path });
const { queue, db: qDb } = openSqliteOcrQueue({ path });
void qDb;

parentPort.postMessage({ phase: "ready" });

await new Promise((resolve, reject) => {
  parentPort.once("message", (msg) => {
    if (msg && msg.phase === "go") resolve();
    else reject(new Error(`unexpected message in worker: ${JSON.stringify(msg)}`));
  });
});

let payload;
try {
  const result = await persistence.enqueueNewOcrJob(sub, queue);
  payload = {
    phase: "result",
    ok: true,
    deduped: result.enqueueResult.deduped,
    job_id: result.job.job_id,
  };
} catch (err) {
  payload = {
    phase: "result",
    ok: false,
    name: err?.name ?? "Error",
    code: err?.code,
    message: err?.message ?? String(err),
  };
}

// Close handles BEFORE the parent observes the result so post-test
// cleanup (rmSync, second persistence open) cannot race an active
// writer connection.
try {
  queue.close();
} catch {
  // already closed
}
try {
  db.close();
} catch {
  // already closed
}

parentPort.postMessage(payload);
