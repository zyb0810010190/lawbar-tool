// renderer-audit-labels.test.mjs — audit event-kind membership guard (WI-U3,
// BATCH-CASEBOX-AUDIT-EVENT-KIND-V2-UI-00). Proves: isKnownAuditEventKind is true for a known
// contract event_kind and false for an unknown / future one; the membership set stays in sync with
// the CASE_BOX_AUDIT_EVENT_KINDS keys. (The humanized zh-CN label rendering is covered exhaustively
// by renderer-i18n.test.mjs.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { CASE_BOX_AUDIT_EVENT_KINDS } from "case-box-contract";
import { isKnownAuditEventKind } from "../dist/renderer/i18n/labels.js";

// --- 1. unit: isKnownAuditEventKind membership guard ---
// (Supersedes the former English EVENT_KIND_LABELS map / auditEventLabel helper, deleted in
// WI-DESKTOP-I18N-DEAD-LABELS-03. The humanized zh-CN label rendering is covered by
// renderer-i18n.test.mjs.)

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
