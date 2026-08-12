#!/usr/bin/env node
// check-doc-references.mjs — ratchet guard against dead path references in documentation.
//
// WHY THIS EXISTS
// This documentation corpus contains ZERO markdown links. Every cross-reference is a backticked
// path string, so no linter, renderer, or CI job can follow one. As a result 318 dead references
// accumulated: 174 survived the 2026-08-10 configuration reset and 31 more survived the
// 2026-08-12 product-doc consolidation, both times with nothing to catch them.
//
// WHY A RATCHET, NOT A GATE
// Failing on all existing dead references would require a 318-item cleanup before the check could
// ever be green, so it would simply be disabled. Instead this compares against a committed
// baseline and fails ONLY when the count rises. Fixing references lowers the baseline; the guard
// never lets it climb back.
//
//   --check    (default) compare against the baseline; exit 1 if any file got worse.
//   --update   rewrite the baseline from the current state. Run deliberately, after fixing refs.
//   --list     print every dead reference grouped by file. No exit code meaning.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const BASELINE = path.join(REPO, "scripts", "docs", "doc-references-baseline.json");

// docs/contracts is an npm package, not documentation — never scanned.
const DOC_ROOTS = ["docs/adr", "docs/release", "docs/product", "docs/ui", "docs/reference"];

// A backticked token counts as a path reference when it starts with a real repo root and
// carries a slash. This deliberately ignores bare filenames, prose, and code identifiers.
const REPO_ROOTS = ["apps/", "services/", "native/", "scripts/", "docs/", "dev-memo/", ".github/", ".claude/"];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** Extract candidate repo-relative paths from backticked spans, ignoring fenced code blocks. */
function extractRefs(text) {
  const refs = new Set();
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      let tok = m[1].trim();
      // strip trailing prose punctuation, then take the first whitespace-delimited word
      tok = tok.replace(/[.,;:)]+$/, "").split(/\s+/)[0];
      // `path/to/file.ts:106` and `:106-118` are file:line citations — the path is the file.
      tok = tok.replace(/:\d+(-\d+)?$/, "");
      if (!tok.includes("/")) continue;
      if (!REPO_ROOTS.some((r) => tok.startsWith(r))) continue;
      if (tok.includes("*")) continue;              // globs are patterns, not references
      if (tok.includes("<") || tok.includes("$")) continue; // placeholders
      refs.add(tok);
    }
  }
  return [...refs];
}

function scan() {
  const dead = {};
  for (const root of DOC_ROOTS) {
    for (const file of walk(path.join(REPO, root))) {
      const rel = path.relative(REPO, file);
      const missing = extractRefs(fs.readFileSync(file, "utf8"))
        .filter((r) => !fs.existsSync(path.join(REPO, r)))
        .sort();
      if (missing.length) dead[rel] = missing;
    }
  }
  return dead;
}

const mode = process.argv.includes("--update") ? "update"
  : process.argv.includes("--list") ? "list" : "check";
const dead = scan();
const total = Object.values(dead).reduce((n, a) => n + a.length, 0);

if (mode === "list") {
  for (const [file, refs] of Object.entries(dead).sort()) {
    console.log(`\n${file}  (${refs.length})`);
    for (const r of refs) console.log(`  - ${r}`);
  }
  console.log(`\n[check-doc-references] ${total} dead references across ${Object.keys(dead).length} files.`);
  process.exit(0);
}

if (mode === "update") {
  const counts = Object.fromEntries(Object.entries(dead).map(([f, a]) => [f, a.length]));
  fs.writeFileSync(BASELINE, JSON.stringify({ total, counts }, null, 2) + "\n");
  console.log(`[check-doc-references] baseline updated: ${total} dead references across ${Object.keys(counts).length} files.`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error("[check-doc-references] no baseline. Run with --update once to record the current state.");
  process.exit(1);
}
const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const worse = [];
for (const [file, refs] of Object.entries(dead)) {
  const was = base.counts[file] ?? 0;
  if (refs.length > was) worse.push({ file, was, now: refs.length, refs });
}

if (worse.length) {
  console.error("[check-doc-references] FAIL — dead path references increased.\n");
  for (const w of worse) {
    console.error(`  ${w.file}: ${w.was} -> ${w.now}`);
    for (const r of w.refs) if (!fs.existsSync(path.join(REPO, r))) console.error(`      ${r}`);
  }
  console.error("\nEvery backticked path in docs/ must exist. Fix the reference, or if the target");
  console.error("moved, repoint it. Run with --list to see all current dead references.");
  process.exit(1);
}

const improved = base.total - total;
console.log(`[check-doc-references] PASS — ${total} dead references (baseline ${base.total}).`);
if (improved > 0) {
  console.log(`  ${improved} fewer than baseline. Run --update to lower the ratchet.`);
}
process.exit(0);
