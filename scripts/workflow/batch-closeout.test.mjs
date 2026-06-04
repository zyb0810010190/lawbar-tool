// batch-closeout.test.mjs — tests for the verified batch-audit closeout (plan rev-2, t1..t21).
// Run: node --test scripts/workflow/batch-closeout.test.mjs   (exit 0 = all pass)
//
// Covers: attestation/range/broker/L-disposition verification (t1-t10), the run-control hook
// tightening + sentinel protection (t11-t14), transactional marker/commit + reconcile (t15-t17,
// t21), and the additive batch-commit-guard.sh sentinel deny (t18-t20).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseAttestation,
  parseFindings,
  verifyAttestation,
  verifyBrokerRangeBound,
  sha256,
  deriveBase,
  runCloseout,
  reconcile,
} from "./batch-closeout.mjs";

const HERE = join(fileURLToPath(import.meta.url), "..");
const HOOKS = join(HERE, "../../.claude/hooks");

// --- helpers ---------------------------------------------------------------

function sh(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), "closeout-"));
  sh(repo, ["init", "-q"]);
  sh(repo, ["config", "user.email", "t@t"]);
  sh(repo, ["config", "user.name", "t"]);
  mkdirSync(join(repo, "dev-memo/run"), { recursive: true });
  mkdirSync(join(repo, "dev-memo/study"), { recursive: true });
  writeFileSync(join(repo, "README.md"), "x\n");
  // governed-by-default for the happy path; individual tests can remove it
  writeFileSync(join(repo, "dev-memo/run/queue.governed"), "ok\n");
  // a TRACKED non-empty deferred-findings file so the L-disposition tracked check can pass
  writeFileSync(join(repo, "dev-memo/deferred-audit-findings.md"), "# findings\n- none\n");
  sh(repo, ["add", "README.md", "dev-memo/run/queue.governed", "dev-memo/deferred-audit-findings.md"]);
  sh(repo, ["commit", "-q", "-m", "base"]);
  return repo;
}

function advance(repo, msg) {
  writeFileSync(join(repo, `f-${Math.abs(hashNum(msg))}.txt`), msg + "\n");
  sh(repo, ["add", "-A"]);
  sh(repo, ["commit", "-q", "-m", msg]);
  return sh(repo, ["rev-parse", "HEAD"]);
}
function hashNum(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

// Build a fake cc-suite state dir with one audit job whose rawOutput declares the range+verdict.
function makeStateDir(jobId, rawOutput, { error } = {}) {
  const sd = mkdtempSync(join(tmpdir(), "ccstate-"));
  mkdirSync(join(sd, "jobs"), { recursive: true });
  const body = error ? { error } : { rawOutput, threadId: null };
  writeFileSync(join(sd, "jobs", `${jobId}.json`), JSON.stringify(body));
  return sd;
}

function brokerRaw(base, head, verdict = "BATCH-PASS C0 H0 M0 L0") {
  return `Audit of the batch.\nAUDIT-RANGE: ${base}..${head}\nAUDIT-VERDICT: ${verdict}\nDone.\n`;
}

// Write a study-packet attestation file into the repo working tree (NOT committed; the closeout
// commits it). Returns its absolute path.
function writeAttestation(repo, fields) {
  const p = join(repo, "dev-memo/study/2026-06-03-batch.md");
  const block =
    `# study\n\n<!-- batch-audit-attestation v1\n` +
    `range_base: ${fields.range_base}\n` +
    `target_sha: ${fields.target_sha}\n` +
    `verdict: ${fields.verdict ?? "BATCH-PASS"}\n` +
    `findings: ${fields.findings ?? "C0 H0 M0 L0"}\n` +
    `broker_job_id: ${fields.broker_job_id}\n` +
    `broker_output_sha256: ${fields.broker_output_sha256}\n` +
    `-->\n`;
  writeFileSync(p, block);
  return p;
}

function marker(repo) {
  const p = join(repo, "dev-memo/run/last-batch-audit");
  return existsSync(p) ? readFileSync(p, "utf8").trim() : "";
}
function setMarker(repo, sha) {
  writeFileSync(join(repo, "dev-memo/run/last-batch-audit"), sha + "\n");
}
function sentinelExists(repo) {
  return existsSync(join(repo, "dev-memo/run/.closeout-pending"));
}

// A fully-valid happy-path fixture: returns {repo, attPath, sd, base, head}.
function validFixture() {
  const repo = makeRepo();
  const base = sh(repo, ["rev-parse", "HEAD"]);
  const head = advance(repo, "work-1");
  setMarker(repo, base); // marker at OLD => audit window BASE=base..HEAD=head
  const jobId = "audit-test123";
  const raw = brokerRaw(base, head);
  const sd = makeStateDir(jobId, raw);
  const attPath = writeAttestation(repo, {
    range_base: base,
    target_sha: head,
    broker_job_id: jobId,
    broker_output_sha256: sha256(raw),
  });
  return { repo, attPath, sd, base, head, jobId, raw };
}

function expectFail(fn, reMatch) {
  let threw = null;
  try {
    fn();
  } catch (e) {
    threw = e;
  }
  assert.ok(threw, "expected a CloseoutError");
  if (reMatch) assert.match(threw.message, reMatch);
}

// Hook drivers: hooks emit {"permissionDecision":"deny"} on stdout to deny; absence = allow.
function runBashHook(hook, command, env = {}) {
  const r = spawnSync("bash", [join(HOOKS, hook)], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return /"permissionDecision":"deny"/.test(r.stdout) ? "DENY" : "ALLOW";
}
function runWriteHook(hook, filePath) {
  const r = spawnSync("bash", [join(HOOKS, hook)], {
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    encoding: "utf8",
  });
  return /"permissionDecision":"deny"/.test(r.stdout) ? "DENY" : "ALLOW";
}

// =========================================================================
// Pure-function / verification tests
// =========================================================================

test("parseFindings + parseAttestation basics", () => {
  assert.deepEqual(parseFindings("C0 H0 M0 L2"), { C: 0, H: 0, M: 0, L: 2 });
  const att = parseAttestation(
    "<!-- batch-audit-attestation v1\nrange_base: " +
      "a".repeat(40) +
      "\ntarget_sha: " +
      "b".repeat(40) +
      "\nverdict: BATCH-PASS\nfindings: C0 H0 M0 L0\nbroker_job_id: audit-x\nbroker_output_sha256: deadbeef\n-->"
  );
  assert.equal(att.broker_job_id, "audit-x");
});

test("t7-block: duplicate attestation block throws", () => {
  const one =
    "<!-- batch-audit-attestation v1\nrange_base: a\ntarget_sha: b\nverdict: BATCH-PASS\nfindings: C0 H0 M0 L0\nbroker_job_id: audit-x\nbroker_output_sha256: d\n-->";
  expectFailThrows(() => parseAttestation(one + "\n" + one), /duplicate/);
});
function expectFailThrows(fn, re) {
  let e = null;
  try {
    fn();
  } catch (x) {
    e = x;
  }
  assert.ok(e, "expected throw");
  if (re) assert.match(e.message, re);
}

test("t1: wrong range_base fails, marker unchanged", () => {
  const { repo, attPath, sd, base, head } = validFixture();
  writeAttestation(repo, {
    range_base: "0".repeat(40),
    target_sha: head,
    broker_job_id: "audit-test123",
    broker_output_sha256: sha256(brokerRaw(base, head)),
  });
  expectFail(() => runCloseout({ repoRoot: repo, attestationPath: attPath, stateDir: sd }), /range_base/);
  assert.equal(marker(repo), base);
  assert.equal(sentinelExists(repo), false);
});

test("t2: target_sha != HEAD fails", () => {
  const { repo, attPath, sd, base } = validFixture();
  writeAttestation(repo, {
    range_base: base,
    target_sha: "0".repeat(40),
    broker_job_id: "audit-test123",
    broker_output_sha256: "x",
  });
  expectFail(() => runCloseout({ repoRoot: repo, attestationPath: attPath, stateDir: sd }), /target_sha/);
  assert.equal(marker(repo), base);
});

test("t3: open C/H/M findings fail", () => {
  const { repo, attPath, sd, base, head, jobId } = validFixture();
  writeAttestation(repo, {
    range_base: base,
    target_sha: head,
    findings: "C0 H1 M0 L0",
    broker_job_id: jobId,
    broker_output_sha256: sha256(brokerRaw(base, head)),
  });
  expectFail(() => runCloseout({ repoRoot: repo, attestationPath: attPath, stateDir: sd }), /open findings/);
  assert.equal(marker(repo), base);
});

test("t4: missing broker fields fail (attestation parse)", () => {
  const { repo, base, head } = validFixture();
  const p = join(repo, "dev-memo/study/2026-06-03-batch.md");
  writeFileSync(
    p,
    `<!-- batch-audit-attestation v1\nrange_base: ${base}\ntarget_sha: ${head}\nverdict: BATCH-PASS\nfindings: C0 H0 M0 L0\n-->\n`
  );
  expectFail(() => runCloseout({ repoRoot: repo, attestationPath: p, stateDir: undefined }), /missing field/);
});

test("t5: broker job missing / has error / wrong id prefix fail", () => {
  // missing job
  let f = validFixture();
  let bad = writeAttestation(f.repo, {
    range_base: f.base,
    target_sha: f.head,
    broker_job_id: "audit-absent",
    broker_output_sha256: sha256(f.raw),
  });
  expectFail(() => runCloseout({ repoRoot: f.repo, attestationPath: bad, stateDir: f.sd }), /unreadable|did not complete|sha256|AUDIT-RANGE/);
  // has error
  f = validFixture();
  const sdErr = makeStateDir("audit-err", "", { error: "spawnSync codex ETIMEDOUT" });
  bad = writeAttestation(f.repo, {
    range_base: f.base,
    target_sha: f.head,
    broker_job_id: "audit-err",
    broker_output_sha256: "x",
  });
  expectFail(() => runCloseout({ repoRoot: f.repo, attestationPath: bad, stateDir: sdErr }), /did not complete/);
  // wrong id prefix
  f = validFixture();
  bad = writeAttestation(f.repo, {
    range_base: f.base,
    target_sha: f.head,
    broker_job_id: "review-plan-x",
    broker_output_sha256: "x",
  });
  expectFail(() => runCloseout({ repoRoot: f.repo, attestationPath: bad, stateDir: f.sd }), /audit job/);
});

test("t6: broker rawOutput hash mismatch fails", () => {
  const { repo, attPath, sd, base, head, jobId } = validFixture();
  writeAttestation(repo, {
    range_base: base,
    target_sha: head,
    broker_job_id: jobId,
    broker_output_sha256: "0".repeat(64), // wrong hash
  });
  expectFail(() => runCloseout({ repoRoot: repo, attestationPath: attPath, stateDir: sd }), /sha256/);
});

test("t7: different-audit forgery — correct hash but rawOutput declares another range", () => {
  const repo = makeRepo();
  const base = sh(repo, ["rev-parse", "HEAD"]);
  const head = advance(repo, "w");
  setMarker(repo, base);
  // broker output is for an UNRELATED range, but we copy its real hash
  const otherRaw = brokerRaw("9".repeat(40), "8".repeat(40));
  const sd = makeStateDir("audit-other", otherRaw);
  const attPath = writeAttestation(repo, {
    range_base: base,
    target_sha: head,
    broker_job_id: "audit-other",
    broker_output_sha256: sha256(otherRaw), // hash matches the other job's output
  });
  expectFail(() => runCloseout({ repoRoot: repo, attestationPath: attPath, stateDir: sd }), /AUDIT-RANGE/);
  assert.equal(marker(repo), base);
});

test("t8: rawOutput verdict not PASS fails; external attestation path fails", () => {
  // verdict not pass
  const { repo, attPath, sd, base, head, jobId } = validFixture();
  const failRaw = brokerRaw(base, head, "BATCH-FAIL C0 H1 M0 L0");
  const sd2 = makeStateDir(jobId, failRaw);
  writeAttestation(repo, {
    range_base: base,
    target_sha: head,
    broker_job_id: jobId,
    broker_output_sha256: sha256(failRaw),
  });
  expectFail(() => runCloseout({ repoRoot: repo, attestationPath: attPath, stateDir: sd2 }), /AUDIT-VERDICT/);
  // external attestation path (outside the repo)
  const f = validFixture();
  const ext = join(tmpdir(), "outside-attestation.md");
  writeFileSync(ext, readFileSync(f.attPath, "utf8"));
  expectFail(() => runCloseout({ repoRoot: f.repo, attestationPath: ext, stateDir: f.sd }), /outside the repo/);
});

test("t9: deriveBase picks the NEWER of batch-start / last-batch-audit", () => {
  const repo = makeRepo();
  const c0 = sh(repo, ["rev-parse", "HEAD"]);
  const c1 = advance(repo, "a");
  const c2 = advance(repo, "b");
  writeFileSync(join(repo, "dev-memo/run/batch-start"), c0 + "\n");
  writeFileSync(join(repo, "dev-memo/run/last-batch-audit"), c1 + "\n");
  assert.equal(deriveBase(repo, join(repo, "dev-memo/run")), c1); // last-batch-audit is newer
  writeFileSync(join(repo, "dev-memo/run/last-batch-audit"), c0 + "\n");
  writeFileSync(join(repo, "dev-memo/run/batch-start"), c2 + "\n");
  assert.equal(deriveBase(repo, join(repo, "dev-memo/run")), c2); // batch-start is newer
});

test("t10: L>0 without disposition fails; with disposition allowed", () => {
  const { repo, sd, base, head, jobId } = validFixture();
  const raw = brokerRaw(base, head, "BATCH-PASS C0 H0 M0 L1");
  const sd2 = makeStateDir(jobId, raw);
  const attPath = writeAttestation(repo, {
    range_base: base,
    target_sha: head,
    findings: "C0 H0 M0 L1",
    broker_job_id: jobId,
    broker_output_sha256: sha256(raw),
  });
  // remove the disposition file -> fail
  rmSync(join(repo, "dev-memo/deferred-audit-findings.md"));
  expectFail(() => runCloseout({ repoRoot: repo, attestationPath: attPath, stateDir: sd2 }), /not dispositioned/);
  // restore disposition -> succeeds
  writeFileSync(join(repo, "dev-memo/deferred-audit-findings.md"), "# findings\n- L1 deferred\n");
  const r = runCloseout({ repoRoot: repo, attestationPath: attPath, stateDir: sd2 });
  assert.equal(r.advanced, true);
  assert.equal(marker(repo), head);
});

// =========================================================================
// Hook tests (t11-t14): interpreter-inline mutation tightening + sentinel protection
// =========================================================================

const M = "dev-memo/run/last-batch-audit";

test("t11: hook denies printf redirection into the marker (regression)", () => {
  assert.equal(runBashHook("block-run-control-bash-write.sh", `printf X > ${M}`), "DENY");
});

test("t12: hook denies node inline-eval mutation of the marker (new tightening)", () => {
  assert.equal(
    runBashHook("block-run-control-bash-write.sh", `node -e "require('fs').writeFileSync('${M}','x')"`),
    "DENY"
  );
  assert.equal(
    runBashHook("block-run-control-bash-write.sh", `python3 -c "open('${M}','w').write('x')"`),
    "DENY"
  );
});

test("t13: hook allows node inline-eval read-only ref to the marker", () => {
  assert.equal(
    runBashHook("block-run-control-bash-write.sh", `node -e "console.log(require('fs').readFileSync('${M}','utf8'))"`),
    "ALLOW"
  );
});

test("t14: hook allows node inline-eval not naming a protected path", () => {
  assert.equal(
    runBashHook("block-run-control-bash-write.sh", `node -e "require('fs').writeFileSync('/tmp/whatever','x')"`),
    "ALLOW"
  );
  // named-script invocation that writes the marker internally still allowed (the sanctioned channel)
  assert.equal(
    runBashHook("block-run-control-bash-write.sh", "node scripts/workflow/batch-closeout.mjs --attestation x"),
    "ALLOW"
  );
});

test("t14b: sentinel basename protected by both run-control hooks", () => {
  const S = "dev-memo/run/.closeout-pending";
  assert.equal(runBashHook("block-run-control-bash-write.sh", `printf X > ${S}`), "DENY");
  assert.equal(runBashHook("block-run-control-bash-write.sh", `rm ${S}`), "DENY");
  assert.equal(runWriteHook("protect-run-control.sh", `/x/${S}`), "DENY");
});

// =========================================================================
// Transactional / reconcile (t15-t17, t21) + guard sentinel (t18-t20)
// =========================================================================

test("t16: valid PASS advances marker to HEAD, removes sentinel, appends closeout-log", () => {
  const { repo, attPath, sd, base, head } = validFixture();
  const r = runCloseout({ repoRoot: repo, attestationPath: attPath, stateDir: sd });
  assert.equal(r.advanced, true);
  assert.equal(marker(repo), head); // marker == audited HEAD (target_sha)
  assert.equal(sentinelExists(repo), false);
  // closeout-log committed at the new HEAD, with the OLD..HEAD entry
  const log = sh(repo, ["show", "HEAD:dev-memo/batch-closeout-log.md"]);
  assert.match(log, new RegExp(`OLD=${base} HEAD=${head}`));
});

test("t15: commit failure restores marker to OLD and removes sentinel", () => {
  const { repo, attPath, sd, base } = validFixture();
  // Force the commit to fail: make git commits impossible by clearing user identity AND
  // setting an env that breaks commit. Simplest deterministic break: remove HEAD ref mid-flight
  // is hard; instead corrupt the committer by pointing GIT_* at an unwritable author. We instead
  // monkeypatch by making the staged path un-addable: delete the attestation right before commit.
  // Deterministic approach: set commit.gpgsign with a missing program via repo config.
  sh(repo, ["config", "commit.gpgsign", "true"]);
  sh(repo, ["config", "gpg.program", "/nonexistent/gpg"]);
  expectFail(() => runCloseout({ repoRoot: repo, attestationPath: attPath, stateDir: sd }), /commit failed|gpg|sign/i);
  assert.equal(marker(repo), base); // restored
  assert.equal(sentinelExists(repo), false); // failure path removes sentinel -> consistent DUE
});

test("t17/t21: reconcile distinguishes pre-commit crash from post-commit cleanup crash", () => {
  // Case A: crash BEFORE commit — sentinel present, marker==HEAD, no committed log entry.
  {
    const { repo, base, head } = validFixture();
    setMarker(repo, head); // marker already advanced (as if mid-flight)
    writeFileSync(
      join(repo, "dev-memo/run/.closeout-pending"),
      `OLD=${base}\nHEAD=${head}\ncreated=now\n`
    );
    const r = reconcile({ repoRoot: repo });
    assert.equal(r.action, "restored");
    assert.equal(marker(repo), base); // restored to OLD
    assert.equal(sentinelExists(repo), false);
  }
  // Case B: commit landed, cleanup crashed — committed log has the entry; sentinel removed only.
  {
    const { repo, attPath, sd, base, head } = validFixture();
    runCloseout({ repoRoot: repo, attestationPath: attPath, stateDir: sd }); // real success -> HEAD moved
    // simulate cleanup crash: re-create the sentinel after a successful commit
    writeFileSync(
      join(repo, "dev-memo/run/.closeout-pending"),
      `OLD=${base}\nHEAD=${head}\ncreated=now\n`
    );
    const r = reconcile({ repoRoot: repo });
    assert.equal(r.action, "cleanup-only");
    assert.equal(marker(repo), head); // marker NOT touched
    assert.equal(sentinelExists(repo), false);
  }
});

// Guard tests: drive the real batch-commit-guard.sh against a temp CLAUDE_PROJECT_DIR.
function guardDecision(projectDir, command) {
  const r = spawnSync("bash", [join(HOOKS, "batch-commit-guard.sh")], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
  return /"permissionDecision":"deny"/.test(r.stdout) ? "DENY" : "ALLOW";
}

function makeGuardRepo() {
  const repo = makeRepo();
  writeFileSync(join(repo, "dev-memo/run/config"), "AUTO_ADVANCE_MAX=3\nBATCH_AUDIT_EVERY=3\n");
  // governed already set by makeRepo; set batch-start = current HEAD (count 0)
  const head = sh(repo, ["rev-parse", "HEAD"]);
  writeFileSync(join(repo, "dev-memo/run/batch-start"), head + "\n");
  writeFileSync(join(repo, "dev-memo/run/last-batch-audit"), head + "\n");
  return { repo, head };
}

test("t19: guard with NO sentinel preserves existing audit-due behavior", () => {
  const { repo } = makeGuardRepo();
  // count 0 -> allow
  assert.equal(guardDecision(repo, "git commit -m x"), "ALLOW");
  // advance 3 commits past the marker -> DUE -> deny (existing behavior, no sentinel)
  advance(repo, "a");
  advance(repo, "b");
  advance(repo, "c");
  assert.equal(guardDecision(repo, "git commit -m x"), "DENY");
});

test("t18: guard denies a normal commit while sentinel exists even if marker is current", () => {
  const { repo, head } = makeGuardRepo();
  // marker == HEAD => count 0 => would normally ALLOW
  assert.equal(guardDecision(repo, "git commit -m x"), "ALLOW");
  writeFileSync(join(repo, "dev-memo/run/.closeout-pending"), "OLD=x\nHEAD=y\n");
  assert.equal(guardDecision(repo, "git commit -m x"), "DENY");
});

test("t20: removing the sentinel lets normal commits resume", () => {
  const { repo } = makeGuardRepo();
  writeFileSync(join(repo, "dev-memo/run/.closeout-pending"), "OLD=x\nHEAD=y\n");
  assert.equal(guardDecision(repo, "git commit -m x"), "DENY");
  rmSync(join(repo, "dev-memo/run/.closeout-pending"));
  assert.equal(guardDecision(repo, "git commit -m x"), "ALLOW");
});

// --- audit-remediation tests (H1, H2, M, L) -------------------------------

test("t22: a pre-staged unrelated file fails BEFORE any write (clean-index preflight, H1)", () => {
  const { repo, attPath, sd, base } = validFixture();
  writeFileSync(join(repo, "unrelated.txt"), "x\n");
  sh(repo, ["add", "unrelated.txt"]); // ride-along attempt
  expectFail(
    () => runCloseout({ repoRoot: repo, attestationPath: attPath, stateDir: sd }),
    /index is not clean/
  );
  assert.equal(marker(repo), base); // marker untouched
  assert.equal(sentinelExists(repo), false); // no sentinel written
});

test("t23: interpreter-inline mutation bypasses are denied (H2: open-w, write_text, perl '>')", () => {
  const cases = [
    `python3 -c "open('${M}','w').close()"`,
    `python3 -c "from pathlib import Path; Path('${M}').write_text('x')"`,
    `perl -e "open(F,'>${M}'); close F"`,
  ];
  for (const c of cases)
    assert.equal(runBashHook("block-run-control-bash-write.sh", c), "DENY", c);
});

test("t24: interpreter-inline READ-mode open of the marker is allowed (no over-deny, H2)", () => {
  assert.equal(
    runBashHook("block-run-control-bash-write.sh", `python3 -c "open('${M}','r').read()"`),
    "ALLOW"
  );
});

test("t25: duplicate attestation FIELD key is rejected (L)", () => {
  expectFailThrows(
    () =>
      parseAttestation(
        "<!-- batch-audit-attestation v1\nrange_base: a\ntarget_sha: b\ntarget_sha: c\n" +
          "verdict: BATCH-PASS\nfindings: C0 H0 M0 L0\nbroker_job_id: audit-x\nbroker_output_sha256: d\n-->"
      ),
    /duplicate attestation field/
  );
});

test("t26: broker PASS only in PROSE (not a full line) fails the line-anchored verdict check (M)", () => {
  const { repo, sd, base, head, jobId } = validFixture();
  const raw = `Note: do not declare AUDIT-VERDICT: BATCH-PASS C0 H0 M0 here.\nAUDIT-RANGE: ${base}..${head}\n`;
  const sd2 = makeStateDir(jobId, raw);
  const attPath = writeAttestation(repo, {
    range_base: base,
    target_sha: head,
    broker_job_id: jobId,
    broker_output_sha256: sha256(raw),
  });
  expectFail(() => runCloseout({ repoRoot: repo, attestationPath: attPath, stateDir: sd2 }), /AUDIT-VERDICT/);
});
