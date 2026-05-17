// Offline $ref resolver for json-schema-ref-parser.
//
// Used by scripts/gen-types.mjs so that a contract schema referencing
// another contract schema by `$id` resolves against the on-disk schema
// file rather than the network. Extracted from gen-types.mjs so it can be
// unit-tested directly.
//
// Contract:
//   - Resolver is keyed by the strict `$id` of each contract schema.
//   - Fragment portions (`#/$defs/foo`) are stripped before lookup.
//   - Unmapped IDs throw synchronously with a clear error.
//   - The registry is built from the schema files themselves (parsed at
//     resolver-construction time), so the resolver and the schemas cannot
//     drift apart in the way two hand-maintained string literals can.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Build a json-schema-ref-parser resolver and the `$id → file` registry
 * it depends on. Reads each requested schema file once at construction
 * time, extracts its `$id`, and caches the file contents so subsequent
 * `read()` calls are pure-memory.
 *
 * @param {string} schemasDir Absolute path to the schemas directory.
 * @param {readonly string[]} filenames Schema filenames (relative to
 *   `schemasDir`) whose `$id` should be resolvable by this resolver.
 * @returns {{
 *   registry: Map<string, string>;
 *   resolver: {
 *     order: number;
 *     canRead(file: { url: string }): boolean;
 *     read(file: { url: string }): string;
 *   };
 * }}
 */
export function makeContractIdResolver(schemasDir, filenames) {
  /** @type {Map<string, string>} */
  const registry = new Map();
  /** @type {Map<string, string>} */
  const contents = new Map();

  for (const filename of filenames) {
    const path = join(schemasDir, filename);
    const raw = readFileSync(path, "utf8");
    const json = JSON.parse(raw);
    const id = json.$id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(
        `contractIdResolver: schema ${filename} has no $id; cannot register`,
      );
    }
    if (registry.has(id)) {
      throw new Error(
        `contractIdResolver: duplicate $id ${id} (in ${filename} and ${registry.get(id)})`,
      );
    }
    registry.set(id, filename);
    contents.set(filename, raw);
  }

  const resolver = {
    order: 50,
    canRead(file) {
      if (typeof file?.url !== "string") return false;
      const noHash = file.url.split("#", 1)[0];
      return registry.has(noHash);
    },
    read(file) {
      const noHash = file.url.split("#", 1)[0];
      const filename = registry.get(noHash);
      if (!filename) {
        throw new Error(`contractIdResolver: unmapped $ref: ${file.url}`);
      }
      const cached = contents.get(filename);
      if (cached === undefined) {
        // Defensive — should be impossible after construction.
        throw new Error(`contractIdResolver: missing cached contents for ${filename}`);
      }
      return cached;
    },
  };

  return { registry, resolver };
}
