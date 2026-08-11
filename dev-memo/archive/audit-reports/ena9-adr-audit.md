**Findings**

**Medium** — Non-replay design is not fully coherent enough to implement safely.  
[ADR-evidence-a07-marker-provenance.md](/Users/zhongyibao/ClaudeProjects/lawbar-tool/docs/adr/ADR-evidence-a07-marker-provenance.md:103) requires validation to reject a `runId` that is “absent, reused, or already consumed,” and §5 says the guard records accepted `runId`s in an external ledger. But the ADR does not define how the validator distinguishes the original durable marker from a copied marker using the same `runId`.

That creates two bad implementation paths:
- If any recorded `runId` validates, a copied genuine marker can validate.
- If any “already consumed” `runId` fails, the original marker stops being durable evidence after acceptance/first validation.

The design needs one more binding: the external guard ledger should bind `runId` to the accepted write event and exact marker identity, such as marker path plus canonical marker payload hash plus repo/tree/commit context, and validation should accept only that ledger-bound original record while rejecting the same `runId` in any other marker/location/context.

**Low** — Typo in a normative field name could cause implementation ambiguity.  
[ADR-evidence-a07-marker-provenance.md](/Users/zhongyibao/ClaudeProjects/lawbar-tool/docs/adr/ADR-evidence-a07-marker-provenance.md:68) defines `provenancePayloadHash`, but [line 71](/Users/zhongyibao/ClaudeProjects/lawbar-tool/docs/adr/ADR-evidence-a07-marker-provenance.md:71) says `provancePayloadHash`. This is minor, but it is inside the HMAC/signature definition, so it should be fixed before implementation WIs cite it.

No Critical or High findings.

The ADR is otherwise design-only and non-authorizing: status and sequencing explicitly deny marker write, provenance/HMAC code, guard implementation, EVW5 hooks, and `dev-memo/run/evidence/**` creation. It covers schema-valid vs provenance-valid, artifact re-read and hash recomputation, missing/invalid HMAC failure, `isMarker=false` insufficiency, anti-circular payload hash, binding to fixture/oracle/harness/result/command/offline context, `pass` + `ok` eligibility only, Class-2 exclusion, `not_implemented = FAIL`, guard-before-write sequencing, and key custody as a deferred Stop-and-Ask.

Verdict: **Pass with one Medium design gap to close before implementation authorization.**
