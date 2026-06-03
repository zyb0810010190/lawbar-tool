// Security hardening: listFacts / listDeadlines must tenant-filter the rows
// themselves, not just validate the matter's tenant. Closes FACTS-AUD-1
// (cc-suite audit-mpxoq4ma-dn3m0h): the list SQL filtered WHERE matter_id only,
// so a fact/deadline row whose own tenant_id differed from its matter's (a
// data-integrity violation) would leak. These tests craft such a cross-tenant
// row directly in SQLite (the normal append path cannot create one) and assert
// it is excluded, while a same-tenant row is still returned (pagination intact).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MATTER_ID,
  makeClock,
  makeIdGenerator,
  makeMatterInput,
  openSqliteCaseBoxPersistence,
} from "./hardening-common.mjs";

const EVIL_TENANT = "tenant-evil";

test("Sqlite-SEC: listFacts excludes a cross-tenant fact row; same-tenant rows returned", async () => {
  const { makeFactInput, DEFAULT_FACT_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("secf"),
  });
  await persistence.createMatter(makeMatterInput());
  const matter = await persistence.getMatter(DEFAULT_MATTER_ID);
  const tenant = matter.tenant_id;

  const FACT2_ID = "01jcasefactmockid000000002";
  await persistence.appendFact(makeFactInput());
  await persistence.appendFact(makeFactInput({ id: FACT2_ID, statement_text: "second fact" }));

  // Sanity: both same-tenant facts are listed.
  const before = await persistence.listFacts({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.equal(before.rows.length, 2);

  // Craft a cross-tenant row: flip fact #2's own tenant_id column to a foreign
  // tenant (its matter still belongs to `tenant`). The normal append path can
  // never produce this; only a direct write can.
  db.prepare("UPDATE case_box_facts SET tenant_id = ? WHERE id = ?").run(EVIL_TENANT, FACT2_ID);

  const after = await persistence.listFacts({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.equal(after.rows.length, 1, "cross-tenant fact row must be excluded");
  assert.equal(after.rows[0].id, DEFAULT_FACT_ID, "the same-tenant fact is still returned");
});

test("Sqlite-SEC: listFacts pagination/cursor still works after the tenant filter", async () => {
  const { makeFactInput } = await import("./conformance/fixtures.mjs");
  const { persistence } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("secfp"),
  });
  await persistence.createMatter(makeMatterInput());
  const tenant = (await persistence.getMatter(DEFAULT_MATTER_ID)).tenant_id;
  // Three facts with distinct created_at so seek order is deterministic.
  await persistence.appendFact(makeFactInput({ id: "01jcasefactpag000000000001", created_at: "2026-05-21T15:00:00.000Z" }));
  await persistence.appendFact(makeFactInput({ id: "01jcasefactpag000000000002", created_at: "2026-05-21T16:00:00.000Z" }));
  await persistence.appendFact(makeFactInput({ id: "01jcasefactpag000000000003", created_at: "2026-05-21T17:00:00.000Z" }));

  const page1 = await persistence.listFacts({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID, limit: 2 });
  assert.equal(page1.rows.length, 2);
  assert.ok(page1.next_cursor !== null);
  const page2 = await persistence.listFacts({
    tenant_id: tenant,
    matter_id: DEFAULT_MATTER_ID,
    limit: 2,
    cursor: page1.next_cursor,
  });
  assert.equal(page2.rows.length, 1);
  assert.equal(page2.next_cursor, null);
  const allIds = [...page1.rows, ...page2.rows].map((f) => f.id);
  assert.equal(new Set(allIds).size, 3, "all three same-tenant facts paginated exactly once");
});

test("Sqlite-SEC: listDeadlines excludes a cross-tenant deadline row; same-tenant survives; pagination intact", async () => {
  const { makeDocketEntryInput, DEFAULT_DOCKET_ENTRY_ID, DEFAULT_DEADLINE_ID } = await import("./conformance/fixtures.mjs");
  const { persistence, db } = openSqliteCaseBoxPersistence({
    now: makeClock("2026-05-22T09:00:00.000Z"),
    generateId: makeIdGenerator("secd"),
  });
  await persistence.createMatter(makeMatterInput());
  const tenant = (await persistence.getMatter(DEFAULT_MATTER_ID)).tenant_id;

  const ENTRY2_ID = "01jcasedockmockid000000002";
  const DEADLINE2_ID = "01jcasedlinemockid00000002";
  // Materialize two same-tenant deadlines via the docket confirm flow, with
  // distinct due dates so seek order (due_at ASC) is deterministic.
  await persistence.appendDocketEntry(makeDocketEntryInput());
  await persistence.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
    confirmation_actor_user_id: "lawyer",
    confirmed_at: "2026-05-21T21:00:00.000Z",
    deadline_id: DEFAULT_DEADLINE_ID,
  });
  await persistence.appendDocketEntry(
    makeDocketEntryInput({ id: ENTRY2_ID, proposed_due_at: "2026-06-20T17:00:00.000Z" }),
  );
  await persistence.confirmDocketEntry(ENTRY2_ID, {
    confirmation_actor_user_id: "lawyer",
    confirmed_at: "2026-05-21T21:05:00.000Z",
    deadline_id: DEADLINE2_ID,
  });

  // Sanity: both same-tenant deadlines list, soonest-due first.
  const before = await persistence.listDeadlines({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.equal(before.rows.length, 2);
  assert.equal(before.rows[0].id, DEFAULT_DEADLINE_ID); // due 2026-06-15
  assert.equal(before.rows[1].id, DEADLINE2_ID); // due 2026-06-20

  // Pagination still works after the tenant predicate.
  const page1 = await persistence.listDeadlines({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID, limit: 1 });
  assert.equal(page1.rows.length, 1);
  assert.ok(page1.next_cursor !== null);
  const page2 = await persistence.listDeadlines({
    tenant_id: tenant,
    matter_id: DEFAULT_MATTER_ID,
    limit: 1,
    cursor: page1.next_cursor,
  });
  assert.equal(page2.rows.length, 1);
  assert.equal(page2.next_cursor, null);
  assert.notEqual(page1.rows[0].id, page2.rows[0].id);

  // Craft a cross-tenant row by flipping deadline #1's own tenant_id column.
  db.prepare("UPDATE case_box_deadlines SET tenant_id = ? WHERE id = ?").run(EVIL_TENANT, DEFAULT_DEADLINE_ID);

  const after = await persistence.listDeadlines({ tenant_id: tenant, matter_id: DEFAULT_MATTER_ID });
  assert.equal(after.rows.length, 1, "cross-tenant deadline row excluded; same-tenant one survives");
  assert.equal(after.rows[0].id, DEADLINE2_ID);
});
