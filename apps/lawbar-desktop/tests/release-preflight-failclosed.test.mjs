// release-preflight-failclosed.test.mjs — WI-5, the fail-closed cross-product.
// Isolated in its own file because the sweep executes 512 real bash processes.
//
// POSTURE: regression-first. T5.4/T5.5/T5.9 are [REGRESSION] cases — they must FAIL
// against the preserved pre-fix copy and PASS against the current script:
//
//   LAWBAR_SCRIPT_DIR=<prefix-scripts> node --test tests/release-preflight-failclosed.test.mjs
//
// The pre-fix gate passed 55 of 512 configurations. The post-fix gate passes 44.
// Eleven configurations moved pass -> fail and none moved fail -> pass, which is the
// shape a hardening fix must have: it may only tighten.
//
// COST NOTE: two stub dirs are built ONCE for the whole file (identity-present and
// no-identity) and reused across all 512 cells; only the env varies. That is what
// makes the sweep affordable — macOS charges ~340ms to first-execute a newly written
// file and ~6ms thereafter, so per-cell stub dirs would cost ~3 minutes instead of
// ~4 seconds. Runtime is reported by the test reporter and deliberately NOT asserted:
// a wall-clock assertion's failure mode is a slow machine, not a regression.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  PREFLIGHT, PKG_DIR, SENTINEL, IDENTITY_PRESENT, NO_IDENTITY,
  makeCase, runScript, runCommand,
} from "./_release-script-harness.mjs";

const BANNER_OK = "release preflight OK — proceeding with the signed + notarized build.";
const BANNER_FAIL = "release preflight FAILED — signing/notarization credentials are incomplete.";

const manifest = JSON.parse(readFileSync(path.join(PKG_DIR, "package.json"), "utf8"));

// ===========================================================================
// T5.1–T5.3 — the `dist:release` recipe is a gate, not a suggestion
// ===========================================================================

test("T5.1 dist:release is &&-chained: preflight first, build, then signing verification", () => {
  const raw = manifest.scripts["dist:release"];
  const stages = raw.split(" && ");
  // FOUR stages since D-5. The recipe used to end at electron-builder, so no ship path ever
  // ran the signing exit contract — the tool built a signed app and never checked its own
  // claim about it, the stapling half least of all.
  assert.equal(stages.length, 4, `unexpected stage count in: ${raw}`);
  assert.equal(stages[0], "bash scripts/release-preflight.sh");
  assert.match(stages[2], /^electron-builder\b/);
  // EXACT, not a substring match. `/verify:signing:release/` alone is satisfied by
  // `echo verify:signing:release` or `npm run not-verify:signing:release` — a shape test that
  // accepts a decoy is not a gate.
  assert.equal(stages[3], "npm run verify:signing:release",
    "the build must be followed by verification, or dist:release asserts nothing about signing");
  assert.equal(manifest.scripts["verify:signing:release"],
    "bash scripts/verify-macos-signing-all.sh",
    "and that script must be the real verifier, not a stand-in");
  // Stale bundles from an earlier build must not be able to satisfy the verifier, so the
  // output directory is cleared first. npm runs `pre<script>` automatically.
  assert.equal(manifest.scripts["predist:release"], "rm -rf release",
    "release/ must be cleaned before the build, or the gate can pass on last week's artifacts");
  // The load-bearing pair: `;` would run the build regardless of preflight's exit
  // status, and `||` would run it ONLY when preflight fails. Both preserve the
  // recipe's shape while inverting its meaning.
  assert.ok(!raw.includes(";"), `dist:release must not contain ';': ${raw}`);
  assert.ok(!raw.includes("||"), `dist:release must not contain '||': ${raw}`);
  assert.ok(raw.indexOf("electron-builder") > raw.indexOf("release-preflight.sh"));
});

// T5.2/T5.3 execute stages[0] VERBATIM from the manifest, with cwd = the package root.
// That means they always exercise scripts/release-preflight.sh as the recipe names it,
// and are therefore unaffected by LAWBAR_SCRIPT_DIR by design — the property under test
// is the recipe's suppression of the next stage, not the script's internal logic.
function runRecipeStage0(securityStdout, credentials) {
  const k = makeCase({ stubs: { security: { exitCode: 0, stdout: securityStdout } } });
  const marker = path.join(k.root, "build-stage-ran");
  const stage0 = manifest.scripts["dist:release"].split(" && ")[0];
  const r = runCommand(`${stage0} && printf ok > "$MARKER"`, k, {
    cwd: PKG_DIR,
    env: { MARKER: marker, ...credentials },
  });
  return { r, marker, cleanup: () => k.cleanup() };
}

test("T5.2 executing the real stages[0] with incomplete credentials exits 1 and suppresses the next stage", () => {
  const { r, marker, cleanup } = runRecipeStage0(NO_IDENTITY, {});
  assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
  assert.ok(r.stdout.includes(BANNER_FAIL), r.stdout);
  // The absent file is the actual property "no artifact is produced". The exit code
  // alone does not demonstrate suppression of the following stage.
  assert.equal(existsSync(marker), false, "the stage after preflight must not have run");
  cleanup();
});

test("T5.3 executing the real stages[0] with complete credentials exits 0 and the next stage runs", () => {
  const { r, marker, cleanup } = runRecipeStage0(IDENTITY_PRESENT, {
    APPLE_TEAM_ID: SENTINEL.APPLE_TEAM_ID,
    APPLE_ID: SENTINEL.APPLE_ID,
    APPLE_APP_SPECIFIC_PASSWORD: SENTINEL.APPLE_APP_SPECIFIC_PASSWORD,
  });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.ok(r.stdout.includes(BANNER_OK), r.stdout);
  assert.equal(readFileSync(marker, "utf8"), "ok");
  cleanup();
});

// ===========================================================================
// The cross-product
// ===========================================================================
//
// Signing axis   (8): K = keychain identity present
//                     L = CSC_LINK set
//                     P = CSC_KEY_PASSWORD set
// Notarization  (64): T = APPLE_TEAM_ID              A = APPLE_ID
//                     W = APPLE_APP_SPECIFIC_PASSWORD
//                     Y = APPLE_API_KEY              I = APPLE_API_KEY_ID
//                     S = APPLE_API_ISSUER
//
// "Unset" means ABSENT FROM THE ENV OBJECT, never the empty string — the
// empty/whitespace cases are T3.4's and T4.10's, deliberately separate.
//
// The oracles are written from the CONTRACT, not transcribed from the script, and they
// never shell out. `signOkPre` is retained solely so T5.9 can measure the fix.

const signOkPost = (K, L, P) => (L ? !!P : !!K); //  CSC_LINK wins when set
const signOkPre = (K, L, P) => !!K || (!!L && !!P); //  keychain won, so a missing
//                                                     CSC_KEY_PASSWORD was excused
const notaryOk = (T, A, W, Y, I, S) => !!T && ((!!A && !!W) || (!!Y && !!I && !!S));

const passPost = (c) => signOkPost(c.K, c.L, c.P) && notaryOk(c.T, c.A, c.W, c.Y, c.I, c.S);
const passPre = (c) => signOkPre(c.K, c.L, c.P) && notaryOk(c.T, c.A, c.W, c.Y, c.I, c.S);

const BITS = ["K", "L", "P", "T", "A", "W", "Y", "I", "S"];

function allCells() {
  const cells = [];
  for (let mask = 0; mask < 512; mask++) {
    const c = {};
    BITS.forEach((b, i) => {
      c[b] = (mask >> (BITS.length - 1 - i)) & 1;
    });
    c.label =
      `K${c.K} L${c.L} P${c.P} | T${c.T} A${c.A} W${c.W} Y${c.Y} I${c.I} S${c.S}`;
    cells.push(c);
  }
  return cells;
}

function cellEnv(c) {
  const env = {};
  if (c.L) env.CSC_LINK = SENTINEL.CSC_LINK;
  if (c.P) env.CSC_KEY_PASSWORD = SENTINEL.CSC_KEY_PASSWORD;
  if (c.T) env.APPLE_TEAM_ID = SENTINEL.APPLE_TEAM_ID;
  if (c.A) env.APPLE_ID = SENTINEL.APPLE_ID;
  if (c.W) env.APPLE_APP_SPECIFIC_PASSWORD = SENTINEL.APPLE_APP_SPECIFIC_PASSWORD;
  if (c.Y) env.APPLE_API_KEY = SENTINEL.APPLE_API_KEY;
  if (c.I) env.APPLE_API_KEY_ID = SENTINEL.APPLE_API_KEY_ID;
  if (c.S) env.APPLE_API_ISSUER = SENTINEL.APPLE_API_ISSUER;
  return env;
}

let SWEEP = null;

/** Execute all 512 cells once and cache. Two stub dirs, 512 envs. */
function sweep() {
  if (SWEEP) return SWEEP;
  const withIdentity = makeCase({ stubs: { security: { exitCode: 0, stdout: IDENTITY_PRESENT } } });
  const withoutIdentity = makeCase({ stubs: { security: { exitCode: 0, stdout: NO_IDENTITY } } });
  const results = allCells().map((c) => {
    const k = c.K ? withIdentity : withoutIdentity;
    const r = runScript(PREFLIGHT, [], k, {
      // The sweep asserts on exit codes and banners; per-cell invocation logs are not
      // observed, so writes go to /dev/null rather than 512 files.
      env: { ...cellEnv(c), LAWBAR_STUB_LOG: "/dev/null" },
    });
    return { cell: c, status: r.status, stdout: r.stdout, stderr: r.stderr };
  });
  withIdentity.cleanup();
  withoutIdentity.cleanup();
  SWEEP = results;
  return SWEEP;
}

test("T5.4 [REGRESSION] all 512 cells match an independently written oracle", () => {
  const results = sweep();
  assert.equal(results.length, 512);
  for (const { cell, status, stdout, stderr } of results) {
    const expected = passPost(cell) ? 0 : 1;
    assert.equal(status, expected, `cell ${cell.label}\n${stdout}${stderr}`);
  }
});

test("T5.5 [REGRESSION] the pass/fail split is exactly 44 / 468", () => {
  const results = sweep();
  const passed = results.filter((r) => r.status === 0).length;
  assert.deepEqual(
    { passed, failed: results.length - passed, total: results.length },
    { passed: 44, failed: 468, total: 512 },
  );
  // Re-derived independently of the sweep: signing passes in 4 of 8 (L=1 needs P;
  // L=0 needs K), notarization in 11 of 64 (T set, |A∧W| + |Y∧I∧S| − |both| =
  // 8 + 4 − 1). 4 × 11 = 44. Pre-fix signing passed in 5 of 8, giving 55.
  assert.equal(allCells().filter(passPost).length, 44);
  assert.equal(allCells().filter(passPre).length, 55);
});

test("T5.6 every failing cell exits with status 1 specifically and prints the FAILED banner", () => {
  const failing = sweep().filter((r) => !passPost(r.cell));
  assert.equal(failing.length, 468);
  for (const { cell, status, stdout } of failing) {
    // Strict equality, not "non-zero": `set -u` on an unbound variable exits 127 and a
    // signal-killed child yields null. Neither means "the gate declined".
    assert.equal(status, 1, `cell ${cell.label}`);
    assert.ok(stdout.includes(BANNER_FAIL), `cell ${cell.label}\n${stdout}`);
  }
});

test("T5.7 every passing cell exits 0, prints the OK banner and raises no [MISSING] line", () => {
  const passing = sweep().filter((r) => passPost(r.cell));
  assert.equal(passing.length, 44);
  for (const { cell, status, stdout } of passing) {
    assert.equal(status, 0, `cell ${cell.label}\n${stdout}`);
    assert.ok(stdout.includes(BANNER_OK), `cell ${cell.label}\n${stdout}`);
    assert.equal(
      stdout.split("\n").filter((l) => l.startsWith("[MISSING]")).length,
      0,
      `cell ${cell.label}\n${stdout}`,
    );
  }
});

test("T5.8 the same cell run twice produces a byte-identical result", () => {
  const k = makeCase({ stubs: { security: { exitCode: 0, stdout: IDENTITY_PRESENT } } });
  const cases = [
    ["passing", { APPLE_TEAM_ID: SENTINEL.APPLE_TEAM_ID, APPLE_ID: SENTINEL.APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD: SENTINEL.APPLE_APP_SPECIFIC_PASSWORD }],
    ["failing", {}],
  ];
  for (const [label, env] of cases) {
    const one = runScript(PREFLIGHT, [], k, { env: { ...env, LAWBAR_STUB_LOG: path.join(k.root, `log-${label}-1`) } });
    const two = runScript(PREFLIGHT, [], k, { env: { ...env, LAWBAR_STUB_LOG: path.join(k.root, `log-${label}-2`) } });
    assert.equal(one.status, two.status, label);
    assert.equal(one.stdout, two.stdout, label);
    assert.equal(one.stderr, two.stderr, label);
  }
  k.cleanup();
});

test("T5.9 [REGRESSION] the fix moved exactly 11 cells pass->fail, 0 fail->pass, all K=1 L=1 P=0", () => {
  const cells = allCells();
  assert.equal(cells.length, 512, "the cross-product must be complete");

  // Anchor the post-fix oracle to REAL process exits, so this is a claim about the
  // script's behaviour and not merely about two JS functions agreeing.
  const observedPass = new Set(
    sweep().filter((r) => r.status === 0).map((r) => r.cell.label),
  );
  const oraclePass = new Set(cells.filter(passPost).map((c) => c.label));
  assert.deepEqual([...observedPass].sort(), [...oraclePass].sort());

  const before = cells.filter(passPre).length;
  const after = cells.filter(passPost).length;
  assert.equal(before, 55, "pre-fix gate accepted 55 of 512 configurations");
  assert.equal(after, 44, "post-fix gate accepts 44 of 512 configurations");

  const movedToFail = cells.filter((c) => passPre(c) && !passPost(c));
  const movedToPass = cells.filter((c) => !passPre(c) && passPost(c));

  assert.equal(movedToFail.length, 11, movedToFail.map((c) => c.label).join("\n"));
  // A hardening fix may only tighten. A single cell moving the other way would mean
  // the change accepted something the old gate refused.
  assert.equal(movedToPass.length, 0, movedToPass.map((c) => c.label).join("\n"));

  // The precision clause: the fix removes finding 3's configuration — keychain
  // identity present, CSC_LINK set, password missing — and nothing else. Any
  // accidental widening or narrowing moves one of the three numbers above or breaks
  // this signature.
  for (const c of movedToFail) {
    assert.deepEqual(
      { K: c.K, L: c.L, P: c.P },
      { K: 1, L: 1, P: 0 },
      `unexpected signing signature among the moved cells: ${c.label}`,
    );
  }
  // And every notarization-satisfying combination is represented exactly once.
  assert.equal(new Set(movedToFail.map((c) => c.label)).size, 11);
  assert.equal(movedToFail.filter((c) => notaryOk(c.T, c.A, c.W, c.Y, c.I, c.S)).length, 11);
});

test("T5.x the sweep really exercised the isolated harness, not the host", () => {
  // Cheap provenance check: the two stub dirs live under the OS tmpdir and the sweep
  // observed both exit codes. A run that had silently reached the real `security`
  // would show a single verdict across the keychain axis.
  const results = sweep();
  const byK = { 0: new Set(), 1: new Set() };
  for (const r of results) byK[r.cell.K].add(r.status);
  assert.deepEqual([...byK[1]].sort(), [0, 1]);
  assert.deepEqual([...byK[0]].sort(), [0, 1]);
  // mkdtemp roots are never inside the repo tree.
  const probe = mkdtempSync(path.join(os.tmpdir(), "lawbar-probe-"));
  assert.ok(!path.resolve(probe).startsWith(path.resolve(PKG_DIR)));
});
