// verify-macos-signing.test.mjs — WI-7 (bundle guard), WI-8 (reporting + the exit
// contract) and WI-12 (argument parsing) for scripts/verify-macos-signing.sh.
//
// POSTURE: regression-first. Cases tagged [REGRESSION] must FAIL against the preserved
// pre-fix copy and PASS against the current script:
//
//   LAWBAR_SCRIPT_DIR=<prefix-scripts> node --test tests/verify-macos-signing.test.mjs
//
// THE EXIT CONTRACT is what this script now exists for, and it is why `verify:signing
// && ship` is safe by construction:
//   0  release-ready   1  usage/path/tooling error   2  signed, not release-ready
//   3  unsigned or adhoc (the `npm run dist` default)
// `--report` suppresses 2 and 3 (exit 0); a usage/path error still exits 1.
//
// FIX REGISTER covered here (addendum §2, WI-11):
//   finding 1 — the verifier always exited 0, so `verify:signing && ship`
//               was silently vacuous                      -> exit contract  -> T8.12, T8.14–T8.16, T7.6
//   finding 5 — the bundle guard was `-d` only            -> structural     -> T7.5, T7.10
//   finding 6 — the stapler probe tested a different
//               binary from the one the body ran          -> `xcrun -f`     -> T8.7–T8.9
//   finding 8 — piping into `sed` discarded every tool's
//               exit status and substituted sed's, which
//               is always 0 (`false | sed …` returns 0)   -> capture-then-print -> T8.19, T8.8, T8.9
//
// MOCK BOUNDARY, stated once: `codesign`, `spctl`, `xcrun` and `stapler`. Gatekeeper
// assessment and notarization-ticket lookup are network-touching operations, which is
// exactly why the real-path suite (tests/verify-macos-signing.real-bundle.test.mjs) is
// opt-in and unregistered. The FAILURE direction has a real-path counterpart there;
// the SUCCESS direction has none and cannot have one — it needs a Developer ID
// certificate and a real notarization ticket, both forbidden.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, symlinkSync, readFileSync } from "node:fs";
import path from "node:path";
import { VERIFY, PKG_DIR, makeCase, runScript, lines, countOccurrences } from "./_release-script-harness.mjs";

// --- emitted strings, quoted from the script -------------------------------
const HDR_DV = "-- codesign -dv (signature identity) --";
const HDR_VERIFY = "-- codesign --verify --deep --strict (integrity) --";
const HDR_SPCTL = "-- spctl -a -vv -t exec (Gatekeeper assessment) --";
const HDR_STAPLER = "-- stapler validate (notarization ticket stapled?) --";
const CS_OK = "  codesign verify: OK";
const CS_FAILED = "  codesign verify: FAILED (adhoc/unsigned builds fail deep-strict verify)";
const SP_ACCEPTED = "  spctl: accepted";
const SP_REJECTED = "  spctl: rejected";
const ST_STAPLED = "  stapler: ticket stapled";
const ST_NO_TICKET = "  stapler: no ticket stapled (expected for unsigned / un-notarized builds)";
const ST_UNAVAILABLE = "  stapler: xcrun stapler unavailable";
const VERDICT_0 =
  "VERDICT: release-ready (exit 0) — Developer ID signed, Gatekeeper accepted, ticket stapled.";
const VERDICT_2 = "VERDICT: signed but NOT release-ready (exit 2) — see the failing check(s) above.";
const VERDICT_3 =
  "VERDICT: UNSIGNED / adhoc dev build (exit 3) — this is what 'npm run dist' produces.";
const REPORT_LINE = "(--report: exiting 0 regardless of the verdict above)";
const USAGE = "usage: verify-macos-signing.sh [--report] [path-to.app]";
const DEFAULT_REL = "release/mac-arm64/lawbar.app";
const NOT_FOUND = (p) =>
  `verify: bundle not found: ${p}  (run 'npm run dist' or 'npm run dist:release' first)`;

const AUTHORITY_DEVID =
  "Identifier=io.lawbar.desktop\n" +
  "Authority=Developer ID Application: SENTINEL-ORG (SENTINEL-TEAMID-A)\n" +
  "TeamIdentifier=SENTINEL-TEAMID-A\n";
const SIGNATURE_ADHOC = "Identifier=io.lawbar.desktop\nSignature=adhoc\n";

/**
 * Stub set for one verify run. Every tool's exit status and output are independently
 * configurable — only a stub can decouple the two, which is precisely why the
 * "status inferred from output" confusion (finding 8) is plausible in real code.
 */
function toolStubs({
  dvRc = 0, dvOut = AUTHORITY_DEVID,
  csRc = 0, csOut = "",
  spRc = 0, spOut = "fixture: accepted\nsource=Notarized Developer ID\n",
  probeRc = 0,
  stapleRc = 0, stapleOut = "The validate action worked!\n",
} = {}) {
  return {
    codesign: {
      exitCode: 0,
      cases: [
        { when: "-dv*", exitCode: dvRc, stdout: dvOut },
        { when: "--verify*", exitCode: csRc, stdout: csOut },
      ],
    },
    spctl: { exitCode: spRc, stdout: spOut },
    xcrun: {
      exitCode: 0,
      cases: [
        { when: "-f*", exitCode: probeRc, stdout: probeRc === 0 ? "/usr/bin/stapler\n" : "" },
        { when: "stapler validate*", exitCode: stapleRc, stdout: stapleOut },
      ],
    },
    stapler: { exitCode: 0 },
  };
}

/** The unsigned/adhoc dev build: every check failing. */
const ADHOC = {
  dvRc: 0, dvOut: SIGNATURE_ADHOC,
  csRc: 1, csOut: "code object is not signed at all\n",
  spRc: 3, spOut: "fixture: rejected\nsource=no usable signature\n",
  probeRc: 0, stapleRc: 1, stapleOut: "Error: The staple and validate action failed!\n",
};

/** Create a structurally valid bundle: both members the post-fix guard requires. */
function makeBundle(dir, name = "fixture.app") {
  const app = path.join(dir, name);
  mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
  writeFileSync(path.join(app, "Contents", "Info.plist"), "<plist/>\n");
  return app;
}

/** Run verify against a fresh case; returns result + log, already cleaned up. */
function verify(args, { stubOpts = {}, omit = [], allowMissing = [], build, cwd } = {}) {
  const k = makeCase({ stubs: toolStubs(stubOpts), omit, allowMissing });
  const built = build ? build(k) : {};
  const r = runScript(VERIFY, args(built, k), k, { cwd: cwd ? cwd(k) : k.root });
  const log = k.log();
  k.cleanup();
  return { ...r, log, out: r.stdout, combined: `${r.stdout}${r.stderr}` };
}

/** The common shape: one structurally valid bundle passed as the sole argument. */
function verifyBundle(stubOpts = {}, extraArgs = [], opts = {}) {
  return verify((b) => [...extraArgs, b.app], {
    stubOpts,
    build: (k) => ({ app: makeBundle(k.root) }),
    ...opts,
  });
}

const sectionBetween = (out, from, to) => {
  const ls = lines(out);
  const a = ls.indexOf(from);
  // Search for the closing anchor AFTER the opening one. Without the offset, a `to` that
  // also occurs earlier in the output (a blank line, say) resolved to that earlier index,
  // making the slice empty and every assertion on it vacuously true.
  const b = to === null ? ls.length : ls.indexOf(to, a + 1);
  assert.notEqual(a, -1, `missing anchor: ${from}\n${out}`);
  return ls.slice(a + 1, b === -1 ? ls.length : b);
};

// ===========================================================================
// WI-7 — bundle-path guard
//
// cwd is set explicitly in EVERY case. A case inheriting the runner's cwd inside
// apps/lawbar-desktop would find the REAL adhoc bundle and invoke the REAL tools.
// ===========================================================================

test("T7.1 no argument, cwd lacking the default -> exit 1 naming the default relative path", () => {
  const r = verify(() => [], {});
  assert.equal(r.status, 1, r.combined);
  // Exact line equality, including the TWO spaces before '(run': the spacing is part
  // of the emitted contract and a reflow would change it silently.
  assert.ok(lines(r.out).includes(NOT_FOUND(DEFAULT_REL)), JSON.stringify(r.out));
});

test("T7.2 no argument, cwd containing the default -> guard passes and codesign gets that exact relative path", () => {
  const r = verify(() => [], {
    build: (k) => {
      mkdirSync(path.join(k.root, "release", "mac-arm64"), { recursive: true });
      return { app: makeBundle(path.join(k.root, "release", "mac-arm64"), "lawbar.app") };
    },
  });
  assert.equal(r.status, 0, r.combined);
  assert.ok(r.out.includes(`== bundle: ${DEFAULT_REL} ==`), r.out);
  // Pins both halves of the default: its VALUE and its cwd-RELATIVITY. The header
  // alone would not prove the tools received the same string.
  assert.deepEqual(r.log[0].argv, ["-dv", "--verbose=2", DEFAULT_REL]);
});

test("T7.3 an explicit non-existent path is named instead of the default", () => {
  const r = verify((b, k) => [path.join(k.root, "nope.app")], {});
  assert.equal(r.status, 1, r.combined);
  assert.ok(r.out.includes("nope.app"), r.out);
  // The absence assertion proves $1 overrode the default rather than being ignored.
  assert.ok(!r.out.includes("release/mac-arm64"), r.out);
});

test("T7.4 a path that exists but is a regular file fails the guard, and no tool runs", () => {
  const r = verify((b) => [b.app], {
    build: (k) => {
      const p = path.join(k.root, "notadir.app");
      writeFileSync(p, "");
      return { app: p };
    },
  });
  assert.equal(r.status, 1, r.combined);
  assert.ok(r.out.includes("bundle not found"), r.out);
  assert.deepEqual(r.log, []);
});

test("T7.5 [REGRESSION] an empty *.app directory is rejected, not reported on", () => {
  // Finding 5. Pre-fix `-d` alone accepted this and the script then ran all four
  // tools against a directory that is not a bundle, producing a plausible report
  // about nothing.
  const r = verify((b) => [b.app], {
    build: (k) => {
      const p = path.join(k.root, "empty.app");
      mkdirSync(p);
      return { app: p };
    },
  });
  assert.equal(r.status, 1, r.combined);
  assert.ok(r.out.includes("not an app bundle (no Contents/Info.plist)"), r.out);
  assert.deepEqual(r.log, [], "no tool may run once the guard has fired");
});

test("T7.6 [REGRESSION] a validly structured bundle NOT named .app is accepted", () => {
  // The .app suffix is deliberately never examined: the name is a convention, the
  // structure is the thing. Rejecting a valid bundle for its name would add a failure
  // mode without adding safety. What DID change is the verdict — pre-fix this exited
  // 0 while reporting an adhoc signature; now it exits 3.
  const r = verify((b) => [b.app], {
    stubOpts: ADHOC,
    build: (k) => ({ app: makeBundle(k.root, "plain-directory") }),
  });
  assert.ok(r.out.includes("== bundle: "), r.out);
  assert.ok(r.out.includes("plain-directory =="), r.out);
  assert.equal(r.status, 3, r.combined);
});

test("T7.7 when the guard fails, none of codesign, spctl or xcrun is invoked", () => {
  // The stubs are configured to SUCCEED loudly: if the guard were removed the run
  // would exit 0 with plausible output, and only the log would reveal it.
  const r = verify((b, k) => [path.join(k.root, "missing.app")], {});
  assert.equal(r.status, 1, r.combined);
  assert.deepEqual(r.log, []);
});

test("T7.8 a bundle path containing a space is passed to codesign as a single argument", () => {
  const r = verify((b) => [b.app], {
    build: (k) => ({ app: makeBundle(k.root, "my bundle.app") }),
  });
  assert.equal(r.status, 0, r.combined);
  assert.ok(r.out.includes("my bundle.app =="), r.out);
  const dv = r.log[0];
  // Element COUNT is the sharp assertion: a value check alone could pass on a
  // partial match. Unquoting any of the four "$APP" sites is a classic silent shell
  // regression that no output assertion would catch.
  assert.equal(dv.argv.length, 3, JSON.stringify(dv.argv));
  assert.ok(dv.argv[2].endsWith("my bundle.app"), JSON.stringify(dv.argv));
});

test("T7.9 a symlink pointing at a structurally valid bundle is accepted under its link name", () => {
  const r = verify((b) => [b.app], {
    build: (k) => {
      const target = makeBundle(k.root, "target-bundle");
      const link = path.join(k.root, "link.app");
      symlinkSync(target, link);
      return { app: link };
    },
  });
  assert.equal(r.status, 0, r.combined);
  // The header names the LINK, pinning that $APP is never canonicalised.
  assert.ok(r.out.includes("link.app =="), r.out);
  assert.ok(!r.out.includes("target-bundle =="), r.out);
});

test("T7.10 [REGRESSION] Contents/Info.plist present but Contents/MacOS missing -> exit 1 naming it", () => {
  const r = verify((b) => [b.app], {
    build: (k) => {
      const p = path.join(k.root, "half.app");
      mkdirSync(path.join(p, "Contents"), { recursive: true });
      writeFileSync(path.join(p, "Contents", "Info.plist"), "<plist/>\n");
      return { app: p };
    },
  });
  assert.equal(r.status, 1, r.combined);
  // Each structural member is checked separately and the message says WHICH one is
  // missing — a single combined "not a bundle" would leave the maintainer guessing.
  assert.ok(r.out.includes("not an app bundle (no Contents/MacOS)"), r.out);
  assert.ok(!r.out.includes("no Contents/Info.plist"), r.out);
  assert.deepEqual(r.log, []);
});

test("T7.11 [REGRESSION] an unknown option exits 1 with the usage line, and no tool runs", () => {
  const r = verify(() => ["--bogus"], {});
  assert.equal(r.status, 1, r.combined);
  // Pre-fix there was no argument parsing at all: `--bogus` became the bundle path
  // and the message was "bundle not found: --bogus".
  assert.ok(lines(r.out).includes("verify: unknown option: --bogus"), r.out);
  assert.ok(lines(r.out).includes(USAGE), r.out);
  assert.ok(!r.out.includes("bundle not found"), r.out);
  assert.deepEqual(r.log, []);
});

// ===========================================================================
// WI-8 — honest reporting and the exit contract
// ===========================================================================

test("T8.1 codesign --verify exit 0 -> 'codesign verify: OK', and never FAILED", () => {
  const r = verifyBundle();
  assert.equal(r.status, 0, r.combined);
  assert.ok(lines(r.out).includes(CS_OK), r.out);
  // Absence is required: both strings are literals in the script, so a broken
  // conditional could emit both.
  assert.ok(!r.out.includes("codesign verify: FAILED"), r.out);
});

test("T8.2 codesign --verify non-zero with output -> FAILED, output echoed with a two-space indent, exit 2", () => {
  const detail = "test-executable failed to satisfy specified code requirement(s)";
  const r = verifyBundle({ csRc: 1, csOut: `${detail}\n` });
  assert.ok(lines(r.out).includes(CS_FAILED), r.out);
  assert.ok(!r.out.includes("codesign verify: OK"), r.out);
  // Pins the `indent` helper's real `sed 's/^/  /'` pass-through.
  assert.ok(lines(r.out).includes(`  ${detail}`), JSON.stringify(r.out));
  // Pre-fix every run exited 0. The status is the contract now.
  assert.equal(r.status, 2, r.combined);
});

test("T8.3 non-zero with EMPTY output still reports FAILED and emits no blank detail block", () => {
  const r = verifyBundle({ csRc: 1, csOut: "" });
  const between = sectionBetween(r.out, HDR_VERIFY, CS_FAILED);
  // `indent` suppresses only the echoed DETAIL, never the verdict. A restructure that
  // printed the verdict inside the "has output" guard would report nothing at all here.
  assert.deepEqual(between.filter((l) => l !== ""), [], JSON.stringify(between));
  assert.ok(lines(r.out).includes(CS_FAILED), r.out);
  assert.equal(r.status, 2, r.combined);
});

test("T8.4 the verdict follows cs_rc, not the presence of output", () => {
  // Paired with T8.2 (non-zero WITH output -> FAILED) and T8.3 (non-zero WITHOUT
  // output -> FAILED), this triple isolates cs_rc as the sole determinant and rules
  // out "has output" as a proxy.
  const r = verifyBundle({ csRc: 0, csOut: "SENTINEL-NOISE-ON-SUCCESS\n" });
  assert.ok(lines(r.out).includes(CS_OK), r.out);
  assert.ok(lines(r.out).includes("  SENTINEL-NOISE-ON-SUCCESS"), r.out);
  assert.equal(r.status, 0, r.combined);
});

test("T8.5 spctl output passes through indented, a rejected verdict appears verbatim, and argv is exact", () => {
  const r = verifyBundle({ spRc: 3, spOut: "fixture: rejected\nsource=no usable signature\n" });
  assert.ok(lines(r.out).includes("  fixture: rejected"), r.out);
  assert.ok(lines(r.out).includes("  source=no usable signature"), r.out);
  assert.ok(lines(r.out).includes(SP_REJECTED), r.out);
  assert.ok(!r.out.includes(SP_ACCEPTED), r.out);
  const sp = r.log.find((rec) => rec.name === "spctl");
  // `-t exec` selects the execution-policy assessment; `-t install` would answer a
  // different question and still print something plausible.
  assert.deepEqual(sp.argv.slice(0, 4), ["-a", "-vv", "-t", "exec"]);
  assert.equal(sp.argv.length, 5);
  assert.equal(r.status, 2, r.combined);
});

test("T8.6 a non-zero spctl does not abort the run", () => {
  const r = verifyBundle({ spRc: 3, spOut: "fixture: rejected\n" });
  const ls = lines(r.out);
  // `set -e` would abort at the failing spctl and silently truncate the report — the
  // most likely well-intentioned change to this script, and one that would make it
  // STOP reporting the failure it exists to surface.
  assert.ok(ls.indexOf(HDR_STAPLER) > ls.indexOf(HDR_SPCTL), r.out);
  assert.equal(countOccurrences(r.out, "VERDICT: "), 1, r.out);
});

test("T8.7 [REGRESSION] probe resolves and validate succeeds -> 'ticket stapled', probed with `xcrun -f stapler`", () => {
  const r = verifyBundle({ probeRc: 0, stapleRc: 0 });
  assert.ok(lines(r.out).includes(ST_STAPLED), r.out);
  assert.ok(!r.out.includes("no ticket stapled"), r.out);
  // Finding 6: the probe now tests the binary the body actually runs. Pre-fix the
  // condition was `command -v stapler || xcrun stapler --help`, which accepted a
  // standalone `stapler` and then ran `xcrun stapler` regardless.
  assert.deepEqual(
    r.log.filter((rec) => rec.name === "xcrun").map((rec) => rec.argv),
    [["-f", "stapler"], ["stapler", "validate", r.log[0].argv[2]]],
  );
  assert.equal(r.log.filter((rec) => rec.name === "stapler").length, 0);
});

test("T8.8 [REGRESSION] probe resolves and validate fails -> 'no ticket stapled', status read from the tool", () => {
  const r = verifyBundle({ probeRc: 0, stapleRc: 1, stapleOut: "Error: could not validate\n" });
  // Finding 8: pre-fix this line was unreachable. `xcrun stapler validate | sed` hands
  // back sed's status, which is always 0, so the `|| echo` fallback was dead code and
  // a failing validate printed no verdict at all.
  assert.ok(lines(r.out).includes(ST_NO_TICKET), r.out);
  // Line equality, not substring: ST_NO_TICKET itself contains "ticket stapled".
  assert.ok(!lines(r.out).includes(ST_STAPLED), r.out);
  assert.ok(lines(r.out).includes("  Error: could not validate"), r.out);
  assert.deepEqual(
    r.log.filter((rec) => rec.name === "xcrun").map((rec) => rec.argv[0]),
    ["-f", "stapler"],
  );
  assert.equal(r.status, 2, r.combined);
});

test("T8.9 [REGRESSION] the probe failing -> 'xcrun stapler unavailable', and validate is never attempted", () => {
  // Reachable ONLY under the isolated PATH (correction C-1): /usr/bin/stapler exists
  // on this host, so under a merely-prepended PATH the pre-fix `command -v stapler`
  // disjunct always succeeded and this branch was dead.
  const r = verify((b) => [b.app], {
    stubOpts: { probeRc: 1 },
    omit: ["stapler"],
    allowMissing: ["stapler"],
    build: (k) => ({ app: makeBundle(k.root) }),
  });
  assert.ok(lines(r.out).includes(ST_UNAVAILABLE), r.out);
  assert.ok(!r.out.includes("no ticket stapled"), r.out);
  assert.ok(!r.out.includes(ST_STAPLED), r.out);
  // Exactly one xcrun record, and it is the probe: validate was never attempted.
  assert.deepEqual(
    r.log.filter((rec) => rec.name === "xcrun").map((rec) => rec.argv),
    [["-f", "stapler"]],
  );
  // st_rc is forced to 127, so the run cannot reach verdict 0.
  assert.equal(r.status, 2, r.combined);
});

test("T8.10 a successful validate prints its output and suppresses the failure line", () => {
  const r = verifyBundle({ stapleRc: 0, stapleOut: "The validate action worked!\n" });
  assert.equal(r.status, 0, r.combined);
  assert.ok(lines(r.out).includes("  The validate action worked!"), r.out);
  assert.ok(!r.out.includes("no ticket stapled"), r.out);
});

test("T8.11 [REGRESSION] exactly one VERDICT: line is printed, and the Interpretation: block is gone", () => {
  const r = verifyBundle(ADHOC);
  assert.equal(countOccurrences(r.out, "VERDICT: "), 1, r.out);
  // The two static Interpretation: lines were replaced by a computed verdict. They
  // told the reader how to interpret output the script had already assessed.
  assert.ok(!r.out.includes("Interpretation:"), r.out);
});

test("T8.12 [REGRESSION] a fully-failing adhoc bundle exits 3 while reporting every failure", () => {
  // Finding 1, highest severity. Pre-fix this exited 0: the script's TEXT was honest,
  // its exit STATUS was not, so `npm run verify:signing && ship` was silently vacuous.
  const r = verifyBundle(ADHOC);
  assert.equal(r.status, 3, r.combined);
  assert.ok(r.out.includes("Signature=adhoc"), r.out);
  assert.ok(lines(r.out).includes(CS_FAILED), r.out);
  assert.ok(lines(r.out).includes(SP_REJECTED), r.out);
  assert.ok(lines(r.out).includes(ST_NO_TICKET), r.out);
  assert.ok(lines(r.out).includes(VERDICT_3), r.out);
});

test("T8.13 two identical runs produce byte-identical output and the same exit code", () => {
  const k = makeCase({ stubs: toolStubs(ADHOC) });
  const app = makeBundle(k.root);
  const one = runScript(VERIFY, [app], k, { env: { LAWBAR_STUB_LOG: path.join(k.root, "l1") } });
  const two = runScript(VERIFY, [app], k, { env: { LAWBAR_STUB_LOG: path.join(k.root, "l2") } });
  assert.equal(one.stdout, two.stdout);
  assert.equal(one.stderr, two.stderr);
  assert.equal(one.status, two.status);
  k.cleanup();
});

test("T8.14 [REGRESSION] Developer ID authority + all three tools green -> exit 0 and VERDICT: release-ready", () => {
  const r = verifyBundle();
  assert.equal(r.status, 0, r.combined);
  assert.ok(lines(r.out).includes(VERDICT_0), r.out);
  assert.ok(lines(r.out).includes(CS_OK), r.out);
  assert.ok(lines(r.out).includes(SP_ACCEPTED), r.out);
  assert.ok(lines(r.out).includes(ST_STAPLED), r.out);
});

test("T8.15 [REGRESSION] Developer ID + verify OK + Gatekeeper accepted + NO stapled ticket -> exit 2", () => {
  const r = verifyBundle({ stapleRc: 1, stapleOut: "Error: no ticket\n" });
  assert.equal(r.status, 2, r.combined);
  assert.ok(lines(r.out).includes(VERDICT_2), r.out);
  assert.ok(lines(r.out).includes(ST_NO_TICKET), r.out);
});

test("T8.16 [REGRESSION] Developer ID authority present but Gatekeeper rejects -> exit 2", () => {
  const r = verifyBundle({ spRc: 3, spOut: "fixture: rejected\n" });
  assert.equal(r.status, 2, r.combined);
  assert.ok(lines(r.out).includes(VERDICT_2), r.out);
  assert.ok(lines(r.out).includes(SP_REJECTED), r.out);
});

test("T8.17 [REGRESSION] --report on a fully-failing bundle exits 0 but still prints verdict 3", () => {
  const r = verifyBundle(ADHOC, ["--report"]);
  assert.equal(r.status, 0, r.combined);
  assert.ok(lines(r.out).includes(REPORT_LINE), r.out);
  // Report mode must never HIDE the verdict, only stop it being fatal.
  assert.ok(lines(r.out).includes(VERDICT_3), r.out);
  assert.ok(lines(r.out).includes(CS_FAILED), r.out);
});

test("T8.18 --report on a missing bundle still exits 1", () => {
  const r = verify((b, k) => ["--report", path.join(k.root, "gone.app")], {});
  // Report mode suppresses verdicts 2 and 3. It does not suppress usage/path errors:
  // "nothing was assessed" is not a diagnosis.
  assert.equal(r.status, 1, r.combined);
  assert.ok(r.out.includes("bundle not found"), r.out);
  assert.ok(!r.out.includes(REPORT_LINE), r.out);
  assert.deepEqual(r.log, []);
});

test("T8.19 [REGRESSION] codesign -dv exiting non-zero while printing NOTHING still reaches verdict 3", () => {
  // The anti-regression for finding 8. Pre-fix `codesign -dv … | sed` discarded the
  // tool's status entirely, so a completely silent failure was indistinguishable from
  // success. The status is read from the command, never inferred from its output.
  const r = verifyBundle({ dvRc: 1, dvOut: "", csRc: 1, csOut: "" });
  assert.equal(r.status, 3, r.combined);
  assert.ok(lines(r.out).includes(VERDICT_3), r.out);
  // The section holds the derived `authority:` verdict line — every section prints raw
  // tool output followed by its own verdict line — but NO echoed tool output, because
  // the tool printed none. Asserting the section is entirely empty would be wrong now,
  // and until the `sectionBetween` offset bug was fixed this assertion was vacuous:
  // the slice was always [] regardless of what the script printed.
  const between = sectionBetween(r.out, HDR_DV, "");
  const echoed = between.filter((l) => !l.startsWith("  authority: "));
  assert.deepEqual(echoed, [], `no tool output should be echoed: ${JSON.stringify(between)}`);
  assert.equal(between.length, 1, JSON.stringify(between));
});

// ===========================================================================
// WI-12 — argument parsing
// ===========================================================================

test("T12.1 --report is recognised BEFORE the bundle path", () => {
  const r = verifyBundle(ADHOC, ["--report"]);
  assert.equal(r.status, 0, r.combined);
  assert.ok(lines(r.out).includes(REPORT_LINE), r.out);
  assert.ok(r.out.includes("fixture.app =="), r.out);
});

test("T12.2 --report is recognised AFTER the bundle path", () => {
  const r = verify((b) => [b.app, "--report"], {
    stubOpts: ADHOC,
    build: (k) => ({ app: makeBundle(k.root) }),
  });
  assert.equal(r.status, 0, r.combined);
  assert.ok(lines(r.out).includes(REPORT_LINE), r.out);
  assert.ok(r.out.includes("fixture.app =="), r.out);
});

test("T12.3 an unrecognised -* token exits 1 with the message and the usage line", () => {
  for (const bad of ["-x", "--verbose", "-"]) {
    const r = verify(() => [bad], {});
    assert.equal(r.status, 1, `${bad}: ${r.combined}`);
    assert.ok(lines(r.out).includes(`verify: unknown option: ${bad}`), `${bad}: ${r.out}`);
    assert.ok(lines(r.out).includes(USAGE), `${bad}: ${r.out}`);
  }
});

test("T12.4 a bare invocation uses the cwd-relative default path", () => {
  const r = verify(() => [], {
    stubOpts: ADHOC,
    build: (k) => {
      mkdirSync(path.join(k.root, "release", "mac-arm64"), { recursive: true });
      return { app: makeBundle(path.join(k.root, "release", "mac-arm64"), "lawbar.app") };
    },
  });
  assert.equal(r.status, 3, r.combined);
  assert.ok(r.out.includes(`== bundle: ${DEFAULT_REL} ==`), r.out);
});

test("T12.5 with two non-flag tokens the LAST one wins", () => {
  // CONTRADICTION WITH THE ADDENDUM, pinned deliberately. The addendum's WI-12 text
  // says "the first non-flag token is the bundle path". The script's parser is
  // `*) APP="$arg"` inside a `for arg in "$@"` loop, so each non-flag token
  // OVERWRITES the previous one and the LAST wins. This test asserts what the script
  // does; changing it to first-wins is a script change, not a test change.
  const r = verify((b) => [b.decoy, b.app], {
    build: (k) => ({ decoy: makeBundle(k.root, "decoy.app"), app: makeBundle(k.root, "chosen.app") }),
  });
  assert.equal(r.status, 0, r.combined);
  assert.ok(r.out.includes("chosen.app =="), r.out);
  assert.ok(!r.out.includes("decoy.app =="), r.out);
});

// ===========================================================================
// WI-10 fold-in — the two npm entry points must stay distinct
//
// The gate and the diagnostic are separate named intents. If `verify:signing` ever
// carried --report, the gate would be silently disarmed again — the exact defect
// class the exit contract exists to close.
// ===========================================================================

test("T12.6 verify:signing is the gate and verify:signing:report is the diagnostic", () => {
  const manifest = JSON.parse(readFileSync(path.join(PKG_DIR, "package.json"), "utf8"));
  assert.equal(manifest.scripts["verify:signing"], "bash scripts/verify-macos-signing.sh");
  assert.equal(
    manifest.scripts["verify:signing:report"],
    "bash scripts/verify-macos-signing.sh --report",
  );
  assert.ok(!manifest.scripts["verify:signing"].includes("--report"));
});

// ---------------------------------------------------------------------------
// T8.20 — added 2026-08-13 after mutation testing. Mutant M18 (replace the
// `Authority=Developer ID Application:` probe with an unconditional `devid=1`)
// SURVIVED the whole 93-case suite. Every existing green-path case already had
// Developer ID authority, so nothing forced the check to exist: the script could
// stop distinguishing "Developer ID signed" from "signed by anything at all" and
// no test would object. That check is what makes exit 0 mean release-ready.
// ---------------------------------------------------------------------------

/** Validly signed, NOT adhoc, but by a non-Developer-ID authority. */
const AUTHORITY_NOT_DEVID =
  "Identifier=io.lawbar.desktop\n" +
  "Authority=Apple Development: SENTINEL-ORG (SENTINEL-TEAMID-A)\n" +
  "TeamIdentifier=SENTINEL-TEAMID-A\n";

test("T8.20 signed by a non-Developer-ID authority with all three tools green -> exit 2, never 0", () => {
  // deep-strict passes, Gatekeeper accepts, the ticket validates. The ONLY thing
  // standing between this and a "release-ready" verdict is the authority check.
  const r = verifyBundle({ dvOut: AUTHORITY_NOT_DEVID });
  assert.equal(r.status, 2, r.combined);
  assert.ok(lines(r.out).includes(VERDICT_2), r.out);
  // And it must not be misreported as the unsigned/adhoc case either — this bundle
  // genuinely carries a signature, so verdict 3 would be its own wrong answer.
  assert.notEqual(r.status, 3, r.combined);
});

// ---------------------------------------------------------------------------
// T8.21 / T8.22 — added 2026-08-13 after review findings C-2 / M-1. The header
// documents exit 1 as "usage / bundle-path / tooling error — nothing was assessed",
// but only the path guard ever exited 1. An absent `codesign` produced exit 3,
// telling a machine with no Command Line Tools that its release build was an adhoc
// dev build; an absent `spctl` produced exit 2. Both are evidence about the
// TOOLCHAIN being reported as evidence about the BUNDLE.
// ---------------------------------------------------------------------------

test("T8.21 codesign absent from PATH is a tooling error (exit 1), not an unsigned-build verdict", () => {
  const r = verify((b) => [b.app], {
    omit: ["codesign"],
    allowMissing: ["codesign"],
    build: (k) => ({ app: makeBundle(k.root) }),
  });
  assert.equal(r.status, 1, r.combined);
  assert.match(r.out, /verify: codesign unavailable \(exit 127\)/, r.out);
  // It must NOT reach a verdict about the bundle: nothing was assessed.
  assert.ok(!r.out.includes("VERDICT:"), r.out);
});

test("T8.22 spctl absent from PATH is a tooling error (exit 1), not a not-release-ready verdict", () => {
  const r = verify((b) => [b.app], {
    omit: ["spctl"],
    allowMissing: ["spctl"],
    build: (k) => ({ app: makeBundle(k.root) }),
  });
  assert.equal(r.status, 1, r.combined);
  assert.match(r.out, /verify: spctl unavailable \(exit 127\)/, r.out);
  assert.ok(!r.out.includes("VERDICT:"), r.out);
});

// T8.23 — review finding C-1. The authority check is a verdict input like the three
// tools, so it must report its own line. Previously a bundle failing ONLY on authority
// printed three successes and then pointed at a failing section that did not exist.
test("T8.23 the authority check reports its own line, so verdict 2 always names a failing check", () => {
  const r = verifyBundle({ dvOut: AUTHORITY_NOT_DEVID });
  assert.equal(r.status, 2, r.combined);
  assert.ok(
    lines(r.out).includes(
      "  authority: NOT Developer ID (a release build requires a Developer ID Application certificate)",
    ),
    r.out,
  );
  // The three tool checks all passed here, so without the authority line the report
  // would contain no failing check at all.
  assert.ok(lines(r.out).includes(CS_OK), r.out);
  assert.ok(lines(r.out).includes(SP_ACCEPTED), r.out);
  assert.ok(lines(r.out).includes(ST_STAPLED), r.out);
});

test("T8.24 a release-ready bundle reports authority: Developer ID Application", () => {
  const r = verifyBundle();
  assert.equal(r.status, 0, r.combined);
  assert.ok(lines(r.out).includes("  authority: Developer ID Application"), r.out);
});
