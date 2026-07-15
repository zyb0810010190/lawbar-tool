// Tests for refresh-internal-lock-integrity.mjs. All against TEMP fixtures — never the real
// package-lock.json or real tarballs (WI-INTERNAL-PACKAGE-LOCK-REFRESH constraint 7).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  INTERNAL_PACKAGES,
  sha512b64,
  evaluate,
  refresh,
  resolveTarget,
} from "./refresh-internal-lock-integrity.mjs";

const NAMES = INTERNAL_PACKAGES.map((p) => p.name);

// Build a temp fixture: dist-tarballs/<name>-0.1.0.tgz with given bytes + a lockfileVersion-3
// package-lock.json. `integrityOverride[name]` sets a (stale) integrity; otherwise current.
function makeFixture({ bytes = {}, integrityOverride = {}, lockExtra = {}, entryExtra = {}, lockText } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockrefresh-"));
  const tarballDir = path.join(dir, "dist-tarballs");
  fs.mkdirSync(tarballDir, { recursive: true });
  const packages = { "": { name: "lawbar-desktop" }, ...lockExtra };
  for (const p of INTERNAL_PACKAGES) {
    const b = Buffer.from(bytes[p.name] ?? `tarball-bytes-${p.name}-v1`);
    fs.writeFileSync(path.join(tarballDir, `${p.name}-${p.version}.tgz`), b);
    packages[`node_modules/${p.name}`] = {
      version: p.version,
      resolved: `file:dist-tarballs/${p.name}-${p.version}.tgz`,
      integrity: integrityOverride[p.name] ?? sha512b64(b),
      ...(entryExtra[p.name] ?? {}),
    };
  }
  const lock = { name: "lawbar-desktop", version: "0.1.0", lockfileVersion: 3, requires: true, packages };
  const lockPath = path.join(dir, "package-lock.json");
  fs.writeFileSync(lockPath, lockText ?? JSON.stringify(lock, null, 2) + "\n");
  return { dir, lockPath, tarballDir, lock };
}

test("evaluate: both records already current → no stale", () => {
  const { lockPath, tarballDir } = makeFixture();
  const { results } = evaluate({ lockPath, tarballDir });
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => !r.stale));
});

test("refresh: one stale record → updates ONLY that record", () => {
  const { lockPath, tarballDir } = makeFixture({ integrityOverride: { "case-box-contract": "sha512-STALEwrongvalue==" } });
  const before = fs.readFileSync(lockPath, "utf8");
  const { changed } = refresh({ lockPath, tarballDir });
  assert.deepEqual(changed, ["case-box-contract"]);
  const after = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  // contract refreshed to the real SRI; persistence untouched.
  const b = fs.readFileSync(path.join(tarballDir, "case-box-contract-0.1.0.tgz"));
  assert.equal(after.packages["node_modules/case-box-contract"].integrity, sha512b64(b));
  const beforeJson = JSON.parse(before);
  assert.equal(after.packages["node_modules/case-box-persistence"].integrity, beforeJson.packages["node_modules/case-box-persistence"].integrity);
});

test("refresh: both stale → updates both", () => {
  const { lockPath, tarballDir } = makeFixture({ integrityOverride: { "case-box-contract": "sha512-a==", "case-box-persistence": "sha512-b==" } });
  const { changed } = refresh({ lockPath, tarballDir });
  assert.deepEqual(changed.sort(), NAMES.slice().sort());
});

test("refresh: idempotent — a second refresh changes nothing", () => {
  const { lockPath, tarballDir } = makeFixture({ integrityOverride: { "case-box-contract": "sha512-x==" } });
  refresh({ lockPath, tarballDir });
  const mid = fs.readFileSync(lockPath, "utf8");
  const { changed } = refresh({ lockPath, tarballDir });
  assert.deepEqual(changed, []);
  assert.equal(fs.readFileSync(lockPath, "utf8"), mid, "second refresh is a byte-identical no-op");
});

test("refresh: tarball bytes changed while name/version unchanged → integrity refreshed", () => {
  const { lockPath, tarballDir } = makeFixture();
  // mutate the tarball bytes AFTER the lock was written with the old integrity → now stale.
  fs.writeFileSync(path.join(tarballDir, "case-box-contract-0.1.0.tgz"), Buffer.from("NEW-bytes-same-name-version"));
  const { results } = evaluate({ lockPath, tarballDir });
  assert.ok(results.find((r) => r.name === "case-box-contract").stale);
  const { changed } = refresh({ lockPath, tarballDir });
  assert.deepEqual(changed, ["case-box-contract"]);
});

test("refresh: unrelated lockfile records remain byte-and-semantically unchanged", () => {
  const unrelated = { "node_modules/some-dep": { version: "1.2.3", resolved: "https://x/some-dep-1.2.3.tgz", integrity: "sha512-UNRELATED==" } };
  const { lockPath, tarballDir } = makeFixture({ integrityOverride: { "case-box-contract": "sha512-stale==" }, lockExtra: unrelated });
  refresh({ lockPath, tarballDir });
  const after = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  assert.deepEqual(after.packages["node_modules/some-dep"], unrelated["node_modules/some-dep"], "unrelated dep untouched");
});

test("fail-closed: missing tarball throws", () => {
  const { lockPath, tarballDir } = makeFixture();
  fs.rmSync(path.join(tarballDir, "case-box-contract-0.1.0.tgz"));
  assert.throws(() => evaluate({ lockPath, tarballDir }), /tarball missing/);
});

test("fail-closed: missing lock entry throws", () => {
  const { lockPath, tarballDir } = makeFixture();
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  delete lock.packages["node_modules/case-box-persistence"];
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
  assert.throws(() => evaluate({ lockPath, tarballDir }), /expected exactly one .* lock entry, found 0/);
});

test("fail-closed: duplicate/nested lock entry throws", () => {
  const nested = { "node_modules/other/node_modules/case-box-contract": { version: "0.1.0", integrity: "sha512-dup==" } };
  const { lockPath, tarballDir } = makeFixture({ lockExtra: nested });
  assert.throws(() => evaluate({ lockPath, tarballDir }), /unexpected additional lock entries/);
});

test("fail-closed: malformed entry (non-sha512 integrity) throws", () => {
  const { lockPath, tarballDir } = makeFixture({ integrityOverride: { "case-box-contract": "md5-nope" } });
  assert.throws(() => evaluate({ lockPath, tarballDir }), /no sha512 integrity/);
});

test("fail-closed: unexpected resolved path throws", () => {
  const { lockPath, tarballDir } = makeFixture({ entryExtra: { "case-box-contract": { resolved: "https://registry.npmjs.org/case-box-contract/-/evil.tgz" } } });
  assert.throws(() => evaluate({ lockPath, tarballDir }), /'resolved' .* != expected/);
});

test("fail-closed: a same-suffix REMOTE resolved URL is rejected (exact match, not endsWith)", () => {
  // A crafted URL ending in the expected tarball suffix must NOT pass — the guard is exact.
  const { lockPath, tarballDir } = makeFixture({ entryExtra: { "case-box-contract": { resolved: "https://evil.example/dist-tarballs/case-box-contract-0.1.0.tgz" } } });
  assert.throws(() => evaluate({ lockPath, tarballDir }), /'resolved' .* != expected/);
});

test("fail-closed: version mismatch throws", () => {
  const { lockPath, tarballDir } = makeFixture({ entryExtra: { "case-box-contract": { version: "9.9.9" } } });
  assert.throws(() => evaluate({ lockPath, tarballDir }), /lock version 9\.9\.9 != expected/);
});

test("fail-closed: path traversal in a crafted package name is rejected", () => {
  const { lockPath, tarballDir } = makeFixture();
  const { json } = { json: JSON.parse(fs.readFileSync(lockPath, "utf8")) };
  assert.throws(
    () => resolveTarget({ name: "../../etc/evil", version: "0.1.0" }, { tarballDir, lock: json }),
    /escapes the approved dir|tarball missing/,
  );
});

test("fail-closed: malformed lockfile JSON throws", () => {
  const { lockPath, tarballDir } = makeFixture({ lockText: "{ not valid json" });
  assert.throws(() => evaluate({ lockPath, tarballDir }), /not valid JSON/);
});

test("fail-closed: unsupported lockfileVersion throws", () => {
  const { lockPath, tarballDir, lock } = makeFixture();
  lock.lockfileVersion = 2;
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
  assert.throws(() => evaluate({ lockPath, tarballDir }), /unsupported lockfileVersion 2/);
});

test("fail-closed: non-canonical formatting refuses to write", () => {
  // 4-space indent lock: round-trip guard must refuse to write (would reformat).
  const { lockPath, tarballDir, lock } = makeFixture({ integrityOverride: { "case-box-contract": "sha512-stale==" } });
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 4) + "\n");
  assert.throws(() => refresh({ lockPath, tarballDir }), /formatting is not canonical/);
});

test("formatting: refreshed lock keeps 2-space indent + trailing newline", () => {
  const { lockPath, tarballDir } = makeFixture({ integrityOverride: { "case-box-contract": "sha512-stale==" } });
  refresh({ lockPath, tarballDir });
  const text = fs.readFileSync(lockPath, "utf8");
  assert.ok(text.endsWith("}\n"), "trailing newline preserved");
  assert.ok(text.includes('\n  "name"'), "2-space indent preserved");
});

test("lock keys use forward slashes (npm cross-platform convention)", () => {
  // The tool hardcodes `node_modules/<name>` with a forward slash, matching npm lock keys on
  // every OS (Windows lockfiles also use forward slashes) — path.sep is never used for lock keys.
  const { lockPath, tarballDir } = makeFixture();
  const { results } = evaluate({ lockPath, tarballDir });
  assert.ok(results.every((r) => r.lockKey.startsWith("node_modules/") && !r.lockKey.includes("\\")));
});
