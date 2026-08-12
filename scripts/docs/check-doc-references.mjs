#!/usr/bin/env node
// check-doc-references.mjs — ratchet guard against dead path references in documentation.
//
// WHY THIS EXISTS
// This documentation corpus contains ZERO markdown links. Every cross-reference is a backticked
// path string, so no linter, renderer, or CI job can follow one. Dead references accumulated
// unnoticed across two cleanups: the 2026-08-10 configuration reset and the 2026-08-12
// product-doc consolidation. The count recorded when this guard was introduced was 213 (by the
// extraction rules below; a looser hand count reported ~318).
//
// WHY A RATCHET, NOT A GATE
// Failing on every existing dead reference would require a 200+ item cleanup before the check
// could go green, so it would simply be disabled. Instead it compares per-file dead counts
// against a committed baseline and fails when a file gets WORSE. Fixing references lowers the
// observed count; the baseline lowers only after a reviewed `--update`, which itself refuses to
// record an increase unless forced.
//
//   --check            (default) compare against baseline; exit 1 if any file got worse.
//   --update           rewrite the baseline. REFUSES to raise any file's count without --force.
//   --update --force   record an increase deliberately (prints every raised file).
//   --list             print every dead reference grouped by file.
//
// Node 20.11+ (uses fileURLToPath rather than import.meta.dirname for wider compatibility).

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
// Env override exists so tests can run against a temp baseline and never touch the real corpus.
const BASELINE = process.env.DOC_REFS_BASELINE || path.join(HERE, "doc-references-baseline.json");
// Env override for the scanned root, same reason. Defaults to this repo.
const SCAN_ROOTS = process.env.DOC_REFS_ROOTS ? process.env.DOC_REFS_ROOTS.split(",") : null;

// docs/contracts is an npm package, not documentation — never scanned.
const DOC_ROOTS = ["docs/adr", "docs/release", "docs/product", "docs/ui", "docs/reference"];
const REPO_ROOTS = ["apps/", "services/", "native/", "scripts/", "docs/", "dev-memo/", ".github/", ".claude/"];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;               // no symlink cycles
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/**
 * Does this path exist with EXACTLY this casing?
 * fs.existsSync is case-insensitive on default macOS filesystems, so a reference whose casing is
 * wrong passes locally and breaks on Linux CI. Walk the path components and match real dirents.
 */
function existsCaseExact(relPath) {
  const parts = relPath.replace(/\/+$/, "").split("/").filter(Boolean);
  let dir = REPO;
  for (let i = 0; i < parts.length; i++) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return false; }
    if (!entries.includes(parts[i])) return false;  // exact-case membership
    dir = path.join(dir, parts[i]);
  }
  return true;
}

/** Reject anything that escapes the repo (e.g. `docs/../../etc/hosts` passes a prefix check). */
function insideRepo(relPath) {
  const abs = path.resolve(REPO, relPath);
  return abs === REPO || abs.startsWith(REPO + path.sep);
}

/** Extract candidate repo-relative paths from inline code spans, ignoring fenced code blocks. */
export function extractRefs(text) {
  const refs = new Set();
  let fence = null;                                  // the marker that opened the current fence
  for (const raw of text.split("\n")) {
    // A fence may be indented at most 3 spaces; strip one blockquote marker first.
    const line = raw.replace(/^\s{0,3}>\s?/, "");
    const m = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (m) {
      if (fence === null) fence = m[1][0];           // opening: remember ` or ~
      else if (m[1][0] === fence) fence = null;      // closing: must match opener type
      continue;
    }
    if (fence !== null) continue;

    // Code spans may use runs of backticks; capture the inner text of each run-delimited span.
    for (const span of line.matchAll(/(`+)([^`]|[^`][\s\S]*?)\1(?!`)/g)) {
      for (let tok of String(span[2]).split(/\s+/)) {
        tok = tok.trim().replace(/^[('"[{]+/, "").replace(/[.,;:!?)\]}'"]+$/, "");
        tok = tok.replace(/:\d+(-\d+)?$/, "");       // file:line and file:line-line citations
        tok = tok.replace(/#.*$/, "");               // anchor fragments
        if (!tok.includes("/")) continue;
        if (!REPO_ROOTS.some((r) => tok.startsWith(r))) continue;
        // globs, brace expansion (`a.{key,crt}`), and template placeholders are patterns, not paths
        if (/[*<>${}]/.test(tok)) continue;
        refs.add(tok);
      }
    }
  }
  return [...refs];
}

function scan() {
  const dead = {};
  for (const root of (SCAN_ROOTS ?? DOC_ROOTS)) {
    for (const file of walk(path.join(REPO, root))) {
      const rel = path.relative(REPO, file);
      const missing = extractRefs(fs.readFileSync(file, "utf8"))
        .filter((r) => !insideRepo(r) || !existsCaseExact(r))
        .sort();
      if (missing.length) dead[rel] = missing;
    }
  }
  return dead;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE)) return null;
  let b;
  try { b = JSON.parse(fs.readFileSync(BASELINE, "utf8")); }
  catch (e) { console.error(`[check-doc-references] baseline is not valid JSON: ${e.message}`); process.exit(1); }
  if (!b || typeof b !== "object" || typeof b.counts !== "object" || b.counts === null) {
    console.error("[check-doc-references] baseline malformed: expected { total, counts:{file:number} }.");
    process.exit(1);
  }
  for (const [f, n] of Object.entries(b.counts)) {
    if (!Number.isInteger(n) || n < 0) {
      console.error(`[check-doc-references] baseline malformed: counts["${f}"] is not a non-negative integer.`);
      process.exit(1);
    }
  }
  return b;
}

// Only run the CLI when executed directly. Without this, `import { extractRefs }` runs the whole
// program — including process.exit() — which makes the module impossible to unit-test.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!isMain) { /* imported as a module: export only */ } else {
const argv = process.argv.slice(2);
const mode = argv.includes("--update") ? "update" : argv.includes("--list") ? "list" : "check";
const force = argv.includes("--force");
const dead = scan();
const counts = Object.fromEntries(Object.entries(dead).map(([f, a]) => [f, a.length]));
const total = Object.values(counts).reduce((n, x) => n + x, 0);

if (mode === "list") {
  for (const [file, refs] of Object.entries(dead).sort()) {
    console.log(`\n${file}  (${refs.length})`);
    for (const r of refs) console.log(`  - ${r}`);
  }
  console.log(`\n[check-doc-references] ${total} dead references across ${Object.keys(dead).length} files.`);
  process.exit(0);
}

if (mode === "update") {
  const base = readBaseline();
  if (base && !force) {
    const raised = Object.entries(counts).filter(([f, n]) => n > (base.counts[f] ?? 0));
    if (raised.length) {
      console.error("[check-doc-references] REFUSING to update — this would raise the ratchet:\n");
      for (const [f, n] of raised) console.error(`  ${f}: ${base.counts[f] ?? 0} -> ${n}`);
      console.error("\nFix the references, or pass --force to record the increase deliberately.");
      process.exit(1);
    }
  }
  fs.writeFileSync(BASELINE, JSON.stringify({ total, counts }, null, 2) + "\n");
  console.log(`[check-doc-references] baseline updated: ${total} dead references across ${Object.keys(counts).length} files.`);
  process.exit(0);
}

const base = readBaseline();
if (!base) {
  console.error("[check-doc-references] no baseline. Run with --update once to record the current state.");
  process.exit(1);
}

const worse = Object.entries(dead)
  .map(([file, refs]) => ({ file, was: base.counts[file] ?? 0, now: refs.length, refs }))
  .filter((w) => w.now > w.was);

// A baseline entry whose file no longer exists keeps an allowance a future file at that path
// could silently inherit. Report it so the baseline gets re-recorded.
const stale = Object.keys(base.counts).filter((f) => !fs.existsSync(path.join(REPO, f)));

if (worse.length) {
  console.error("[check-doc-references] FAIL — dead path references increased.\n");
  for (const w of worse) {
    console.error(`  ${w.file}: ${w.was} -> ${w.now}`);
    for (const r of w.refs) console.error(`      ${r}`);
  }
  console.error("\nEvery backticked path in docs/ must exist, with exact casing. Fix the reference,");
  console.error("or repoint it if the target moved. Run --list to see all current dead references.");
  process.exit(1);
}

console.log(`[check-doc-references] PASS — ${total} dead references (baseline ${base.total}).`);
if (base.total - total > 0) console.log(`  ${base.total - total} fewer than baseline. Run --update to lower the ratchet.`);
if (stale.length) {
  console.log(`  ${stale.length} baseline entr${stale.length === 1 ? "y" : "ies"} for deleted file(s); run --update to clear:`);
  for (const f of stale) console.log(`      ${f}`);
}
process.exit(0);
}
