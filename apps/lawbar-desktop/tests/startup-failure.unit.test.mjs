// WI-07 — a refused database open must reach the litigator.
//
// The WIRING guard lives in `main.test.mjs`, NOT here, and that placement is load-bearing.
// A static import of the module under construction makes the whole FILE die with
// ERR_MODULE_NOT_FOUND against a pre-change baseline — so a wiring case sitting in this
// file could never reach its assertion there, and could never do its two-sided job.
//
// WI-03 built the refusal: it classifies corruption, locking, a foreign file and an
// unopenable path, preserves the suspect bytes and writes a truthful message. None of that
// reached a human. `electron/main.ts` called `getCaseBoxRuntime` outside any try, so every
// refusal threw unhandled inside `whenReady` and the app sat there with no window and no
// explanation. The careful message was constructed and discarded.
//
// Structure mirrors `src/security/fileVaultProbe.ts`, the startup gate that already does
// this correctly: pure decision functions, unit-tested with no Electron runtime, and an
// injected host for the side effects.

import test from "node:test";
import assert from "node:assert/strict";

import {
  describeStartupFailure,
  handleStartupFailure,
  acquireOrExit,
} from "../dist/src/caseBox/startupFailure.js";

/** Every code `openSqliteCaseBoxPersistence` can refuse with. */
const REFUSAL_CODES = [
  "database_corrupt",
  "database_locked",
  "database_not_case_box",
  "database_unavailable",
];

const refusal = (code, message = "underlying diagnostic text") =>
  Object.assign(new Error(message), { code });

function fakeHost() {
  const shown = [];
  const order = [];          // F4: counts alone cannot see quit-before-show, which would
  let quits = 0;             // mean the user never reads the dialog.
  return {
    shown, order,
    quits: () => quits,
    showErrorBox: (t, c) => { order.push("show"); shown.push({ t, c }); },
    quit: () => { order.push("quit"); quits++; },
  };
}

// F3. Per-code EXACT expectations. Asserting only "title is non-empty" let an
// implementation map every code to the locked-database wording and stay green — which would
// tell a litigator whose case file is CORRUPT that "the database was not examined and there
// is no sign anything is wrong with it". That sentence is true for `locked` and
// `unavailable` and is a falsehood for the other two. In a court-facing tool that is the
// defect class, not a wording nit, so the forbidden fragments are as load-bearing as the
// required ones.
const NOT_EXAMINED = "并未被检查";
const EXPECTED = new Map([
  ["database_corrupt",       { must: ["完整性", "备份", ".repair-"], mustNot: [NOT_EXAMINED] }],
  ["database_locked",        { must: ["占用", "关闭", "重试"],        mustNot: [] }],
  ["database_not_case_box",  { must: ["不是", "案件文件"],            mustNot: [NOT_EXAMINED] }],
  ["database_unavailable",   { must: ["路径", "权限"],                mustNot: [] }],
]);

test("WI07-1 every refusal code yields a dialog with a non-empty title and detail", () => {
  for (const code of REFUSAL_CODES) {
    const f = describeStartupFailure(refusal(code));
    assert.ok(f, `${code} must be recognised`);
    assert.ok(f.title.trim().length > 0, `${code} needs a title`);
    assert.ok(f.detail.trim().length > 0, `${code} needs a detail`);
    assert.notEqual(f.title, f.detail, `${code}: a title that repeats the detail is not a title`);
  }
});

test("WI07-1b each code says what is true OF THAT CODE, and not what is false", () => {
  const seen = new Set();
  for (const [code, exp] of EXPECTED) {
    const f = describeStartupFailure(refusal(code, "diagnostic"));
    for (const frag of exp.must) {
      assert.ok(`${f.title}\n${f.detail}`.includes(frag), `${code} must mention "${frag}"`);
    }
    for (const frag of exp.mustNot) {
      assert.ok(!f.detail.includes(frag),
        `${code} must NOT claim "${frag}" — that is true for a locked file and FALSE here`);
    }
    assert.ok(!seen.has(f.title), `${code} reuses another code's title — the codes are not distinguishable`);
    seen.add(f.title);
  }
  assert.equal(seen.size, EXPECTED.size, "every code needs its own title");
});

test("WI07-2 the underlying diagnostic reaches the user, not just a generic phrase", () => {
  // The refusal message names the incident directory holding the preserved copy. If the
  // dialog drops it, the forensic apparatus WI-03 built is unreachable by the person who
  // needs it. This is the opposite of the renderer's safe-message allowlist, deliberately:
  // a native dialog on the user's own machine is where the detail belongs.
  for (const code of REFUSAL_CODES) {
    const f = describeStartupFailure(refusal(code, "MARKER-9f2a preserved at /tmp/x.repair-abc"));
    assert.match(f.detail, /MARKER-9f2a/, `${code} must carry the underlying message through`);
  }
});

test("WI07-3 a LOCKED file tells the user what to do, not merely what happened", () => {
  // The one recoverable case. Every other code means stop; this one means close the other
  // window. A dialog that only reports the fault turns a 5-second fix into a support call.
  const f = describeStartupFailure(refusal("database_locked", "database is locked"));
  assert.match(f.detail, /关闭|重试|retry|close/i, "the locked dialog must name the remedy");
});

test("WI07-4 an unrelated error is NOT swallowed", () => {
  // A bug in our own startup code must keep its stack trace and crash loudly. Turning
  // every throw into a tidy dialog would hide exactly the failures we need to see.
  assert.equal(describeStartupFailure(new Error("TypeError: x is not a function")), null);
  assert.equal(describeStartupFailure(refusal("duplicate_id")), null, "a non-startup code is not a startup failure");
});

test("WI07-5 handleStartupFailure shows exactly one dialog and quits exactly once", () => {
  for (const code of REFUSAL_CODES) {
    const host = fakeHost();
    const handled = handleStartupFailure(refusal(code), host);
    assert.equal(handled, true, `${code} must report itself handled`);
    assert.equal(host.shown.length, 1, `${code}: exactly one dialog`);
    assert.equal(host.quits(), 1, `${code}: exactly one quit`);
    assert.deepEqual(host.order, ["show", "quit"],
      `${code}: the dialog must be shown BEFORE quitting, or the user never reads it`);
  }
});

test("WI07-6 an unhandled error returns false and does NOT quit", () => {
  const host = fakeHost();
  assert.equal(handleStartupFailure(new Error("boom"), host), false);
  assert.equal(host.shown.length, 0, "no dialog for an error we do not own");
  assert.equal(host.quits(), 0, "must not quit — the caller rethrows so the crash is visible");
});

test("WI07-7 malformed inputs are classified, never thrown on", () => {
  // This runs in a catch block during startup. A throw here replaces a readable refusal
  // with an unhandled exception — the exact failure WI-07 exists to remove.
  // Labelled by index, not by String(value): String(Object.create(null)) itself throws
  // "Cannot convert object to primitive value". A null-prototype object is a real shape to
  // defend against precisely because the obvious ways of handling it blow up — which is why
  // the implementation type-checks instead of coercing.
  const BAD = [null, undefined, "a string", 42, {}, { code: 42 }, { code: null },
               Object.create(null), { get code() { throw new Error("hostile getter"); } },
               // Prototype-chain names. With a plain object literal as the lookup table,
               // TITLES["constructor"] answers with a function and a `code in TITLES` test
               // passes — so a crafted code could reach the dialog. The module uses Map
               // precisely to stop this, and that claim needs a test, not a comment.
               { code: "constructor" }, { code: "toString" }, { code: "__proto__" },
               { code: "hasOwnProperty" }, { code: "valueOf" }];
  BAD.forEach((bad, i) => {
    assert.doesNotThrow(() => describeStartupFailure(bad), `BAD[${i}] must not throw`);
    assert.equal(describeStartupFailure(bad), null, `BAD[${i}] is not a refusal`);
  });
});

test("WI07-9 acquireOrExit returns the value untouched on success", () => {
  const host = fakeHost();
  const token = { runtime: true };
  assert.equal(acquireOrExit(() => token, host), token);
  assert.equal(host.shown.length, 0, "a successful open must show nothing");
  assert.equal(host.quits(), 0, "a successful open must not quit");
});

test("WI07-10 acquireOrExit presents a refusal and tells the caller to stop", () => {
  for (const code of REFUSAL_CODES) {
    const host = fakeHost();
    const r = acquireOrExit(() => { throw refusal(code); }, host);
    assert.equal(r, null, `${code}: caller must be told to stop`);
    assert.equal(host.shown.length, 1, `${code}: one dialog`);
    assert.equal(host.quits(), 1, `${code}: one quit`);
  }
});

test("WI07-11 acquireOrExit RETHROWS an error we do not own", () => {
  // The mutation that motivated this: making the caller stop unconditionally, instead of
  // only when the failure was handled, keeps every other test green while turning a bug in
  // our own startup path into a silent quit with no window and no dialog.
  const host = fakeHost();
  const boom = new Error("a bug in our own startup path");
  assert.throws(() => acquireOrExit(() => { throw boom; }, host), /a bug in our own startup path/);
  assert.equal(host.shown.length, 0, "no dialog for an error we do not own");
  assert.equal(host.quits(), 0, "must NOT quit — the crash has to stay visible");
});
