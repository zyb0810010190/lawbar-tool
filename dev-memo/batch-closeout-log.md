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
