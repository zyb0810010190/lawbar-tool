// T3 证据目录及说明 preview IPC handler unit tests
// (WI-FORMS-T3-S2-CATALOG-PREVIEW-00). Exercises the ONE read-only channel
// casebox:t3:previewCatalog: tenant injection, matter/tenant preflight BEFORE the
// evidence read, forbidden/unknown/malformed-DTO rejection, the mandatory
// accepted-evidence pagination DRAIN, non-promotion + accepted-only filtering
// carried from the S1 model, and the four submitter-refusal codes mapped to the
// SUCCESS value (never an error, never null, never a crash).
//
// Mirrors the IPC unit-test harness shape (ipc-casebox-handlers.unit.test.mjs):
// a hand-rolled persistence provider, no Electron. The active tenant is
// "default-tenant" (src/security/activeTenant.ts default).

import test from "node:test";
import assert from "node:assert/strict";
import { previewT3CatalogHandler } from "../dist/src/caseBox/handlers.js";

const TENANT = "default-tenant";
const MATTER_ID = "01jzmatter0000000000000000";

const CLIENT = { role: "client", display_name: "孙乐驰", party_kind: "individual" };
const CLIENT_2 = { role: "client", display_name: "王二", party_kind: "individual" };
const OPPOSING = { role: "opposing", display_name: "对方公司", party_kind: "organization" };

function matterWith(parties, extra = {}) {
  return { id: MATTER_ID, tenant_id: TENANT, status: "active", parties, ...extra };
}

function evi(overrides = {}) {
  return {
    id: "e-0",
    tenant_id: TENANT,
    actor_user_id: "local-user",
    matter_id: MATTER_ID,
    status: "accepted",
    created_at: "2026-01-01T00:00:00.000Z",
    lawyer_weight: "moderate",
    ...overrides,
  };
}

// Provider whose listEvidenceItems seek-paginates `evidence` at `pageSize`,
// honoring the status filter (proving the handler requests accepted-only). The
// opaque cursor is a numeric start index encoded as a string.
function makeProvider({ matter, evidence = [], pageSize = 50 } = {}) {
  const calls = { getMatter: 0, listEvidence: 0, queries: [] };
  const persistence = {
    getMatter: async () => {
      calls.getMatter++;
      return matter ?? null;
    },
    listEvidenceItems: async (q) => {
      calls.listEvidence++;
      calls.queries.push(q);
      const filtered = evidence.filter((e) => q.status === undefined || e.status === q.status);
      const start = q.cursor === undefined ? 0 : Number(q.cursor);
      const slice = filtered.slice(start, start + pageSize);
      const nextStart = start + pageSize;
      const next_cursor = nextStart < filtered.length ? String(nextStart) : null;
      return { rows: slice, next_cursor };
    },
  };
  return { provide: () => ({ persistence }), calls };
}

// ---------- success (model) ----------

test("success: builds a model over accepted rows; injects tenant + accepted status", async () => {
  const evidence = [
    evi({ id: "e-1", display_order: 0, evidence_title: "银行流水", proof_statement: "证明款项交付。", exhibit_page_range: "4-7" }),
    evi({ id: "e-2", display_order: 1, evidence_title: "借条", proof_statement: "证明借款。", exhibit_page_range: "1-3" }),
  ];
  const { provide, calls } = makeProvider({ matter: matterWith([CLIENT], { litigation_position: "plaintiff" }), evidence });
  const res = await previewT3CatalogHandler({ matterId: MATTER_ID }, provide);
  assert.equal(res.ok, true);
  assert.equal(res.value.kind, "model");
  assert.equal(res.value.model.formType, "证据目录及说明");
  assert.deepEqual(res.value.model.litigationPosition, { value: "plaintiff" });
  assert.deepEqual(res.value.model.submitterName, { text: "孙乐驰" });
  assert.equal(res.value.model.rows.length, 2);
  assert.equal(res.value.model.rows[0].sequence, 1);
  assert.deepEqual(res.value.model.rows[0].evidenceName, { text: "银行流水" });
  assert.equal(res.value.model.rows[1].sequence, 2);
  assert.equal(typeof res.value.modelSha256, "string");
  assert.equal(res.value.modelSha256.length, 64);
  // tenant injected + accepted-only status on the persistence read.
  assert.equal(calls.queries[0].tenant_id, TENANT);
  assert.equal(calls.queries[0].matter_id, MATTER_ID);
  assert.equal(calls.queries[0].status, "accepted");
});

test("litigationPosition absent → reviewNeeded position cell", async () => {
  const { provide } = makeProvider({ matter: matterWith([CLIENT]), evidence: [] });
  const res = await previewT3CatalogHandler({ matterId: MATTER_ID }, provide);
  assert.equal(res.ok, true);
  assert.equal(res.value.kind, "model");
  assert.deepEqual(res.value.model.litigationPosition, { reviewNeeded: true });
});

// ---------- pagination drain ----------

test("pagination: >50 accepted items yields a model over ALL of them (序号 1..n)", async () => {
  const N = 120;
  const evidence = [];
  for (let i = 0; i < N; i++) {
    evidence.push(
      evi({
        id: `e-${String(i).padStart(3, "0")}`,
        display_order: i,
        created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
        evidence_title: `title-${i}`,
        proof_statement: `proof-${i}`,
        exhibit_page_range: `${i}`,
      }),
    );
  }
  const { provide, calls } = makeProvider({ matter: matterWith([CLIENT]), evidence, pageSize: 50 });
  const res = await previewT3CatalogHandler({ matterId: MATTER_ID }, provide);
  assert.equal(res.ok, true);
  assert.equal(res.value.kind, "model");
  assert.equal(res.value.model.rows.length, N, "model must cover ALL accepted items, not one page");
  assert.equal(res.value.model.rows[0].sequence, 1);
  assert.equal(res.value.model.rows[N - 1].sequence, N);
  assert.deepEqual(res.value.model.rows[N - 1].evidenceName, { text: "title-119" });
  assert.equal(calls.listEvidence, 3, "drained 3 pages of 50 until next_cursor === null");
  for (const q of calls.queries) assert.equal(q.status, "accepted");
});

test("pagination non-termination: a repeating/never-null cursor yields an error, NOT a truncated model", async () => {
  // A misbehaving persistence stub whose listEvidenceItems always returns the SAME
  // non-null cursor: the drain can never reach next_cursor === null. The handler
  // MUST refuse with an error envelope rather than build a mis-numbered catalog
  // over an incomplete set.
  let listEvidence = 0;
  const persistence = {
    getMatter: async () => matterWith([CLIENT]),
    listEvidenceItems: async () => {
      listEvidence++;
      return {
        rows: [evi({ id: `loop-${listEvidence}`, evidence_title: "x" })],
        next_cursor: "STUCK", // never null, always identical → non-terminating
      };
    },
  };
  const provide = () => ({ persistence });
  const res = await previewT3CatalogHandler({ matterId: MATTER_ID }, provide);
  assert.equal(res.ok, false, "non-terminating pagination must be an error, not ok");
  assert.equal(res.value, undefined, "no partial success model may be returned");
  assert.equal(res.error.code, "not_implemented");
  // The seen-cursor guard must stop early, not spin to MAX_EVIDENCE_PAGES.
  assert.ok(listEvidence <= 2, `stopped after the repeat was seen (got ${listEvidence} reads)`);
});

// ---------- non-promotion + status filtering ----------

test("non-promotion: notes/source_document_id/party_side never become name/proof/page", async () => {
  const evidence = [
    evi({
      id: "e-np",
      notes: "内部备注不应出现",
      source_document_id: "01jzdoc00000000000000000000",
      party_side: "our",
      // NO evidence_title / proof_statement / exhibit_page_range
    }),
  ];
  const { provide } = makeProvider({ matter: matterWith([CLIENT]), evidence });
  const res = await previewT3CatalogHandler({ matterId: MATTER_ID }, provide);
  assert.equal(res.ok, true);
  const row = res.value.model.rows[0];
  assert.deepEqual(row.evidenceName, { reviewNeeded: true });
  assert.deepEqual(row.proofStatement, { reviewNeeded: true });
  assert.deepEqual(row.pageRange, { reviewNeeded: true });
});

test("status filtering: proposed/rejected/superseded excluded (accepted-only)", async () => {
  const evidence = [
    evi({ id: "a1", status: "accepted", display_order: 0, evidence_title: "kept-1" }),
    evi({ id: "p1", status: "proposed", display_order: 1, evidence_title: "drop-proposed" }),
    evi({ id: "r1", status: "rejected", display_order: 2, evidence_title: "drop-rejected" }),
    evi({ id: "s1", status: "superseded", display_order: 3, evidence_title: "drop-superseded" }),
    evi({ id: "a2", status: "accepted", display_order: 4, evidence_title: "kept-2" }),
  ];
  const { provide } = makeProvider({ matter: matterWith([CLIENT]), evidence });
  const res = await previewT3CatalogHandler({ matterId: MATTER_ID }, provide);
  assert.equal(res.ok, true);
  const titles = res.value.model.rows.map((r) => (r.evidenceName.text ?? null));
  assert.deepEqual(titles, ["kept-1", "kept-2"]);
});

// ---------- submitter refusals (all four codes) ----------

test("refusal: 0/multi client + no selection → submitter_selection_required", async () => {
  const { provide } = makeProvider({ matter: matterWith([CLIENT, CLIENT_2]), evidence: [] });
  const res = await previewT3CatalogHandler({ matterId: MATTER_ID }, provide);
  assert.equal(res.ok, true);
  assert.deepEqual(res.value, { kind: "refusal", code: "submitter_selection_required" });
});

test("refusal: partyIndex out of range → submitter_index_out_of_range", async () => {
  const { provide } = makeProvider({ matter: matterWith([CLIENT]), evidence: [] });
  const res = await previewT3CatalogHandler(
    { matterId: MATTER_ID, submitterSelection: { partyIndex: 9, displayNameEcho: "孙乐驰" } },
    provide,
  );
  assert.equal(res.ok, true);
  assert.equal(res.value.kind, "refusal");
  assert.equal(res.value.code, "submitter_index_out_of_range");
});

test("refusal: selected party is not a client → submitter_not_client", async () => {
  const { provide } = makeProvider({ matter: matterWith([CLIENT, OPPOSING]), evidence: [] });
  const res = await previewT3CatalogHandler(
    { matterId: MATTER_ID, submitterSelection: { partyIndex: 1, displayNameEcho: "对方公司" } },
    provide,
  );
  assert.equal(res.ok, true);
  assert.equal(res.value.code, "submitter_not_client");
});

test("refusal: echo no longer matches the party → submitter_selection_stale", async () => {
  const { provide } = makeProvider({ matter: matterWith([CLIENT]), evidence: [] });
  const res = await previewT3CatalogHandler(
    { matterId: MATTER_ID, submitterSelection: { partyIndex: 0, displayNameEcho: "旧名字" } },
    provide,
  );
  assert.equal(res.ok, true);
  assert.equal(res.value.code, "submitter_selection_stale");
});

test("valid selection resolves the submitter name (no refusal)", async () => {
  const { provide } = makeProvider({ matter: matterWith([CLIENT, CLIENT_2]), evidence: [] });
  const res = await previewT3CatalogHandler(
    { matterId: MATTER_ID, submitterSelection: { partyIndex: 1, displayNameEcho: "王二" } },
    provide,
  );
  assert.equal(res.ok, true);
  assert.equal(res.value.kind, "model");
  assert.deepEqual(res.value.model.submitterName, { text: "王二" });
});

// ---------- forbidden / unknown / malformed DTO ----------

test("forbidden tenant_id → invalid_payload", async () => {
  const { provide } = makeProvider({ matter: matterWith([CLIENT]) });
  const res = await previewT3CatalogHandler({ matterId: MATTER_ID, tenant_id: "evil" }, provide);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "invalid_payload");
  assert.equal(res.error.details?.schemaPath, "tenant_id");
});

test("forbidden actor_user_id → invalid_payload", async () => {
  const { provide } = makeProvider({ matter: matterWith([CLIENT]) });
  const res = await previewT3CatalogHandler({ matterId: MATTER_ID, actor_user_id: "evil" }, provide);
  assert.equal(res.ok, false);
  assert.equal(res.error.details?.schemaPath, "actor_user_id");
});

test("unknown top-level field → invalid_payload", async () => {
  const { provide } = makeProvider({ matter: matterWith([CLIENT]) });
  const res = await previewT3CatalogHandler({ matterId: MATTER_ID, bogus: 1 }, provide);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "invalid_payload");
  assert.equal(res.error.details?.schemaPath, "bogus");
});

test("empty matterId → invalid_payload", async () => {
  const { provide } = makeProvider({ matter: matterWith([CLIENT]) });
  const res = await previewT3CatalogHandler({ matterId: "" }, provide);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "invalid_payload");
});

test("non-object payload → invalid_payload", async () => {
  const { provide } = makeProvider({ matter: matterWith([CLIENT]) });
  for (const bad of [null, 42, "x", [], undefined]) {
    const res = await previewT3CatalogHandler(bad, provide);
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "invalid_payload");
  }
});

test("malformed submitterSelection shapes → invalid_payload (evidence read not reached)", async () => {
  const cases = [
    "not-an-object",
    42,
    [],
    { partyIndex: 1.5, displayNameEcho: "x" },
    { partyIndex: "0", displayNameEcho: "x" },
    { partyIndex: 0 },
    { partyIndex: 0, displayNameEcho: 5 },
    { partyIndex: 0, displayNameEcho: "x", extra: 1 },
  ];
  for (const sel of cases) {
    const { provide, calls } = makeProvider({ matter: matterWith([CLIENT]) });
    const res = await previewT3CatalogHandler({ matterId: MATTER_ID, submitterSelection: sel }, provide);
    assert.equal(res.ok, false, `sel=${JSON.stringify(sel)}`);
    assert.equal(res.error.code, "invalid_payload");
    assert.equal(calls.getMatter, 0, "validation precedes any persistence read");
  }
});

// ---------- boundary errors ----------

test("absent matter → unknown_matter; evidence read NOT called", async () => {
  const { provide, calls } = makeProvider({ matter: undefined });
  const res = await previewT3CatalogHandler({ matterId: MATTER_ID }, provide);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "unknown_matter");
  assert.equal(calls.listEvidence, 0, "evidence read must not run for an absent matter");
});

test("tenant mismatch → tenant_mismatch; evidence read NOT called", async () => {
  const { provide, calls } = makeProvider({ matter: matterWith([CLIENT], { tenant_id: "other-tenant" }) });
  const res = await previewT3CatalogHandler({ matterId: MATTER_ID }, provide);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "tenant_mismatch");
  assert.equal(calls.listEvidence, 0, "evidence read must not run on a tenant mismatch");
});

// ---------- regression: no T4/T5 surface ----------

test("regression: model carries NO 证明对象/三性/质证 (T4/T5) fields", async () => {
  const { provide } = makeProvider({
    matter: matterWith([CLIENT], { litigation_position: "defendant" }),
    evidence: [evi({ id: "e1", evidence_title: "x", proof_statement: "y", exhibit_page_range: "1" })],
  });
  const res = await previewT3CatalogHandler({ matterId: MATTER_ID }, provide);
  assert.equal(res.ok, true);
  const row = res.value.model.rows[0];
  assert.deepEqual(Object.keys(row).sort(), ["evidenceId", "evidenceName", "pageRange", "proofStatement", "sequence"]);
});
