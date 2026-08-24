// renderer-audit-labels.test.mjs — audit event-kind humanized labels (WI-U3,
// BATCH-CASEBOX-AUDIT-EVENT-KIND-V2-UI-00). Proves: known event_kind -> humanized label; null/missing
// /unknown -> raw action (action·entity_type fallback); the label is in the accessible row text; the
// label map stays in sync with the contract kinds; existing audit-panel behavior is intact.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CASE_BOX_AUDIT_EVENT_KINDS } from "case-box-contract";
import { mountViewMatter } from "../dist/renderer/screens/viewMatter.js";
import { isKnownAuditEventKind } from "../dist/renderer/i18n/labels.js";
// zh-CN migration: the rendered audit row resolves its label via the eventKind.* catalog
// (renderer/i18n/labels.ts eventKindLabel), so the integration assertion below derives its
// expected text from the live catalog rather than a hard-coded literal.
import { CATALOG } from "../dist/renderer/i18n/catalog.js";
import {
  MockDoc,
  makeStubApi,
  auditEvent,
  findByTestId,
  findAllByTestId,
  collectText,
  flush,
  VALID_ULID,
  SAMPLE_HASH,
  EVENT_ULID,
} from "./_view-matter-dom.mjs";

// --- 1. unit: isKnownAuditEventKind membership guard ---
// (Supersedes the former English EVENT_KIND_LABELS map / auditEventLabel helper, deleted in
// WI-DESKTOP-I18N-DEAD-LABELS-03. The humanized-label path is exercised end-to-end in section 3,
// which asserts the rendered zh-CN catalog label; the raw-action fallback is asserted there too.)

test("isKnownAuditEventKind: true for a known contract event_kind", () => {
  assert.equal(isKnownAuditEventKind("DEADLINE_MET"), true);
  assert.equal(isKnownAuditEventKind("DOCUMENT_REGISTERED"), true);
  assert.equal(isKnownAuditEventKind("DOCKET_ENTRY_PROPOSED"), true);
});

test("isKnownAuditEventKind: false for an unknown / future event_kind", () => {
  assert.equal(isKnownAuditEventKind("SOME_FUTURE_KIND"), false);
  assert.equal(isKnownAuditEventKind(""), false);
});

// --- 2. membership set stays in sync with the contract kinds ---

test("isKnownAuditEventKind accepts EXACTLY the CASE_BOX_AUDIT_EVENT_KINDS keys", () => {
  const contractKeys = Object.keys(CASE_BOX_AUDIT_EVENT_KINDS);
  for (const k of contractKeys) {
    assert.equal(isKnownAuditEventKind(k), true, `known kind ${k} must be accepted`);
  }
  // A value that is not a contract kind must be rejected (no over-broad membership).
  assert.equal(isKnownAuditEventKind("NOT_A_REAL_KIND"), false);
});

// --- 3. integration: the row renders the label / fallback in the accessible action span ---

async function mountAuditRows(rows) {
  const doc = new MockDoc();
  const root = doc.createElement("main");
  const api = makeStubApi({
    chainHead: async () => ({ ok: true, value: { headHash: SAMPLE_HASH, lastEventId: EVENT_ULID, count: rows.length } }),
    listAuditEvents: async () => ({ ok: true, value: { rows, next_cursor: null } }),
  });
  await mountViewMatter(root, { api, navigate: () => {}, doc }, VALID_ULID);
  findByTestId(root, "view-chain-summary").dispatchEvent({ type: "click" });
  await flush();
  return root;
}

test("audit row: a known event_kind renders the humanized label in view-audit-action", async () => {
  const root = await mountAuditRows([
    auditEvent({ action: "update", entity_type: "deadline", event_kind: "DEADLINE_MET" }),
    auditEvent({ action: "update", entity_type: "deadline", event_kind: "DEADLINE_MISSED" }),
  ]);
  const labels = findAllByTestId(root, "view-audit-action").map(collectText);
  assert.deepEqual(labels, [
    CATALOG["eventKind.DEADLINE_MET"],
    CATALOG["eventKind.DEADLINE_MISSED"],
  ]);
});

test("audit row: a legacy/null event_kind falls back to the raw action (action·entity_type)", async () => {
  const root = await mountAuditRows([auditEvent({ action: "update", entity_type: "deadline" })]); // no event_kind
  assert.equal(collectText(findByTestId(root, "view-audit-action")), "update");
  // the entity detail still supplies the "· entity_type" half.
  assert.equal(findAllByTestId(root, "view-audit-event").length, 1);
});

test("audit row: an unknown event_kind falls back to the raw action", async () => {
  const root = await mountAuditRows([auditEvent({ action: "create", entity_type: "matter", event_kind: "FUTURE_KIND_X" })]);
  assert.equal(collectText(findByTestId(root, "view-audit-action")), "create");
});
