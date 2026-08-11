Low - [ADR-evidence-a3-durable-unlink-schema.md](/Users/zhongyibao/ClaudeProjects/lawbar-tool/docs/adr/ADR-evidence-a3-durable-unlink-schema.md:72): `unlink_reason` is described as recording “who/why,” but the chosen tight row shape only adds `unlinked_at` + `unlink_reason`; no actor/user field is chosen, and the audit-event shape is explicitly deferred. Fix: change this to “why/reason is recorded on the row; actor/who and event shape are deferred to the audited operation WI.”

No Critical/High/Medium findings. Option 1 resolves the durability finding at the design level: the marker is durable, resolver-aware, export reads the marker as a hard clean-export override, `anchor_id NOT NULL` and `LinkStatus` remain intact, and V11->V12 is correctly framed as future additive migration work. Rejected alternatives and A0.7/docs-only boundaries are sound.

AUDIT-VERDICT: PASS C0 H0 M0 L1
