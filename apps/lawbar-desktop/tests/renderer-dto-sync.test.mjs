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
  ["RENDERER_LIST_AUDIT_EVENTS_DTO_FIELDS", "LIST_AUDIT_EVENTS_DTO_FIELDS"],
  ["RENDERER_LIST_DOCUMENTS_DTO_FIELDS", "LIST_DOCUMENTS_DTO_FIELDS"],
  ["RENDERER_GET_DOCUMENT_DTO_FIELDS", "GET_DOCUMENT_DTO_FIELDS"],
  ["RENDERER_REGISTER_DOCUMENT_DTO_FIELDS", "REGISTER_DOCUMENT_DTO_FIELDS"],
  ["RENDERER_LIST_DEADLINES_DTO_FIELDS", "LIST_DEADLINES_DTO_FIELDS"],
  ["RENDERER_LIST_FACTS_DTO_FIELDS", "LIST_FACTS_DTO_FIELDS"],
  ["RENDERER_CREATE_FACT_DTO_FIELDS", "CREATE_FACT_DTO_FIELDS"],
  ["RENDERER_CREATE_DOCKET_DTO_FIELDS", "CREATE_DOCKET_DTO_FIELDS"],
  ["RENDERER_CONFIRM_DOCKET_DTO_FIELDS", "CONFIRM_DOCKET_DTO_FIELDS"],
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

// FACTS-AUD-3: the RESPONSE projection is now the asserted line of defense.
// Renderer-side request stripping (the PAIRS above) is no longer the first
// line — the main-process list handlers project every response row through a
// canonical *_RESPONSE_FIELDS allowlist that EXCLUDES the entity's
// server-authority fields. These arrays live in `src/caseBox/dto.ts` only (the
// renderer never sees the response allowlist), so this block asserts against
// the canonical file. The per-entity authority fields below MUST stay absent
// from the allowlist; if a future field becomes authority-bearing it must be
// added here AND removed from the allowlist.
const RESPONSE_ALLOWLISTS = [
  ["LIST_FACTS_RESPONSE_FIELDS", ["tenant_id", "actor_user_id", "reviewer_actor_user_id"]],
  ["LIST_DOCUMENTS_RESPONSE_FIELDS", ["tenant_id", "actor_user_id", "custody_chain"]],
  ["LIST_DEADLINES_RESPONSE_FIELDS", ["tenant_id", "actor_user_id"]],
  // GET-AUD-1: the get-document channel uses its own allowlist; same exclusions.
  ["GET_DOCUMENT_RESPONSE_FIELDS", ["tenant_id", "actor_user_id", "custody_chain"]],
];

test("response projection: canonical *_RESPONSE_FIELDS allowlists exist and are non-empty", () => {
  const canonical = extractFieldArrays(CANONICAL_DTO);
  for (const [name] of RESPONSE_ALLOWLISTS) {
    assert.ok(canonical.has(name), `src/caseBox/dto.ts missing ${name}`);
    assert.ok((canonical.get(name) ?? []).length > 0, `${name} extracted empty`);
  }
});

for (const [name, authorityFields] of RESPONSE_ALLOWLISTS) {
  test(`response projection: ${name} excludes every authority field`, () => {
    const canonical = extractFieldArrays(CANONICAL_DTO);
    const allow = new Set(canonical.get(name));
    const leaked = authorityFields.filter((f) => allow.has(f));
    assert.deepEqual(
      leaked,
      [],
      `${name} must not contain authority fields: ${JSON.stringify(leaked)}`,
    );
  });
}
