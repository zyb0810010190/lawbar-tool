import { eventHashFn, type StoredAuditEvent } from "./auditChain.js";

/**
 * WI-06. An independent head anchor for the in-memory twin.
 *
 * The SQLite store keeps a head anchor in `case_box_audit_chain_heads` and cross-checks it
 * during verification. That is what catches LAST-EVENT tampering: the in-chain
 * `prev_event_hash` link cannot see it, because the last event has no successor carrying its
 * hash. The twin had no anchor at all — it derived the head from the event array — so the
 * same tamper verified clean. Production always uses SQLite, so this was never a user-data
 * risk; it was a double that modelled a WEAKER corruption class than the thing it stands in
 * for, which is the kind of gap that makes a parity suite lie the moment someone writes the
 * tamper test.
 *
 * The anchor must be written when the event is appended and must NOT be recomputable from the
 * events afterwards, or tampering moves the anchor with it and the check is theatre.
 *
 * Events are appended at 19 sites across 8 modules with no chokepoint, so `#events` is
 * PRIVATE on purpose: there is no `.set()` to forget. Every writer must go through `append()`
 * or `reset()`, and the compiler — not a grep — enumerates the callers.
 */
export interface AuditHeadAnchor {
  readonly headHash: string;
  readonly count: number;
}

export class InMemoryAuditLog {
  readonly #events = new Map<string, StoredAuditEvent[]>();
  readonly #heads = new Map<string, AuditHeadAnchor>();

  /** Append one event and stamp the anchor in the same step, so the two cannot drift. */
  append(matterId: string, event: StoredAuditEvent): void {
    const list = this.#events.get(matterId) ?? [];
    list.push(event);
    this.#events.set(matterId, list);
    this.#heads.set(matterId, { headHash: eventHashFn(event.event), count: list.length });
  }

  /** Append several events atomically (operations that emit more than one). */
  appendAll(matterId: string, events: readonly StoredAuditEvent[]): void {
    for (const e of events) this.append(matterId, e);
  }

  /** Seed a matter's chain — used by matter creation, which writes the genesis event. */
  reset(matterId: string, events: readonly StoredAuditEvent[]): void {
    this.#events.set(matterId, []);
    this.#heads.delete(matterId);
    this.appendAll(matterId, events);
  }

  /** Read-only view. Callers must not mutate the result to add events. */
  get(matterId: string): StoredAuditEvent[] {
    return this.#events.get(matterId) ?? [];
  }

  has(matterId: string): boolean {
    return this.#events.has(matterId);
  }

  /** The anchor exactly as written at append time. */
  anchor(matterId: string): AuditHeadAnchor | undefined {
    return this.#heads.get(matterId);
  }

  keys(): IterableIterator<string> {
    return this.#events.keys();
  }
}
