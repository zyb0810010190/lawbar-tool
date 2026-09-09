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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, existsSync, linkSync, readdirSync, chmodSync, symlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";

import { openRegisteredOriginal, _resetOpenCacheForTesting } from "../dist/src/caseBox/documentOpen.js";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const tmp = (l) => mkdtempSync(path.join(os.tmpdir(), `docopen-${l}-`));

/** A store holding one registered original, shaped exactly as `storeDocumentFile` writes it. */
function makeStore({ body = "the filed exhibit", filename = "exhibit.pdf", bytes: raw } = {}) {
  const storageRoot = tmp("store");
  const id = "01j0000000000000000000abcd".slice(0, 26);
  const bytes = raw ?? Buffer.from(body);
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
    assert.deepEqual(Object.keys(r), ["ok"],
      "success carries no path: reveal already received it, and a path must not cross the boundary");
    assert.notEqual(path.resolve(revealed[0]), path.resolve(store.file),
      "the canonical original must never be what an editor is pointed at");
    assert.equal(sha(readFileSync(revealed[0])), store.record.content_hash,
      "the copy must be byte-identical to the verified original");
    assert.equal(sha(readFileSync(store.file)), store.record.content_hash,
      "and the original must be exactly as it was");
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

test("the copy is READ-ONLY, so an incidental save cannot rewrite the evidence", async () => {
  const store = makeStore();
  const { deps: d, revealed } = deps(store);
  try {
    const r = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(r.ok, true);
    const mode = statSync(revealed[0]).mode & 0o777;
    assert.equal(mode & 0o222, 0, `the copy must not be writable by anyone; mode ${mode.toString(8)}`);
    assert.equal(mode & 0o400, 0o400, "the owner must still be able to read it");
    // umask can only REMOVE bits, so an explicit chmod is what makes 0400 reliable — the same
    // lesson as the release-harness stubs.
    assert.equal(mode & 0o077, 0, "no group or other access to privileged client material");
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

test("only one copy exists at a time — each open disposes of the last", async () => {
  const store = makeStore();
  const { deps: d, revealed } = deps(store);
  try {
    const first = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(first.ok, true);
    assert.equal(existsSync(revealed[0]), true);
    const second = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(second.ok, true);
    assert.equal(existsSync(revealed[0]), false,
      "every copy is privileged client material; they must not accumulate");
    assert.equal(existsSync(revealed[1]), true);
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

// MARK: - Findings from the cc-suite audit (2026-09-08), each with the test it lacked

test("AUDIT-1: a THROWING lookup returns a code, never an escaping exception", async () => {
  // The lookup and the verification used to sit outside the try. A throw escaped to the IPC
  // caller carrying an exception message — and an exception message here can carry a filesystem
  // path, and a path can carry a client's name. The file's own header promised codes, not
  // messages, and the code did not honour it on the unexpected route.
  const store = makeStore();
  const { deps: d } = deps(store, {
    lookup: () => { throw new Error("/Volumes/Client Name/case.sqlite is locked"); },
  });
  try {
    const r = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(r.ok, false, "a throwing lookup must not reject the promise");
    assert.equal(r.code, "open_failed");
    assert.equal(JSON.stringify(r).includes("Client Name"), false, "no path text crosses the boundary");
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

test("AUDIT-4: an all-clear verdict that examined NOTHING must not read as verified", async () => {
  // `documentVerify.ts` records having once returned three empty arrays as "a clean bill of health
  // on a tampered store" — a worker-count bug meant zero files were examined. Reading only the
  // failure lists inherits that failure mode exactly: silence is taken for health.
  //
  // This needs the verifier injected. Without that seam the guard was unreachable, and mutation
  // proved it: deleting the check left all 15 tests green.
  const store = makeStore();
  const { deps: d, revealed } = deps(store, {
    verify: async () => ({ ok: false, checked: 0, missing: [], mismatched: [], unverifiable: [] }),
  });
  try {
    const r = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(r.ok, false, "an unexamined record must never be treated as verified");
    assert.equal(r.code, "document_unverifiable");
    assert.equal(revealed.length, 0, "and nothing may be handed to the OS");
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

test("AUDIT-4b: a verdict that reports ok but examined the wrong count is refused", async () => {
  const store = makeStore();
  const { deps: d } = deps(store, {
    verify: async () => ({ ok: true, checked: 0, missing: [], mismatched: [], unverifiable: [] }),
  });
  try {
    const r = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(r.ok, false, "ok=true over zero examined records is not evidence about this one");
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

test("AUDIT-2: the descriptor is re-asserted, so a passing verdict is not taken on trust", async () => {
  // The verifier's guarantees are about a PATH at a moment. The bytes we copy come from a
  // descriptor opened afterwards. This proves the descriptor itself is re-checked: a verifier
  // that waves through a hardlinked file must still not produce an open.
  const store = makeStore();
  const elsewhere = tmp("elsewhere");
  const { deps: d, revealed } = deps(store, {
    verify: async () => ({ ok: true, checked: 1, missing: [], mismatched: [], unverifiable: [] }),
  });
  try {
    linkSync(store.file, path.join(elsewhere, "shadow.pdf")); // nlink becomes 2
    const r = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(r.ok, false, "another path can mutate these bytes; custody is not exclusive");
    assert.equal(r.code, "document_unverifiable");
    assert.equal(r.reason, "not_exclusively_held");
    assert.equal(revealed.length, 0);
  } finally {
    rmSync(store.storageRoot, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true }); _resetOpenCacheForTesting();
  }
});

test("AUDIT-6: a failed hand-off leaves NO copy behind", async () => {
  const store = makeStore();
  // The copy goes in a base private to THIS test, and the count is taken over that base alone.
  //
  // It used to count `lawbar-open-*` in the shared `os.tmpdir()`, which made the assertion a
  // measurement of the whole machine. `documentOpenHandlers` calls this engine, so
  // `document-open-handlers.test.mjs` creates directories with the same prefix, and process
  // isolation runs the two files at once. A neighbour's directory arriving inside the window
  // failed this test (observed twice); a neighbour's directory leaving inside it would have
  // masked a real leak. The decoy below pins the fix: it creates exactly the interference that
  // used to break this, in the real tmpdir, at the moment the window is open.
  const base = mkdtempSync(path.join(os.tmpdir(), "docopen-audit6-"));
  const count = () => readdirSync(base).filter((n) => n.startsWith("lawbar-open-")).length;
  const decoys = [];
  let during = null;
  const { deps: d } = deps(store, {
    tmpBase: base,
    // Runs with the finished copy on disk: the one moment the copy is observable from outside.
    reveal: async () => {
      during = count();
      decoys.push(mkdtempSync(path.join(os.tmpdir(), "lawbar-open-")));
      return "no application can open this";
    },
  });
  try {
    const r = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(r.ok, false);
    // Without this the test is vacuous: counting a directory the engine never writes to would
    // report zero before and zero after, and pass whatever the engine did with the copy.
    assert.equal(during, 1, "the copy must exist in THIS test's base during the hand-off, or the count below measures nothing");
    assert.equal(count(), 0,
      "a copy the owner never received is privileged client material nobody asked for");
    assert.equal(decoys.length, 1, "the interference this test is immune to must actually have happened");
  } finally {
    for (const dir of decoys) rmSync(dir, { recursive: true, force: true });
    rmSync(base, { recursive: true, force: true });
    rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting();
  }
});

test("AUDIT-6b: a failed open does not destroy the copy the owner already has", async () => {
  const store = makeStore();
  const { deps: d, revealed } = deps(store);
  try {
    const good = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(good.ok, true);
    // Now a run that fails at hand-off. The previous copy must survive: disposing first meant a
    // failure left the owner with neither the old copy nor a new one.
    const failing = { ...d, reveal: async () => "refused" };
    const bad = await openRegisteredOriginal("M-1", store.id, failing);
    assert.equal(bad.ok, false);
    assert.equal(existsSync(revealed[0]), true,
      "the working copy must not be collateral damage of a failed open");
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

test("AUDIT-8: a source that vanishes after verification is unverifiable, not open_failed", async () => {
  // `open_failed` means copy-or-handoff failed. A source that cannot be opened is a statement
  // about the evidence, and the two must not be collapsed.
  const store = makeStore();
  const { deps: d } = deps(store, {
    lookup: (m, id) => { const r = store.record; rmSync(store.file, { force: true }); return m === "M-1" ? r : null; },
  });
  try {
    const r = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(r.ok, false);
    assert.notEqual(r.code, "open_failed", "a missing source is not a copy failure");
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

// MARK: - WI-1: serialized opens, and no path in the result

test("WI-1: the LAST-REQUESTED open is the copy that survives, even if an earlier one finishes later", async () => {
  // What serialization actually protects, measured rather than assumed. The post-audit ordering
  // already guarantees no in-flight reveal's directory is disposed — a first draft of this test
  // asserted exactly that hazard and passed WITHOUT serialization, because the code can no
  // longer produce it. The remaining, real consequence of interleaving is ordering: if A is slow
  // and B is fast, unserialized A finishes LAST, treats B's copy as "superseded", and deletes the
  // document the owner most recently asked for out from under Preview. Serialized, A completes
  // before B begins, and B's copy — the last requested — is the one left standing.
  //
  // Slow-vs-fast is controlled by the injected verifier, not by timing luck.
  const store = makeStore();
  const revealed = [];
  const base = deps(store).deps;
  const real = base.verify ?? (await import("../dist/src/caseBox/documentVerify.js")).verifyDocumentStore;
  const slow = { ...base, reveal: async (f) => { revealed.push({ who: "A", f }); return ""; },
    verify: async (...a) => { await new Promise((r) => setTimeout(r, 40)); return real(...a); } };
  const fast = { ...base, reveal: async (f) => { revealed.push({ who: "B", f }); return ""; } };
  try {
    const [a, b] = await Promise.all([
      openRegisteredOriginal("M-1", store.id, slow),   // requested first, finishes last if unserialized
      openRegisteredOriginal("M-1", store.id, fast),   // requested second
    ]);
    assert.equal(a.ok, true); assert.equal(b.ok, true);
    const A = revealed.find((r) => r.who === "A").f, B = revealed.find((r) => r.who === "B").f;
    assert.equal(existsSync(B), true,
      "the copy the owner asked for LAST must survive; an earlier, slower open finishing later must not delete it");
    assert.equal(existsSync(A), false, "and the earlier copy is the one disposed of");
    assert.deepEqual(revealed.map((r) => r.who), ["A", "B"],
      "serialization means A is handed over before B even begins");
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

test("WI-1: a failed open does not poison the queue for the next one", async () => {
  const store = makeStore();
  const { deps: good } = deps(store);
  const bad = { ...good, lookup: () => { throw new Error("db locked"); } };
  try {
    const first = await openRegisteredOriginal("M-1", store.id, bad);
    assert.equal(first.ok, false);
    const second = await openRegisteredOriginal("M-1", store.id, good);
    assert.equal(second.ok, true, "one failure must not wedge every subsequent open");
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

// MARK: - WI-2: the copy streams; it does not hold the document in memory or starve the loop

/** A 64 MB original with a non-trivial byte pattern, so a truncated or reordered copy cannot match. */
function bigBytes(mb = 64) {
  const b = Buffer.alloc(mb << 20);
  // Knuth's multiplicative constant, written in hex on purpose: as a decimal literal its ten digits
  // matched the repo's `phone-us` privacy pattern and failed the gate. Same value, no digit run.
  for (let i = 0; i < b.length; i += 4096) b.writeUInt32LE((i * 0x9E3779B1) >>> 0, i);
  return b;
}

test("WI-2: a 64 MB original copies, verifies, and the copy is byte-identical", async () => {
  const store = makeStore({ bytes: bigBytes(64), filename: "scan.pdf" });
  const { deps: d, revealed } = deps(store);
  try {
    const r = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(r.ok, true, r.ok ? "" : r.code);
    assert.equal(statSync(revealed[0]).size, store.bytes.length, "every byte must arrive");
    assert.equal(sha(readFileSync(revealed[0])), store.record.content_hash, "and in the right order");
    assert.equal(statSync(revealed[0]).mode & 0o777, 0o400, "streamed copies are read-only too");
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

test("WI-2: the event loop stays responsive DURING THE COPY — ticks land inside that window", async () => {
  // The first draft counted ticks across the whole open and passed with the synchronous read
  // restored, because `runOpen` awaits the verifier — real async filesystem work — BEFORE the copy,
  // and the interval fired there. It measured the wrong window: a test that could not fail for
  // the reason it claimed.
  //
  // So the window is isolated. The injected verifier records the tick count as it RETURNS; reveal
  // records it on ARRIVAL. Between those two points everything is synchronous except the copy.
  // A synchronous read holds the loop for the whole copy, so the delta is 0 (measured earlier in
  // this repo on the backup probe). A streamed copy yields between chunks — 64 MB at a 64 KB
  // high-water mark is ~1000 yields — so the delta is well above 0. Deterministic either way.
  const store = makeStore({ bytes: bigBytes(64), filename: "scan.pdf" });
  const real = (await import("../dist/src/caseBox/documentVerify.js")).verifyDocumentStore;
  let ticks = 0, atVerifyEnd = -1, atReveal = -1;
  const timer = setInterval(() => { ticks += 1; }, 1);
  const { deps: d } = deps(store, {
    verify: async (...a) => { const v = await real(...a); atVerifyEnd = ticks; return v; },
    reveal: async () => { atReveal = ticks; return ""; },
  });
  try {
    const r = await openRegisteredOriginal("M-1", store.id, d);
    clearInterval(timer);
    assert.equal(r.ok, true, r.ok ? "" : r.code);
    assert.ok(atVerifyEnd >= 0 && atReveal >= 0, "both markers must have been recorded");
    assert.ok(atReveal - atVerifyEnd >= 1,
      `zero ticks between verify returning and reveal arriving (${atVerifyEnd} -> ${atReveal}): the copy held the loop — the read is synchronous`);
  } finally { clearInterval(timer); rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

test("WI-2: a streamed copy whose digest mismatches is refused, and nothing is handed over", async () => {
  // The digest is computed AS the bytes stream and checked BEFORE reveal — the mismatch path must
  // still exist after the rewrite, not have been lost in it.
  const store = makeStore({ bytes: bigBytes(8), filename: "scan.pdf" });
  const { deps: d, revealed } = deps(store, {
    lookup: (m, id) => (m === "M-1" && id === store.id ? { ...store.record, content_hash: sha("not these bytes") } : null),
    verify: async () => ({ ok: true, checked: 1, missing: [], mismatched: [], unverifiable: [] }),
  });
  try {
    const r = await openRegisteredOriginal("M-1", store.id, d);
    assert.deepEqual(r, { ok: false, code: "document_altered" });
    assert.equal(revealed.length, 0, "an unverified copy must never reach the OS");
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

// MARK: - WI-3: a read failure after open is about the EVIDENCE, not about this machine

test("WI-3: a READ-side failure after a successful open is unverifiable, not open_failed", async () => {
  // Cannot be induced on a real regular file, so the read stream is injected: it delivers some
  // bytes and then errors, which is what a failing disk or a yanked volume looks like from here.
  const store = makeStore({ body: "the filed exhibit, all of it" });
  const { deps: d, revealed } = deps(store, {
    openReadStream: () => new Readable({
      read() { this.push(Buffer.from("the filed")); this.destroy(new Error("EIO: input/output error, read")); },
    }),
  });
  try {
    const r = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(r.ok, false);
    assert.equal(r.code, "document_unverifiable", "the original could not be read — say that, not 'copy failed'");
    assert.equal(r.reason, "unreadable");
    assert.equal(revealed.length, 0, "nothing partial is ever handed to the OS");
    assert.equal(JSON.stringify(r).includes("EIO"), false, "no raw OS text crosses the boundary");
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});

/** A tiny WRITABLE volume, so a copy larger than it fails with ENOSPC mid-stream — a real write-side error. */
async function withTinyVolume(fn) {
  const dir = tmp("tiny-img");
  const img = path.join(dir, "tiny");
  const name = `LAWBARTINY${process.pid}${Math.floor(Math.random() * 1e6)}`;
  execFileSync("hdiutil", ["create", "-size", "2m", "-fs", "HFS+", "-volname", name, "-quiet", img]);
  const out = execFileSync("hdiutil", ["attach", `${img}.dmg`, "-nobrowse"], { encoding: "utf8" });
  const m = out.split("\n").map((l) => l.match(/(\/Volumes\/.+?)\s*$/)).find(Boolean);
  assert.ok(m, `hdiutil attach reported no mount point:\n${out}`);
  const volume = m[1];
  try {
    return await fn(volume);
  } finally {
    try { execFileSync("hdiutil", ["detach", volume, "-force", "-quiet"]); } catch { /* already gone */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

test("WI-3: a WRITE-side failure MID-STREAM (ENOSPC) is open_failed — a fact about this machine", async () => {
  // The first version pointed TMPDIR at an unwritable directory, so mkdtemp threw BEFORE the
  // pipeline and the outer catch returned open_failed — the pipeline's own write-side branch was
  // never reached. Mutation proved it: relabelling every pipeline failure as unverifiable left
  // that test green. This one makes the write stream itself fail, partway through a real copy.
  const store = makeStore({ bytes: bigBytes(16), filename: "scan.pdf" });
  const { deps: d, revealed } = deps(store);
  const saved = process.env.TMPDIR;
  try {
    await withTinyVolume(async (volume) => {
      process.env.TMPDIR = volume;
      const r = await openRegisteredOriginal("M-1", store.id, d);
      assert.equal(r.ok, false);
      assert.equal(r.code, "open_failed",
        "a full temp volume is this machine's problem, not a statement about the evidence");
      assert.equal(revealed.length, 0);
      const left = readdirSync(volume).filter((n) => n.startsWith("lawbar-open-"));
      assert.deepEqual(left, [], "the partial copy must not be left behind on the volume");
    });
  } finally {
    if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved;
    rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting();
  }
});

// MARK: - WI-4: containment is re-established on the descriptor's identity, not taken from the path

test("WI-4: a leaf swapped for a symlink to an IDENTICAL file elsewhere is refused as outside_store", async () => {
  // The sharp version of the hazard. The bytes are RIGHT — same content, same digest — so every
  // content check passes and, without a containment re-check, the open SUCCEEDS on a file that is
  // not under the store's custody. The verifier stub verifies honestly, then performs the swap,
  // which is exactly the window a path-based verifier cannot see.
  const store = makeStore({ body: "the filed exhibit" });
  const elsewhere = tmp("elsewhere");
  const shadow = path.join(elsewhere, "same-bytes.pdf");
  writeFileSync(shadow, store.bytes);
  const real = (await import("../dist/src/caseBox/documentVerify.js")).verifyDocumentStore;
  const { deps: d, revealed } = deps(store, {
    verify: async (recs, opts) => {
      const v = await real(recs, opts);
      rmSync(store.file);
      symlinkSync(shadow, store.file); // the store path now points outside the store
      return v;
    },
  });
  try {
    const r = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(r.ok, false, "right bytes, wrong custody: this must not open");
    assert.equal(r.code, "document_unverifiable");
    assert.equal(r.reason, "outside_store", "the path no longer resolves inside the store");
    assert.equal(revealed.length, 0);
  } finally {
    rmSync(store.storageRoot, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true }); _resetOpenCacheForTesting();
  }
});

test("WI-4: a symlink that resolves INSIDE the store is still fine — the check is about custody, not links", async () => {
  // Guard against over-refusal: a link whose target is a store-contained regular file with one
  // link is under custody. What is refused is escape, not indirection as such. (The verifier
  // itself refuses symlinked leaves on its own path; this exercises the descriptor-side check in
  // isolation by stubbing the verdict.)
  const store = makeStore({ body: "the filed exhibit" });
  const inner = path.join(store.storageRoot, store.id, "real.pdf");
  writeFileSync(inner, store.bytes);
  rmSync(store.file);
  symlinkSync(inner, store.file);
  const { deps: d, revealed } = deps(store, {
    verify: async () => ({ ok: true, checked: 1, missing: [], mismatched: [], unverifiable: [] }),
  });
  try {
    const r = await openRegisteredOriginal("M-1", store.id, d);
    assert.equal(r.ok, true, r.ok ? "" : `${r.code}/${r.reason}`);
    assert.equal(revealed.length, 1);
  } finally { rmSync(store.storageRoot, { recursive: true, force: true }); _resetOpenCacheForTesting(); }
});
