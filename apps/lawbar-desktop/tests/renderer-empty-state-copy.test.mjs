// R3-FUP-2 — empty-state and failure copy, standardised where standardising is right.
//
// WHAT THE SURVEY ACTUALLY FOUND, which is not what the residual's title suggests. Failure copy was
// already consistent: 13 of 15 keys follow 无法X，请重试。 Only `viewT3.export.failed` broke the form
// (导出失败 rather than 无法导出), and `audit.verify.failed` differs correctly because it reports a
// FINDING about the chain rather than a failure to act. i18n parity was already complete — zero
// empty-state nodes render without a catalog key.
//
// The real inconsistency was not wording. It was HELPFULNESS. Two structures coexisted:
//
//   title + next step   matters list, links, claim tracks
//   bare statement      documents, deadlines, facts, T3, audit
//
// Three screens told the owner what to do; five just said nothing was there.
//
// THE RULE APPLIED, and it is the reason this file exists rather than a blanket sweep: a next-step
// line is added ONLY where that same screen offers the affordance it names. Documents, deadlines and
// facts each have an add control, so their hints point at a real button — and the deadline hint says
// 「提议期限」 because that is what its control is actually labelled, not 「添加」 which was the first
// draft and named nothing.
//
// T3 AND AUDIT KEEP THEIR BARE STATEMENTS, DELIBERATELY. Both show DERIVED content: the T3 catalogue
// lists adopted evidence, the audit list shows events the system recorded. Neither can be added to
// from its own screen, and neither has an add control. Telling the owner to add something there
// would be the same defect as 请重试 on a screen with no retry — copy promising an action the UI
// cannot perform. The assertions below pin that, so a future "standardise the empty states" pass
// cannot quietly make all five uniform and call it an improvement.

import test from "node:test";
import assert from "node:assert/strict";

import { CATALOG } from "../dist/renderer/i18n/catalog.js";

// MARK: - Failure copy shares one form

test("every actionable failure string uses the 无法…请重试 form", () => {
  const failures = Object.entries(CATALOG).filter(
    ([k]) => /\.(load\.)?failed$/.test(k) && k !== "audit.verify.failed",
  );
  assert.ok(failures.length >= 14, `expected the failure family; found ${failures.length}`);
  for (const [k, v] of failures) {
    assert.match(v, /^无法.+，请重试。$/, `${k} breaks the shared failure form: ${v}`);
  }
});

// The one that is correctly different, pinned so a later tidy-up does not "fix" it into the form
// above. It reports a finding about the chain, not an operation that failed.
test("audit.verify.failed is a FINDING, not a failure-to-act, and keeps its own shape", () => {
  assert.match(CATALOG["audit.verify.failed"], /^链不一致/);
  assert.doesNotMatch(CATALOG["audit.verify.failed"], /请重试/,
    "a chain-inconsistency finding must not invite a retry as though it were a transport failure");
});

// MARK: - Empty states: one vocabulary

test("empty states that scope to the matter say 本案, not 本案件", () => {
  for (const [k, v] of Object.entries(CATALOG)) {
    if (!/empty/i.test(k) || typeof v !== "string") continue;
    assert.equal(v.includes("本案件"), false,
      `${k} uses 本案件 while deadlines, facts and T3 use 本案: ${v}`);
  }
});

// MARK: - A hint is added only where the screen can honour it

const HINTED = ["document.list.emptyHint", "deadline.emptyHint", "fact.emptyHint"];

test("the three screens with an add control each carry a next-step hint", () => {
  for (const k of HINTED) {
    assert.equal(typeof CATALOG[k], "string", `${k} is missing`);
    assert.ok(CATALOG[k].length > 0, `${k} is empty`);
    assert.match(CATALOG[k], /[一-鿿]/, `${k} must be zh-CN`);
  }
});

test("each hint names a control that really exists on that screen", () => {
  // The labels are read from the catalog rather than hardcoded here, so renaming a button breaks
  // this test instead of silently leaving a hint pointing at a control that no longer exists.
  assert.ok(
    CATALOG["document.list.emptyHint"].includes(CATALOG["document.add.button"]),
    `the documents hint must name 「${CATALOG["document.add.button"]}」`,
  );
  assert.ok(
    CATALOG["deadline.emptyHint"].includes(CATALOG["deadline.propose"]),
    `the deadline hint must name 「${CATALOG["deadline.propose"]}」 — an earlier draft said 添加, ` +
      "which is not what that control is called",
  );
  assert.ok(
    CATALOG["fact.emptyHint"].includes(CATALOG["fact.addFact"]),
    `the facts hint must name 「${CATALOG["fact.addFact"]}」`,
  );
});

// MARK: - And NOT added where the screen cannot honour it

test("T3 and audit keep bare empty states — their content is derived, not added", () => {
  for (const k of ["viewT3.emptyHint", "audit.chainHead.emptyHint"]) {
    assert.equal(CATALOG[k], undefined,
      `${k} exists. Neither screen has an add control: the T3 catalogue lists adopted evidence and ` +
        "the audit list shows recorded events. A hint there would promise an action the UI cannot " +
        "perform, which is the 请重试-with-no-retry defect in a different costume.");
  }
});

test("the bare empty states still say plainly that there is nothing, and stay zh-CN", () => {
  for (const k of ["viewT3.empty", "audit.chainHead.empty"]) {
    assert.match(CATALOG[k], /暂无/, `${k} must still state the emptiness plainly`);
    assert.match(CATALOG[k], /[一-鿿]/);
  }
});
