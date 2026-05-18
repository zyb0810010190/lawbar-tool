// Two-layer path-containment guards for the page fetcher.
//
// COPIED from services/ocr-worker-bakeoff/src/manifest.ts (audit threads
// 019e36a0 D2.1-3 + 019e3854 S1). The bakeoff package is dev-only (out
// of the production dependency graph per ADR-11B §4), so importing from
// it into this production-graph file would drag bakeoff into prod.
// Copying ~30 lines is the right trade-off; both sites have their own
// tests covering the same containment semantics. If the semantics ever
// diverge, that is a bug — keep both in sync.
//
// Intentional divergence from the bakeoff copy (audit 019e3a07 D3):
// the bakeoff caller normalizes `root` before calling these guards;
// the fetcher does NOT trust its caller to normalize. `fetchPageBytes`
// runs `resolve(deps.allowedFileRoot)` once at entry and passes the
// normalized value down. Containment helpers therefore assume an
// already-normalized root, just like the bakeoff.
//
// Intentional divergence from the bakeoff copy (audit 019e3a07 D2/D3):
// the bakeoff returns `{ realPath, stat }` from the realpath-contained
// check; the fetcher returns only `realPath`. File-shape checks
// (regular vs directory) and size checks run through an opened fd in
// `fetchPageBytes` to close the TOCTOU window between stat and read.

import { realpathSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

import { FetcherError, FETCHER_ERROR_CODES } from "./types.js";

/**
 * Lexical containment: candidate must be a relative path that resolves
 * strictly INSIDE root (not equal to root, not outside). No filesystem
 * access. Returns the lexically-resolved absolute path on success.
 *
 * The caller MUST pass an already-normalized absolute `root` (see
 * intentional-divergence note at the top of the file).
 */
export function assertLexicallyContained(
  root: string,
  candidate: string,
  label: string,
): string {
  if (isAbsolute(candidate)) {
    throw new FetcherError(
      `${label} ${JSON.stringify(candidate)} must be a relative path (absolute paths forbidden)`,
      { code: FETCHER_ERROR_CODES.PATH_ESCAPE },
    );
  }
  const resolved = resolve(root, candidate);
  if (resolved === root) {
    throw new FetcherError(
      `${label} ${JSON.stringify(candidate)} resolves to the allowed root itself; it must point at a file inside the root`,
      { code: FETCHER_ERROR_CODES.PATH_ESCAPE },
    );
  }
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (!resolved.startsWith(rootWithSep)) {
    throw new FetcherError(
      `${label} ${JSON.stringify(candidate)} resolves outside the allowed root (${resolved} vs ${root})`,
      { code: FETCHER_ERROR_CODES.PATH_ESCAPE },
    );
  }
  return resolved;
}

/**
 * Real-path containment: the lexically-resolved candidate's real path
 * (following symlinks) must also be inside root. Returns the real path.
 *
 * Regular-file + size checks are intentionally NOT done here — they
 * happen via fstat on an opened fd in `fetchPageBytes` so the
 * stat→read TOCTOU window is closed (audit 019e3a07 D2 High).
 *
 * The caller MUST pass an already-normalized absolute `root`.
 */
export function assertRealContained(
  root: string,
  lexicalResolved: string,
  label: string,
): string {
  let realRoot: string;
  try {
    realRoot = realpathSync.native(root);
  } catch (err) {
    throw new FetcherError(
      `failed to resolve allowed root real path: ${(err as Error).message}`,
      { code: FETCHER_ERROR_CODES.FILE_ROOT_UNCONFIGURED },
    );
  }
  let realPath: string;
  try {
    realPath = realpathSync.native(lexicalResolved);
  } catch (err) {
    const errno = (err as NodeJS.ErrnoException).code;
    if (errno === "ENOENT") {
      throw new FetcherError(
        `${label} ${JSON.stringify(lexicalResolved)} not found on disk`,
        { code: FETCHER_ERROR_CODES.FILE_NOT_FOUND },
      );
    }
    throw new FetcherError(
      `${label} ${JSON.stringify(lexicalResolved)} cannot be realpath-resolved: ${(err as Error).message}`,
      { code: FETCHER_ERROR_CODES.FILE_NOT_FOUND },
    );
  }
  const realRootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (realPath !== realRoot && !realPath.startsWith(realRootWithSep)) {
    throw new FetcherError(
      `${label} ${JSON.stringify(lexicalResolved)} real path escapes allowed root via symlink (${realPath} vs ${realRoot})`,
      { code: FETCHER_ERROR_CODES.PATH_ESCAPE },
    );
  }
  return realPath;
}
