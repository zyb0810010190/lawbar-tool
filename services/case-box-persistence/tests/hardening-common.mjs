// Shared helpers for hardening-*.test.mjs files.
//
// Split from the former monolithic `tests/sqlite.hardening.test.mjs`
// per B8 plan §1.7 (closes B7 D4#1). Phase-axis split mirrors the
// B7 impl-parity split shape. Per-phase files import these helpers
// instead of re-declaring them.

import {
  applySchema,
  CURRENT_SCHEMA_VERSION,
  CaseBoxPersistenceError,
  openSqliteCaseBoxPersistence,
} from "../dist/index.js";
import {
  DEFAULT_MATTER_ID,
  makeClock,
  makeIdGenerator,
  makeMatterInput,
} from "./conformance/fixtures.mjs";

export {
  applySchema,
  CURRENT_SCHEMA_VERSION,
  CaseBoxPersistenceError,
  openSqliteCaseBoxPersistence,
  DEFAULT_MATTER_ID,
  makeClock,
  makeIdGenerator,
  makeMatterInput,
};
