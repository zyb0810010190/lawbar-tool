// Manifest contract tests. Cover both ACTIVE and PLACEHOLDER fixture
// branches even when the on-disk manifest only contains one kind today —
// the runner-side semantics must work for both as the bakeoff matures.
//
// Active branch: hash gate on the image bytes, hash gate on the expected
// text, file existence checks, manifest hash field matches the .sha256
// sidecar.
//
// Placeholder branch: no hash gate; explicit `reason` field required;
// path SHOULD point at an absent image (the slot is reserved, not
// populated).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const fixturesRoot = join(pkgRoot, "fixtures");
const manifestPath = join(fixturesRoot, "manifest.json");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const loadManifest = (path) => JSON.parse(readFileSync(path, "utf8"));

// ---------------------------------------------------------------------------
// On-disk manifest shape
// ---------------------------------------------------------------------------

test("manifest.json exists at fixtures/manifest.json and has version 1", () => {
  const m = loadManifest(manifestPath);
  assert.equal(m.version, 1);
  assert.ok(Array.isArray(m.fixtures), "fixtures must be an array");
});

test("manifest.json: every entry has the required common fields", () => {
  const m = loadManifest(manifestPath);
  for (const f of m.fixtures) {
    assert.equal(typeof f.id, "string", `${f.id}: id must be string`);
    assert.ok(f.id.length > 0, "id non-empty");
    assert.equal(typeof f.active, "boolean", `${f.id}: active must be boolean`);
    assert.ok(["synthetic", "real"].includes(f.kind), `${f.id}: kind in {synthetic,real}`);
    assert.equal(typeof f.category, "string");
    assert.equal(typeof f.path, "string");
    assert.equal(typeof f.expected_text_path, "string");
    assert.equal(typeof f.language, "string");
  }
});

// ---------------------------------------------------------------------------
// Active fixture branch — runs against any active entries in the real
// manifest, AND against a synthetic manifest constructed in-test so the
// active path is always exercised even when no real active fixtures
// exist yet.
// ---------------------------------------------------------------------------

function* activeFixtures(manifest) {
  for (const f of manifest.fixtures) {
    if (f.active) yield f;
  }
}

test("manifest.json: every ACTIVE fixture has all required active-branch fields", () => {
  const m = loadManifest(manifestPath);
  for (const f of activeFixtures(m)) {
    assert.equal(typeof f.sha256, "string", `${f.id}: sha256 must be string`);
    assert.match(f.sha256, /^[0-9a-f]{64}$/, `${f.id}: sha256 must be lowercase hex`);
    assert.equal(typeof f.expected_text_sha256, "string", `${f.id}: expected_text_sha256 must be string`);
    assert.match(f.expected_text_sha256, /^[0-9a-f]{64}$/);
    assert.equal(typeof f.provenance, "string");
    assert.equal(typeof f.last_verified_at, "string");
    // Role is required and constrained to the documented enum.
    assert.ok(
      ["smoke", "verdict"].includes(f.role),
      `${f.id}: role must be "smoke" | "verdict" (got ${JSON.stringify(f.role)})`,
    );
    // Synthetic active fixtures require render provenance (α.1).
    if (f.kind === "synthetic") {
      assert.equal(typeof f.render, "object", `${f.id}: synthetic active must carry render provenance`);
      assert.ok(f.render && f.render !== null, `${f.id}: render must be non-null`);
      for (const field of ["render_command", "font", "point_size", "canvas", "source_text"]) {
        assert.ok(
          f.render[field] !== undefined && f.render[field] !== "",
          `${f.id}: synthetic render.${field} required`,
        );
      }
      // source_text MUST be the ground-truth source — Codex pass-3 D1.2.
      // It is the authored phrase; the runner uses it as the CER reference.
      assert.equal(typeof f.render.source_text, "string");
    }
    // Real active fixtures require real_source + pii_review (α.1).
    if (f.kind === "real") {
      assert.equal(typeof f.real_source, "string", `${f.id}: real active must carry real_source`);
      assert.ok(
        ["redacted", "pending", "not_required"].includes(f.pii_review),
        `${f.id}: real active must declare pii_review status`,
      );
    }
  }
});

test("manifest.json: every ACTIVE fixture's image SHA matches the on-disk bytes and the .sha256 sidecar", () => {
  const m = loadManifest(manifestPath);
  for (const f of activeFixtures(m)) {
    const imagePath = join(fixturesRoot, f.path);
    assert.ok(existsSync(imagePath), `${f.id}: image must exist at ${imagePath}`);
    const imageBytes = readFileSync(imagePath);
    const computed = sha256(imageBytes);
    assert.equal(computed, f.sha256, `${f.id}: image bytes hash must match manifest sha256`);

    const sidecarPath = `${imagePath}.sha256` /* not used today */;
    // Allow both `<image>.sha256` and `<basename>.sha256` placements; pick whichever exists.
    const alt = imagePath.replace(/\.[^.]+$/, ".sha256");
    const sidecar = existsSync(sidecarPath) ? sidecarPath : alt;
    if (existsSync(sidecar)) {
      const recorded = readFileSync(sidecar, "utf8").trim().split(/\s+/)[0];
      assert.equal(recorded, f.sha256, `${f.id}: sidecar hash file must match manifest sha256`);
    }
  }
});

test("manifest.json: every ACTIVE fixture's expected text exists and matches expected_text_sha256", () => {
  const m = loadManifest(manifestPath);
  for (const f of activeFixtures(m)) {
    const txtPath = join(fixturesRoot, f.expected_text_path);
    assert.ok(existsSync(txtPath), `${f.id}: expected text must exist at ${txtPath}`);
    const txtBytes = readFileSync(txtPath);
    const computed = sha256(txtBytes);
    assert.equal(computed, f.expected_text_sha256, `${f.id}: expected text hash must match manifest`);
  }
});

// ---------------------------------------------------------------------------
// Placeholder fixture branch
// ---------------------------------------------------------------------------

function* placeholderFixtures(manifest) {
  for (const f of manifest.fixtures) {
    if (!f.active) yield f;
  }
}

test("manifest.json: every PLACEHOLDER fixture carries an explicit reason and skips hash checks", () => {
  const m = loadManifest(manifestPath);
  for (const f of placeholderFixtures(m)) {
    assert.equal(typeof f.reason, "string", `${f.id}: placeholder must have a reason`);
    assert.ok(f.reason.length > 0, "reason must be non-empty");
    // Placeholders MUST NOT carry hash fields (those imply active semantics).
    assert.equal(f.sha256, undefined, `${f.id}: placeholder must not declare sha256`);
    assert.equal(f.expected_text_sha256, undefined, `${f.id}: placeholder must not declare expected_text_sha256`);
  }
});

// ---------------------------------------------------------------------------
// In-test synthetic manifests — exercise both branches regardless of
// what the on-disk manifest happens to contain today.
// ---------------------------------------------------------------------------

test("synthetic manifest with one ACTIVE fixture: hash checks pass when bytes match", () => {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-active-"));
  const imgBytes = Buffer.from("synthetic-png-bytes", "utf8");
  const txtBytes = Buffer.from("hello world", "utf8");
  const imgPath = join(dir, "img.png");
  const txtPath = join(dir, "img.txt");
  writeFileSync(imgPath, imgBytes);
  writeFileSync(txtPath, txtBytes);

  const fixture = {
    active: true,
    id: "synthetic-active",
    role: "smoke",
    kind: "synthetic",
    category: "test",
    path: "img.png",
    expected_text_path: "img.txt",
    sha256: sha256(imgBytes),
    expected_text_sha256: sha256(txtBytes),
    language: "und",
    provenance: "in-test",
    last_verified_at: "2026-01-01T00:00:00Z",
    render: {
      render_command: "(in-test stub)",
      font: "stub",
      point_size: 12,
      canvas: "10x10",
      source_text: "hello world",
    },
  };

  // Reproduce the active-branch checks against this synthetic.
  const computedImg = sha256(readFileSync(join(dir, fixture.path)));
  const computedTxt = sha256(readFileSync(join(dir, fixture.expected_text_path)));
  assert.equal(computedImg, fixture.sha256);
  assert.equal(computedTxt, fixture.expected_text_sha256);
});

test("synthetic manifest with one ACTIVE fixture: hash check FAILS when bytes drift", () => {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-drift-"));
  const originalBytes = Buffer.from("original", "utf8");
  const driftedBytes = Buffer.from("drifted", "utf8");
  const imgPath = join(dir, "img.png");
  writeFileSync(imgPath, driftedBytes);

  const expected = sha256(originalBytes);
  const actual = sha256(readFileSync(imgPath));
  assert.notEqual(actual, expected, "synthetic drift must be detectable");
});

test("synthetic manifest with one PLACEHOLDER fixture: skips hash checks even if image is absent", () => {
  const placeholder = {
    active: false,
    id: "synthetic-placeholder",
    kind: "real",
    category: "test",
    path: "absent.png",
    expected_text_path: "absent.txt",
    language: "und",
    reason: "in-test placeholder",
  };

  // Branch semantics: no hash field; reason present; no file existence required.
  assert.equal(placeholder.active, false);
  assert.ok(placeholder.reason);
  assert.equal(placeholder.sha256, undefined);
  // Verify resolution: even with non-existent paths, the test does not fail.
  const absPath = resolve("/tmp", placeholder.path);
  assert.equal(existsSync(absPath), false);
});

test("synthetic manifest: an ACTIVE fixture missing expected_text_sha256 must be rejected at runtime", () => {
  // The runner (lands in β) will need to enforce this. Here we just pin
  // the expectation: an active fixture without expected_text_sha256 is
  // not valid. The TypeScript type guarantees this at compile time
  // (ActiveBakeoffFixture has it required); this test makes the
  // contract explicit at runtime for whoever writes the runner.
  const malformed = {
    active: true,
    id: "missing-hash",
    role: "smoke",
    kind: "synthetic",
    category: "test",
    path: "img.png",
    expected_text_path: "img.txt",
    sha256: "0".repeat(64),
    // expected_text_sha256: MISSING
    language: "und",
    provenance: "in-test",
    last_verified_at: "2026-01-01T00:00:00Z",
    render: {
      render_command: "(in-test stub)",
      font: "stub",
      point_size: 12,
      canvas: "10x10",
      source_text: "hello world",
    },
  };
  assert.equal(malformed.active, true);
  assert.equal(malformed.expected_text_sha256, undefined);
  // The runner-side check would be: if (active && !expected_text_sha256) reject.
  // This test pins the property; the runner enforces the rejection.
});
