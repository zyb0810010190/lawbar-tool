// renderer-audit-labels.test.mjs — audit event-kind humanized labels (WI-U3,
// BATCH-CASEBOX-AUDIT-EVENT-KIND-V2-UI-00). Proves: known event_kind -> humanized label; null/missing
// /unknown -> raw action (action·entity_type fallback); the label is in the accessible row text; the
// label map stays in sync with the contract kinds; existing audit-panel behavior is intact.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CASE_BOX_AUDIT_EVENT_KINDS } from "case-box-contract";
import { mountViewMatter } from "../dist/renderer/screens/viewMatter.js";
import { auditEventLabel, EVENT_KIND_LABELS } from "../dist/renderer/screens/auditEventLabels.js";
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

// --- 1. unit: auditEventLabel ---

test("auditEventLabel: a known event_kind returns the humanized label", () => {
  assert.equal(auditEventLabel({ action: "update", event_kind: "DEADLINE_MET" }), "Deadline marked met");
  assert.equal(auditEventLabel({ action: "update", event_kind: "DEADLINE_MISSED" }), "Deadline marked missed");
  assert.equal(auditEventLabel({ action: "create", event_kind: "DOCKET_ENTRY_PROPOSED" }), "Docket proposal created");
  assert.equal(auditEventLabel({ action: "create", event_kind: "DOCUMENT_REGISTERED" }), "Document registered");
});

test("auditEventLabel: null / missing event_kind falls back to the raw action", () => {
  assert.equal(auditEventLabel({ action: "update" }), "update");
  assert.equal(auditEventLabel({ action: "create", event_kind: undefined }), "create");
  assert.equal(auditEventLabel({ action: "export", event_kind: null }), "export");
});

test("auditEventLabel: an unknown (future) event_kind falls back to the raw action", () => {
  assert.equal(auditEventLabel({ action: "update", event_kind: "SOME_FUTURE_KIND" }), "update");
});

// --- 2. map sync with the contract kinds ---

test("EVENT_KIND_LABELS covers exactly the CASE_BOX_AUDIT_EVENT_KINDS keys", () => {
  const labelKeys = Object.keys(EVENT_KIND_LABELS).sort();
  const contractKeys = Object.keys(CASE_BOX_AUDIT_EVENT_KINDS).sort();
  assert.deepEqual(labelKeys, contractKeys);
  for (const k of contractKeys) {
    assert.equal(typeof EVENT_KIND_LABELS[k], "string");
    assert.ok(EVENT_KIND_LABELS[k].length > 0, `empty label for ${k}`);
  }
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
  assert.deepEqual(labels, ["Deadline marked met", "Deadline marked missed"]);
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
