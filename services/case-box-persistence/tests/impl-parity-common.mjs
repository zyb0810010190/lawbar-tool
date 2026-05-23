// Shared helpers for impl-parity-*.test.mjs files.
//
// Split from the former monolithic `tests/impl-parity.test.mjs` per the
// B7 plan §1.7 mandatory split (closes B6 deferred Low D4#1). The
// shared helpers create paired InMemory + SQLite persistence instances
// driven by identical clocks and ID generators so deep-equal assertions
// hold across both impls.
//
// Two pair flavors:
//   - makePair() — separate ID prefixes per impl. Use when the test does
//     NOT exercise audit events (audit-event hashes are seeded from
//     event ids, which would diverge if prefixes differ; matter / doc
//     fields are independent of ids beyond the row's own id).
//   - makeAuditPair() — SHARED ID prefix across both impls. Use when
//     the test consumes listAuditEvents / verifyAuditChainForMatter
//     output (event hash chain must match byte-identically).

import {
  InMemoryCaseBoxPersistence,
  openSqliteCaseBoxPersistence,
} from "../dist/index.js";
import {
  makeClock,
  makeIdGenerator,
} from "./conformance/fixtures.mjs";

export const ISO = "2026-05-22T09:00:00.000Z";

const ID_PREFIX_INMEM = "parityim";
const ID_PREFIX_SQLITE = "paritysq";
const ID_PREFIX_SHARED = "paritysh";

export function makePair() {
  const inMem = new InMemoryCaseBoxPersistence({
    now: makeClock(ISO),
    generateId: makeIdGenerator(ID_PREFIX_INMEM),
  });
  const { persistence: sqlite, db } = openSqliteCaseBoxPersistence({
    now: makeClock(ISO),
    generateId: makeIdGenerator(ID_PREFIX_SQLITE),
  });
  return { inMem, sqlite, db };
}

export function makeAuditPair() {
  const inMem = new InMemoryCaseBoxPersistence({
    now: makeClock(ISO),
    generateId: makeIdGenerator(ID_PREFIX_SHARED),
  });
  const { persistence: sqlite, db } = openSqliteCaseBoxPersistence({
    now: makeClock(ISO),
    generateId: makeIdGenerator(ID_PREFIX_SHARED),
  });
  return { inMem, sqlite, db };
}
