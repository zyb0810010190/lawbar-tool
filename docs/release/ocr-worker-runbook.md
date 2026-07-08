# OCR Worker Runbook — reconciled to v1 local-first (post-v1 server-mode)

**Status:** completed + reconciled (WI-RELEASE-G13-OPERATOR-CHECKLIST-RUNBOOK-00 execution). Supersedes the prior `scaffold` state. **Date:** 2026-07-07.

> **RECONCILIATION-NEEDED (logged here + in the exec commit message + in the exec review artifact).**
>
> **What was stale.** The original scaffold framed this runbook as an OCR-worker **service** production runbook: a deployed process with a `NODE_ENV=production` profile, an `OCR_FETCHER_HTTPS_HOSTS` allowlist, pre-signed HTTPS / S3-rejected source fetching, a healthcheck, and shutdown signals.
>
> **Why it is deferred.** That framing predates the locked v1 posture. Two facts reconcile it:
> 1. The OCR worker is **not wired into the v1 Mac desktop client** — verified: `apps/lawbar-desktop/` contains no OCR import or `OCR_WORKER` reference. The v1 day-one product is the Mac desktop app; it does not run or depend on the OCR worker service.
> 2. Per `.claude/rules/client-local-first.md`, when OCR **is** integrated it is an **in-process / local-loopback** transport for the Mac client — **not** a public/deployed service, not a website, not a multi-tenant endpoint. A public OCR service with an external HTTPS-host allowlist is **not** the v1 direction.
>
> **Resolution.** Every service-mode section below is retained but **explicitly labelled `post-v1 / deferred`**, with a note of what it would mean under the locked local-first direction. Nothing is silently rewritten or erased (audit trail per `client-local-first.md` §"Reconciliation duty"). A future ADR / reconciliation WI owns any decision to ship OCR into the client and to fix its transport shape; this runbook does not decide it. Gate 2 (OCR pipeline) stays **PARTIAL** and is **not** cleared by this runbook.

---

## v1 status: OCR is not part of the day-one Mac-client surface

For v1 there is **no OCR worker to operate**. The OCR service packages (`services/ocr-{worker,persistence,ingestion,review}`) exist and are test-verified as standalone packages (`docs/release/gate2-ocr-pipeline-verify-00.md`, 771 pass / 0 fail / 3 env-gated skip), but they are not wired into the shipped Mac app, and the real-PaddleOCR engine path is model-gated / post-v1 (gate-2 residual R-G2-3). The v1 operator surface is the Mac client itself — see `docs/release/operator-checklist.md`.

The sections below describe how the OCR worker **would** be operated **if/when** it ships. They are **post-v1 / deferred** and are not v1 go-live steps.

## post-v1 server-mode — HTTPS source policy (allowlist, pre-signed URL expiry, no redirects, no proxy)
`post-v1 / deferred.` Under the locked local-first direction, when OCR is integrated it runs in-process / local-loopback for the Mac client; an external HTTPS-host allowlist / pre-signed-URL fetch is a service-mode concern that does not apply to a local-loopback worker. Any decision to admit external HTTPS sources is a future ADR (see the reconciliation note above).

## post-v1 server-mode — production profile (env vars)
`post-v1 / deferred.` The service env profile (`NODE_ENV=production`, `OCR_WORKER_REQUIRE_REAL=1`, `OCR_WORKER=paddleocr-onnx`, `OCR_FETCHER_FILE_ROOT`, `OCR_FETCHER_HTTPS_HOSTS`, SQLite path, queue selector, persistence selector) describes a deployed service. The v1 Mac client has no such profile. If OCR is later embedded, its configuration is an in-process concern of the client, resolved without a public service profile.

## post-v1 server-mode — production fail-closed behavior (exit code 2 for invalid profile)
`post-v1 / deferred.` Fail-closed-on-invalid-profile is a service-startup guarantee; it applies to a standalone worker process, not to the v1 Mac client (which does not launch the worker).

## post-v1 server-mode — retry / dead-letter observability (`OCR_LOG_OUTCOMES`, structured events, `max_attempts`)
`post-v1 / deferred.` The retry / dead-letter observability surface is verified at the package level (gate 2, `observability.test.mjs`) but is not operated in v1. When OCR ships in-client, observability is a local concern (no external egress — consistent with gate 20).

## post-v1 server-mode — pending-retry recovery
`post-v1 / deferred.` Pending-retry reconciliation is an OCR-service persistence concern. The v1 Mac client's own persistence recovery is covered by gate 14 (backup/recovery) + the gate-12 tamper-evidence drill, not by this section.

## post-v1 server-mode — source-kind policy (file / inline / HTTPS admitted; S3 rejected)
`post-v1 / deferred.` Source-kind admission (and the standing rejection of direct S3) is a service-fetcher policy. It does not describe v1 Mac-client operation; it is retained as a record of the OCR service's designed policy for the future integration decision.

## post-v1 server-mode — day-0 operations (startup, log location, healthcheck, shutdown signals)
`post-v1 / deferred.` Startup / healthcheck / shutdown-signal operations describe a long-running service process. The v1 Mac client's day-0 operations (launch, data location, quit/restart, FileVault gate) are in `docs/release/operator-checklist.md` §1 instead.

## No PDF support in v1 (upstream rasterization responsibility)
Retained as a **factual v1 note** (not service-mode): the OCR pipeline does not accept PDF directly; rasterization is an upstream responsibility. The v1 Mac client's own document ingestion happens at the client layer, independent of the deferred OCR service. (The precise v1 client ingest formats are defined by the project brief / client surface, not certified by this runbook.)

## Adding a proxy or connection pooling requires a new ADR
Retained: any future OCR transport change (proxy, connection pooling, or the local-loopback integration itself) requires a new ADR — reinforced by the reconciliation note above.

---

## Cross-references (references, not clearances)
- `docs/release/gate2-ocr-pipeline-verify-00.md` — OCR pipeline test-sweep evidence (gate 2 stays PARTIAL).
- `docs/release/operator-checklist.md` — the v1 Mac-client operator surface (the real v1 day-one operations).
- `.claude/rules/client-local-first.md` — the locked v1 posture governing this reconciliation.
- `docs/release/go-live-readiness-report.md` — gate 13 stays **OPEN**; gate 2 stays **PARTIAL**. This runbook clears no gate and implies no go-live.
