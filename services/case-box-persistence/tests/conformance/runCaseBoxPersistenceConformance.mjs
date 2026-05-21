// Conformance harness for Phase A1. Drives BOTH implementations through
// the same matrix of cases. In A1 only InMemoryCaseBoxPersistence runs
// against it; in Phase B+ the SQLite implementation runs the same suite.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MATTER_ID,
  DEFAULT_TENANT_ID,
  makeClock,
  makeDocumentInput,
  makeIdGenerator,
  makeMatterInput,
} from "./fixtures.mjs";

/**
 * @param {string} label — implementation label (e.g. "InMemory")
 * @param {() => { make: () => any }} factory
 */
export function runConformance(label, factory) {
  const make = () => {
    const { Persistence } = factory();
    const now = makeClock("2026-05-20T09:00:00.000Z");
    const generateId = makeIdGenerator("mockid");
    return { p: new Persistence({ now, generateId }), now, generateId };
  };

  test(`${label}: 6.1.1 createMatter happy path`, async () => {
    const { p } = make();
    const matter = await p.createMatter(makeMatterInput());
    assert.equal(matter.id, DEFAULT_MATTER_ID);
    const round = await p.getMatter(DEFAULT_MATTER_ID);
    assert.deepEqual(round.id, DEFAULT_MATTER_ID);
    const head = await p.getAuditChainHead(DEFAULT_MATTER_ID);
    assert.equal(head.count, 1);
    assert.equal(typeof head.headHash, "string");
    assert.equal(head.headHash.length, 64);
  });

  test(`${label}: 6.1.2 schema-invalid createMatter → invalid_payload`, async () => {
    const { p } = make();
    await assertRejectsCode(() => p.createMatter({ ...makeMatterInput(), id: "BAD" }), "invalid_payload");
  });

  test(`${label}: 6.1.3 createMatter duplicate id → duplicate_id`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    await assertRejectsCode(() => p.createMatter(makeMatterInput()), "duplicate_id");
  });

  test(`${label}: 6.1.4 caller-mutates-input after createMatter → stored record unaffected`, async () => {
    const { p } = make();
    const input = makeMatterInput();
    await p.createMatter(input);
    input.name = "TAMPERED";
    const stored = await p.getMatter(DEFAULT_MATTER_ID);
    assert.notEqual(stored.name, "TAMPERED");
    assert.equal(stored.name, "Test Matter");
  });

  test(`${label}: 6.1.5 caller-mutates-return after createMatter → stored record unaffected`, async () => {
    const { p } = make();
    const ret = await p.createMatter(makeMatterInput());
    ret.name = "TAMPERED";
    const stored = await p.getMatter(DEFAULT_MATTER_ID);
    assert.notEqual(stored.name, "TAMPERED");
  });

  for (const flag of ["external_ocr_authorized", "sync_grant_present", "llm_extraction_opt_in"]) {
    test(`${label}: 6.1.${flag === "external_ocr_authorized" ? 6 : flag === "sync_grant_present" ? 7 : 8} createMatter rejects ${flag}=true → local_only_external_flag_rejected`, async () => {
      const { p } = make();
      await assertRejectsCode(
        () => p.createMatter(makeMatterInput({ [flag]: true })),
        "local_only_external_flag_rejected",
      );
    });
  }

  test(`${label}: 6.1.9 createMatter rejects status !== "active" → invalid_initial_state`, async () => {
    const { p } = make();
    await assertRejectsCode(
      () => p.createMatter(makeMatterInput({ status: "archived" })),
      "invalid_initial_state",
    );
  });

  test(`${label}: 6.1.10 createMatter rejects archived_at set → invalid_initial_state`, async () => {
    const { p } = make();
    await assertRejectsCode(
      () => p.createMatter(makeMatterInput({ archived_at: "2026-05-20T10:00:00.000Z" })),
      "invalid_initial_state",
    );
  });

  test(`${label}: 6.1.11 archiveMatter happy path`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    const archived = await p.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "case closed" });
    assert.equal(archived.status, "archived");
    assert.equal(typeof archived.archived_at, "string");
    const head = await p.getAuditChainHead(DEFAULT_MATTER_ID);
    assert.equal(head.count, 2);
  });

  test(`${label}: 6.1.12 archiveMatter unknown id → unknown_matter`, async () => {
    const { p } = make();
    await assertRejectsCode(
      () => p.archiveMatter("01nonexistmatter00000000xx", { actor_user_id: "local-user", reason: "x" }),
      "unknown_matter",
    );
  });

  test(`${label}: 6.1.13 archiveMatter already archived → illegal_transition`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    await p.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "case closed" });
    await assertRejectsCode(
      () => p.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "again" }),
      "illegal_transition",
    );
  });

  test(`${label}: 6.1.13a archiveMatter empty reason → invalid_argument`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    await assertRejectsCode(
      () => p.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "" }),
      "invalid_argument",
    );
  });

  test(`${label}: 6.1.14 unarchiveMatter happy path`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    await p.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "closed" });
    const un = await p.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "reopen" });
    assert.equal(un.status, "active");
    const head = await p.getAuditChainHead(DEFAULT_MATTER_ID);
    assert.equal(head.count, 3);
  });

  test(`${label}: 6.1.15 unarchiveMatter already active → illegal_transition`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    await assertRejectsCode(
      () => p.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "x" }),
      "illegal_transition",
    );
  });

  test(`${label}: 6.1.16 registerDocument happy path + DOCUMENT_REGISTERED emitted`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    const doc = await p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
    assert.equal(doc.status, "registered");
    const head = await p.getAuditChainHead(DEFAULT_MATTER_ID);
    assert.equal(head.count, 2);
  });

  test(`${label}: 6.1.17 registerDocument tenant_id mismatch → tenant_mismatch`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    await assertRejectsCode(
      () => p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput({ tenant_id: "other-tenant" })),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.1.18 registerDocument matter_id mismatch → matter_id_mismatch`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    await assertRejectsCode(
      () => p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput({ matter_id: "01othermattermockid00000xx" })),
      "matter_id_mismatch",
    );
  });

  test(`${label}: 6.1.19 registerDocument unknown matter → unknown_matter`, async () => {
    const { p } = make();
    await assertRejectsCode(
      () => p.registerDocument("01nonexistmatter00000000xx", makeDocumentInput()),
      "unknown_matter",
    );
  });

  test(`${label}: 6.1.20 registerDocument duplicate id → duplicate_id`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    await p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
    await assertRejectsCode(
      () => p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput()),
      "duplicate_id",
    );
  });

  test(`${label}: 6.1.21 registerDocument schema-invalid → invalid_payload`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    await assertRejectsCode(
      () => p.registerDocument(DEFAULT_MATTER_ID, { ...makeDocumentInput(), id: "BAD" }),
      "invalid_payload",
    );
  });

  test(`${label}: 6.1.22 registerDocument status !== "registered" → invalid_initial_state`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    await assertRejectsCode(
      () => p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput({ status: "ocr_pending" })),
      "invalid_initial_state",
    );
  });

  test(`${label}: 6.1.23 listDocuments empty matter`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    const page = await p.listDocuments({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    assert.deepEqual(page.rows, []);
    assert.equal(page.next_cursor, null);
  });

  test(`${label}: 6.1.24 listDocuments unknown matter → unknown_matter`, async () => {
    const { p } = make();
    await assertRejectsCode(
      () => p.listDocuments({ tenant_id: DEFAULT_TENANT_ID, matter_id: "01nonexistmatter00000000xx" }),
      "unknown_matter",
    );
  });

  test(`${label}: 6.1.25 listDocuments wrong tenant → tenant_mismatch`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    await assertRejectsCode(
      () => p.listDocuments({ tenant_id: "other-tenant", matter_id: DEFAULT_MATTER_ID }),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.1.26-27 listDocuments single + multi-page`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const docId = `01jdoclistmockid00000000${(i + 0x10).toString(16)}`;
      ids.push(docId);
      await p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput({
        id: docId,
        received_at: `2026-05-20T09:0${i}:00.000Z`,
      }));
    }
    const page1 = await p.listDocuments({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, limit: 2 });
    assert.equal(page1.rows.length, 2);
    assert.equal(typeof page1.next_cursor, "string");
    const page2 = await p.listDocuments({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, limit: 2, cursor: page1.next_cursor });
    assert.equal(page2.rows.length, 2);
    const page3 = await p.listDocuments({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, limit: 2, cursor: page2.next_cursor });
    assert.equal(page3.rows.length, 1);
    assert.equal(page3.next_cursor, null);
    const seen = [...page1.rows, ...page2.rows, ...page3.rows].map((d) => d.id);
    assert.equal(new Set(seen).size, 5);
  });

  test(`${label}: 6.1.28 listDocuments wrong-filter cursor → invalid_argument`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    // Encode a cursor against a different tenant_id, then try to decode against the correct one.
    const { Persistence: _Ignored } = factory();
    void _Ignored;
    // Get a real cursor first by listing under a multi-page scenario.
    for (let i = 0; i < 3; i++) {
      const docId = `01jdocfilter000000000000${(i + 0x10).toString(16)}`;
      await p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput({
        id: docId,
        received_at: `2026-05-20T09:0${i}:00.000Z`,
      }));
    }
    const page = await p.listDocuments({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, limit: 1 });
    const cursor = page.next_cursor;
    assert.ok(cursor, "expected a cursor");
    // Now create a second matter under a different tenant and try the cursor there.
    const otherMatterId = "01jothermockmatterid000002";
    await p.createMatter(makeMatterInput({ id: otherMatterId, tenant_id: "other-tenant", actor_user_id: "local-user" }));
    await assertRejectsCode(
      () => p.listDocuments({ tenant_id: "other-tenant", matter_id: otherMatterId, cursor }),
      "invalid_argument",
    );
  });

  test(`${label}: 6.1.29 getAuditChainHead matter with seed event only`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    const head = await p.getAuditChainHead(DEFAULT_MATTER_ID);
    assert.equal(head.count, 1);
    assert.equal(typeof head.headHash, "string");
    assert.equal(head.headHash.length, 64);
    assert.equal(typeof head.lastEventId, "string");
    assert.equal(head.lastEventId.length, 26);
  });

  test(`${label}: 6.1.30 getAuditChainHead after N writes`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    await p.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "x" });
    await p.unarchiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "y" });
    const head = await p.getAuditChainHead(DEFAULT_MATTER_ID);
    assert.equal(head.count, 3);
  });

  test(`${label}: 6.1.31 getAuditChainHead unknown matter → unknown_matter`, async () => {
    const { p } = make();
    await assertRejectsCode(
      () => p.getAuditChainHead("01nonexistmatter00000000xx"),
      "unknown_matter",
    );
  });

  test(`${label}: 6.1.32 verifyAuditChainForMatter untampered`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    await p.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "x" });
    const r = await p.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
    assert.equal(r.ok, true);
    assert.equal(r.verifiedCount, 2);
  });

  test(`${label}: 6.1.34 verifyAuditChainForMatter unknown matter → unknown_matter`, async () => {
    const { p } = make();
    await assertRejectsCode(
      () => p.verifyAuditChainForMatter("01nonexistmatter00000000xx"),
      "unknown_matter",
    );
  });

  test(`${label}: 6.1.35 listAuditEvents happy path ordered by sequence`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    await p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
    await p.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "x" });
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    assert.equal(page.rows.length, 3);
    assert.equal(page.rows[0].action, "create");
    assert.equal(page.rows[0].entity_type, "matter");
    assert.equal(page.rows[1].action, "create");
    assert.equal(page.rows[1].entity_type, "document");
    assert.equal(page.rows[2].action, "update");
    assert.equal(page.rows[2].entity_type, "matter");
  });

  test(`${label}: 6.1.36 listAuditEvents unknown matter → unknown_matter`, async () => {
    const { p } = make();
    await assertRejectsCode(
      () => p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: "01nonexistmatter00000000xx" }),
      "unknown_matter",
    );
  });

  test(`${label}: 6.1.37 listAuditEvents tenant mismatch → tenant_mismatch`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    await assertRejectsCode(
      () => p.listAuditEvents({ tenant_id: "other-tenant", matter_id: DEFAULT_MATTER_ID }),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.1.38 generated audit IDs match ^[0-9a-z]{26}$`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    await p.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "x" });
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    for (const evt of page.rows) {
      assert.match(evt.id, /^[0-9a-z]{26}$/);
    }
  });
}

async function assertRejectsCode(fn, expectedCode) {
  let caught;
  try {
    await fn();
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, `expected promise to reject with code=${expectedCode}, but it resolved`);
  assert.equal(caught.name, "CaseBoxPersistenceError", `expected CaseBoxPersistenceError, got ${caught.name}`);
  assert.equal(caught.code, expectedCode, `expected code=${expectedCode}, got ${caught.code}; message=${caught.message}`);
}
