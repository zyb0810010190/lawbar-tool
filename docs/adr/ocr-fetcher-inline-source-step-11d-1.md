# ADR: Fetcher — `inline` Source Kind (Step 11D.1)

## Status

Accepted. **Decision + code**. First staged unit of ADR-11D (source-kind
expansion beyond `file://`). Opens the fetcher to `kind: "inline"`
submissions: the page bytes ship inside the submission payload itself,
base64-encoded. No filesystem I/O on the fetcher side; the existing
bytes → temp file → engine bridge handles the path-bound engine call.

Companion code:
- `services/ocr-worker/src/fetcher/fetchPageBytes.ts` — `inline`
  dispatch.
- `services/ocr-worker/src/fetcher/types.ts` — no new error codes
  (everything reuses existing codes; see §3).
- New tests in fetcher.test.mjs + adapter test for inline integration.

## Context

ADR-11C.2 §1 admitted only `kind: "file"` and rejected `s3 | https |
inline` with stable code `source_kind_unsupported`. The schema has
admitted all four kinds since pre-11C; the fetcher was the gate. ADR-11D
expands that gate one kind at a time so each addition can land + audit
+ verify cleanly.

User decisions captured this session:
1. **Order**: inline first (no network, no SSRF, no credentials —
   simplest source-kind admission flow + sets the dispatch pattern).
2. **Retry classification**: deferred to a future ADR. Inline fetcher
   errors stay terminal-failed for v1, same as file errors.

Why inline first:
- The schema already constrains `inline.byte_size` to `[1, 1048576]`
  (1 MB cap, hardcoded at the schema layer).
- Schema also constrains `inline.base64` to `^[A-Za-z0-9+/=\\n\\r]+$`
  — character-level base64 validation already happens upstream.
- No new dependencies. No allowlist design. No SSRF surface.

## Decisions

### §1 Dispatch on `source.kind`

`services/ocr-worker/src/fetcher/fetchPageBytes.ts`:

The existing source-kind gate becomes a SWITCH:

```ts
switch (source.kind) {
  case "file":
    return fetchFromFile(source, deps);
  case "inline":
    return fetchFromInline(source);
  default:
    throw new FetcherError(
      `source kind ${JSON.stringify(source.kind)} is not supported in v1`,
      { code: FETCHER_ERROR_CODES.SOURCE_KIND_UNSUPPORTED },
    );
}
```

`s3` and `https` continue to hit the `source_kind_unsupported` arm.
The dispatch table grows by one row per future 11D step.

### §2 `fetchFromInline` semantics

Pure (no I/O beyond CPU-bound base64 decode). Sequence:

1. **Base64 decode**: `Buffer.from(source.base64, "base64")`. Node's
   default base64 decoder is PERMISSIVE — it accepts non-canonical
   inputs (extra padding, mixed whitespace, lowercase padding) and
   silently filters invalid characters. The schema's pattern enforces
   only the character ALPHABET (`[A-Za-z0-9+/=\\n\\r]`) at the
   envelope layer; it does NOT enforce canonical encoding (correct
   padding count, output length matches `4 * ceil(N / 3)`). The
   fetcher does NOT add a strict canonicality check; instead the
   load-bearing gate is step 2 below, which catches the case where
   a malformed encoding decodes to a length other than the caller
   declared. Audit 019e3ad6 D1 Medium: this caveat is documented
   honestly here and in the code so future readers don't expect a
   stronger guarantee than is enforced.

2. **Inline-specific size cap**: `decoded.byteLength <= 1 MB`
   (`MAX_INLINE_BYTES`). Mirrors the schema's
   `inline.byte_size.maximum` so a schema-bypassed inline payload
   still fails at the fetcher rather than being processed up to the
   wider 50 MB file cap. Audit 019e3ad6 D5 Medium fix. Checked
   BEFORE the byte_size match so a bypassed-and-huge payload
   rejects with the more specific cap code, not a confusing
   "mismatch" message.

3. **Declared byte_size match**: `decoded.byteLength === source.byte_size`
   or throw `size_mismatch`. Pins the submission contract: the
   caller said how many bytes the decoded payload would be; if it
   disagrees, something is wrong upstream (or the base64 is
   malformed — see step 1 honest-caveat note).

4. **Wide-bound size cap (50 MB)**: defense-in-depth in case the
   inline-specific cap above ever widens. Cheap; same constant as
   the file path.

4. **MIME allowlist**: `source.mime_type` in
   `{"image/jpeg", "image/png"}` or throw `mime_unsupported`.
   Same allowlist as file://, same rationale (ADR-11A.0 §8
   anti-PDF policy).

5. **MIME signature sniff**: bytes start with the declared MIME's
   magic-byte signature or throw `mime_signature_mismatch`. Same
   PNG/JPEG signatures as the file path.

6. Return `{ bytes: decoded, mimeType: source.mime_type,
   sizeBytes: decoded.byteLength }`.

Step order rationale: gates are ordered cheap-before-expensive plus
specific-before-general. The MIME allowlist runs before decode (no
need to base64-decode 1 MB just to reject as PDF). The inline cap
runs before the byte_size match so an oversized bypass surfaces
with the more actionable code.

No path-containment checks (no path). No file_root_unconfigured
check (inline doesn't read the disk). No fd-bound open/fstat/read
(no fd; bytes are already in memory). No realpath / stat / TOCTOU
concerns.

### §3 No new error codes

Every reachable failure for inline maps to an existing
`FETCHER_ERROR_CODES` entry:

| Failure | Code |
|---|---|
| `source.byte_size` ≠ decoded length | `size_mismatch` |
| Decoded > 50 MB cap | `size_cap_exceeded` |
| MIME not in allowlist | `mime_unsupported` |
| Bytes don't match declared MIME signature | `mime_signature_mismatch` |

`source_kind_unsupported`, `multi_page_unsupported`,
`file_root_unconfigured`, `path_escape`, `file_not_found`,
`file_not_regular` are file-only and never fire for inline.

The error-code registry stays a closed surface; consumers branching
on codes don't need to learn new strings.

### §4 `OCR_FETCHER_FILE_ROOT` stays required when worker = paddleocr-onnx

Even though inline submissions don't need a file root, the bin
configuration enforces it (ADR-11C.3c §1). Reason: the bin doesn't
know at startup what mix of source kinds it will receive. A
deployer who's only ever going to send inline can set
`OCR_FETCHER_FILE_ROOT=/dev/null` — wait, that fails the directory
stat check from 11C.3c audit fix. So they'd need to set it to ANY
existing directory (e.g., `mkdir -p /tmp/ocr-unused`).

This is a small friction; relaxing it (e.g., "fetcher_file_root
optional when no file:// submissions are expected") would require
a new config knob with no clear use case yet. Defer until a real
caller needs inline-only deployment.

### §5 Out of scope (deferred)

- **`https` source kind** — ADR-11D.2. SSRF mitigation, host
  allowlist, max-redirect cap, signed-URL expiry, undici timeout.
- **`s3` source kind** — ADR-11D.3. AWS SDK v3 dep, bucket
  allowlist, IAM scope, region config.
- **Retry classification** — ADR-11E. Transient vs permanent
  fetcher errors mapping to coordinator requeue vs terminal-failed.
- **`expected_sha256` content hash verification** — schema admits
  this field on `s3` and `https` sources but not `inline`. Not
  currently consumed by the fetcher. Future ADR.

## Consequences

- One more source kind admitted; the dispatch shape is set.
- Inline submissions don't need a file root at all, but the bin
  still requires one (see §4).
- The temp-file bridge from ADR-11C.3a §5 carries inline bytes the
  same way it carries file:// bytes — engine path discipline is
  unchanged.
- No new dependencies. Native binaries stay limited to
  `@gutenye/ocr-node`'s transitive set.

## Open questions (for 11D.2 / 11D.3)

- Q1 (11D.2): how is the host allowlist configured — env var with
  comma-separated hosts, or a JSON file? Provisional: env var with
  exact-host matching (no wildcards yet).
- Q2 (11D.2): max redirect count — 0 (no redirects, signed URLs
  only), 3 (typical), or 5? Provisional: 0 — signed URLs are
  expected to be direct.
- Q3 (11D.3): AWS credential sourcing — env vars only
  (AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY), or default
  credential chain (IAM role, ~/.aws/credentials)? Provisional:
  env vars only for v1 fail-closed simplicity.

## Rejected alternatives

- **Skip the byte_size check on inline** — would let a corrupt
  base64 string pass through. Catch upstream means catch upstream
  + here; double-checking is cheap.
- **Decode lazily into a stream** — premature; the 1 MB schema cap
  makes whole-decode trivial.
- **Add `invalid_base64` error code** — Node's `Buffer.from(s,
  "base64")` doesn't fail on malformed input; it silently filters
  invalid chars. Adding a code for a failure that can't be
  observed adds surface without coverage. The `size_mismatch`
  check catches the case where filtering produces fewer bytes
  than declared.
- **Strict canonical base64 validation before decode** (audit
  019e3ad6 D1 Medium follow-up) — would require either a regex
  matching the strict 4-char-group form or a round-trip re-encode
  check after decode. Either adds ~20 LOC of code that mostly
  defends against a class of attack with no clear v1 attack
  surface (the schema validator at the envelope already gates the
  alphabet; malicious payloads that lie about byte_size are
  caught by the size-mismatch check anyway). Defer until a real
  caller needs to round-trip the inline payload byte-for-byte.
- **Reject inline for paddleocr-onnx worker** — there's no
  technical reason; inline bytes flow through the same temp-file
  bridge as file:// bytes.
