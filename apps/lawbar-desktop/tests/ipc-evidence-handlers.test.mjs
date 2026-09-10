// casebox:evidence:{list,create,transition} against a REAL SqliteCaseBoxPersistence (WI-10).
//
// A fake persistence would agree with whatever the handler assumed about the row shape and the
// edge set. The real one validates the appended row against the contract, writes the audit
// event, and enforces proposed → accepted | rejected (both terminal for this channel), so what
// is pinned here is what production does. The plain-node better-sqlite3 under
// services/case-box-persistence is used because the desktop copy is built for Electron's ABI.
//
// What is pinned:
//   * the payload guard: exact fields, no server-authority fields, no prototype tricks
//   * scoping: unknown matter, wrong tenant, and a document from ANOTHER matter are refused —
//     the last as unknown_document, so the caller learns nothing about where the id lives
//   * create appends a `proposed` row with source_document_id = the document, title trimmed,
//     lawyer_weight defaulting to moderate, and no field the renderer did not send
//   * transition adopts and excludes, and a second transition on a terminal row is
//     illegal_transition from persistence — not re-implemented here
//   * nothing but the allowlisted fields crosses back

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  listEvidenceItemsHandler,
  createEvidenceItemHandler,
  transitionEvidenceItemHandler,
} from "../dist/src/caseBox/evidenceHandlers.js";
import { LIST_EVIDENCE_ITEMS_RESPONSE_FIELDS, CREATE_EVIDENCE_ITEM_FORBIDDEN_FIELDS } from "../dist/src/caseBox/dto.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..", "..");
const require_ = createRequire(import.meta.url);
const Database = require_(path.join(REPO, "services/case-box-persistence/node_modules/better-sqlite3"));
const { applySchema, SqliteCaseBoxPersistence } = require_(path.join(REPO, "services/case-box-persistence/dist/index.js"));

const sha = (b) => createHash("sha256").update(b).digest("hex");
const TENANT = "default-tenant";
const NOW = new Date("2026-09-10T12:00:00.000Z");
const clock = () => NOW;
let idSeq = 0;
const idFactory = () => `01j0000000000000000ev${String(++idSeq).padStart(5, "0")}`.slice(0, 26);

const MATTER = "01j0000000000000000000mattr".slice(0, 26);
const OTHER_MATTER = "01j0000000000000000000other".slice(0, 26);
const DOC_A = "01j0000000000000000000docaa".slice(0, 26);
const DOC_OTHER = "01j0000000000000000000docot".slice(0, 26);

function makeBox() {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "evidence-h-"));
  const storageRoot = path.join(userDataDir, "case-box-documents");
  const db = new Database(path.join(userDataDir, "case-box.sqlite"));
  db.pragma("journal_mode = WAL");
  applySchema(db);
  const persistence = new SqliteCaseBoxPersistence({ db });
  const insertMatter = (id, tenant) =>
    db.prepare("INSERT INTO case_box_matters (id, tenant_id, actor_user_id, status, created_at, matter_type, payload_json) VALUES (?,?,?,?,?,?,?)")
      .run(id, tenant, "u1", "active", "2026-09-08T00:00:00.000Z", "litigation",
        JSON.stringify({ id, tenant_id: tenant, actor_user_id: "u1", status: "active", created_at: "2026-09-08T00:00:00.000Z", matter_type: "litigation" }));
  const insertDoc = (id, matterId, tenant, filename) => {
    const bytes = Buffer.from(`exhibit ${filename}`);
    mkdirSync(path.join(storageRoot, id), { recursive: true });
    writeFileSync(path.join(storageRoot, id, filename), bytes);
    const doc = { id, tenant_id: tenant, matter_id: matterId, actor_user_id: "u1", source: "uploaded",
      filename, content_hash: sha(bytes), doc_type: "exhibit", received_at: "2026-09-08T00:00:00.000Z", status: "registered", byte_size: bytes.length };
    db.prepare("INSERT INTO case_box_documents (id, tenant_id, matter_id, actor_user_id, status, received_at, doc_type, payload_json) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, tenant, matterId, "u1", "registered", doc.received_at, "exhibit", JSON.stringify(doc));
  };
  insertMatter(MATTER, TENANT);
  insertMatter(OTHER_MATTER, TENANT);
  insertDoc(DOC_A, MATTER, TENANT, "contract.pdf");
  insertDoc(DOC_OTHER, OTHER_MATTER, TENANT, "elsewhere.pdf");
  const provide = () => ({ persistence });
  const close = () => { db.close(); rmSync(userDataDir, { recursive: true, force: true }); };
  return { provide, close, db };
}

const create = (box, dto) => createEvidenceItemHandler(dto, box.provide, clock, idFactory);
const list = (box, dto) => listEvidenceItemsHandler(dto, box.provide);
const transition = (box, dto) => transitionEvidenceItemHandler(dto, box.provide);

// MARK: - Payload guard

test("create: exact fields only — a server-authority field, an unknown field, or a prototype trick is refused", async () => {
  const box = makeBox();
  try {
    const good = { matterId: MATTER, documentId: DOC_A, evidence_title: "合同" };
    for (const forbidden of CREATE_EVIDENCE_ITEM_FORBIDDEN_FIELDS) {
      const r = await create(box, { ...good, [forbidden]: "x" });
      assert.equal(r.ok, false, forbidden);
      assert.equal(r.error.code, "invalid_payload", forbidden);
    }
    for (const bad of [
      null, "s", 7, [], {},
      { matterId: MATTER },
      { matterId: MATTER, documentId: DOC_A },                  // no title
      { matterId: MATTER, documentId: DOC_A, evidence_title: "   " },
      { ...good, path: "/etc/passwd" },
      { ...good, party_side: "theirs" },
      { ...good, lawyer_weight: "decisive" },
      { ...good, display_order: -1 },
      { ...good, display_order: 1.5 },
      { ...good, proof_statement: "" },
      JSON.parse(`{"matterId":"${MATTER}","documentId":"${DOC_A}","evidence_title":"t","__proto__":{"x":1}}`),
    ]) {
      const r = await create(box, bad);
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.equal(r.error.code, "invalid_payload", JSON.stringify(bad));
    }
    const page = await list(box, { matterId: MATTER });
    assert.equal(page.ok, true);
    assert.equal(page.value.rows.length, 0, "no refused payload may have written a row");
  } finally { box.close(); }
});

// MARK: - Scoping

test("create: unknown matter, and a document that belongs to ANOTHER matter, are refused without a write", async () => {
  const box = makeBox();
  try {
    const unknown = await create(box, { matterId: "01j0000000000000000000nomat".slice(0, 26), documentId: DOC_A, evidence_title: "t" });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error.code, "unknown_matter");
    // The document exists — in the other matter. It must read as unknown here, not as a mismatch:
    // a document id is a bearer token for any document in the box otherwise.
    const cross = await create(box, { matterId: MATTER, documentId: DOC_OTHER, evidence_title: "t" });
    assert.equal(cross.ok, false);
    assert.equal(cross.error.code, "unknown_document");
    const missing = await create(box, { matterId: MATTER, documentId: "01j0000000000000000000nodoc".slice(0, 26), evidence_title: "t" });
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, "unknown_document");
    const page = await list(box, { matterId: MATTER });
    assert.equal(page.value.rows.length, 0);
    const other = await list(box, { matterId: OTHER_MATTER });
    assert.equal(other.value.rows.length, 0, "nothing landed in the other matter either");
  } finally { box.close(); }
});

// MARK: - Create

test("create appends a proposed row drawn from the document, with only what was sent plus the defaults", async () => {
  const box = makeBox();
  try {
    const r = await create(box, {
      matterId: MATTER, documentId: DOC_A, evidence_title: "  劳动合同  ", proof_statement: " 证明劳动关系 ",
      exhibit_page_range: "1-5", party_side: "our", display_order: 1,
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    const row = r.value;
    assert.equal(row.status, "proposed");
    assert.equal(row.source_document_id, DOC_A);
    assert.equal(row.evidence_title, "劳动合同", "title is trimmed");
    assert.equal(row.proof_statement, "证明劳动关系", "proof is trimmed");
    assert.equal(row.exhibit_page_range, "1-5");
    assert.equal(row.party_side, "our");
    assert.equal(row.display_order, 1);
    assert.equal(row.lawyer_weight, "moderate", "weight defaults to moderate when not sent");
    assert.equal(row.matter_id, MATTER);
    assert.deepEqual(Object.keys(row).sort(), [...LIST_EVIDENCE_ITEMS_RESPONSE_FIELDS].filter((k) => k in row).sort(),
      "only allowlisted fields cross back");
    assert.equal("tenant_id" in row, false);
    assert.equal("actor_user_id" in row, false);

    // Minimal create: no optional fields at all.
    const min = await create(box, { matterId: MATTER, documentId: DOC_A, evidence_title: "发票" });
    assert.equal(min.ok, true);
    assert.equal(min.value.proof_statement, undefined);
    assert.equal(min.value.party_side === undefined || min.value.party_side === null, true);

    const page = await list(box, { matterId: MATTER });
    assert.equal(page.ok, true);
    assert.equal(page.value.rows.length, 2);
    // The audit chain recorded both appends — the real persistence wrote them.
    const events = box.db.prepare("SELECT COUNT(*) AS n FROM case_box_audit_events WHERE matter_id = ?").get(MATTER).n;
    assert.ok(events >= 2, `expected audit events for two appends, got ${events}`);
  } finally { box.close(); }
});

// MARK: - Transition

test("transition: adopt and exclude from proposed; a second move on a terminal row is illegal_transition from persistence", async () => {
  const box = makeBox();
  try {
    const a = (await create(box, { matterId: MATTER, documentId: DOC_A, evidence_title: "A" })).value;
    const b = (await create(box, { matterId: MATTER, documentId: DOC_A, evidence_title: "B" })).value;
    const adopted = await transition(box, { matterId: MATTER, evidenceId: a.id, to: "accepted" });
    assert.equal(adopted.ok, true, JSON.stringify(adopted));
    assert.equal(adopted.value.status, "accepted");
    const excluded = await transition(box, { matterId: MATTER, evidenceId: b.id, to: "rejected" });
    assert.equal(excluded.ok, true);
    assert.equal(excluded.value.status, "rejected");
    // Terminal for this channel: rejected → accepted is not an edge, and accepted → rejected is not either.
    const again = await transition(box, { matterId: MATTER, evidenceId: b.id, to: "accepted" });
    assert.equal(again.ok, false);
    assert.equal(again.error.code, "illegal_transition");
    const back = await transition(box, { matterId: MATTER, evidenceId: a.id, to: "rejected" });
    assert.equal(back.ok, false);
    assert.equal(back.error.code, "illegal_transition");
    // Only the two targets exist here; superseded needs a replacement and is not exposed.
    const sup = await transition(box, { matterId: MATTER, evidenceId: a.id, to: "superseded" });
    assert.equal(sup.ok, false);
    assert.equal(sup.error.code, "invalid_payload");
    // Persisted, not just echoed.
    const page = await list(box, { matterId: MATTER });
    const byId = Object.fromEntries(page.value.rows.map((r) => [r.id, r.status]));
    assert.equal(byId[a.id], "accepted");
    assert.equal(byId[b.id], "rejected");
  } finally { box.close(); }
});

test("transition: an evidence id from another matter is refused as invalid_payload, and nothing moves", async () => {
  const box = makeBox();
  try {
    const a = (await create(box, { matterId: MATTER, documentId: DOC_A, evidence_title: "A" })).value;
    const r = await transition(box, { matterId: OTHER_MATTER, evidenceId: a.id, to: "accepted" });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "invalid_payload");
    const page = await list(box, { matterId: MATTER });
    assert.equal(page.value.rows[0].status, "proposed");
    for (const bad of [{ matterId: MATTER, evidenceId: a.id, to: "accepted", status: "accepted" }, { matterId: MATTER, evidenceId: a.id }, { matterId: MATTER, evidenceId: a.id, to: "reviewed" }]) {
      const x = await transition(box, bad);
      assert.equal(x.ok, false, JSON.stringify(bad));
      assert.equal(x.error.code, "invalid_payload", JSON.stringify(bad));
    }
  } finally { box.close(); }
});

// MARK: - List

test("list: scoped to the matter, projected through the allowlist, and refuses server fields", async () => {
  const box = makeBox();
  try {
    await create(box, { matterId: MATTER, documentId: DOC_A, evidence_title: "A" });
    for (const bad of [{ matterId: MATTER, tenant_id: "t" }, { matterId: MATTER, status: "accepted" }, { matterId: MATTER, limit: 0 }, { matterId: MATTER, extra: 1 }]) {
      const r = await list(box, bad);
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.equal(r.error.code, "invalid_payload");
    }
    const r = await list(box, { matterId: MATTER, limit: 200 });
    assert.equal(r.ok, true);
    assert.equal(r.value.rows.length, 1);
    for (const k of Object.keys(r.value.rows[0])) {
      assert.ok(LIST_EVIDENCE_ITEMS_RESPONSE_FIELDS.includes(k), `unexpected field crossed the boundary: ${k}`);
    }
    const other = await list(box, { matterId: OTHER_MATTER });
    assert.equal(other.value.rows.length, 0);
  } finally { box.close(); }
});
