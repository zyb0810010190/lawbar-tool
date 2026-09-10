// mapThrownError (review finding, 2026-09-10): properties of a thrown object are read ONCE.
//
// Recognition of a persistence error thrown by a second loaded copy of the package (name + a known
// code) is legitimate; what must not happen is a getter answering one value to the check and
// another to the envelope, because the second would cross IPC unchecked. Also pinned: a genuine
// foreign-copy error still maps to its code with the STATIC message, and an unknown code maps to
// not_implemented.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mapThrownError } from "../dist/src/caseBox/errorMap.js";

const quiet = () => { const orig = console.error; console.error = () => {}; return () => { console.error = orig; }; };

test("a getter that changes its answer between the check and the envelope cannot smuggle a second value across", () => {
  const restore = quiet();
  try {
    let reads = 0;
    const err = { name: "CaseBoxPersistenceError", message: "x", get code() { reads += 1; return reads === 1 ? "illegal_transition" : "/Users/someone/client"; } };
    const env = mapThrownError(err, { channel: "t" });
    assert.equal(env.code, "illegal_transition");
    assert.equal(/\/Users\//.test(JSON.stringify(env)), false, "no second answer reaches the envelope");
  } finally { restore(); }
});

test("a foreign-copy CaseBoxPersistenceError maps to its code with the static message, never the thrown text", () => {
  const restore = quiet();
  try {
    const env = mapThrownError({ name: "CaseBoxPersistenceError", code: "illegal_transition", message: "cannot transition from terminal state at /Volumes/X" }, { channel: "t" });
    assert.equal(env.code, "illegal_transition");
    assert.equal(env.message.includes("/Volumes"), false);
  } finally { restore(); }
});

test("an unknown code, a wrong name, or a throwing getter all map to not_implemented", () => {
  const restore = quiet();
  try {
    for (const err of [
      { name: "CaseBoxPersistenceError", code: "made_up", message: "m" },
      { name: "SomethingElse", code: "illegal_transition", message: "m" },
      { name: "CaseBoxPersistenceError", message: "m", get code() { throw new Error("boom"); } },
      new Error("plain"),
    ]) {
      assert.equal(mapThrownError(err, { channel: "t" }).code, "not_implemented");
    }
  } finally { restore(); }
});
