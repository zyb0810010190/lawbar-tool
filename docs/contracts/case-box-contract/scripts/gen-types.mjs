// Regenerate src/generated/*.ts from schemas/*.json.
// Run via `npm run gen:types`. Generated files MUST be committed.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compile } from "json-schema-to-typescript";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const schemasDir = join(root, "schemas");
const outDir = join(root, "src", "generated");
mkdirSync(outDir, { recursive: true });

const banner =
  "/* eslint-disable */\n" +
  "/**\n" +
  " * AUTO-GENERATED from docs/contracts/case-box-contract/schemas/*.json by scripts/gen-types.mjs.\n" +
  " * Do not edit by hand. Run `npm run gen:types` after changing a schema.\n" +
  " */\n";

const opts = {
  bannerComment: banner,
  additionalProperties: true,
  enableConstEnums: false,
  unreachableDefinitions: true,
  declareExternallyReferenced: true,
  style: { singleQuote: false, semi: true, printWidth: 100 },
};

const items = [
  { schema: "case-box-matter.schema.json",         name: "CaseBoxMatter",        out: "case-box-matter.ts" },
  { schema: "case-box-document.schema.json",       name: "CaseBoxDocument",      out: "case-box-document.ts" },
  { schema: "case-box-party.schema.json",          name: "CaseBoxParty",         out: "case-box-party.ts" },
  { schema: "case-box-deadline.schema.json",       name: "CaseBoxDeadline",      out: "case-box-deadline.ts" },
  { schema: "case-box-evidence-item.schema.json",  name: "CaseBoxEvidenceItem",  out: "case-box-evidence-item.ts" },
  { schema: "case-box-ocr-link.schema.json",       name: "CaseBoxOcrLink",       out: "case-box-ocr-link.ts" },
  { schema: "case-box-audit-event.schema.json",    name: "CaseBoxAuditEvent",    out: "case-box-audit-event.ts" },
  { schema: "case-box-fact.schema.json",           name: "CaseBoxFact",          out: "case-box-fact.ts" },
  { schema: "case-box-privilege-marker.schema.json", name: "CaseBoxPrivilegeMarker", out: "case-box-privilege-marker.ts" },
];

for (const { schema, name, out } of items) {
  const src = JSON.parse(readFileSync(join(schemasDir, schema), "utf8"));
  const ts = await compile(src, name, opts);
  writeFileSync(join(outDir, out), ts);
  process.stdout.write(`generated ${out} (from ${schema})\n`);
}
