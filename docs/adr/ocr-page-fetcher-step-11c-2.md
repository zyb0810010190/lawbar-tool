# ADR: Real OCR Worker — Page Fetcher (Step 11C.2)

## Status

Accepted. **Decision + code**. Second staged unit of the ADR-11C
sequence (11C.1 mapper shipped at `2dd6a5c` + `3073c17` + `4679959`;
11C.2 fetcher here; 11C.3 wires bin + real-PDF smoke). Pins the
fetch boundary between an `OcrSubmission` and the engine call: which
source kinds are admitted, where the bytes can come from, what
guards run, what error codes callers branch on.

Companion code:
- Schema patch: `docs/contracts/schemas/ocr-submission.schema.json`
  ($defs.source.oneOf gains a `file` variant).
- Implementation: `services/ocr-worker/src/fetcher/`.
- Wiring into the worker bin: deferred to ADR-11C.3.

## Context

ADR-11C.1's mapper is pure over engine output. The engine itself takes
image bytes; something has to deliver them. ADR-11A.0 §10/§11 set the
fail-closed config sequence and engine-load semantics but did not
specify how the worker turns a submission's `source` field into bytes.
ADR-11B §3 already capped jobs at N=1 page (enforced at ingestion by
`854abf8`), which simplifies the fetcher: one source per call, no
multi-page fanout.

User decisions captured in this session:

1. **Source schemes admitted in v1** → `file://` only.
2. **Size cap per page** → 50 MB.
3. **`file://` root configuration** → required env var, single root,
   fail-closed if missing.

Schema gap surfaced during grounding: `ocr-submission.schema.json`'s
`$defs.source.oneOf` declares `s3`, `https`, and `inline` variants but
no `file`. The schema must be widened to admit a `file` variant before
the fetcher can validate inputs.

## Decisions

### §1 Source-kind admission policy

The schema admits `s3 | https | inline | file` (the new variant is
strictly additive). The **fetcher** only resolves `file`; submissions
carrying `s3 | https | inline` are rejected with stable code
`source_kind_unsupported`.

Why reject in the fetcher rather than the ingestion validator? Two
reasons:

- The contract surface must NOT narrow. Existing fixtures
  (`result-chinese-litigation.json`, `submission-s3.json`) and the
  worker's fake-worker test path use `kind: "s3"`; rejecting `s3` at
  ingestion would break every downstream test that doesn't actually
  fetch (fake worker bypasses the fetcher entirely).
- The "what bytes can this engine fetch" decision is a runtime/engine
  concern, not a vocabulary concern. If 11D adds `s3`, only the
  fetcher and its config change; the contract and ingestion stay put.

When `s3 | https | inline` admission returns in a future ADR, the
fetcher's `source_kind_unsupported` set shrinks accordingly.

### §2 Schema patch — `file` source variant

`docs/contracts/schemas/ocr-submission.schema.json`:

```json
{
  "type": "object",
  "required": ["kind", "path", "byte_size", "mime_type"],
  "properties": {
    "kind":      { "const": "file" },
    "path":      { "type": "string", "minLength": 1 },
    "byte_size": { "type": "integer", "minimum": 1 },
    "mime_type": { "type": "string", "minLength": 1 }
  }
}
```

`path` is a relative path string; semantics (root, containment,
realpath) are owned by the fetcher, not the schema. `byte_size` is
required because the fetcher needs an authoritative claim to verify
the on-disk file against (any mismatch is a hard reject). `mime_type`
is required so the fetcher's MIME allowlist can run before bytes are
read.

This patch is strictly **widening**: every previously-conformant
payload still validates (adding a new `oneOf` branch cannot reject
anything that matched a prior branch). No contract-version bump.

### §3 Fetcher API

`services/ocr-worker/src/fetcher/`:

```ts
import type { OcrSubmission } from "ocr-worker-contract";

export interface FetcherDeps {
  /**
   * Absolute path under which every `file://` source path must resolve.
   * Read once at bin startup from `OCR_FETCHER_FILE_ROOT` (deferred to
   * 11C.3). The fetcher itself does NOT read process.env — keeping I/O
   * side-effects on the bin seam keeps the fetcher testable.
   */
  readonly allowedFileRoot: string;
}

export interface FetchedPage {
  readonly bytes: Buffer;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export function fetchPageBytes(
  submission: OcrSubmission,
  deps: FetcherDeps,
): Promise<FetchedPage>;
```

The fetcher is async (file I/O via `fs/promises`). It is **pure with
respect to deps**: same submission + same deps + same on-disk state ⇒
same result.

It does NOT take or own:
- A real-time clock (no `now` injection — no time-dependent decisions
  in this layer; expiry is a queue/persistence concern).
- A random source.
- `process.env` access (passed in via `deps.allowedFileRoot`).

### §4 N=1 defense-in-depth

The fetcher asserts `submission.pages.length === 1` and throws on
violation (stable code `multi_page_unsupported`, same code that the
ingestion validator uses). The ingestion validator already enforces
this, but the assertion here is defense-in-depth at a second seam in
case a future entry path bypasses ingestion (admin tooling, direct
queue enqueue, etc.).

### §5 Containment guards

Two-layer path containment, identical in spirit to the bakeoff
manifest validator (`services/ocr-worker-bakeoff/src/manifest.ts`).
The implementation is **copied**, not imported: the bakeoff package
is dev-only (out of the production dependency graph per ADR-11B §4),
so importing from it into a production-graph file would drag bakeoff
into prod. The copy is ~30 lines and pinned to the same containment
semantics; both sites have their own tests.

Layer A — **lexical containment**:
- The source path MUST be a relative string (absolute paths rejected).
- `resolve(allowedFileRoot, path)` MUST resolve strictly inside
  `allowedFileRoot` (not equal to root, not outside).

Layer B — **real-path containment**:
- `realpathSync.native(resolved)` MUST be inside
  `realpathSync.native(allowedFileRoot)`. Catches symlink escapes.
- The resolved real path MUST be a regular file (rejects directories,
  FIFOs, sockets, devices).

Both layers run before any read of file bytes. Failure throws with
stable code `path_escape`.

### §6 Gate order — size + MIME + hash

Order matters. Pre-I/O checks first (cheapest), then path-level
containment, then fd-bound size + content checks (audit 019e3a07
fixes — D2 High TOCTOU, D2 Medium MIME signature, D3 Medium root
normalization):

**Pre-I/O (CPU only):**

1. **N=1 page count** — defense in depth (`multi_page_unsupported`).
2. **`allowedFileRoot` validity** — non-empty absolute string
   (`file_root_unconfigured`). Validated BEFORE the `resolve()`
   normalization below so an empty / relative root is surfaced with
   the actionable code instead of silently being CWD-rooted.
3. **`allowedFileRoot` normalization** — `resolve(deps.allowedFileRoot)`
   once at entry, canonical form used everywhere downstream. Closes
   the audit 019e3a07 D3 hole where a valid absolute root containing
   `..` segments (e.g. `/tmp/root/../root`) would otherwise falsely
   reject every legitimate in-root candidate.
4. **`source.kind === "file"`** (`source_kind_unsupported`). MIME
   allowlist check happens after kind admission so non-file kinds
   surface with the more specific code.
5. **Declared MIME allowlist** — `mime_type` MUST be in
   `["image/jpeg", "image/png"]` (`mime_unsupported`). Cheap; runs
   before any path I/O. PDFs stay rejected (ADR-11A.0 §8).

**Path containment (one realpath syscall, no fd yet):**

6. **Lex containment** — `path` is relative, resolves strictly inside
   the normalized root (`path_escape`).
7. **Real-path containment** — `realpathSync.native(lexicalResolved)`
   inside `realpathSync.native(allowedRoot)`. Catches symlink escapes
   (`path_escape`). Resolves transitively (symlink → symlink → file).

**fd-bound checks + read (audit 019e3a07 D2 High TOCTOU fix):**

8. **`open(realPath, "r")`** — failure with `ENOENT` is
   `file_not_found` (file disappeared between realpath and open).
9. **`fh.stat()`** — fstat on the SAME fd we just opened. The size
   + regular-file checks below run against this `st`, and so does
   the read. A path replacement after step 8 cannot substitute a
   different inode under us.
10. **Regular-file check** — `st.isFile()` MUST be true
    (`file_not_regular`). Catches directories, FIFOs, sockets,
    devices that opened-with-mode-`"r"` would otherwise accept.
11. **`byte_size` match** — `st.size === source.byte_size`
    (`size_mismatch`). Pinned BEFORE the cap check so the more
    specific code wins when both could fire.
12. **Size cap** — `st.size ≤ MAX_PAGE_BYTES = 50 * 1024 * 1024`
    (`size_cap_exceeded`). Cap is **inclusive** (the test at exactly
    50 MB passes; the test at 50 MB + 1 rejects).
13. **`fh.readFile()`** — reads from the SAME fd. The bytes are the
    inode's contents that step 9's fstat measured.
14. **Sanity** — `bytes.byteLength === st.size` (`size_mismatch`
    with a same-inode-rewrite-race message). With an fd-bound read
    this is normally tautological; the assertion is a hard pin that
    no future refactor reintroduces a stat→read split.
15. **MIME signature sniff** — bytes MUST start with the magic-byte
    signature for the declared MIME (`mime_signature_mismatch`).
    PNG: `89 50 4E 47 0D 0A 1A 0A`. JPEG: `FF D8 FF`. Closes the
    audit 019e3a07 D2 Medium hole where a PDF (or arbitrary
    content) declared as `image/png` would otherwise be silently
    forwarded to the engine.
16. **`fh.close()`** in `finally` regardless of success or throw.

No SHA-256 verification of fetched bytes in v1. The submission schema
does not currently carry a content hash; adding one is a separate
narrowing change with no current consumer. If a downstream consumer
needs cryptographic integrity, that's a future ADR.

**Residual TOCTOU**: the fd-bound pattern closes the path-replacement
race. The remaining residual is a **same-inode in-place rewrite** —
an attacker holding write access to the fd's inode could replace
bytes between step 9 and step 13. This requires write access to a
file under a worker-owned root, which is out of v1 threat model. If
the root is ever a multi-tenant or guest-writable volume, swap to
`fh.read(buf, 0, st.size, 0)` against a pre-allocated buffer
(eliminates even the in-place-rewrite race by binding the read to
the size we already measured).

### §7 Stable error codes

Exported from the fetcher module via a registry analogous to
`INGESTION_ERROR_CODES`:

```ts
export const FETCHER_ERROR_CODES = Object.freeze({
  SOURCE_KIND_UNSUPPORTED:  "source_kind_unsupported",
  MULTI_PAGE_UNSUPPORTED:   "multi_page_unsupported",
  FILE_ROOT_UNCONFIGURED:   "file_root_unconfigured",
  PATH_ESCAPE:              "path_escape",
  FILE_NOT_FOUND:           "file_not_found",
  FILE_NOT_REGULAR:         "file_not_regular",
  SIZE_MISMATCH:            "size_mismatch",
  SIZE_CAP_EXCEEDED:        "size_cap_exceeded",
  MIME_UNSUPPORTED:         "mime_unsupported",
  MIME_SIGNATURE_MISMATCH:  "mime_signature_mismatch",
} as const);

export class FetcherError extends Error {
  readonly code: FetcherErrorCode;
  constructor(message: string, options: { code: FetcherErrorCode }) {
    super(message);
    this.name = "FetcherError";
    this.code = options.code;
  }
}
```

Note: every `FetcherError` carries a code (unlike `IngestionError`,
where `code` is optional for backward compat with un-coded throw
sites). This file is new; no backward-compat shim is needed.

`file_root_unconfigured` is thrown when `deps.allowedFileRoot` is
absent or not an absolute path. That makes the env-read in 11C.3 a
single check (`if (!process.env.OCR_FETCHER_FILE_ROOT) … exit 2`); the
fetcher itself fails closed on any invalid root.

Runtime-frozen (`Object.freeze`) for the same reason as
`INGESTION_ERROR_CODES`.

### §8 Out of scope (deferred)

- **`s3 | https | inline` admission** — future ADR. The fetcher
  rejects them with stable code today; reintroduction is one match
  arm + one allowlist update.
- **Content-hash verification (SHA-256)** — needs a schema field; no
  consumer yet.
- **MIME sniffing of fetched bytes** — submission's `mime_type` is
  authoritative for v1. Sniffing adds a libmagic-equivalent dep.
- **Streaming / partial reads** — `readFile` reads the whole file at
  once. Acceptable under the 50 MB cap; if multi-hundred-MB inputs
  ever land (they won't pass the cap), revisit.
- **TOCTOU hardening** — see §6. v1 trusts the file root.
- **Bin wiring (env read + deps construction)** — owned by 11C.3.

## Consequences

- `docs/contracts/src/generated/ocr-submission.ts` regenerates with
  a `file` source variant in the `Source` union.
- The submission schema's existing `s3 | https | inline` fixtures
  continue to validate.
- 11C.3 inherits a closed fetcher contract: env read, build
  `FetcherDeps`, call `fetchPageBytes`, hand bytes to the engine.
- 11C.3 also has to decide what to do with the fetcher's error codes
  on the job-outcome surface: which codes map to `failed` (terminal),
  which to `partial_succeeded`, which (if any) to requeue. Outside
  11C.2 scope.

## Open questions (for 11C.3)

- Q1: which fetcher error codes are transient vs permanent for the
  retry classifier? `file_not_found` could be both depending on
  whether the source file is being uploaded asynchronously.
  Provisional answer: all fetcher errors are permanent in v1 (no
  upload-after-submit pattern).
- Q2: when the engine cold-load succeeds but a subsequent fetch
  fails, does the worker bin exit 0 (drain) or exit 2 (config fault)?
  Provisional answer: exit 0 — fetch failure is a per-job concern,
  not a config concern.

## Rejected alternatives

- **Reject non-file source kinds at ingestion** — would break every
  existing fixture and the entire fake-worker test path. The
  fetcher-side reject keeps the contract surface intact and isolates
  the v1 limitation to one module.
- **Import `assertRealContained` from the bakeoff package** — would
  drag the bakeoff (dev-only) into the production dependency graph
  per ADR-11B §4, the inverse of the intended layering. Copying ~30
  lines is the correct trade-off; both copies have their own tests.
- **Multi-root file allowlist** — extra config surface for v1 with no
  driver. A single root covers the development and prod use cases
  ADR-11C.3 wires.
- **Auto-detect MIME from byte signatures** — opens a libmagic-style
  dep with its own threat surface; trusting the submission's
  `mime_type` is sufficient given that the submission already passed
  schema validation. If a malicious caller lies about MIME, the
  engine will reject the bytes anyway.
- **No `byte_size` verification** — would let a swapped file slip in
  silently; the size check is the v1 substitute for content-hash
  verification.
- **Streaming reads** — premature under the 50 MB cap.
