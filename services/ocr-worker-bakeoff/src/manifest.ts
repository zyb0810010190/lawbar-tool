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
// Audit thread 019e36a0 D2.1 / D2.2 / D2.3.

import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

import type {
  BakeoffFixture,
  ActiveBakeoffFixture,
  FixtureManifest,
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
 * structurally checked against the contract.
 *
 * Throws `ManifestValidationError` on any failure, never returns partial data.
 */
export function loadManifest(fixturesRoot: string): LoadedManifest {
  const manifestPath = resolve(fixturesRoot, "manifest.json");
  const root = ensureAbsolute(fixturesRoot, "fixturesRoot");

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

  // Containment: both paths must resolve under fixturesRoot.
  assertContained(root, path, `fixtures[${index}].path`);
  assertContained(root, expected_text_path, `fixtures[${index}].expected_text_path`);

  if (f.active === true) {
    const role = expectEnum(f, "role", ["smoke", "verdict"], index) as FixtureRole;
    const sha256 = expectHex64(f, "sha256", index);
    const expected_text_sha256 = expectHex64(f, "expected_text_sha256", index);
    const provenance = expectNonEmptyString(f, "provenance", index);
    const last_verified_at = expectNonEmptyString(f, "last_verified_at", index);

    const base: ActiveBakeoffFixture = (() => {
      if (kind === "synthetic") {
        const render = f.render;
        if (!render || typeof render !== "object") {
          throw new ManifestValidationError(`fixtures[${index}].render is required for synthetic active fixtures`);
        }
        const r = render as Record<string, unknown>;
        return {
          active: true,
          id,
          role,
          kind: "synthetic",
          category,
          path,
          expected_text_path,
          sha256,
          expected_text_sha256,
          dpi: typeof f.dpi === "number" ? f.dpi : undefined,
          language,
          provenance,
          last_verified_at,
          notes: typeof f.notes === "string" ? f.notes : undefined,
          render: {
            render_command: expectNonEmptyString(r, "render_command", index, "render."),
            font: expectNonEmptyString(r, "font", index, "render."),
            point_size: expectPositiveNumber(r, "point_size", index, "render."),
            canvas: expectNonEmptyString(r, "canvas", index, "render."),
            source_text: expectNonEmptyString(r, "source_text", index, "render."),
            notes: typeof r.notes === "string" ? r.notes : undefined,
          },
        };
      }
      // kind === "real"
      const pii = expectEnum(f, "pii_review", ["redacted", "pending", "not_required"], index);
      return {
        active: true,
        id,
        role,
        kind: "real",
        category,
        path,
        expected_text_path,
        sha256,
        expected_text_sha256,
        dpi: typeof f.dpi === "number" ? f.dpi : undefined,
        language,
        provenance,
        last_verified_at,
        notes: typeof f.notes === "string" ? f.notes : undefined,
        real_source: expectNonEmptyString(f, "real_source", index),
        pii_review: pii as "redacted" | "pending" | "not_required",
      };
    })();
    return base;
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
// Helpers
// ---------------------------------------------------------------------------

function ensureAbsolute(p: string, label: string): string {
  const r = resolve(p);
  return r;
}

function assertContained(root: string, candidate: string, label: string): void {
  const resolved = resolve(root, candidate);
  // Reject if resolved path doesn't sit under root. Add separator to avoid
  // false-positive when fixturesRoot is "/a" and resolved is "/abc".
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new ManifestValidationError(
      `${label} ${JSON.stringify(candidate)} resolves outside fixturesRoot (${resolved} vs ${root})`,
    );
  }
}

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
