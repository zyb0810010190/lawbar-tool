import { CaseBoxPersistenceError } from "./errors.js";

/**
 * WI-05. A matter that exists ALWAYS has a MATTER_REGISTERED genesis event, so "the matter
 * exists and its chain holds zero events" is a state that cannot legitimately occur. It means
 * the audit history was deleted.
 *
 * Before this, the two read paths reported exactly that state as an ordinary empty one —
 * `listAuditEvents` returned `{ rows: [], next_cursor: null }` and `getAuditChainHead`
 * returned `{ headHash: null, lastEventId: null, count: 0 }` — indistinguishable from a matter
 * with no history yet. `verifyAuditChainForMatter` already detected it and said so precisely,
 * but nothing called it on a read and no IPC exposed it, so the app could display a deleted
 * audit history as "nothing here yet". For a tool whose court-facing claim IS the audit chain,
 * that is the worst available presentation: not a warning, but a plausible blank.
 *
 * Deliberately a shared helper rather than the same check written twice. SQLite and the
 * in-memory twin have separate read implementations, and fixing only the shipped one would
 * hand WI-06 a parity defect created by this work item.
 *
 * Scope, stated honestly: this catches TOTAL erasure. Partial tampering — some events removed
 * while the genesis survives — still needs `verifyAuditChainForMatter`, which is a full walk
 * and too expensive to run on every read.
 */
export function assertAuditChainNotErased(matterId: string, eventCount: number): void {
  if (eventCount > 0) return;
  throw new CaseBoxPersistenceError(
    "audit_chain_erased",
    `refusing to report an empty audit history for matter ${matterId}: the matter exists, so ` +
      `it must have a MATTER_REGISTERED genesis event. Zero events means the audit history ` +
      `was deleted. Run a chain verification and restore from a backup; do not treat this as ` +
      `a matter with no activity yet.`,
  );
}
