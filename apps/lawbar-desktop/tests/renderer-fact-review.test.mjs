// Fact REVIEW UI tests (WI-804): per-fact Review / Accept / Reject controls +
// status rendering in the Facts disclosure, consuming casebox:fact:transition.
// Dedicated file (the WI-704 LOC-split rule) — renderer-view-matter.test.mjs is
// at the loc-guardian margin and is NOT touched. Pure-Node; mock document + api.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mountViewMatter } from "../dist/renderer/screens/viewMatter.js";
import { CATALOG } from "../dist/renderer/i18n/catalog.js";
import {
  VALID_ULID,
  MockDoc,
  findByTestId,
  collectText,
  flush,
  makeStubApi,
} from "./_view-matter-dom.mjs";

const FACT_ID = "01jzfact00000000000000000a";

// Local fact-row fixture (the shared harness has no factRow; not edited here).
function factRow(overrides = {}) {
  return {
    id: FACT_ID,
    statement_text: "Defendant filed answer on 2026-06-01.",
    status: "candidate",
    source_type: "lawyer_authored",
    created_at: "2026-06-01T10:30:00Z",
    reviewed_at: null,
    accepted_at: null,
    rejected_at: null,
    rejection_reason: null,
    ...overrides,
  };
}

// makeStubApi (shared harness) predates the transition channel; wrap it here.
function stubWithTransition(impl = {}) {
  return {
    ...makeStubApi(impl),
    transitionFact: impl.transitionFact ?? (async () => ({ ok: true, value: factRow({ status: "reviewed" }) })),
  };
}

async function mountFacts(api) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-facts-summary").dispatchEvent({ type: "click" });
  await flush();
  return root;
}

function oneFact(status, extra = {}) {
  return stubWithTransition({
    listFacts: async () => ({ ok: true, value: { rows: [factRow({ status, ...extra })], next_cursor: null } }),
    ...extra.apiOverrides,
  });
}

test("review: candidate fact shows Review + Reject, NOT Accept; status text + data-status (not color-only)", async () => {
  const root = await mountFacts(oneFact("candidate"));
  assert.ok(findByTestId(root, "view-facts-review-reviewed") !== null, "Review present");
  assert.ok(findByTestId(root, "view-facts-review-rejected") !== null, "Reject present");
  assert.equal(findByTestId(root, "view-facts-review-accepted"), null, "no Accept on candidate");
  const status = findByTestId(root, "view-facts-status");
  assert.equal(status.getAttribute("data-status"), "candidate");
  assert.ok(collectText(status).includes(CATALOG["fact.status.candidate"]), "visible status text present (not color-only)");
});

test("review: reviewed fact shows Accept + Reject, NOT Review", async () => {
  const root = await mountFacts(oneFact("reviewed", { reviewed_at: "2026-06-02T00:00:00Z" }));
  assert.ok(findByTestId(root, "view-facts-review-accepted") !== null);
  assert.ok(findByTestId(root, "view-facts-review-rejected") !== null);
  assert.equal(findByTestId(root, "view-facts-review-reviewed"), null, "no Review on reviewed");
});

test("review: accepted fact shows NO transition controls", async () => {
  const root = await mountFacts(oneFact("accepted", { accepted_at: "2026-06-03T00:00:00Z" }));
  assert.equal(findByTestId(root, "view-facts-review-control"), null);
});

test("review: rejected fact shows NO controls + renders the rejection reason", async () => {
  const root = await mountFacts(oneFact("rejected", { rejected_at: "2026-06-03T00:00:00Z", rejection_reason: "not supported" }));
  assert.equal(findByTestId(root, "view-facts-review-control"), null);
  const reason = findByTestId(root, "view-facts-rejection-reason");
  assert.ok(reason !== null);
  assert.ok(collectText(reason).includes("not supported"));
});

test("review: Review (candidate->reviewed) forwards {to} only, refreshes list in place", async () => {
  let dto;
  let listCalls = 0;
  const api = stubWithTransition({
    listFacts: async () => {
      listCalls++;
      const status = listCalls <= 1 ? "candidate" : "reviewed";
      return { ok: true, value: { rows: [factRow({ status, reviewed_at: status === "reviewed" ? "2026-06-02T00:00:00Z" : null })], next_cursor: null } };
    },
    transitionFact: async (d) => { dto = d; return { ok: true, value: factRow({ status: "reviewed" }) }; },
  });
  const root = await mountFacts(api);
  assert.equal(listCalls, 1);
  findByTestId(root, "view-facts-review-reviewed").dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(dto, { matterId: VALID_ULID, factId: FACT_ID, to: "reviewed" });
  assert.equal("rejection_reason" in dto, false, "no rejection_reason for Review");
  assert.equal(listCalls, 2, "list refreshed in place");
  assert.equal(findByTestId(root, "view-facts-status").getAttribute("data-status"), "reviewed");
});

test("review: Accept (reviewed->accepted) forwards {to} only", async () => {
  let dto;
  const api = stubWithTransition({
    listFacts: async () => ({ ok: true, value: { rows: [factRow({ status: "reviewed", reviewed_at: "2026-06-02T00:00:00Z" })], next_cursor: null } }),
    transitionFact: async (d) => { dto = d; return { ok: true, value: factRow({ status: "accepted" }) }; },
  });
  const root = await mountFacts(api);
  findByTestId(root, "view-facts-review-accepted").dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(dto, { matterId: VALID_ULID, factId: FACT_ID, to: "accepted" });
});

test("review: Reject reveals reason; empty reason -> inline error, transitionFact NOT called", async () => {
  let called = false;
  const api = stubWithTransition({
    listFacts: async () => ({ ok: true, value: { rows: [factRow({ status: "candidate" })], next_cursor: null } }),
    transitionFact: async () => { called = true; return { ok: true, value: {} }; },
  });
  const root = await mountFacts(api);
  findByTestId(root, "view-facts-review-rejected").dispatchEvent({ type: "click" });
  // reason input now revealed + required
  const reason = findByTestId(root, "view-facts-reject-reason");
  assert.equal(reason.hasAttribute("hidden"), false);
  assert.equal(reason.getAttribute("aria-required"), "true");
  // confirm with empty reason
  findByTestId(root, "view-facts-reject-confirm").dispatchEvent({ type: "click" });
  await flush();
  assert.equal(called, false);
  const err = findByTestId(root, "view-facts-review-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
});

test("review: Reject with reason forwards {to:'rejected', rejection_reason}", async () => {
  let dto;
  const api = stubWithTransition({
    listFacts: async () => ({ ok: true, value: { rows: [factRow({ status: "candidate" })], next_cursor: null } }),
    transitionFact: async (d) => { dto = d; return { ok: true, value: factRow({ status: "rejected" }) }; },
  });
  const root = await mountFacts(api);
  findByTestId(root, "view-facts-review-rejected").dispatchEvent({ type: "click" });
  findByTestId(root, "view-facts-reject-reason").value = "contradicted by exhibit B";
  findByTestId(root, "view-facts-reject-confirm").dispatchEvent({ type: "click" });
  await flush();
  assert.deepEqual(dto, { matterId: VALID_ULID, factId: FACT_ID, to: "rejected", rejection_reason: "contradicted by exhibit B" });
});

test("review: backend illegal_transition -> inline role=alert, no list refresh", async () => {
  let listCalls = 0;
  const api = stubWithTransition({
    listFacts: async () => { listCalls++; return { ok: true, value: { rows: [factRow({ status: "candidate" })], next_cursor: null } }; },
    transitionFact: async () => ({ ok: false, error: { kind: "case_box_persistence_error", code: "illegal_transition", message: "candidate cannot transition directly to accepted" } }),
  });
  const root = await mountFacts(api);
  assert.equal(listCalls, 1);
  findByTestId(root, "view-facts-review-reviewed").dispatchEvent({ type: "click" });
  await flush();
  const err = findByTestId(root, "view-facts-review-error");
  assert.ok(err !== null);
  assert.equal(err.getAttribute("role"), "alert");
  assert.equal(collectText(err), CATALOG["error.illegal_transition"]);
  assert.equal(listCalls, 1, "list NOT refreshed on error");
});

// Note: the post-transition refresh reuses the WI-701 listContainer + loadGen/
// isCurrent stale-load guard verbatim (renderFactsDisclosure), which is already
// proven by renderer-fact-write.test.mjs ("a superseded (stale) load cannot mutate
// the refreshed list"). WI-804 adds no new stale-prone load path, so that coverage
// applies unchanged — a separate contrived stale test here would not exercise a
// genuine supersession and is intentionally omitted.
