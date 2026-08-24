// Tests for the last-resort crash message.
//
// Written after the owner launched the app and got Electron's default dialog:
//
//     Uncaught Exception:
//     ReferenceError: require is not defined
//     at BrowserWindow.<anonymous> (…/dist/electron/readiness.js:88:28)
//
// The app had no uncaughtException handling at all. For a litigator who is not a developer, that
// text answers none of the question they actually have.
//
// The assertions below are mostly about HONESTY rather than wording. The tempting copy — "an
// unexpected error occurred; your data was not modified" — is a claim this code cannot support,
// because a crash handler does not know what the throw interrupted. A court-facing tool that
// reassures beyond its knowledge is worse than one that prints a stack.

import test from "node:test";
import assert from "node:assert/strict";

import { describeUnexpectedFailure } from "../dist/src/caseBox/unexpectedFailure.js";

const CJK = /[一-鿿]/;
const err = () => new ReferenceError("require is not defined");

test("the message is zh-CN, like every other main-process refusal", () => {
  for (const caseBoxOpened of [true, false]) {
    const r = describeUnexpectedFailure(err(), { caseBoxOpened });
    assert.match(r.title, CJK);
    assert.match(r.detail, CJK);
  }
});

// THE CENTRAL ASSERTION. With the database open, the handler cannot know whether a write was in
// flight. It must say so and must not offer any blanket assurance.
test("with the case box OPEN it refuses to claim the data is unaffected", () => {
  const d = describeUnexpectedFailure(err(), { caseBoxOpened: true }).detail;
  assert.ok(d.includes("已打开案件数据库"), "it must say the database was open");
  assert.ok(d.includes("无法确定"), "it must say the write state is not determinable");
  assert.ok(d.includes("不做保证"), "it must explicitly decline to guarantee");
  assert.equal(
    d.includes("不可能改动"), false,
    "it claimed the data cannot have changed while the database was open — that is not knowable",
  );
});

// The other half: when the database was never opened, the safe statement is TRUE and withholding it
// would be its own failure — leaving the owner worried about nothing.
test("with the case box NEVER opened it states the fact plainly", () => {
  const d = describeUnexpectedFailure(err(), { caseBoxOpened: false }).detail;
  assert.ok(d.includes("尚未打开案件数据库"));
  assert.ok(d.includes("不可能改动"), "when it IS knowable, say it");
  assert.equal(d.includes("无法确定"), false, "no false uncertainty when the answer is known");
});

// The two variants must actually differ. A handler that ignores the flag and prints one message
// would pass every test above that looks at only one branch.
test("the two variants are genuinely different messages", () => {
  assert.notEqual(
    describeUnexpectedFailure(err(), { caseBoxOpened: true }).detail,
    describeUnexpectedFailure(err(), { caseBoxOpened: false }).detail,
  );
});

// Pointing at a real check beats a reassurance. The chain is append-only and hash-linked, and the
// app can walk it — so the uncertain branch names that instead of asking the owner to trust it.
test("the uncertain branch points at the verification the owner can actually run", () => {
  const d = describeUnexpectedFailure(err(), { caseBoxOpened: true }).detail;
  assert.ok(d.includes("审计链"), "it must name the audit chain");
  assert.ok(d.includes("验证审计链"), "it must name the action, not just the concept");
});

// A tool that swallows the cause of its own failure is worse than one that prints a stack: the
// owner may need to hand it to someone.
test("the technical detail is shown, not hidden", () => {
  const d = describeUnexpectedFailure(err(), { caseBoxOpened: false }).detail;
  assert.ok(d.includes("ReferenceError"), "the error type must survive");
  assert.ok(d.includes("require is not defined"), "the message must survive");
  assert.ok(d.includes("技术信息"), "and be labelled, so it is recognisable as such");
});

// The reporter runs inside a crash. A hostile or exotic throw must not produce a second one.
test("a non-Error throw is reported rather than crashing the reporter", () => {
  for (const bad of [null, undefined, 42, "plain string", { code: "x" }, Symbol("s")]) {
    assert.doesNotThrow(() => describeUnexpectedFailure(bad, { caseBoxOpened: false }));
  }
  const hostile = { get message() { throw new Error("nope"); } };
  Object.defineProperty(hostile, "toString", { get() { throw new Error("nope"); } });
  assert.doesNotThrow(
    () => describeUnexpectedFailure(hostile, { caseBoxOpened: true }),
    "a throwing toString must not replace the crash report with a second crash",
  );
});

test("it always says the app stopped, so the window disappearing is explained", () => {
  for (const caseBoxOpened of [true, false]) {
    assert.ok(describeUnexpectedFailure(err(), { caseBoxOpened }).detail.includes("已停止运行"));
  }
});
