// The OCR helper boundary, one rule per test (product plan R3, WI-12 step 2).
//
// src/ocr/helper.ts makes three claims: it runs only the executable it was given, it kills the
// helper's whole process group at the deadline, and it believes nothing a helper says until three
// digests agree — the pin this build was made with, the bytes of the executable it resolved, and
// the digest the helper reports about itself. Each claim is exercised here with a FAKE helper — a
// shell script standing in for lawbar-ocr — so that the failure of each rule is provoked, not
// assumed. The last test then runs the REAL staged helper and proves the honest case.
//
// PATH is empty when the helper runs. The fakes therefore use only shell builtins and absolute
// paths, which is the same constraint the real helper lives under.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { probeHelper, readPinnedDigest, resolveHelperPath, runHelper, sha256OfFile } from "../dist/src/ocr/helper.js";
import { ocrProbeHandler, OCR_CHANNEL } from "../dist/src/ocr/ocrHandlers.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAGED_HELPER = path.join(projectRoot, "build", "helpers", "lawbar-ocr");
const PIN_FILE = path.join(projectRoot, "dist", "src", "ocr", "helper-pin.json");

function scratch(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lawbar-ocr-unit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const PROBE_TAIL = '"helper_version":"fake","os_version":"0","os_build":"0","arch":"fake","vision_languages":["zh-Hans"]}';

/** A fake helper that reports its OWN digest honestly: the digest is read from a sidecar written after the script exists. */
function honestFake(dir, name = "honest") {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\nread d < "$0.digest"\nprintf '{"kind":"probe","helper_build_digest":"%s",${PROBE_TAIL}\\n' "$d"\n`);
  chmodSync(file, 0o755);
  writeFileSync(`${file}.digest`, `${sha256OfFile(file)}\n`);
  return file;
}

/** A fake helper that reports SOMEONE ELSE's digest — an impostor answering as the bundled binary. */
function impostorFake(dir, claimedDigest) {
  const file = path.join(dir, "impostor");
  writeFileSync(file, `#!/bin/sh\nprintf '{"kind":"probe","helper_build_digest":"${claimedDigest}",${PROBE_TAIL}\\n'\n`);
  chmodSync(file, 0o755);
  return file;
}

/** deps whose pin is the file's own bytes — the honest configuration. */
const pinned = (file, extra = {}) => ({ helperPath: file, pinnedDigest: sha256OfFile(file), timeoutMs: 5000, ...extra });

test("resolveHelperPath: packaged resolves ONLY inside the bundle's Resources; development resolves the staged build", () => {
  assert.equal(
    resolveHelperPath({ isPackaged: true, resourcesPath: "/Applications/lawbar.app/Contents/Resources", appPath: "/somewhere/else" }),
    "/Applications/lawbar.app/Contents/Resources/helpers/lawbar-ocr",
  );
  assert.equal(
    resolveHelperPath({ isPackaged: false, resourcesPath: "/should/not/be/used", appPath: "/repo/apps/lawbar-desktop" }),
    "/repo/apps/lawbar-desktop/build/helpers/lawbar-ocr",
  );
});

test("readPinnedDigest: a well-formed pin is read; a missing, malformed, or non-hex pin is null", (t) => {
  const dir = scratch(t);
  const good = path.join(dir, "good.json");
  writeFileSync(good, JSON.stringify({ sha256: "a".repeat(64), size: 1 }));
  assert.equal(readPinnedDigest(good), "a".repeat(64));
  assert.equal(readPinnedDigest(path.join(dir, "absent.json")), null);
  const bad = path.join(dir, "bad.json");
  writeFileSync(bad, "{not json");
  assert.equal(readPinnedDigest(bad), null);
  const short = path.join(dir, "short.json");
  writeFileSync(short, JSON.stringify({ sha256: "abc" }));
  assert.equal(readPinnedDigest(short), null);
  const upper = path.join(dir, "upper.json");
  writeFileSync(upper, JSON.stringify({ sha256: "A".repeat(64) }));
  assert.equal(readPinnedDigest(upper), null, "digests are lower-case hex; anything else is not a pin");
});

test("an honest helper is believed: pin, executable bytes, and self-report agree", async (t) => {
  const file = honestFake(scratch(t));
  const r = await probeHelper(pinned(file));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.executable_digest, sha256OfFile(file));
  assert.equal(r.probe.helper_build_digest, r.executable_digest);
  assert.deepEqual(r.probe.vision_languages, ["zh-Hans"]);
  assert.equal(r.probe.roundtrip_ms, null, "no round-trip field → null, never undefined");
});

test("a helper this build did not ship is helper_stale and is NEVER RUN; no pin at all is helper_unpinned", async (t) => {
  const dir = scratch(t);
  const file = path.join(dir, "marker");
  const ran = path.join(dir, "ran");
  writeFileSync(file, `#!/bin/sh\n: > "${ran}"\nread d < "$0.digest"\nprintf '{"kind":"probe","helper_build_digest":"%s",${PROBE_TAIL}\\n' "$d"\n`);
  chmodSync(file, 0o755);
  writeFileSync(`${file}.digest`, `${sha256OfFile(file)}\n`);
  // Sanity: with its own pin it runs and is believed (the marker proves execution).
  assert.equal((await probeHelper(pinned(file))).ok, true);
  assert.ok(existsSync(ran), "the honest run must leave its marker");
  rmSync(ran);

  const stale = await probeHelper({ helperPath: file, pinnedDigest: "0".repeat(64), timeoutMs: 5000 });
  assert.equal(stale.code, "helper_stale");
  assert.equal(existsSync(ran), false, "a stale helper must be refused BEFORE it runs");

  const unpinned = await probeHelper({ helperPath: file, pinnedDigest: null, timeoutMs: 5000 });
  assert.equal(unpinned.code, "helper_unpinned");
  assert.equal(existsSync(ran), false, "an unpinned build must not run the helper");
});

test("an impostor is refused: a helper whose bytes are pinned but whose self-report is another binary's digest is helper_identity_mismatch", async (t) => {
  const dir = scratch(t);
  const honest = honestFake(dir);
  const impostor = impostorFake(dir, sha256OfFile(honest)); // claims to be the honest one
  // The pin is the impostor's own bytes, so the pin passes; only the self-report can catch it.
  const r = await probeHelper(pinned(impostor));
  assert.equal(r.ok, false);
  assert.equal(r.code, "helper_identity_mismatch");
});

test("a symlink at the helper path is not the helper (helper_missing), wherever it points", async (t) => {
  const dir = scratch(t);
  const honest = honestFake(dir);
  const link = path.join(dir, "link");
  symlinkSync(honest, link);
  const r = await probeHelper({ helperPath: link, pinnedDigest: sha256OfFile(honest), timeoutMs: 5000 });
  assert.equal(r.code, "helper_missing", "a symlink must be refused even when it points at the pinned bytes");
});

test("a helper that ignores SIGTERM and leaves a child behind is killed with its whole process group at the deadline", async (t) => {
  const dir = scratch(t);
  const file = path.join(dir, "hang");
  const childPidFile = path.join(dir, "child.pid");
  // trap '' TERM is inherited by the child across exec, so SIGTERM alone would leave BOTH alive;
  // the child also holds the stdout pipe, so `close` cannot fire until the child is dead.
  writeFileSync(file, `#!/bin/sh\ntrap '' TERM\n/bin/sleep 30 &\necho $! > "${childPidFile}"\nwait\n`);
  chmodSync(file, 0o755);
  // The deadline is generous on purpose: under a loaded machine (the full lane runs Electron
  // suites alongside this file) a shell can take over half a second just to start, and a deadline
  // that fires before the child exists measures the machine, not the kill. The bound below is
  // still one third of the child's sleep.
  const t0 = Date.now();
  const r = await probeHelper(pinned(file, { timeoutMs: 4000, killGraceMs: 300 }));
  const took = Date.now() - t0;
  assert.equal(r.ok, false);
  assert.equal(r.code, "helper_timeout");
  assert.ok(took < 10_000, `deadline was not enforced: took ${took} ms`);
  assert.ok(existsSync(childPidFile), "the fake must have started its child before the deadline");
  const childPid = Number(readFileSync(childPidFile, "utf8").trim());
  assert.ok(Number.isInteger(childPid) && childPid > 1, `bad child pid ${childPid}`);
  // The child was alive at spawn (it wrote its pid). It must be gone now — not in a moment, now.
  let alive = true;
  try { process.kill(childPid, 0); } catch (e) { alive = e.code !== "ESRCH"; }
  assert.equal(alive, false, `SURVIVOR: the helper's child ${childPid} outlived the deadline`);
});

test("a descendant that ESCAPES the process group and holds the pipe cannot hold main past the deadline", async (t) => {
  const dir = scratch(t);
  const file = path.join(dir, "escape");
  const orphanPidFile = path.join(dir, "orphan.pid");
  // The grandchild makes its own session (setsid), so the group kill cannot reach it, and it
  // inherits stdout, so `close` cannot fire while it lives. The helper itself exits at once.
  writeFileSync(file, `#!/bin/sh\n/usr/bin/python3 -c 'import os,time,sys\nos.setsid()\nopen(sys.argv[1],"w").write(str(os.getpid()))\ntime.sleep(30)' "${orphanPidFile}" &\nexit 0\n`);
  chmodSync(file, 0o755);
  const t0 = Date.now();
  const r = await probeHelper(pinned(file, { timeoutMs: 4000, killGraceMs: 300 }));
  const took = Date.now() - t0;
  // Hygiene first: the orphan is ours to reap, whatever the assertions say.
  if (existsSync(orphanPidFile)) { try { process.kill(Number(readFileSync(orphanPidFile, "utf8")), "SIGKILL"); } catch {} }
  assert.equal(r.code, "helper_timeout", JSON.stringify(r));
  assert.ok(took < 10_000, `main was held by an escaped descendant: took ${took} ms`);
});

test("a helper that floods stdout is stopped at the cap and refused as helper_bad_output, well before the deadline", async (t) => {
  const dir = scratch(t);
  const file = path.join(dir, "flood");
  writeFileSync(file, "#!/bin/sh\nexec /usr/bin/yes\n");
  chmodSync(file, 0o755);
  const t0 = Date.now();
  const r = await probeHelper(pinned(file, { timeoutMs: 20_000 }));
  const took = Date.now() - t0;
  assert.equal(r.code, "helper_bad_output");
  assert.ok(took < 15_000, `the flood was read until the deadline: took ${took} ms`);
});

test("output that is not exactly one probe record is helper_bad_output; a non-zero exit is helper_exit; missing, unreadable and non-executable are named", async (t) => {
  const dir = scratch(t);
  const mk = (name, body, mode = 0o755) => { const f = path.join(dir, name); writeFileSync(f, body); chmodSync(f, mode); return f; };
  const junk = mk("junk", "#!/bin/sh\nprintf 'not json\\n'\n");
  assert.equal((await probeHelper(pinned(junk))).code, "helper_bad_output");

  const wrongKind = mk("wrongkind", `#!/bin/sh\nprintf '{"kind":"page","helper_build_digest":"${"0".repeat(64)}",${PROBE_TAIL}\\n'\n`);
  assert.equal((await probeHelper(pinned(wrongKind))).code, "helper_bad_output");

  // Two records, the first of them honest: still refused — the protocol is one line.
  const two = mk("two", `#!/bin/sh\nread d < "$0.digest"\nprintf '{"kind":"probe","helper_build_digest":"%s",${PROBE_TAIL}\\n' "$d"\nprintf '{"kind":"probe","helper_build_digest":"${"0".repeat(64)}",${PROBE_TAIL}\\n'\n`);
  writeFileSync(`${two}.digest`, `${sha256OfFile(two)}\n`);
  assert.equal((await probeHelper(pinned(two))).code, "helper_bad_output");

  const failing = mk("failing", "#!/bin/sh\nexit 5\n");
  assert.equal((await probeHelper(pinned(failing))).code, "helper_exit");

  assert.equal((await probeHelper({ helperPath: path.join(dir, "nope"), pinnedDigest: "0".repeat(64), timeoutMs: 5000 })).code, "helper_missing");
  assert.equal((await probeHelper({ helperPath: dir, pinnedDigest: "0".repeat(64), timeoutMs: 5000 })).code, "helper_missing", "a directory is not a helper");

  const notExec = mk("notexec", "#!/bin/sh\n", 0o644);
  assert.equal((await probeHelper({ helperPath: notExec, pinnedDigest: "0".repeat(64), timeoutMs: 5000 })).code, "helper_not_executable");

  // Execute-only: runnable but not hashable. A code, not the filesystem's error text.
  const execOnly = mk("execonly", "#!/bin/sh\n", 0o111);
  const r = await probeHelper({ helperPath: execOnly, pinnedDigest: "0".repeat(64), timeoutMs: 5000 });
  assert.equal(r.code, process.getuid?.() === 0 ? "helper_stale" : "helper_unreadable");
});

test("runHelper: a spawn that fails asynchronously is reported as a field, not thrown into main as an unhandled error", async (t) => {
  const dir = scratch(t);
  const out = await runHelper({ helperPath: path.join(dir, "absent"), pinnedDigest: null, timeoutMs: 5000 }, []);
  assert.equal(out.spawnFailed, true);
  assert.equal(out.stdout, "");
  // Give the event loop a turn: an unhandled `error` would surface here and kill the test process.
  await new Promise((r) => setTimeout(r, 50));
});

test("runHelper hands the helper an EMPTY PATH, and decodes multi-byte output as one stream", async (t) => {
  const dir = scratch(t);
  const file = path.join(dir, "path");
  writeFileSync(file, '#!/bin/sh\nprintf "[%s]\\n" "$PATH"\nprintf "合同\\n"\n');
  chmodSync(file, 0o755);
  const out = await runHelper({ helperPath: file, pinnedDigest: null, timeoutMs: 5000 }, []);
  assert.equal(out.exitCode, 0);
  assert.deepEqual(out.stdout.split("\n"), ["[]", "合同", ""]);
});

test("ocr:probe accepts ONLY an absent payload (null included is refused) before touching the helper, and projects only the documented fields", async (t) => {
  const file = honestFake(scratch(t));
  assert.equal(OCR_CHANNEL.probe, "ocr:probe");
  for (const payload of [null, {}, "", 0, [], { roundtrip: true }]) {
    const r = await ocrProbeHandler(payload, { helperPath: "/does/not/exist", pinnedDigest: null });
    assert.deepEqual(r, { ok: false, code: "invalid_request" }, `payload ${JSON.stringify(payload)} must be refused without running anything`);
  }
  const ok = await ocrProbeHandler(undefined, pinned(file));
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual(Object.keys(ok.value).sort(), [
    "arch", "elapsed_ms", "executable_digest", "helper_build_digest", "helper_version",
    "os_build", "os_version", "pinned_digest", "roundtrip_ms", "roundtrip_text", "vision_languages",
  ]);
  assert.equal(ok.value.executable_digest, sha256OfFile(file));
  assert.equal(ok.value.pinned_digest, ok.value.executable_digest);
  const missing = await ocrProbeHandler(undefined, { helperPath: path.join(path.dirname(file), "absent"), pinnedDigest: "0".repeat(64) });
  assert.deepEqual(missing, { ok: false, code: "helper_missing" });
  const unpinned = await ocrProbeHandler(undefined, { helperPath: file, pinnedDigest: null });
  assert.deepEqual(unpinned, { ok: false, code: "helper_unpinned" });
});

test("the REAL staged helper: universal, pinned by the build, proves its identity, and reads Simplified Chinese offline", async () => {
  assert.ok(existsSync(STAGED_HELPER), `staged helper missing at ${STAGED_HELPER}; npm run build:helper stages it (pretest does)`);
  const pin = readPinnedDigest(PIN_FILE);
  assert.ok(pin !== null, `pin missing or malformed at ${PIN_FILE}`);
  assert.equal(pin, sha256OfFile(STAGED_HELPER), "the pin must be the staged helper's bytes");
  const lipo = spawnSync("/usr/bin/lipo", ["-archs", STAGED_HELPER], { encoding: "utf8" });
  assert.equal(lipo.status, 0, lipo.stderr);
  assert.deepEqual(lipo.stdout.trim().split(/\s+/).sort(), ["arm64", "x86_64"], "the staged helper must be universal");

  const r = await probeHelper({ helperPath: STAGED_HELPER, pinnedDigest: pin, timeoutMs: 15_000 }, { roundtrip: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.executable_digest, pin);
  assert.equal(r.probe.helper_build_digest, pin, "the helper's self-digest must be the bytes on disk");
  assert.ok(r.probe.vision_languages.includes("zh-Hans"), `Vision must offer zh-Hans; got ${r.probe.vision_languages.join(",")}`);
  assert.equal(typeof r.probe.roundtrip_ms, "number");
  // The helper renders 合同 and reads it back. Exact, not "non-empty": a wrong-language model that
  // returns something would otherwise count as Chinese OCR.
  assert.equal(r.probe.roundtrip_text?.replace(/\s+/g, ""), "合同");
  assert.match(r.probe.os_build, /^\d+[A-Z]\d+/, "os_build must be a Darwin build string");
});
