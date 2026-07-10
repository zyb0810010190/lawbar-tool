# Plan — WI-OCR-CONFIG-PATH-REDACTION-22

**Type**: SECURITY/logging hardening (code + test + docs). **No product/schema/data-model change.** Follows
`WI-OCR-CONFIDENTIALITY-RETENTION-21` (which disclosed the one config-path emission). `main` @ `2c839ee`.

## First step (done)

Due Layer-B closeout for window `670e28e..2c839ee` → `audit-mrejegzj-2c6uba` **BATCH-PASS C0 H0 M0 L1** (one
undescribed Low, test/docs window) → closeout `c6831e0`, marker → `2c839ee`.

## Goal

Reduce OCR operator **config path** disclosure in logs while preserving useful diagnostics.

## Path-disclosure inventory

| Surface | Path class | Disposition |
|---|---|---|
| `cli.ts` startup config summary (stderr) | operator config: `sqlite_path`, `fetcher_file_root` | **REDACTED** to `fp:<hash>` |
| `cli.ts` runtime `fetcher_file_root` stat errors (`OcrWorkerConfigError`) | operator config | **REDACTED** to `fp:<hash>` |
| `config.ts` parse validation `must be an absolute path (got <raw>)` | operator input, **non-absolute** only (no home dir) | **retained** (operator needs to see their invalid value; parse-time, not operational log) — documented |
| `engines/paddleocr-onnx.ts` `SANITIZED_FETCHER_MESSAGES` | document-derived (fetcher) | **already sanitized** (audit 019e3a2e D2) — durable envelope carries a stable path-free message |
| `fetchPageBytes.ts` `source.path` in `FetcherError.message` | document-derived | thrown raw but **not logged** — engines/loop/coordinator have **zero** `console`/`writeErr`; the durable result is the sanitized message; the coordinator loop-error events are queue-layer errors, not fetcher errors |
| engine temp input path | temp | **never logged** (`mkdtemp` 0o700, `finally` cleanup) |

## What was changed

- `services/ocr-worker/src/cli.ts` — added `redactPathForLog(p)` = `fp:<8-hex SHA-256 of the full path>` (no path /
  dir / basename — a directory's basename can itself be a client folder, so fingerprint-only is the safe uniform
  choice; stable per full path for operator correlation). Applied to the startup summary (`sqlite_path`,
  `fetcher_file_root`) and the two runtime `fetcher_file_root` `OcrWorkerConfigError` messages. Non-path fields
  (`worker_kind`, `persistence`, `queue`, …) are unchanged (ADR-11C.3c diagnostic intent preserved).
- `services/ocr-worker/tests/cli.sqlite.test.mjs` — a redaction regression: the startup log leaks **no** full path /
  parent dir / basename (deliberately identifying-token temp path), only `"sqlite_path":"fp:<hex>"`.
- `dev-memo/ocr-confidentiality-retention.md` — the WI-21 "config-path disclosure" caveat replaced by
  §"Config-path redaction" (resolved).

## Requirements honored

No real client data (synthetic identifying tokens are fake); `dev-memo/run/intake/` untouched; OCR real-inference
CI + the no-OCR-text-in-logs regression unweakened (both still pass); no accuracy change; no cloud/network; no
generated artifacts/secrets committed; no UI change.

## Acceptance (met; live on PR)

Local: redaction test passes; default ocr-worker suite **473 pass / 3 skipped** (475→476 with the new test);
real-engine smoke **10 pass**; `case-box-persistence` **589/273/288**. Live: the `ocr-chain` job on this PR.

## Out of scope

Redacting the parse-time `config.ts` validation echo (retained for operator fixability; non-absolute input only);
any product/schema change; document-path handling (already sanitized); accuracy work.
