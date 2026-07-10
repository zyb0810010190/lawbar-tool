# Plan — WI-OCR-FAILURE-MODE-DETERMINISM-24

**Type**: RELIABILITY/SECURITY verification (test + docs). **No product/schema/data-model change.** Follows the OCR
security arc (WI-21 confidentiality, WI-22 config-path redaction, WI-23 SSRF). `main` @ `4a50dff`.

## First step (done)

Due Layer-B closeout for window `8e4977c..4a50dff` → `audit-mreurria-qdciyz` **BATCH-PASS C0 H0 M0 L1** (a stale
`3/3`→`4/4` count in the WI-23 plan — corrected in this WI) → closeout `9b73696`, marker → `4a50dff`.

## Goal

Verify OCR failure paths are deterministic, sanitized, and safe for CI + local legal-data handling.

## Investigation (full inventory in `dev-memo/ocr-failure-mode-determinism.md`)

All 11 failure modes are **comprehensively hardened + tested**: stable codes (`FETCHER_ERROR_CODES` + `engine_failed`);
raw messages substituted with static path-free `SANITIZED_FETCHER_MESSAGES` (D2); exhaustiveness **type-enforced**
(`Record<FetcherErrorCode,string>`); transient/permanent classification (fail-closed to permanent; exhaustively
tested); failed jobs persist a `partial_failure` to the **local** store (not logged); temp cleaned up in a `finally`;
downstream `ocr-review` exposes a `partial_failure` **digest** (code + `is_transient`), no text/path. **No real gap.**

## What was fixed / added

- **Added regression** (`engines.paddleocr-onnx.test.mjs`): `file_not_found` — the most common path-carrying failure
  — now asserts the durable `partial_failure.message` is the sanitized "Source file not found." with **no**
  missing-document path or allowed-root leak (extends the D2 `path_escape` sanitization guarantee).
- `dev-memo/ocr-failure-mode-determinism.md` (inventory) + this plan.
- **Fixed** the WI-23 plan stale test count (`3/3`→`4/4`; batch-258 audit L1).

## Requirements honored

No real client data (synthetic `missing-CLIENT-doc.png` token is fake); no external network; `dev-memo/run/intake/`
untouched; OCR-chain CI / real-inference smoke / confidentiality tests / path redaction / SSRF controls unweakened;
stable error codes preserved; no cloud/remote; no accuracy work; no UI; no generated artifacts/secrets committed.

## Acceptance (met; live on PR)

Local: the `file_not_found` sanitization test passes; full ocr-worker suite; real-engine smoke; `case-box-persistence`
ci + test. Live: the `ocr-chain` job on this PR.

## Out of scope

Any product/schema/data-model change; the intended local persistence of failed results (not a leak); OCR accuracy;
cloud/remote fetch/retention.
