// verifyDocumentStore — re-verifies stored exhibit bytes against the content_hash
// recorded at ingest. Until this existed, the audit chain was tamper-evident while the
// documents it points at were never re-checked: an exhibit could be replaced on disk and
// every other test still passed.
//
// The matrix below is the four-case original PLUS the gaps a spec-adversary pass found
// before any implementation existed. The two that changed the SHAPE of the unit:
//
//   * A third bucket, `unverifiable[]`, with a reason per entry. "The file is gone" and
//     "the file is there and I could not verify it" are different statements to a court,
//     and the second is the more alarming one. With two buckets an implementer either
//     drops those cases (false green) or folds them into `missing` (false story).
//
//   * The stored path is DERIVED — join(storageRoot, id, safeBasename(filename, id)) —
//     never taken from `storage_uri`. The custody claim is "the file in the application's
//     store is the file that was ingested", so containment must be structural. Deriving
//     makes a redirected `storage_uri` inert rather than merely detectable, and keeps the
//     documented backup/restore flow working: `storage_uri` bakes in the macOS username,
//     so a URI-authoritative verifier would report 100% missing after a restore under a
//     different account.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, stat, readdir, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { storeDocumentFile, safeBasename } from "../dist/src/caseBox/documentStorage.js";
import { verifyDocumentStore } from "../dist/src/caseBox/documentVerify.js";

const sha256 = (b) => createHash("sha256").update(b).digest("hex");


/**
 * The partition law. Every input document lands in exactly one of four outcomes —
 * clean, missing, mismatched, unverifiable. Asserted after EVERY case, because
 * field-by-field assertions let a wrongly-populated sibling bucket survive: a test that
 * checks `missing` contains an id says nothing about the same id also appearing in
 * `mismatched`.
 */
function assertPartition(r, documents) {
  const inputIds = documents.map((d) => d.id);
  const un = r.unverifiable.map((u) => u.id);
  const all = [...r.missing, ...r.mismatched, ...un];

  assert.equal(r.checked, documents.length, "checked must equal the input size");
  for (const id of all) assert.ok(inputIds.includes(id), `reported an id that was not input: ${id}`);
  assert.equal(new Set(all).size, all.length, `an id appears in more than one bucket, or twice: ${all.join(",")}`);
  assert.ok(all.length <= documents.length, "more outcomes than documents");
  assert.equal(r.ok, all.length === 0, "ok must mean exactly: no document landed in any defect bucket");
  for (const u of r.unverifiable) assert.ok(typeof u.reason === "string" && u.reason.length > 0, "every unverifiable entry needs a reason");
}

async function makeStore(specs) {
  const root = await mkdtemp(path.join(os.tmpdir(), "docverify-"));
  const src = path.join(root, "src");
  await mkdir(src, { recursive: true });
  const storageRoot = path.join(root, "store");
  const documents = [];
  for (const [i, s] of specs.entries()) {
    const filename = s.filename ?? `exhibit-${i}.pdf`;
    const sp = path.join(src, `in-${i}`);
    await writeFile(sp, s.bytes ?? Buffer.from(`SYNTHETIC EXHIBIT ${i}`));
    const id = s.id ?? `01jdoc${String(i).padStart(20, "0")}`;
    const stored = await storeDocumentFile({ sourcePath: sp, storageRoot, documentId: id, filename });
    documents.push({ id, filename, content_hash: s.content_hash ?? stored.content_hash, storage_uri: stored.storage_uri });
  }
  const pathOf = (d) => path.join(storageRoot, d.id, safeBasename(d.filename, d.id));
  return { root, storageRoot, documents, pathOf, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("T1 an intact store verifies clean", async () => {
  const s = await makeStore([{}, {}, {}]);
  const r = await verifyDocumentStore(s.documents, { storageRoot: s.storageRoot });
  assertPartition(r, s.documents);
  assertPartition(r, s.documents);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.mismatched, []);
  assert.deepEqual(r.unverifiable, []);
  await s.cleanup();
});

test("T2 a deleted file is reported missing, not mismatched", async () => {
  const s = await makeStore([{}, {}]);
  await rm(s.pathOf(s.documents[1]));
  const r = await verifyDocumentStore(s.documents, { storageRoot: s.storageRoot });
  assertPartition(r, s.documents);
  assertPartition(r, s.documents);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, [s.documents[1].id]);
  assert.deepEqual(r.mismatched, []);
  await s.cleanup();
});

test("T3 bytes flipped at the SAME length are reported mismatched", async () => {
  // The same-length qualifier is load-bearing: it defeats every size-comparison
  // implementation, which is the most likely wrong way to write a content check.
  const s = await makeStore([{ bytes: Buffer.from("AAAA") }, {}]);
  await writeFile(s.pathOf(s.documents[0]), Buffer.from("AAAB"));
  const r = await verifyDocumentStore(s.documents, { storageRoot: s.storageRoot });
  assertPartition(r, s.documents);
  assertPartition(r, s.documents);
  assert.equal(r.ok, false);
  assert.deepEqual(r.mismatched, [s.documents[0].id]);
  assert.deepEqual(r.missing, []);
  await s.cleanup();
});

test("T4 an empty store verifies clean and does not throw", async () => {
  const s = await makeStore([]);
  const r = await verifyDocumentStore(s.documents, { storageRoot: s.storageRoot });
  assertPartition(r, s.documents);
  assertPartition(r, s.documents);
  assert.deepEqual(r, { ok: true, checked: 0, missing: [], mismatched: [], unverifiable: [] });
  assertPartition(r, s.documents);
  await s.cleanup();
});

test("T5 a file replaced by a DIRECTORY is unverifiable, never silently intact", async () => {
  // Gap 2: existsSync passes, readFile throws EISDIR. A try/catch written to stop one bad
  // row crashing the report turns this into a false green — the verifier reports success
  // about a file it never read a byte of.
  const s = await makeStore([{}]);
  const p = s.pathOf(s.documents[0]);
  await rm(p);
  await mkdir(p);
  const r = await verifyDocumentStore(s.documents, { storageRoot: s.storageRoot });
  assertPartition(r, s.documents);
  assertPartition(r, s.documents);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, [], "a directory in the file's place is NOT 'missing'");
  assert.equal(r.unverifiable.length, 1);
  assert.equal(r.unverifiable[0].id, s.documents[0].id);
  assert.equal(r.unverifiable[0].reason, "not_a_regular_file");
  await s.cleanup();
});

test("T6 a record whose content_hash cannot be a SHA-256 digest is unverifiable", async () => {
  // Gap 3: the schema constrains content_hash to minLength 1 with no hex pattern, so
  // `content_hash: "x"` is schema-valid today. Blanking one column must not make an
  // exhibit permanently 'verified' — that is the cheapest possible tamper.
  const s = await makeStore([{ content_hash: "" }, { content_hash: "x" }, { content_hash: "NOTAHASH" }]);
  const r = await verifyDocumentStore(s.documents, { storageRoot: s.storageRoot });
  assertPartition(r, s.documents);
  assertPartition(r, s.documents);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unverifiable.map((u) => u.reason), ["unusable_digest", "unusable_digest", "unusable_digest"]);
  assert.deepEqual(r.mismatched, []);
  await s.cleanup();
});

test("T7 every defect is reported — no early return, and order does not matter", async () => {
  // Gap 4: with one defect per fixture, early return is indistinguishable from full
  // enumeration. An integrity report that stops at the first bad exhibit understates the
  // scope of a tamper, which is the worst possible property for a document handed to a court.
  const s = await makeStore([{}, {}, {}, {}, { content_hash: "zz" }]);
  await rm(s.pathOf(s.documents[1]));
  await rm(s.pathOf(s.documents[2]));
  await writeFile(s.pathOf(s.documents[3]), Buffer.from("TAMPERED-DIFFERENT"));
  const ids = s.documents.map((d) => d.id);

  const a = await verifyDocumentStore(s.documents, { storageRoot: s.storageRoot });
  const b = await verifyDocumentStore([...s.documents].reverse(), { storageRoot: s.storageRoot });

  assertPartition(a, s.documents);
  assertPartition(b, s.documents);
  assert.deepEqual([...a.missing].sort(), [ids[1], ids[2]].sort());
  assert.deepEqual(a.mismatched, [ids[3]]);
  assert.deepEqual(a.unverifiable.map((u) => u.id), [ids[4]]);
  assert.deepEqual([...b.missing].sort(), [...a.missing].sort(), "order-independent");
  assert.deepEqual([...b.mismatched].sort(), [...a.mismatched].sort());
  await s.cleanup();
});

test("T8 a symlink to a byte-identical file outside the store does not verify", async () => {
  // Gap 5: the app's whole safety posture is that the file is COPIED into an
  // app-controlled directory. A verifier that follows symlinks silently retires that
  // guarantee — the bytes now live outside the store and can be swapped afterwards.
  const s = await makeStore([{ bytes: Buffer.from("IDENTICAL") }]);
  const p = s.pathOf(s.documents[0]);
  const outside = path.join(s.root, "outside.pdf");
  await writeFile(outside, Buffer.from("IDENTICAL"));
  await rm(p);
  await symlink(outside, p);
  const r = await verifyDocumentStore(s.documents, { storageRoot: s.storageRoot });
  assertPartition(r, s.documents);
  assertPartition(r, s.documents);
  assert.equal(r.ok, false, "identical bytes via a symlink are still outside custody");
  assert.equal(r.unverifiable[0]?.reason, "not_a_regular_file");
  await s.cleanup();
});

test("T9 filenames with spaces, CJK and # verify clean", async () => {
  // Gap 6: pathToFileURL percent-encodes these. A naive `storage_uri.replace("file://","")`
  // reports them all missing — a false tamper alarm across most of a Chinese-language
  // corpus, which destroys trust in the report as surely as a false green.
  const s = await makeStore([
    { filename: "合同 附件 (1).pdf" },
    { filename: "note#2.pdf" },
    { filename: "a b.pdf" },
  ]);
  const r = await verifyDocumentStore(s.documents, { storageRoot: s.storageRoot });
  assertPartition(r, s.documents);
  assertPartition(r, s.documents);
  assert.equal(r.ok, true, JSON.stringify(r));
  await s.cleanup();
});

test("T10 truncation to zero bytes is a mismatch, not a pass", async () => {
  // Gap 7: the likeliest ACCIDENTAL corruption — interrupted copy, failed restore, full
  // disk — and a trivially available tamper. An `if (!bytes) continue` guard reports clean.
  const s = await makeStore([{ bytes: Buffer.from("ORIGINAL CONTENT") }, { bytes: Buffer.from("SECOND") }]);
  await writeFile(s.pathOf(s.documents[0]), Buffer.alloc(0));
  await writeFile(s.pathOf(s.documents[1]), Buffer.from("SEC"));
  const r = await verifyDocumentStore(s.documents, { storageRoot: s.storageRoot });
  assertPartition(r, s.documents);
  assertPartition(r, s.documents);
  assert.deepEqual([...r.mismatched].sort(), [s.documents[0].id, s.documents[1].id].sort());
  await s.cleanup();
});

test("T11 verification is repeatable and alters neither the input nor the evidence", async () => {
  // Gap 8: a module-scope accumulator makes the second run inherit the first run's
  // defects. And for a tool whose output is offered as evidence, "the verifier did not
  // alter what it examined" is a claim worth one assertion.
  const s = await makeStore([{}, {}]);
  await rm(s.pathOf(s.documents[1]));
  const before = JSON.stringify(s.documents);
  const listBefore = (await readdir(path.join(s.storageRoot, s.documents[0].id))).sort();
  const hashBefore = sha256(await readFile(s.pathOf(s.documents[0])));

  const r1 = await verifyDocumentStore(s.documents, { storageRoot: s.storageRoot });
  const r2 = await verifyDocumentStore(s.documents, { storageRoot: s.storageRoot });

  assertPartition(r1, s.documents);
  assertPartition(r2, s.documents);
  assert.deepEqual(r1.missing, [s.documents[1].id], "the deletion must actually be REPORTED — without this the whole case passes against a hardcoded clean return");
  assert.deepEqual(r1, r2, "repeatable");
  assert.equal(JSON.stringify(s.documents), before, "input array not mutated");
  assert.deepEqual((await readdir(path.join(s.storageRoot, s.documents[0].id))).sort(), listBefore);
  assert.equal(sha256(await readFile(s.pathOf(s.documents[0]))), hashBefore, "evidence untouched");
  await s.cleanup();
});

// ---------------------------------------------------------------------------
// Adversarial cases added after a stage-6 Codex audit found THREE false-green
// paths in the first implementation — all of them in code whose comment claimed
// "containment is structural". It was structural in neither of the two ways that
// mattered, and a third path skipped verification entirely.
// ---------------------------------------------------------------------------

test("T12 a non-finite concurrency must not silently verify nothing", async () => {
  // Math.max(1, Math.min(NaN, n)) is NaN; Array.from({length: NaN}) is []; Promise.all([])
  // resolves at once and ok is computed over three empty arrays. A caller passing a bad
  // value from config got a clean bill of health on a tampered store.
  const s = await makeStore([{ bytes: Buffer.from("ORIGINAL") }]);
  await writeFile(s.pathOf(s.documents[0]), Buffer.from("TAMPERED"));
  for (const c of [NaN, 0, -1, undefined, "8"]) {
    const r = await verifyDocumentStore(s.documents, { storageRoot: s.storageRoot, concurrency: c });
    assertPartition(r, s.documents);
    assert.equal(r.ok, false, `concurrency=${String(c)} must still verify`);
    assert.deepEqual(r.mismatched, [s.documents[0].id], `concurrency=${String(c)}`);
  }
  await s.cleanup();
});

test("T13 an id that escapes storageRoot is unverifiable, never green", async () => {
  // `id` is an untrusted string on the record. path.join(root, "..", name) leaves the
  // store entirely, so a hand-edited row could point the verifier at any file on disk and
  // have it certify those bytes as the exhibit.
  // One real document so the store ROOT exists: with an empty store the root is never
  // created, store_unavailable fires first (correctly — a store-level failure dominates a
  // record-level one), and this case would not exercise the id guard at all.
  const s = await makeStore([{}]);
  const outside = path.join(s.root, "outside.pdf");
  await writeFile(outside, Buffer.from("OUTSIDE BYTES"));
  const r = await verifyDocumentStore(
    [{ id: "..", filename: "outside.pdf", content_hash: sha256(Buffer.from("OUTSIDE BYTES")) }],
    { storageRoot: s.storageRoot },
  );
  assertPartition(r, [{ id: "..", filename: "outside.pdf", content_hash: sha256(Buffer.from("OUTSIDE BYTES")) }]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, [], "an escaping id is not 'missing' — it is unverifiable");
  assert.equal(r.unverifiable[0]?.reason, "unusable_id");
  await s.cleanup();
});

test("T14 a symlinked ANCESTOR directory does not verify, even with identical bytes", async () => {
  // lstat() only examines the leaf. If storageRoot/<id> is itself a symlink to a directory
  // outside the store, lstat on the leaf resolves through it and sees an ordinary file.
  const s = await makeStore([]);
  const id = "01jdoc00000000000000000009";
  const elsewhere = path.join(s.root, "elsewhere");
  await mkdir(elsewhere, { recursive: true });
  await writeFile(path.join(elsewhere, "b.pdf"), Buffer.from("IDENTICAL"));
  await mkdir(s.storageRoot, { recursive: true });
  await symlink(elsewhere, path.join(s.storageRoot, id));
  const r = await verifyDocumentStore(
    [{ id, filename: "b.pdf", content_hash: sha256(Buffer.from("IDENTICAL")) }],
    { storageRoot: s.storageRoot },
  );
  assertPartition(r, [{ id, filename: "b.pdf", content_hash: sha256(Buffer.from("IDENTICAL")) }]);
  assert.equal(r.ok, false, "bytes reached through a symlinked ancestor are not in custody");
  assert.equal(r.unverifiable[0]?.reason, "outside_store");
  await s.cleanup();
});

test("T15 a permission error is unverifiable, not missing", async () => {
  // Every lstat failure was reported as `missing`. EACCES means "could not verify", and
  // conflating the two is exactly the distinction the third bucket exists to preserve.
  if (process.getuid && process.getuid() === 0) return; // root reads anything
  const s = await makeStore([{}]);
  const dir = path.join(s.storageRoot, s.documents[0].id);
  await chmod(dir, 0o000);
  const r = await verifyDocumentStore(s.documents, { storageRoot: s.storageRoot });
  assertPartition(r, s.documents);
  assertPartition(r, s.documents);
  await chmod(dir, 0o755);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, [], "a permission error is not 'gone'");
  assert.equal(r.unverifiable.length, 1);
  await s.cleanup();
});

test("T16 an UPPERCASE hex digest is a usable digest, not a false alarm", async () => {
  // Rejecting a valid digest is a false-alarm class, and false alarms destroy trust in the
  // report as surely as a false green.
  const s = await makeStore([{}]);
  const upper = [{ ...s.documents[0], content_hash: s.documents[0].content_hash.toUpperCase() }];
  const r = await verifyDocumentStore(upper, { storageRoot: s.storageRoot });
  assertPartition(r, s.documents);
  assert.equal(r.ok, true, JSON.stringify(r));
  await s.cleanup();
});

// ---------------------------------------------------------------------------
// Added after a stage-7 test-quality review found that the two design decisions
// this work item turns on were the two things the suite constrained LEAST, and
// that the fan-out loop was dead structure under every fixture.
// ---------------------------------------------------------------------------

test("T17 the derived path wins: a restore under a different account still verifies", async () => {
  // Every earlier case set storage_uri to the true path, so all 11 passed against a
  // storage_uri-AUTHORITATIVE implementation too — the headline decision had no test that
  // could fail if it were reverted. Here the recorded URI is a stale absolute path from
  // another machine, exactly what a restore produces, while the files sit correctly in
  // the store. A URI-authoritative verifier reports 100% missing.
  const s = await makeStore([{}, {}]);
  const stale = s.documents.map((d) => ({
    ...d,
    storage_uri: `file:///Users/someone-else/Library/Application%20Support/lawbar/${d.id}/x.pdf`,
  }));
  const r = await verifyDocumentStore(stale, { storageRoot: s.storageRoot });
  assertPartition(r, s.documents);
  assertPartition(r, stale);
  assert.equal(r.ok, true, "the files are present in the store; only the recorded URI is stale");
  await s.cleanup();
});

test("T18 the derived path wins: a redirected storage_uri is inert, not merely detectable", async () => {
  // The other direction. The in-store file is deleted and storage_uri is redirected to a
  // byte-identical file outside. A URI-authoritative verifier hashes the outside file and
  // certifies bytes the application never had custody of.
  const s = await makeStore([{ bytes: Buffer.from("EXHIBIT") }]);
  const outside = path.join(s.root, "planted.pdf");
  await writeFile(outside, Buffer.from("EXHIBIT"));
  await rm(s.pathOf(s.documents[0]));
  const redirected = [{ ...s.documents[0], storage_uri: `file://${outside}` }];
  const r = await verifyDocumentStore(redirected, { storageRoot: s.storageRoot });
  assertPartition(r, s.documents);
  assertPartition(r, redirected);
  assert.deepEqual(r.missing, [s.documents[0].id], "the in-store file is gone; the plant is irrelevant");
  await s.cleanup();
});

test("T19 workers drain a queue longer than the worker pool", async () => {
  // With <= 5 documents, workers === document count, so no worker ever took a second item
  // and the for(;;) loop was dead: replacing every `continue` with `return` kept all 16
  // cases green. 20 documents over 8 workers forces the drain.
  const s = await makeStore(Array.from({ length: 20 }, (_, i) => ({ bytes: Buffer.from(`DOC-${i}`) })));
  await rm(s.pathOf(s.documents[3]));
  await rm(s.pathOf(s.documents[17]));
  await writeFile(s.pathOf(s.documents[11]), Buffer.from("TAMPERED-XX"));

  const r = await verifyDocumentStore(s.documents, { storageRoot: s.storageRoot });
  assertPartition(r, s.documents);
  assertPartition(r, s.documents);
  assert.equal(r.checked, 20);
  assert.deepEqual([...r.missing].sort(), [s.documents[3].id, s.documents[17].id].sort());
  assert.deepEqual(r.mismatched, [s.documents[11].id]);

  // concurrency: 1 — one worker must enumerate all twenty on its own.
  const one = await verifyDocumentStore(s.documents, { storageRoot: s.storageRoot, concurrency: 1 });
  assertPartition(one, s.documents);
  assert.deepEqual([...one.missing].sort(), [...r.missing].sort(), "same verdict at concurrency 1");
  assert.deepEqual(one.mismatched, r.mismatched);
  await s.cleanup();
});

test("T20 one malformed row cannot destroy the verdict on every other row", async () => {
  // path.basename throws on a non-string. Unguarded, that rejection escaped Promise.all
  // and discarded every result already collected — a single tampered row erasing the
  // report on 2,400 intact exhibits.
  const s = await makeStore([{}, {}]);
  await rm(s.pathOf(s.documents[1]));
  const poisoned = [{ ...s.documents[0], filename: null }, s.documents[1]];
  const r = await verifyDocumentStore(poisoned, { storageRoot: s.storageRoot });
  assertPartition(r, s.documents);
  assertPartition(r, poisoned);
  assert.equal(r.checked, 2, "the run completed");
  assert.deepEqual(r.missing, [s.documents[1].id], "the OTHER row's verdict survived");
  assert.equal(r.unverifiable[0]?.reason, "unusable_filename");
  await s.cleanup();
});

test("T21 an absent storageRoot is not a mass deletion claim", async () => {
  // A restore that has not finished, an unmounted external volume, or a wrong root from
  // the caller. Every lstat returns ENOENT and the report reads "all 2,400 exhibits were
  // deleted". Applying this module's own principle: "the store itself is not there" is a
  // different statement to a court than "everything in it was destroyed", and the second
  // is the one that starts a spoliation argument.
  const s = await makeStore([{}, {}]);
  const gone = path.join(s.root, "no-such-store");
  const r = await verifyDocumentStore(s.documents, { storageRoot: gone });
  assertPartition(r, s.documents);
  assertPartition(r, s.documents);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, [], "an absent store must not read as deleted exhibits");
  assert.equal(r.unverifiable.length, 2);
  assert.ok(r.unverifiable.every((u) => u.reason === "store_unavailable"), JSON.stringify(r.unverifiable));
  await s.cleanup();
});

test("T22 a storageRoot that is a FILE, not a directory, is also store_unavailable", async () => {
  const s = await makeStore([{}]);
  const notADir = path.join(s.root, "not-a-dir");
  await writeFile(notADir, Buffer.from("x"));
  const r = await verifyDocumentStore(s.documents, { storageRoot: notADir });
  assertPartition(r, s.documents);
  assertPartition(r, s.documents);
  assert.equal(r.unverifiable[0]?.reason, "store_unavailable");
  await s.cleanup();
});

test("T23 a per-document path that is a FILE, not a directory, is unverifiable", async () => {
  // realpath() succeeds on a regular file, so the later open returned ENOTDIR, which was
  // mapped to `absent` — reporting a present-but-wrong object as a deleted exhibit.
  const s = await makeStore([{}]);
  const id = "01jdoc00000000000000000077";
  await writeFile(path.join(s.storageRoot, id), Buffer.from("I AM A FILE, NOT A DIRECTORY"));
  const docs = [{ id, filename: "a.pdf", content_hash: sha256(Buffer.from("anything")) }];
  const r = await verifyDocumentStore(docs, { storageRoot: s.storageRoot });
  assertPartition(r, docs);
  assert.deepEqual(r.missing, [], "a wrong object in its place is not a deletion");
  assert.equal(r.unverifiable[0]?.reason, "not_a_regular_file");
  await s.cleanup();
});
