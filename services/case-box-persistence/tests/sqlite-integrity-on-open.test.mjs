// WI-03 — integrity checking on open.
//
// Until this existed, a corrupt case-box database opened silently and the app began
// writing audit events into it. For a court-facing tool the first requirement is not
// recovery, it is REFUSAL: a store that cannot be trusted must not be appended to.
//
// The load-bearing subtlety is the `.verified` marker. A byte-copy of a corrupt database
// is also corrupt, so the copy must be integrity-checked BEFORE the marker is written.
// A `.verified` marker sitting beside an unusable copy is worse than no marker — it is a
// claim that recovery is possible when it is not.
//
// Two distinct failures share one entry point and must not be conflated:
//   * genuine corruption  -> copy taken, integrity-check FAILS, NO marker, refuse to open
//   * spurious failure    -> copy taken, integrity-check PASSES, marker written, refuse
// The second is Zotero's stale-journal case: the check fires, the bytes are actually fine.

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, writeFileSync, openSync, writeSync, closeSync, statSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

import { openSqliteCaseBoxPersistence } from "../dist/index.js";
import { makeMatterInput } from "./conformance/fixtures.mjs";

/** A real database, then 2 KiB of 0xff written over a page in the middle of it. */
function makeCorruptDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cbx-corrupt-"));
  const p = path.join(dir, "case.db");
  const db = new Database(p);
  db.pragma("journal_mode = DELETE");
  db.exec("CREATE TABLE probe(a INTEGER PRIMARY KEY, b TEXT)");
  const ins = db.prepare("INSERT INTO probe(b) VALUES (?)");
  for (let i = 0; i < 400; i++) ins.run(`row-${i}-${"x".repeat(50)}`);
  db.close();
  const size = statSync(p).size;
  const fd = openSync(p, "r+");
  writeSync(fd, Buffer.alloc(2048, 0xff), 0, 2048, Math.floor(size / 2));
  closeSync(fd);
  return { dir, p };
}

test("WI03-1 a corrupt database REFUSES to open", () => {
  const { p } = makeCorruptDb();
  let err;
  try { openSqliteCaseBoxPersistence({ path: p }); } catch (e) { err = e; }
  assert.ok(err, "a corrupt database must not open");
  assert.equal(err.code, "database_corrupt");
  assert.match(String(err.message), /malformed|corrupt/i);
});

test("WI03-2 refusing to open writes NO audit event and no schema", () => {
  // The point of refusing is that nothing is appended to a store that cannot be trusted.
  const { p } = makeCorruptDb();
  try { openSqliteCaseBoxPersistence({ path: p }); } catch { /* expected */ }
  const db = new Database(p);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  db.close();
  assert.ok(!tables.includes("case_box_audit_events"), `schema was applied to a corrupt db: ${tables.join(",")}`);
});

/** Incident directories are unique per failure: <db>.repair-<stamp>/ */
function incidents(p) {
  const dir = path.dirname(p), base = path.basename(p);
  return readdirSync(dir).filter((f) => f.startsWith(`${base}.repair-`)).map((f) => path.join(dir, f));
}

test("WI03-3 a copy is preserved, and it carries NO .verified marker when it is also corrupt", () => {
  // A byte-copy of a corrupt database is corrupt. The marker must reflect the check, not
  // the act of copying.
  const { p } = makeCorruptDb();
  try { openSqliteCaseBoxPersistence({ path: p }); } catch { /* expected */ }
  const inc = incidents(p);
  assert.equal(inc.length, 1, "the original bytes must be preserved for forensics");
  const files = readdirSync(inc[0]);
  assert.ok(files.includes(path.basename(p)), `copy missing: ${files.join(",")}`);
  assert.equal(
    files.some((f) => f.endsWith(".verified")),
    false,
    "a .verified marker beside an unusable copy is a false claim that recovery is possible",
  );
});

test("WI03-6 a second failure does NOT overwrite the first incident's evidence", () => {
  // A fixed `.repair.tmp` silently destroyed the earlier copy, and — worse — could leave a
  // .verified marker from a previous SPURIOUS failure sitting beside a freshly-copied
  // CORRUPT database. That is the exact false claim this design exists to prevent,
  // reintroduced by reusing a filename.
  const { p } = makeCorruptDb();
  try { openSqliteCaseBoxPersistence({ path: p }); } catch { /* expected */ }
  try { openSqliteCaseBoxPersistence({ path: p }); } catch { /* expected */ }
  assert.equal(incidents(p).length, 2, "each incident keeps its own evidence");
});

test("WI03-7 the injectable check can ADD a failure but can never suppress one", () => {
  // The seam previously REPLACED the real check, so any production caller could pass
  // `() => null` and disable the gate entirely, with nothing logged or refused.
  const { p } = makeCorruptDb();
  let err;
  try {
    openSqliteCaseBoxPersistence({ path: p, additionalIntegrityCheck: () => null });
  } catch (e) { err = e; }
  assert.ok(err, "a corrupt database must still be refused when the seam reports 'sound'");
  assert.equal(err.code, "database_corrupt");
});

test("WI03-8 a file that is not a database at all is refused as corrupt, not raw-thrown", () => {
  // SQLITE_NOTADB makes the pragma itself throw. Unhandled, that escaped as a driver
  // error, skipped preservation, and never produced the domain error callers expect.
  const dir = mkdtempSync(path.join(os.tmpdir(), "cbx-notadb-"));
  const p = path.join(dir, "case.db");
  writeFileSync(p, Buffer.from("this is plainly not a sqlite database"));
  let err;
  try { openSqliteCaseBoxPersistence({ path: p }); } catch (e) { err = e; }
  assert.ok(err);
  assert.equal(err.code, "database_corrupt", `got: ${err?.code} / ${err?.message}`);
  assert.equal(incidents(p).length, 1, "the suspect bytes are still preserved");
});

test("WI03-4 a SPURIOUS failure preserves a copy that IS verified", () => {
  // The stale-journal case: the check fires, the bytes are actually sound. Here the copy
  // passes its own integrity check, so the marker is written and names what was checked.
  const dir = mkdtempSync(path.join(os.tmpdir(), "cbx-spurious-"));
  const p = path.join(dir, "case.db");
  const seed = new Database(p);
  seed.exec("CREATE TABLE probe(a INTEGER PRIMARY KEY)");
  seed.close();

  let err;
  try {
    openSqliteCaseBoxPersistence({ path: p, additionalIntegrityCheck: () => "simulated stale-journal failure" });
  } catch (e) { err = e; }
  assert.ok(err, "an injected failure must still refuse");
  assert.equal(err.code, "database_corrupt");
  const inc = incidents(p);
  assert.equal(inc.length, 1);
  const marker = readdirSync(inc[0]).find((f) => f.endsWith(".verified"));
  assert.ok(marker, "a sound copy must be marked verified");
  assert.match(readFileSync(path.join(inc[0], marker), "utf8"), /integrity_check\s*=\s*ok/i);
});

test("WI03-5 a healthy database still opens unchanged AND is usable", async () => {
  // The regression guard on existing behaviour: adding a gate must not close the door on
  // the normal path. In-memory and file-backed both.
  //
  // The round-trip is the point. Asserting `ok(result.persistence)` alone specified the
  // healthy path as "does not throw and leaves no litter" — which a gate that refuses
  // everything and returns a stub would satisfy. Writing through the reopened handle and
  // reading the row back is what makes this case an anchor rather than a formality.
  const mem = openSqliteCaseBoxPersistence({});
  assert.ok(mem.persistence);
  mem.db.close();

  const dir = mkdtempSync(path.join(os.tmpdir(), "cbx-ok-"));
  const p = path.join(dir, "case.db");
  const a = openSqliteCaseBoxPersistence({ path: p });
  a.db.close();

  const b = openSqliteCaseBoxPersistence({ path: p });   // reopen an existing healthy file
  assert.ok(b.persistence);
  const input = makeMatterInput({ name: "WI03-5 round trip" });
  await b.persistence.createMatter(input);
  const read = await b.persistence.getMatter(input.id);
  assert.equal(read?.name, "WI03-5 round trip", "the reopened store must actually work");
  b.db.close();

  assert.equal(incidents(p).length, 0, "a healthy open must leave no repair artefacts");
});

test("WI03-9 a structurally valid but FOREIGN database is refused, not schema-stamped", () => {
  // quick_check only proves the file is valid SQLite. An unrelated database passed the
  // gate and applySchema then wrote case-box tables INTO it — not merely a trust gap but
  // data destruction in someone else's file. Deferring this was indefensible while the
  // very next statement mutates the file.
  const dir = mkdtempSync(path.join(os.tmpdir(), "cbx-foreign-"));
  const p = path.join(dir, "case.db");
  const other = new Database(p);
  other.exec("CREATE TABLE somebody_elses_data(id INTEGER PRIMARY KEY, note TEXT)");
  other.prepare("INSERT INTO somebody_elses_data(note) VALUES (?)").run("not ours");
  other.close();

  let err;
  try { openSqliteCaseBoxPersistence({ path: p }); } catch (e) { err = e; }
  assert.ok(err, "a foreign database must be refused");
  assert.equal(err.code, "database_not_case_box");

  const check = new Database(p, { readonly: true });
  const tables = check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  const rows = check.prepare("SELECT COUNT(*) c FROM somebody_elses_data").get().c;
  check.close();
  assert.ok(!tables.some((t) => t.startsWith("case_box_")), `case-box schema was stamped into a foreign db: ${tables.join(",")}`);
  assert.equal(rows, 1, "the foreign data must be untouched");
});

test("WI03-10 a first run — where NO file exists yet — initialises normally", () => {
  // Corrected. This case used to pre-create a zero-byte file and call that "the ordinary
  // first-run path, where the file exists but holds nothing". Measured: that is false. On a
  // real first run the file does NOT exist; the driver creates it, and it is 4096 bytes once
  // the schema lands. A pre-existing zero-byte file is a state only truncation produces, and
  // describing it as normal is what made D-6 look like an irreducible tension.
  const dir = mkdtempSync(path.join(os.tmpdir(), "cbx-first-"));
  const p = path.join(dir, "case.db");
  assert.equal(existsSync(p), false, "the premise: a first run has no file yet");
  const r = openSqliteCaseBoxPersistence({ path: p });
  assert.ok(r.persistence);
  assert.ok(statSync(p).size > 0, "and the driver creates a real database, not an empty file");
  r.db.close();
});

test("WI03-17 an existing ZERO-BYTE file is REFUSED — a truncated case file is not a new one", () => {
  // D-6. SQLite treats a zero-byte file as a valid EMPTY database, so a case file truncated
  // by a full disk, an interrupted copy or a sync client replacing it with a placeholder used
  // to open with no error at all: integrity_check returned "ok", applySchema stamped fresh
  // tables in, and the litigator got a working app showing no matters. Nothing refused,
  // nothing warned. For a court-facing tool that is the worst outcome available — not a
  // refusal but the silent substitution of an empty store for the record.
  //
  // The discriminator needs no new state on disk: a genuine first run has NO file (WI03-10
  // above), so "the file exists and is zero bytes" is a state a first install never produces.
  const dir = mkdtempSync(path.join(os.tmpdir(), "cbx-trunc-"));
  const p = path.join(dir, "case.db");

  // Build a real case box, then truncate it — exactly the disk event being defended against.
  openSqliteCaseBoxPersistence({ path: p }).db.close();
  assert.ok(statSync(p).size > 0, "fixture must start from a REAL database, or this is vacuous");
  writeFileSync(p, "");
  assert.equal(statSync(p).size, 0);

  let err;
  try { openSqliteCaseBoxPersistence({ path: p }); } catch (e) { err = e; }
  assert.ok(err, "a truncated case file must not open silently");
  assert.equal(err.code, "database_empty");
  assert.match(err.message, /empty/i);
  // BOTH remedies, not either. An alternation matched "delete" while the backup guidance was
  // gone, and restoring from a backup is the primary answer — deleting is for the user who
  // genuinely wants a blank case box. A mutation dropping the first one survived until this
  // assertion was split.
  assert.match(err.message, /backup/i, "must name restoring from a backup — the primary remedy");
  assert.match(err.message, /delete/i, "and deleting, for someone who does want a blank case box");

  // Fail CLOSED, and prove it: nothing may have been written into the suspect file.
  assert.equal(statSync(p).size, 0, "refusing must not initialise the file it just refused");
});

// ---------------------------------------------------------------------------
// WI-03b. Five properties the original eight cases left unpinned. Each was
// confirmed empirically against the pre-fix build before being written here:
// WI03-11 and WI03-12 reproduced real defects; 13/14/15 covered claims the code
// makes in prose and no assertion checked.
// ---------------------------------------------------------------------------

const sha256 = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const incidentsIn = (dir) => readdirSync(dir).filter((f) => f.includes(".repair-"));

/** A sound database with the same schema the lock holder writes into. */
function makeHealthyDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cbx-healthy-"));
  const p = path.join(dir, "case.db");
  const db = new Database(p);
  db.exec("CREATE TABLE probe(a INTEGER PRIMARY KEY, b TEXT)");
  db.close();
  return { dir, p };
}

test("WI03-11 a HEALTHY database that is merely LOCKED is not called corrupt", async () => {
  // The defect this pins: the catch treated every throw from quick_check as corruption.
  // SQLITE_BUSY landed there, so a case file held open by a second window was reported
  // to the litigator as having failed its integrity check, and an incident directory
  // full of "suspect" bytes was written beside their perfectly sound database.
  const { dir, p } = makeHealthyDb();
  const holder = fork(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "helpers", "lock-holder.mjs"),
    [p],
  );
  await new Promise((r) => holder.once("message", r));
  try {
    let err;
    try {
      const opened = openSqliteCaseBoxPersistence({ path: p, busyTimeoutMs: 50 });
      opened.db.close();
    } catch (e) { err = e; }

    assert.ok(err, "a lock held past busy_timeout should still refuse the open");
    assert.notEqual(err.code, "database_corrupt", "a locked healthy database is NOT corrupt");
    assert.equal(err.code, "database_locked");
    assert.match(err.message, /lock|busy/i);
    // The forensic apparatus must not fire for a file that was never suspect.
    assert.equal(incidentsIn(dir).length, 0, "no incident directory for a healthy locked file");
  } finally {
    holder.send("release");
    await new Promise((r) => holder.once("exit", r));
  }
});

test("WI03-12 an unopenable path fails as a domain error, not a raw driver throw", () => {
  // Construction sat outside every try, so a missing parent directory escaped as a
  // TypeError with no `code` at all — callers told to switch on err.code got undefined.
  let err;
  try { openSqliteCaseBoxPersistence({ path: "/nonexistent-dir-wi03/nested/case.db" }); }
  catch (e) { err = e; }
  assert.ok(err);
  assert.equal(err.constructor.name, "CaseBoxPersistenceError");
  assert.equal(err.code, "database_unavailable");
  assert.notEqual(err.code, "database_corrupt", "unreachable is not the same as corrupt");
});

test("WI03-13 a REFUSED open leaves the original bytes byte-identical", () => {
  // The central design claim — check before anything writes. Nothing tested it, and two
  // separate paths could violate it: moving the gate after `journal_mode = WAL`, and the
  // close-time checkpoint. One hash comparison pins both.
  const { p } = makeCorruptDb();
  const before = sha256(p);
  assert.throws(() => openSqliteCaseBoxPersistence({ path: p }));
  assert.equal(sha256(p), before, "the suspect original must survive the refusal unmutated");
});

test("WI03-14 the preserved copy contains exactly the suspect bytes", () => {
  // WI03-3 asserted only that a file with the right NAME exists. Replacing copyFileSync
  // with a write of arbitrary content kept it green — leaving the single load-bearing
  // forensic claim of the whole feature unpinned.
  const { dir, p } = makeCorruptDb();
  const suspect = sha256(p);
  assert.throws(() => openSqliteCaseBoxPersistence({ path: p }));
  const incident = incidentsIn(dir)[0];
  assert.ok(incident, "an incident directory must exist");
  const copy = path.join(dir, incident, path.basename(p));
  assert.ok(existsSync(copy), "the copy must exist");
  assert.equal(sha256(copy), suspect, "the copy must BE the suspect bytes, not merely share its name");
});

test("WI03-15 WAL sidecars carrying uncheckpointed data are preserved too", () => {
  // Every existing fixture pinned journal_mode = DELETE, so no -wal ever existed and the
  // sidecar loop had never executed under test. Production is ALWAYS WAL, where copying
  // the main file alone silently drops the most recent committed evidence.
  const dir = mkdtempSync(path.join(os.tmpdir(), "cbx-wal-"));
  const p = path.join(dir, "case.db");
  const db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE probe(a INTEGER PRIMARY KEY, b TEXT)");
  db.prepare("INSERT INTO probe(b) VALUES ('uncheckpointed')").run();
  // Deliberately NOT closed: leave the WAL hot, as a crash would.
  assert.ok(existsSync(p + "-wal"), "fixture must leave a hot WAL");
  const walHash = sha256(p + "-wal");

  assert.throws(() => openSqliteCaseBoxPersistence({
    path: p,
    additionalIntegrityCheck: () => "simulated stale-journal failure",
  }));
  const incident = incidentsIn(dir)[0];
  const copiedWal = path.join(dir, incident, path.basename(p) + "-wal");
  assert.ok(existsSync(copiedWal), "the -wal sidecar must be preserved alongside the main file");
  assert.equal(sha256(copiedWal), walHash, "the preserved WAL must be the original WAL");
  try { db.close(); } catch { /* fixture cleanup */ }
});

test("WI03-16 index CONTENT corruption is refused, not waved through", () => {
  // quick_check is not a cheaper integrity_check; it is a WEAKER one. It counts index
  // entries but does not verify that they still match the rows they point at. Measured
  // here: a database in this state returns TWO DIFFERENT ANSWERS to one query depending
  // on whether the planner uses the index — an indexed lookup yields a row that a table
  // scan proves is gone. For a tool whose lists are evidence, that is a silent wrong
  // answer with the audit chain fully intact.
  //
  // Cost of closing it, measured on this machine: +5 ms at 5 MB, +81 ms at 50 MB. That is
  // free against Electron's own start-up, which is why the gate does the full check.
  const dir = mkdtempSync(path.join(os.tmpdir(), "cbx-idx-"));
  const p = path.join(dir, "case.db");
  let db = new Database(p);
  db.pragma("journal_mode = DELETE");
  db.exec("CREATE TABLE t(a INTEGER PRIMARY KEY, b TEXT); CREATE INDEX i_b ON t(b);");
  db.exec("INSERT INTO t(b) VALUES ('alpha'),('beta'),('gamma')");
  const idx = db.prepare("SELECT rootpage, sql FROM sqlite_master WHERE name='i_b'").get();
  db.unsafeMode(true);
  db.exec("PRAGMA writable_schema=ON; DELETE FROM sqlite_master WHERE name='i_b'; PRAGMA writable_schema=OFF;");
  db.close();
  db = new Database(p);
  // UPDATE, not INSERT: the entry COUNT stays correct, so only the CONTENT goes stale —
  // the one class quick_check cannot see.
  db.exec("UPDATE t SET b='MUTATED' WHERE b='beta'");
  db.unsafeMode(true);
  db.exec(`PRAGMA writable_schema=ON;
    INSERT INTO sqlite_master(type,name,tbl_name,rootpage,sql)
    VALUES ('index','i_b','t',${idx.rootpage},'${idx.sql}');
    PRAGMA writable_schema=OFF;`);
  db.close();

  // Guard the fixture itself: if a future SQLite teaches quick_check to catch this, the
  // premise above is stale and this test must be revisited rather than silently pass.
  db = new Database(p);
  const quick = String(db.pragma("quick_check")[0].quick_check);
  db.close();
  assert.equal(quick, "ok", "fixture is only meaningful while quick_check still misses this");

  assert.throws(
    () => openSqliteCaseBoxPersistence({ path: p }),
    (e) => e.code === "database_corrupt" && /index/i.test(e.message),
    "a database whose index disagrees with its rows must be refused",
  );
});
