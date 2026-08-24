// Behavioural tests for scripts/verify-against-backup.mjs — the retained-backup comparison that
// detects consistent truncation (T-TRUNC-3), the one attack the in-database invariants cannot see.
//
// Real SQLite files in real temp directories. Never the machine's application data: every fixture
// is built under os.tmpdir(). This file deliberately does not import defaultLiveDb() into any
// running path, because the whole point of the tool is that its default target is the litigator's
// case file, and a test must never resolve there. The Electron suite learned this the hard way.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  compareChain,
  compareDatabases,
  sqliteAvailable,
  parseArgs,
  resolveDbPath,
  walWarning,
  main,
  EXIT_OK,
  EXIT_FINDINGS,
  EXIT_USAGE,
} from "../scripts/verify-against-backup.mjs";

// Fail loudly rather than skip: a suite that silently did not run reads as "nothing wrong".
if (!sqliteAvailable()) {
  throw new Error("the sqlite3 CLI is unavailable — these tests cannot verify anything");
}

const M1 = "01jzmatter00000000000000a1";
const M2 = "01jzmatter00000000000000b2";

// event_id is the table's PRIMARY KEY, so rows are written as `<matterId>:<id>`. Without that the
// same chain() ids collide across two matters and the fixture silently fails to build.
// Fixtures are built with the sqlite3 CLI, not better-sqlite3: this package's postinstall rebuilds
// that native module against Electron's ABI, so plain `node --test` cannot load it. Same reason
// backup-restore-drill.test.mjs uses the CLI.
function makeDb(dir, name, events) {
  const p = path.join(dir, name);
  const rows = [];
  for (const [matterId, evs] of Object.entries(events)) {
    for (const r of evs) {
      rows.push(
        `INSERT INTO case_box_audit_events (event_id,tenant_id,matter_id,sequence,action,` +
        `entity_type,actor_user_id,timestamp,event_hash,event_json) VALUES (` +
        `'${matterId}:${r.event_id}','t','${matterId}',${r.sequence},'matter.created','matter','local',` +
        `'2026-08-23T00:00:00Z','${r.event_hash}','{}');`,
      );
    }
  }
  execFileSync("sqlite3", [p, `CREATE TABLE case_box_audit_events (
     event_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, matter_id TEXT NOT NULL,
     sequence INTEGER NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL,
     entity_id TEXT, actor_user_id TEXT NOT NULL, timestamp TEXT NOT NULL,
     before_state_hash TEXT, after_state_hash TEXT, prev_event_hash TEXT,
     event_hash TEXT NOT NULL, reason TEXT, event_json TEXT NOT NULL,
     UNIQUE (matter_id, sequence));
${rows.join("\n")}`], { stdio: "pipe" });
  return p;
}

// Rows are shaped as the DATABASE returns them. An earlier version of this helper used friendlier
// names ({seq,id,hash}); every unit assertion then passed vacuously against undefined fields.
const chain = (n, from = 1) =>
  Array.from({ length: n }, (_, i) => ({
    sequence: from + i,
    event_id: `ev-${from + i}`,
    event_hash: `sha256:${from + i}`,
  }));

function tmp() {
  return mkdtempSync(path.join(os.tmpdir(), "vab-"));
}

// ---------------------------------------------------------------- unit: compareChain

test("intact: identical chains report nothing", () => {
  assert.equal(compareChain(M1, chain(3), chain(3)), null);
});

test("normal growth: the backup being a prefix of a longer live chain is not a finding", () => {
  assert.equal(compareChain(M1, chain(3), chain(7)), null);
});

// The finding this tool exists for. Every in-database invariant still passes after a consistent
// truncation, because a truncated chain is a valid shorter chain once the head anchor is repaired.
test("REMOVED: a live chain shorter than the retained one is consistent truncation", () => {
  const f = compareChain(M1, chain(9), chain(4));
  assert.equal(f.finding, "REMOVED");
  assert.equal(f.backupCount, 9);
  assert.equal(f.liveCount, 4);
  assert.equal(f.missing, 5);
});

test("DIVERGED: an equal-length chain with a substituted event is a rewrite", () => {
  const live = chain(5);
  live[2] = { sequence: 3, event_id: "ev-3", event_hash: "sha256:TAMPERED" };
  const f = compareChain(M1, chain(5), live);
  assert.equal(f.finding, "DIVERGED");
  assert.equal(f.atIndex, 2);
  assert.equal(f.atSequence, 3);
});

// A rewrite is a different and graver claim than a removal, so it must not be masked when both
// are true. Ordering the checks the other way would report only REMOVED here.
test("DIVERGED outranks REMOVED when the chain was both rewritten and shortened", () => {
  const live = chain(3);
  live[1] = { sequence: 2, event_id: "ev-2", event_hash: "sha256:TAMPERED" };
  const f = compareChain(M1, chain(8), live);
  assert.equal(f.finding, "DIVERGED", "a rewrite must not be reported merely as a removal");
});

test("MATTER_ABSENT: a matter retained in the backup with no live events", () => {
  const f = compareChain(M1, chain(4), null);
  assert.equal(f.finding, "MATTER_ABSENT");
  assert.equal(f.backupCount, 4);
  assert.equal(f.liveCount, 0);
});

// A substituted event id with a colliding hash is still a substitution.
test("an event_id change alone is caught, even when the hash matches", () => {
  const live = chain(3);
  live[1] = { sequence: 2, event_id: "ev-SWAPPED", event_hash: "sha256:2" };
  assert.equal(compareChain(M1, chain(3), live).finding, "DIVERGED");
});

// ---------------------------------------------------------------- over real SQLite files

test("compareDatabases: intact across two matters", () => {
  const d = tmp();
  const b = makeDb(d, "b.sqlite", { [M1]: chain(3), [M2]: chain(2) });
  const l = makeDb(d, "l.sqlite", { [M1]: chain(3), [M2]: chain(2) });
  const r = compareDatabases(b, l);
  assert.equal(r.checkedMatters, 2);
  assert.deepEqual(r.findings, []);
  rmSync(d, { recursive: true, force: true });
});

test("compareDatabases: reports only the truncated matter, not its intact sibling", () => {
  const d = tmp();
  const b = makeDb(d, "b.sqlite", { [M1]: chain(6), [M2]: chain(2) });
  const l = makeDb(d, "l.sqlite", { [M1]: chain(2), [M2]: chain(2) });
  const r = compareDatabases(b, l);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].matterId, M1);
  assert.equal(r.findings[0].finding, "REMOVED");
  rmSync(d, { recursive: true, force: true });
});

// A matter created AFTER the backup is ordinary use, not evidence of anything.
test("compareDatabases: a matter absent from the backup is not a finding", () => {
  const d = tmp();
  const b = makeDb(d, "b.sqlite", { [M1]: chain(2) });
  const l = makeDb(d, "l.sqlite", { [M1]: chain(2), [M2]: chain(5) });
  const r = compareDatabases(b, l);
  assert.deepEqual(r.findings, []);
  assert.equal(r.checkedMatters, 1, "only matters the backup witnesses can be checked");
  rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------- end-to-end via main()

test("main: exit 0 and an INTACT report that states its own limits", () => {
  const d = tmp();
  makeDb(d, "b.sqlite", { [M1]: chain(3) });
  makeDb(d, "l.sqlite", { [M1]: chain(3) });
  const out = [];
  const w = process.stdout.write;
  process.stdout.write = (s) => { out.push(s); return true; };
  const code = main(["--backup", path.join(d, "b.sqlite"), "--live", path.join(d, "l.sqlite")]);
  process.stdout.write = w;
  assert.equal(code, EXIT_OK);
  const text = out.join("");
  assert.match(text, /INTACT/);
  assert.match(text, /same write authority/, "an intact result must not be reported as proof");
  rmSync(d, { recursive: true, force: true });
});

test("main: exit 1 on truncation, naming the matter and the shortfall", () => {
  const d = tmp();
  makeDb(d, "b.sqlite", { [M1]: chain(9) });
  makeDb(d, "l.sqlite", { [M1]: chain(4) });
  const out = [];
  const w = process.stdout.write;
  process.stdout.write = (s) => { out.push(s); return true; };
  const code = main(["--backup", path.join(d, "b.sqlite"), "--live", path.join(d, "l.sqlite")]);
  process.stdout.write = w;
  assert.equal(code, EXIT_FINDINGS, "a detected truncation must not exit 0");
  const text = out.join("");
  assert.match(text, /REMOVED/);
  assert.match(text, new RegExp(M1));
  assert.match(text, /5 event\(s\) no longer present/);
  rmSync(d, { recursive: true, force: true });
});

// Reading the evidence must not alter it. Opening a hot-WAL database read-write checkpoints it;
// this asserts the tool leaves both files byte-identical.
test("main: both files are left byte-for-byte unchanged", () => {
  const d = tmp();
  const b = makeDb(d, "b.sqlite", { [M1]: chain(4) });
  const l = makeDb(d, "l.sqlite", { [M1]: chain(4) });
  const before = [readFileSync(b), readFileSync(l)];
  const mtimes = [statSync(b).mtimeMs, statSync(l).mtimeMs];
  const w = process.stdout.write;
  process.stdout.write = () => true;
  main(["--backup", b, "--live", l]);
  process.stdout.write = w;
  assert.ok(before[0].equals(readFileSync(b)), "the retained backup was modified by reading it");
  assert.ok(before[1].equals(readFileSync(l)), "the live case file was modified by reading it");
  assert.deepEqual([statSync(b).mtimeMs, statSync(l).mtimeMs], mtimes);
  rmSync(d, { recursive: true, force: true });
});

// Findings may be quoted in a report or handed to an examiner, so the output must carry
// identifiers and arithmetic only.
test("main: --json output carries ids, counts and hashes but no client content", () => {
  const d = tmp();
  makeDb(d, "b.sqlite", { [M1]: chain(5) });
  makeDb(d, "l.sqlite", { [M1]: chain(1) });
  const out = [];
  const w = process.stdout.write;
  process.stdout.write = (s) => { out.push(s); return true; };
  main(["--backup", path.join(d, "b.sqlite"), "--live", path.join(d, "l.sqlite"), "--json"]);
  process.stdout.write = w;
  const parsed = JSON.parse(out.join(""));
  assert.equal(parsed.findings[0].finding, "REMOVED");
  assert.equal(parsed.findings[0].matterId, M1);
  for (const k of ["action", "reason", "event_json", "entity_id", "actor_user_id"]) {
    assert.equal(
      JSON.stringify(parsed).includes(k), false,
      `the report leaked the ${k} field — findings must carry identifiers and arithmetic only`,
    );
  }
  rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------- arguments and paths

test("parseArgs: --backup is required and unknown flags are refused", () => {
  assert.throws(() => parseArgs([]), /--backup is required/);
  assert.throws(() => parseArgs(["--backup"]), /needs a value/);
  assert.throws(() => parseArgs(["--backup", "x", "--wat"]), /unknown argument/);
  assert.deepEqual(parseArgs(["--backup", "b", "--live", "l", "--json"]),
    { backup: "b", live: "l", json: true });
});

test("main: a usage error exits 2, distinct from a findings exit", () => {
  const e = process.stderr.write;
  process.stderr.write = () => true;
  const code = main([]);
  process.stderr.write = e;
  assert.equal(code, EXIT_USAGE);
});

test("resolveDbPath: accepts a file, finds the db in a directory, refuses ambiguity", () => {
  const d = tmp();
  const f = makeDb(d, "case-box.sqlite", { [M1]: chain(1) });
  assert.equal(resolveDbPath(f), f);
  assert.equal(resolveDbPath(d), f, "a backup directory resolves to its case file");
  const amb = path.join(d, "amb");
  mkdirSync(amb);
  writeFileSync(path.join(amb, "a.sqlite"), "");
  writeFileSync(path.join(amb, "b.sqlite"), "");
  assert.throws(() => resolveDbPath(amb), /ambiguous/);
  assert.throws(() => resolveDbPath(path.join(d, "nope")), /no such path/);
  rmSync(d, { recursive: true, force: true });
});

// Comparing without a non-empty WAL sidecar could under-count the backup and report a REMOVAL
// that never happened. A false accusation is the worst failure this tool has, so it warns.
test("walWarning: fires only for a non-empty sidecar", () => {
  const d = tmp();
  const f = makeDb(d, "x.sqlite", { [M1]: chain(1) });
  assert.equal(walWarning(f), null);
  writeFileSync(`${f}-wal`, "");
  assert.equal(walWarning(f), null, "an empty WAL carries no data and must not warn");
  writeFileSync(`${f}-wal`, "not empty");
  assert.match(walWarning(f), /may be incomplete/);
  rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------- hot WAL: reading must not write
//
// The byte-identity test above uses a checkpointed fixture, where a read-write open mutates
// nothing — so it passed even with `-readonly` removed. A mutation sweep caught that: dropping
// `-readonly` SURVIVED. This is the case that kills it.
//
// A hot WAL is built by writing through a connection that is KILLED before it can close, since a
// clean exit checkpoints. Measured: a read-write open then collapses a 4152-byte WAL to 0, while
// `-readonly` leaves it untouched and still reads through it.
function makeHotWalDb(dir, name, events, extra) {
  const p = makeDb(dir, name, events);
  execFileSync("sqlite3", [p, "PRAGMA journal_mode=WAL;"], { stdio: "pipe" });
  execFileSync("sqlite3", [p, "PRAGMA wal_checkpoint(TRUNCATE);"], { stdio: "pipe" });
  const insert =
    `INSERT INTO case_box_audit_events (event_id,tenant_id,matter_id,sequence,action,` +
    `entity_type,actor_user_id,timestamp,event_hash,event_json) VALUES (` +
    `'${extra.matterId}:${extra.event_id}','t','${extra.matterId}',${extra.sequence},` +
    `'matter.created','matter','local','2026-08-23T00:00:00Z','${extra.event_hash}','{}');`;
  const script =
    `( printf '%s\\n' "PRAGMA wal_autocheckpoint=0;" ${JSON.stringify(insert)} "SELECT 1;"; sleep 6 ) ` +
    `| sqlite3 ${JSON.stringify(p)} >/dev/null 2>&1 & BG=$!; sleep 2; ` +
    `pkill -9 -f ${JSON.stringify("sqlite3 " + p)} >/dev/null 2>&1; kill -9 $BG >/dev/null 2>&1; wait 2>/dev/null`;
  spawnSync("bash", ["-c", script], { stdio: "pipe" });
  return p;
}

test("hot WAL: the comparison neither checkpoints the evidence nor misses WAL-resident events", () => {
  const d = tmp();
  const extra = (m) => ({ matterId: m, event_id: "ev-4", sequence: 4, event_hash: "sha256:4" });
  const b = makeHotWalDb(d, "b.sqlite", { [M1]: chain(3) }, extra(M1));
  const l = makeHotWalDb(d, "l.sqlite", { [M1]: chain(3) }, extra(M1));
  const walB = statSync(`${b}-wal`).size;
  const walL = statSync(`${l}-wal`).size;
  assert.ok(walB > 0 && walL > 0, "the fixture is not hot — this test would prove nothing");

  const w = process.stdout.write;
  process.stdout.write = () => true;
  const code = main(["--backup", b, "--live", l]);
  process.stdout.write = w;

  // Killed by removing `-readonly`: a read-write open checkpoints on close and truncates the WAL.
  assert.equal(statSync(`${b}-wal`).size, walB, "reading the retained backup checkpointed it");
  assert.equal(statSync(`${l}-wal`).size, walL, "reading the live case file checkpointed it");

  // And the 4th event lives ONLY in the WAL, so a reader that skipped it would see 3 vs 3 and
  // still report intact — passing for the wrong reason.
  const out = [];
  const w2 = process.stdout.write;
  process.stdout.write = (x) => { out.push(x); return true; };
  main(["--backup", b, "--live", l, "--json"]);
  process.stdout.write = w2;
  assert.equal(code, EXIT_OK);
  assert.deepEqual(JSON.parse(out.join("")).findings, []);
  rmSync(d, { recursive: true, force: true });
});

// The complement: WAL-resident events must be COUNTED, so a truncation that only removes them is
// still caught. Without WAL visibility both sides would read 3 and the removal would be invisible.
test("hot WAL: a truncation confined to WAL-resident events is still detected", () => {
  const d = tmp();
  const b = makeHotWalDb(d, "b.sqlite", { [M1]: chain(3) },
    { matterId: M1, event_id: "ev-4", sequence: 4, event_hash: "sha256:4" });
  const l = makeDb(d, "l.sqlite", { [M1]: chain(3) });   // the 4th event never arrives
  const w = process.stdout.write;
  process.stdout.write = () => true;
  const code = main(["--backup", b, "--live", l]);
  process.stdout.write = w;
  assert.equal(code, EXIT_FINDINGS, "the WAL-only event was not counted, so removal went unseen");
  rmSync(d, { recursive: true, force: true });
});

