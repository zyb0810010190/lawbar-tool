#!/usr/bin/env node
// batch-closeout.mjs — verified, automatic Layer-B batch-audit closeout.
//
// Replaces the manual human step "after a batch-audit PASS, write HEAD into
// dev-memo/run/last-batch-audit" (which clears batch-commit-guard.sh's audit-DUE block).
// Plan: dev-memo/plan-batch-closeout-automation-00.md (rev-2, READY-WITH-LOW,
// cc-suite review-plan review-plan-mpyt1rnq-tm31ib).
//
// Security model (honest, per protect-run-control.sh's own disclosure):
//   cooperative-agent + direct-write-block + range-bound broker binding, NOT cryptographic.
// The marker is advanced ONLY after this script verifies, fail-closed:
//   1. a git-tracked attestation block in the batch-audit study packet, AND
//   2. the referenced cc-suite broker audit job's hashed rawOutput declares THIS exact
//      BASE..HEAD range and a BATCH-PASS verdict.
// A pending-sentinel (dev-memo/run/.closeout-pending) + an additive batch-commit-guard.sh
// deny make the marker advance transactional: a crash leaves the sentinel, which blocks all
// agent commits until a re-run reconciles. batch-commit-guard.sh's count/governed/risk logic
// is otherwise byte-identical.
//
// Usage:
//   node scripts/workflow/batch-closeout.mjs --attestation <path> [--state-dir <path>]
//   node scripts/workflow/batch-closeout.mjs --reconcile        [--state-dir <path>]
//
// This script is the ONLY sanctioned writer of dev-memo/run/last-batch-audit and
// dev-memo/run/.closeout-pending. It writes them via Node fs (the lexical run-control hooks
// permit a named script; they block direct agent redirections/verbs/Write-Edit).

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SHA_RE = /^[0-9a-f]{40}$/;
const MARKER_REL = "dev-memo/run/last-batch-audit";
const SENTINEL_REL = "dev-memo/run/.closeout-pending";
const CLOSEOUT_LOG_REL = "dev-memo/batch-closeout-log.md";

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable; no IO)
// ---------------------------------------------------------------------------

// Parse the single `batch-audit-attestation v1` HTML-comment block. Throws on
// missing / malformed / duplicate blocks (fail-closed at the call site).
export function parseAttestation(text) {
  const re = /<!--\s*batch-audit-attestation v1\s*([\s\S]*?)-->/g;
  const blocks = [];
  let m;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  if (blocks.length === 0) throw new Error("no batch-audit-attestation v1 block found");
  if (blocks.length > 1) throw new Error(`duplicate attestation blocks (${blocks.length})`);
  const fields = {};
  for (const line of blocks[0].split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const idx = t.indexOf(":");
    if (idx < 0) throw new Error(`malformed attestation line: ${t}`);
    const key = t.slice(0, idx).trim();
    if (key in fields) throw new Error(`duplicate attestation field: ${key}`); // ambiguous authority metadata
    fields[key] = t.slice(idx + 1).trim();
  }
  const required = [
    "range_base",
    "target_sha",
    "verdict",
    "findings",
    "broker_job_id",
    "broker_output_sha256",
  ];
  for (const k of required) {
    if (!(k in fields)) throw new Error(`attestation missing field: ${k}`);
  }
  const findings = parseFindings(fields.findings);
  return {
    range_base: fields.range_base,
    target_sha: fields.target_sha,
    verdict: fields.verdict,
    findings,
    broker_job_id: fields.broker_job_id,
    broker_output_sha256: fields.broker_output_sha256,
  };
}

// "C0 H1 M0 L2" -> {C:0,H:1,M:0,L:2}. Throws if any of C/H/M/L is absent or non-numeric.
export function parseFindings(s) {
  const out = {};
  for (const key of ["C", "H", "M", "L"]) {
    const mm = new RegExp(`(?:^|\\s)${key}(\\d+)(?:\\s|$)`).exec(s);
    if (!mm) throw new Error(`findings missing ${key}: ${s}`);
    out[key] = Number(mm[1]);
  }
  return out;
}

// Attestation-level checks (no broker, no IO). Returns {ok, reason}.
export function verifyAttestation(att, base, head) {
  if (!SHA_RE.test(att.range_base)) return fail(`range_base not a 40-hex SHA: ${att.range_base}`);
  if (!SHA_RE.test(att.target_sha)) return fail(`target_sha not a 40-hex SHA: ${att.target_sha}`);
  if (att.range_base !== base)
    return fail(`range_base ${att.range_base} != current BASE ${base}`);
  if (att.target_sha !== head) return fail(`target_sha ${att.target_sha} != current HEAD ${head}`);
  if (att.verdict !== "BATCH-PASS") return fail(`verdict is not BATCH-PASS: ${att.verdict}`);
  const f = att.findings;
  if (f.C > 0 || f.H > 0 || f.M > 0)
    return fail(`open findings C${f.C} H${f.H} M${f.M} (must be C0 H0 M0)`);
  return { ok: true };
}

// Range-bound broker check against the on-disk job JSON object. Returns {ok, reason}.
// jobJson is the parsed {rawOutput, threadId, ...} (the cc-suite job artifact stores ONLY
// rawOutput + threadId; a failed/timed-out job carries {error} instead of rawOutput).
export function verifyBrokerRangeBound(att, base, head, jobJson) {
  if (!att.broker_job_id || !/^audit-/.test(att.broker_job_id))
    return fail(`broker_job_id must look like an audit job (^audit-): ${att.broker_job_id}`);
  if (!jobJson || typeof jobJson !== "object") return fail("broker job JSON unreadable");
  if (jobJson.error) return fail(`broker job did not complete (error: ${jobJson.error})`);
  const raw = jobJson.rawOutput;
  if (typeof raw !== "string" || raw.length === 0) return fail("broker job has empty rawOutput");
  const got = sha256(raw);
  if (got !== att.broker_output_sha256)
    return fail(`broker rawOutput sha256 ${got} != attestation ${att.broker_output_sha256}`);
  // Bind to THIS range: the hashed output must declare the exact audited range + PASS verdict on
  // their OWN full lines (^...$, multiline) — so a prose mention like "do not declare
  // AUDIT-VERDICT: BATCH-PASS ..." cannot satisfy the check. base/head are 40-hex SHAs (no regex
  // metacharacters), safe to interpolate.
  const rangeLine = new RegExp(`^AUDIT-RANGE:[ \\t]*${base}\\.\\.${head}[ \\t]*$`, "m");
  if (!rangeLine.test(raw))
    return fail(`broker rawOutput does not declare AUDIT-RANGE: ${base}..${head} on its own line`);
  const verdictLine = /^AUDIT-VERDICT:[ \t]*BATCH-PASS[ \t]+C0[ \t]+H0[ \t]+M0(?:[ \t]+L\d+)?[ \t]*$/m;
  if (!verdictLine.test(raw))
    return fail("broker rawOutput does not declare AUDIT-VERDICT: BATCH-PASS C0 H0 M0 on its own line");
  return { ok: true };
}

export function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function fail(reason) {
  return { ok: false, reason };
}

// ---------------------------------------------------------------------------
// Git + path helpers (IO; operate relative to a repo root)
// ---------------------------------------------------------------------------

function git(repoRoot, args) {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).trim();
}

function gitOk(repoRoot, args) {
  try {
    execFileSync("git", ["-C", repoRoot, ...args], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function gitLines(repoRoot, args) {
  return git(repoRoot, args)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function readShaFile(p) {
  if (!existsSync(p)) return "";
  return (readFileSync(p, "utf8").match(/[0-9a-f]{40}/) || [""])[0];
}

// Mirror batch-commit-guard.sh: BASE = the NEWER of valid batch-start / last-batch-audit.
export function deriveBase(repoRoot, runDir) {
  const bs = validRef(repoRoot, readShaFile(join(runDir, "batch-start")));
  const lba = validRef(repoRoot, readShaFile(join(runDir, "last-batch-audit")));
  if (bs && lba) {
    if (bs === lba) return bs;
    if (gitOk(repoRoot, ["merge-base", "--is-ancestor", bs, lba])) return lba; // audit newer
    if (gitOk(repoRoot, ["merge-base", "--is-ancestor", lba, bs])) return bs; // batch-start newer
    // Divergent: prefer the older base (larger count) — audit sooner, like the guard.
    const cbs = Number(git(repoRoot, ["rev-list", "--count", `${bs}..HEAD`]));
    const clba = Number(git(repoRoot, ["rev-list", "--count", `${lba}..HEAD`]));
    return cbs >= clba ? bs : lba;
  }
  return bs || lba || "";
}

function validRef(repoRoot, sha) {
  if (!sha) return "";
  return gitOk(repoRoot, ["cat-file", "-e", `${sha}^{commit}`]) ? sha : "";
}

// Resolve the cc-suite state dir for this workspace (newest matching), or honor --state-dir.
export function resolveStateDir(repoRoot, explicit) {
  if (explicit) return explicit;
  const base = join(homedir(), ".claude/plugins/data/cc-suite-xiaolai/state");
  if (!existsSync(base)) return "";
  const slug = repoRoot.split("/").pop();
  const candidates = readdirSync(base)
    .filter((d) => d.startsWith(`${slug}-`))
    .map((d) => join(base, d))
    .filter((p) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] || "";
}

function loadJobJson(stateDir, jobId) {
  const p = join(stateDir, "jobs", `${jobId}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function committedLogHasEntry(repoRoot, head, oldSha, targetSha) {
  // Is there a COMMITTED closeout-log entry (at current HEAD) for OLD..target?
  // Present  => the batch-close commit landed (cleanup crashed).
  // Absent   => crash before the commit.
  try {
    const log = git(repoRoot, ["show", `${head}:${CLOSEOUT_LOG_REL}`]);
    return log.includes(`OLD=${oldSha} HEAD=${targetSha}`);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sentinel + closeout-log
// ---------------------------------------------------------------------------

function writeSentinel(runDir, data) {
  const body =
    `# batch-closeout in progress — created by scripts/workflow/batch-closeout.mjs\n` +
    `OLD=${data.OLD}\nHEAD=${data.HEAD}\n` +
    `broker_job_id=${data.broker_job_id}\nbroker_output_sha256=${data.broker_output_sha256}\n` +
    `created=${data.created}\n`;
  writeFileSync(join(runDir, ".closeout-pending"), body);
}

export function parseSentinel(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("=");
    if (idx > 0) out[t.slice(0, idx)] = t.slice(idx + 1);
  }
  return out;
}

function removeSentinel(runDir) {
  const p = join(runDir, ".closeout-pending");
  if (existsSync(p)) rmSync(p);
}

function appendCloseoutLog(repoRoot, data) {
  const p = join(repoRoot, CLOSEOUT_LOG_REL);
  const header = existsSync(p)
    ? ""
    : "# Batch-closeout log (tracked, append-only)\n\n" +
      "Deterministic-rollback source. Each line records one verified batch-audit closeout:\n" +
      "the marker advance (OLD..HEAD), the broker audit job, and its rawOutput hash.\n\n";
  const line = `- ${data.created} OLD=${data.OLD} HEAD=${data.HEAD} job=${data.broker_job_id} sha256=${data.broker_output_sha256} attestation=${data.attestation}\n`;
  writeFileSync(p, header + (existsSync(p) ? readFileSync(p, "utf8") : "") + line);
}

// ---------------------------------------------------------------------------
// Preflight (all other commit blockers — checked BEFORE any write)
// ---------------------------------------------------------------------------

export function preflight(repoRoot, runDir, stagePaths) {
  // The index MUST be clean before the closeout begins. The batch-close commit is a privileged
  // child-process commit that bypasses batch-commit-guard.sh and the Bash staged-file checks; if
  // any unrelated file is pre-staged it would ride along into the closeout commit. Refuse to run
  // until the operator has a clean index (audit finding H1).
  const cached = gitLines(repoRoot, ["diff", "--cached", "--name-only"]);
  if (cached.length)
    return fail(`index is not clean (pre-staged: ${cached.join(", ")}); the closeout commit must contain only its own files`);
  if (!existsSync(join(runDir, "queue.governed")))
    return fail("queue is not governed (dev-memo/run/queue.governed absent)");
  if (existsSync(join(runDir, "risk.flag")))
    return fail("a Layer-C risk trigger is pending (dev-memo/run/risk.flag)");
  const forbiddenFile = join(runDir, "forbidden-paths.txt");
  if (existsSync(forbiddenFile)) {
    const forbidden = readFileSync(forbiddenFile, "utf8")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const sp of stagePaths) {
      for (const fp of forbidden) {
        if (sp === fp || sp.startsWith(fp.replace(/\/$/, "") + "/"))
          return fail(`staged path ${sp} is forbidden (${fp})`);
      }
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

class CloseoutError extends Error {}

// Run the verified closeout. Returns {advanced:true, old, head} or throws CloseoutError.
export function runCloseout({ repoRoot, attestationPath, stateDir, now }) {
  const runDir = join(repoRoot, "dev-memo/run");
  const created = now || new Date().toISOString();

  // Reconcile first if a prior closeout was interrupted.
  if (existsSync(join(runDir, ".closeout-pending"))) {
    return reconcile({ repoRoot, stateDir, now: created });
  }

  const head = git(repoRoot, ["rev-parse", "HEAD"]);
  const base = deriveBase(repoRoot, runDir);
  if (!base) throw new CloseoutError("no valid batch-start/last-batch-audit BASE");

  // 1. Attestation present + INSIDE the repo (it is staged into the batch-close commit by THIS
  //    closeout, so it is not tracked beforehand; an external /tmp path is rejected) + single
  //    well-formed block.
  if (!existsSync(attestationPath)) throw new CloseoutError(`attestation not found: ${attestationPath}`);
  const relAtt = relativeTo(repoRoot, attestationPath);
  if (relAtt.startsWith("/") || relAtt.startsWith("..") || relAtt === attestationPath)
    throw new CloseoutError(`attestation is outside the repo: ${attestationPath}`);
  let att;
  try {
    att = parseAttestation(readFileSync(attestationPath, "utf8"));
  } catch (e) {
    throw new CloseoutError(`attestation parse: ${e.message}`);
  }

  // 2-4. Attestation-level checks.
  const a = verifyAttestation(att, base, head);
  if (!a.ok) throw new CloseoutError(a.reason);

  // 5. L-disposition: any L>0 requires the disposition to live in a git-TRACKED, non-empty
  //    findings file (a transient/untracked note is not acceptable evidence).
  if (att.findings.L > 0 && !lowFindingsDispositioned(repoRoot))
    throw new CloseoutError(`L${att.findings.L} finding(s) not dispositioned in a tracked findings file`);

  // 6. Range-bound broker check.
  const sd = stateDir || resolveStateDir(repoRoot);
  if (!sd) throw new CloseoutError("could not resolve cc-suite state dir");
  const b = verifyBrokerRangeBound(att, base, head, loadJobJson(sd, att.broker_job_id));
  if (!b.ok) throw new CloseoutError(b.reason);

  // 7. Preflight ALL other commit blockers BEFORE any write.
  const stagePaths = [relAtt, CLOSEOUT_LOG_REL];
  const pf = preflight(repoRoot, runDir, stagePaths);
  if (!pf.ok) throw new CloseoutError(pf.reason);

  // 8. Create the pending-sentinel (guard now blocks all agent commits).
  const data = {
    OLD: base,
    HEAD: head,
    broker_job_id: att.broker_job_id,
    broker_output_sha256: att.broker_output_sha256,
    attestation: relAtt,
    created,
  };
  writeSentinel(runDir, data);

  try {
    // 9. Stage, advance marker, commit (child process — not guard-gated), cleanup.
    appendCloseoutLog(repoRoot, data);
    git(repoRoot, ["add", "--", relAtt, CLOSEOUT_LOG_REL]);
    // Re-assert the index holds EXACTLY the intended files (defence in depth on top of the
    // clean-index preflight: nothing slipped in between preflight and here) — audit finding H1.
    const cached = gitLines(repoRoot, ["diff", "--cached", "--name-only"]).sort();
    const want = [relAtt, CLOSEOUT_LOG_REL].sort();
    if (cached.length !== want.length || cached.some((p, i) => p !== want[i]))
      throw new Error(`unexpected staged paths: ${cached.join(", ")} (want ${want.join(", ")})`);
    writeFileSync(join(repoRoot, MARKER_REL), head + "\n");
    const shortOld = base.slice(0, 7);
    const shortHead = head.slice(0, 7);
    // Commit with an explicit pathspec so only these paths land even if the index were not clean.
    git(repoRoot, [
      "commit",
      "-m",
      `chore(workflow): batch-audit closeout ${shortOld}..${shortHead}`,
      "--",
      relAtt,
      CLOSEOUT_LOG_REL,
    ]);
  } catch (e) {
    // Commit (or staging) failed: restore marker to OLD, remove sentinel -> consistent DUE state.
    writeFileSync(join(repoRoot, MARKER_REL), base + "\n");
    removeSentinel(runDir);
    throw new CloseoutError(`closeout commit failed, marker restored to OLD: ${e.message}`);
  }

  // 10. Success: remove the sentinel LAST -> normal commits resume.
  removeSentinel(runDir);
  return { advanced: true, old: base, head };
}

// Reconcile an interrupted closeout. Distinguishes "commit landed, cleanup crashed"
// (committed closeout-log has the HEAD entry -> remove sentinel only) from "crash before
// commit" (entry absent -> restore marker to OLD, remove sentinel).
export function reconcile({ repoRoot, now }) {
  const runDir = join(repoRoot, "dev-memo/run");
  const sentPath = join(runDir, ".closeout-pending");
  if (!existsSync(sentPath)) return { reconciled: false, reason: "no sentinel" };
  const sent = parseSentinel(readFileSync(sentPath, "utf8"));
  const head = git(repoRoot, ["rev-parse", "HEAD"]);
  const completed = committedLogHasEntry(repoRoot, head, sent.OLD, sent.HEAD);
  if (completed) {
    removeSentinel(runDir);
    return { reconciled: true, action: "cleanup-only", old: sent.OLD, head: sent.HEAD };
  }
  // Crash before commit: restore the marker to OLD, then clear the sentinel.
  if (sent.OLD) writeFileSync(join(repoRoot, MARKER_REL), sent.OLD + "\n");
  removeSentinel(runDir);
  return { reconciled: true, action: "restored", old: sent.OLD };
}

function lowFindingsDispositioned(repoRoot) {
  // Require a git-TRACKED, non-empty deferred-findings file. (Per-finding-id matching is out of
  // scope: the attestation carries only an aggregate L count, not ids — documented limitation.)
  const rel = "dev-memo/deferred-audit-findings.md";
  if (!gitOk(repoRoot, ["ls-files", "--error-unmatch", rel])) return false;
  const f = join(repoRoot, rel);
  return existsSync(f) && readFileSync(f, "utf8").trim().length > 0;
}

function relativeTo(repoRoot, p) {
  const abs = p.startsWith("/") ? p : join(process.cwd(), p);
  return abs.startsWith(repoRoot + "/") ? abs.slice(repoRoot.length + 1) : p;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const args = parseArgs(argv);
  const repoRoot = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  try {
    if (args.reconcile) {
      const r = reconcile({ repoRoot, stateDir: args.stateDir, now: new Date().toISOString() });
      process.stdout.write(`reconcile: ${JSON.stringify(r)}\n`);
      return 0;
    }
    if (!args.attestation) {
      process.stderr.write("error: --attestation <path> is required\n");
      return 2;
    }
    const r = runCloseout({
      repoRoot,
      attestationPath: args.attestation.startsWith("/")
        ? args.attestation
        : join(process.cwd(), args.attestation),
      stateDir: args.stateDir,
      now: new Date().toISOString(),
    });
    process.stdout.write(`closeout: ${JSON.stringify(r)}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`closeout FAILED: ${e.message}\n`);
    return 1;
  }
}

function parseArgs(argv) {
  const out = { reconcile: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--attestation") out.attestation = argv[++i];
    else if (argv[i] === "--state-dir") out.stateDir = argv[++i];
    else if (argv[i] === "--reconcile") out.reconcile = true;
  }
  return out;
}

// Run only when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
