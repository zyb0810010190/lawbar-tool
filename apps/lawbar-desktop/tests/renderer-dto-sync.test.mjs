// DTO field-name drift test.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §9.4 + D3 (regex parser).
//
// Asserts that the renderer-side RENDERER_*_DTO_FIELDS arrays in
// `renderer/types.ts` have set-equal field names with the canonical
// `*_DTO_FIELDS` arrays in `src/caseBox/dto.ts`. Catches typos at build time
// (the renderer is forbidden from importing `src/caseBox` directly).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");

const RENDERER_TYPES = path.join(APP_ROOT, "renderer", "types.ts");
const CANONICAL_DTO = path.join(APP_ROOT, "src", "caseBox", "dto.ts");

// Match: export const NAME = Object.freeze([ "x", "y", ... ] as const);
// Captures the array body. Tolerant of whitespace/newlines.
const FREEZE_BLOCK_RE =
  /export\s+const\s+([A-Z_]+)\s*=\s*Object\.freeze\(\s*\[([\s\S]*?)\]\s*as\s+const\s*\)\s*;/g;

function extractFieldArrays(filePath) {
  const text = readFileSync(filePath, "utf8");
  const out = new Map();
  let m;
  while ((m = FREEZE_BLOCK_RE.exec(text)) !== null) {
    const name = m[1];
    const body = m[2];
    // Pull all "quoted" strings.
    const items = Array.from(body.matchAll(/"([^"]+)"/g)).map((mm) => mm[1]);
    out.set(name, items);
  }
  return out;
}

const PAIRS = [
  ["RENDERER_CREATE_MATTER_DTO_FIELDS", "CREATE_MATTER_DTO_FIELDS"],
  ["RENDERER_GET_MATTER_DTO_FIELDS", "GET_MATTER_DTO_FIELDS"],
  ["RENDERER_LIST_MATTERS_DTO_FIELDS", "LIST_MATTERS_DTO_FIELDS"],
  ["RENDERER_ARCHIVE_MATTER_DTO_FIELDS", "ARCHIVE_MATTER_DTO_FIELDS"],
  ["RENDERER_CHAIN_HEAD_DTO_FIELDS", "CHAIN_HEAD_DTO_FIELDS"],
];

test("DTO sync: parser extracts all renderer arrays", () => {
  const renderer = extractFieldArrays(RENDERER_TYPES);
  for (const [rendererName] of PAIRS) {
    assert.ok(renderer.has(rendererName), `renderer/types.ts missing ${rendererName}`);
    assert.ok((renderer.get(rendererName) ?? []).length > 0, `${rendererName} extracted empty`);
  }
});

test("DTO sync: parser extracts all canonical arrays", () => {
  const canonical = extractFieldArrays(CANONICAL_DTO);
  for (const [, canonicalName] of PAIRS) {
    assert.ok(canonical.has(canonicalName), `src/caseBox/dto.ts missing ${canonicalName}`);
    assert.ok((canonical.get(canonicalName) ?? []).length > 0, `${canonicalName} extracted empty`);
  }
});

for (const [rendererName, canonicalName] of PAIRS) {
  test(`DTO sync: ${rendererName} ↔ ${canonicalName} field sets are equal`, () => {
    const renderer = extractFieldArrays(RENDERER_TYPES);
    const canonical = extractFieldArrays(CANONICAL_DTO);
    const rSet = new Set(renderer.get(rendererName));
    const cSet = new Set(canonical.get(canonicalName));
    const rOnly = [...rSet].filter((x) => !cSet.has(x));
    const cOnly = [...cSet].filter((x) => !rSet.has(x));
    assert.deepEqual(
      rOnly,
      [],
      `renderer has fields not in canonical: ${JSON.stringify(rOnly)}`,
    );
    assert.deepEqual(
      cOnly,
      [],
      `canonical has fields not in renderer: ${JSON.stringify(cOnly)}`,
    );
  });
}
