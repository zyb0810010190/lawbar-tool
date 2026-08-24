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

They would also not close the gap — though they are not worthless, and an earlier draft of
this section came close to implying they were. What external anchoring genuinely buys is
**bounded completeness**: deletion of any event that was already anchored becomes detectable,
which is a real evidentiary gain. What it cannot give is completeness *after* the last
anchor. An attacker truncates to the last externally anchored state and updates the local
anchor, and everything since then disappears undetectably. RFC 3161 has the same shape: it
proves existence-before-a-time, not completeness-after-it, and the newer tokens are deleted
alongside the newer events.

So the trade is a bounded loss window against this product's first network egress and a
stable per-matter fingerprint leaving the machine on a schedule. That trade is declined here.
It is not declined because anchoring is useless; it is declined because the confidentiality
contract is enforced code and the gain is bounded.

The signed local checkpoint, **as ordinarily built**, is weaker still: an attacker able to
rewrite the chain and the head anchor can rewrite and re-sign the checkpoint, because the key
is usable on the same machine. It then stops only an attacker who can edit the database but
cannot reach the signing operation — narrower than the one in the gap — while adding key
lifecycle to explain in court.

That verdict is specific to a locally usable key, and the distinction matters: a
hardware-backed key requiring user presence, or a checkpoint exported to external media,
separates the signer from the file-editing adversary and would be a different proposition.
Neither is proposed here, and neither should be dismissed by citing the paragraph above.

## The witness that does exist

Completeness is not established internally; it is established by **comparison against a
retained backup**. `apps/lawbar-desktop/scripts/backup-local-data.mjs` archives the whole
`case-box.sqlite`, so a backup taken before a truncation contains the longer chain, and the
comparison is arithmetic: an earlier archive whose chain is *longer* than the current one is
proof of removal.

**This is weaker than it first sounds, and the weakness is the point.** A backup written by
this machine, to this machine, is under the same write authority as the database: the same
adversary can delete it, overwrite it, or retain only the archives that agree with the
truncated chain. It is a witness **only when retained outside that authority** — on external
media that is disconnected, on storage the app cannot write to, or in a custody arrangement
where the retention itself is independently evidenced.

So the honest formulation is: a retained backup *can reveal* truncation, and does so
arithmetically when it exists and is trustworthy. It is not proof by itself, and this document
must not be read as saying the chain's completeness is established by a mechanism the same
attacker controls. That requires no network egress, no third party and no new key — but it
does require an operational commitment about where backups live, which is not a code
guarantee and cannot be made into one here.

### The arithmetic, as a command

Until 2026-08-23 the paragraph above was the whole of it, and nothing performed that
arithmetic. A capability described in prose and implemented nowhere is the failure mode this
repo keeps finding, and it is worse here than elsewhere: this document defines the product's
court-facing evidentiary scope, so the gap was between what the tool claims about itself and
what it can actually do.

    npm --prefix apps/lawbar-desktop run verify:backup -- --backup <retained-archive>

`apps/lawbar-desktop/scripts/verify-against-backup.mjs` walks every matter the backup
witnesses and requires the retained chain to be a **prefix** of the live one — same events, same
positions, same hashes. It reports:

| Finding | Meaning |
|---|---|
| `REMOVED` | the live chain is shorter — this is what consistent truncation looks like |
| `DIVERGED` | an event in the retained chain is not the event now in that position |
| `MATTER_ABSENT` | a matter the backup witnesses has no audit events left |

A matter created after the backup is not a finding, and a live chain that merely grew is not a
finding. Both files are opened `-readonly`, because a read-write open checkpoints a hot WAL and
would alter the evidence being examined. Output carries matter ids, event ids, counts and
hashes and no client content, so a finding can be quoted or handed to an examiner as it stands.

**It does not change the reasoning above.** The command performs the comparison; it cannot
supply the retention. An `INTACT` result means every retained event is still present — it does
not establish completeness, because a backup under the same write authority as the database
proves nothing on its own. Where the archive lives remains the operational commitment, and no
command can make it for you.
