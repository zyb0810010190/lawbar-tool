// verify-macos-signing.real-bundle.test.mjs — WI-9. The real-path counterpart to the
// stubbed WI-8 cases: the real script, the real /usr/bin/codesign, the real spctl and
// the real xcrun, against the real adhoc bundle at release/mac-arm64/lawbar.app.
//
// ===========================================================================
// THIS FILE IS DELIBERATELY **not registered in scripts.test**, and is therefore
// **not part of the push gate**. That exclusion is a decision, not an oversight.
//
// WHY: real `spctl -a` and real `xcrun stapler validate` may perform an ONLINE
// notarization lookup on some macOS versions. Registering this file would put an
// Apple network round-trip inside every `npm test`, which collides with the standing
// no-network constraint on the gate. A file that is deliberately unregistered is
// indistinguishable from one that was forgotten unless it says so — this repo already
// carries three files in exactly that ambiguous state, so this block exists to keep
// this one out of it.
//
// HOW TO RUN IT (opt-in, requires LAWBAR_SIGNING_REAL_BUNDLE=1 AND a built bundle):
//   npm run dist
//   LAWBAR_SIGNING_REAL_BUNDLE=1 node --test tests/verify-macos-signing.real-bundle.test.mjs
//
// Without the flag, or without the bundle, every case SKIPS with a loud reason. The
// skip decision itself is `skipReason()` in _release-script-harness.mjs and is covered
// by T9.1 in the REGISTERED lane, so this logic is never dark even when this file
// never runs.
// ===========================================================================
//
// NEVER ASSERTS anything that would require a Developer ID certificate or a real
// notarization ticket. Only the FAILURE direction is verifiable here; the success
// direction has no real-path test and cannot have one under the standing constraints.
//
// TWO-SIDED: T9.4 is a regression test. Against the preserved pre-fix copy the same
// real run exits 0; against the current script it exits 3.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { VERIFY, PKG_DIR, REAL_BUNDLE_REL, runRealScript, skipReason, lines } from "./_release-script-harness.mjs";

const CS_FAILED = "  codesign verify: FAILED (adhoc/unsigned builds fail deep-strict verify)";
const HDR_SPCTL = "-- spctl -a -vv -t exec (Gatekeeper assessment) --";
const HDR_STAPLER = "-- stapler validate (notarization ticket stapled?) --";
const REPORT_LINE = "(--report: exiting 0 regardless of the verdict above)";

const why = () => {
  const r = skipReason(process.env, (p) => existsSync(path.join(PKG_DIR, p)));
  // A `{ fail }` verdict means the caller opted in and there is nothing to verify.
  // Throw rather than skip, so an opted-in run cannot report success on no evidence.
  if (r && typeof r === "object" && r.fail) throw new Error(r.fail);
  return r;
};

let GATE_RUN = null;
/** One real run, shared by T9.2–T9.4: real spctl may be slow and may hit the network. */
function gateRun() {
  if (!GATE_RUN) GATE_RUN = runRealScript(VERIFY, [], { cwd: PKG_DIR });
  return GATE_RUN;
}


// T-6 (review, 2026-08-13): NEVER pass the raw report as an assertion message. On failure
// node prints it, and on a genuinely signed bundle it carries `Authority=Developer ID
// Application: <org> (<team>)` and `TeamIdentifier=`. This repo has a documented history of
// real identifiers reaching pushed history, so the failure path is redacted to the derived
// verdict lines the assertions are actually about.
const redact = (out) =>
  lines(out)
    .filter((l) => /^(  (codesign verify|spctl|stapler|authority):|VERDICT: |\(--report)/.test(l))
    .join("\n") || "(no verdict lines emitted)";

test("T9.2 the real script with real tools reports 'codesign verify: FAILED' on the real adhoc bundle", (t) => {
  const reason = why();
  if (reason) return t.skip(reason);
  const r = gateRun();
  // The only evidence in the suite that the stubbed cs_rc characterisation matches
  // what Apple's codesign actually does on a real adhoc bundle.
  assert.ok(lines(r.stdout).includes(CS_FAILED), redact(r.stdout));
  assert.ok(!r.stdout.includes("codesign verify: OK"), redact(r.stdout));
});

test("T9.3 real spctl returns a non-accepted Gatekeeper verdict for the adhoc bundle", (t) => {
  const reason = why();
  if (reason) return t.skip(reason);
  const r = gateRun();
  const ls = lines(r.stdout);
  const a = ls.indexOf(HDR_SPCTL);
  const b = ls.indexOf(HDR_STAPLER);
  assert.ok(a !== -1 && b > a, `spctl section not found:\n${redact(r.stdout)}`);
  const section = ls.slice(a + 1, b).join("\n");
  // Phrased as "not accepted" rather than "equals rejected": spctl's exact wording
  // varies across macOS releases, and over-specifying it would produce a test that
  // fails on an OS upgrade rather than on a real regression.
  assert.ok(!section.includes("accepted"), section);
  assert.ok(/rejected|source=/.test(section), section);
});

test("T9.4 [REGRESSION] the real run exits 3, not 0", (t) => {
  const reason = why();
  if (reason) return t.skip(reason);
  const r = gateRun();
  // Finding 1 on the real host with the real tools. Pre-fix this exited 0 while the
  // report enumerated every failure, which is what made `verify:signing && ship`
  // silently vacuous. If this and the stubbed T8.12 ever disagree, the stub set has
  // drifted from reality and the whole WI-8 block is suspect.
  assert.equal(r.status, 3, redact(r.stdout));
  assert.ok(lines(r.stdout).includes(CS_FAILED), redact(r.stdout));
});

test("T9.5 --report against the same real bundle exits 0 while still printing the verdict", (t) => {
  const reason = why();
  if (reason) return t.skip(reason);
  const r = runRealScript(VERIFY, ["--report"], { cwd: PKG_DIR });
  assert.equal(r.status, 0, redact(r.stdout));
  assert.ok(lines(r.stdout).includes(REPORT_LINE), redact(r.stdout));
  assert.ok(r.stdout.includes("VERDICT: "), redact(r.stdout));
});
