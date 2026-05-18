// CLI failure-path tests for bin/bakeoff.mjs. Spawn the bin as a child
// process and assert exit code + stderr semantics for the documented
// failure modes. Audit 019e3854 D7.4.
//
// POSIX-only: these tests assume a working `node` binary on PATH plus
// the OS's child_process.spawnSync semantics; behavior under Windows
// is not pinned by these tests (audit 019e3854 D8.1).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const binPath = join(pkgRoot, "bin", "bakeoff.mjs");

function runBin(args, env = {}) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: pkgRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    // Tight timeout so a hang in the bin (e.g. probe stuck) doesn't hang CI.
    timeout: 30_000,
  });
}

test("bin: unknown flag exits 3 with error on stderr", () => {
  const result = runBin(["--definitely-not-a-flag"]);
  assert.equal(result.status, 3, `exit code: ${result.status}; stderr: ${result.stderr}`);
  assert.match(result.stderr, /unknown arg/);
});

test("bin: invalid --role exits 3 with error on stderr", () => {
  const result = runBin(["--role=ad-hoc"]);
  assert.equal(result.status, 3, `exit code: ${result.status}; stderr: ${result.stderr}`);
  assert.match(result.stderr, /--role must be smoke\|verdict/);
});

test("bin: empty --role= exits 3", () => {
  const result = runBin(["--role="]);
  assert.equal(result.status, 3);
  assert.match(result.stderr, /--role must be smoke\|verdict/);
});

test("bin: --fixture-id selecting a non-existent fixture exits 2 (no successful observation)", () => {
  // The manifest currently contains 01-hello-bakeoff (active) +
  // 01-printed-chinese (placeholder). A non-existent id leaves the
  // fixtures list empty after filtering; no observation can succeed
  // → exit 2.
  const result = runBin(["--fixture-id=this-id-does-not-exist"]);
  assert.equal(result.status, 2, `exit code: ${result.status}; stdout: ${result.stdout.slice(0, 200)}`);
});

const REAL_ENV_KEY = "OCR_REAL_TESSERACT_TESTS";
const realTestsRequested = process.env[REAL_ENV_KEY] === "1";

test(
  "bin: REAL --role=smoke with the on-disk manifest exits 0 and reports verdict_ready=false",
  {
    skip: !realTestsRequested ? `set ${REAL_ENV_KEY}=1 to enable` : false,
  },
  () => {
    // Audit 019e3921: this is a host-dependent CLI happy-path. The
    // previous version silently skipped on any nonzero exit, which
    // would have passed even if the CLI regressed to the wrong exit
    // code. Now gated on the same opt-in env as the harness's real
    // tests: when requested, the CLI MUST exit 0 and emit a parseable
    // JSON report. When not requested, the test is skipped explicitly
    // (no false-positive coverage).
    const result = runBin(["--role=smoke"]);
    assert.equal(
      result.status,
      0,
      `CLI exit 0 required; got ${result.status}; stderr: ${result.stderr.slice(0, 200)}`,
    );
    const report = JSON.parse(result.stdout);
    assert.equal(report.role_filter, "smoke");
    assert.equal(report.verdict_ready, false);
    assert.ok(
      report.observations.some((o) => o.outcome === "success"),
      `expected at least one successful observation: ${JSON.stringify(report.observations)}`,
    );
  },
);
