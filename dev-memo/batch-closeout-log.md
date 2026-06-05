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
- 2026-06-04T23:48:40.768Z OLD=350a7ab84f0df4ef656d6b94f4932269b07d3382 HEAD=f446807691f844532fb6ae3bf34811e6c6b8de30 job=audit-mq05884f-juk8gv sha256=66cae977414ab1e66a279d99e49c9b1c6bb7986cd43ab1353634c217c4947c30 attestation=dev-memo/study/2026-06-04-batch-audit-44.md
- 2026-06-05T04:41:59.396Z OLD=f446807691f844532fb6ae3bf34811e6c6b8de30 HEAD=4f806a61d265197573cddb9ebb352e8cf56408e0 job=audit-mq0fp3v2-klvz5u sha256=3d141101be57c79144999f6c226acfc57b36dae63970fb8d9d024d6b50f04c13 attestation=dev-memo/study/2026-06-05-batch-audit-45.md
- 2026-06-05T05:30:54.860Z OLD=4f806a61d265197573cddb9ebb352e8cf56408e0 HEAD=9cf96a0d1d8235e9f95f6671c0f46d956c5c774a job=audit-mq0hg6uz-z31u00 sha256=1cc04220d4a90c91385c4b04d3f9ba051eb7ac9acbcb2ab45786bef06bba4d9a attestation=dev-memo/study/2026-06-05-batch-audit-46.md
- 2026-06-05T05:58:53.515Z OLD=9cf96a0d1d8235e9f95f6671c0f46d956c5c774a HEAD=b73712283b0f1846d30dcdab0df0c8b43db75590 job=audit-mq0igtnv-3vrkdo sha256=c7b1d866e52fb1acf2d4121ca66c898652ab39d51e7ce139b8266c0bc89e95e5 attestation=dev-memo/study/2026-06-05-batch-audit-47.md
- 2026-06-05T06:09:51.043Z OLD=b73712283b0f1846d30dcdab0df0c8b43db75590 HEAD=cb7486d4cff309e54f27a0f801ea84401ef6ca7a job=audit-mq0iwk5v-8xggv0 sha256=64babf8b27caa9492f2137ecc86421143d4a532ea12552c4efe101b9e36c1cf5 attestation=dev-memo/study/2026-06-05-batch-audit-48.md
- 2026-06-05T06:58:08.438Z OLD=cb7486d4cff309e54f27a0f801ea84401ef6ca7a HEAD=f4443251a86be2a36e948cfb96dfc376d8e62498 job=audit-mq0klouf-br8zcj sha256=3c0d9c32050aa73b308197e0c67e2792e19758bf13b11a9f59211a188b5df410 attestation=dev-memo/study/2026-06-05-batch-audit-49.md
- 2026-06-05T07:11:27.550Z OLD=f4443251a86be2a36e948cfb96dfc376d8e62498 HEAD=bf8df092abf847349d6f736ed90119117aa364f4 job=audit-mq0l2wsh-9ht7f0 sha256=673967ca0a6d2d0469760714145a8f5b9a698f0635a4a193dcfa96c959239941 attestation=dev-memo/study/2026-06-05-batch-audit-50.md
- 2026-06-05T09:35:51.346Z OLD=bf8df092abf847349d6f736ed90119117aa364f4 HEAD=7c306648ac1e9b198211555d5e5dcd615e004471 job=audit-mq0q7zj2-tq0fwy sha256=7162c5c799926027a876ceb10f21201a8ede72c1c51f473aa0f5b6bf73c727f1 attestation=dev-memo/study/2026-06-05-batch-audit-51.md
