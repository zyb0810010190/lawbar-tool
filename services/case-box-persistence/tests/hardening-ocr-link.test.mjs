// Hardening: B9 OCR-link invariants. Per B9 plan §1.5.
// NEW file (no behavioral split — B9 OCR-link tests start here).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CaseBoxPersistenceError,
  DEFAULT_MATTER_ID,
  makeClock,
  makeIdGenerator,
  makeMatterInput,
  openSqliteCaseBoxPersistence,
} from "./hardening-common.mjs";

test("Sqlite-B9: upsertOcrLink rejects cross-tenant document", async () => {
  const { makeDocumentInput, makeOcrLinkInput } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("o1"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  let err;
  try {
    await persistence.upsertOcrLink(makeOcrLinkInput({ tenant_id: "tenant-evil" }));
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "tenant_mismatch");
});

test("Sqlite-B9: upsertOcrLink rejects unknown_document", async () => {
  const { makeOcrLinkInput } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("o2"),
  });
  await persistence.createMatter(makeMatterInput());
  // No document registered.
  let err;
  try {
    await persistence.upsertOcrLink(makeOcrLinkInput());
  } catch (e) { err = e; }
  assert.ok(err instanceof CaseBoxPersistenceError);
  assert.equal(err.code, "unknown_document");
});

test("Sqlite-B9: idempotent-replay emits NO audit AND leaves payload_json + last_seen_at byte-identical", async () => {
  const { makeDocumentInput, makeOcrLinkInput, DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("o3"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  // First upsert: creates.
  const first = await persistence.upsertOcrLink(makeOcrLinkInput());
  assert.equal(first.created, true);
  const preHead = db.prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const preRow = db.prepare("SELECT payload_json, last_seen_at FROM case_box_ocr_links WHERE document_id = ?").get(DEFAULT_DOCUMENT_ID);
  // Second upsert with IDENTICAL input — should be byte-identical replay.
  const second = await persistence.upsertOcrLink(makeOcrLinkInput());
  assert.equal(second.created, false);
  const postHead = db.prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const postRow = db.prepare("SELECT payload_json, last_seen_at FROM case_box_ocr_links WHERE document_id = ?").get(DEFAULT_DOCUMENT_ID);
  // Row must be byte-identical (no UPDATE).
  assert.equal(postRow.payload_json, preRow.payload_json, "idempotent replay must NOT modify payload_json");
  assert.equal(postRow.last_seen_at, preRow.last_seen_at, "idempotent replay must NOT modify last_seen_at column");
  // Audit chain head unchanged.
  assert.equal(postHead.event_count, preHead.event_count, "idempotent replay must NOT advance audit chain head");
});

test("Sqlite-B9: create vs refresh audit-kind selection (SNAPSHOTTED then REFRESHED)", async () => {
  const { makeDocumentInput, makeOcrLinkInput } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("o4"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  // First upsert: create → OCR_LINK_SNAPSHOTTED.
  await persistence.upsertOcrLink(makeOcrLinkInput());
  // Modify state (different status_snapshot) → refresh → OCR_LINK_REFRESHED.
  await persistence.upsertOcrLink(makeOcrLinkInput({ status_snapshot: "succeeded", last_seen_at: "2026-05-22T11:00:00.000Z" }));
  const events = db.prepare("SELECT event_json FROM case_box_audit_events WHERE matter_id = ? ORDER BY sequence ASC").all(DEFAULT_MATTER_ID);
  // CaseBoxAuditEvent uses {action, entity_type} (NOT a `kind` field
  // at the row level — the "kind" tag is the enum mapping in
  // docs/contracts/case-box-contract/src/audit-log.ts).
  // OCR_LINK_SNAPSHOTTED → {action: "create", entity_type: "ocr_link"}.
  // OCR_LINK_REFRESHED → {action: "update", entity_type: "ocr_link"}.
  const tags = events.map((r) => {
    const e = JSON.parse(r.event_json);
    return `${e.entity_type}:${e.action}`;
  });
  assert.equal(tags.length, 4);
  assert.equal(tags[2], "ocr_link:create", "3rd audit event must be OCR_LINK_SNAPSHOTTED (create on ocr_link)");
  assert.equal(tags[3], "ocr_link:update", "4th audit event must be OCR_LINK_REFRESHED (update on ocr_link)");
});

test("Sqlite-B9: audit-chain atomic event_count == 3 after createMatter + registerDocument + upsertOcrLink", async () => {
  const { makeDocumentInput, makeOcrLinkInput } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("o5"),
  });
  await persistence.createMatter(makeMatterInput());
  await persistence.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await persistence.upsertOcrLink(makeOcrLinkInput());
  const head = db.prepare("SELECT event_count FROM case_box_audit_chain_heads WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const count = db.prepare("SELECT COUNT(*) AS c FROM case_box_audit_events WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  const maxSeq = db.prepare("SELECT MAX(sequence) AS m FROM case_box_audit_events WHERE matter_id = ?").get(DEFAULT_MATTER_ID);
  assert.equal(head.event_count, 3);
  assert.equal(count.c, 3);
  assert.equal(maxSeq.m, 3);
});
