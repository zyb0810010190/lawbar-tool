// Single Ajv instance shared by every validator in this package, configured
// for JSON Schema 2020-12 with format support. Centralized so all validators
// share strictness settings and error formatting.

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";

// ajv-formats is published as CJS with `module.exports = addFormats` plus a
// `.default` shim. Under NodeNext ESM the default-import binding resolves to
// the namespace object on some toolchains. Normalize to the callable form.
const addFormats: (ajv: unknown) => void =
  typeof addFormatsImport === "function"
    ? (addFormatsImport as unknown as (a: unknown) => void)
    : (addFormatsImport as unknown as { default: (a: unknown) => void }).default;

export type AjvErrorObject = {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
  propertyName?: string;
  schema?: unknown;
  parentSchema?: unknown;
  data?: unknown;
};

// `strict: "log"` surfaces unknown/typo'd schema keywords and other
// suspicious constructs as warnings instead of silently no-op'ing them.
// We don't use `strict: true` because the contract schemas legitimately
// rely on the `if/then` + `required` pattern (e.g. result schema requires
// `blocks` when status=succeeded), which Ajv's `strictRequired` flags as
// an error under full strict mode even though it is correct JSON Schema
// 2020-12. "log" gives us the typo-detection benefit without rejecting
// the schemas. Tighten if/when the schemas are restructured.
const ajv = new Ajv2020({ strict: "log", allErrors: true });
addFormats(ajv);

export { ajv };
