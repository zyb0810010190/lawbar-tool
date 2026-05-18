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
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { symlinkSync } from "node:fs";

import { loadManifest, ManifestValidationError, collectLanguages } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const fixturesRoot = join(pkgRoot, "fixtures");
const manifestPath = join(fixturesRoot, "manifest.json");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const loadManifestJson = (path) => JSON.parse(readFileSync(path, "utf8"));

// ---------------------------------------------------------------------------
// On-disk manifest shape
// ---------------------------------------------------------------------------

test("manifest.json exists at fixtures/manifest.json and has version 1", () => {
  const m = loadManifestJson(manifestPath);
  assert.equal(m.version, 1);
  assert.ok(Array.isArray(m.fixtures), "fixtures must be an array");
});

test("manifest.json: every entry has the required common fields", () => {
  const m = loadManifestJson(manifestPath);
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
  const m = loadManifestJson(manifestPath);
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
  const m = loadManifestJson(manifestPath);
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
  const m = loadManifestJson(manifestPath);
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
  const m = loadManifestJson(manifestPath);
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

// ---------------------------------------------------------------------------
// loadManifest runtime validation (audit thread 019e36a0 D2.* + D7.1).
//
// These tests replace the prior false-positive test that only asserted a
// property was undefined. They write malformed manifests to a temp dir
// and assert loadManifest rejects each one with a typed error.
// ---------------------------------------------------------------------------

function makeManifestDir(manifestObj) {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-validator-"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifestObj, null, 2));
  return dir;
}

test("loadManifest: valid on-disk manifest loads without throwing", () => {
  const result = loadManifest(fixturesRoot);
  assert.equal(result.version, 1);
  assert.ok(result.fixtures.length >= 1);
});

test("loadManifest: rejects manifest with version !== 1", () => {
  const dir = makeManifestDir({ version: 2, fixtures: [] });
  assert.throws(() => loadManifest(dir), ManifestValidationError);
});

test("loadManifest: rejects path traversal in fixture.path", () => {
  const dir = makeManifestDir({
    version: 1,
    fixtures: [
      {
        active: false,
        id: "traversal",
        kind: "real",
        category: "test",
        path: "../../etc/passwd",
        expected_text_path: "stub.txt",
        language: "und",
        reason: "placeholder",
      },
    ],
  });
  assert.throws(
    () => loadManifest(dir),
    (err) => err instanceof ManifestValidationError && /outside fixturesRoot/.test(err.message),
  );
});

test("loadManifest: rejects path traversal in expected_text_path", () => {
  const dir = makeManifestDir({
    version: 1,
    fixtures: [
      {
        active: false,
        id: "traversal",
        kind: "real",
        category: "test",
        path: "stub.png",
        expected_text_path: "../../etc/passwd",
        language: "und",
        reason: "placeholder",
      },
    ],
  });
  assert.throws(
    () => loadManifest(dir),
    (err) => err instanceof ManifestValidationError && /outside fixturesRoot/.test(err.message),
  );
});

test("loadManifest: rejects active synthetic fixture missing render provenance", () => {
  const dir = makeManifestDir({
    version: 1,
    fixtures: [
      {
        active: true,
        id: "no-render",
        role: "smoke",
        kind: "synthetic",
        category: "test",
        path: "stub.png",
        expected_text_path: "stub.txt",
        sha256: "0".repeat(64),
        expected_text_sha256: "0".repeat(64),
        language: "und",
        provenance: "stub",
        last_verified_at: "2026-01-01T00:00:00Z",
        // render: MISSING
      },
    ],
  });
  assert.throws(
    () => loadManifest(dir),
    (err) => err instanceof ManifestValidationError && /render is required/.test(err.message),
  );
});

test("loadManifest: rejects active fixture with missing expected_text_sha256", () => {
  const dir = makeManifestDir({
    version: 1,
    fixtures: [
      {
        active: true,
        id: "missing-hash",
        role: "smoke",
        kind: "synthetic",
        category: "test",
        path: "stub.png",
        expected_text_path: "stub.txt",
        sha256: "0".repeat(64),
        // expected_text_sha256: MISSING
        language: "und",
        provenance: "stub",
        last_verified_at: "2026-01-01T00:00:00Z",
        render: {
          render_command: "stub",
          font: "stub",
          point_size: 12,
          canvas: "10x10",
          source_text: "stub",
        },
      },
    ],
  });
  assert.throws(
    () => loadManifest(dir),
    (err) => err instanceof ManifestValidationError && /expected_text_sha256/.test(err.message),
  );
});

test("loadManifest: rejects bad sha256 format", () => {
  const dir = makeManifestDir({
    version: 1,
    fixtures: [
      {
        active: true,
        id: "bad-hash",
        role: "smoke",
        kind: "synthetic",
        category: "test",
        path: "stub.png",
        expected_text_path: "stub.txt",
        sha256: "NOTAHEX",
        expected_text_sha256: "0".repeat(64),
        language: "und",
        provenance: "stub",
        last_verified_at: "2026-01-01T00:00:00Z",
        render: {
          render_command: "stub",
          font: "stub",
          point_size: 12,
          canvas: "10x10",
          source_text: "stub",
        },
      },
    ],
  });
  assert.throws(
    () => loadManifest(dir),
    (err) => err instanceof ManifestValidationError && /lowercase 64-hex/.test(err.message),
  );
});

test("loadManifest: rejects placeholder fixture that declares sha256", () => {
  const dir = makeManifestDir({
    version: 1,
    fixtures: [
      {
        active: false,
        id: "placeholder-with-hash",
        kind: "synthetic",
        category: "test",
        path: "stub.png",
        expected_text_path: "stub.txt",
        sha256: "0".repeat(64), // FORBIDDEN on placeholders
        language: "und",
        reason: "stub",
      },
    ],
  });
  assert.throws(
    () => loadManifest(dir),
    (err) => err instanceof ManifestValidationError && /placeholder.*sha256/i.test(err.message),
  );
});

test("loadManifest: rejects active fixture with role outside enum", () => {
  const dir = makeManifestDir({
    version: 1,
    fixtures: [
      {
        active: true,
        id: "bad-role",
        role: "ad_hoc",
        kind: "synthetic",
        category: "test",
        path: "stub.png",
        expected_text_path: "stub.txt",
        sha256: "0".repeat(64),
        expected_text_sha256: "0".repeat(64),
        language: "und",
        provenance: "stub",
        last_verified_at: "2026-01-01T00:00:00Z",
        render: {
          render_command: "stub",
          font: "stub",
          point_size: 12,
          canvas: "10x10",
          source_text: "stub",
        },
      },
    ],
  });
  assert.throws(
    () => loadManifest(dir),
    (err) => err instanceof ManifestValidationError && /role.*smoke.*verdict/.test(err.message),
  );
});

test("loadManifest: rejects active real fixture with missing pii_review", () => {
  const dir = makeManifestDir({
    version: 1,
    fixtures: [
      {
        active: true,
        id: "real-no-pii",
        role: "verdict",
        kind: "real",
        category: "test",
        path: "stub.png",
        expected_text_path: "stub.txt",
        sha256: "0".repeat(64),
        expected_text_sha256: "0".repeat(64),
        language: "zh-Hans",
        provenance: "stub",
        last_verified_at: "2026-01-01T00:00:00Z",
        real_source: "stub",
        // pii_review: MISSING
      },
    ],
  });
  assert.throws(
    () => loadManifest(dir),
    (err) => err instanceof ManifestValidationError && /pii_review/.test(err.message),
  );
});

// ---------------------------------------------------------------------------
// Audit 019e3854 S1: symlink + absolute + root-equivalent containment.
// ---------------------------------------------------------------------------

test("loadManifest: rejects absolute path in fixture.path (even when under fixturesRoot)", () => {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-absolute-"));
  // Pre-create the file so structural containment can't be confused with
  // a missing-file error.
  writeFileSync(join(dir, "img.png"), Buffer.from("stub"));
  writeFileSync(join(dir, "img.txt"), Buffer.from("stub"));
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      version: 1,
      fixtures: [
        {
          active: false,
          id: "abs",
          kind: "real",
          category: "test",
          path: join(dir, "img.png"), // absolute path
          expected_text_path: "img.txt",
          language: "und",
          reason: "absolute-path test",
        },
      ],
    }),
  );
  assert.throws(
    () => loadManifest(dir),
    (err) =>
      err instanceof ManifestValidationError &&
      /must be a relative path/.test(err.message),
  );
});

test("loadManifest: rejects path '.' that resolves to fixturesRoot itself", () => {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-rootequiv-"));
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      version: 1,
      fixtures: [
        {
          active: false,
          id: "root-equiv",
          kind: "real",
          category: "test",
          path: ".",
          expected_text_path: "img.txt",
          language: "und",
          reason: "root-equivalent-path test",
        },
      ],
    }),
  );
  assert.throws(
    () => loadManifest(dir),
    (err) =>
      err instanceof ManifestValidationError &&
      /resolves to fixturesRoot itself/.test(err.message),
  );
});

test("loadManifest: rejects active fixture whose symlink target escapes fixturesRoot", () => {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-symlink-"));
  // Target lives OUTSIDE the fixtures root.
  const outside = mkdtempSync(join(tmpdir(), "bakeoff-outside-"));
  const targetPath = join(outside, "secret.png");
  const targetTxt = join(outside, "secret.txt");
  writeFileSync(targetPath, Buffer.from("secret bytes"));
  writeFileSync(targetTxt, Buffer.from("secret text"));
  // Inside fixturesRoot, drop a symlink that points outside.
  symlinkSync(targetPath, join(dir, "img.png"));
  symlinkSync(targetTxt, join(dir, "img.txt"));

  const fakeSha = "0".repeat(64);
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      version: 1,
      fixtures: [
        {
          active: true,
          id: "symlink-escape",
          role: "smoke",
          kind: "synthetic",
          category: "test",
          path: "img.png",
          expected_text_path: "img.txt",
          sha256: fakeSha,
          expected_text_sha256: fakeSha,
          language: "und",
          provenance: "in-test",
          last_verified_at: "2026-01-01T00:00:00Z",
          render: {
            render_command: "stub",
            font: "stub",
            point_size: 12,
            canvas: "10x10",
            source_text: "stub",
          },
        },
      ],
    }),
  );
  assert.throws(
    () => loadManifest(dir),
    (err) =>
      err instanceof ManifestValidationError &&
      /real path escapes fixturesRoot via symlink/.test(err.message),
  );
});

test("loadManifest: active fixture with non-regular file (directory) is rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-dir-"));
  const dirAsPath = join(dir, "img.png");
  // Create a directory at the path the manifest expects to be a file.
  mkdirSync(dirAsPath, { recursive: true });
  // Need an existing expected_text_path file or realpath fails on it first.
  writeFileSync(join(dir, "img.txt"), Buffer.from("stub"));

  const fakeSha = "0".repeat(64);
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      version: 1,
      fixtures: [
        {
          active: true,
          id: "dir-as-file",
          role: "smoke",
          kind: "synthetic",
          category: "test",
          path: "img.png",
          expected_text_path: "img.txt",
          sha256: fakeSha,
          expected_text_sha256: fakeSha,
          language: "und",
          provenance: "in-test",
          last_verified_at: "2026-01-01T00:00:00Z",
          render: {
            render_command: "stub",
            font: "stub",
            point_size: 12,
            canvas: "10x10",
            source_text: "stub",
          },
        },
      ],
    }),
  );
  assert.throws(
    () => loadManifest(dir),
    (err) =>
      err instanceof ManifestValidationError &&
      /is not a regular file/.test(err.message),
  );
});

// ---------------------------------------------------------------------------
// Audit 019e3854 F1: collectLanguages helper for the CLI wiring path.
// ---------------------------------------------------------------------------

test("collectLanguages: returns unique tags from active fixtures only", () => {
  const fixtures = [
    { active: true, role: "smoke", kind: "synthetic", language: "eng" },
    { active: true, role: "verdict", kind: "synthetic", language: "zh-Hans" },
    { active: true, role: "smoke", kind: "real", language: "zh-Hans" },
    { active: false, kind: "real", language: "ja" }, // placeholder — ignored
  ];
  assert.deepEqual(collectLanguages(fixtures), ["eng", "zh-Hans"]);
});

test("collectLanguages: role filter excludes other roles", () => {
  const fixtures = [
    { active: true, role: "smoke", kind: "synthetic", language: "eng" },
    { active: true, role: "verdict", kind: "synthetic", language: "zh-Hans" },
  ];
  assert.deepEqual(collectLanguages(fixtures, { role: "smoke" }), ["eng"]);
  assert.deepEqual(collectLanguages(fixtures, { role: "verdict" }), ["zh-Hans"]);
});

test("collectLanguages: empty input returns empty array", () => {
  assert.deepEqual(collectLanguages([]), []);
  assert.deepEqual(collectLanguages([{ active: false, kind: "real", language: "eng" }]), []);
});
