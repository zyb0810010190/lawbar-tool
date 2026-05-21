// Conformance harness for Phase A1. Drives BOTH implementations through
// the same matrix of cases. In A1 only InMemoryCaseBoxPersistence runs
// against it; in Phase B+ the SQLite implementation runs the same suite.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DOCUMENT_ID,
  DEFAULT_MATTER_ID,
  DEFAULT_PRIVILEGE_MARKER_ID,
  DEFAULT_TENANT_ID,
  makeClassificationInput,
  makeClock,
  makeDocumentInput,
  makeIdGenerator,
  makeMatterInput,
  makePrivilegeMarkerInput,
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

  // ===========================================================================
  // Phase A2 — confidentiality classification
  // ===========================================================================

  const seedMatterDoc = async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    await p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());
    return p;
  };

  test(`${label}: 6.A2.1 appendConfidentialityClassification SET happy path`, async () => {
    const p = await seedMatterDoc();
    const row = await p.appendConfidentialityClassification(makeClassificationInput());
    assert.equal(row.level, "normal");
    const eff = await p.getEffectiveClassification({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID,
      target_type: "document", target_id: DEFAULT_DOCUMENT_ID,
    });
    assert.equal(eff.effectiveLevel, "normal");
    assert.equal(eff.history.length, 1);
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    // matter + document + classification = 3 events; last is SET
    assert.equal(page.rows.length, 3);
    assert.equal(page.rows[2].entity_type, "confidentiality_classification");
    assert.equal(page.rows[2].action, "create");
    assert.equal(page.rows[2].reason, undefined);
  });

  test(`${label}: 6.A2.2 appendConfidentialityClassification rejects target_type="matter"`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendConfidentialityClassification(makeClassificationInput({ target_type: "matter" })),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A2.3 appendConfidentialityClassification rejects target_type="fact"`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendConfidentialityClassification(makeClassificationInput({ target_type: "fact" })),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A2.4 rejects unknown document target → unknown_document`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendConfidentialityClassification(makeClassificationInput({ target_id: "01nonexistdocmockid0000007" })),
      "unknown_document",
    );
  });

  test(`${label}: 6.A2.5 rejects tenant mismatch → tenant_mismatch`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendConfidentialityClassification(makeClassificationInput({ tenant_id: "other-tenant" })),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A2.6 rejects matter_id mismatch → matter_id_mismatch`, async () => {
    const p = await seedMatterDoc();
    // Use a different matter_id but the same document id. Need to create the other matter to satisfy the resolution path.
    const otherMatter = makeMatterInput({ id: "01jothermattermockid0a2008" });
    await p.createMatter(otherMatter);
    await assertRejectsCode(
      () => p.appendConfidentialityClassification(makeClassificationInput({ matter_id: "01jothermattermockid0a2008" })),
      "matter_id_mismatch",
    );
  });

  test(`${label}: 6.A2.7 rejects duplicate id → duplicate_id`, async () => {
    const p = await seedMatterDoc();
    await p.appendConfidentialityClassification(makeClassificationInput());
    await assertRejectsCode(
      () => p.appendConfidentialityClassification(makeClassificationInput({ set_at: "2026-05-21T10:00:00.000Z", prior_level: "normal", level: "confidential" })),
      "duplicate_id",
    );
  });

  test(`${label}: 6.A2.8 schema-invalid → invalid_payload`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendConfidentialityClassification(makeClassificationInput({ id: "BAD" })),
      "invalid_payload",
    );
  });

  test(`${label}: 6.A2.9 UPGRADED — normal → confidential, reason absent`, async () => {
    const p = await seedMatterDoc();
    await p.appendConfidentialityClassification(makeClassificationInput());
    await p.appendConfidentialityClassification(makeClassificationInput({
      id: "01jcaseclassmockid00000002",
      prior_level: "normal", level: "confidential",
      set_at: "2026-05-21T10:00:00.000Z",
    }));
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.entity_type, "confidentiality_classification");
    assert.equal(evt.action, "create");
    assert.equal(evt.reason, undefined, "UPGRADED audit must NOT carry reason");
  });

  test(`${label}: 6.A2.9a same-level (normal → normal) rejects → invalid_argument`, async () => {
    const p = await seedMatterDoc();
    await p.appendConfidentialityClassification(makeClassificationInput());
    await assertRejectsCode(
      () => p.appendConfidentialityClassification(makeClassificationInput({
        id: "01jcaseclassmockid00000002",
        prior_level: "normal", level: "normal",
        set_at: "2026-05-21T10:00:00.000Z",
      })),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A2.9b unclassified → normal UPGRADED`, async () => {
    const p = await seedMatterDoc();
    await p.appendConfidentialityClassification(makeClassificationInput({ level: "unclassified" }));
    await p.appendConfidentialityClassification(makeClassificationInput({
      id: "01jcaseclassmockid00000002",
      prior_level: "unclassified", level: "normal",
      set_at: "2026-05-21T10:00:00.000Z",
    }));
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.reason, undefined);
  });

  test(`${label}: 6.A2.10 DOWNGRADED requires reason; reason equals change_reason_code`, async () => {
    const p = await seedMatterDoc();
    await p.appendConfidentialityClassification(makeClassificationInput({ level: "confidential" }));
    // Missing reason for downgrade — contract throws inside; our code maps to invalid_payload.
    await assertRejectsCode(
      () => p.appendConfidentialityClassification(makeClassificationInput({
        id: "01jcaseclassmockid00000002",
        prior_level: "confidential", level: "normal",
        set_at: "2026-05-21T10:00:00.000Z",
      })),
      "invalid_payload",
    );
    const row = await p.appendConfidentialityClassification(makeClassificationInput({
      id: "01jcaseclassmockid00000003",
      prior_level: "confidential", level: "normal",
      change_reason_code: "change_in_legal_assessment",
      change_reason_text: null,
      set_at: "2026-05-21T11:00:00.000Z",
    }));
    assert.equal(row.level, "normal");
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.reason, "change_in_legal_assessment");
  });

  test(`${label}: 6.A2.11 RESET_TO_UNCLASSIFIED requires reason`, async () => {
    const p = await seedMatterDoc();
    await p.appendConfidentialityClassification(makeClassificationInput({ level: "confidential" }));
    await assertRejectsCode(
      () => p.appendConfidentialityClassification(makeClassificationInput({
        id: "01jcaseclassmockid00000002",
        prior_level: "confidential", level: "unclassified",
        set_at: "2026-05-21T10:00:00.000Z",
      })),
      "invalid_payload",
    );
    const row = await p.appendConfidentialityClassification(makeClassificationInput({
      id: "01jcaseclassmockid00000003",
      prior_level: "confidential", level: "unclassified",
      change_reason_code: "change_in_legal_assessment",
      change_reason_text: null,
      set_at: "2026-05-21T11:00:00.000Z",
    }));
    assert.equal(row.level, "unclassified");
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.reason, "change_in_legal_assessment");
  });

  test(`${label}: 6.A2.12 prior_level mismatch with stored prior → invalid_payload`, async () => {
    const p = await seedMatterDoc();
    await p.appendConfidentialityClassification(makeClassificationInput({ level: "normal" }));
    await assertRejectsCode(
      () => p.appendConfidentialityClassification(makeClassificationInput({
        id: "01jcaseclassmockid00000002",
        prior_level: "confidential", level: "highly_confidential",
        set_at: "2026-05-21T10:00:00.000Z",
      })),
      "invalid_payload",
    );
  });

  test(`${label}: 6.A2.13 getEffectiveClassification empty history → unclassified`, async () => {
    const p = await seedMatterDoc();
    const eff = await p.getEffectiveClassification({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID,
      target_type: "document", target_id: DEFAULT_DOCUMENT_ID,
    });
    assert.equal(eff.effectiveLevel, "unclassified");
    assert.equal(eff.history.length, 0);
  });

  test(`${label}: 6.A2.14 getEffectiveClassification latest-wins ordering`, async () => {
    const p = await seedMatterDoc();
    await p.appendConfidentialityClassification(makeClassificationInput({ level: "normal" }));
    await p.appendConfidentialityClassification(makeClassificationInput({
      id: "01jcaseclassmockid00000002",
      prior_level: "normal", level: "confidential",
      set_at: "2026-05-21T10:00:00.000Z",
    }));
    await p.appendConfidentialityClassification(makeClassificationInput({
      id: "01jcaseclassmockid00000003",
      prior_level: "confidential", level: "normal",
      change_reason_code: "change_in_legal_assessment",
      change_reason_text: null,
      set_at: "2026-05-21T11:00:00.000Z",
    }));
    const eff = await p.getEffectiveClassification({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID,
      target_type: "document", target_id: DEFAULT_DOCUMENT_ID,
    });
    assert.equal(eff.effectiveLevel, "normal");
    assert.equal(eff.history.length, 3);
    // History sorted set_at DESC
    assert.ok(eff.history[0].set_at >= eff.history[1].set_at);
    assert.ok(eff.history[1].set_at >= eff.history[2].set_at);
  });

  test(`${label}: 6.A2.15 getEffectiveClassification unknown document → unknown_document`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.getEffectiveClassification({
        tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID,
        target_type: "document", target_id: "01nonexistdocmockid000007",
      }),
      "unknown_document",
    );
  });

  test(`${label}: 6.A2.16 listConfidentialityClassifications empty matter`, async () => {
    const p = await seedMatterDoc();
    const page = await p.listConfidentialityClassifications({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    assert.deepEqual(page.rows, []);
    assert.equal(page.next_cursor, null);
  });

  test(`${label}: 6.A2.17 listConfidentialityClassifications ordered by set_at ASC independent of insertion order`, async () => {
    const p = await seedMatterDoc();
    // Sequence: contract requires each new row's prior_level === latest-by-set_at level.
    // Insert order: r1 (set_at=03:00, normal) → r2 (set_at=04:00, confidential)
    //   → r3 (set_at=02:00, confidential, prior=confidential rejected since same-level)
    //   → r3' (set_at=02:00, highly_confidential, prior=confidential)
    //   → r4 (set_at=01:00, highly_confidential same-level — rejected)
    //   → r4' (set_at=01:00, restricted, prior=confidential — latest by set_at is still r2 at insert)
    // Actually after r3' is inserted, latest by set_at is STILL r2 (04:00 > 02:00). So r4's prior must = r2.level = "confidential".
    // Insert r1: prior=null, level=normal, set_at=03:00
    // Insert r2: prior=normal, level=confidential, set_at=04:00 (now latest)
    // Insert r3: latest by set_at DESC = r2 (confidential); set_at=02:00. prior=confidential, level=highly_confidential → upgrade
    // Insert r4: latest still r2 (04:00 max); set_at=01:00. prior=confidential, level=restricted → upgrade
    // List by set_at ASC: r4(01:00), r3(02:00), r1(03:00), r2(04:00)
    // Insertion order: r1, r2, r3, r4 → list order: r4, r3, r1, r2 ≠ insertion order.
    await p.appendConfidentialityClassification(makeClassificationInput({
      id: "01jcaseclassmockorder0001a",
      prior_level: null, level: "normal",
      set_at: "2026-05-21T03:00:00.000Z",
    }));
    await p.appendConfidentialityClassification(makeClassificationInput({
      id: "01jcaseclassmockorder0002b",
      prior_level: "normal", level: "confidential",
      set_at: "2026-05-21T04:00:00.000Z",
    }));
    await p.appendConfidentialityClassification(makeClassificationInput({
      id: "01jcaseclassmockorder0003c",
      prior_level: "confidential", level: "highly_confidential",
      set_at: "2026-05-21T02:00:00.000Z",
    }));
    await p.appendConfidentialityClassification(makeClassificationInput({
      id: "01jcaseclassmockorder0004d",
      prior_level: "confidential", level: "restricted",
      set_at: "2026-05-21T01:00:00.000Z",
    }));
    const page = await p.listConfidentialityClassifications({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    assert.equal(page.rows.length, 4);
    // ASC by set_at: 01:00 (r4), 02:00 (r3), 03:00 (r1), 04:00 (r2)
    assert.equal(page.rows[0].id, "01jcaseclassmockorder0004d");
    assert.equal(page.rows[1].id, "01jcaseclassmockorder0003c");
    assert.equal(page.rows[2].id, "01jcaseclassmockorder0001a");
    assert.equal(page.rows[3].id, "01jcaseclassmockorder0002b");
  });

  test(`${label}: 6.A2.18 listConfidentialityClassifications cursor-paginates correctly`, async () => {
    const p = await seedMatterDoc();
    let prior = null;
    for (let i = 0; i < 4; i++) {
      const lv = ["normal", "confidential", "highly_confidential", "restricted"][i];
      await p.appendConfidentialityClassification(makeClassificationInput({
        id: `01jcaseclassmockpage0000${(i + 0x10).toString(16)}`,
        prior_level: prior, level: lv,
        set_at: `2026-05-21T0${i + 1}:00:00.000Z`,
      }));
      prior = lv;
    }
    const page1 = await p.listConfidentialityClassifications({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, limit: 2,
    });
    assert.equal(page1.rows.length, 2);
    assert.equal(typeof page1.next_cursor, "string");
    const page2 = await p.listConfidentialityClassifications({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, limit: 2, cursor: page1.next_cursor,
    });
    assert.equal(page2.rows.length, 2);
    assert.equal(page2.next_cursor, null);
    const seen = new Set([...page1.rows, ...page2.rows].map((r) => r.id));
    assert.equal(seen.size, 4);
  });

  test(`${label}: 6.A2.19 listConfidentialityClassifications unknown matter → unknown_matter`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.listConfidentialityClassifications({ tenant_id: DEFAULT_TENANT_ID, matter_id: "01nonexistmatter00000000xx" }),
      "unknown_matter",
    );
  });

  test(`${label}: 6.A2.20 listConfidentialityClassifications tenant mismatch → tenant_mismatch`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.listConfidentialityClassifications({ tenant_id: "other-tenant", matter_id: DEFAULT_MATTER_ID }),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A2.21 listConfidentialityClassifications wrong-filter cursor → invalid_argument`, async () => {
    const p = await seedMatterDoc();
    for (let i = 0; i < 3; i++) {
      const lv = ["normal", "confidential", "highly_confidential"][i];
      await p.appendConfidentialityClassification(makeClassificationInput({
        id: `01jcaseclasswfilt0000000${(i + 0x10).toString(16)}`,
        prior_level: i === 0 ? null : ["normal", "confidential"][i - 1],
        level: lv,
        set_at: `2026-05-21T0${i + 1}:00:00.000Z`,
      }));
    }
    const page = await p.listConfidentialityClassifications({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, limit: 1,
    });
    const cursor = page.next_cursor;
    assert.ok(cursor);
    // Try using the cursor with a different filter (added target_type filter).
    await assertRejectsCode(
      () => p.listConfidentialityClassifications({
        tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, limit: 1,
        target_type: "document", cursor,
      }),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A2.22 list filtered by target_type + target_id`, async () => {
    const p = await seedMatterDoc();
    await p.appendConfidentialityClassification(makeClassificationInput());
    const page = await p.listConfidentialityClassifications({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID,
      target_type: "document", target_id: DEFAULT_DOCUMENT_ID,
    });
    assert.equal(page.rows.length, 1);
    assert.equal(page.rows[0].target_id, DEFAULT_DOCUMENT_ID);
  });

  test(`${label}: 6.A2.23 list filtered by target_type alone`, async () => {
    const p = await seedMatterDoc();
    await p.appendConfidentialityClassification(makeClassificationInput());
    const page = await p.listConfidentialityClassifications({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID,
      target_type: "document",
    });
    assert.equal(page.rows.length, 1);
  });

  test(`${label}: 6.A2.24 list target_id without target_type → invalid_argument`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.listConfidentialityClassifications({
        tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID,
        target_id: DEFAULT_DOCUMENT_ID,
      }),
      "invalid_argument",
    );
  });

  // ===========================================================================
  // Phase A3 — privilege markers
  // ===========================================================================

  test(`${label}: 6.A3.1 appendPrivilegeMarker proposed happy path`, async () => {
    const p = await seedMatterDoc();
    const row = await p.appendPrivilegeMarker(makePrivilegeMarkerInput());
    assert.equal(row.status, "proposed");
    assert.equal(row.kind, "attorney_client");
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.entity_type, "privilege_marker");
    assert.equal(evt.action, "create");
    assert.equal(evt.reason, undefined);
  });

  test(`${label}: 6.A3.2 appendPrivilegeMarker rejects direct status=confirmed`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendPrivilegeMarker(makePrivilegeMarkerInput({
        status: "confirmed",
        confirmed_actor_user_id: "local-user",
        confirmed_at: "2026-05-21T11:00:00.000Z",
      })),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A3.3 appendPrivilegeMarker rejects new status=dismissed`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendPrivilegeMarker(makePrivilegeMarkerInput({ status: "dismissed" })),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A3.4 appendPrivilegeMarker rejects new status=waived`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendPrivilegeMarker(makePrivilegeMarkerInput({ status: "waived" })),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A3.5 appendPrivilegeMarker accepts machine-source proposed`, async () => {
    const p = await seedMatterDoc();
    const row = await p.appendPrivilegeMarker(makePrivilegeMarkerInput({
      source_type: "llm_suggested",
      extractor_name: "claude-test",
      extractor_version: "1",
      extraction_confidence: 0.9,
    }));
    assert.equal(row.status, "proposed");
    assert.equal(row.source_type, "llm_suggested");
  });

  test(`${label}: 6.A3.6 appendPrivilegeMarker rejects non-null dismissal fields on new row`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendPrivilegeMarker(makePrivilegeMarkerInput({
        dismissed_actor_user_id: "local-user",
        dismissed_at: "2026-05-21T11:00:00.000Z",
        dismissal_reason: "ignored",
      })),
      "invalid_payload",
    );
  });

  test(`${label}: 6.A3.7 appendPrivilegeMarker rejects null proposed_at`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendPrivilegeMarker(makePrivilegeMarkerInput({ proposed_at: null })),
      "invalid_payload",
    );
  });

  test(`${label}: 6.A3.8 appendPrivilegeMarker rejects target_type="matter"`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendPrivilegeMarker(makePrivilegeMarkerInput({ target_type: "matter" })),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A3.9 appendPrivilegeMarker rejects target_type="fact"`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendPrivilegeMarker(makePrivilegeMarkerInput({ target_type: "fact" })),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A3.10 appendPrivilegeMarker rejects unknown document → unknown_document`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendPrivilegeMarker(makePrivilegeMarkerInput({ target_id: "01nonexistdocmockid0000007" })),
      "unknown_document",
    );
  });

  test(`${label}: 6.A3.11 appendPrivilegeMarker rejects tenant mismatch`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendPrivilegeMarker(makePrivilegeMarkerInput({ tenant_id: "other-tenant" })),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A3.12 appendPrivilegeMarker rejects matter_id mismatch`, async () => {
    const p = await seedMatterDoc();
    await p.createMatter(makeMatterInput({ id: "01jpriv2ndmatterid000a3a12" }));
    await assertRejectsCode(
      () => p.appendPrivilegeMarker(makePrivilegeMarkerInput({ matter_id: "01jpriv2ndmatterid000a3a12" })),
      "matter_id_mismatch",
    );
  });

  test(`${label}: 6.A3.13 appendPrivilegeMarker rejects duplicate id`, async () => {
    const p = await seedMatterDoc();
    await p.appendPrivilegeMarker(makePrivilegeMarkerInput());
    await assertRejectsCode(
      () => p.appendPrivilegeMarker(makePrivilegeMarkerInput()),
      "duplicate_id",
    );
  });

  test(`${label}: 6.A3.14 allows two proposed markers same (target, kind)`, async () => {
    const p = await seedMatterDoc();
    await p.appendPrivilegeMarker(makePrivilegeMarkerInput());
    const row2 = await p.appendPrivilegeMarker(makePrivilegeMarkerInput({
      id: "01jcasepmkmockid0000000002",
      proposed_at: "2026-05-21T11:00:00.000Z",
    }));
    assert.equal(row2.status, "proposed");
  });

  test(`${label}: 6.A3.A2b transitionPrivilegeMarker rejects unknown markerId`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.transitionPrivilegeMarker("01nonexistmarker000000000z", {
        to: "confirmed",
        actor_user_id: "local-user",
        at: "2026-05-21T11:00:00.000Z",
      }),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A3.15 transitionPrivilegeMarker proposed → confirmed`, async () => {
    const p = await seedMatterDoc();
    await p.appendPrivilegeMarker(makePrivilegeMarkerInput());
    const row = await p.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
      to: "confirmed",
      actor_user_id: "lawyer-01",
      at: "2026-05-21T11:00:00.000Z",
    });
    assert.equal(row.status, "confirmed");
    assert.equal(row.confirmed_actor_user_id, "lawyer-01");
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.entity_type, "privilege_marker");
    assert.equal(evt.action, "update");
    assert.equal(evt.reason, undefined);
  });

  test(`${label}: 6.A3.16 transitionPrivilegeMarker rejects duplicate confirmed (target, kind)`, async () => {
    const p = await seedMatterDoc();
    await p.appendPrivilegeMarker(makePrivilegeMarkerInput());
    await p.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
      to: "confirmed",
      actor_user_id: "lawyer-01",
      at: "2026-05-21T11:00:00.000Z",
    });
    await p.appendPrivilegeMarker(makePrivilegeMarkerInput({
      id: "01jcasepmkmockid0000000002",
      proposed_at: "2026-05-21T12:00:00.000Z",
    }));
    await assertRejectsCode(
      () => p.transitionPrivilegeMarker("01jcasepmkmockid0000000002", {
        to: "confirmed",
        actor_user_id: "lawyer-01",
        at: "2026-05-21T13:00:00.000Z",
      }),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A3.17 proposed → dismissed requires reason`, async () => {
    const p = await seedMatterDoc();
    await p.appendPrivilegeMarker(makePrivilegeMarkerInput());
    await assertRejectsCode(
      () => p.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
        to: "dismissed",
        actor_user_id: "lawyer-01",
        at: "2026-05-21T11:00:00.000Z",
      }),
      "invalid_argument",
    );
    const row = await p.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
      to: "dismissed",
      actor_user_id: "lawyer-01",
      at: "2026-05-21T11:00:00.000Z",
      reason: "not_privileged",
    });
    assert.equal(row.status, "dismissed");
    assert.equal(row.dismissal_reason, "not_privileged");
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.reason, "not_privileged");
  });

  test(`${label}: 6.A3.18 confirmed → waived requires reason`, async () => {
    const p = await seedMatterDoc();
    await p.appendPrivilegeMarker(makePrivilegeMarkerInput());
    await p.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
      to: "confirmed",
      actor_user_id: "lawyer-01",
      at: "2026-05-21T11:00:00.000Z",
    });
    await assertRejectsCode(
      () => p.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
        to: "waived",
        actor_user_id: "lawyer-01",
        at: "2026-05-21T12:00:00.000Z",
      }),
      "invalid_argument",
    );
    const row = await p.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
      to: "waived",
      actor_user_id: "lawyer-01",
      at: "2026-05-21T12:00:00.000Z",
      reason: "client_disclosure",
    });
    assert.equal(row.status, "waived");
    assert.equal(row.waiver_reason, "client_disclosure");
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.action, "privilege-waive");
    assert.equal(evt.reason, "client_disclosure");
  });

  test(`${label}: 6.A3.19 illegal transition (dismissed → confirmed)`, async () => {
    const p = await seedMatterDoc();
    await p.appendPrivilegeMarker(makePrivilegeMarkerInput());
    await p.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
      to: "dismissed",
      actor_user_id: "lawyer-01",
      at: "2026-05-21T11:00:00.000Z",
      reason: "not_privileged",
    });
    await assertRejectsCode(
      () => p.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
        to: "confirmed",
        actor_user_id: "lawyer-01",
        at: "2026-05-21T12:00:00.000Z",
      }),
      "illegal_transition",
    );
  });

  test(`${label}: 6.A3.20 post-waiver: new proposed marker for same (target, kind)`, async () => {
    const p = await seedMatterDoc();
    await p.appendPrivilegeMarker(makePrivilegeMarkerInput());
    await p.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
      to: "confirmed",
      actor_user_id: "lawyer-01",
      at: "2026-05-21T11:00:00.000Z",
    });
    await p.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
      to: "waived",
      actor_user_id: "lawyer-01",
      at: "2026-05-21T12:00:00.000Z",
      reason: "client_disclosure",
    });
    const row = await p.appendPrivilegeMarker(makePrivilegeMarkerInput({
      id: "01jcasepmkmockid0000000003",
      proposed_at: "2026-05-21T13:00:00.000Z",
    }));
    assert.equal(row.status, "proposed");
  });

  test(`${label}: 6.A3.20b post-waiver TRANSITION: new proposed → confirmed`, async () => {
    const p = await seedMatterDoc();
    await p.appendPrivilegeMarker(makePrivilegeMarkerInput());
    await p.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
      to: "confirmed",
      actor_user_id: "lawyer-01",
      at: "2026-05-21T11:00:00.000Z",
    });
    await p.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
      to: "waived",
      actor_user_id: "lawyer-01",
      at: "2026-05-21T12:00:00.000Z",
      reason: "client_disclosure",
    });
    await p.appendPrivilegeMarker(makePrivilegeMarkerInput({
      id: "01jcasepmkmockid0000000003",
      proposed_at: "2026-05-21T13:00:00.000Z",
    }));
    const row = await p.transitionPrivilegeMarker("01jcasepmkmockid0000000003", {
      to: "confirmed",
      actor_user_id: "lawyer-01",
      at: "2026-05-21T14:00:00.000Z",
    });
    assert.equal(row.status, "confirmed");
  });

  test(`${label}: 6.A3.21 timestamp ordering (confirmed_at < proposed_at)`, async () => {
    const p = await seedMatterDoc();
    await p.appendPrivilegeMarker(makePrivilegeMarkerInput({ proposed_at: "2026-05-21T15:00:00.000Z" }));
    await assertRejectsCode(
      () => p.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
        to: "confirmed",
        actor_user_id: "lawyer-01",
        at: "2026-05-21T10:00:00.000Z",
      }),
      "invalid_payload",
    );
  });

  test(`${label}: 6.A3.21b malformed (non-ISO) opts.at rejected → invalid_argument`, async () => {
    const p = await seedMatterDoc();
    await p.appendPrivilegeMarker(makePrivilegeMarkerInput());
    await assertRejectsCode(
      () => p.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
        to: "confirmed",
        actor_user_id: "lawyer-01",
        at: "May 21 2026",
      }),
      "invalid_argument",
    );
    // Confirm no audit mutation landed (the original marker is still proposed
    // with no audit events beyond matter+document+propose).
    const status = await p.getPrivilegeStatus({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID,
      target_type: "document", target_id: DEFAULT_DOCUMENT_ID,
    });
    assert.equal(status.hasProtectiveAssertion, false);
  });

  test(`${label}: 6.A3.22 getPrivilegeStatus empty → hasProtectiveAssertion: false`, async () => {
    const p = await seedMatterDoc();
    const res = await p.getPrivilegeStatus({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID,
      target_type: "document", target_id: DEFAULT_DOCUMENT_ID,
    });
    assert.equal(res.hasProtectiveAssertion, false);
    assert.equal(res.activeConfirmedMarkers.length, 0);
    assert.equal(res.allTargetMarkers.length, 0);
  });

  test(`${label}: 6.A3.23 getPrivilegeStatus with confirmed → hasProtectiveAssertion: true`, async () => {
    const p = await seedMatterDoc();
    await p.appendPrivilegeMarker(makePrivilegeMarkerInput());
    await p.transitionPrivilegeMarker(DEFAULT_PRIVILEGE_MARKER_ID, {
      to: "confirmed",
      actor_user_id: "lawyer-01",
      at: "2026-05-21T11:00:00.000Z",
    });
    const res = await p.getPrivilegeStatus({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID,
      target_type: "document", target_id: DEFAULT_DOCUMENT_ID,
    });
    assert.equal(res.hasProtectiveAssertion, true);
    assert.equal(res.activeConfirmedMarkers.length, 1);
  });

  test(`${label}: 6.A3.24 getPrivilegeStatus rejects unknown document`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.getPrivilegeStatus({
        tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID,
        target_type: "document", target_id: "01nonexistdocmockid0000007",
      }),
      "unknown_document",
    );
  });

  test(`${label}: 6.A3.25 listPrivilegeMarkers cursor + kind filter + proposed_at ASC`, async () => {
    const p = await seedMatterDoc();
    for (let i = 0; i < 4; i++) {
      await p.appendPrivilegeMarker(makePrivilegeMarkerInput({
        id: `01jcasepmkmocklist000000${(i + 0x10).toString(16)}`,
        proposed_at: `2026-05-21T1${i}:00:00.000Z`,
      }));
    }
    const page1 = await p.listPrivilegeMarkers({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID,
      kind: "attorney_client", limit: 2,
    });
    assert.equal(page1.rows.length, 2);
    assert.equal(typeof page1.next_cursor, "string");
    const page2 = await p.listPrivilegeMarkers({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID,
      kind: "attorney_client", limit: 2, cursor: page1.next_cursor,
    });
    assert.equal(page2.rows.length, 2);
    assert.equal(page2.next_cursor, null);
    // Ordered by proposed_at ASC
    const all = [...page1.rows, ...page2.rows];
    for (let i = 1; i < all.length; i++) {
      assert.ok(all[i - 1].proposed_at <= all[i].proposed_at);
    }
  });

  test(`${label}: 6.A3.26 listPrivilegeMarkers target_id without target_type → invalid_argument`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.listPrivilegeMarkers({
        tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID,
        target_id: DEFAULT_DOCUMENT_ID,
      }),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A3.27 listPrivilegeMarkers unknown matter`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.listPrivilegeMarkers({ tenant_id: DEFAULT_TENANT_ID, matter_id: "01nonexistmatter00000000xx" }),
      "unknown_matter",
    );
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
