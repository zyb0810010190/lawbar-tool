// R3-FUP-1 — a transport throw on a read path must surface, not hang.
//
// WHY THIS MATTERS NOW. These screens handle a returned ERROR ENVELOPE correctly: `if (!env.ok)`
// renders a zh-CN alert. What they did not handle is the await itself THROWING — a preload or IPC
// transport failure, which rejects rather than resolving `{ok:false}`. The load function is invoked
// as `void load(...)`, so the rejection is swallowed and the "loading" placeholder stays on screen
// forever. No error, no retry, no explanation.
//
// The readiness report classified this as deferred post-v1 polish — "degrades only to a stuck
// spinner today". That assessment was made while the app could not be used for real work at all.
// FileVault was enabled on 2026-08-29, the readiness gate began passing, and a practising litigator
// may now rely on this. A stuck spinner stopped being cosmetic at that moment.
//
// `viewMatterAudit` is the sharpest case and is why this file leads with it. It is the audit-chain
// viewer — the surface where the owner checks the tamper-evidence the entire product claim rests on.
// A verification surface that silently fails to display its own state creates ambiguity at exactly
// the point where ambiguity is most damaging. "Relaunch and try again" is a fine answer for a
// hobby UI; it is not one for the screen a court-facing claim is checked from.
//
// This is an AVAILABILITY and DIAGNOSABILITY defect, not an integrity one — no data is lost and the
// persisted state is untouched. Saying so plainly matters, because overstating it would be its own
// kind of false claim. But for this screen, availability and diagnosability ARE part of the claim.
//
// The fix mirrors `viewMatterLinks`, which already does this correctly and is the exemplar the
// readiness report named.

import { test } from "node:test";
import assert from "node:assert/strict";

import { mountViewMatter } from "../dist/renderer/screens/viewMatter.js";
import { renderDocketProposalsSection } from "../dist/renderer/screens/viewMatterDocketProposals.js";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";
import {
  MockDoc,
  makeStubApi,
  findByTestId,
  findAllByTestId,
  collectText,
  flush,
  VALID_ULID,
  auditEvent,
  SAMPLE_HASH,
  EVENT_ULID,
} from "./_view-matter-dom.mjs";

// makeStubApi's DEFAULT chainHead reports count: 0, and loadChainHead short-circuits to the empty
// state before it ever loads the event list or appends the verify button. Tests that need those to
// exist must therefore supply a NON-EMPTY chain head. An earlier draft of this file omitted that and
// its assertions failed while never reaching the code under test — a test-setup error that looked
// exactly like a product defect.
const NON_EMPTY_CHAIN = async () => ({
  ok: true,
  value: { headHash: SAMPLE_HASH, lastEventId: EVENT_ULID, count: 3 },
});

const BOOM = () => {
  throw new Error("preload blew up");
};

/** Mount the matter view, then open the lazily-loaded audit-chain disclosure. */
async function mountAndOpenChain(apiOverrides) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi(apiOverrides);
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-chain-summary").dispatchEvent({ type: "click" });
  await flush();
  return root;
}

// MARK: - The audit chain head

test("audit chain: a THROWING chainHead surfaces an error instead of hanging on loading", async () => {
  const root = await mountAndOpenChain({ chainHead: async () => BOOM() });

  const err = findByTestId(root, "view-chain-error");
  assert.ok(err !== null, "a transport throw left the chain disclosure with no error element");
  assert.equal(err.getAttribute("role"), "alert", "the failure must be announced, not merely printed");

  const text = collectText(err);
  assert.ok(text.trim().length > 0, "the error element rendered no text");
  assert.match(text, /[一-鿿]/, "the message must be zh-CN, like every other user-facing refusal");
  assert.doesNotMatch(
    text,
    /preload blew up|Error:|undefined|null/,
    `raw transport detail must not reach the lawyer; got: ${text}`,
  );
});

test("audit chain: the loading placeholder is REMOVED when the transport throws", async () => {
  const root = await mountAndOpenChain({ chainHead: async () => BOOM() });
  const body = findByTestId(root, "view-chain-body");
  const text = collectText(body);
  // Assert against the CATALOG VALUE, not a hand-written regex. The first version of this test used
  // /载入|加载中|loading/i, which does not match the real copy 正在加载审计链头… at all — so it passed
  // whether or not the placeholder was removed. A test for the stuck spinner that could not detect
  // the stuck spinner.
  const LOADING = CATALOG["audit.chainHead.loading"];
  assert.ok(LOADING && LOADING.length > 0, "precondition: the loading copy exists in the catalog");
  assert.equal(
    text.includes(LOADING), false,
    `the loading placeholder survived a failed load — this is the stuck spinner; got: ${text}`,
  );
  assert.ok(text.includes(CATALOG["audit.chainHead.failed"]), "the failure copy must replace it");
});

// The returned-envelope path already worked. Asserted so the fix cannot regress it while adding
// the throw guard — two different failures that must both stay reported.
test("audit chain: a returned error envelope still surfaces (unchanged behaviour)", async () => {
  const root = await mountAndOpenChain({
    chainHead: async () => ({ ok: false, error: { code: "internal" } }),
  });
  const err = findByTestId(root, "view-chain-error");
  assert.ok(err !== null, "the pre-existing envelope-error path must keep working");
  assert.match(collectText(err), /[一-鿿]/);
});

// The control. A guard that also fired on success would trade a hang for a broken screen.
test("audit chain: a healthy load still renders, with no error element", async () => {
  const root = await mountAndOpenChain({});
  assert.equal(
    findByTestId(root, "view-chain-error"),
    null,
    "the throw guard must not fire on a successful load",
  );
});

// MARK: - The audit event list

test("audit events: a THROWING listAuditEvents surfaces an error instead of hanging", async () => {
  const root = await mountAndOpenChain({ chainHead: NON_EMPTY_CHAIN, listAuditEvents: async () => BOOM() });
  const err = findByTestId(root, "view-audit-error");
  assert.ok(err !== null, "a throwing audit-event list left no error element");
  assert.equal(err.getAttribute("role"), "alert");
  // Exact copy, not "some Chinese text" — the weaker form would accept any string at all.
  assert.equal(collectText(err).trim(), CATALOG["audit.events.failed"].trim());
  const body = collectText(findByTestId(root, "view-chain-body"));
  assert.equal(body.includes("preload blew up"), false, "the thrown message must not reach the lawyer");
});

// M1 — a failed page must not leave its alert on screen once a retry succeeds. Driven through the
// REAL retry path: Show-more, which only exists when a first page returned a cursor. A first-page
// failure has no retry control at all — see the note on that in the commit; this test deliberately
// covers the case that IS retryable rather than pretending the other one is.
//
// The first draft of this test clicked the chain summary and then asserted nothing at all. It passed
// unconditionally. Recording that here because it is the third vacuous test this one file produced,
// and the pattern — assert a precondition, perform an action, forget the assertion — is easy to miss
// in review precisely because the test body looks busy.
test("audit events: a stale pagination error is cleared once a retry succeeds", async () => {
  let calls = 0;
  const page = (cursor) => ({
    ok: true,
    value: { rows: [auditEvent({ action: "update", entity_type: "deadline" })], next_cursor: cursor },
  });
  const root = await mountAndOpenChain({
    chainHead: NON_EMPTY_CHAIN,
    listAuditEvents: async () => {
      calls += 1;
      if (calls === 1) return page("cursor-1"); // first page succeeds, so Show-more exists
      if (calls === 2) return BOOM();           // the retryable failure
      return page(null);                        // the retry succeeds
    },
  });

  const more = findByTestId(root, "view-audit-more");
  assert.ok(more !== null, "precondition: a cursor must produce a Show-more control");

  more.dispatchEvent({ type: "click" });
  await flush();
  assert.ok(findByTestId(root, "view-audit-error") !== null, "the failed page must report the failure");

  findByTestId(root, "view-audit-more").dispatchEvent({ type: "click" });
  await flush();

  // THE POINT. Before the fix the alert stayed, so the screen said "could not load" beside the rows
  // that had just loaded — the UI contradicting itself.
  assert.equal(
    findByTestId(root, "view-audit-error"), null,
    "a successful retry must retire the previous failure notice, not leave it beside the new rows",
  );
});

// Two consecutive pagination failures must not STACK their alerts. Found by mutation: removing the
// catch-path `pageError?.remove()` survived the test above, because that test fails exactly once and
// so never exercises the "a previous error is already on screen" case. The gap was in the test, not
// the fix — but an unexercised line is an unproven line.
test("audit events: consecutive pagination failures do not stack alerts", async () => {
  let calls = 0;
  const root = await mountAndOpenChain({
    chainHead: NON_EMPTY_CHAIN,
    listAuditEvents: async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: true, value: { rows: [auditEvent({ action: "update", entity_type: "deadline" })], next_cursor: "c1" } };
      }
      return BOOM(); // every retry also fails
    },
  });

  findByTestId(root, "view-audit-more").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(findAllByTestId(root, "view-audit-error").length, 1, "precondition: one failure, one alert");

  const more = findByTestId(root, "view-audit-more");
  if (more !== null) {
    more.dispatchEvent({ type: "click" });
    await flush();
    assert.equal(
      findAllByTestId(root, "view-audit-error").length, 1,
      "a second failure must REPLACE the first alert, not stack a second one beside it",
    );
  }
});

// MARK: - The verify action, which is the point of the screen

test("audit verify: a THROWING verifyChain reports failure rather than leaving the result blank", async () => {
  const root = await mountAndOpenChain({ chainHead: NON_EMPTY_CHAIN, verifyChain: async () => BOOM() });
  findByTestId(root, "view-audit-verify-btn").dispatchEvent({ type: "click" });
  await flush();

  const result = findByTestId(root, "view-audit-verify-result");
  assert.ok(result !== null, "the verify result element is missing");
  const text = collectText(result);
  assert.ok(
    text.trim().length > 0,
    "verify reported nothing after a transport throw — silence is indistinguishable from 'still working'",
  );
  assert.doesNotMatch(text, /preload blew up|Error:/, "raw transport detail must not reach the lawyer");

  // THE ASSERTION THIS FILE EXISTS FOR. An earlier version checked only "non-empty zh-CN with no raw
  // error" — which the FALSE string "链不一致：第 1 条事件——…" satisfies completely. The test written to
  // prevent a false chain-broken claim could not detect a false chain-broken claim.
  assert.equal(text.trim(), CATALOG["audit.verify.unavailable"].trim(),
    `verify must report the transport-unavailable copy verbatim; got: ${text}`);
  assert.equal(text.includes("链不一致"), false,
    "a transport failure must NEVER render the chain-inconsistent claim — that is a false statement " +
    "about tamper-evidence, and is worse than the silence it replaced");
  assert.equal(text.includes(CATALOG["audit.verify.ok"].slice(0, 4)), false,
    "and it must not render the chain-intact claim either");
});

// MARK: - The same defect on the other two screens
//
// viewMatterDocuments and viewMatterDocketProposals carried the IDENTICAL partial guard: a
// `try { await } finally { pageLoading = false }` that tidied the re-entrancy flag and caught
// nothing. Three screens, one shape. A `finally` that resets state reads as handled, which is
// probably why all three survived review.

async function mountView(apiOverrides, openSummaryTestId = null) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  await mountViewMatter(root, { api: makeStubApi(apiOverrides), navigate: () => {}, doc }, VALID_ULID);
  await flush();
  // The documents section is a LAZY <details> like the audit chain — nothing inside it loads until
  // the summary is clicked. The docket-proposals section is NOT lazy and loads on mount. Getting
  // this wrong makes a test fail while never reaching the code it claims to cover.
  if (openSummaryTestId !== null) {
    findByTestId(root, openSummaryTestId).dispatchEvent({ type: "click" });
    await flush();
  }
  return root;
}

test("documents: a THROWING listDocuments surfaces the exact failure copy, not a hang", async () => {
  const root = await mountView({ listDocuments: async () => BOOM() }, "view-docs-summary");
  const err = findByTestId(root, "view-docs-error");
  assert.ok(err !== null, "a throwing document list left no error element");
  assert.equal(err.getAttribute("role"), "alert");
  // EXACT copy. "some zh-CN string" is the assertion that made three earlier tests in this file
  // worthless — it accepts any text at all, including a wrong or dangerous one.
  assert.equal(collectText(err).trim(), CATALOG["documents.load.failed"].trim());
});

test("documents: a healthy load renders no error (the guard must not fire on success)", async () => {
  const root = await mountView(
    { listDocuments: async () => ({ ok: true, value: { rows: [], next_cursor: null } }) },
    "view-docs-summary",
  );
  assert.equal(findByTestId(root, "view-docs-error"), null);
});

// The docket-proposals section is NOT mounted by mountViewMatter — it is rendered inside the
// deadlines section. Mount it directly, which is what the existing docket tests do, rather than
// driving two disclosures to reach it.
async function mountDocket(listDocketEntries) {
  const doc = new MockDoc();
  const section = renderDocketProposalsSection(doc, makeStubApi({ listDocketEntries }), VALID_ULID);
  await section.load();
  await flush();
  return section.element;
}

test("docket proposals: a THROWING listDocketEntries surfaces the exact failure copy", async () => {
  const root = await mountDocket(async () => BOOM());
  const err = findByTestId(root, "view-docket-proposals-error");
  assert.ok(err !== null, "a throwing docket-proposal list left no error element");
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err).trim(), CATALOG["docket.proposals.load.failed"].trim());
});

// The section is HIDDEN when there are no proposals. A failure must REVEAL it — otherwise the alert
// is announced into a hidden container and the lawyer sees nothing, which is the same silence the
// fix set out to remove.
test("docket proposals: a failure REVEALS the section rather than announcing into a hidden one", async () => {
  const root = await mountDocket(async () => BOOM());
  // Assert the element exists FIRST. Without this the walk below never runs, `hidden` stays false,
  // and the test passes on an absent error — the fourth vacuous test this file produced.
  const err = findByTestId(root, "view-docket-proposals-error");
  assert.ok(err !== null, "precondition: the failure must render an error element at all");
  assert.equal(root.getAttribute("hidden") ?? null, null,
    "the failure was announced inside a hidden section — invisible to the lawyer");
});

test("docket proposals: a healthy empty load stays hidden and renders no error", async () => {
  const root = await mountDocket(async () => ({ ok: true, value: { rows: [], next_cursor: null } }));
  assert.equal(findByTestId(root, "view-docket-proposals-error"), null);
});

// MARK: - The two the first sweep MISSED
//
// The commit that fixed viewMatterAudit / viewMatterDocuments / viewMatterDocketProposals claimed
// "the same partial guard was on all three screens". That was wrong: a correct sweep found five.
// The first sweep used a one-directional scan that could only see lines BEFORE each await, so it
// could never see a `catch` that comes after — it reported the already-fixed sites as broken and
// missed these two entirely. A broken checker producing a confident list is the same failure this
// whole file is about.

test("deadlines: a THROWING listDeadlines surfaces the exact failure copy, not a hang", async () => {
  const root = await mountView({ listDeadlines: async () => BOOM() }, "view-deadlines-summary");
  const err = findByTestId(root, "view-deadlines-error");
  assert.ok(err !== null, "a throwing deadline list left no error element");
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err).trim(), CATALOG["deadlines.load.failed"].trim());
});

test("deadlines: a healthy load renders no error", async () => {
  const root = await mountView(
    { listDeadlines: async () => ({ ok: true, value: { rows: [], next_cursor: null } }) },
    "view-deadlines-summary",
  );
  assert.equal(findByTestId(root, "view-deadlines-error"), null);
});

test("facts: a THROWING listFacts surfaces the exact failure copy, not a hang", async () => {
  const root = await mountView({ listFacts: async () => BOOM() }, "view-facts-summary");
  const err = findByTestId(root, "view-facts-error");
  assert.ok(err !== null, "a throwing fact list left no error element");
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err).trim(), CATALOG["facts.load.failed"].trim());
});

test("facts: a healthy load renders no error", async () => {
  const root = await mountView(
    { listFacts: async () => ({ ok: true, value: { rows: [], next_cursor: null } }) },
    "view-facts-summary",
  );
  assert.equal(findByTestId(root, "view-facts-error"), null);
});
