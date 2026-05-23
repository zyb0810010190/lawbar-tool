// Impl-parity B9 — OCR-link scenarios. Per B9 plan §1.5.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DOCUMENT_ID,
  DEFAULT_MATTER_ID,
  makeDocumentInput,
  makeMatterInput,
  makeOcrLinkInput,
} from "./conformance/fixtures.mjs";
import { makeAuditPair } from "./impl-parity-common.mjs";

async function buildPairForOcrLink() {
  const { inMem, sqlite, db } = makeAuditPair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  await inMem.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await sqlite.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  return { inMem, sqlite, db };
}

test("impl-parity B9.1: upsertOcrLink create happy path identical", async () => {
  const { inMem, sqlite } = await buildPairForOcrLink();
  const input = makeOcrLinkInput();
  const im = await inMem.upsertOcrLink(input);
  const sq = await sqlite.upsertOcrLink(input);
  assert.deepEqual(sq, im);
});

test("impl-parity B9.2: upsertOcrLink refresh (state changed) identical", async () => {
  const { inMem, sqlite } = await buildPairForOcrLink();
  await inMem.upsertOcrLink(makeOcrLinkInput());
  await sqlite.upsertOcrLink(makeOcrLinkInput());
  const refresh = makeOcrLinkInput({ status_snapshot: "succeeded", last_seen_at: "2026-05-22T11:00:00.000Z" });
  const im = await inMem.upsertOcrLink(refresh);
  const sq = await sqlite.upsertOcrLink(refresh);
  assert.deepEqual(sq, im);
  assert.equal(sq.created, false);
});

test("impl-parity B9.3: upsertOcrLink idempotent-replay identical (created: false; no new audit)", async () => {
  const { inMem, sqlite } = await buildPairForOcrLink();
  await inMem.upsertOcrLink(makeOcrLinkInput());
  await sqlite.upsertOcrLink(makeOcrLinkInput());
  // Replay byte-identical input.
  const imReplay = await inMem.upsertOcrLink(makeOcrLinkInput());
  const sqReplay = await sqlite.upsertOcrLink(makeOcrLinkInput());
  assert.deepEqual(sqReplay, imReplay);
  assert.equal(sqReplay.created, false);
});

test("impl-parity B9.4: getOcrLink happy path identical", async () => {
  const { inMem, sqlite } = await buildPairForOcrLink();
  await inMem.upsertOcrLink(makeOcrLinkInput());
  await sqlite.upsertOcrLink(makeOcrLinkInput());
  const getQuery = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID, document_id: DEFAULT_DOCUMENT_ID };
  const im = await inMem.getOcrLink(getQuery);
  const sq = await sqlite.getOcrLink(getQuery);
  assert.deepEqual(sq, im);
});

test("impl-parity B9.5: listOcrLinks byte-identical next_cursor across 2 pages (DESC order)", async () => {
  const { inMem, sqlite } = await buildPairForOcrLink();
  // 4 distinct documents + 4 ocr links with distinct last_seen_at.
  const docs = ["01jcasedocmockid000000pp01", "01jcasedocmockid000000pp02", "01jcasedocmockid000000pp03", "01jcasedocmockid000000pp04"];
  const seen = ["2026-05-22T09:00:00.000Z", "2026-05-22T10:00:00.000Z", "2026-05-22T11:00:00.000Z", "2026-05-22T12:00:00.000Z"];
  for (let i = 0; i < 4; i++) {
    await inMem.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput({ id: docs[i] }));
    await sqlite.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput({ id: docs[i] }));
    await inMem.upsertOcrLink(makeOcrLinkInput({ document_id: docs[i], last_seen_at: seen[i] }));
    await sqlite.upsertOcrLink(makeOcrLinkInput({ document_id: docs[i], last_seen_at: seen[i] }));
  }
  const base = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID, limit: 2 };
  let imPage = await inMem.listOcrLinks(base);
  let sqPage = await sqlite.listOcrLinks(base);
  assert.deepEqual(sqPage, imPage);
  assert.equal(typeof sqPage.next_cursor, "string");
  imPage = await inMem.listOcrLinks({ ...base, cursor: imPage.next_cursor });
  sqPage = await sqlite.listOcrLinks({ ...base, cursor: sqPage.next_cursor });
  assert.deepEqual(sqPage, imPage);
});

test("impl-parity B9.6: rejection parity (cross-tenant document, unknown document)", async () => {
  const { inMem, sqlite } = await buildPairForOcrLink();
  // Cross-tenant link.
  let imErr, sqErr;
  try { await inMem.upsertOcrLink(makeOcrLinkInput({ tenant_id: "tenant-evil" })); } catch (e) { imErr = e; }
  try { await sqlite.upsertOcrLink(makeOcrLinkInput({ tenant_id: "tenant-evil" })); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
  assert.equal(sqErr.code, "tenant_mismatch");
  // Unknown document.
  imErr = undefined; sqErr = undefined;
  try { await inMem.upsertOcrLink(makeOcrLinkInput({ document_id: "01jnonexistent00000000xxxx" })); } catch (e) { imErr = e; }
  try { await sqlite.upsertOcrLink(makeOcrLinkInput({ document_id: "01jnonexistent00000000xxxx" })); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
  assert.equal(sqErr.code, "unknown_document");
});
