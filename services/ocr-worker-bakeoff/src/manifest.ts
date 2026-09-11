// Manifest loader + runtime validator + path-containment guard.
//
// Why this exists: bin/bakeoff.mjs reads `fixtures/manifest.json` from disk,
// and runner.ts later joins fixture-supplied paths with `fixturesRoot` to
// read image bytes and expected text. Without runtime validation, an
// adversarial manifest entry such as `"path": "../../etc/passwd"` would
// resolve outside the fixtures tree.
//
// Threat model: the bakeoff is dev tooling, not internet-facing, so the
// trust boundary is "do not let a typo or a tampered checkout accidentally
// read or feed arbitrary files into the engine subprocess." The validator
// is structural + containment-based, not adversarial sandboxing.
//
// Containment guards (audit threads 019e36a0 D2.1-3 + 019e3854 S1):
//   - All fixtures: reject absolute paths; reject paths that lexically
//     resolve to fixturesRoot itself; reject paths that lexically resolve
//     outside fixturesRoot.
//   - Active fixtures: ALSO follow symlinks via realpathSync and reject
//     real paths that escape fixturesRoot. The image and expected-text
//     files MUST exist for active fixtures (the hash gate would have
//     read them anyway), so realpath is well-defined.
//   - Placeholders: lexical check only. The file MAY be absent (slot
//     reserved), so realpath would throw spuriously.

import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

import type {
  BakeoffFixture,
  ActiveBakeoffFixture,
  FixtureMedia,
  FixtureRole,
} from "./types.js";

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestValidationError";
  }
}

export interface LoadedManifest {
  version: 1;
  fixtures: BakeoffFixture[];
}

/**
 * Load and validate the on-disk fixture manifest at `<fixturesRoot>/manifest.json`.
 * Every fixture path is confined to `fixturesRoot`; every active fixture is
 * structurally checked against the contract and realpath-verified.
 *
 * Throws `ManifestValidationError` on any failure, never returns partial data.
 */
export function loadManifest(fixturesRoot: string): LoadedManifest {
  const root = resolve(fixturesRoot);
  const manifestPath = resolve(root, "manifest.json");

  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (err) {
    throw new ManifestValidationError(`failed to read ${manifestPath}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ManifestValidationError(`manifest.json is not valid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ManifestValidationError("manifest.json must be a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new ManifestValidationError(`manifest.version must be 1 (got ${JSON.stringify(obj.version)})`);
  }
  if (!Array.isArray(obj.fixtures)) {
    throw new ManifestValidationError("manifest.fixtures must be an array");
  }

  const validated: BakeoffFixture[] = [];
  for (let i = 0; i < obj.fixtures.length; i++) {
    validated.push(validateFixture(obj.fixtures[i], i, root));
  }

  return { version: 1, fixtures: validated };
}

/**
 * Collect the unique BCP-47 language tags from the given fixtures, optionally
 * filtered by role. The CLI uses this to pre-flight the engine for every
 * language it will be asked to recognize, so a missing model surfaces as a
 * structured `missing_model` ProbeResult instead of a generic runtime exit
 * later. Audit 019e3854 F1.
 */
export function collectLanguages(
  fixtures: readonly BakeoffFixture[],
  opts: { role?: FixtureRole } = {},
): string[] {
  const seen = new Set<string>();
  for (const f of fixtures) {
    if (!f.active) continue;
    if (opts.role !== undefined && f.role !== opts.role) continue;
    seen.add(f.language);
  }
  return [...seen].sort();
}

function validateFixture(raw: unknown, index: number, root: string): BakeoffFixture {
  if (!raw || typeof raw !== "object") {
    throw new ManifestValidationError(`fixtures[${index}] must be an object`);
  }
  const f = raw as Record<string, unknown>;

  const id = expectNonEmptyString(f, "id", index);
  const kind = expectEnum(f, "kind", ["synthetic", "real"], index);
  const category = expectNonEmptyString(f, "category", index);
  const path = expectNonEmptyString(f, "path", index);
  const expected_text_path = expectNonEmptyString(f, "expected_text_path", index);
  const language = expectNonEmptyString(f, "language", index);

  // Lexical containment for every fixture (active + placeholder).
  assertLexicallyContained(root, path, `fixtures[${index}].path`);
  assertLexicallyContained(root, expected_text_path, `fixtures[${index}].expected_text_path`);

  if (f.active === true) {
    const role = expectEnum(f, "role", ["smoke", "verdict", "holdout"], index) as FixtureRole;
    const sha256 = expectHex64(f, "sha256", index);
    const expected_text_sha256 = expectHex64(f, "expected_text_sha256", index);
    const provenance = expectNonEmptyString(f, "provenance", index);
    const last_verified_at = expectNonEmptyString(f, "last_verified_at", index);
    // Media defaults to png (every fixture before the PDF kind), and the file extension must agree
    // with it: a ".pdf" declared as png would be handed to image-only engines as an image.
    const media = (f.media === undefined ? "png" : expectEnum(f, "media", ["png", "pdf"], index)) as FixtureMedia;
    const ext = path.toLowerCase().endsWith(".pdf") ? "pdf" : path.toLowerCase().endsWith(".png") ? "png" : null;
    if (ext !== media) {
      throw new ManifestValidationError(`fixtures[${index}].media is "${media}" but path "${path}" ${ext === null ? "has neither a .png nor a .pdf extension" : `is a .${ext}`}`);
    }
    // A pdf fixture always carries its page (default 1); a png never does.
    let page: number | undefined = media === "pdf" ? 1 : undefined;
    if (f.page !== undefined) {
      if (media !== "pdf") throw new ManifestValidationError(`fixtures[${index}].page is only meaningful for a pdf`);
      if (typeof f.page !== "number" || !Number.isInteger(f.page) || f.page < 1) throw new ManifestValidationError(`fixtures[${index}].page must be a positive integer`);
      page = f.page;
    }

    const base: Omit<ActiveBakeoffFixture, "kind" | "render" | "real_source" | "pii_review"> & { active: true } = {
      active: true,
      id,
      role,
      category,
      path,
      expected_text_path,
      sha256,
      expected_text_sha256,
      dpi: typeof f.dpi === "number" ? f.dpi : undefined,
      language,
      media,
      ...(page !== undefined ? { page } : {}),
      provenance,
      last_verified_at,
      notes: typeof f.notes === "string" ? f.notes : undefined,
    };

    let result: ActiveBakeoffFixture;
    if (kind === "synthetic") {
      const render = f.render;
      if (!render || typeof render !== "object") {
        throw new ManifestValidationError(`fixtures[${index}].render is required for synthetic active fixtures`);
      }
      const r = render as Record<string, unknown>;
      result = {
        ...base,
        kind: "synthetic",
        render: {
          render_command: expectNonEmptyString(r, "render_command", index, "render."),
          font: expectNonEmptyString(r, "font", index, "render."),
          point_size: expectPositiveNumber(r, "point_size", index, "render."),
          canvas: expectNonEmptyString(r, "canvas", index, "render."),
          source_text: expectNonEmptyString(r, "source_text", index, "render."),
          notes: typeof r.notes === "string" ? r.notes : undefined,
        },
      };
    } else {
      // kind === "real"
      const pii = expectEnum(f, "pii_review", ["redacted", "pending", "not_required"], index);
      result = {
        ...base,
        kind: "real",
        real_source: expectNonEmptyString(f, "real_source", index),
        pii_review: pii as "redacted" | "pending" | "not_required",
      };
    }

    // Realpath + regular-file containment is the FINAL gate for active
    // fixtures, after every structural check has passed. Active fixtures
    // MUST have on-disk bytes (the hash gate depends on it), so realpath
    // is well-defined here. Placeholders skip this check because the
    // file may legitimately be absent (slot reserved).
    assertRealContained(root, path, `fixtures[${index}].path`);
    assertRealContained(root, expected_text_path, `fixtures[${index}].expected_text_path`);
    return result;
  }

  if (f.active === false) {
    const reason = expectNonEmptyString(f, "reason", index);
    // Placeholders MUST NOT carry hash fields (implies active semantics).
    if (f.sha256 !== undefined) {
      throw new ManifestValidationError(`fixtures[${index}] is placeholder but declares sha256`);
    }
    if (f.expected_text_sha256 !== undefined) {
      throw new ManifestValidationError(`fixtures[${index}] is placeholder but declares expected_text_sha256`);
    }
    return {
      active: false,
      id,
      kind,
      category,
      path,
      expected_text_path,
      language,
      reason,
      notes: typeof f.notes === "string" ? f.notes : undefined,
    };
  }

  throw new ManifestValidationError(`fixtures[${index}].active must be true | false (got ${JSON.stringify(f.active)})`);
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Lexical containment: candidate must be a relative path that resolves
 * strictly INSIDE root (not equal to root, not outside it). No filesystem
 * access. Applied to every fixture entry.
 */
function assertLexicallyContained(root: string, candidate: string, label: string): void {
  if (isAbsolute(candidate)) {
    throw new ManifestValidationError(
      `${label} ${JSON.stringify(candidate)} must be a relative path (absolute paths forbidden)`,
    );
  }
  const resolved = resolve(root, candidate);
  if (resolved === root) {
    throw new ManifestValidationError(
      `${label} ${JSON.stringify(candidate)} resolves to fixturesRoot itself; it must point at a file inside the root`,
    );
  }
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (!resolved.startsWith(rootWithSep)) {
    throw new ManifestValidationError(
      `${label} ${JSON.stringify(candidate)} resolves outside fixturesRoot (${resolved} vs ${root})`,
    );
  }
}

/**
 * Real-path containment: candidate's resolved real path (following symlinks)
 * must also be a regular file inside root. Catches a symlink under
 * fixturesRoot whose target points outside. Only applied to active fixtures
 * (the placeholder branch allows absent files).
 */
function assertRealContained(root: string, candidate: string, label: string): void {
  const lexicalResolved = resolve(root, candidate);
  let realRoot: string;
  let realPath: string;
  try {
    realRoot = realpathSync.native(root);
  } catch (err) {
    throw new ManifestValidationError(`failed to resolve fixturesRoot real path: ${(err as Error).message}`);
  }
  try {
    realPath = realpathSync.native(lexicalResolved);
  } catch (err) {
    throw new ManifestValidationError(
      `${label} ${JSON.stringify(candidate)} cannot be realpath-resolved (file missing or unreadable): ${(err as Error).message}`,
    );
  }
  const realRootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (realPath !== realRoot && !realPath.startsWith(realRootWithSep)) {
    throw new ManifestValidationError(
      `${label} ${JSON.stringify(candidate)} real path escapes fixturesRoot via symlink (${realPath} vs ${realRoot})`,
    );
  }
  // Require a regular file (not a directory; symlinks already resolved).
  let st;
  try {
    st = statSync(realPath);
  } catch (err) {
    throw new ManifestValidationError(
      `${label} ${JSON.stringify(candidate)} cannot be stat'd: ${(err as Error).message}`,
    );
  }
  if (!st.isFile()) {
    throw new ManifestValidationError(
      `${label} ${JSON.stringify(candidate)} is not a regular file (got ${describeFileType(st)})`,
    );
  }
}

function describeFileType(st: import("node:fs").Stats): string {
  if (st.isDirectory()) return "directory";
  if (st.isSymbolicLink()) return "symlink";
  if (st.isBlockDevice()) return "block device";
  if (st.isCharacterDevice()) return "character device";
  if (st.isFIFO()) return "fifo";
  if (st.isSocket()) return "socket";
  return "non-regular";
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

function expectNonEmptyString(
  obj: Record<string, unknown>,
  field: string,
  index: number,
  prefix = "",
): string {
  const v = obj[field];
  if (typeof v !== "string" || v.length === 0) {
    throw new ManifestValidationError(`fixtures[${index}].${prefix}${field} must be a non-empty string`);
  }
  return v;
}

function expectEnum<T extends string>(
  obj: Record<string, unknown>,
  field: string,
  values: readonly T[],
  index: number,
): T {
  const v = obj[field];
  if (typeof v !== "string" || !(values as readonly string[]).includes(v)) {
    throw new ManifestValidationError(
      `fixtures[${index}].${field} must be one of ${JSON.stringify(values)} (got ${JSON.stringify(v)})`,
    );
  }
  return v as T;
}

function expectHex64(obj: Record<string, unknown>, field: string, index: number): string {
  const v = obj[field];
  if (typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v)) {
    throw new ManifestValidationError(`fixtures[${index}].${field} must be lowercase 64-hex SHA-256 (got ${JSON.stringify(v)})`);
  }
  return v;
}

function expectPositiveNumber(
  obj: Record<string, unknown>,
  field: string,
  index: number,
  prefix = "",
): number {
  const v = obj[field];
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
    throw new ManifestValidationError(`fixtures[${index}].${prefix}${field} must be a positive number (got ${JSON.stringify(v)})`);
  }
  return v;
}
