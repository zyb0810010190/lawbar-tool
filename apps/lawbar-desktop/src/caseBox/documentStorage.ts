// Conservative main-process document file storage for the case-box.
// Given a user-chosen source file, computes a SHA-256 content_hash, copies the
// file into an APP-CONTROLLED storage root under a per-document subdirectory,
// and returns a file:// storage_uri. Pure node:fs/crypto — no Electron, no
// renderer input beyond the already-chosen path, unit-testable with a temp dir.
//
// Safety posture:
//   - destination is ALWAYS strictly under <storageRoot>/<documentId>/, where
//     documentId is a server-generated ULID; the user-influenced filename is
//     reduced to its basename and re-checked to be inside that subdir, so a
//     crafted filename cannot escape the storage root (no path traversal).
//   - the file is COPIED (the user's original is never moved or deleted).
//   - nothing is executed; the returned storage_uri is data, displayed as text.

import { createHash } from "node:crypto";
import { mkdir, copyFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface StoredDocumentFile {
  readonly content_hash: string;
  readonly storage_uri: string;
  readonly byte_size: number;
  readonly stored_filename: string;
}

export interface StoreDocumentFileArgs {
  readonly sourcePath: string;
  readonly storageRoot: string;
  readonly documentId: string;
  readonly filename: string;
}

// Reduce an arbitrary chosen filename to a safe basename. Strips any directory
// components and rejects names that would resolve outside the per-document dir.
// Falls back to the documentId when the basename is empty or unsafe.
function safeBasename(filename: string, documentId: string): string {
  const base = path.basename(filename);
  if (base.length === 0 || base === "." || base === ".." || base.includes("/") || base.includes("\\")) {
    return documentId;
  }
  return base;
}

export async function storeDocumentFile(
  args: StoreDocumentFileArgs,
): Promise<StoredDocumentFile> {
  const { sourcePath, storageRoot, documentId } = args;
  const destDir = path.join(storageRoot, documentId);
  const stored_filename = safeBasename(args.filename, documentId);
  const destPath = path.join(destDir, stored_filename);

  // Defense-in-depth: confirm the resolved destination stays inside destDir.
  const resolvedDir = path.resolve(destDir);
  const resolvedDest = path.resolve(destPath);
  if (resolvedDest !== path.join(resolvedDir, stored_filename) || !resolvedDest.startsWith(resolvedDir + path.sep)) {
    throw new Error("documentStorage: refusing to write outside the document storage directory");
  }

  // Copy FIRST, then hash + size the STORED artifact (the destination). Hashing
  // the source before a separate copy would be a TOCTOU integrity race: if the
  // source changed in between, content_hash could describe different bytes than
  // what was persisted (cc-suite audit audit-mpxn19oa-0ke12x, Medium). Hashing
  // the destination guarantees content_hash + byte_size both describe the bytes
  // that were actually written.
  await mkdir(destDir, { recursive: true });
  await copyFile(sourcePath, destPath);
  const bytes = await readFile(destPath);
  const content_hash = createHash("sha256").update(bytes).digest("hex");
  const info = await stat(destPath);
  const storage_uri = pathToFileURL(destPath).href;

  return {
    content_hash,
    storage_uri,
    byte_size: info.size,
    stored_filename,
  };
}

// Bind a storeFile function to a fixed storage root (used to inject the
// handler's storeFile dependency in production).
export function makeStoreFile(
  storageRoot: string,
): (a: { sourcePath: string; documentId: string; filename: string }) => Promise<StoredDocumentFile> {
  return (a) => storeDocumentFile({ ...a, storageRoot });
}
