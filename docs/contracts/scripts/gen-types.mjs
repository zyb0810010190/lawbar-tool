// Regenerate src/generated/*.ts from schemas/*.json.
// Run via `npm run gen:types`. Generated files MUST be committed.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compile } from "json-schema-to-typescript";

import { makeContractIdResolver } from "./contractIdResolver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const schemasDir = join(root, "schemas");
const outDir = join(root, "src", "generated");
mkdirSync(outDir, { recursive: true });

const banner =
  "/* eslint-disable */\n" +
  "/**\n" +
  " * AUTO-GENERATED from docs/contracts/schemas/*.json by scripts/gen-types.mjs.\n" +
  " * Do not edit by hand. Run `npm run gen:types` after changing a schema.\n" +
  " */\n";

// Schemas whose $id is reachable via cross-schema $ref. The resolver
// derives the $id from each file at construction time so the registry
// cannot drift from the schemas' own metadata.
const { resolver: contractIdResolver } = makeContractIdResolver(schemasDir, [
  "ocr-result.schema.json",
]);

const opts = {
  bannerComment: banner,
  additionalProperties: true,
  enableConstEnums: false,
  unreachableDefinitions: true,
  declareExternallyReferenced: true,
  style: { singleQuote: false, semi: true, printWidth: 100 },
  $refOptions: {
    resolve: {
      external: true,
      contractId: contractIdResolver,
    },
  },
};

const items = [
  { schema: "ocr-submission.schema.json",  name: "OcrSubmission",  out: "ocr-submission.ts" },
  { schema: "ocr-result.schema.json",      name: "OcrResult",      out: "ocr-result.ts" },
  { schema: "ocr-status.schema.json",      name: "OcrStatus",      out: "ocr-status.ts" },
  { schema: "ocr-job-outcome.schema.json", name: "OcrJobOutcome",  out: "ocr-job-outcome.ts" },
];

for (const { schema, name, out } of items) {
  const src = JSON.parse(readFileSync(join(schemasDir, schema), "utf8"));
  const ts = await compile(src, name, opts);
  writeFileSync(join(outDir, out), ts);
  process.stdout.write(`generated ${out} (from ${schema})\n`);
}
