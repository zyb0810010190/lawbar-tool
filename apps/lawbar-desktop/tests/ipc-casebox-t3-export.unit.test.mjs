// T3 证据目录及说明 DOCX export IPC handler unit tests (WI-FORMS-T3-S3-DOCX-EXPORT-00).
//
// Exercises casebox:t3:exportDocx with a hand-rolled persistence provider + stubbed
// save-dialog/fs deps (no Electron). Asserts the ADR §6 delivery semantics:
//   - save → { written: true } and the file is written with the packed BUFFER;
//   - cancel → { written: false } (a no-op SUCCESS, NOT an error; no write);
//   - a { kind: "refusal" } model → NO document, refusal surfaced ({ exported:false });
//   - forbidden tenant_id/actor_user_id + unknown field → invalid_payload;
//   - absent matter → unknown_matter; tenant mismatch → tenant_mismatch (evidence read
//     not reached); accepted-only filtering inherited from the shared S1 source helper;
//   - the RENDERER-FACING result NEVER contains raw `.docx` bytes.
//
// Mirrors the preview IPC unit-test harness (ipc-casebox-t3-preview.unit.test.mjs). The
// active tenant is "default-tenant" (src/security/activeTenant.ts default).

import test from "node:test";
import assert from "node:assert/strict";
import { exportT3DocxHandler } from "../dist/src/caseBox/t3ExportHandlers.js";
import { extractZipEntryText } from "./_docx-unzip.mjs";

const TENANT = "default-tenant";
const MATTER_ID = "01jzmatter0000000000000000";
const REVIEW_MARKER = "⟨需复核⟩";

// Extract the ordered <w:t> text runs from a packed .docx Buffer's main document part.
function documentTextRuns(buffer) {
  const xml = extractZipEntryText(buffer, "word/document.xml");
  return {
    xml,
    runs: [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]),
  };
}

const CLIENT = { role: "client", display_name: "孙乐驰", party_kind: "individual" };
const CLIENT_2 = { role: "client", display_name: "王二", party_kind: "individual" };

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
    ...overrides,
  };
}

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

// Stubbed save-dialog + fs deps. `canceled` drives the cancel path; every write is
// captured so tests can assert the packed Buffer (and that it is NOT in the result).
function makeDeps({ canceled = false, filePath = "/tmp/out.docx" } = {}) {
  const calls = { save: 0, saveOptions: null, writes: [] };
  const deps = {
    showSaveDialog: async (options) => {
      calls.save++;
      calls.saveOptions = options;
      return { canceled, filePath: canceled ? null : filePath };
    },
    writeFile: async (fp, data) => {
      calls.writes.push({ filePath: fp, data });
    },
  };
  return { deps, calls };
}

// ---------- success: save ----------

test("save: writes the packed .docx and returns { written: true }", async () => {
  const evidence = [
    evi({ id: "e-1", display_order: 0, evidence_title: "借条", proof_statement: "证明借款。", exhibit_page_range: "1-3" }),
    evi({ id: "e-2", display_order: 1, evidence_title: "银行流水", proof_statement: "证明款项交付。", exhibit_page_range: "4-7" }),
  ];
  const { provide, calls } = makeProvider({ matter: matterWith([CLIENT], { litigation_position: "plaintiff" }), evidence });
  const { deps, calls: dcalls } = makeDeps({ canceled: false, filePath: "/tmp/t3.docx" });

  const res = await exportT3DocxHandler({ matterId: MATTER_ID }, provide, deps);

  assert.equal(res.ok, true);
  assert.deepEqual(res.value, { written: true });
  assert.equal(dcalls.save, 1, "save dialog opened once");
  assert.equal(dcalls.writes.length, 1, "file written once");
  assert.equal(dcalls.writes[0].filePath, "/tmp/t3.docx");
  assert.ok(Buffer.isBuffer(dcalls.writes[0].data), "the WRITTEN payload is a Buffer");
  assert.ok(dcalls.writes[0].data.length > 0, "packed .docx is non-empty");
  // default filename ends in .docx (dialog filter/extension owned by main).
  assert.match(dcalls.saveOptions.defaultFileName, /\.docx$/);
  // accepted-only filtering inherited from the shared S1 source.
  assert.equal(calls.queries[0].status, "accepted");
  assert.equal(calls.queries[0].tenant_id, TENANT);
});

test("renderer-facing result never contains raw .docx bytes", async () => {
  const evidence = [evi({ id: "e-1", evidence_title: "x", proof_statement: "y", exhibit_page_range: "1" })];
  const { provide } = makeProvider({ matter: matterWith([CLIENT]), evidence });
  const { deps } = makeDeps({ canceled: false, filePath: "/tmp/t3.docx" });

  const res = await exportT3DocxHandler({ matterId: MATTER_ID }, provide, deps);
  assert.deepEqual(res.value, { written: true });
  // No buffer/bytes/base64 field escapes to the renderer — the value is exactly {written}.
  assert.deepEqual(Object.keys(res.value), ["written"]);
  const serialized = JSON.stringify(res);
  assert.ok(!/[A-Za-z0-9+/]{200,}/.test(serialized), "no large base64-ish byte blob in the result");
});

// ---------- success: cancel (no-op) ----------

test("cancel: cancelling the save dialog is a no-op success { written: false }, no write", async () => {
  const evidence = [evi({ id: "e-1", evidence_title: "x", proof_statement: "y", exhibit_page_range: "1" })];
  const { provide } = makeProvider({ matter: matterWith([CLIENT]), evidence });
  const { deps, calls: dcalls } = makeDeps({ canceled: true });

  const res = await exportT3DocxHandler({ matterId: MATTER_ID }, provide, deps);

  assert.equal(res.ok, true, "cancel is a success envelope, NOT an error");
  assert.deepEqual(res.value, { written: false });
  assert.equal(dcalls.save, 1);
  assert.equal(dcalls.writes.length, 0, "nothing written on cancel");
});

// ---------- refusal: no document ----------

test("refusal: 0/multi client + no selection → { exported:false, refusal }, NO document", async () => {
  const { provide } = makeProvider({ matter: matterWith([CLIENT, CLIENT_2]), evidence: [] });
  const { deps, calls: dcalls } = makeDeps();

  const res = await exportT3DocxHandler({ matterId: MATTER_ID }, provide, deps);

  assert.equal(res.ok, true);
  assert.equal(res.value.exported, false);
  assert.deepEqual(res.value.refusal, { code: "submitter_selection_required" });
  assert.equal(dcalls.save, 0, "no save dialog for a refusal");
  assert.equal(dcalls.writes.length, 0, "NO document produced on a refusal");
});

// ---------- forbidden / unknown / malformed DTO ----------

test("forbidden tenant_id → invalid_payload (no persistence read)", async () => {
  const { provide, calls } = makeProvider({ matter: matterWith([CLIENT]) });
  const { deps } = makeDeps();
  const res = await exportT3DocxHandler({ matterId: MATTER_ID, tenant_id: "evil" }, provide, deps);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "invalid_payload");
  assert.equal(res.error.details?.schemaPath, "tenant_id");
  assert.equal(calls.getMatter, 0);
});

test("forbidden actor_user_id → invalid_payload", async () => {
  const { provide } = makeProvider({ matter: matterWith([CLIENT]) });
  const { deps } = makeDeps();
  const res = await exportT3DocxHandler({ matterId: MATTER_ID, actor_user_id: "evil" }, provide, deps);
  assert.equal(res.ok, false);
  assert.equal(res.error.details?.schemaPath, "actor_user_id");
});

test("unknown top-level field → invalid_payload", async () => {
  const { provide } = makeProvider({ matter: matterWith([CLIENT]) });
  const { deps } = makeDeps();
  const res = await exportT3DocxHandler({ matterId: MATTER_ID, bogus: 1 }, provide, deps);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "invalid_payload");
  assert.equal(res.error.details?.schemaPath, "bogus");
});

test("empty matterId → invalid_payload", async () => {
  const { provide } = makeProvider({ matter: matterWith([CLIENT]) });
  const { deps } = makeDeps();
  const res = await exportT3DocxHandler({ matterId: "" }, provide, deps);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "invalid_payload");
});

// ---------- boundary errors ----------

test("absent matter → unknown_matter; evidence read + save NOT reached", async () => {
  const { provide, calls } = makeProvider({ matter: undefined });
  const { deps, calls: dcalls } = makeDeps();
  const res = await exportT3DocxHandler({ matterId: MATTER_ID }, provide, deps);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "unknown_matter");
  assert.equal(calls.listEvidence, 0);
  assert.equal(dcalls.save, 0);
});

test("tenant mismatch → tenant_mismatch; evidence read + save NOT reached", async () => {
  const { provide, calls } = makeProvider({ matter: matterWith([CLIENT], { tenant_id: "other-tenant" }) });
  const { deps, calls: dcalls } = makeDeps();
  const res = await exportT3DocxHandler({ matterId: MATTER_ID }, provide, deps);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "tenant_mismatch");
  assert.equal(calls.listEvidence, 0);
  assert.equal(dcalls.save, 0);
});

// ---------- accepted-only filtering (inherited from the shared source) ----------

test("accepted-only: proposed/rejected/superseded excluded from the exported model", async () => {
  const evidence = [
    evi({ id: "a1", status: "accepted", display_order: 0, evidence_title: "kept" }),
    evi({ id: "p1", status: "proposed", display_order: 1, evidence_title: "drop-proposed" }),
    evi({ id: "r1", status: "rejected", display_order: 2, evidence_title: "drop-rejected" }),
  ];
  const { provide, calls } = makeProvider({ matter: matterWith([CLIENT]), evidence });
  const { deps, calls: dcalls } = makeDeps({ canceled: false, filePath: "/tmp/t3.docx" });
  const res = await exportT3DocxHandler({ matterId: MATTER_ID }, provide, deps);
  assert.equal(res.ok, true);
  assert.deepEqual(res.value, { written: true });
  // every drain query requested accepted-only.
  for (const q of calls.queries) assert.equal(q.status, "accepted");
  assert.equal(dcalls.writes.length, 1);
});

// ---------- L1: DTO shape guards ----------

test("non-object payload → invalid_payload (shape guard); no persistence read", async () => {
  const { provide, calls } = makeProvider({ matter: matterWith([CLIENT]) });
  const { deps, calls: dcalls } = makeDeps();
  for (const bad of [null, undefined, 42, "x", true, [1, 2]]) {
    const res = await exportT3DocxHandler(bad, provide, deps);
    assert.equal(res.ok, false, `payload ${JSON.stringify(bad)} rejected`);
    assert.equal(res.error.code, "invalid_payload");
  }
  assert.equal(calls.getMatter, 0, "no matter read for a non-object payload");
  assert.equal(dcalls.save, 0, "no save dialog for a non-object payload");
});

test("malformed submitterSelection (wrong types) → invalid_payload", async () => {
  const { provide, calls } = makeProvider({ matter: matterWith([CLIENT]) });
  const { deps } = makeDeps();
  // partyIndex must be an integer; displayNameEcho must be a string.
  const res = await exportT3DocxHandler(
    { matterId: MATTER_ID, submitterSelection: { partyIndex: "0", displayNameEcho: 5 } },
    provide,
    deps,
  );
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "invalid_payload");
  assert.equal(res.error.details?.schemaPath, "partyIndex");
  assert.equal(calls.getMatter, 0, "malformed DTO rejected before any persistence read");

  // A non-object submitterSelection is also rejected (shape guard, no schemaPath).
  const res2 = await exportT3DocxHandler(
    { matterId: MATTER_ID, submitterSelection: "not-an-object" },
    provide,
    deps,
  );
  assert.equal(res2.ok, false);
  assert.equal(res2.error.code, "invalid_payload");

  // An unknown key inside submitterSelection is rejected and names the offending key.
  const res3 = await exportT3DocxHandler(
    { matterId: MATTER_ID, submitterSelection: { partyIndex: 0, displayNameEcho: "孙乐驰", extra: 1 } },
    provide,
    deps,
  );
  assert.equal(res3.ok, false);
  assert.equal(res3.error.details?.schemaPath, "extra");
});

// ---------- L1: delivery-path failures (build/pack + fs write) ----------

test("fs write failure → { ok:false, error } (writeFile throws)", async () => {
  const evidence = [evi({ id: "e-1", evidence_title: "x", proof_statement: "y", exhibit_page_range: "1" })];
  const { provide } = makeProvider({ matter: matterWith([CLIENT]), evidence });
  const { deps, calls: dcalls } = makeDeps({ canceled: false, filePath: "/tmp/t3.docx" });
  // The chosen path exists (dialog not cancelled) but the write throws (e.g. disk full,
  // permission denied). The handler's try/catch maps it to an error envelope, NOT a crash.
  deps.writeFile = async () => {
    throw new Error("EDQUOT: disk quota exceeded");
  };
  const res = await exportT3DocxHandler({ matterId: MATTER_ID }, provide, deps);
  assert.equal(res.ok, false, "a write failure yields an error envelope");
  assert.ok(res.error && typeof res.error.message === "string", "error envelope present");
  assert.equal(dcalls.save, 1, "the save dialog was reached before the write failed");
  // The raw thrown message never leaks to the renderer-facing envelope (errorMap allowlist).
  assert.doesNotMatch(res.error.message, /EDQUOT|disk quota/, "raw error text is not surfaced");
});

test("pack/build failure → { ok:false, error }; save dialog NOT opened, no write", async () => {
  const evidence = [evi({ id: "e-1", evidence_title: "x", proof_statement: "y", exhibit_page_range: "1" })];
  const { provide } = makeProvider({ matter: matterWith([CLIENT]), evidence });
  const { deps, calls: dcalls } = makeDeps({ canceled: false, filePath: "/tmp/t3.docx" });
  // Inject a pack that throws BEFORE any delivery (e.g. the docx builder fails). The
  // handler's try/catch maps it to an error envelope identically to the write-failure path,
  // and it must never reach the save dialog or write a file.
  deps.pack = async () => {
    throw new Error("EPACK: docx build blew up");
  };
  const res = await exportT3DocxHandler({ matterId: MATTER_ID }, provide, deps);
  assert.equal(res.ok, false, "a pack/build failure yields an error envelope");
  assert.ok(res.error && typeof res.error.message === "string", "error envelope present");
  assert.equal(dcalls.save, 0, "the save dialog is NOT opened when the pack step throws");
  assert.equal(dcalls.writes.length, 0, "no file written when the pack step throws");
  // The raw thrown message never leaks to the renderer-facing envelope (errorMap allowlist).
  assert.doesNotMatch(res.error.message, /EPACK|docx build/, "raw error text is not surfaced");
});

// ---------- L1: pagination drain on the export path ----------

test("pagination: a matter with >1 accepted page drains fully before building", async () => {
  const evidence = [
    evi({ id: "a", status: "accepted", display_order: 0, evidence_title: "页一", proof_statement: "p1", exhibit_page_range: "1" }),
    evi({ id: "b", status: "accepted", display_order: 1, evidence_title: "页二", proof_statement: "p2", exhibit_page_range: "2" }),
    evi({ id: "c", status: "accepted", display_order: 2, evidence_title: "页三", proof_statement: "p3", exhibit_page_range: "3" }),
  ];
  // pageSize 2 forces at least two drain pages for three accepted rows.
  const { provide, calls } = makeProvider({ matter: matterWith([CLIENT]), evidence, pageSize: 2 });
  const { deps, calls: dcalls } = makeDeps({ canceled: false, filePath: "/tmp/t3.docx" });
  const res = await exportT3DocxHandler({ matterId: MATTER_ID }, provide, deps);
  assert.equal(res.ok, true);
  assert.deepEqual(res.value, { written: true });
  assert.ok(calls.listEvidence >= 2, "the export drained more than one page");
  // Every drained row makes it into the exported model, numbered over the FULL input.
  const { runs } = documentTextRuns(dcalls.writes[0].data);
  for (const name of ["页一", "页二", "页三"]) assert.ok(runs.includes(name), `row ${name} present in the exported DOCX`);
  for (const seq of ["1", "2", "3"]) assert.ok(runs.includes(seq), `序号 ${seq} present`);
});

test("pagination: a repeated/never-null cursor → error (not a truncated export)", async () => {
  // A misbehaving persistence source that never returns next_cursor === null. The shared
  // drain guard detects the repeated cursor and errors rather than building a truncated
  // (mis-numbered) catalog — no document is produced.
  const persistence = {
    getMatter: async () => matterWith([CLIENT]),
    listEvidenceItems: async () => ({
      rows: [evi({ id: "e-1", evidence_title: "x", proof_statement: "y", exhibit_page_range: "1" })],
      next_cursor: "STUCK",
    }),
  };
  const provide = () => ({ persistence });
  const { deps, calls: dcalls } = makeDeps();
  const res = await exportT3DocxHandler({ matterId: MATTER_ID }, provide, deps);
  assert.equal(res.ok, false, "a non-terminating cursor is an error, not a truncated export");
  assert.equal(dcalls.save, 0, "no save dialog when the drain fails");
  assert.equal(dcalls.writes.length, 0, "no document written when the drain fails");
});

// ---------- L1: exported-DOCX content — non-promotion + accepted-only ----------

test("exported DOCX: absent S1 fields render the review marker (no notes/source/party_side promotion); non-accepted rows absent", async () => {
  const evidence = [
    // ACCEPTED, but carrying ONLY non-S1 metadata (notes/source_document_id/party_side) and
    // NO evidence_title/proof_statement/exhibit_page_range → all three columns must render
    // the explicit needs-review marker, never the metadata values.
    evi({ id: "a1", status: "accepted", display_order: 0, notes: "内部备注不应出现", source_document_id: "doc-XYZ", party_side: "我方" }),
    evi({ id: "p1", status: "proposed", display_order: 1, evidence_title: "提议不应出现" }),
    evi({ id: "r1", status: "rejected", display_order: 2, evidence_title: "驳回不应出现" }),
    evi({ id: "s1", status: "superseded", display_order: 3, evidence_title: "替代不应出现" }),
  ];
  const { provide } = makeProvider({ matter: matterWith([CLIENT]), evidence });
  const { deps, calls: dcalls } = makeDeps({ canceled: false, filePath: "/tmp/t3.docx" });
  const res = await exportT3DocxHandler({ matterId: MATTER_ID }, provide, deps);
  assert.equal(res.ok, true);
  assert.deepEqual(res.value, { written: true });

  const { xml, runs } = documentTextRuns(dcalls.writes[0].data);
  // the single accepted row's three columns are needs-review markers (not promoted values)
  assert.equal(runs.filter((r) => r === REVIEW_MARKER).length, 3, "three review-needed cells for the accepted row");
  assert.ok(
    !/内部备注不应出现|doc-XYZ|我方|notes|source_document_id|party_side/.test(xml),
    "no notes/source_document_id/party_side promotion in the exported DOCX",
  );
  // proposed/rejected/superseded rows never reach the exported model
  assert.ok(!/提议不应出现|驳回不应出现|替代不应出现/.test(xml), "non-accepted rows absent from the export");
});
