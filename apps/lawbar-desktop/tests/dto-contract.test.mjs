import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CREATE_MATTER_DTO_FIELDS,
  CREATE_MATTER_FORBIDDEN_FIELDS,
  LIST_MATTERS_DTO_FIELDS,
  LIST_MATTERS_FORBIDDEN_FIELDS,
  ARCHIVE_MATTER_DTO_FIELDS,
  ARCHIVE_MATTER_FORBIDDEN_FIELDS,
  GET_MATTER_DTO_FIELDS,
  GET_MATTER_FORBIDDEN_FIELDS,
  CHAIN_HEAD_DTO_FIELDS,
  CHAIN_HEAD_FORBIDDEN_FIELDS,
  TRANSITION_FACT_DTO_FIELDS,
  TRANSITION_FACT_FORBIDDEN_FIELDS,
  TRANSITION_FACT_RESPONSE_FIELDS,
  MAX_LIST_LIMIT,
  MAX_CURSOR_LENGTH,
} from "../dist/src/caseBox/dto.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MATTER_SCHEMA_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "docs",
  "contracts",
  "case-box-contract",
  "schemas",
  "case-box-matter.schema.json",
);

function loadMatterSchema() {
  return JSON.parse(readFileSync(MATTER_SCHEMA_PATH, "utf8"));
}

test("CreateMatterDto fields are exactly the contract §6.0 lawyer-input set", () => {
  assert.deepEqual([...CREATE_MATTER_DTO_FIELDS].sort(), [
    "case_progress_text",
    "case_type_text",
    "confidentiality_class",
    "contention_summary_text",
    "court_contact_text",
    "jurisdiction",
    "matter_type",
    "name",
    "parties",
    "retainer_scope",
  ]);
});

test("CreateMatter forbidden list covers all server-authority + opt-in fields", () => {
  const expected = [
    "actor_user_id",
    "archived_at",
    "created_at",
    "custody_chain",
    "external_ocr_authorized",
    "id",
    "llm_extraction_opt_in",
    "status",
    "successor_matter_id",
    "sync_grant_present",
    "tenant_id",
  ];
  assert.deepEqual([...CREATE_MATTER_FORBIDDEN_FIELDS].sort(), expected);
});

test("CreateMatter DTO and forbidden lists are disjoint", () => {
  const dto = new Set(CREATE_MATTER_DTO_FIELDS);
  for (const f of CREATE_MATTER_FORBIDDEN_FIELDS) {
    assert.equal(dto.has(f), false, `forbidden field "${f}" must not appear in DTO`);
  }
});

test("ListMattersDto fields are exactly status/limit/cursor; tenant_id is forbidden", () => {
  assert.deepEqual([...LIST_MATTERS_DTO_FIELDS].sort(), ["cursor", "limit", "status"]);
  assert.deepEqual([...LIST_MATTERS_FORBIDDEN_FIELDS], ["tenant_id"]);
});

test("ArchiveMatterDto fields are exactly matterId+reason; actor_user_id + tenant_id are forbidden", () => {
  assert.deepEqual([...ARCHIVE_MATTER_DTO_FIELDS].sort(), ["matterId", "reason"]);
  assert.deepEqual([...ARCHIVE_MATTER_FORBIDDEN_FIELDS].sort(), ["actor_user_id", "tenant_id"]);
});

test("constants for list-query bounds match contract §6", () => {
  assert.equal(MAX_LIST_LIMIT, 200);
  assert.equal(MAX_CURSOR_LENGTH, 512);
});

// ---------- schema-drift catchers (rev-impl-0.1 L-2) ----------
// These tests load `docs/contracts/case-box-contract/schemas/case-box-matter.schema.json`
// directly and prove every schema property is classified — either as a
// renderer-supplied field (in CREATE_MATTER_DTO_FIELDS) or as a server-authority
// field (in CREATE_MATTER_FORBIDDEN_FIELDS). If a future schema revision
// adds a new field, this test fails until the WI explicitly classifies it.

test("schema-drift: every Matter schema property is either DTO-allowed or DTO-forbidden", () => {
  const schema = loadMatterSchema();
  const schemaProps = new Set(Object.keys(schema.properties));
  const dto = new Set(CREATE_MATTER_DTO_FIELDS);
  const forbidden = new Set(CREATE_MATTER_FORBIDDEN_FIELDS);
  const unclassified = [];
  for (const prop of schemaProps) {
    if (!dto.has(prop) && !forbidden.has(prop)) unclassified.push(prop);
  }
  assert.deepEqual(
    unclassified,
    [],
    `Matter schema has properties not classified as DTO-allowed or FORBIDDEN: ${unclassified.join(", ")}. ` +
      `Update CREATE_MATTER_DTO_FIELDS or CREATE_MATTER_FORBIDDEN_FIELDS in src/caseBox/dto.ts.`,
  );
});

test("schema-drift: every required Matter field is server-injected or in DTO", () => {
  const schema = loadMatterSchema();
  const required = schema.required;
  // Server-injected fields (NOT in DTO; main MUST inject them on every create):
  const serverInjected = new Set([
    "id",
    "tenant_id",
    "actor_user_id",
    "created_at",
    "status",
    "external_ocr_authorized",
    "sync_grant_present",
    "llm_extraction_opt_in",
  ]);
  const dto = new Set(CREATE_MATTER_DTO_FIELDS);
  const missing = [];
  for (const r of required) {
    if (!serverInjected.has(r) && !dto.has(r)) missing.push(r);
  }
  assert.deepEqual(
    missing,
    [],
    `Schema-required Matter fields not covered by either DTO or server-injection: ${missing.join(", ")}`,
  );
});

test("schema-drift: all server-injected fields appear in FORBIDDEN_FIELDS (renderer must not supply)", () => {
  // Every server-authority field that main injects MUST also be on the
  // renderer-side forbidden list so a rogue renderer can't pre-empt the
  // server's value. (custody_chain stays on the forbidden list even
  // though it's a Document field — defense-in-depth against the renderer
  // sending it anyway.)
  const serverInjected = [
    "id",
    "tenant_id",
    "actor_user_id",
    "created_at",
    "status",
    "external_ocr_authorized",
    "sync_grant_present",
    "llm_extraction_opt_in",
    "archived_at",
    "successor_matter_id",
  ];
  const forbidden = new Set(CREATE_MATTER_FORBIDDEN_FIELDS);
  const missing = serverInjected.filter((f) => !forbidden.has(f));
  assert.deepEqual(
    missing,
    [],
    `Server-injected fields missing from CREATE_MATTER_FORBIDDEN_FIELDS: ${missing.join(", ")}`,
  );
});

test("GetMatter / ChainHead DTOs are exactly {matterId}", () => {
  assert.deepEqual([...GET_MATTER_DTO_FIELDS], ["matterId"]);
  assert.deepEqual([...CHAIN_HEAD_DTO_FIELDS], ["matterId"]);
});

test("GetMatter / ChainHead forbidden lists include tenant_id + actor_user_id", () => {
  assert.ok(GET_MATTER_FORBIDDEN_FIELDS.includes("tenant_id"));
  assert.ok(GET_MATTER_FORBIDDEN_FIELDS.includes("actor_user_id"));
  assert.ok(CHAIN_HEAD_FORBIDDEN_FIELDS.includes("tenant_id"));
  assert.ok(CHAIN_HEAD_FORBIDDEN_FIELDS.includes("actor_user_id"));
});

// WI-802: fact transition DTO contract.
test("TransitionFactDto fields are exactly matterId/factId/to/rejection_reason", () => {
  assert.deepEqual([...TRANSITION_FACT_DTO_FIELDS].sort(), ["factId", "matterId", "rejection_reason", "to"]);
});

test("TransitionFact DTO and forbidden lists are disjoint", () => {
  const dto = new Set(TRANSITION_FACT_DTO_FIELDS);
  for (const f of TRANSITION_FACT_FORBIDDEN_FIELDS) {
    assert.equal(dto.has(f), false, `forbidden field ${f} must not also be a DTO field`);
  }
});

test("TransitionFact forbidden list blocks the server-authority + lifecycle fields", () => {
  for (const f of ["reviewer_actor_user_id", "at", "status", "reviewed_at", "accepted_at", "rejected_at", "tenant_id", "actor_user_id", "matter_id"]) {
    assert.ok(TRANSITION_FACT_FORBIDDEN_FIELDS.includes(f), `expected ${f} in TRANSITION_FACT_FORBIDDEN_FIELDS`);
  }
});

test("TransitionFact response allowlist strips authority identities", () => {
  for (const f of ["tenant_id", "actor_user_id", "reviewer_actor_user_id"]) {
    assert.equal(TRANSITION_FACT_RESPONSE_FIELDS.includes(f), false, `${f} must not be in TRANSITION_FACT_RESPONSE_FIELDS`);
  }
  // but the review-state fields the renderer needs ARE present:
  for (const f of ["status", "reviewed_at", "accepted_at", "rejected_at", "rejection_reason"]) {
    assert.ok(TRANSITION_FACT_RESPONSE_FIELDS.includes(f));
  }
});
