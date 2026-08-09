#!/usr/bin/env node
// runcontrol-canon.mjs — canonicalize + classify a Write/Edit/MultiEdit target path against the
// run-control protected set (PRC-2). Side-effect-free; never writes.
//
// Closes PRC-2 (lexical path-spelling bypass of protect-run-control.sh's suffix globs) and the
// PRC-1-deferred symlink residual, by resolving the candidate to its REAL canonical path
// (path.resolve for `.`/`//`/`..`/absolute, then best-effort realpathSync for symlinks) and
// matching by EXACT normalized directory + basename — not a substring/suffix glob (so
// `xdev-memo/run/config` is correctly a DIFFERENT file). Plan: dev-memo/plan-prc2-path-canon.md
// (rev-1, READY-WITH-LOW review-plan-mpzid6cq-3780u4).
//
// Invoked by protect-run-control.sh for EVERY parsed Write/Edit/MultiEdit file_path (when node is
// available). Exit codes (consumed by the wrapper):
//   0  = not a protected run-control file -> allow
//   10 = a blanket-protected run-control file -> deny
//   11 = the append-only audit trail dev-memo/run/log.md -> route to logmd-append-guard.mjs
//   2  = fail-closed (could not parse the payload / no file_path) -> wrapper falls back to its
//        bash-glob check (NOT a blanket allow)
//
// The protected basename set MUST mirror protect-run-control.sh's PROTECTED_RE / case list and
// block-run-control-bash-write.sh's AUTH list. log.md is handled separately (append-only).

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, lstatSync, readlinkSync } from "node:fs";
import path from "node:path";

// Keep in sync with protect-run-control.sh (PROTECTED_RE) + block-run-control-bash-write.sh (AUTH).
const PROTECTED = new Set([
  "queue.governed",
  "queue.linted",
  "queue.reviewed",
  "human.ack",
  "human.override",
  "override-reason.md",
  "remediation.authorized",
  "batch-start",
  "last-batch-audit",
  "risk.flag",
  "config",
  "forbidden-paths.txt",
  ".closeout-pending",
]);
const LOGMD = "log.md";

function repoRoot() {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

// Resolve `candidate` to its real path. Existing path -> realpath. A DANGLING symlink (target
// absent) -> resolve ITS link target and recurse, so an outside-named dangling symlink to an
// absent protected file (e.g. outside/x -> dev-memo/run/human.ack) is classified by the target it
// would CREATE, not by the symlink's own name (audit audit-mpzisjeu-n81up6 High). A plain
// not-yet-created file -> realpath the existing parent + basename. On any other error (loop /
// EACCES / depth cap) -> the LEXICAL candidate — best-effort, NOT a blanket allow (a lexically-exact
// protected path still matches).
function realCanonical(candidate, depth = 0) {
  if (depth > 40) return candidate; // symlink-loop / runaway guard
  try {
    return realpathSync(candidate);
  } catch (e) {
    if (e && e.code === "ENOENT") {
      try {
        const st = lstatSync(candidate);
        if (st.isSymbolicLink()) {
          const link = readlinkSync(candidate);
          const target = path.isAbsolute(link) ? link : path.resolve(path.dirname(candidate), link);
          return realCanonical(target, depth + 1); // classify what the symlink would create/reach
        }
      } catch {
        // lstat/readlink failed -> fall through to parent-resolve
      }
      try {
        return path.join(realpathSync(path.dirname(candidate)), path.basename(candidate));
      } catch {
        return candidate; // parent missing too -> lexical
      }
    }
    return candidate; // loop / EACCES / etc. -> lexical best-effort
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return process.exit(2);
  }
  const ti = input && input.tool_input;
  const fp = ti && (ti.file_path ?? ti.path);
  if (typeof fp !== "string" || fp.length === 0) return process.exit(2);

  const root = repoRoot();
  if (!root) return process.exit(2);

  const candidate = path.isAbsolute(fp) ? path.resolve(fp) : path.resolve(root, fp);
  const resolved = realCanonical(candidate);

  // realCanonical BOTH sides so a symlinked ancestor (e.g. macOS /tmp -> /private/tmp, or any
  // symlinked repo root) is resolved consistently — otherwise dirname(resolved) and runDir could
  // differ only by the symlink and a protected file would be missed (false allow).
  const runDir = realCanonical(path.resolve(root, "dev-memo/run"));
  if (path.dirname(resolved) !== runDir) return process.exit(0); // not under dev-memo/run -> allow

  const base = path.basename(resolved);
  if (base === LOGMD) return process.exit(11);
  if (PROTECTED.has(base)) return process.exit(10);
  return process.exit(0);
}

main();
