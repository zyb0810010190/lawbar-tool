// DTO field-name drift test.
// Per dev-memo/plan-casebox-ui-plan-00.md rev-0.1 §9.4 + D3 (regex parser).
//
// Asserts that the renderer-side RENDERER_*_DTO_FIELDS arrays in
// `renderer/types.ts` have set-equal field names with the canonical
// `*_DTO_FIELDS` arrays in `src/caseBox/dto.ts`. Catches typos at build time
// (the renderer is forbidden from importing `src/caseBox` directly).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");

const RENDERER_TYPES = path.join(APP_ROOT, "renderer", "types.ts");
// WI-DTO1: the canonical DTO definitions were split from a single dto.ts into
// per-entity modules under src/caseBox/dto/ behind a barrel. dto.ts is now a pure
// re-export barrel (no Object.freeze blocks), so the canonical field arrays are
// read+merged from the dto/*.ts modules. extractCanonical() asserts at least one
// module is found so a moved/renamed directory can never silently yield an empty
// extraction that false-passes the set-equality / authority-exclusion checks.
const CANONICAL_DTO_DIR = path.join(APP_ROOT, "src", "caseBox", "dto");
function extractCanonical() {
  const files = readdirSync(CANONICAL_DTO_DIR)
    .filter((f) => f.endsWith(".ts"))
    .sort();
  assert.ok(files.length > 0, `no canonical DTO modules found under ${CANONICAL_DTO_DIR}`);
  const merged = new Map();
  for (const f of files) {
    for (const [k, v] of extractFieldArrays(path.join(CANONICAL_DTO_DIR, f))) {
      merged.set(k, v);
    }
  }
  return merged;
}

// Match: export const NAME = Object.freeze([ "x", "y", ... ] as const);
// Captures the array body. Tolerant of whitespace/newlines.
// Name char-class includes digits so array names carrying a form number
// (e.g. RENDERER_T3_PREVIEW_DTO_FIELDS / T3_PREVIEW_CATALOG_DTO_FIELDS) match.
const FREEZE_BLOCK_RE =
  /export\s+const\s+([A-Z0-9_]+)\s*=\s*Object\.freeze\(\s*\[([\s\S]*?)\]\s*as\s+const\s*\)\s*;/g;

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
  ["RENDERER_LIST_DOCKET_DTO_FIELDS", "LIST_DOCKET_DTO_FIELDS"],
  ["RENDERER_DISMISS_DOCKET_DTO_FIELDS", "DISMISS_DOCKET_DTO_FIELDS"],
  // WI-DPE5: the renderer edit bridge mirrors the canonical EDIT_DOCKET_DTO_FIELDS (8 fields).
  ["RENDERER_EDIT_DOCKET_DTO_FIELDS", "EDIT_DOCKET_DTO_FIELDS"],
  ["RENDERER_TRANSITION_FACT_DTO_FIELDS", "TRANSITION_FACT_DTO_FIELDS"],
  ["RENDERER_TRANSITION_DEADLINE_DTO_FIELDS", "TRANSITION_DEADLINE_DTO_FIELDS"],
  // WI-PTA-VS2: the renderer ClaimTrack create/list bridges mirror the canonical
  // *_CLAIM_TRACK*_DTO_FIELDS in src/caseBox/dto/claimTrack.ts.
  ["RENDERER_CREATE_CLAIM_TRACK_DTO_FIELDS", "CREATE_CLAIM_TRACK_DTO_FIELDS"],
  ["RENDERER_LIST_CLAIM_TRACKS_DTO_FIELDS", "LIST_CLAIM_TRACKS_DTO_FIELDS"],
  // WI-A3-LINK-UI-T1: the renderer link bridge mirrors the canonical link DTO field
  // arrays in src/caseBox/dto/link.ts (consume-only; the canonical arrays already exist).
  ["RENDERER_CREATE_LINK_DTO_FIELDS", "CREATE_LINK_DTO_FIELDS"],
  ["RENDERER_UNLINK_LINK_DTO_FIELDS", "UNLINK_LINK_DTO_FIELDS"],
  ["RENDERER_RELINK_LINK_DTO_FIELDS", "RELINK_LINK_DTO_FIELDS"],
  ["RENDERER_LIST_LINKS_DTO_FIELDS", "LIST_LINKS_DTO_FIELDS"],
  ["RENDERER_EXPORT_LINK_CITATIONS_DTO_FIELDS", "EXPORT_LINK_CITATIONS_DTO_FIELDS"],
  // WI-FORMS-T3-S2-CATALOG-PREVIEW: the renderer T3 preview bridge mirrors the
  // canonical T3_PREVIEW_CATALOG_DTO_FIELDS in src/caseBox/dto/t3.ts.
  ["RENDERER_T3_PREVIEW_DTO_FIELDS", "T3_PREVIEW_CATALOG_DTO_FIELDS"],
  // WI-FORMS-T3-S3-DOCX-EXPORT: the renderer T3 export bridge mirrors the canonical
  // T3_EXPORT_DOCX_DTO_FIELDS in src/caseBox/dto/t3.ts.
  ["RENDERER_T3_EXPORT_DTO_FIELDS", "T3_EXPORT_DOCX_DTO_FIELDS"],
];

test("DTO sync: parser extracts all renderer arrays", () => {
  const renderer = extractFieldArrays(RENDERER_TYPES);
  for (const [rendererName] of PAIRS) {
    assert.ok(renderer.has(rendererName), `renderer/types.ts missing ${rendererName}`);
    assert.ok((renderer.get(rendererName) ?? []).length > 0, `${rendererName} extracted empty`);
  }
});

test("DTO sync: parser extracts all canonical arrays", () => {
  const canonical = extractCanonical();
  for (const [, canonicalName] of PAIRS) {
    assert.ok(canonical.has(canonicalName), `src/caseBox/dto.ts missing ${canonicalName}`);
    assert.ok((canonical.get(canonicalName) ?? []).length > 0, `${canonicalName} extracted empty`);
  }
});

for (const [rendererName, canonicalName] of PAIRS) {
  test(`DTO sync: ${rendererName} ↔ ${canonicalName} field sets are equal`, () => {
    const renderer = extractFieldArrays(RENDERER_TYPES);
    const canonical = extractCanonical();
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
  // WI-DT1: the deadline transition response allowlist excludes the same authority fields.
  ["TRANSITION_DEADLINE_RESPONSE_FIELDS", ["tenant_id", "actor_user_id"]],
  // AUDIT-AUD-1: the audit-list response allowlist excludes the same authority fields.
  ["LIST_AUDIT_EVENTS_RESPONSE_FIELDS", ["tenant_id", "actor_user_id"]],
  // MATTER-AUD-1: the shared matter response allowlist (create/get/list/archive) excludes authority.
  ["MATTER_RESPONSE_FIELDS", ["tenant_id", "actor_user_id"]],
  // REGDOC-AUD-1: the document-register response allowlist excludes authority incl. custody_chain.
  ["REGISTER_DOCUMENT_RESPONSE_FIELDS", ["tenant_id", "actor_user_id", "custody_chain"]],
  // WI-FF1: the write-channel response allowlists exclude the same authority fields.
  ["CREATE_FACT_RESPONSE_FIELDS", ["tenant_id", "actor_user_id", "reviewer_actor_user_id"]],
  ["TRANSITION_FACT_RESPONSE_FIELDS", ["tenant_id", "actor_user_id", "reviewer_actor_user_id"]],
  // WI-PTA-VS2: the ClaimTrack response allowlist (shared by create + list) excludes authority.
  ["CREATE_CLAIM_TRACK_RESPONSE_FIELDS", ["tenant_id", "actor_user_id"]],
  // DOCKET_ENTRY carries proposer + lifecycle actor identities; all must stay out of the allowlist.
  ["DOCKET_ENTRY_RESPONSE_FIELDS", ["tenant_id", "actor_user_id", "confirmation_actor_user_id", "dismissal_actor_user_id"]],
  ["CONFIRM_DOCKET_DEADLINE_RESPONSE_FIELDS", ["tenant_id", "actor_user_id"]],
  // LINK-UI-T1-D5: the link response allowlist excludes authority (tenant_id /
  // actor_user_id) + internal (payload_json) AND must never admit an export flag
  // (export flags live only in the export-citations panel, never on a link row).
  ["LINK_RESPONSE_FIELDS", ["tenant_id", "actor_user_id", "payload_json", "exportFlag", "export_flag"]],
];

test("response projection: canonical *_RESPONSE_FIELDS allowlists exist and are non-empty", () => {
  const canonical = extractCanonical();
  for (const [name] of RESPONSE_ALLOWLISTS) {
    assert.ok(canonical.has(name), `src/caseBox/dto.ts missing ${name}`);
    assert.ok((canonical.get(name) ?? []).length > 0, `${name} extracted empty`);
  }
});

for (const [name, authorityFields] of RESPONSE_ALLOWLISTS) {
  test(`response projection: ${name} excludes every authority field`, () => {
    const canonical = extractCanonical();
    const allow = new Set(canonical.get(name));
    const leaked = authorityFields.filter((f) => allow.has(f));
    assert.deepEqual(
      leaked,
      [],
      `${name} must not contain authority fields: ${JSON.stringify(leaked)}`,
    );
  });
}
