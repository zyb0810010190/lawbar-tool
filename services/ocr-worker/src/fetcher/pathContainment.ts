// Two-layer path-containment guards for the page fetcher.
//
// COPIED from services/ocr-worker-bakeoff/src/manifest.ts (audit threads
// 019e36a0 D2.1-3 + 019e3854 S1). The bakeoff package is dev-only (out
// of the production dependency graph per ADR-11B §4), so importing from
// it into this production-graph file would drag bakeoff into prod.
// Copying ~30 lines is the right trade-off; both sites have their own
// tests covering the same containment semantics. If the semantics ever
// diverge, that is a bug — keep both in sync.

import { realpathSync, statSync, type Stats } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

import { FetcherError, FETCHER_ERROR_CODES } from "./types.js";

/**
 * Lexical containment: candidate must be a relative path that resolves
 * strictly INSIDE root (not equal to root, not outside). No filesystem
 * access.
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
 * (following symlinks) must also be inside root, and the resolved
 * target must be a regular file (not a directory, FIFO, device, etc.).
 *
 * Returns the real path and the stat result on success so the caller
 * can reuse them without re-stat'ing.
 */
export function assertRealContainedRegularFile(
  root: string,
  lexicalResolved: string,
  label: string,
): { realPath: string; stat: Stats } {
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
  let stat: Stats;
  try {
    stat = statSync(realPath);
  } catch (err) {
    throw new FetcherError(
      `${label} ${JSON.stringify(realPath)} cannot be stat'd: ${(err as Error).message}`,
      { code: FETCHER_ERROR_CODES.FILE_NOT_FOUND },
    );
  }
  if (!stat.isFile()) {
    throw new FetcherError(
      `${label} ${JSON.stringify(realPath)} is not a regular file (got ${describeFileType(stat)})`,
      { code: FETCHER_ERROR_CODES.FILE_NOT_REGULAR },
    );
  }
  return { realPath, stat };
}

function describeFileType(st: Stats): string {
  if (st.isDirectory()) return "directory";
  if (st.isSymbolicLink()) return "symlink";
  if (st.isBlockDevice()) return "block device";
  if (st.isCharacterDevice()) return "character device";
  if (st.isFIFO()) return "fifo";
  if (st.isSocket()) return "socket";
  return "non-regular";
}
