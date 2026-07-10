# OCR persistence-error sanitization

**WI**: `WI-OCR-PERSISTENCE-ERROR-SANITIZATION-25`. Verifies + hardens OCR persistence-error messages so
DB / local-store failures cannot leak filesystem paths, SQL fragments, schema identifiers, raw OCR text, or
document names across the persistence boundary or into observability/logs. **Outcome: one real gap found + fixed**
— the `SqliteOcrPersistence.wrapErrors` boundary forwarded the raw better-sqlite3 `err.message` verbatim, directly
contradicting its own docstring's no-leak promise. Fixed to emit only the driver's stable `.code`. This is the
documented follow-up flagged in `dev-memo/ocr-failure-mode-determinism.md` row #9 (WI-24 audit L2).

## The gap (confirmed)

`services/ocr-persistence/src/sqlite/SqliteOcrPersistence.ts` `wrapErrors` converts any unexpected thrown value
into an `OcrPersistenceError` so callers see one error type. Its docstring promised: *"raw driver internals
(`SqliteError: SQLITE_*`, native error codes, connection state) cannot leak across the persistence boundary."* But
the code did:

```ts
const msg = err instanceof Error ? err.message : String(err);
throw new OcrPersistenceError(`internal db error: ${msg}`);
```

— it **forwarded the raw driver `err.message` verbatim**. A better-sqlite3 `SqliteError.message` can embed:

- a **schema identifier** — `no such table: ocr_jobs`, `UNIQUE constraint failed: case_box_ocr_links.document_id`;
- a **SQL fragment** — the offending statement text on some errors;
- (version-dependent) a **file path** on open/IO failures.

That wrapped message then flows out of the persistence layer into the coordinator's `persistence_failed`
observability event (`error.message`), which the cli writes to stderr / CI logs. So the docstring's guarantee was
false and a raw driver message could reach a log surface.

## The fix (smallest safe surface)

Emit only the driver error's **stable code**, never its free-text message. Added a module-level
`sanitizeDriverErrorCode(err)` (an **allowlist**, not a shape match):

```ts
const KNOWN_ERRNO_CODES = new Set([ "ENOENT","EACCES","EPERM","EROFS","ENOSPC",
  "EIO","EBUSY","EEXIST","ENOTDIR","EISDIR","EMFILE","ENFILE","ELOOP","EDQUOT",
  "ENOMEM","EAGAIN" ]);

export function sanitizeDriverErrorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (typeof code !== "string") return "unknown";
  if (KNOWN_ERRNO_CODES.has(code)) return code;
  if (/^SQLITE_[A-Z0-9_]+$/.test(code)) return code;
  return "unknown";
}
```

`wrapErrors` now throws ``new OcrPersistenceError(`internal db error: ${sanitizeDriverErrorCode(err)}`)``.

Rationale:

- A `SqliteError.code` (`SQLITE_BUSY`, `SQLITE_CONSTRAINT_UNIQUE`, `SQLITE_CANTOPEN`, `SQLITE_READONLY`, …) and a
  Node errno (`ENOENT`, `EACCES`, …) are **fixed enums** — no path / SQL / schema identifier / OCR text. They
  keep the diagnostic **class** (which failure) without the sensitive **body**.
- The match is **identity-based**: only a known errno OR a `SQLITE_`-prefixed enum token survives. A rogue
  non-driver error whose `.code` is itself an enum-shaped sensitive string (`CLIENTCONFIDENTIAL_2026`,
  `OCR_TEXT_…`), a `SQLITE_` token carrying non-enum characters, a numeric code, or a non-string all collapse to
  the opaque `"unknown"` — a shape-only regex would have let the first case through (cc-suite audit
  `audit-mreyn9ww-ow6hza` Medium).
- The stable `internal db error: ` prefix is retained (callers / the existing test key on it); the domain
  `OcrPersistenceError` class + all existing hand-authored `OcrPersistenceError` messages (cursor / validation /
  linkage / duplicate-key) and `OcrQueueError` stable codes are unchanged. No data-model / schema / public-API
  change.

## Surface inventory

| # | Surface | Source | Verdict |
|---|---|---|---|
| 1 | `SqliteOcrPersistence.wrapErrors` unexpected-driver wrap | this WI | **was raw `err.message`; FIXED → code only** |
| 2 | `OcrPersistenceError` domain messages (`cursor.ts`, `inMemoryRepo.ts`, validation/linkage/dup-key) | hand-authored | safe — job_id / limit / cursor tokens; no path / SQL / text |
| 3 | `SqliteOcrQueue` throws | hand-authored `OcrQueueError` (stable codes) | safe — coded, hand-authored strings (receipt/job ids), no path / SQL / text |
| 4 | `SqliteOcrQueue` **unexpected** driver error escaping raw → coordinator `errorMessage()` | driver | **retained, low-risk** — see note below |
| 5 | coordinator `persistence_failed` obs event `error.message` | copies `errorMessage(persistenceErr)` | now inherits the sanitized persistence message (surface 1) |
| 6 | cli startup `openSqlite*` failure → `startup error: ${describeError(err)}` | driver | **path-free in this driver** — see note below |
| 7 | downstream `ocr-review` `PartialFailureDigest.message` | upstream-sanitized fetcher message (WI-24) | safe — path-free by construction |

### Note — surfaces 4 & 6 (retained, verified path-free)

Empirically pinned against the installed `better-sqlite3` build:

- **Open failures are path-free.** `SQLITE_CANTOPEN` → `"unable to open database file"`; `SQLITE_NOTADB` →
  `"file is not a database"`; a missing parent directory → `"Cannot open database because the directory does not
  exist"`. None embed the path. So the cli startup surface (6) and any queue-open surface do not leak the client
  DB path.
- **Operational driver messages carry at most a schema identifier**, never client data. Constraint/logic errors
  name the index/columns (`case_box_ocr_links.document_id`), which are **code-level identifiers in the public
  repo** — not client-confidential. The client-confidential targets — file paths (name the client/matter), OCR
  text, document names — never appear: paths are not embedded in these messages, and row **values** are
  parameter-bound (a UNIQUE error names the constraint, not the offending value).

Surface 4 (an unexpected driver error escaping a `SqliteOcrQueue` method raw into the coordinator's
`errorMessage()`) therefore forwards at most a path-free schema identifier. It is left as-is under the WI's
"smallest safe surface" rule: the queue makes no docstring no-leak promise, and wrapping every queue method risks
the stable `OcrQueueError` codes for no confidentiality gain (no client data is exposed). If symmetric queue-side
sanitization is later wanted for uniformity, it is a bounded follow-up, not a confidentiality fix.

## What was added / changed

- `services/ocr-persistence/src/sqlite/SqliteOcrPersistence.ts` — `sanitizeDriverErrorCode` (allowlist) +
  `wrapErrors` now emits the stable code, not the raw message; docstring corrected to match the code. The function
  is a **module-level export only** — deliberately **not** re-exported from the package root, so the package's
  public surface is unchanged (cc-suite audit `audit-mreyn9ww-ow6hza` Low). The test imports it via the internal
  dist path.
- `services/ocr-persistence/tests/sqlite.hardening.test.mjs` — the existing boundary test now asserts the wrapped
  message is exactly `internal db error: <ENUM_CODE>` and **does not** contain the raw driver body (`no such
  table`, `ocr_jobs`); a new test drives `sanitizeDriverErrorCode` against a synthetic path-carrying
  `SQLITE_CANTOPEN`, a SQL/schema `SQLITE_CONSTRAINT_UNIQUE`, a known errno (`ENOENT`), and the rejection cases —
  an enum-shaped-but-sensitive `.code` (`CLIENTCONFIDENTIAL_2026`), a `SQLITE_`-with-non-enum-chars token, a
  numeric code, and no/free-text code — proving only allowlisted codes survive and everything else collapses to
  `unknown`.
- This doc + the plan. Coordinator/queue source unchanged (surface 5 inherits the fix; surfaces 4/6 verified
  path-free).

## Requirements honored

No real client data (synthetic error shapes only); no external network; `dev-memo/run/intake/` untouched; stable
`OcrPersistenceError` / `OcrQueueError` codes preserved; no data-model / schema / UI / public-API change; OCR
CI + real-inference smoke + confidentiality + path-redaction + SSRF + failure-mode-determinism gates unweakened;
no accuracy work; no cloud/remote; no generated artifacts / models / secrets committed.

## Acceptance (met; live on PR)

Local: `ocr-persistence` 232/232 (incl. the two sanitization tests); `ocr-worker` 479/479 (3 skipped);
`case-box-persistence` 288/288. Live: the `ocr-chain` job + `case-box-persistence` job on the PR run the built
persistence dist consuming the sanitized boundary.

## References

- `services/ocr-persistence/src/sqlite/SqliteOcrPersistence.ts` (`sanitizeDriverErrorCode`, `wrapErrors`).
- `services/ocr-worker/src/coordinator.ts` (`persistence_failed` outcomes, `errorMessage`), `src/cli.ts`
  (`describeError`, `redactPathForLog` — WI-22).
- `dev-memo/ocr-failure-mode-determinism.md` row #9 (the WI-24 follow-up this WI closes).
- `dev-memo/ocr-confidentiality-retention.md`, `dev-memo/ocr-fetcher-security.md` (WI-21/22/23).
