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
