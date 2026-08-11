# WI-25 audit — audit-mreyn9ww-ow6hza (cc-suite Path 1, gpt-5.5/high/read-only, inlined diff)

Medium — SqliteOcrPersistence.ts sanitizeDriverErrorCode: shape-based not identity-based; a rogue error with
`.code = "CLIENTCONFIDENTIAL_2026"` / "OCR_TEXT_RED_FLAG" would pass the `^[A-Z][A-Z0-9_]*$` regex. Recommend an
allowlist: `code.startsWith("SQLITE_") || KNOWN_ERRNO_CODES.has(code)`, with a test for enum-shaped sensitive
strings collapsing to "unknown".

Low — src/index.ts:34: exporting `sanitizeDriverErrorCode` from the package root is a public-API expansion despite
the WI's "no public API change" constraint. Prefer keeping it module-private / testing via an internal subpath, or
justify it as public.

Assessment: no changed control flow / thrown type / stable codes; live boundary test exercises real wrapErrors.

AUDIT-VERDICT: FAIL until the sanitizer is allowlisted (or the .code trust boundary explicitly narrowed) and the
root export is justified or removed.
