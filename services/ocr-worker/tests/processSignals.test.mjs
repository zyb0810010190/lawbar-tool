// Step 10E — installShutdownHandlers tests.
//
// Drives a fake EventEmitter posing as `process`. Asserts:
//  - SIGINT and SIGTERM both flip the AbortSignal exactly once
//  - second signal invokes onSecondSignal
//  - uninstall() removes listeners cleanly

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { installShutdownHandlers } from "../dist/index.js";

function fakeProcess() {
  const ee = new EventEmitter();
  return ee;
}

test("SIGINT triggers abort once", () => {
  const proc = fakeProcess();
  const { signal, uninstall } = installShutdownHandlers({ process: proc });
  assert.equal(signal.aborted, false);
  proc.emit("SIGINT");
  assert.equal(signal.aborted, true);
  uninstall();
});

test("SIGTERM triggers abort", () => {
  const proc = fakeProcess();
  const { signal, uninstall } = installShutdownHandlers({ process: proc });
  proc.emit("SIGTERM");
  assert.equal(signal.aborted, true);
  uninstall();
});

test("second signal invokes onSecondSignal", () => {
  const proc = fakeProcess();
  const seen = [];
  const { uninstall } = installShutdownHandlers({
    process: proc,
    onSecondSignal: (sig) => seen.push(sig),
  });
  proc.emit("SIGINT");
  proc.emit("SIGINT");
  proc.emit("SIGTERM");
  assert.deepEqual(seen, ["SIGINT", "SIGTERM"]);
  uninstall();
});

test("uninstall removes listeners on every configured signal", () => {
  const proc = fakeProcess();
  const { signal, uninstall } = installShutdownHandlers({
    process: proc,
    signals: ["SIGINT", "SIGTERM", "SIGHUP"],
  });
  assert.equal(proc.listenerCount("SIGINT"), 1);
  assert.equal(proc.listenerCount("SIGTERM"), 1);
  assert.equal(proc.listenerCount("SIGHUP"), 1);
  uninstall();
  assert.equal(proc.listenerCount("SIGINT"), 0);
  assert.equal(proc.listenerCount("SIGTERM"), 0);
  assert.equal(proc.listenerCount("SIGHUP"), 0);
  // Post-uninstall signals do not flip the abort flag.
  proc.emit("SIGINT");
  assert.equal(signal.aborted, false);
});

test("custom signals: SIGHUP also triggers abort", () => {
  const proc = fakeProcess();
  const { signal, uninstall } = installShutdownHandlers({
    process: proc,
    signals: ["SIGHUP"],
  });
  proc.emit("SIGHUP");
  assert.equal(signal.aborted, true);
  uninstall();
});

test("default signals are SIGINT + SIGTERM", () => {
  const proc = fakeProcess();
  const { uninstall } = installShutdownHandlers({ process: proc });
  assert.equal(proc.listenerCount("SIGINT"), 1);
  assert.equal(proc.listenerCount("SIGTERM"), 1);
  assert.equal(proc.listenerCount("SIGHUP"), 0);
  uninstall();
});

test("onSecondSignal not called on the first signal", () => {
  const proc = fakeProcess();
  let calls = 0;
  const { uninstall } = installShutdownHandlers({
    process: proc,
    onSecondSignal: () => {
      calls++;
    },
  });
  proc.emit("SIGINT");
  assert.equal(calls, 0);
  uninstall();
});
