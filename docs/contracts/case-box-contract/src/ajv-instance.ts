// Single Ajv instance shared by every validator in this package, configured
// for JSON Schema 2020-12 with format support. Mirrors the OCR contract's
// posture (see ../../src/ajv-instance.ts) so the two contracts share the same
// strictness profile.

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";

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

// `strict: "log"` matches the OCR contract. The if/then conditional shapes used
// by some case-box schemas (e.g. deadline missed→met requires reason) are
// legitimate JSON Schema 2020-12 but trip Ajv's `strictRequired` warning under
// full strict mode.
const ajv = new Ajv2020({ strict: "log", allErrors: true });
addFormats(ajv);

export { ajv };
