// Conformance harness for Phase A1. Drives BOTH implementations through
// the same matrix of cases. In A1 only InMemoryCaseBoxPersistence runs
// against it; in Phase B+ the SQLite implementation runs the same suite.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DEADLINE_ID,
  DEFAULT_DOCKET_ENTRY_ID,
  DEFAULT_DOCUMENT_ID,
  DEFAULT_EVIDENCE_ID,
  DEFAULT_FACT_ID,
  DEFAULT_MATTER_ID,
  DEFAULT_PRIVILEGE_MARKER_ID,
  DEFAULT_TENANT_ID,
  makeClassificationInput,
  makeClock,
  makeDocketEntryInput,
  makeDocumentInput,
  makeEvidenceItemInput,
  makeFactInput,
  makeIdGenerator,
  makeMatterInput,
  makeOcrLinkInput,
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

  // ===========================================================================
  // Phase A4 — facts
  // ===========================================================================

  test(`${label}: 6.A4.1 appendFact candidate happy path`, async () => {
    const p = await seedMatterDoc();
    const row = await p.appendFact(makeFactInput());
    assert.equal(row.status, "candidate");
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.entity_type, "fact");
    assert.equal(evt.action, "create");
    assert.equal(evt.reason, undefined);
  });

  test(`${label}: 6.A4.2 appendFact rejects status=reviewed`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendFact(makeFactInput({ status: "reviewed", reviewer_actor_user_id: "lawyer-01", reviewed_at: "2026-05-21T16:00:00.000Z" })),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A4.3 appendFact rejects status=accepted`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendFact(makeFactInput({ status: "accepted" })),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A4.4 appendFact rejects status=rejected`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendFact(makeFactInput({ status: "rejected" })),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A4.5 appendFact rejects non-null reviewer fields on new row`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendFact(makeFactInput({ reviewer_actor_user_id: "lawyer-01" })),
      "invalid_payload",
    );
  });

  test(`${label}: 6.A4.6 appendFact rejects non-null supersedes_fact_id`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendFact(makeFactInput({ supersedes_fact_id: "01jcasefactmockid000000099" })),
      "invalid_payload",
    );
  });

  test(`${label}: 6.A4.7 appendFact rejects unknown matter`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendFact(makeFactInput({ matter_id: "01nonexistmatter00000000xx" })),
      "unknown_matter",
    );
  });

  test(`${label}: 6.A4.8 appendFact rejects tenant mismatch (matter level)`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendFact(makeFactInput({ tenant_id: "other-tenant" })),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A4.9 appendFact rejects matter_id mismatch`, async () => {
    const p = await seedMatterDoc();
    await p.createMatter(makeMatterInput({ id: "01jotherfactmattera4009007", tenant_id: "other-tenant" }));
    await assertRejectsCode(
      // fact has default tenant but matter has other-tenant → matter-level tenant_mismatch
      () => p.appendFact(makeFactInput({ matter_id: "01jotherfactmattera4009007" })),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A4.10 appendFact rejects unknown source_document_id`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendFact(makeFactInput({
        source_type: "ocr_excerpt",
        source_document_id: "01nonexistdocmockid0000007",
        source_page_number: 1,
        source_excerpt: "test",
        source_ocr_job_id: "01jocrjobmockid0a4t00000007",
        extractor_name: "test",
        extractor_version: "1",
        extraction_confidence: 0.9,
      })),
      "unknown_document",
    );
  });

  test(`${label}: 6.A4.10b appendFact rejects source_document_id from different matter`, async () => {
    const p = await seedMatterDoc();
    // Create a second matter + document under same tenant.
    const otherMatter = "01jothfactsrcmatter004010b";
    const otherDoc = "01jothfactsrcdoc000a04010b";
    await p.createMatter(makeMatterInput({ id: otherMatter }));
    await p.registerDocument(otherMatter, makeDocumentInput({ id: otherDoc, matter_id: otherMatter }));
    await assertRejectsCode(
      () => p.appendFact(makeFactInput({
        source_type: "ocr_excerpt",
        source_document_id: otherDoc,
        source_page_number: 1,
        source_excerpt: "test",
        source_ocr_job_id: "01jocrjobmockid0a4t00000007",
        extractor_name: "test",
        extractor_version: "1",
        extraction_confidence: 0.9,
      })),
      "matter_id_mismatch",
    );
  });

  test(`${label}: 6.A4.10c appendFact rejects source_document_id from different tenant`, async () => {
    const p = await seedMatterDoc();
    // Create a second matter with different tenant; register doc under it.
    const otherMatter = "01jothfactsrcmatter004010c";
    const otherDoc = "01jothfactsrcdoc000a04010c";
    await p.createMatter(makeMatterInput({ id: otherMatter, tenant_id: "other-tenant" }));
    await p.registerDocument(otherMatter, makeDocumentInput({
      id: otherDoc, matter_id: otherMatter, tenant_id: "other-tenant",
    }));
    await assertRejectsCode(
      () => p.appendFact(makeFactInput({
        source_type: "ocr_excerpt",
        source_document_id: otherDoc,
        source_page_number: 1,
        source_excerpt: "test",
        source_ocr_job_id: "01jocrjobmockid0a4t00000007",
        extractor_name: "test",
        extractor_version: "1",
        extraction_confidence: 0.9,
      })),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A4.11 appendFact accepts null source_document_id for lawyer_authored`, async () => {
    const p = await seedMatterDoc();
    const row = await p.appendFact(makeFactInput());
    assert.equal(row.source_document_id, null);
  });

  test(`${label}: 6.A4.12 appendFact rejects ocr_excerpt without source_document_id`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendFact(makeFactInput({
        source_type: "ocr_excerpt",
        source_document_id: null,
      })),
      "invalid_payload",
    );
  });

  test(`${label}: 6.A4.13 appendFact rejects duplicate id`, async () => {
    const p = await seedMatterDoc();
    await p.appendFact(makeFactInput());
    await assertRejectsCode(
      () => p.appendFact(makeFactInput()),
      "duplicate_id",
    );
  });

  test(`${label}: 6.A4.14 transitionFact rejects unknown factId`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.transitionFact("01nonexistfactmockid000000z", {
        to: "reviewed",
        reviewer_actor_user_id: "lawyer-01",
        at: "2026-05-21T16:00:00.000Z",
      }),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A4.15 transitionFact candidate → reviewed`, async () => {
    const p = await seedMatterDoc();
    await p.appendFact(makeFactInput());
    const row = await p.transitionFact(DEFAULT_FACT_ID, {
      to: "reviewed",
      reviewer_actor_user_id: "lawyer-01",
      at: "2026-05-21T16:00:00.000Z",
    });
    assert.equal(row.status, "reviewed");
    assert.equal(row.reviewer_actor_user_id, "lawyer-01");
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.entity_type, "fact");
    assert.equal(evt.action, "update");
    assert.equal(evt.reason, undefined);
  });

  test(`${label}: 6.A4.16 transitionFact candidate → rejected (shortcut, reason required)`, async () => {
    const p = await seedMatterDoc();
    await p.appendFact(makeFactInput());
    await assertRejectsCode(
      () => p.transitionFact(DEFAULT_FACT_ID, {
        to: "rejected",
        reviewer_actor_user_id: "lawyer-01",
        at: "2026-05-21T16:00:00.000Z",
      }),
      "invalid_argument",
    );
    const row = await p.transitionFact(DEFAULT_FACT_ID, {
      to: "rejected",
      reviewer_actor_user_id: "lawyer-01",
      at: "2026-05-21T16:00:00.000Z",
      rejection_reason: "not_relevant",
    });
    assert.equal(row.status, "rejected");
    assert.equal(row.rejection_reason, "not_relevant");
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.reason, "not_relevant");
  });

  test(`${label}: 6.A4.17 transitionFact reviewed → accepted (no supersession)`, async () => {
    const p = await seedMatterDoc();
    await p.appendFact(makeFactInput());
    await p.transitionFact(DEFAULT_FACT_ID, {
      to: "reviewed",
      reviewer_actor_user_id: "lawyer-01",
      at: "2026-05-21T16:00:00.000Z",
    });
    const row = await p.transitionFact(DEFAULT_FACT_ID, {
      to: "accepted",
      reviewer_actor_user_id: "lawyer-01",
      at: "2026-05-21T17:00:00.000Z",
    });
    assert.equal(row.status, "accepted");
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.action, "update");
  });

  test(`${label}: 6.A4.18 transitionFact reviewed → accepted WITH supersedes_fact_id`, async () => {
    const p = await seedMatterDoc();
    // First accepted fact
    await p.appendFact(makeFactInput());
    await p.transitionFact(DEFAULT_FACT_ID, { to: "reviewed", reviewer_actor_user_id: "lawyer-01", at: "2026-05-21T16:00:00.000Z" });
    await p.transitionFact(DEFAULT_FACT_ID, { to: "accepted", reviewer_actor_user_id: "lawyer-01", at: "2026-05-21T17:00:00.000Z" });
    // Second fact (replacement)
    const replacementId = "01jcasefactmockid000000002";
    await p.appendFact(makeFactInput({ id: replacementId, created_at: "2026-05-21T18:00:00.000Z" }));
    await p.transitionFact(replacementId, { to: "reviewed", reviewer_actor_user_id: "lawyer-01", at: "2026-05-21T19:00:00.000Z" });
    const row = await p.transitionFact(replacementId, {
      to: "accepted",
      reviewer_actor_user_id: "lawyer-01",
      at: "2026-05-21T20:00:00.000Z",
      supersedes_fact_id: DEFAULT_FACT_ID,
    });
    assert.equal(row.status, "accepted");
    assert.equal(row.supersedes_fact_id, DEFAULT_FACT_ID);
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.entity_type, "fact");
    assert.equal(evt.action, "create");
    assert.equal(evt.before_state_hash, null);
    // Verify chain still valid spanning the create-action replacement
    const ver = await p.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
    assert.equal(ver.ok, true);
  });

  test(`${label}: 6.A4.19 transitionFact reviewed → rejected (reason required)`, async () => {
    const p = await seedMatterDoc();
    await p.appendFact(makeFactInput());
    await p.transitionFact(DEFAULT_FACT_ID, { to: "reviewed", reviewer_actor_user_id: "lawyer-01", at: "2026-05-21T16:00:00.000Z" });
    await assertRejectsCode(
      () => p.transitionFact(DEFAULT_FACT_ID, { to: "rejected", reviewer_actor_user_id: "lawyer-01", at: "2026-05-21T17:00:00.000Z" }),
      "invalid_argument",
    );
    const row = await p.transitionFact(DEFAULT_FACT_ID, {
      to: "rejected",
      reviewer_actor_user_id: "lawyer-01",
      at: "2026-05-21T17:00:00.000Z",
      rejection_reason: "post_review_rejection",
    });
    assert.equal(row.status, "rejected");
    assert.equal(row.rejection_reason, "post_review_rejection");
  });

  test(`${label}: 6.A4.20 transitionFact illegal candidate → accepted`, async () => {
    const p = await seedMatterDoc();
    await p.appendFact(makeFactInput());
    await assertRejectsCode(
      () => p.transitionFact(DEFAULT_FACT_ID, {
        to: "accepted",
        reviewer_actor_user_id: "lawyer-01",
        at: "2026-05-21T16:00:00.000Z",
      }),
      "illegal_transition",
    );
  });

  test(`${label}: 6.A4.21 transitionFact self-supersession`, async () => {
    const p = await seedMatterDoc();
    await p.appendFact(makeFactInput());
    await p.transitionFact(DEFAULT_FACT_ID, { to: "reviewed", reviewer_actor_user_id: "lawyer-01", at: "2026-05-21T16:00:00.000Z" });
    await assertRejectsCode(
      () => p.transitionFact(DEFAULT_FACT_ID, {
        to: "accepted",
        reviewer_actor_user_id: "lawyer-01",
        at: "2026-05-21T17:00:00.000Z",
        supersedes_fact_id: DEFAULT_FACT_ID,
      }),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A4.22 transitionFact 2-cycle detected via tamper seam (corrupt state defense)`, async () => {
    // A 2-cycle is not constructible through the legal API because accepted
    // is terminal. To exercise the cycle walk's defense against pre-corrupt
    // state, this test uses the test-only tamper seam to inject a back-edge,
    // then asserts the walk rejects a new transition that would close the
    // cycle. Audit Dim 1 #1 fix: replaces a previously-trivial assert.
    const p = await seedMatterDoc();
    const factA = DEFAULT_FACT_ID;
    const factB = "01jcasefactcyclb000a4022bz"; // 26 chars
    await p.appendFact(makeFactInput());
    await p.transitionFact(factA, { to: "reviewed", reviewer_actor_user_id: "lawyer-01", at: "2026-05-21T16:00:00.000Z" });
    await p.transitionFact(factA, { to: "accepted", reviewer_actor_user_id: "lawyer-01", at: "2026-05-21T16:30:00.000Z" });
    await p.appendFact(makeFactInput({ id: factB, created_at: "2026-05-21T17:00:00.000Z" }));
    await p.transitionFact(factB, { to: "reviewed", reviewer_actor_user_id: "lawyer-01", at: "2026-05-21T17:30:00.000Z" });
    await p.transitionFact(factB, {
      to: "accepted",
      reviewer_actor_user_id: "lawyer-01",
      at: "2026-05-21T18:00:00.000Z",
      supersedes_fact_id: factA,
    });
    // Inject corruption: make A point back to B (impossible via API).
    const { _tamperFactSupersedesForTest, _internalFactStateForTest } = await import("../internals.mjs");
    _tamperFactSupersedesForTest(_internalFactStateForTest(p), factA, factB);
    // Now create C and try to transition it to accepted with supersedes=A.
    // The walk from A → B → A would loop; persistence must detect.
    const factC = "01jcasefactcyclc000a4022cz";
    await p.appendFact(makeFactInput({ id: factC, created_at: "2026-05-21T19:00:00.000Z" }));
    await p.transitionFact(factC, { to: "reviewed", reviewer_actor_user_id: "lawyer-01", at: "2026-05-21T19:30:00.000Z" });
    await assertRejectsCode(
      () => p.transitionFact(factC, {
        to: "accepted",
        reviewer_actor_user_id: "lawyer-01",
        at: "2026-05-21T20:00:00.000Z",
        supersedes_fact_id: factA,
      }),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A4.23 transitionFact N-cycle via chain walk (defensive on corrupt state)`, async () => {
    const p = await seedMatterDoc();
    // Build a chain: A accepted, B accepted (supersedes A), C in reviewed.
    // Attempting C.supersedes_fact_id = B should succeed (creates A←B←C chain, no cycle).
    const factA = DEFAULT_FACT_ID;
    const factB = "01jcasefactcyclb000a4023b9";
    const factC = "01jcasefactcyclb000a4023c9";
    await p.appendFact(makeFactInput());
    await p.transitionFact(factA, { to: "reviewed", reviewer_actor_user_id: "lawyer-01", at: "2026-05-21T16:00:00.000Z" });
    await p.transitionFact(factA, { to: "accepted", reviewer_actor_user_id: "lawyer-01", at: "2026-05-21T16:30:00.000Z" });
    await p.appendFact(makeFactInput({ id: factB, created_at: "2026-05-21T17:00:00.000Z" }));
    await p.transitionFact(factB, { to: "reviewed", reviewer_actor_user_id: "lawyer-01", at: "2026-05-21T17:30:00.000Z" });
    await p.transitionFact(factB, {
      to: "accepted",
      reviewer_actor_user_id: "lawyer-01",
      at: "2026-05-21T18:00:00.000Z",
      supersedes_fact_id: factA,
    });
    await p.appendFact(makeFactInput({ id: factC, created_at: "2026-05-21T19:00:00.000Z" }));
    await p.transitionFact(factC, { to: "reviewed", reviewer_actor_user_id: "lawyer-01", at: "2026-05-21T19:30:00.000Z" });
    // C.supersedes = B → chain is C→B→A. No cycle. Should succeed.
    const rowC = await p.transitionFact(factC, {
      to: "accepted",
      reviewer_actor_user_id: "lawyer-01",
      at: "2026-05-21T20:00:00.000Z",
      supersedes_fact_id: factB,
    });
    assert.equal(rowC.supersedes_fact_id, factB);
  });

  test(`${label}: 6.A4.24 transitionFact supersedes pointer references non-accepted fact`, async () => {
    const p = await seedMatterDoc();
    const factA = DEFAULT_FACT_ID;
    const factB = "01jcasefactnacb000a4024b97";
    await p.appendFact(makeFactInput());
    // Leave factA in candidate state.
    await p.appendFact(makeFactInput({ id: factB, created_at: "2026-05-21T17:00:00.000Z" }));
    await p.transitionFact(factB, { to: "reviewed", reviewer_actor_user_id: "lawyer-01", at: "2026-05-21T17:30:00.000Z" });
    await assertRejectsCode(
      () => p.transitionFact(factB, {
        to: "accepted",
        reviewer_actor_user_id: "lawyer-01",
        at: "2026-05-21T18:00:00.000Z",
        supersedes_fact_id: factA,
      }),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A4.25 transitionFact supersedes pointer references fact in different matter`, async () => {
    const p = await seedMatterDoc();
    const factA = DEFAULT_FACT_ID;
    await p.appendFact(makeFactInput());
    await p.transitionFact(factA, { to: "reviewed", reviewer_actor_user_id: "lawyer-01", at: "2026-05-21T16:00:00.000Z" });
    await p.transitionFact(factA, { to: "accepted", reviewer_actor_user_id: "lawyer-01", at: "2026-05-21T16:30:00.000Z" });
    // Other matter with its own document + fact
    const otherMatter = "01jothmatterfactcrs0a4025c";
    const otherDoc = "01jothdoccolfactcrs0a4025d";
    const otherFact = "01jothfactcrsa4025c97698b1";
    await p.createMatter(makeMatterInput({ id: otherMatter }));
    await p.registerDocument(otherMatter, makeDocumentInput({ id: otherDoc, matter_id: otherMatter }));
    await p.appendFact(makeFactInput({
      id: otherFact, matter_id: otherMatter,
      created_at: "2026-05-21T17:00:00.000Z",
    }));
    await p.transitionFact(otherFact, { to: "reviewed", reviewer_actor_user_id: "lawyer-01", at: "2026-05-21T17:30:00.000Z" });
    await assertRejectsCode(
      () => p.transitionFact(otherFact, {
        to: "accepted",
        reviewer_actor_user_id: "lawyer-01",
        at: "2026-05-21T18:00:00.000Z",
        supersedes_fact_id: factA, // factA is in default matter, not otherMatter
      }),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A4.26 transitionFact malformed opts.at`, async () => {
    const p = await seedMatterDoc();
    await p.appendFact(makeFactInput());
    await assertRejectsCode(
      () => p.transitionFact(DEFAULT_FACT_ID, {
        to: "reviewed",
        reviewer_actor_user_id: "lawyer-01",
        at: "May 21 2026",
      }),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A4.27 listFacts filter+chronological+cursor`, async () => {
    const p = await seedMatterDoc();
    for (let i = 0; i < 4; i++) {
      await p.appendFact(makeFactInput({
        id: `01jcasefactlist0000000a4${(i + 0x10).toString(16)}`,
        created_at: `2026-05-21T1${i}:00:00.000Z`,
      }));
    }
    const page1 = await p.listFacts({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, status: "candidate", limit: 2 });
    assert.equal(page1.rows.length, 2);
    assert.equal(typeof page1.next_cursor, "string");
    const page2 = await p.listFacts({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, status: "candidate", limit: 2, cursor: page1.next_cursor });
    assert.equal(page2.rows.length, 2);
    assert.equal(page2.next_cursor, null);
    const all = [...page1.rows, ...page2.rows];
    for (let i = 1; i < all.length; i++) {
      assert.ok(all[i - 1].created_at <= all[i].created_at);
    }
  });

  test(`${label}: 6.A4.27b listFacts source_document_id from different matter → matter_id_mismatch`, async () => {
    const p = await seedMatterDoc();
    const otherMatter = "01jothfactlsmatter04027b07";
    const otherDoc = "01jothfactlsdoc000a4027b07";
    await p.createMatter(makeMatterInput({ id: otherMatter }));
    await p.registerDocument(otherMatter, makeDocumentInput({ id: otherDoc, matter_id: otherMatter }));
    await assertRejectsCode(
      () => p.listFacts({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, source_document_id: otherDoc }),
      "matter_id_mismatch",
    );
  });

  test(`${label}: 6.A4.27c listFacts source_document_id from different tenant → tenant_mismatch`, async () => {
    const p = await seedMatterDoc();
    const otherMatter = "01jothfactlsmatter04027c07";
    const otherDoc = "01jothfactlsdoc000a4027c07";
    await p.createMatter(makeMatterInput({ id: otherMatter, tenant_id: "other-tenant" }));
    await p.registerDocument(otherMatter, makeDocumentInput({
      id: otherDoc, matter_id: otherMatter, tenant_id: "other-tenant",
    }));
    await assertRejectsCode(
      () => p.listFacts({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, source_document_id: otherDoc }),
      "tenant_mismatch",
    );
  });

  // ===========================================================================
  // Phase A5 — docket entries + deadline materialization
  // ===========================================================================

  test(`${label}: 6.A5.1 appendDocketEntry proposed happy path (datetime + IANA tz)`, async () => {
    const p = await seedMatterDoc();
    const row = await p.appendDocketEntry(makeDocketEntryInput());
    assert.equal(row.confirmation_state, "proposed");
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.entity_type, "docket_entry");
    assert.equal(evt.action, "create");
    assert.equal(evt.reason, undefined);
  });

  test(`${label}: 6.A5.2 appendDocketEntry rejects confirmation_state=confirmed`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendDocketEntry(makeDocketEntryInput({ confirmation_state: "confirmed" })),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A5.3 appendDocketEntry rejects confirmation_state=dismissed`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendDocketEntry(makeDocketEntryInput({ confirmation_state: "dismissed" })),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A5.4 appendDocketEntry rejects invalid IANA timezone on datetime entry`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendDocketEntry(makeDocketEntryInput({ proposed_due_at_timezone: "NotARealZone/Foo" })),
      "invalid_payload",
    );
  });

  test(`${label}: 6.A5.4b appendDocketEntry rejects invalid IANA timezone on date_only entry`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendDocketEntry(makeDocketEntryInput({
        proposed_due_at_kind: "date_only",
        proposed_due_at_timezone: "NotARealZone/Foo",
      })),
      "invalid_payload",
    );
  });

  test(`${label}: 6.A5.5 appendDocketEntry rejects datetime entry with null timezone`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendDocketEntry(makeDocketEntryInput({ proposed_due_at_timezone: null })),
      "invalid_payload",
    );
  });

  test(`${label}: 6.A5.6 appendDocketEntry accepts date_only entry (null timezone OK)`, async () => {
    const p = await seedMatterDoc();
    const row = await p.appendDocketEntry(makeDocketEntryInput({
      proposed_due_at_kind: "date_only",
      proposed_due_at_timezone: null,
    }));
    assert.equal(row.proposed_due_at_kind, "date_only");
  });

  test(`${label}: 6.A5.7 appendDocketEntry rejects non-null confirmation fields`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendDocketEntry(makeDocketEntryInput({ confirmation_actor_user_id: "lawyer-01" })),
      "invalid_payload",
    );
  });

  test(`${label}: 6.A5.8 appendDocketEntry rejects unknown matter`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendDocketEntry(makeDocketEntryInput({ matter_id: "01nonexistmatter00000000xx" })),
      "unknown_matter",
    );
  });

  test(`${label}: 6.A5.9 appendDocketEntry rejects matter-level tenant mismatch`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendDocketEntry(makeDocketEntryInput({ tenant_id: "other-tenant" })),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A5.10 appendDocketEntry rejects unknown source_document_id`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendDocketEntry(makeDocketEntryInput({ source_document_id: "01nonexistdocmockid0000007" })),
      "unknown_document",
    );
  });

  test(`${label}: 6.A5.11 appendDocketEntry rejects cross-matter source_document_id`, async () => {
    const p = await seedMatterDoc();
    const otherMatter = "01jotherdocmockmatter54a11";
    const otherDoc = "01jotherdockmockdocs5a4a11";
    await p.createMatter(makeMatterInput({ id: otherMatter }));
    await p.registerDocument(otherMatter, makeDocumentInput({ id: otherDoc, matter_id: otherMatter }));
    await assertRejectsCode(
      () => p.appendDocketEntry(makeDocketEntryInput({ source_document_id: otherDoc })),
      "matter_id_mismatch",
    );
  });

  test(`${label}: 6.A5.12 appendDocketEntry rejects duplicate id`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput());
    await assertRejectsCode(
      () => p.appendDocketEntry(makeDocketEntryInput()),
      "duplicate_id",
    );
  });

  test(`${label}: 6.A5.13 confirmDocketEntry Mode B happy path`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput());
    const result = await p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "lawyer-01",
      confirmed_at: "2026-05-21T21:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    });
    assert.equal(result.idempotent, false);
    assert.equal(result.entry.confirmation_state, "confirmed");
    assert.equal(result.entry.confirmed_deadline_id, DEFAULT_DEADLINE_ID);
    assert.equal(result.deadline.id, DEFAULT_DEADLINE_ID);
    assert.equal(result.deadline.status, "pending");
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const e1 = page.rows[page.rows.length - 2];
    const e2 = page.rows[page.rows.length - 1];
    assert.equal(e1.entity_type, "docket_entry");
    assert.equal(e1.action, "update");
    assert.equal(e2.entity_type, "deadline");
    assert.equal(e2.action, "create");
    assert.equal(e2.before_state_hash, null);
    const ver = await p.verifyAuditChainForMatter(DEFAULT_MATTER_ID);
    assert.equal(ver.ok, true);
  });

  test(`${label}: 6.A5.14 confirmDocketEntry rejects date_only confirmation`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput({
      proposed_due_at_kind: "date_only",
      proposed_due_at_timezone: null,
    }));
    await assertRejectsCode(
      () => p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
        confirmation_actor_user_id: "lawyer-01",
        confirmed_at: "2026-05-21T21:00:00.000Z",
        deadline_id: DEFAULT_DEADLINE_ID,
      }),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A5.15 confirmDocketEntry idempotent re-confirm`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput());
    const first = await p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "lawyer-01",
      confirmed_at: "2026-05-21T21:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    });
    const auditCountAfterFirst = (await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID })).rows.length;
    const second = await p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "lawyer-02",
      confirmed_at: "2026-05-21T22:00:00.000Z",
      deadline_id: "01anyotherdeadlineid000000",
    });
    assert.equal(second.idempotent, true);
    assert.equal(second.deadline.id, first.deadline.id);
    const auditCountAfterSecond = (await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID })).rows.length;
    assert.equal(auditCountAfterSecond, auditCountAfterFirst);
  });

  test(`${label}: 6.A5.16 confirmDocketEntry rejects unknown entryId`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.confirmDocketEntry("01nonexistdocketid00000000", {
        confirmation_actor_user_id: "lawyer-01",
        confirmed_at: "2026-05-21T21:00:00.000Z",
        deadline_id: DEFAULT_DEADLINE_ID,
      }),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A5.17 confirmDocketEntry rejects confirming a dismissed entry`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput());
    await p.dismissDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      dismissal_actor_user_id: "lawyer-01",
      dismissed_at: "2026-05-21T21:00:00.000Z",
      dismissal_reason: "withdrawn",
    });
    await assertRejectsCode(
      () => p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
        confirmation_actor_user_id: "lawyer-01",
        confirmed_at: "2026-05-21T22:00:00.000Z",
        deadline_id: DEFAULT_DEADLINE_ID,
      }),
      "illegal_transition",
    );
  });

  test(`${label}: 6.A5.18a confirmDocketEntry Mode B atomicity — duplicate deadline_id`, async () => {
    const p = await seedMatterDoc();
    // Confirm a first entry to create a deadline.
    await p.appendDocketEntry(makeDocketEntryInput());
    await p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "lawyer-01",
      confirmed_at: "2026-05-21T21:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    });
    // Create a second entry.
    const secondEntry = "01jcasedock2mockid0000018a";
    await p.appendDocketEntry(makeDocketEntryInput({
      id: secondEntry, proposed_at: "2026-05-21T22:00:00.000Z", created_at: "2026-05-21T22:00:00.000Z",
    }));
    const auditsBefore = (await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID })).rows.length;
    // Attempt confirm with DUPLICATE deadline_id.
    await assertRejectsCode(
      () => p.confirmDocketEntry(secondEntry, {
        confirmation_actor_user_id: "lawyer-01",
        confirmed_at: "2026-05-21T23:00:00.000Z",
        deadline_id: DEFAULT_DEADLINE_ID,
      }),
      "duplicate_id",
    );
    // Entry unchanged
    const entry2 = await p.getDocketEntry({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, entry_id: secondEntry });
    assert.equal(entry2.confirmation_state, "proposed");
    // Zero audit events emitted from the failed confirm
    const auditsAfter = (await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID })).rows.length;
    assert.equal(auditsAfter, auditsBefore);
  });

  test(`${label}: 6.A5.18b confirmDocketEntry Mode B atomicity — validateDeadline failure (malformed deadline_id)`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput());
    const auditsBefore = (await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID })).rows.length;
    await assertRejectsCode(
      () => p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
        confirmation_actor_user_id: "lawyer-01",
        confirmed_at: "2026-05-21T21:00:00.000Z",
        deadline_id: "BAD-ID-NOT-ULID",
      }),
      "invalid_argument",
    );
    const entry = await p.getDocketEntry({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, entry_id: DEFAULT_DOCKET_ENTRY_ID });
    assert.equal(entry.confirmation_state, "proposed");
    const auditsAfter = (await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID })).rows.length;
    assert.equal(auditsAfter, auditsBefore);
  });

  test(`${label}: 6.A5.19 confirmDocketEntry deadline materialization field mapping`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput({
      proposed_kind: "hearing",
      proposed_due_at: "2026-07-01T10:00:00.000Z",
      proposed_owner_user_id: "owner-x",
    }));
    const { deadline } = await p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "lawyer-01",
      confirmed_at: "2026-05-21T21:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    });
    assert.equal(deadline.kind, "hearing");
    assert.equal(deadline.due_at, "2026-07-01T10:00:00.000Z");
    assert.equal(deadline.owner_user_id, "owner-x");
    assert.equal(deadline.actor_user_id, "lawyer-01");
    assert.equal(deadline.status, "pending");
  });

  test(`${label}: 6.A5.19b confirmDocketEntry omits null source_rule_citation`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput()); // source_rule_citation default null
    const { deadline } = await p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "lawyer-01",
      confirmed_at: "2026-05-21T21:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    });
    assert.ok(!Object.prototype.hasOwnProperty.call(deadline, "source_rule_citation"));
  });

  test(`${label}: 6.A5.19c confirmDocketEntry confirming-actor binding`, async () => {
    const p = await seedMatterDoc();
    // Proposer = alice
    await p.appendDocketEntry(makeDocketEntryInput({ actor_user_id: "alice" }));
    // Confirmer = bob
    const { deadline } = await p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "bob",
      confirmed_at: "2026-05-21T21:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    });
    assert.equal(deadline.actor_user_id, "bob");
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const e1 = page.rows[page.rows.length - 2];
    const e2 = page.rows[page.rows.length - 1];
    assert.equal(e1.actor_user_id, "bob");
    assert.equal(e2.actor_user_id, "bob");
  });

  test(`${label}: 6.A5.20 dismissDocketEntry requires reason`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput());
    await assertRejectsCode(
      () => p.dismissDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
        dismissal_actor_user_id: "lawyer-01",
        dismissed_at: "2026-05-21T21:00:00.000Z",
        dismissal_reason: "",
      }),
      "invalid_argument",
    );
    const row = await p.dismissDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      dismissal_actor_user_id: "lawyer-01",
      dismissed_at: "2026-05-21T21:00:00.000Z",
      dismissal_reason: "court_withdrew",
    });
    assert.equal(row.confirmation_state, "dismissed");
    assert.equal(row.dismissal_reason, "court_withdrew");
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.reason, "court_withdrew");
  });

  test(`${label}: 6.A5.21 dismissDocketEntry rejects re-dismissing dismissed entry`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput());
    await p.dismissDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      dismissal_actor_user_id: "lawyer-01",
      dismissed_at: "2026-05-21T21:00:00.000Z",
      dismissal_reason: "first",
    });
    await assertRejectsCode(
      () => p.dismissDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
        dismissal_actor_user_id: "lawyer-01",
        dismissed_at: "2026-05-21T22:00:00.000Z",
        dismissal_reason: "second",
      }),
      "illegal_transition",
    );
  });

  test(`${label}: 6.A5.22 dismissDocketEntry rejects dismissing confirmed entry`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput());
    await p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "lawyer-01",
      confirmed_at: "2026-05-21T21:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    });
    await assertRejectsCode(
      () => p.dismissDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
        dismissal_actor_user_id: "lawyer-01",
        dismissed_at: "2026-05-21T22:00:00.000Z",
        dismissal_reason: "too_late",
      }),
      "illegal_transition",
    );
  });

  test(`${label}: 6.A5.23 getDocketEntry scoped`, async () => {
    const p = await seedMatterDoc();
    const missing = await p.getDocketEntry({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, entry_id: "01nonexistdock00000a5a02300",
    });
    assert.equal(missing, null);
    await p.appendDocketEntry(makeDocketEntryInput());
    const found = await p.getDocketEntry({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, entry_id: DEFAULT_DOCKET_ENTRY_ID,
    });
    assert.equal(found.id, DEFAULT_DOCKET_ENTRY_ID);
    const otherMatter = "01jcasea5dockscope00m23a02";
    await p.createMatter(makeMatterInput({ id: otherMatter }));
    const cross = await p.getDocketEntry({
      tenant_id: DEFAULT_TENANT_ID, matter_id: otherMatter, entry_id: DEFAULT_DOCKET_ENTRY_ID,
    });
    assert.equal(cross, null);
    const otherTen = "01jcasea5dockscope00t23a02";
    await p.createMatter(makeMatterInput({ id: otherTen, tenant_id: "other-tenant" }));
    await assertRejectsCode(
      () => p.getDocketEntry({ tenant_id: DEFAULT_TENANT_ID, matter_id: otherTen, entry_id: DEFAULT_DOCKET_ENTRY_ID }),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A5.24 listDocketEntries cursor + filter`, async () => {
    const p = await seedMatterDoc();
    for (let i = 0; i < 4; i++) {
      await p.appendDocketEntry(makeDocketEntryInput({
        id: `01jcasedockmocklist000a5${(i + 0x10).toString(16)}`,
        proposed_at: `2026-05-21T2${i}:00:00.000Z`,
      }));
    }
    const page1 = await p.listDocketEntries({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, limit: 2 });
    assert.equal(page1.rows.length, 2);
    const page2 = await p.listDocketEntries({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, limit: 2, cursor: page1.next_cursor });
    assert.equal(page2.rows.length, 2);
    assert.equal(page2.next_cursor, null);
  });

  test(`${label}: 6.A5.25 listDocketEntries unknown matter`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.listDocketEntries({ tenant_id: DEFAULT_TENANT_ID, matter_id: "01nonexistmatter00000000xx" }),
      "unknown_matter",
    );
  });

  test(`${label}: 6.A5.26 transitionDeadline pending → met`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput());
    await p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "lawyer-01",
      confirmed_at: "2026-05-21T21:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    });
    const row = await p.transitionDeadline(DEFAULT_DEADLINE_ID, {
      to: "met",
      actor_user_id: "lawyer-01",
      at: "2026-06-15T17:00:00.000Z",
    });
    assert.equal(row.status, "met");
    assert.equal(row.met_at, "2026-06-15T17:00:00.000Z");
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.entity_type, "deadline");
    assert.equal(evt.action, "update");
    assert.equal(evt.reason, undefined);
  });

  test(`${label}: 6.A5.27 transitionDeadline pending → missed`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput());
    await p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "lawyer-01",
      confirmed_at: "2026-05-21T21:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    });
    const row = await p.transitionDeadline(DEFAULT_DEADLINE_ID, {
      to: "missed",
      actor_user_id: "lawyer-01",
      at: "2026-06-15T17:00:00.000Z",
    });
    assert.equal(row.status, "missed");
    // Confirm contract: no missed_at field exists in the deadline schema.
    assert.ok(!Object.prototype.hasOwnProperty.call(row, "missed_at"));
  });

  test(`${label}: 6.A5.28 transitionDeadline pending → withdrawn`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput());
    await p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "lawyer-01",
      confirmed_at: "2026-05-21T21:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    });
    const row = await p.transitionDeadline(DEFAULT_DEADLINE_ID, {
      to: "withdrawn",
      actor_user_id: "lawyer-01",
      at: "2026-06-15T17:00:00.000Z",
    });
    assert.equal(row.status, "withdrawn");
    assert.ok(!Object.prototype.hasOwnProperty.call(row, "withdrawn_at"));
  });

  test(`${label}: 6.A5.29 transitionDeadline missed → met requires reason`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput());
    await p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "lawyer-01",
      confirmed_at: "2026-05-21T21:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    });
    await p.transitionDeadline(DEFAULT_DEADLINE_ID, {
      to: "missed",
      actor_user_id: "lawyer-01",
      at: "2026-06-15T17:00:00.000Z",
    });
    await assertRejectsCode(
      () => p.transitionDeadline(DEFAULT_DEADLINE_ID, {
        to: "met",
        actor_user_id: "lawyer-01",
        at: "2026-06-16T10:00:00.000Z",
      }),
      "invalid_argument",
    );
    const row = await p.transitionDeadline(DEFAULT_DEADLINE_ID, {
      to: "met",
      actor_user_id: "lawyer-01",
      at: "2026-06-16T10:00:00.000Z",
      transition_reason: "extension_granted",
    });
    assert.equal(row.status, "met");
    assert.equal(row.previous_status, "missed");
    assert.equal(row.transition_reason, "extension_granted");
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.reason, "extension_granted");
  });

  test(`${label}: 6.A5.30 transitionDeadline rejects met → missed (terminal)`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput());
    await p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "lawyer-01",
      confirmed_at: "2026-05-21T21:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    });
    await p.transitionDeadline(DEFAULT_DEADLINE_ID, {
      to: "met",
      actor_user_id: "lawyer-01",
      at: "2026-06-15T17:00:00.000Z",
    });
    await assertRejectsCode(
      () => p.transitionDeadline(DEFAULT_DEADLINE_ID, {
        to: "missed",
        actor_user_id: "lawyer-01",
        at: "2026-06-16T10:00:00.000Z",
      }),
      "illegal_transition",
    );
  });

  test(`${label}: 6.A5.31 transitionDeadline unknown deadlineId`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.transitionDeadline("01nonexistdline00000a5a031", {
        to: "met",
        actor_user_id: "lawyer-01",
        at: "2026-06-15T17:00:00.000Z",
      }),
      "invalid_argument",
    );
  });

  // ===========================================================================
  // Phase A6 — evidence items
  // ===========================================================================

  test(`${label}: 6.A6.1 appendEvidenceItem proposed happy path`, async () => {
    const p = await seedMatterDoc();
    const row = await p.appendEvidenceItem(makeEvidenceItemInput());
    assert.equal(row.status, "proposed");
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.entity_type, "evidence_item");
    assert.equal(evt.action, "create");
  });

  test(`${label}: 6.A6.2 rejects status=accepted`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendEvidenceItem(makeEvidenceItemInput({ status: "accepted" })),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A6.3 rejects status=rejected`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendEvidenceItem(makeEvidenceItemInput({ status: "rejected" })),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A6.4 rejects status=superseded`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendEvidenceItem(makeEvidenceItemInput({ status: "superseded" })),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A6.5 rejects non-null supersedes_evidence_id at append`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendEvidenceItem(makeEvidenceItemInput({ supersedes_evidence_id: "01anyotherevidence00000a6a" })),
      "invalid_payload",
    );
  });

  test(`${label}: 6.A6.5b accepts proposed append with omitted supersedes_evidence_id`, async () => {
    const p = await seedMatterDoc();
    const input = makeEvidenceItemInput();
    delete input.supersedes_evidence_id;
    const row = await p.appendEvidenceItem(input);
    assert.equal(row.status, "proposed");
  });

  test(`${label}: 6.A6.6 rejects unknown matter`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendEvidenceItem(makeEvidenceItemInput({ matter_id: "01nonexistmatter00000000xx" })),
      "unknown_matter",
    );
  });

  test(`${label}: 6.A6.7 rejects matter-level tenant mismatch`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendEvidenceItem(makeEvidenceItemInput({ tenant_id: "other-tenant" })),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A6.8 rejects unknown source_document_id`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendEvidenceItem(makeEvidenceItemInput({ source_document_id: "01nonexistdocmockid0000007" })),
      "unknown_document",
    );
  });

  test(`${label}: 6.A6.9 rejects cross-matter source_document_id`, async () => {
    const p = await seedMatterDoc();
    const otherMatter = "01jothereviddocmatter6a009";
    const otherDoc = "01jotherevidcrossdoc6a009a";
    await p.createMatter(makeMatterInput({ id: otherMatter }));
    await p.registerDocument(otherMatter, makeDocumentInput({ id: otherDoc, matter_id: otherMatter }));
    await assertRejectsCode(
      () => p.appendEvidenceItem(makeEvidenceItemInput({ source_document_id: otherDoc })),
      "matter_id_mismatch",
    );
  });

  test(`${label}: 6.A6.10 rejects duplicate id`, async () => {
    const p = await seedMatterDoc();
    await p.appendEvidenceItem(makeEvidenceItemInput());
    await assertRejectsCode(
      () => p.appendEvidenceItem(makeEvidenceItemInput()),
      "duplicate_id",
    );
  });

  test(`${label}: 6.A6.11 transitionEvidenceItem proposed → accepted`, async () => {
    const p = await seedMatterDoc();
    await p.appendEvidenceItem(makeEvidenceItemInput());
    const row = await p.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, {
      to: "accepted",
      actor_user_id: "lawyer-01",
      at: "2026-05-21T23:00:00.000Z",
    });
    assert.equal(row.status, "accepted");
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.action, "update");
  });

  test(`${label}: 6.A6.12 transitionEvidenceItem proposed → rejected`, async () => {
    const p = await seedMatterDoc();
    await p.appendEvidenceItem(makeEvidenceItemInput());
    const row = await p.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, {
      to: "rejected",
      actor_user_id: "lawyer-01",
      at: "2026-05-21T23:00:00.000Z",
    });
    assert.equal(row.status, "rejected");
  });

  test(`${label}: 6.A6.13 accepted → superseded with replacement_evidence_id`, async () => {
    const p = await seedMatterDoc();
    // First evidence (will be superseded)
    await p.appendEvidenceItem(makeEvidenceItemInput());
    await p.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, { to: "accepted", actor_user_id: "lawyer-01", at: "2026-05-21T23:00:00.000Z" });
    // Replacement
    const replacementId = "01jcaseevidmockid000000002";
    await p.appendEvidenceItem(makeEvidenceItemInput({ id: replacementId, created_at: "2026-05-22T00:00:00.000Z" }));
    await p.transitionEvidenceItem(replacementId, { to: "accepted", actor_user_id: "lawyer-01", at: "2026-05-22T01:00:00.000Z" });
    // Supersede the original
    const row = await p.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, {
      to: "superseded",
      actor_user_id: "lawyer-01",
      at: "2026-05-22T02:00:00.000Z",
      replacement_evidence_id: replacementId,
    });
    assert.equal(row.status, "superseded");
    assert.equal(row.supersedes_evidence_id, replacementId);
  });

  test(`${label}: 6.A6.14 accepted → superseded without replacement_evidence_id`, async () => {
    const p = await seedMatterDoc();
    await p.appendEvidenceItem(makeEvidenceItemInput());
    await p.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, { to: "accepted", actor_user_id: "lawyer-01", at: "2026-05-21T23:00:00.000Z" });
    await assertRejectsCode(
      () => p.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, {
        to: "superseded",
        actor_user_id: "lawyer-01",
        at: "2026-05-22T00:00:00.000Z",
      }),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A6.15 accepted → superseded with unknown replacement_evidence_id`, async () => {
    const p = await seedMatterDoc();
    await p.appendEvidenceItem(makeEvidenceItemInput());
    await p.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, { to: "accepted", actor_user_id: "lawyer-01", at: "2026-05-21T23:00:00.000Z" });
    await assertRejectsCode(
      () => p.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, {
        to: "superseded",
        actor_user_id: "lawyer-01",
        at: "2026-05-22T00:00:00.000Z",
        replacement_evidence_id: "01nonexistreplevidid000000",
      }),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A6.16 accepted → superseded with cross-matter replacement`, async () => {
    const p = await seedMatterDoc();
    await p.appendEvidenceItem(makeEvidenceItemInput());
    await p.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, { to: "accepted", actor_user_id: "lawyer-01", at: "2026-05-21T23:00:00.000Z" });
    const otherMatter = "01jothmatterevcross6a016a0";
    const otherEvidence = "01jothmevcrossid006a016a02";
    await p.createMatter(makeMatterInput({ id: otherMatter }));
    await p.appendEvidenceItem(makeEvidenceItemInput({ id: otherEvidence, matter_id: otherMatter, created_at: "2026-05-22T00:00:00.000Z" }));
    await assertRejectsCode(
      () => p.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, {
        to: "superseded",
        actor_user_id: "lawyer-01",
        at: "2026-05-22T01:00:00.000Z",
        replacement_evidence_id: otherEvidence,
      }),
      "matter_id_mismatch",
    );
  });

  test(`${label}: 6.A6.17 rejects illegal proposed → superseded`, async () => {
    const p = await seedMatterDoc();
    await p.appendEvidenceItem(makeEvidenceItemInput());
    // Skip the accept step; try to supersede directly from proposed.
    const replacementId = "01jcaseevidmockid000000003";
    await p.appendEvidenceItem(makeEvidenceItemInput({ id: replacementId, created_at: "2026-05-22T00:00:00.000Z" }));
    await p.transitionEvidenceItem(replacementId, { to: "accepted", actor_user_id: "lawyer-01", at: "2026-05-22T01:00:00.000Z" });
    await assertRejectsCode(
      () => p.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, {
        to: "superseded",
        actor_user_id: "lawyer-01",
        at: "2026-05-22T02:00:00.000Z",
        replacement_evidence_id: replacementId,
      }),
      "illegal_transition",
    );
  });

  test(`${label}: 6.A6.18b rejects re-transitioning a superseded entry (terminal)`, async () => {
    const p = await seedMatterDoc();
    await p.appendEvidenceItem(makeEvidenceItemInput());
    await p.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, { to: "accepted", actor_user_id: "lawyer-01", at: "2026-05-21T23:00:00.000Z" });
    const replacementId = "01jcaseevidmockid0006a018b";
    await p.appendEvidenceItem(makeEvidenceItemInput({ id: replacementId, created_at: "2026-05-22T00:00:00.000Z" }));
    await p.transitionEvidenceItem(replacementId, { to: "accepted", actor_user_id: "lawyer-01", at: "2026-05-22T01:00:00.000Z" });
    await p.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, {
      to: "superseded", actor_user_id: "lawyer-01", at: "2026-05-22T02:00:00.000Z",
      replacement_evidence_id: replacementId,
    });
    // superseded is terminal; any further transition rejects.
    await assertRejectsCode(
      () => p.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, {
        to: "rejected", actor_user_id: "lawyer-01", at: "2026-05-22T03:00:00.000Z",
      }),
      "illegal_transition",
    );
  });

  test(`${label}: 6.A6.18 rejects re-transitioning a rejected entry`, async () => {
    const p = await seedMatterDoc();
    await p.appendEvidenceItem(makeEvidenceItemInput());
    await p.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, { to: "rejected", actor_user_id: "lawyer-01", at: "2026-05-21T23:00:00.000Z" });
    await assertRejectsCode(
      () => p.transitionEvidenceItem(DEFAULT_EVIDENCE_ID, {
        to: "accepted",
        actor_user_id: "lawyer-01",
        at: "2026-05-22T00:00:00.000Z",
      }),
      "illegal_transition",
    );
  });

  test(`${label}: 6.A6.19 getEvidenceItem scoped`, async () => {
    const p = await seedMatterDoc();
    const missing = await p.getEvidenceItem({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, evidence_id: "01nonexistevidlookup6a019a",
    });
    assert.equal(missing, null);
    await p.appendEvidenceItem(makeEvidenceItemInput());
    const found = await p.getEvidenceItem({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, evidence_id: DEFAULT_EVIDENCE_ID,
    });
    assert.equal(found.id, DEFAULT_EVIDENCE_ID);
    const otherMatter = "01jothmatterevidscope6a019";
    await p.createMatter(makeMatterInput({ id: otherMatter }));
    const cross = await p.getEvidenceItem({
      tenant_id: DEFAULT_TENANT_ID, matter_id: otherMatter, evidence_id: DEFAULT_EVIDENCE_ID,
    });
    assert.equal(cross, null);
    const otherTen = "01jothteneveidscope006a019";
    await p.createMatter(makeMatterInput({ id: otherTen, tenant_id: "other-tenant" }));
    await assertRejectsCode(
      () => p.getEvidenceItem({ tenant_id: DEFAULT_TENANT_ID, matter_id: otherTen, evidence_id: DEFAULT_EVIDENCE_ID }),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A6.20 listEvidenceItems cursor + status filter + chronological ASC`, async () => {
    const p = await seedMatterDoc();
    for (let i = 0; i < 4; i++) {
      await p.appendEvidenceItem(makeEvidenceItemInput({
        id: `01jcaseevidlistmock000a6${(i + 0x10).toString(16)}`,
        created_at: `2026-05-22T0${i}:00:00.000Z`,
      }));
    }
    const page1 = await p.listEvidenceItems({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, status: "proposed", limit: 2 });
    assert.equal(page1.rows.length, 2);
    const page2 = await p.listEvidenceItems({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, status: "proposed", limit: 2, cursor: page1.next_cursor });
    assert.equal(page2.rows.length, 2);
    assert.equal(page2.next_cursor, null);
    const all = [...page1.rows, ...page2.rows];
    for (let i = 1; i < all.length; i++) {
      assert.ok(all[i - 1].created_at <= all[i].created_at);
    }
  });

  test(`${label}: 6.A6.21b listEvidenceItems source_document_id cross-tenant`, async () => {
    const p = await seedMatterDoc();
    const otherMatter = "01jothmevlistxten6a021b012";
    const otherDoc = "01jothmevxtendocs0006a021b";
    await p.createMatter(makeMatterInput({ id: otherMatter, tenant_id: "other-tenant" }));
    await p.registerDocument(otherMatter, makeDocumentInput({
      id: otherDoc, matter_id: otherMatter, tenant_id: "other-tenant",
    }));
    await assertRejectsCode(
      () => p.listEvidenceItems({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, source_document_id: otherDoc }),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A6.21 listEvidenceItems source_document_id cross-matter`, async () => {
    const p = await seedMatterDoc();
    const otherMatter = "01jothmevlistxmat6a021m012";
    const otherDoc = "01jothmevxmatdocs0006a021d";
    await p.createMatter(makeMatterInput({ id: otherMatter }));
    await p.registerDocument(otherMatter, makeDocumentInput({ id: otherDoc, matter_id: otherMatter }));
    await assertRejectsCode(
      () => p.listEvidenceItems({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, source_document_id: otherDoc }),
      "matter_id_mismatch",
    );
  });

  test(`${label}: 6.A6.22 listEvidenceItems unknown matter`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.listEvidenceItems({ tenant_id: DEFAULT_TENANT_ID, matter_id: "01nonexistmatter00000000xx" }),
      "unknown_matter",
    );
  });

  test(`${label}: 6.A5.32 transitionDeadline malformed opts.at`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput());
    await p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "lawyer-01",
      confirmed_at: "2026-05-21T21:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    });
    await assertRejectsCode(
      () => p.transitionDeadline(DEFAULT_DEADLINE_ID, {
        to: "met",
        actor_user_id: "lawyer-01",
        at: "June 15 2026",
      }),
      "invalid_argument",
    );
  });

  // ===========================================================================
  // Phase A7 — OCR links
  // ===========================================================================

  test(`${label}: 6.A7.1 upsertOcrLink first snapshot (create)`, async () => {
    const p = await seedMatterDoc();
    const r = await p.upsertOcrLink(makeOcrLinkInput());
    assert.equal(r.created, true);
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.entity_type, "ocr_link");
    assert.equal(evt.action, "create");
    assert.equal(evt.before_state_hash, null);
  });

  test(`${label}: 6.A7.1b upsertOcrLink byte-identical replay is no-op`, async () => {
    const p = await seedMatterDoc();
    await p.upsertOcrLink(makeOcrLinkInput());
    const auditsBefore = (await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID })).rows.length;
    const r = await p.upsertOcrLink(makeOcrLinkInput());
    assert.equal(r.created, false);
    const auditsAfter = (await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID })).rows.length;
    assert.equal(auditsAfter, auditsBefore);
  });

  test(`${label}: 6.A7.2 upsertOcrLink second call with changed fields (refresh)`, async () => {
    const p = await seedMatterDoc();
    await p.upsertOcrLink(makeOcrLinkInput());
    const r = await p.upsertOcrLink(makeOcrLinkInput({ status_snapshot: "processing", last_seen_at: "2026-05-22T11:00:00.000Z" }));
    assert.equal(r.created, false);
    assert.equal(r.link.status_snapshot, "processing");
    const page = await p.listAuditEvents({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    const evt = page.rows[page.rows.length - 1];
    assert.equal(evt.action, "update");
    assert.notEqual(evt.before_state_hash, null);
  });

  test(`${label}: 6.A7.3 upsertOcrLink rejects direction !== "read-only"`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.upsertOcrLink(makeOcrLinkInput({ direction: "write" })),
      "invalid_payload",
    );
  });

  test(`${label}: 6.A7.4 upsertOcrLink rejects unknown document_id`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.upsertOcrLink(makeOcrLinkInput({ document_id: "01nonexistdocmockid0000007" })),
      "unknown_document",
    );
  });

  test(`${label}: 6.A7.6 upsertOcrLink rejects cross-tenant document_id`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.upsertOcrLink(makeOcrLinkInput({ tenant_id: "other-tenant" })),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A7.7 upsertOcrLink rejects schema-invalid link`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.upsertOcrLink(makeOcrLinkInput({ document_id: "BAD" })),
      "invalid_payload",
    );
  });

  test(`${label}: 6.A7.8 upsertOcrLink rejects status_snapshot not in enum`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.upsertOcrLink(makeOcrLinkInput({ status_snapshot: "not_a_status" })),
      "invalid_payload",
    );
  });

  test(`${label}: 6.A7.11 getOcrLink returns null when none exists`, async () => {
    const p = await seedMatterDoc();
    const r = await p.getOcrLink({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, document_id: DEFAULT_DOCUMENT_ID,
    });
    assert.equal(r, null);
  });

  test(`${label}: 6.A7.12 getOcrLink returns the row when scoped correctly`, async () => {
    const p = await seedMatterDoc();
    await p.upsertOcrLink(makeOcrLinkInput());
    const r = await p.getOcrLink({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, document_id: DEFAULT_DOCUMENT_ID,
    });
    assert.equal(r.document_id, DEFAULT_DOCUMENT_ID);
  });

  test(`${label}: 6.A7.13 getOcrLink cross-matter scope returns null`, async () => {
    const p = await seedMatterDoc();
    await p.upsertOcrLink(makeOcrLinkInput());
    const otherMatter = "01jothmocrlinkmatter7a13a0";
    await p.createMatter(makeMatterInput({ id: otherMatter }));
    const r = await p.getOcrLink({
      tenant_id: DEFAULT_TENANT_ID, matter_id: otherMatter, document_id: DEFAULT_DOCUMENT_ID,
    });
    assert.equal(r, null);
  });

  test(`${label}: 6.A7.14 getOcrLink cross-tenant scope throws`, async () => {
    const p = await seedMatterDoc();
    await p.upsertOcrLink(makeOcrLinkInput());
    const otherTen = "01jothtocrlinkmatter7a14a0";
    await p.createMatter(makeMatterInput({ id: otherTen, tenant_id: "other-tenant" }));
    await assertRejectsCode(
      () => p.getOcrLink({ tenant_id: DEFAULT_TENANT_ID, matter_id: otherTen, document_id: DEFAULT_DOCUMENT_ID }),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A7.15 listOcrLinks orders by last_seen_at DESC + cursor pagination`, async () => {
    const p = await seedMatterDoc();
    // Create extra documents to attach links
    for (let i = 0; i < 3; i++) {
      const docId = `01jcaseocrlistdoc00000a7${(i + 0x10).toString(16)}`;
      await p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput({ id: docId }));
      await p.upsertOcrLink(makeOcrLinkInput({
        document_id: docId,
        last_seen_at: `2026-05-22T1${i}:00:00.000Z`,
      }));
    }
    const page1 = await p.listOcrLinks({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, limit: 2 });
    assert.equal(page1.rows.length, 2);
    assert.ok(page1.rows[0].last_seen_at >= page1.rows[1].last_seen_at);
    const page2 = await p.listOcrLinks({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, limit: 2, cursor: page1.next_cursor });
    assert.ok(page2.rows.length >= 1);
  });

  test(`${label}: 6.A7.15b listOcrLinks rejects wrong-kind cursor`, async () => {
    const p = await seedMatterDoc();
    await p.upsertOcrLink(makeOcrLinkInput());
    // Make a cursor for a different kind by listDocuments first.
    const dpage = await p.listDocuments({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, limit: 1 });
    if (dpage.next_cursor !== null) {
      await assertRejectsCode(
        () => p.listOcrLinks({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, cursor: dpage.next_cursor }),
        "invalid_argument",
      );
    }
  });

  test(`${label}: 6.A7.16 listOcrLinks filter by status_snapshot`, async () => {
    const p = await seedMatterDoc();
    await p.upsertOcrLink(makeOcrLinkInput());
    const doc2 = "01jcaseocrlistdoc0007a16a0";
    await p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput({ id: doc2 }));
    await p.upsertOcrLink(makeOcrLinkInput({ document_id: doc2, status_snapshot: "succeeded" }));
    const page = await p.listOcrLinks({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, status_snapshot: "succeeded",
    });
    assert.equal(page.rows.length, 1);
    assert.equal(page.rows[0].status_snapshot, "succeeded");
  });

  test(`${label}: 6.A7.17 listOcrLinks rejects unknown matter`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.listOcrLinks({ tenant_id: DEFAULT_TENANT_ID, matter_id: "01nonexistmatter00000000xx" }),
      "unknown_matter",
    );
  });

  test(`${label}: 6.A7.18 listOcrLinks rejects tenant mismatch`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.listOcrLinks({ tenant_id: "other-tenant", matter_id: DEFAULT_MATTER_ID }),
      "tenant_mismatch",
    );
  });

  // ===========================================================================
  // Phase A8 — read-side aggregations
  // ===========================================================================

  test(`${label}: 6.A8.1 listMatters empty tenant returns empty`, async () => {
    const { p } = make();
    const page = await p.listMatters({ tenant_id: DEFAULT_TENANT_ID });
    assert.deepEqual(page.rows, []);
    assert.equal(page.next_cursor, null);
  });

  test(`${label}: 6.A8.2 listMatters ordered created_at DESC + cursor`, async () => {
    const { p } = make();
    for (let i = 0; i < 4; i++) {
      await p.createMatter(makeMatterInput({
        id: `01jcasea8mattersmocklist${(i + 0x10).toString(16)}`,
        created_at: `2026-05-2${i}T09:00:00.000Z`,
      }));
    }
    const page1 = await p.listMatters({ tenant_id: DEFAULT_TENANT_ID, limit: 2 });
    assert.equal(page1.rows.length, 2);
    assert.ok(page1.rows[0].created_at >= page1.rows[1].created_at);
    const page2 = await p.listMatters({ tenant_id: DEFAULT_TENANT_ID, limit: 2, cursor: page1.next_cursor });
    assert.equal(page2.rows.length, 2);
  });

  test(`${label}: 6.A8.3 listMatters filter by status=archived`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    await p.archiveMatter(DEFAULT_MATTER_ID, { actor_user_id: "local-user", reason: "test" });
    const page = await p.listMatters({ tenant_id: DEFAULT_TENANT_ID, status: "archived" });
    assert.equal(page.rows.length, 1);
    assert.equal(page.rows[0].status, "archived");
  });

  test(`${label}: 6.A8.4 getMatterSummary unknown matter returns null`, async () => {
    const { p } = make();
    const r = await p.getMatterSummary({ tenant_id: DEFAULT_TENANT_ID, matter_id: "01nonexistmatter00000000xx" });
    assert.equal(r, null);
  });

  test(`${label}: 6.A8.5 getMatterSummary cross-tenant throws`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    await assertRejectsCode(
      () => p.getMatterSummary({ tenant_id: "other-tenant", matter_id: DEFAULT_MATTER_ID }),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A8.6 getMatterSummary empty matter returns zero counts`, async () => {
    const { p } = make();
    await p.createMatter(makeMatterInput());
    const r = await p.getMatterSummary({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    assert.equal(r.counts.documents, 0);
    assert.equal(r.counts.facts_by_status.candidate, 0);
    assert.equal(r.counts.deadlines_by_status.pending, 0);
    assert.equal(r.counts.privilege_markers, 0);
    assert.equal(r.counts.docket_entries_by_state.proposed, 0);
    assert.equal(r.counts.confidentiality_classifications, 0);
    assert.equal(r.counts.evidence_items_by_status.proposed, 0);
    assert.equal(r.counts.ocr_links, 0);
  });

  test(`${label}: 6.A8.7 getMatterSummary populated counts correct`, async () => {
    const p = await seedMatterDoc();
    await p.appendFact(makeFactInput());
    await p.appendEvidenceItem(makeEvidenceItemInput());
    await p.upsertOcrLink(makeOcrLinkInput());
    const r = await p.getMatterSummary({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    assert.equal(r.counts.documents, 1);
    assert.equal(r.counts.facts_by_status.candidate, 1);
    assert.equal(r.counts.evidence_items_by_status.proposed, 1);
    assert.equal(r.counts.ocr_links, 1);
  });

  test(`${label}: 6.A8.8 getDocumentDetail unknown document returns null`, async () => {
    const p = await seedMatterDoc();
    const r = await p.getDocumentDetail({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, document_id: "01nonexistdocmockid0000007",
    });
    assert.equal(r, null);
  });

  test(`${label}: 6.A8.9 getDocumentDetail cross-matter returns null`, async () => {
    const p = await seedMatterDoc();
    const otherMatter = "01jcasea8doxmcrossm9009007";
    await p.createMatter(makeMatterInput({ id: otherMatter }));
    const r = await p.getDocumentDetail({
      tenant_id: DEFAULT_TENANT_ID, matter_id: otherMatter, document_id: DEFAULT_DOCUMENT_ID,
    });
    assert.equal(r, null);
  });

  test(`${label}: 6.A8.10 getDocumentDetail cross-tenant throws`, async () => {
    const p = await seedMatterDoc();
    const otherTen = "01jcasea8doxtxxten9010007a";
    await p.createMatter(makeMatterInput({ id: otherTen, tenant_id: "other-tenant" }));
    await assertRejectsCode(
      () => p.getDocumentDetail({ tenant_id: DEFAULT_TENANT_ID, matter_id: otherTen, document_id: DEFAULT_DOCUMENT_ID }),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A8.11 getDocumentDetail bundle shape`, async () => {
    const p = await seedMatterDoc();
    await p.appendFact(makeFactInput());
    const r = await p.getDocumentDetail({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, document_id: DEFAULT_DOCUMENT_ID,
    });
    assert.equal(r.document.id, DEFAULT_DOCUMENT_ID);
    assert.equal(r.ocr_link, null);
    assert.equal(r.effective_classification.effectiveLevel, "unclassified");
    assert.equal(r.privilege_status.hasProtectiveAssertion, false);
    assert.equal(r.fact_candidates.length, 0); // fact has no source_document_id by default
  });

  test(`${label}: 6.A8.12 getDeadline unknown returns null`, async () => {
    const p = await seedMatterDoc();
    const r = await p.getDeadline({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, deadline_id: "01nonexistdline000a8a012b1",
    });
    assert.equal(r, null);
  });

  test(`${label}: 6.A8.12b listDeadlines unknown matter`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.listDeadlines({ tenant_id: DEFAULT_TENANT_ID, matter_id: "01nonexistmatter00000000xx" }),
      "unknown_matter",
    );
  });

  test(`${label}: 6.A8.12c listDeadlines cross-tenant`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.listDeadlines({ tenant_id: "other-tenant", matter_id: DEFAULT_MATTER_ID }),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A8.14 getDeadline+listDeadlines populated`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput());
    await p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "lawyer-01",
      confirmed_at: "2026-05-21T21:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    });
    const got = await p.getDeadline({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, deadline_id: DEFAULT_DEADLINE_ID });
    assert.equal(got.id, DEFAULT_DEADLINE_ID);
    const list = await p.listDeadlines({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    assert.equal(list.rows.length, 1);
  });

  test(`${label}: 6.A8.19 getDeadlineCalendar from + to bounds (inclusive)`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput());
    await p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "lawyer-01",
      confirmed_at: "2026-05-21T21:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    });
    // The deadline's due_at is 2026-06-15T17:00:00Z by fixture.
    const inRange = await p.getDeadlineCalendar({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID,
      from: "2026-06-01T00:00:00.000Z", to: "2026-06-30T00:00:00.000Z",
    });
    assert.equal(inRange.length, 1);
    const outOfRange = await p.getDeadlineCalendar({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID,
      from: "2027-01-01T00:00:00.000Z",
    });
    assert.equal(outOfRange.length, 0);
  });

  test(`${label}: 6.A8.19b getDeadlineCalendar cross-tenant`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.getDeadlineCalendar({ tenant_id: "other-tenant", matter_id: DEFAULT_MATTER_ID }),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A8.20 getDeadlineCalendar unbounded returns all`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput());
    await p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "lawyer-01",
      confirmed_at: "2026-05-21T21:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    });
    const all = await p.getDeadlineCalendar({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    assert.equal(all.length, 1);
  });

  test(`${label}: 6.A8.21 getFactSupersessionChain single fact returns [fact]`, async () => {
    const p = await seedMatterDoc();
    await p.appendFact(makeFactInput());
    const chain = await p.getFactSupersessionChain({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, fact_id: DEFAULT_FACT_ID,
    });
    assert.equal(chain.length, 1);
    assert.equal(chain[0].id, DEFAULT_FACT_ID);
  });

  test(`${label}: 6.A8.22 getFactSupersessionChain 3-fact chain`, async () => {
    const p = await seedMatterDoc();
    const factA = DEFAULT_FACT_ID;
    const factB = "01jcasea8factchainb00a8a22";
    const factC = "01jcasea8factchainc00a8a22";
    // A accepted (no supersedes)
    await p.appendFact(makeFactInput());
    await p.transitionFact(factA, { to: "reviewed", reviewer_actor_user_id: "l", at: "2026-05-22T01:00:00.000Z" });
    await p.transitionFact(factA, { to: "accepted", reviewer_actor_user_id: "l", at: "2026-05-22T02:00:00.000Z" });
    // B accepted, supersedes A
    await p.appendFact(makeFactInput({ id: factB, created_at: "2026-05-22T03:00:00.000Z" }));
    await p.transitionFact(factB, { to: "reviewed", reviewer_actor_user_id: "l", at: "2026-05-22T04:00:00.000Z" });
    await p.transitionFact(factB, { to: "accepted", reviewer_actor_user_id: "l", at: "2026-05-22T05:00:00.000Z", supersedes_fact_id: factA });
    // C accepted, supersedes B
    await p.appendFact(makeFactInput({ id: factC, created_at: "2026-05-22T06:00:00.000Z" }));
    await p.transitionFact(factC, { to: "reviewed", reviewer_actor_user_id: "l", at: "2026-05-22T07:00:00.000Z" });
    await p.transitionFact(factC, { to: "accepted", reviewer_actor_user_id: "l", at: "2026-05-22T08:00:00.000Z", supersedes_fact_id: factB });
    // Walk from C → B → A.
    const chain = await p.getFactSupersessionChain({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, fact_id: factC,
    });
    assert.equal(chain.length, 3);
    assert.equal(chain[0].id, factC);
    assert.equal(chain[1].id, factB);
    assert.equal(chain[2].id, factA);
  });

  test(`${label}: 6.A8.23 getFactSupersessionChain unknown returns []`, async () => {
    const p = await seedMatterDoc();
    const chain = await p.getFactSupersessionChain({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, fact_id: "01nonexistfactchain0000007",
    });
    assert.equal(chain.length, 0);
  });

  test(`${label}: 6.A8.A1 audit-count stable after all A8 reads`, async () => {
    const p = await seedMatterDoc();
    await p.appendFact(makeFactInput());
    const headBefore = await p.getAuditChainHead(DEFAULT_MATTER_ID);
    await p.listMatters({ tenant_id: DEFAULT_TENANT_ID });
    await p.getMatterSummary({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    await p.getDocumentDetail({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, document_id: DEFAULT_DOCUMENT_ID });
    await p.getDeadline({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, deadline_id: DEFAULT_DEADLINE_ID });
    await p.listDeadlines({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    await p.getDeadlineCalendar({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    await p.getFactSupersessionChain({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, fact_id: DEFAULT_FACT_ID });
    const headAfter = await p.getAuditChainHead(DEFAULT_MATTER_ID);
    assert.equal(headAfter.count, headBefore.count);
    assert.equal(headAfter.headHash, headBefore.headHash);
  });

  test(`${label}: 6.A8.A2 listDocuments with status filter (registered matches, triaged empty)`, async () => {
    const p = await seedMatterDoc();
    // Documents are always created as "registered" (Step 1 initial-state rule;
    // a future OCR-driven workflow would transition to triaged/etc.). Verify
    // the filter mechanism executes correctly: matching status returns the
    // row, non-matching returns empty.
    const matching = await p.listDocuments({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, status: "registered" });
    assert.equal(matching.rows.length, 1);
    const nonMatching = await p.listDocuments({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, status: "triaged" });
    assert.equal(nonMatching.rows.length, 0);
  });

  test(`${label}: 6.A8.13 getDeadline cross-tenant throws`, async () => {
    const p = await seedMatterDoc();
    const otherTen = "01jcasea8dlxtnttest13aaaa1";
    await p.createMatter(makeMatterInput({ id: otherTen, tenant_id: "other-tenant" }));
    await assertRejectsCode(
      () => p.getDeadline({ tenant_id: DEFAULT_TENANT_ID, matter_id: otherTen, deadline_id: DEFAULT_DEADLINE_ID }),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A8.15 listDeadlines empty returns empty`, async () => {
    const p = await seedMatterDoc();
    const page = await p.listDeadlines({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    assert.deepEqual(page.rows, []);
  });

  test(`${label}: 6.A8.16+17 listDeadlines ordered by due_at ASC + status + kind filters`, async () => {
    const p = await seedMatterDoc();
    // Insert 3 deadlines via 3 docket entries with DESCENDING proposed_due_at
    // so insertion-order does NOT match expected output-order. Fails if sort
    // is not applied.
    const entries = [
      { docketId: "01jcasea8dock16a1700aaaa01", deadlineId: "01jcasea8dline16ord0aa0101", due: "2026-09-15T17:00:00.000Z" },
      { docketId: "01jcasea8dock16a1700aaaa02", deadlineId: "01jcasea8dline16ord0aa0102", due: "2026-07-15T17:00:00.000Z" },
      { docketId: "01jcasea8dock16a1700aaaa03", deadlineId: "01jcasea8dline16ord0aa0103", due: "2026-08-15T17:00:00.000Z" },
    ];
    for (const e of entries) {
      await p.appendDocketEntry(makeDocketEntryInput({ id: e.docketId, proposed_due_at: e.due }));
      await p.confirmDocketEntry(e.docketId, {
        confirmation_actor_user_id: "lawyer-01",
        confirmed_at: "2026-05-21T21:00:00.000Z",
        deadline_id: e.deadlineId,
      });
    }
    const all = await p.listDeadlines({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID });
    assert.equal(all.rows.length, 3);
    // Expected output order: July → August → September (due_at ASC).
    assert.ok(all.rows[0].due_at < all.rows[1].due_at, `expected ascending: got ${all.rows.map(r=>r.due_at).join(", ")}`);
    assert.ok(all.rows[1].due_at < all.rows[2].due_at);
    assert.equal(all.rows[0].due_at, "2026-07-15T17:00:00.000Z");
    assert.equal(all.rows[2].due_at, "2026-09-15T17:00:00.000Z");
    // Pagination preserves ordering across pages.
    const page1 = await p.listDeadlines({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, limit: 2 });
    assert.equal(page1.rows.length, 2);
    assert.equal(page1.rows[0].due_at, "2026-07-15T17:00:00.000Z");
    assert.ok(page1.next_cursor !== null);
    const page2 = await p.listDeadlines({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, limit: 2, cursor: page1.next_cursor });
    assert.equal(page2.rows.length, 1);
    assert.equal(page2.rows[0].due_at, "2026-09-15T17:00:00.000Z");
    // Filters.
    const pending = await p.listDeadlines({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, status: "pending" });
    assert.equal(pending.rows.length, 3);
    const met = await p.listDeadlines({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, status: "met" });
    assert.equal(met.rows.length, 0);
    const filingKind = await p.listDeadlines({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, kind: "filing" });
    assert.equal(filingKind.rows.length, 3);
    const wrongKind = await p.listDeadlines({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, kind: "hearing" });
    assert.equal(wrongKind.rows.length, 0);
  });

  test(`${label}: 6.A8.19c getDeadlineCalendar from > to returns empty`, async () => {
    const p = await seedMatterDoc();
    await p.appendDocketEntry(makeDocketEntryInput());
    await p.confirmDocketEntry(DEFAULT_DOCKET_ENTRY_ID, {
      confirmation_actor_user_id: "lawyer-01",
      confirmed_at: "2026-05-21T21:00:00.000Z",
      deadline_id: DEFAULT_DEADLINE_ID,
    });
    const empty = await p.getDeadlineCalendar({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID,
      from: "2027-01-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(empty.length, 0);
  });

  test(`${label}: 6.A8.24 getFactSupersessionChain cross-tenant throws`, async () => {
    const p = await seedMatterDoc();
    await p.appendFact(makeFactInput());
    await assertRejectsCode(
      () => p.getFactSupersessionChain({ tenant_id: "other-tenant", matter_id: DEFAULT_MATTER_ID, fact_id: DEFAULT_FACT_ID }),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A8.24b getFactSupersessionChain cross-matter returns []`, async () => {
    const p = await seedMatterDoc();
    await p.appendFact(makeFactInput());
    const otherMatter = "01jcasea8factcrossm24bb007";
    await p.createMatter(makeMatterInput({ id: otherMatter }));
    const chain = await p.getFactSupersessionChain({
      tenant_id: DEFAULT_TENANT_ID, matter_id: otherMatter, fact_id: DEFAULT_FACT_ID,
    });
    assert.equal(chain.length, 0);
  });

  test(`${label}: 6.A8.11b getDocumentDetail fact_candidates cap`, async () => {
    const p = await seedMatterDoc();
    // Create 55 candidate facts with source_document_id = DEFAULT_DOCUMENT_ID.
    for (let i = 0; i < 55; i++) {
      await p.appendFact(makeFactInput({
        id: `01jcasea8factcanda${(i + 0x100).toString(16).padStart(8, "0")}`,
        source_type: "ocr_excerpt",
        source_document_id: DEFAULT_DOCUMENT_ID,
        source_page_number: 1,
        source_excerpt: `excerpt ${i}`,
        source_ocr_job_id: "01jocrjobtestmocka8cap0001",
        extractor_name: "test",
        extractor_version: "1",
        extraction_confidence: 0.9,
        created_at: `2026-05-22T${(10 + Math.floor(i / 10)).toString().padStart(2, "0")}:${(i % 60).toString().padStart(2, "0")}:00.000Z`,
      }));
    }
    const detail = await p.getDocumentDetail({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, document_id: DEFAULT_DOCUMENT_ID,
    });
    assert.equal(detail.fact_candidates.length, 50);
  });

  test(`${label}: 6.A8.A2b listDocuments with doc_type filter`, async () => {
    const p = await seedMatterDoc();
    const doc2 = "01jcasea8doxdoctyflt2b08aa";
    await p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput({ id: doc2, doc_type: "contract" }));
    const page = await p.listDocuments({ tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, doc_type: "contract" });
    assert.equal(page.rows.length, 1);
    assert.equal(page.rows[0].doc_type, "contract");
  });

  // ===========================================================================
  // Phase A9 — replay-safe Once variants
  // ===========================================================================

  test(`${label}: 6.A9.1 appendFactOnce new fact (cold path) emits audit`, async () => {
    const p = await seedMatterDoc();
    const headBefore = await p.getAuditChainHead(DEFAULT_MATTER_ID);
    const row = await p.appendFactOnce(makeFactInput());
    assert.equal(row.id, DEFAULT_FACT_ID);
    const headAfter = await p.getAuditChainHead(DEFAULT_MATTER_ID);
    assert.equal(headAfter.count, headBefore.count + 1);
  });

  test(`${label}: 6.A9.2 appendFactOnce exact replay returns stored row, no new audit`, async () => {
    const p = await seedMatterDoc();
    const first = await p.appendFactOnce(makeFactInput());
    const headBefore = await p.getAuditChainHead(DEFAULT_MATTER_ID);
    const second = await p.appendFactOnce(makeFactInput());
    const headAfter = await p.getAuditChainHead(DEFAULT_MATTER_ID);
    assert.equal(headAfter.count, headBefore.count);
    assert.equal(headAfter.headHash, headBefore.headHash);
    assert.equal(second.id, first.id);
    assert.equal(second.created_at, first.created_at);
  });

  test(`${label}: 6.A9.3 appendFactOnce same id, different statement_text → duplicate_id`, async () => {
    const p = await seedMatterDoc();
    await p.appendFactOnce(makeFactInput());
    await assertRejectsCode(
      () => p.appendFactOnce(makeFactInput({ statement_text: "different fact statement entirely" })),
      "duplicate_id",
    );
  });

  test(`${label}: 6.A9.13 appendFactOnce cross-tenant replay short-circuit blocked`, async () => {
    // Audit Dim 5 #1 defense: a caller forging the exact stored projection
    // but with a different tenant_id must NOT receive the stored row via
    // the replay short-circuit. Tenant guard falls through to the strict
    // path; strict-path duplicate-id check throws BEFORE any payload data
    // leaves. No row data is exposed in the error.
    const p = await seedMatterDoc();
    await p.appendFactOnce(makeFactInput());
    await assertRejectsCode(
      () => p.appendFactOnce(makeFactInput({ tenant_id: "other-tenant" })),
      "duplicate_id",
    );
  });

  test(`${label}: 6.A9.4 appendFactOnce returns deep clone`, async () => {
    const p = await seedMatterDoc();
    const r = await p.appendFactOnce(makeFactInput());
    r.statement = "TAMPERED";
    const replay = await p.appendFactOnce(makeFactInput());
    assert.notEqual(replay.statement, "TAMPERED");
  });

  test(`${label}: 6.A9.5 appendFactOnce schema-invalid payload → invalid_payload`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendFactOnce(makeFactInput({ id: "BAD" })),
      "invalid_payload",
    );
  });

  test(`${label}: 6.A9.6 appendFactOnce non-candidate status rejected`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendFactOnce(makeFactInput({ status: "accepted" })),
      "invalid_argument",
    );
  });

  test(`${label}: 6.A9.7 appendFactOnce cross-tenant rejected`, async () => {
    const p = await seedMatterDoc();
    await assertRejectsCode(
      () => p.appendFactOnce(makeFactInput({ tenant_id: "other-tenant" })),
      "tenant_mismatch",
    );
  });

  test(`${label}: 6.A9.8 appendFactOnce after transition → duplicate_id (projection differs)`, async () => {
    const p = await seedMatterDoc();
    await p.appendFactOnce(makeFactInput());
    await p.transitionFact(DEFAULT_FACT_ID, { to: "reviewed", reviewer_actor_user_id: "l", at: "2026-05-22T01:00:00.000Z" });
    // Re-attempt original candidate payload: stored row is now reviewed,
    // canonical projection differs (status changed + reviewed_at set), so
    // the conflict path fires.
    await assertRejectsCode(
      () => p.appendFactOnce(makeFactInput()),
      "duplicate_id",
    );
  });

  test(`${label}: 6.A9.9 appendFactOnce replay leaves chain head unchanged`, async () => {
    const p = await seedMatterDoc();
    await p.appendFactOnce(makeFactInput());
    const h1 = await p.getAuditChainHead(DEFAULT_MATTER_ID);
    await p.appendFactOnce(makeFactInput());
    await p.appendFactOnce(makeFactInput());
    const h2 = await p.getAuditChainHead(DEFAULT_MATTER_ID);
    assert.equal(h1.count, h2.count);
    assert.equal(h1.headHash, h2.headHash);
  });

  test(`${label}: 6.A9.10 appendFactOnce 5x replay → 1 audit row`, async () => {
    const p = await seedMatterDoc();
    for (let i = 0; i < 5; i++) await p.appendFactOnce(makeFactInput());
    const head = await p.getAuditChainHead(DEFAULT_MATTER_ID);
    // Matter creation + document registration each emit 1 audit; +1 for the
    // first appendFactOnce. Subsequent 4 are no-ops.
    assert.equal(head.count, 3);
  });

  test(`${label}: 6.A9.11 appendFactOnce same id, different created_at → duplicate_id`, async () => {
    const p = await seedMatterDoc();
    await p.appendFactOnce(makeFactInput());
    await assertRejectsCode(
      () => p.appendFactOnce(makeFactInput({ created_at: "2027-01-01T00:00:00.000Z" })),
      "duplicate_id",
    );
  });

  test(`${label}: 6.A9.12 appendFactOnce same id, different actor_user_id → duplicate_id`, async () => {
    const p = await seedMatterDoc();
    await p.appendFactOnce(makeFactInput());
    await assertRejectsCode(
      () => p.appendFactOnce(makeFactInput({ actor_user_id: "different-actor" })),
      "duplicate_id",
    );
  });

  test(`${label}: 6.A4.28 getFact unknown returns null + scoped lookup`, async () => {
    const p = await seedMatterDoc();
    // Unknown fact id returns null.
    const missing = await p.getFact({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, fact_id: "01nonexistfactmockid000000z",
    });
    assert.equal(missing, null);
    // Known fact returns the row when scope matches.
    await p.appendFact(makeFactInput());
    const found = await p.getFact({
      tenant_id: DEFAULT_TENANT_ID, matter_id: DEFAULT_MATTER_ID, fact_id: DEFAULT_FACT_ID,
    });
    assert.equal(found.id, DEFAULT_FACT_ID);
    // Cross-matter scope returns null (does not leak existence).
    const otherMatter = "01jothmatscopefacta4028z01";
    await p.createMatter(makeMatterInput({ id: otherMatter }));
    const crossMatter = await p.getFact({
      tenant_id: DEFAULT_TENANT_ID, matter_id: otherMatter, fact_id: DEFAULT_FACT_ID,
    });
    assert.equal(crossMatter, null);
    // Cross-tenant matter throws tenant_mismatch.
    const otherTenantMatter = "01jothtenscopefacta4028z01";
    await p.createMatter(makeMatterInput({ id: otherTenantMatter, tenant_id: "other-tenant" }));
    await assertRejectsCode(
      () => p.getFact({
        tenant_id: DEFAULT_TENANT_ID, matter_id: otherTenantMatter, fact_id: DEFAULT_FACT_ID,
      }),
      "tenant_mismatch",
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
