// Controlled opening of a registered original (product plan R1, first work item).
//
// Every assertion here exists because the obvious implementation gets it wrong in a way that
// costs the owner something real:
//
//   * accepting a path from the renderer            -> the app opens any file, with her privileges
//   * opening the stored file itself                -> Preview saves in place and the document's
//                                                      own integrity record now reports tampering
//                                                      by the lawyer who merely looked at it
//   * opening an altered original without saying so -> she reads evidence that is not what was filed
//   * treating "moved/hardlinked" as "changed"      -> two different facts collapsed into one
//
// The store-level safeguards (realpath'd root, lstat'd leaf, hardlink refusal, digest compare)
// are NOT re-tested here — they belong to `documentVerify` and are covered there. What is tested
// is that this path actually consults them and reports each outcome distinctly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, existsSync, linkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

import { openRegisteredOriginal, _resetOpenCacheForTesting } from "../dist/src/caseBox/documentOpen.js";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const tmp = (l) => mkdtempSync(path.join(os.tmpdir(), `docopen-${l}-`));

/** A store holding one registered original, shaped exactly as `storeDocumentFile` writes it. */
function makeStore({ body = "the filed exhibit", filename = "exhibit.pdf" } = {}) {
  const storageRoot = tmp("store");
  const id = "01j0000000000000000000abcd".slice(0, 26);
  const bytes = Buffer.from(body);
  mkdirSync(path.join(storageRoot, id), { recursive: true });
  const file = path.join(storageRoot, id, filename);
  writeFileSync(file, bytes);
  const record = { id, filename, content_hash: sha(bytes) };
  return { storageRoot, id, file, bytes, record };
}

function deps(store, over = {}) {
  const revealed = [];
  return {
    revealed,
    deps: {
      lookup: (m, d) => (m === "M-1" && d === store.id ? store.record : null),
      storageRoot: store.storageRoot,
      reveal: async (f) => { revealed.push(f); return ""; },   // "" = the OS accepted it
      ...over,
    },
  };
}

// MARK: - The renderer supplies an identity, never a path

test("an unknown document id is refused, and the matter is part of the identity", async () => {
  const store = makeStore();
  const { deps: d } = deps(store);
  try {
    assert.deepEqual(await openRegisteredOriginal("M-1", "not-a-real-id", d),
      { ok: false, code: "unknown_document" });
    // Right document, WRONG matter. A document id alone is a bearer token for any document in
    // the box; the matter has to be part of what is checked, not taken on trust.
    assert.deepEqual(await openRegisteredOriginal("M-OTHER", store.id, d),
      { ok: false, code: "unknown_document" });
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

test("openRegisteredOriginal takes ids and deps — there is no path parameter to abuse", () => {
  assert.equal(openRegisteredOriginal.length, 3, "matterId, documentId, deps. A path would be the bug.");
});

// MARK: - What actually gets opened

test("the file handed to the OS is a COPY, and the original is untouched", async () => {
  const store = makeStore();
  const { deps: d, revealed } = deps(store);
  try {
    const r = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(r.ok, true, r.ok ? "" : r.code);
    assert.equal(revealed.length, 1);
    assert.equal(revealed[0], r.openedPath);
    assert.notEqual(path.resolve(r.openedPath), path.resolve(store.file),
      "the canonical original must never be what an editor is pointed at");
    assert.equal(sha(readFileSync(r.openedPath)), store.record.content_hash,
      "the copy must be byte-identical to the verified original");
    assert.equal(sha(readFileSync(store.file)), store.record.content_hash,
      "and the original must be exactly as it was");
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

test("the copy is READ-ONLY, so an incidental save cannot rewrite the evidence", async () => {
  const store = makeStore();
  const { deps: d } = deps(store);
  try {
    const r = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(r.ok, true);
    const mode = statSync(r.openedPath).mode & 0o777;
    assert.equal(mode & 0o222, 0, `the copy must not be writable by anyone; mode ${mode.toString(8)}`);
    assert.equal(mode & 0o400, 0o400, "the owner must still be able to read it");
    // umask can only REMOVE bits, so an explicit chmod is what makes 0400 reliable — the same
    // lesson as the release-harness stubs.
    assert.equal(mode & 0o077, 0, "no group or other access to privileged client material");
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

test("only one copy exists at a time — each open disposes of the last", async () => {
  const store = makeStore();
  const { deps: d } = deps(store);
  try {
    const first = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(first.ok, true);
    assert.equal(existsSync(first.openedPath), true);
    const second = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(second.ok, true);
    assert.equal(existsSync(first.openedPath), false,
      "every copy is privileged client material; they must not accumulate");
    assert.equal(existsSync(second.openedPath), true);
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

// MARK: - Refusals, each said distinctly

test("a MISSING original is refused as missing, not as altered", async () => {
  const store = makeStore();
  const { deps: d } = deps(store);
  try {
    rmSync(store.file);
    assert.deepEqual(await openRegisteredOriginal("M-1", store.id, d),
      { ok: false, code: "document_missing" });
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

test("an ALTERED original is refused and never opened", async () => {
  const store = makeStore();
  const { deps: d, revealed } = deps(store);
  try {
    writeFileSync(store.file, "someone edited the filed exhibit");
    const r = await openRegisteredOriginal("M-1", store.id, d);
    assert.deepEqual(r, { ok: false, code: "document_altered" });
    assert.equal(revealed.length, 0,
      "a document that no longer matches what was filed must not be put in front of the lawyer");
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

test("a HARDLINKED original is unverifiable, not merely altered — a different fact", async () => {
  const store = makeStore();
  const { deps: d, revealed } = deps(store);
  const elsewhere = tmp("elsewhere");
  try {
    // Another path can mutate the same inode, so custody of these bytes is not exclusive.
    linkSync(store.file, path.join(elsewhere, "shadow.pdf"));
    const r = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(r.ok, false);
    assert.equal(r.code, "document_unverifiable");
    assert.equal(r.reason, "not_exclusively_held",
      "the reason must survive to the caller; 'unverifiable' alone cannot be acted on");
    assert.equal(revealed.length, 0);
  } finally {
    rmSync(store.storageRoot, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true }); _resetOpenCacheForTesting();
  }
});

test("an OS that refuses to open reports open_failed, not success", async () => {
  const store = makeStore();
  const { deps: d } = deps(store, { reveal: async () => "no application can open this file" });
  try {
    assert.deepEqual(await openRegisteredOriginal("M-1", store.id, d),
      { ok: false, code: "open_failed" });
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

test("a reveal that throws is caught rather than crashing the handler", async () => {
  const store = makeStore();
  const { deps: d } = deps(store, { reveal: async () => { throw new Error("LaunchServices blew up"); } });
  try {
    const r = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(r.ok, false);
    assert.equal(r.code, "open_failed");
    assert.equal(JSON.stringify(r).includes("LaunchServices"), false,
      "no raw OS text crosses the boundary");
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});
