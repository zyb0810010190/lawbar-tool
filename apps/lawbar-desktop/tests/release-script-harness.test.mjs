// release-script-harness.test.mjs — WI-1 (hermetic runner) + WI-2 (stubs really
// shadow the system binaries) + T9.1 (the opt-in skip decision, kept in the
// REGISTERED lane so it is covered even when the real-bundle file never runs).
//
// Posture: regression-first (see .claude/tdd-guardian/tests-20260813-013156-addendum.md).
// Both scripts were fixed before these tests were written, so every case asserts
// CORRECT behaviour. Cases marked "two-sided" must fail when LAWBAR_SCRIPT_DIR points
// at the preserved pre-fix copies and pass against the current scripts.
//
// The whole file exists to make one guarantee checkable: results here depend on the
// generated stub dir and nothing else — not on the maintainer's keychain, not on the
// maintainer's exported release variables, not on /usr/bin.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync, mkdirSync, writeFileSync, realpathSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  PREFLIGHT, VERIFY, SENTINEL, IDENTITY_PRESENT, NO_IDENTITY, KEYCHAIN_ONLY, PKG_DIR,
  STUBBED_BINARIES, PASSTHROUGH_BINARIES, REAL_BUNDLE_REL,
  makeCase, makeStubDir, makeTempRoot, assertStubsShadow, readInvocationLog,
  runScript, runProbe, skipReason, isUnderTmp, isUnderRepo, assertNoCommandNotFound,
  LOCK_MKDIR, LOCK_RMDIR, LOCK_MAX_ATTEMPTS, CHILD_TIMEOUT_MS, childEnv,
} from "./_release-script-harness.mjs";

const APPLE_OK = {
  APPLE_TEAM_ID: SENTINEL.APPLE_TEAM_ID,
  APPLE_ID: SENTINEL.APPLE_ID,
  APPLE_APP_SPECIFIC_PASSWORD: SENTINEL.APPLE_APP_SPECIFIC_PASSWORD,
};

/** Stub set that drives verify-macos-signing.sh to its release-ready verdict. */
function releaseReadyStubs() {
  return {
    codesign: {
      exitCode: 0,
      cases: [
        {
          when: "-dv*",
          exitCode: 0,
          stdout:
            "Identifier=io.lawbar.desktop\n" +
            "Authority=Developer ID Application: SENTINEL-ORG (SENTINEL-TEAMID-A)\n",
        },
        { when: "--verify*", exitCode: 0, stdout: "" },
      ],
    },
    spctl: { exitCode: 0, stdout: "fixture: accepted\nsource=Notarized Developer ID\n" },
    xcrun: {
      exitCode: 0,
      cases: [
        { when: "-f*", exitCode: 0, stdout: "/usr/bin/stapler\n" },
        { when: "stapler validate*", exitCode: 0, stdout: "The validate action worked!\n" },
      ],
    },
    stapler: { exitCode: 0 },
  };
}

/** A structurally valid app bundle. Both structural members, per the post-fix guard. */
function makeBundle(root, name = "fixture.app") {
  const app = path.join(root, name);
  mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
  writeFileSync(path.join(app, "Contents", "Info.plist"), "<plist/>\n");
  return app;
}

// ===========================================================================
// WI-1 — hermetic script-runner harness
// ===========================================================================

test("T1.1 runScript returns exit code, stdout and stderr verbatim and unmerged", () => {
  const k = makeCase();
  const r = runProbe(`printf 'OUT-LINE\\n'; printf 'ERR-LINE\\n' >&2; exit 3`, k);
  assert.equal(r.status, 3);
  assert.equal(r.stdout, "OUT-LINE\n");
  assert.equal(r.stderr, "ERR-LINE\n");
  k.cleanup();
});

test("T1.2 a parent-exported variable is absent in the child; a supplied one is present", () => {
  // Both halves in ONE assertion on purpose: a harness passing nothing at all would
  // satisfy the first half, and one spreading process.env would satisfy the second.
  process.env.LAWBAR_HARNESS_CONTROL = "PARENT-LEAK-CANARY";
  try {
    const k = makeCase();
    const r = runProbe(
      `printf '%s|%s\\n' "\${LAWBAR_HARNESS_CONTROL:-ABSENT}" "\${APPLE_TEAM_ID:-ABSENT}"`,
      k,
      { env: { APPLE_TEAM_ID: SENTINEL.APPLE_TEAM_ID } },
    );
    assert.equal(r.stdout, `ABSENT|${SENTINEL.APPLE_TEAM_ID}\n`);
    k.cleanup();
  } finally {
    delete process.env.LAWBAR_HARNESS_CONTROL;
  }
});

test("T1.3 the child exports no name the harness did not supply", () => {
  const k = makeCase();
  const supplied = ["PATH", "HOME", "LAWBAR_STUB_LOG", "APPLE_TEAM_ID"];
  // PWD/SHLVL/OLDPWD/_ are bash's own, unavoidable and deterministic.
  const allowed = new Set([...supplied, "PWD", "SHLVL", "OLDPWD", "_"]);
  const r = runProbe(`for n in $(compgen -e); do printf '%s\\n' "$n"; done`, k, {
    env: { APPLE_TEAM_ID: SENTINEL.APPLE_TEAM_ID },
  });
  assert.equal(r.status, 0, r.stderr);
  const printed = r.stdout.split("\n").filter(Boolean);
  const unexpected = printed.filter((n) => !allowed.has(n));
  assert.deepEqual(unexpected, [], "parent environment leaked into the child");
  for (const name of supplied) assert.ok(printed.includes(name), `missing supplied var: ${name}`);
  k.cleanup();
});

// A stub only ever has to be runnable BY US: the child runs as the same user, out of a temp
// directory we own. `writeFileSync(..., { mode: 0o755 })` REQUESTS 0755, but POSIX umask
// subtracts from that and never adds to it, so on a machine with `umask 077` — which is the
// correct posture for one holding privileged client material — the stub lands 0700 and an
// `=== 0o755` assertion fails. CI runs umask 022 and gets exactly 0755. That made this a test
// whose verdict depended on the environment rather than on the code: green on CI, permanently
// red locally, which is precisely how a red acquires a name and stops being investigated.
//
// So assert the two properties that actually matter and that umask cannot make false:
//   * we can read AND execute it (a shell script needs both), and
//   * the harness never granted MORE than 0755 — no setuid, no group/other write.
// This is the same reasoning `assertStubsShadow` (`& 0o111`), the packaged smoke test, and
// the ocr-worker temp-file test ("umask can mask further but never adds") already use.
function assertOwnerRunnable(file, what) {
  const mode = statSync(file).mode & 0o777;
  const oct = mode.toString(8).padStart(3, "0");
  assert.equal(mode & 0o500, 0o500, `${what}: owner must be able to read and execute it (mode ${oct})`);
  assert.equal(mode & ~0o755, 0, `${what}: no permission beyond 0755 may be granted (mode ${oct})`);
}

test("T1.4 stub exitCode, stdout and stderr are configured independently and byte-exact", () => {
  const specs = [
    { spec: { exitCode: 0, stdout: "S-ZERO\n", stderr: "" }, out: "S-ZERO\nrc=0\n", err: "" },
    { spec: { exitCode: 1, stdout: "", stderr: "E-ONE\n" }, out: "rc=1\n", err: "E-ONE\n" },
    { spec: { exitCode: 127, stdout: "", stderr: "" }, out: "rc=127\n", err: "" },
  ];
  for (const { spec, out, err } of specs) {
    const k = makeCase({ stubs: { security: spec } });
    assertOwnerRunnable(path.join(k.stubDir, "security"), "stub");
    const r = runProbe(`security; printf 'rc=%s\\n' "$?"`, k);
    assert.equal(r.stdout, out, `stdout for exitCode ${spec.exitCode}`);
    assert.equal(r.stderr, err, `stderr for exitCode ${spec.exitCode}`);
    k.cleanup();
  }
});

test("T1.5 the invocation log records name and full argv in call order, spaces preserved", () => {
  const k = makeCase();
  const r = runProbe(
    `security find-identity -v -p codesigning\ncodesign --verify "/tmp/a b c.app"`,
    k,
  );
  assert.equal(r.status, 0, r.stderr);
  // Read back from the real file on disk, never from an in-memory copy.
  assert.deepEqual(readInvocationLog(k.logPath), [
    { name: "security", argv: ["find-identity", "-v", "-p", "codesigning"] },
    { name: "codesign", argv: ["--verify", "/tmp/a b c.app"] },
  ]);
  k.cleanup();
});

test("T1.6 teardown removes every temp dir, and nothing is written under the repo tree", () => {
  const k = makeCase({ stubs: { security: { exitCode: 0, stdout: IDENTITY_PRESENT } } });
  const r = runScript(PREFLIGHT, [], k, { env: APPLE_OK });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);

  for (const p of [k.root, k.stubDir, k.home, k.logPath]) {
    assert.ok(isUnderTmp(p), `harness path escaped the tmpdir: ${p}`);
    assert.ok(!isUnderRepo(p), `harness path is inside the repo tree: ${p}`);
  }
  k.cleanup();
  assert.equal(existsSync(k.stubDir), false);
  assert.equal(existsSync(k.home), false);
  assert.equal(existsSync(k.logPath), false);
  assert.equal(existsSync(k.root), false);
});

test("T1.7 both real scripts run end-to-end under the isolated PATH with nothing missing", () => {
  // (a) release-preflight.sh with a full passing credential set.
  const a = makeCase({ stubs: { security: { exitCode: 0, stdout: IDENTITY_PRESENT } } });
  const ra = runScript(PREFLIGHT, [], a, { env: APPLE_OK });
  assertNoCommandNotFound(ra, "release-preflight.sh");
  assert.equal(ra.status, 0, `${ra.stdout}${ra.stderr}`);
  assert.ok(a.log().length > 0, "preflight must have reached at least one stub");
  a.cleanup();

  // (b) verify-macos-signing.sh against a structurally valid temp bundle.
  const b = makeCase({ stubs: releaseReadyStubs() });
  const app = makeBundle(b.root);
  const rb = runScript(VERIFY, [app], b);
  assertNoCommandNotFound(rb, "verify-macos-signing.sh");
  assert.equal(rb.status, 0, `${rb.stdout}${rb.stderr}`);
  assert.ok(b.log().length > 0, "verify must have reached at least one stub");
  b.cleanup();
});

test("T1.8 cwd is honoured, so the cwd-relative default bundle path is controllable", () => {
  const k = makeCase();
  const tmpA = makeTempRoot("lawbar-cwd-");
  const r = runProbe(`printf '%s\\n' "$PWD"`, k, { cwd: tmpA });
  // macOS symlinks /var -> /private/var; comparing against realpathSync is the
  // correct handling, not a workaround.
  assert.equal(r.stdout, `${realpathSync(tmpA)}\n`);
  k.cleanup();
});

// ===========================================================================
// WI-2 — prove the stubs actually shadow the real system binaries
// ===========================================================================

test("T2.1 under the child PATH, all five binaries resolve inside the stub dir", () => {
  const k = makeCase();
  const names = STUBBED_BINARIES;
  const r = runProbe(
    `for n in ${names.join(" ")}; do printf '%s\\n' "$(command -v "$n")"; done`,
    k,
  );
  // Resolution is performed by the child's own shell, not recomputed in JS.
  assert.deepEqual(
    r.stdout.split("\n").filter(Boolean),
    names.map((n) => path.join(k.stubDir, n)),
  );
  k.cleanup();
});

test("T2.2 the child PATH contains no system binary directory", () => {
  const k = makeCase();
  const r = runProbe(`printf '%s\\n' "$PATH"`, k);
  // Exact, not "does not contain /usr/bin": a future /opt/homebrew/bin addition is
  // caught too. This is correction C-1's tripwire.
  assert.deepEqual(r.stdout.replace(/\n$/, "").split(":"), [k.stubDir]);
  k.cleanup();
});

test("T2.3 assertStubsShadow throws naming the binary when a required stub is missing", () => {
  const missingCodesign = makeCase({ omit: ["codesign"], verify: false });
  assert.throws(() => assertStubsShadow(missingCodesign.stubDir, { allowMissing: [] }), /codesign/);
  assert.throws(
    () => assertStubsShadow(missingCodesign.stubDir, { allowMissing: [] }),
    /would not resolve to a stub/,
  );
  missingCodesign.cleanup();

  // The negative half is what makes this a guard rather than an unconditional throw.
  const missingStapler = makeCase({ omit: ["stapler"], verify: false });
  assert.equal(assertStubsShadow(missingStapler.stubDir, { allowMissing: ["stapler"] }), true);
  missingStapler.cleanup();

  // A bare existsSync(stubDir) would pass a directory holding zero stubs.
  const emptyDir = makeTempRoot("lawbar-emptystub-");
  assert.throws(() => assertStubsShadow(emptyDir, { allowMissing: [] }), /would not resolve/);
});

test("T2.4 the security stub, not the real keychain, drives the identity branch", () => {
  const k = makeCase({ stubs: { security: { exitCode: 0, stdout: IDENTITY_PRESENT } } });
  const r = runScript(PREFLIGHT, [], k, { env: APPLE_OK });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.ok(r.stdout.includes("[ok] Developer ID Application identity found in the keychain."));
  // The sentinel in the fixture proves provenance: no real `security` output can
  // contain it, so this branch was decided by the stub.
  assert.deepEqual(k.log(), [
    { name: "security", argv: ["find-identity", "-v", "-p", "codesigning"] },
  ]);
  k.cleanup();
});

test("T2.5 codesign, spctl and xcrun stubs are each reached on a verify run", () => {
  const k = makeCase({ stubs: releaseReadyStubs() });
  const app = makeBundle(k.root);
  const r = runScript(VERIFY, [app], k);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const log = k.log();
  // Two-sided: the post-fix script probes with `xcrun -f stapler` BEFORE running
  // `xcrun stapler validate`, so there are two xcrun records. The pre-fix script
  // short-circuits on `command -v stapler` and produces only one.
  assert.deepEqual(log.map((r) => r.name), ["codesign", "codesign", "spctl", "xcrun", "xcrun"]);
  assert.deepEqual(log[0].argv, ["-dv", "--verbose=2", app]);
  assert.deepEqual(log[1].argv.slice(0, 3), ["--verify", "--deep", "--strict"]);
  assert.deepEqual(log[2].argv, ["-a", "-vv", "-t", "exec", app]);
  assert.deepEqual(log[3].argv, ["-f", "stapler"]);
  assert.deepEqual(log[4].argv, ["stapler", "validate", app]);
  k.cleanup();
});

test("T2.6 'no identity' is produced by a stub fixture, never by omitting the stub", () => {
  const k = makeCase({ stubs: { security: { exitCode: 0, stdout: NO_IDENTITY } } });
  const r = runScript(PREFLIGHT, [], k, { env: APPLE_OK });
  assert.equal(r.status, 1);
  assert.ok(
    r.stdout.includes(
      "[MISSING] no Developer ID Application identity in the keychain and CSC_LINK is unset.",
    ),
  );
  assert.ok(
    r.stdout.includes(
      "  - import the cert into the login keychain, OR set CSC_LINK + CSC_KEY_PASSWORD.",
    ),
  );
  // This is what distinguishes "the stub said no" from "the binary was not found":
  // two states that produce identical stdout.
  assert.equal(k.log().filter((rec) => rec.name === "security").length, 1);
  k.cleanup();
});

test("T2.7 a deliberately absent stapler stub makes command -v stapler fail in the child", () => {
  // The enabling precondition for T8.9. /usr/bin/stapler exists on this host, so under
  // a merely-prepended PATH this probe would print FOUND and the "unavailable" branch
  // would be unreachable.
  const k = makeCase({ omit: ["stapler"], allowMissing: ["stapler"] });
  const r = runProbe(
    `if command -v stapler >/dev/null 2>&1; then printf 'FOUND\\n'; else printf 'NOT-FOUND\\n'; fi`,
    k,
  );
  assert.equal(r.stdout, "NOT-FOUND\n");
  k.cleanup();
});

test("T2.x pass-through stubs exist for bash, grep and sed and exec the real binaries", () => {
  const k = makeCase();
  for (const name of Object.keys(PASSTHROUGH_BINARIES)) {
    assert.ok(existsSync(path.join(k.stubDir, name)), `missing pass-through: ${name}`);
  }
  const r = runProbe(`printf 'alpha\\nbeta\\n' | grep beta | sed 's/^/X/'`, k);
  assert.equal(r.stdout, "Xbeta\n");
  // The pass-throughs log too, but readInvocationLog filters them from the default
  // view so ordered boundary assertions stay stable.
  assert.deepEqual(k.log(), []);
  assert.deepEqual(
    k.allLog().map((rec) => rec.name).sort(),
    ["grep", "sed"],
  );
  k.cleanup();
});

// ===========================================================================
// T9.1 — the opt-in skip decision (registered lane, so it is never dark)
// ===========================================================================

test("T9.1 skipReason returns the correct loud reason for each of four states", () => {
  const present = (p) => p === REAL_BUNDLE_REL;
  const absent = () => false;
  const FLAG_REASON = "SKIPPED: LAWBAR_SIGNING_REAL_BUNDLE is not set to 1";

  // Not opted in -> a plain skip string. This is the common, correct case.
  assert.equal(skipReason({}, present), FLAG_REASON);
  // The flag is checked first, so the cheaper diagnostic wins and no stat happens.
  assert.equal(skipReason({}, absent), FLAG_REASON);
  // "0", "true" and "yes" are not "1" — opting in must be unambiguous.
  assert.equal(skipReason({ LAWBAR_SIGNING_REAL_BUNDLE: "0" }, present), FLAG_REASON);
  // Opted in with a bundle -> run.
  assert.equal(skipReason({ LAWBAR_SIGNING_REAL_BUNDLE: "1" }, present), null);

  // Opted in with NO bundle -> a { fail } verdict, NOT a skip string. Returning a
  // skip here let the one lane whose whole purpose is real-tool evidence report
  // success having produced none. Asserting the SHAPE matters as much as the text:
  // a future refactor returning a string again would silently restore the vacuous
  // pass, and a string is truthy exactly like this object.
  const optedInNoBundle = skipReason({ LAWBAR_SIGNING_REAL_BUNDLE: "1" }, absent);
  assert.equal(typeof optedInNoBundle, "object", "must not be a skip string");
  assert.equal(typeof optedInNoBundle.fail, "string");
  assert.match(optedInNoBundle.fail, /was set, but no bundle exists/);
  assert.match(optedInNoBundle.fail, new RegExp(REAL_BUNDLE_REL.replace(/[/.]/g, "\\$&")));
});

// ===========================================================================
// Sentinel hygiene — the keychain-only marker must never be a real-looking value
// ===========================================================================

test("T2.y the keychain-only sentinel appears in the fixture and nowhere in preflight output", () => {
  assert.ok(IDENTITY_PRESENT.includes(KEYCHAIN_ONLY), "fixture must carry the marker");
  const k = makeCase({ stubs: { security: { exitCode: 0, stdout: IDENTITY_PRESENT } } });
  const r = runScript(PREFLIGHT, [], k, { env: APPLE_OK });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  // `grep -q` suppresses the listing, so the keychain contents never reach stdout.
  assert.ok(!`${r.stdout}${r.stderr}`.includes(KEYCHAIN_ONLY));
  k.cleanup();
});

test("T2.z makeStubDir writes every stub executable, and omit really omits", () => {
  const dir = path.join(makeTempRoot("lawbar-stubdir-"), "bin");
  makeStubDir(dir, { omit: ["xcrun"] });
  for (const n of STUBBED_BINARIES) {
    if (n === "xcrun") {
      assert.equal(existsSync(path.join(dir, n)), false, "omitted stub must not exist");
      continue;
    }
    assertOwnerRunnable(path.join(dir, n), n);
  }
});

// ---------------------------------------------------------------- WI-10: lane registration
//
// `scripts.test` is a hand-maintained `node --test <file> <file> …` list. A test file
// that exists on disk but is absent from it never runs, which looks exactly like
// coverage while providing none — this package already carries three files in that
// state. These cases keep the four new files from silently joining them.

const MANIFEST = JSON.parse(
  readFileSync(path.join(PKG_DIR, "package.json"), "utf8"),
);
const REGISTERED = MANIFEST.scripts.test.replace("node --test", "").trim().split(/\s+/);

test("T10.1 every new test file is registered in scripts.test", () => {
  for (const f of [
    "tests/release-script-harness.test.mjs",
    "tests/release-preflight.test.mjs",
    "tests/release-preflight-failclosed.test.mjs",
    "tests/verify-macos-signing.test.mjs",
  ]) {
    assert.ok(REGISTERED.includes(f), `${f} is not in scripts.test and would never run`);
  }
});

test("T10.2 the opt-in real-bundle file and the harness helper are deliberately NOT registered", () => {
  // The real-bundle file needs LAWBAR_SIGNING_REAL_BUNDLE=1 and may touch the network,
  // so it must stay out of the push gate. The helper is not a test file at all.
  assert.ok(!REGISTERED.some((f) => f.includes("real-bundle")));
  assert.ok(!REGISTERED.some((f) => f.includes("_release-script-harness")));
});

test("T10.3 every registered path still exists on disk", () => {
  const missing = REGISTERED.filter((f) => !existsSync(path.join(PKG_DIR, f)));
  assert.deepEqual(missing, [], `registered but absent: ${missing.join(", ")}`);
  assert.ok(REGISTERED.length >= 60, `expected >= 60 registered files, got ${REGISTERED.length}`);
});

// ---------------------------------------------------------------- WI-F7: the invocation-log lock
//
// The lock in `logPrelude` called BARE `mkdir`/`rmdir`, and the child's PATH is deliberately the
// stub directory alone — which has never contained either. So every acquisition failed with
// command-not-found, the bounded spin ran all 5,001 iterations, and the record was appended with
// NO LOCK. The suite stayed green throughout: nothing asserted that the lock could be taken, only
// that records could be read back, and a single-threaded case reads back fine unlocked.
//
// These cases assert the lock as a MECHANISM rather than as a side effect, which is what the
// original was missing.

test("T7.9 the lock commands the stubs use are absolute and really exist", () => {
  // If either were relative, PATH would decide — and PATH here is a directory that contains
  // neither. This is the whole defect, in one assertion.
  for (const p of [LOCK_MKDIR, LOCK_RMDIR]) {
    assert.ok(path.isAbsolute(p), `${p} must be absolute; PATH here cannot resolve it`);
    assert.ok(existsSync(p), `${p} does not exist on this host`);
    assert.ok((statSync(p).mode & 0o111) !== 0, `${p} is not executable`);
  }
  // And they are NOT passthrough stubs: a passthrough runs logPrelude, so locking through one
  // would recurse — take the lock to take the lock.
  for (const name of ["mkdir", "rmdir"]) {
    assert.equal(Object.keys(PASSTHROUGH_BINARIES).includes(name), false,
      `${name} must not become a logging passthrough: the lock would recurse through itself`);
  }
});

test("T7.10 a stub really WAITS on a held lock, then proceeds when it is released", async () => {
  // The concurrency has to come from Node, not from the probe shell: the isolated PATH has no
  // `sleep`, and more importantly the stub's spin is BOUNDED — after LOCK_MAX_ATTEMPTS it gives
  // up and appends unprotected on purpose, so "the log stays empty forever while held" is not
  // something the design promises and must not be asserted. What IS promised is that the stub
  // waits rather than walking straight past a held lock, and that is what this measures.
  const kase = makeCase();
  try {
    mkdirSync(`${kase.logPath}.lock`);

    const child = spawn("/bin/bash", ["-c", "codesign --version"], {
      cwd: kase.root,
      env: childEnv(kase),
      stdio: "ignore",
    });
    const exited = new Promise((resolve) => child.on("exit", resolve));

    // While the lock is held the record must not appear. Checked over a window comfortably
    // shorter than the spin bound, so this observes waiting rather than racing the giving-up.
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(readInvocationLog(kase.logPath, { all: true }), [],
      "the stub walked straight past a held lock — which is what a broken lock looks like");
    assert.equal(child.exitCode, null, "the stub should still be waiting, not finished");

    rmSync(`${kase.logPath}.lock`, { recursive: true, force: true });
    assert.equal(await exited, 0, "the stub failed once the lock was free");

    assert.ok(readInvocationLog(kase.logPath).some((r) => r.name === "codesign"),
      "the stub never logged its call once the lock was released");
    assert.equal(existsSync(`${kase.logPath}.lock`), false,
      "the lock directory was left behind, so every later call would spin to its bound");
  } finally { kase.cleanup(); }
});

test("T7.11 concurrent stubs writing LONG arguments still parse as separate records", () => {
  // The real failure this lock exists for: the anchored Developer-ID regex made the `grep`
  // record long enough to exceed the stdio buffer, and the two sides of `security … | grep …`
  // interleaved into one corrupt record on a clean CI runner. Long arguments are the trigger,
  // so they are the input here.
  const kase = makeCase();
  try {
    const long = "L".repeat(9000);
    const probe = [
      `for i in 1 2 3 4 5 6 7 8; do`,
      `  codesign --verify --long "${long}-$i" &`,
      `  spctl --assess --long "${long}-$i" &`,
      `done`,
      `wait`,
    ].join("\n");
    const r = runProbe(probe, kase);
    assert.equal(r.status, 0, r.stderr);

    const records = readInvocationLog(kase.logPath);
    assert.equal(records.length, 16, `expected 16 records, got ${records.length}`);
    for (const rec of records) {
      assert.ok(["codesign", "spctl"].includes(rec.name),
        `a record name was corrupted by interleaving: ${JSON.stringify(rec.name.slice(0, 80))}`);
      assert.equal(rec.argv.length, 3, `record argv was split or merged: ${JSON.stringify(rec.argv.map((a) => a.slice(0, 40)))}`);
      assert.equal(rec.argv[2].length, long.length + 2, "a long argument did not round-trip whole");
      assert.ok(rec.argv[2].startsWith(long), "a long argument was truncated or spliced");
    }
    assert.equal(records.filter((r) => r.name === "codesign").length, 8);
    assert.equal(records.filter((r) => r.name === "spctl").length, 8);
  } finally { kase.cleanup(); }
});

test("T7.12 a missing lock command fails FAST and says so, rather than spinning silently", () => {
  // The old behaviour on exactly this input: 5,001 no-op iterations, then an unlocked append and
  // a zero exit — a lock that had stopped existing, reported as success. A stub that cannot lock
  // must say so, because everything downstream of it is now unproven.
  const kase = makeCase();
  try {
    const stubBody = readFileSync(path.join(kase.stubDir, "codesign"), "utf8");
    assert.ok(stubBody.includes(LOCK_MKDIR), "the stub does not use the absolute lock command");

    const broken = stubBody.split(LOCK_MKDIR).join("/nonexistent/lawbar-no-such-mkdir");
    writeFileSync(path.join(kase.stubDir, "codesign"), broken, { mode: 0o755 });

    const started = Date.now();
    const r = runProbe(`codesign --version`, kase);
    const elapsed = Date.now() - started;

    assert.notEqual(r.status, 0, "a stub that cannot lock its log exited 0");
    assert.equal(r.status, 97, "the missing-lock-command exit code is its own signal");
    assert.ok(/cannot be locked/.test(r.stderr), `the failure must name the cause; got: ${r.stderr}`);
    assert.ok(elapsed < 10_000, `fail-fast means fail fast; took ${elapsed}ms`);
    assert.deepEqual(readInvocationLog(kase.logPath, { all: true }), [],
      "a stub that could not lock must not append an unprotected record anyway");
  } finally { kase.cleanup(); }
});

test("T7.13 harness-spawned children carry a timeout, so nothing can hang the suite", () => {
  assert.ok(Number.isFinite(CHILD_TIMEOUT_MS) && CHILD_TIMEOUT_MS > 0,
    "CHILD_TIMEOUT_MS must be a positive number of milliseconds");
  const kase = makeCase();
  try {
    // A real block, killed by a real timeout. `/bin/sleep` by ABSOLUTE path: the isolated PATH
    // deliberately holds only the stubs, so a bare `sleep` here would exit 127 immediately and
    // this case would pass without the timeout ever being exercised — which is how the first
    // version of it was wrong.
    const started = Date.now();
    const r = runProbe(`/bin/sleep 30`, kase, { timeout: 750 });
    const elapsed = Date.now() - started;

    assert.equal(r.error?.code, "ETIMEDOUT", `the child was not killed by the timeout: ${r.error?.code}`);
    assert.ok(elapsed < 10_000, `the timeout must actually fire; took ${elapsed}ms`);

    // And an ordinary child still completes normally under the same plumbing.
    const ok = runProbe(`/bin/sleep 0`, kase);
    assert.equal(ok.status, 0, "a normal child must not be affected by the timeout");
  } finally { kase.cleanup(); }
});
