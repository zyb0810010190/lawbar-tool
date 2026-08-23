# What the audit chain proves, and what it does not

**Status: authoritative. D-1, decided 2026-08-23.** This is the statement the product may
make about its own tamper-evidence. Every detection listed below is implemented and has a
test; the limitation is real and is stated because overstating it is the larger risk.

## What it detects

| Failure | Mechanism | Pinned by |
|---|---|---|
| The whole history for a matter is deleted | A matter that exists must have a `MATTER_REGISTERED` genesis event, so zero events cannot legitimately occur | `hardening-audit-truncation.test.mjs`, `assertAuditChainNotErased` |
| The genesis is deleted and the survivors re-chained | The chain would then begin with a non-genesis event, and only matter creation writes a first event | genesis-shape guard, both implementations |
| The payload of the **last** event is altered | A head anchor recorded at append time is cross-checked against the recomputed head — the in-chain `prev_event_hash` cannot see this, as the last event has no successor | `impl-parity-audit.test.mjs` WI06 |
| Any middle event is altered or removed | `prev_event_hash` linkage breaks | contract verifier |
| The store is corrupt, truncated to zero bytes, foreign, or locked | Checked on open, before anything writes | `sqlite-integrity-on-open.test.mjs` |

## What it does not detect

**Consistent tail truncation.** Delete the last N events *and* update the head anchor to
match. The result is a shorter chain that is internally perfect. No purely internal check can
distinguish it from a matter that simply has fewer events, because the anchor lives in the
same file under the same adversary.

**The product must not claim otherwise.** It may say the chain is internally consistent and
detects the failures above. It may not say "no events were removed".

## Why there is no external anchor

Three were considered — third-party timestamping of `(matter_id, event_count, head_hash)`,
RFC 3161 tokens, and a signed local checkpoint — and all three were declined.

The first two would give this app its **first network egress**. There is currently no
network-capable code in the desktop application at all, and local-only is not a description
but an enforced contract: the persistence layer *rejects* creating a matter with
`external_ocr_authorized`, `sync_grant_present` or `llm_extraction_opt_in` set. Audit
metadata is not categorically different from the OCR and sync flows that contract refuses —
`(matter_id, …)` emitted on a schedule is a stable per-matter fingerprint of privileged
representation leaving the machine.

And they would not close the gap anyway. An attacker truncates to the last externally
anchored state and updates the local anchor; everything after that anchor point disappears
undetectably. RFC 3161 proves existence-before-a-time, not completeness-after-it — the newer
tokens are deleted along with the newer events. Both buy a bounded window, not completeness,
at the cost of the confidentiality contract.

The signed local checkpoint is weaker still: an attacker able to rewrite the chain and the
head anchor can rewrite and re-sign the checkpoint, since the key is on the same machine. It
stops only an attacker who can edit the database but cannot reach the signing operation —
narrower than the one in the gap — while adding key lifecycle to explain in court.

## The witness that does exist

Completeness is not established internally; it is established by **comparison against a
retained backup**. `apps/lawbar-desktop/scripts/backup-local-data.mjs` archives the whole
`case-box.sqlite`, so a backup taken before a truncation contains the longer chain, and the
comparison is arithmetic: an earlier archive whose chain is *longer* than the current one is
proof of removal.

This requires no network egress, no third party, and no new key. It requires that backups are
actually taken and retained, which is an operational commitment, not a code guarantee — and
saying so plainly is the point of this document.
