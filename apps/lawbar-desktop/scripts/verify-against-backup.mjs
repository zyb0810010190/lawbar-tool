#!/usr/bin/env node
// verify-against-backup.mjs — compare a RETAINED backup's audit chain against the live case file
// and report removal or rewriting.
//
// WHY THIS EXISTS. `docs/reference/audit-chain-evidentiary-scope.md` states that a retained backup
// "can reveal truncation, and does so arithmetically". Decision D-1 (2026-08-23) reached the same
// conclusion, and chose it over an external anchor precisely because it needs "no network egress,
// no third party and no new key".
//
// That arithmetic was never implemented. The capability existed only in prose, in the document
// that defines this product's court-facing evidentiary scope — the exact shape of defect this
// repo keeps finding: a claim true at the headline and unexecuted in fact. This is the arithmetic.
//
// WHAT IT PROVES, AND WHAT IT DOES NOT. It proves that every audit event present in the backup is
// still present in the live file, at the same position, with the same hash. That detects the one
// attack the in-database invariants structurally cannot: CONSISTENT TRUNCATION, where the tail is
// deleted and the head anchor repaired so every internal check still passes (T-TRUNC-3).
//
// It is NOT proof on its own, and this tool must not be described as if it were. A backup written
// by this machine to this machine sits under the SAME write authority as the database: the same
// actor can delete it, overwrite it, or keep only the archives that agree with a truncated chain.
// It becomes a witness only when retained OUTSIDE that authority — disconnected external media,
// storage the app cannot write to, or a custody arrangement that is itself evidenced. That is an
// operational commitment, not a code guarantee, and no amount of code here can supply it.
//
// Scope of the comparison: the backup must be a PREFIX of the live chain. Equal length with equal
// hashes is intact; live longer with the backup as its prefix is normal growth. Anything else is
// reported.
//
// READ-ONLY ON BOTH FILES, deliberately, via `sqlite3 -readonly`. Opening a hot-WAL SQLite
// database read-write checkpoints it on close, which mutates the very evidence being examined —
// measured in this repo when reading a source database with the sqlite3 CLI destroyed the
// precondition a test had just established. The suite asserts the stronger, empirical property:
// both files are byte-identical after a run.
//
// It shells out to the `sqlite3` CLI rather than importing better-sqlite3, matching
// backup-restore-drill.test.mjs, which does the same and says why. The reason is hard: this
// package's `postinstall` runs `electron-builder install-app-deps`, which rebuilds better-sqlite3
// against ELECTRON's ABI (measured: MODULE_VERSION 140). Plain `node` here is 137 and cannot load
// it, so an operator script in this package that imported it would not run at all.
//
// Output carries matter ids (ULIDs), event ids (ULIDs), counts and hashes. It carries NO client
// content — no names, no document text, no reasons. That is what makes a finding safe to quote in
// a report or hand to an examiner.

import { spawnSync } from "node:child_process";
import { existsSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const DB_NAME = "case-box.sqlite";

export const EXIT_OK = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_USAGE = 2;

function usage() {
  return [
    "verify-against-backup.mjs --backup <path> [--live <path>] [--json]",
    "",
    "  --backup  a retained backup: the .sqlite file, or a directory containing one",
    "  --live    the case file to check (default: this machine's application data)",
    "  --json    machine-readable output",
    "",
    "Exit: 0 intact · 1 findings · 2 usage/IO error",
  ].join("\n");
}

export function parseArgs(argv) {
  const out = { backup: null, live: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--backup" || a === "--live") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      out[a.slice(2)] = v;
      i += 1;
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (out.backup === null) throw new Error("--backup is required");
  return out;
}

export function defaultLiveDb() {
  return path.join(os.homedir(), "Library", "Application Support", "lawbar", DB_NAME);
}

// A backup may be handed over as the .sqlite itself or as the archive directory around it.
export function resolveDbPath(p) {
  if (!existsSync(p)) throw new Error(`no such path: ${p}`);
  if (statSync(p).isDirectory()) {
    const direct = path.join(p, DB_NAME);
    if (existsSync(direct)) return direct;
    const found = readdirSync(p).filter((f) => f.endsWith(".sqlite"));
    if (found.length === 1) return path.join(p, found[0]);
    if (found.length === 0) throw new Error(`no .sqlite file in ${p}`);
    throw new Error(`ambiguous: ${found.length} .sqlite files in ${p}`);
  }
  return p;
}

// A `-wal` sidecar beside a copied database means committed data may live OUTSIDE the main file.
// Comparing without it would under-count the backup's chain and could report a REMOVAL that never
// happened — a false accusation, which is the worst failure mode this tool has.
export function walWarning(dbPath) {
  return existsSync(`${dbPath}-wal`) && statSync(`${dbPath}-wal`).size > 0
    ? `${path.basename(dbPath)}-wal is non-empty: this copy may be incomplete without it`
    : null;
}

export function sqliteAvailable() {
  return spawnSync("sqlite3", ["--version"], { encoding: "utf8" }).status === 0;
}

// `-json` prints nothing at all for an empty result set, which JSON.parse would reject. An empty
// audit table is a legitimate state, so that case returns [] rather than throwing.
export function queryJson(dbPath, sql) {
  const r = spawnSync("sqlite3", ["-readonly", "-json", dbPath, sql], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`sqlite3 failed on ${path.basename(dbPath)}: ${(r.stderr || "").trim()}`);
  }
  const out = (r.stdout || "").trim();
  return out === "" ? [] : JSON.parse(out);
}

// Single-quote escaping: matter ids are ULIDs from our own database, but building SQL by
// concatenation without escaping is a habit that stops being safe the moment the input changes.
function sqlStr(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

function chainOf(dbPath, matterId) {
  return queryJson(
    dbPath,
    `SELECT sequence, event_id, event_hash FROM case_box_audit_events
      WHERE matter_id = ${sqlStr(matterId)} ORDER BY sequence ASC;`,
  );
}

function mattersIn(dbPath) {
  return queryJson(
    dbPath,
    `SELECT DISTINCT matter_id FROM case_box_audit_events ORDER BY matter_id ASC;`,
  ).map((r) => r.matter_id);
}

/**
 * Compare one matter's chain. `backup` and `live` are ordered arrays of
 * { sequence, event_id, event_hash }.
 *
 * Returns null when intact. The order of checks matters: a DIVERGED result is reported even when
 * the live chain is also shorter, because a rewrite is a different and more serious claim than a
 * removal and must not be masked by one.
 */
export function compareChain(matterId, backup, live) {
  if (live === null) {
    return {
      matterId,
      finding: "MATTER_ABSENT",
      backupCount: backup.length,
      liveCount: 0,
      detail: "the matter exists in the backup and has no audit events in the live file",
    };
  }
  const shared = Math.min(backup.length, live.length);
  for (let i = 0; i < shared; i += 1) {
    const b = backup[i];
    const l = live[i];
    if (b.event_id !== l.event_id || b.event_hash !== l.event_hash || b.sequence !== l.sequence) {
      return {
        matterId,
        finding: "DIVERGED",
        backupCount: backup.length,
        liveCount: live.length,
        atIndex: i,
        atSequence: b.sequence,
        detail: `event ${i + 1} of the retained chain is not the event now in that position`,
      };
    }
  }
  if (live.length < backup.length) {
    return {
      matterId,
      finding: "REMOVED",
      backupCount: backup.length,
      liveCount: live.length,
      missing: backup.length - live.length,
      detail: `the retained chain is longer: ${backup.length - live.length} event(s) no longer present`,
    };
  }
  return null;
}

export function compareDatabases(backupPath, livePath) {
  const findings = [];
  const backupMatters = mattersIn(backupPath);
  const liveMatters = new Set(mattersIn(livePath));
  for (const m of backupMatters) {
    const f = compareChain(
      m,
      chainOf(backupPath, m),
      liveMatters.has(m) ? chainOf(livePath, m) : null,
    );
    if (f !== null) findings.push(f);
  }
  return { checkedMatters: backupMatters.length, findings };
}

function render(result, warnings) {
  const out = [];
  for (const w of warnings) out.push(`WARNING: ${w}`);
  out.push(`checked ${result.checkedMatters} matter(s) present in the retained backup`);
  if (result.findings.length === 0) {
    out.push("");
    out.push("INTACT — every retained audit event is still present, in position, with its hash.");
    out.push("");
    out.push("This does NOT by itself establish that the chain is complete. A backup written by");
    out.push("this machine to this machine is under the same write authority as the database. It");
    out.push("is a witness only if it was retained outside that authority.");
    return out.join("\n");
  }
  out.push("");
  out.push(`FINDINGS — ${result.findings.length} matter(s) differ from the retained backup:`);
  for (const f of result.findings) {
    out.push("");
    out.push(`  matter ${f.matterId}`);
    out.push(`    ${f.finding}: ${f.detail}`);
    out.push(`    retained ${f.backupCount} event(s), live ${f.liveCount}`);
    if (f.atSequence !== undefined) out.push(`    first difference at sequence ${f.atSequence}`);
  }
  out.push("");
  out.push("A REMOVED or MATTER_ABSENT finding is what consistent truncation looks like: the");
  out.push("in-database invariants cannot see it, because a truncated chain is a valid shorter");
  out.push("chain once the head anchor is repaired. Preserve both files before doing anything else.");
  return out.join("\n");
}

export function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${usage()}\n`);
    return EXIT_USAGE;
  }
  try {
    if (!sqliteAvailable()) {
      // Fail loudly rather than skip: a comparison that silently did not run would be read as
      // "nothing wrong", which is the opposite of what an absent tool means.
      throw new Error("the sqlite3 CLI is not available — the comparison cannot be performed");
    }
    const backupPath = resolveDbPath(args.backup);
    const livePath = resolveDbPath(args.live ?? defaultLiveDb());
    const warnings = [walWarning(backupPath), walWarning(livePath)].filter(Boolean);
    const result = compareDatabases(backupPath, livePath);
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ ...result, warnings }, null, 2)}\n`);
    } else {
      process.stdout.write(`${render(result, warnings)}\n`);
    }
    return result.findings.length === 0 ? EXIT_OK : EXIT_FINDINGS;
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return EXIT_USAGE;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
