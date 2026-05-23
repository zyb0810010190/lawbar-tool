// Impl-parity B5 — privilege marker scenarios. Split from former
// monolithic impl-parity.test.mjs per B7 plan §1.7 (closes B6 D4#1).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MATTER_ID,
  makeDocumentInput,
  makeMatterInput,
} from "./conformance/fixtures.mjs";
import { makeAuditPair } from "./impl-parity-common.mjs";

async function buildPairWithDoc() {
  const { makePrivilegeMarkerInput } = await import("./conformance/fixtures.mjs");
  const { inMem, sqlite, db } = makeAuditPair();
  await inMem.createMatter(makeMatterInput());
  await sqlite.createMatter(makeMatterInput());
  await inMem.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  await sqlite.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
  return { inMem, sqlite, db, makePrivilegeMarkerInput };
}

test("impl-parity B5.1: appendPrivilegeMarker happy path identical", async () => {
  const { inMem, sqlite, makePrivilegeMarkerInput } = await buildPairWithDoc();
  const input = makePrivilegeMarkerInput();
  const im = await inMem.appendPrivilegeMarker(input);
  const sq = await sqlite.appendPrivilegeMarker(input);
  assert.deepEqual(sq, im);
});

test("impl-parity B5.2: transition proposed → confirmed identical", async () => {
  const { inMem, sqlite, makePrivilegeMarkerInput } = await buildPairWithDoc();
  const { DEFAULT_PRIVILEGE_MARKER_ID } = await import("./conformance/fixtures.mjs");
  await inMem.appendPrivilegeMarker(makePrivilegeMarkerInput());
  await sqlite.appendPrivilegeMarker(makePrivilegeMarkerInput());
  const opts = { to: "confirmed", actor_user_id: "lawyer", at: "2026-05-21T11:00:00.000Z" };
  const im = await inMem.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, opts);
  const sq = await sqlite.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, opts);
  assert.deepEqual(sq, im);
});

test("impl-parity B5.3: transition proposed → dismissed identical (with reason)", async () => {
  const { inMem, sqlite, makePrivilegeMarkerInput } = await buildPairWithDoc();
  const { DEFAULT_PRIVILEGE_MARKER_ID } = await import("./conformance/fixtures.mjs");
  await inMem.appendPrivilegeMarker(makePrivilegeMarkerInput());
  await sqlite.appendPrivilegeMarker(makePrivilegeMarkerInput());
  const opts = { to: "dismissed", actor_user_id: "lawyer", at: "2026-05-21T11:00:00.000Z", reason: "no privilege basis" };
  const im = await inMem.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, opts);
  const sq = await sqlite.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, opts);
  assert.deepEqual(sq, im);
});

test("impl-parity B5.4: getPrivilegeStatus on confirmed marker identical", async () => {
  const { inMem, sqlite, makePrivilegeMarkerInput } = await buildPairWithDoc();
  const { DEFAULT_PRIVILEGE_MARKER_ID, DEFAULT_DOCUMENT_ID } = await import("./conformance/fixtures.mjs");
  await inMem.appendPrivilegeMarker(makePrivilegeMarkerInput());
  await sqlite.appendPrivilegeMarker(makePrivilegeMarkerInput());
  await inMem.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, { to: "confirmed", actor_user_id: "lawyer", at: "2026-05-21T11:00:00.000Z" });
  await sqlite.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, { to: "confirmed", actor_user_id: "lawyer", at: "2026-05-21T11:00:00.000Z" });
  const query = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID, target_type: "document", target_id: DEFAULT_DOCUMENT_ID };
  const im = await inMem.getPrivilegeStatus(query);
  const sq = await sqlite.getPrivilegeStatus(query);
  assert.deepEqual(sq, im);
});

test("impl-parity B5.5: listPrivilegeMarkers byte-identical next_cursor across 2 pages", async () => {
  const { inMem, sqlite, makePrivilegeMarkerInput } = await buildPairWithDoc();
  const ids = ["01jcasemarkermockid0000a01", "01jcasemarkermockid0000a02", "01jcasemarkermockid0000a03", "01jcasemarkermockid0000a04"];
  const propsAt = ["2026-05-21T09:00:00.000Z", "2026-05-21T10:00:00.000Z", "2026-05-21T11:00:00.000Z", "2026-05-21T12:00:00.000Z"];
  for (let i = 0; i < 4; i++) {
    const m = makePrivilegeMarkerInput({ id: ids[i], proposed_at: propsAt[i], created_at: propsAt[i] });
    await inMem.appendPrivilegeMarker(m);
    await sqlite.appendPrivilegeMarker(m);
  }
  const base = { tenant_id: "tenant-local-v1", matter_id: DEFAULT_MATTER_ID, limit: 2 };
  let imPage = await inMem.listPrivilegeMarkers(base);
  let sqPage = await sqlite.listPrivilegeMarkers(base);
  assert.deepEqual(sqPage, imPage);
  imPage = await inMem.listPrivilegeMarkers({ ...base, cursor: imPage.next_cursor });
  sqPage = await sqlite.listPrivilegeMarkers({ ...base, cursor: sqPage.next_cursor });
  assert.deepEqual(sqPage, imPage);
  assert.equal(sqPage.next_cursor, null);
});

test("impl-parity B5.6: rejection parity (cross-tenant, direct confirmed, unknown marker)", async () => {
  const { inMem, sqlite, makePrivilegeMarkerInput } = await buildPairWithDoc();
  // Cross-tenant.
  let imErr, sqErr;
  try { await inMem.appendPrivilegeMarker(makePrivilegeMarkerInput({ tenant_id: "tenant-evil" })); } catch (e) { imErr = e; }
  try { await sqlite.appendPrivilegeMarker(makePrivilegeMarkerInput({ tenant_id: "tenant-evil" })); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
  // Direct confirmed.
  imErr = undefined; sqErr = undefined;
  try { await inMem.appendPrivilegeMarker(makePrivilegeMarkerInput({ status: "confirmed", confirmed_actor_user_id: "lawyer", confirmed_at: "2026-05-21T10:00:00.000Z" })); } catch (e) { imErr = e; }
  try { await sqlite.appendPrivilegeMarker(makePrivilegeMarkerInput({ status: "confirmed", confirmed_actor_user_id: "lawyer", confirmed_at: "2026-05-21T10:00:00.000Z" })); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
  // Unknown marker transition.
  imErr = undefined; sqErr = undefined;
  try { await inMem.transitionPrivilegeMarker("01jcasemarkermockid000nope", { to: "confirmed", actor_user_id: "lawyer", at: "2026-05-21T11:00:00.000Z" }); } catch (e) { imErr = e; }
  try { await sqlite.transitionPrivilegeMarker("01jcasemarkermockid000nope", { to: "confirmed", actor_user_id: "lawyer", at: "2026-05-21T11:00:00.000Z" }); } catch (e) { sqErr = e; }
  assert.equal(sqErr.code, imErr.code);
});
