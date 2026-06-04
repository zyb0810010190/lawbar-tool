#!/usr/bin/env node
// logmd-append-guard.mjs — append-only verifier for dev-memo/run/log.md (PRC-1).
//
// Invoked by protect-run-control.sh for a PreToolUse Write|Edit|MultiEdit whose target path
// contains "log.md". Decides whether the operation preserves the append-only audit trail.
// Plan: dev-memo/plan-prc1-logmd-append-only.md (rev-1, READY review-plan-mpz4u8vw-cc8mvl).
//
// CONTENT-BASED invariant (does NOT trust tool names — Edit/MultiEdit are simulated):
//   the resulting log.md content must be EITHER a no-op (unchanged) OR keep the current
//   on-disk content as a strict PREFIX with new bytes only appended at the end
//   (result.startsWith(current)).
//   - Write: a full-file replace is never a safe append -> allowed ONLY to CREATE an absent
//     log.md; a Write to an existing log.md is denied (use Bash `>>` or an append-shaped Edit).
//   - Edit / MultiEdit: simulate the replacement(s), then apply the prefix invariant.
//
// Scope (PRC-1, user-approved): LEXICAL canonicalization (path.resolve) identifies log.md
// spellings (`./`, `//`, `../`, absolute). Symlink / non-"log.md"-named indirection is OUT OF
// SCOPE and remains deferred to PRC-2 (recorded in dev-memo/deferred-audit-findings.md). This
// verifier therefore uses path.resolve, NOT fs.realpath.
//
// Side-effect-free: it never writes. Exit codes (consumed by protect-run-control.sh):
//   0 = allow  (append-only / no-op / create-absent)
//   1 = deny   (would truncate / rewrite / mid-insert / overwrite existing trail)
//   2 = deny   (fail-closed: parse error, malformed/unknown tool shape, non-ENOENT read error)
//   3 = not-our-file (candidate path does not resolve to <repo>/dev-memo/run/log.md) -> the hook
//       falls through to its normal handling.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

function exit(code) {
  process.exit(code);
}

function repoRoot() {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

// Faithful single replacement: first occurrence, or all if replaceAll. A valid old_string not
// present yields the content unchanged (no-op) — the real tool would error or not mutate.
function applyReplace(content, oldStr, newStr, replaceAll) {
  if (!content.includes(oldStr)) return content;
  if (replaceAll) return content.split(oldStr).join(newStr);
  const i = content.indexOf(oldStr);
  return content.slice(0, i) + newStr + content.slice(i + oldStr.length);
}

function isString(v) {
  return typeof v === "string";
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return exit(2); // unparseable PreToolUse payload -> fail-closed
  }
  const ti = input && input.tool_input;
  if (!ti || !isString(ti.file_path)) return exit(2);

  const root = repoRoot();
  if (!root) return exit(2);

  // Bounded LEXICAL canonicalization (PRC-1): identify dev-memo/run/log.md spellings.
  const target = path.resolve(root, "dev-memo/run/log.md");
  const candidate = path.isAbsolute(ti.file_path)
    ? path.resolve(ti.file_path)
    : path.resolve(root, ti.file_path);
  if (candidate !== target) return exit(3); // not our file -> hook falls through

  // Read current on-disk content. ENOENT => absent; any OTHER read error => fail-closed deny.
  let current = null; // null = absent
  try {
    current = readFileSync(candidate, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") current = null;
    else return exit(2);
  }
  const exists = current !== null;
  const curStr = current === null ? "" : current;

  // --- determine the operation by tool_input SHAPE (do not trust a tool name) ---
  // Write: { content }
  if (ti.content !== undefined) {
    if (!isString(ti.content)) return exit(2); // malformed Write
    // A full-file Write may only CREATE an absent log.md; never overwrite an existing trail.
    return exit(exists ? 1 : 0);
  }

  // MultiEdit: { edits: [ { old_string, new_string, replace_all? }, ... ] }
  if (ti.edits !== undefined) {
    if (!Array.isArray(ti.edits) || ti.edits.length === 0) return exit(2);
    let result = curStr;
    for (const ed of ti.edits) {
      if (!ed || !isString(ed.old_string) || ed.old_string.length === 0) return exit(2);
      if (!isString(ed.new_string)) return exit(2);
      if (ed.replace_all !== undefined && typeof ed.replace_all !== "boolean") return exit(2);
      result = applyReplace(result, ed.old_string, ed.new_string, ed.replace_all === true);
    }
    return exit(result.startsWith(curStr) ? 0 : 1);
  }

  // Edit: { old_string, new_string, replace_all? }
  if (ti.old_string !== undefined) {
    if (!isString(ti.old_string) || ti.old_string.length === 0) return exit(2);
    if (!isString(ti.new_string)) return exit(2);
    if (ti.replace_all !== undefined && typeof ti.replace_all !== "boolean") return exit(2);
    const result = applyReplace(curStr, ti.old_string, ti.new_string, ti.replace_all === true);
    return exit(result.startsWith(curStr) ? 0 : 1);
  }

  // Unknown / unsupported shape -> fail-closed.
  return exit(2);
}

main();
