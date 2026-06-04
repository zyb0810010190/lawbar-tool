# Batch-closeout log (tracked, append-only)

Deterministic-rollback source for `scripts/workflow/batch-closeout.mjs` (BATCH-CLOSEOUT-AUTO-00).
Each line records one verified Layer-B batch-audit closeout: the marker advance (`OLD..HEAD`), the
cc-suite broker audit job that authorized it, and the sha256 of that job's `rawOutput`. The closeout
appends a line inside the same commit that advances the marker; on rollback, the `OLD` field is the
deterministic value to which `dev-memo/run/last-batch-audit` is reset.

Line format:

```
- <ISO8601> OLD=<sha> HEAD=<sha> job=<broker_job_id> sha256=<broker_output_sha256> attestation=<path>
```

<!-- entries below, newest last -->
- 2026-06-04T07:55:36.749Z OLD=9ae690cf4a3dbee02220e5962d5b88600cf89907 HEAD=866fd7b1f71e4cdb25782de52d8a1169311e1aeb job=audit-mpz7356b-m2gxa7 sha256=2499e5fa5ffaad240e0a33b5aeb7651f23aacfe113366f41f6df440620226b51 attestation=dev-memo/study/2026-06-04-batch-audit-37-38.md
- 2026-06-04T12:20:51.522Z OLD=866fd7b1f71e4cdb25782de52d8a1169311e1aeb HEAD=1ab188822101096fb73eaae99e800169ca624d92 job=audit-mpzgii4s-0krj7q sha256=c971825b2d5810b45b1b61def253d907c6dd51b9688adbc45e12e6c72dfbbe27 attestation=dev-memo/study/2026-06-04-batch-audit-39.md
- 2026-06-04T13:53:59.158Z OLD=1ab188822101096fb73eaae99e800169ca624d92 HEAD=d36bf00a1940bea11b511978c0f0576f8acfc3a9 job=audit-mpzjwug1-z3ppcs sha256=ba8a86926b125cd42b2432a3e6c56ca90042135e2627ade6a7597bc631195fe4 attestation=dev-memo/study/2026-06-04-batch-audit-40.md
- 2026-06-04T15:15:01.309Z OLD=d36bf00a1940bea11b511978c0f0576f8acfc3a9 HEAD=b60a06120ee620f74fcb2a1d1ec9d5a237e6a134 job=audit-mpzmw82j-ji5rrr sha256=8a6c5a0802625077442c6d227219c26e98118ab4f34ea58abafcf5d8c937e5cf attestation=dev-memo/study/2026-06-04-batch-audit-42.md
- 2026-06-04T16:02:51.050Z OLD=b60a06120ee620f74fcb2a1d1ec9d5a237e6a134 HEAD=350a7ab84f0df4ef656d6b94f4932269b07d3382 job=audit-mpzolzv6-43ld14 sha256=a7445e0b46146b1b697971b4cefbf34eaba0cee8e3a3a1efa66f66048d4ce410 attestation=dev-memo/study/2026-06-04-batch-audit-43.md
