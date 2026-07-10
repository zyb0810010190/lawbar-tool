# Plan — WI-OCR-PERSISTENCE-ERROR-SANITIZATION-25

**Type**: SECURITY / confidentiality hardening (persistence error-message boundary + tests + docs). Touches the
local-store persistence boundary → cc-suite broker required (Path 1). **No schema / data-model / UI / public-API
change**; stable `OcrPersistenceError` / `OcrQueueError` codes preserved. Closes the WI-24 row #9 follow-up.
`main` @ `724c4bb` (marker advanced to `724c4bb` by the due closeout below).

## First step (done)

Due Layer-B closeout for window `4a50dff..724c4bb` (PR #259) → `audit-mrey37i3-wb0ukq` **BATCH-PASS C0 H0 M0 L1**
(one undescribed Low on a test/docs window) → closeout `5d1bede`, marker → `724c4bb`. Attestation:
`dev-memo/study/2026-07-10-batch-audit-259.md`.

## Goal

Verify + harden OCR persistence-error messages so DB / local-store failures cannot leak filesystem paths, SQL
fragments, schema identifiers, raw OCR text, or document names — across the persistence boundary and into
observability/logs. Preserve stable codes; keep diagnostic value through a coarse code, not raw string forwarding.

## Investigation (full inventory in `dev-memo/ocr-persistence-error-sanitization.md`)

Seven surfaces mapped. Domain `OcrPersistenceError` messages, `OcrQueueError` throws, and downstream
`PartialFailureDigest` are already sanitized/hand-authored (path/SQL/text-free). One real gap:
`SqliteOcrPersistence.wrapErrors` forwarded the raw better-sqlite3 `err.message` verbatim
(``internal db error: ${err.message}``) — contradicting its own docstring's no-leak promise, and reaching the
coordinator `persistence_failed` observability event → stderr/CI logs.

## Gap found + fixed (smallest safe surface)

Emit only the driver's **stable `.code`** (`SQLITE_*` / errno enum) — never its free-text `.message`. Added a
`sanitizeDriverErrorCode(err)` that is an **allowlist**: it returns `.code` iff it is a known Node errno OR a
`SQLITE_`-prefixed enum token (`^SQLITE_[A-Z0-9_]+$`), else `"unknown"` — so a rogue enum-shaped-but-sensitive
`.code`, a numeric code, or a non-string collapses to `unknown` (cc-suite audit Medium; a shape-only regex would
have let an enum-shaped sensitive code through). `wrapErrors` now emits
``internal db error: ${sanitizeDriverErrorCode(err)}``. Docstring corrected to match. Prefix + all domain messages
+ stable codes unchanged. The sanitizer is a module-level export only — **not** re-exported from the package root,
so the public surface is unchanged (audit Low); the test reaches it via the internal dist path. Coordinator
surface inherits the fix; queue-side + startup driver messages are empirically verified path-free (open failures
carry no path; operational errors carry at most a code-level schema identifier, never client data).

## What was added / changed

- `services/ocr-persistence/src/sqlite/SqliteOcrPersistence.ts` — allowlist `sanitizeDriverErrorCode`
  (module-level export only; not on the package root) + sanitized `wrapErrors` + corrected docstring.
- `services/ocr-persistence/tests/sqlite.hardening.test.mjs` — boundary test now asserts code-only + no raw body;
  new direct sanitizer test imported via the internal dist path (allowlisted SQLITE_ / errno pass; enum-shaped
  sensitive / SQLITE_-with-bad-chars / numeric / no-code / free-text all → `unknown`).
- `dev-memo/ocr-persistence-error-sanitization.md` + this plan.

## Requirements honored

No real client data; no external network; `dev-memo/run/intake/` untouched; stable error codes preserved; no
data-model / schema / UI / public-API change; OCR CI + real-inference smoke + confidentiality + path-redaction +
SSRF + failure-mode-determinism gates unweakened; no accuracy work; no cloud/remote; no generated
artifacts/models/secrets committed.

## Acceptance (met; live on PR)

Local: `ocr-persistence` 232/232 (incl. the code-only boundary test + the direct sanitizer test);
`ocr-worker` 479/479 (3 skipped); `case-box-persistence` 288/288. Live: `ocr-chain` + `case-box-persistence` jobs
on the PR exercise the built persistence dist through the sanitized boundary.

## Out of scope

Symmetric `SqliteOcrQueue` unexpected-driver-error sanitization (verified path-free — schema identifiers only, no
client data; a bounded uniformity follow-up, not a confidentiality fix); any product/schema change; OCR accuracy;
cloud/remote.
