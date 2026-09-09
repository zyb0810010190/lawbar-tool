// The main-process handler for opening a registered original (product plan R1, WI-5).
//
// Runs against a REAL SqliteCaseBoxPersistence with the product's real schema, seeded with two
// rows, rather than a fake `provide` — a fake would agree with whatever this test assumed about
// `getMatter` and `getDocument`, and the seam that matters here is exactly those two calls.
//
// What is pinned:
//   * the payload is an identity and nothing else — any other shape is `invalid_request`
//   * scoping: an other-tenant matter, a wrong-matter document, a missing document — all are
//     `unknown_document`, indistinguishably, so existence never leaks across a tenant boundary
//   * the result is a whitelist: `{ok:true}` exactly; on failure a code and, for unverifiable,
//     a reason — never a path, never a message
//   * the handler takes (payload, deps) — a path parameter would be the bug

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, linkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { documentOpenHandler, DOCUMENT_OPEN_CHANNEL } from "../dist/src/caseBox/documentOpenHandlers.js";
import { _resetOpenCacheForTesting } from "../dist/src/caseBox/documentOpen.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..", "..");
const require_ = createRequire(import.meta.url);
// The desktop package's better-sqlite3 is rebuilt for Electron's ABI and aborts under plain node
// on first use; the persistence package's copy is a plain Node build, and CI installs it first.
const Database = require_(path.join(REPO, "services/case-box-persistence/node_modules/better-sqlite3"));
const { applySchema, SqliteCaseBoxPersistence } = require_(path.join(REPO, "services/case-box-persistence/dist/index.js"));

const sha = (b) => createHash("sha256").update(b).digest("hex");
const tmp = (l) => mkdtempSync(path.join(os.tmpdir(), `docopen-h-${l}-`));
const TENANT = "default-tenant"; // what getActiveTenantId() returns unless a test overrides it

/** A real persistence holding one matter and one registered document, with the file in the store. */
function makeBox({ tenant = TENANT, matterId = "01j0000000000000000000mattr".slice(0, 26), docId = "01j0000000000000000000docum".slice(0, 26) } = {}) {
  const userDataDir = tmp("data");
  const storageRoot = path.join(userDataDir, "case-box-documents");
  const db = new Database(path.join(userDataDir, "case-box.sqlite"));
  db.pragma("journal_mode = WAL");
  applySchema(db);
  const persistence = new SqliteCaseBoxPersistence({ db });

  db.prepare("INSERT INTO case_box_matters (id, tenant_id, actor_user_id, status, created_at, matter_type, payload_json) VALUES (?,?,?,?,?,?,?)")
    .run(matterId, tenant, "u1", "active", "2026-09-08T00:00:00.000Z", "litigation",
      JSON.stringify({ id: matterId, tenant_id: tenant, actor_user_id: "u1", status: "active", created_at: "2026-09-08T00:00:00.000Z", matter_type: "litigation" }));

  const bytes = Buffer.from("the filed exhibit");
  const filename = "exhibit.pdf";
  mkdirSync(path.join(storageRoot, docId), { recursive: true });
  const file = path.join(storageRoot, docId, filename);
  writeFileSync(file, bytes);
  const doc = { id: docId, tenant_id: tenant, matter_id: matterId, actor_user_id: "u1", source: "uploaded",
    filename, content_hash: sha(bytes), doc_type: "pleading", received_at: "2026-09-08T00:00:00.000Z", status: "registered", byte_size: bytes.length };
  db.prepare("INSERT INTO case_box_documents (id, tenant_id, matter_id, actor_user_id, status, received_at, doc_type, payload_json) VALUES (?,?,?,?,?,?,?,?)")
    .run(docId, tenant, matterId, "u1", "registered", doc.received_at, "pleading", JSON.stringify(doc));

  const revealed = [];
  const deps = {
    provide: () => ({ persistence }),
    storageRoot,
    reveal: async (f) => { revealed.push(f); return ""; },
  };
  const close = () => { db.close(); rmSync(userDataDir, { recursive: true, force: true }); _resetOpenCacheForTesting(); };
  return { deps, revealed, matterId, docId, file, close, db };
}

// MARK: - The payload is an identity and nothing else

test("anything but an exact {matterId, documentId} of non-empty strings is invalid_request", async () => {
  const box = makeBox();
  try {
    for (const bad of [
      null, undefined, "string", 42, [], {},
      { matterId: box.matterId },                                  // missing documentId
      { documentId: box.docId },                                   // missing matterId
      { matterId: box.matterId, documentId: "" },                  // empty
      { matterId: 7, documentId: box.docId },                      // wrong type
      { matterId: box.matterId, documentId: box.docId, path: "/etc/passwd" },  // extra field — the one that matters
      // An OWN key named __proto__ — only JSON.parse produces one; an object-literal `__proto__`
      // merely sets the prototype and adds no key. The first draft used the literal, the handler
      // correctly accepted a valid two-key identity, and the test was the thing that was wrong.
      JSON.parse(`{"matterId":"${box.matterId}","documentId":"${box.docId}","__proto__":{"x":1}}`),
    ]) {
      const r = await documentOpenHandler(bad, box.deps);
      assert.deepEqual(r, { ok: false, code: "invalid_request" }, `payload ${JSON.stringify(bad)}`);
    }
    assert.equal(box.revealed.length, 0, "nothing invalid may reach the OS");
  } finally { box.close(); }
});

test("documentOpenHandler takes (payload, deps) — there is no path parameter", () => {
  assert.equal(documentOpenHandler.length, 2);
  assert.deepEqual(DOCUMENT_OPEN_CHANNEL, { open: "document:open" });
});

// MARK: - Scoping never confirms existence across a boundary

test("a genuine open succeeds with EXACTLY {ok:true} — no path, nothing else", async () => {
  const box = makeBox();
  try {
    const r = await documentOpenHandler({ matterId: box.matterId, documentId: box.docId }, box.deps);
    assert.deepEqual(r, { ok: true });
    assert.equal(box.revealed.length, 1);
    assert.notEqual(path.resolve(box.revealed[0]), path.resolve(box.file), "a COPY was revealed, not the original");
  } finally { box.close(); }
});

test("a matter belonging to ANOTHER tenant reads as unknown_document, same as no matter at all", async () => {
  const box = makeBox({ tenant: "someone-else" });
  try {
    const r = await documentOpenHandler({ matterId: box.matterId, documentId: box.docId }, box.deps);
    assert.deepEqual(r, { ok: false, code: "unknown_document" },
      "'exists but not yours' would confirm existence across a tenant boundary");
    assert.equal(box.revealed.length, 0);
  } finally { box.close(); }
});

test("the right document under the WRONG matter is unknown_document", async () => {
  const box = makeBox();
  const otherMatter = "01j0000000000000000000other".slice(0, 26);
  try {
    box.db.prepare("INSERT INTO case_box_matters (id, tenant_id, actor_user_id, status, created_at, matter_type, payload_json) VALUES (?,?,?,?,?,?,?)")
      .run(otherMatter, TENANT, "u1", "active", "2026-09-08T00:00:00.000Z", "litigation",
        JSON.stringify({ id: otherMatter, tenant_id: TENANT, actor_user_id: "u1", status: "active", created_at: "2026-09-08T00:00:00.000Z", matter_type: "litigation" }));
    const r = await documentOpenHandler({ matterId: otherMatter, documentId: box.docId }, box.deps);
    assert.deepEqual(r, { ok: false, code: "unknown_document" },
      "a document id alone is a bearer token; the matter must be part of what is checked");
  } finally { box.close(); }
});

test("a document claiming the active tenant under a matter that belongs to ANOTHER tenant is unknown_document", async () => {
  // Found by mutation: dropping the tenant check on the MATTER left the other-tenant test green,
  // because that test seeds matter and document in the same foreign tenant and the document's own
  // tenant check catches it. The matter check guards THIS shape — an inconsistent or forged row
  // whose tenant_id says "yours" while its matter_id points elsewhere. Without the matter check
  // such a row opens; the matter is the authority on whose case this is.
  const box = makeBox({ tenant: "someone-else" });
  try {
    box.db.prepare("UPDATE case_box_documents SET payload_json = ? WHERE id = ?")
      .run(JSON.stringify({ ...JSON.parse(box.db.prepare("SELECT payload_json FROM case_box_documents WHERE id = ?").get(box.docId).payload_json), tenant_id: TENANT }), box.docId);
    const r = await documentOpenHandler({ matterId: box.matterId, documentId: box.docId }, box.deps);
    assert.deepEqual(r, { ok: false, code: "unknown_document" },
      "a document cannot vouch for its own tenancy against the matter it belongs to");
    assert.equal(box.revealed.length, 0);
  } finally { box.close(); }
});

test("a missing document is unknown_document", async () => {
  const box = makeBox();
  try {
    const r = await documentOpenHandler({ matterId: box.matterId, documentId: "01j0000000000000000000nonex".slice(0, 26) }, box.deps);
    assert.deepEqual(r, { ok: false, code: "unknown_document" });
  } finally { box.close(); }
});

// MARK: - The result is a whitelist

test("an unverifiable original forwards its reason, and nothing else", async () => {
  const box = makeBox();
  const elsewhere = tmp("elsewhere");
  try {
    linkSync(box.file, path.join(elsewhere, "shadow.pdf")); // hardlinked: not exclusively held
    const r = await documentOpenHandler({ matterId: box.matterId, documentId: box.docId }, box.deps);
    assert.deepEqual(r, { ok: false, code: "document_unverifiable", reason: "not_exclusively_held" });
    assert.deepEqual(Object.keys(r).sort(), ["code", "ok", "reason"], "exactly these keys, nothing derived from the filesystem");
  } finally { rmSync(elsewhere, { recursive: true, force: true }); box.close(); }
});

test("an altered original is document_altered with no reason field and no path", async () => {
  const box = makeBox();
  try {
    writeFileSync(box.file, "someone edited it");
    const r = await documentOpenHandler({ matterId: box.matterId, documentId: box.docId }, box.deps);
    assert.deepEqual(r, { ok: false, code: "document_altered" });
    assert.equal(JSON.stringify(r).includes(box.file), false);
  } finally { box.close(); }
});

test("an OS that refuses the copy is open_failed, and its message never crosses", async () => {
  const box = makeBox();
  try {
    const r = await documentOpenHandler({ matterId: box.matterId, documentId: box.docId },
      { ...box.deps, reveal: async () => "No application knows how to open /Volumes/Client Name/x.pdf" });
    assert.deepEqual(r, { ok: false, code: "open_failed" });
    assert.equal(JSON.stringify(r).includes("Client Name"), false);
  } finally { box.close(); }
});
