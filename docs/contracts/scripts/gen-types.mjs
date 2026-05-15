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
  " * AUTO-GENERATED from docs/contracts/schemas/*.json by scripts/gen-types.mjs.\n" +
  " * Do not edit by hand. Run `npm run gen:types` after changing a schema.\n" +
  " */\n";

// Map of cross-schema $id → local file. ocr-job-outcome.schema.json $refs
// the OcrResult schema by $id; the offline resolver below maps that $id
// back to its on-disk file so generation works without network access.
const ID_TO_FILE = new Map([
  [
    "https://litigation-platform.local/contracts/ocr-result.schema.json",
    "ocr-result.schema.json",
  ],
]);

const contractIdResolver = {
  order: 50,
  canRead(file) {
    if (typeof file.url !== "string") return false;
    const noHash = file.url.split("#", 1)[0];
    return ID_TO_FILE.has(noHash);
  },
  read(file) {
    const noHash = file.url.split("#", 1)[0];
    const filename = ID_TO_FILE.get(noHash);
    if (!filename) throw new Error(`unmapped $ref id: ${file.url}`);
    return readFileSync(join(schemasDir, filename), "utf8");
  },
};

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
