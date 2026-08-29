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
import {
  MockDoc,
  makeStubApi,
  findByTestId,
  collectText,
  flush,
  VALID_ULID,
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
  // The precise failure this file exists to prevent: the placeholder outliving the request.
  assert.doesNotMatch(
    text,
    /载入|加载中|loading/i,
    `the loading placeholder survived a failed load — this is the stuck spinner; got: ${text}`,
  );
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
  assert.match(collectText(err), /[一-鿿]/);
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
  assert.match(text, /[一-鿿]/, "the verify failure must be readable zh-CN");
  assert.doesNotMatch(text, /preload blew up|Error:/, "raw transport detail must not reach the lawyer");
});
