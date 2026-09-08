// documentOpen.ts — R1's first work item: controlled opening of a registered original.
//
// THE RENDERER NEVER SUPPLIES A PATH. It supplies a matter id and a document id; MAIN resolves
// the path from the record and authorizes it. That is the same invariant `chooseDocumentFile`,
// the T3 export and `backup:run` already hold, and it is what stops a compromised or merely
// buggy renderer from naming an arbitrary file for the app to open with the owner's privileges.
//
// AND THE CANONICAL ORIGINAL IS NEVER HANDED OUT. What gets opened is a READ-ONLY COPY. Opening
// the stored file directly would put the evidentiary original in front of an editor: Preview,
// Word and Acrobat all write in place, and a single incidental save would change the bytes that
// `content_hash` attests to — turning the document's own integrity record into a report of
// tampering by the lawyer who merely looked at it. The copy is mode 0400 for the same reason.
//
// VERIFICATION HAPPENS BEFORE THE OPEN, NOT AFTER. `verifyDocumentStore` is reused rather than
// reimplemented, so this path inherits every safeguard it already carries: the storage root is
// realpath'd ONCE so a symlinked ancestor cannot smuggle a path out of the store, the leaf is
// lstat'd so a symlink is not followed, a hardlinked file is refused because another path could
// mutate the same inode, and the bytes are re-hashed against the recorded digest. An original
// that has been altered is refused and SAID SO — it is not silently opened, and it is not
// silently repaired.

import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { verifyDocumentStore } from "./documentVerify.js";
import type { DocumentVerifyReason, DocumentVerifyRecord } from "./documentVerify.js";

/** Why an original could not be opened. Each maps to its own sentence in the renderer. */
export type DocumentOpenRefusal =
  | "unknown_document"       // no such document in that matter, or it belongs to another tenant
  | "document_missing"       // the record exists; the file under custody does not
  | "document_altered"       // present, but the bytes no longer match the recorded digest
  | "document_unverifiable"  // outside the store, hardlinked, not a regular file, unreadable
  | "open_failed";           // the read-only copy could not be produced or handed to the OS

export type DocumentOpenOutcome =
  | { readonly ok: true; readonly openedPath: string }
  | {
      readonly ok: false;
      readonly code: DocumentOpenRefusal;
      /** Present only for `document_unverifiable`, to distinguish the reasons that differ in kind. */
      readonly reason?: DocumentVerifyReason;
    };

export interface DocumentOpenDeps {
  /**
   * Resolve the record for (matterId, documentId) WITHIN the caller's tenant, or null.
   *
   * Scoping is the lookup's job, not this module's: a document id alone is a bearer token for
   * any document in the box, and taking the matter on trust from the renderer is exactly the
   * check the other case-box handlers make in their own preflight.
   */
  readonly lookup: (matterId: string, documentId: string) => DocumentVerifyRecord | null;
  readonly storageRoot: string;
  /** Hands the finished read-only copy to the OS. Injected so tests never launch an application. */
  readonly reveal: (file: string) => Promise<string>;
}

/**
 * The directory holding the previous read-only copy, removed when the next one is made.
 *
 * Deliberately not a growing cache: every copy is privileged client material, so the fewer that
 * exist at once the better. `mkdtemp` creates the directory 0700 and owned by this user, which on
 * a machine the product already requires FileVault on is the same protection the case box has.
 */
let previousCopyDir: string | null = null;

export function _resetOpenCacheForTesting(): void {
  disposePreviousCopy();
}

function disposePreviousCopy(): void {
  if (previousCopyDir === null) return;
  try {
    rmSync(previousCopyDir, { recursive: true, force: true });
  } catch {
    // A copy we could not delete is untidy, not unsafe; it is 0400 in a 0700 directory.
  }
  previousCopyDir = null;
}

export async function openRegisteredOriginal(
  matterId: string,
  documentId: string,
  deps: DocumentOpenDeps,
): Promise<DocumentOpenOutcome> {
  const record = deps.lookup(matterId, documentId);
  if (record === null) return { ok: false, code: "unknown_document" };

  const verdict = await verifyDocumentStore([record], { storageRoot: deps.storageRoot });

  // Order matters: an unverifiable file is reported as such even though it is also, trivially,
  // not readable. "This file is not where it should be" and "this file has been changed" are
  // different facts for a litigator, and collapsing them would lose the one that matters.
  const unverifiable = verdict.unverifiable.find((u) => u.id === record.id);
  if (unverifiable !== undefined) {
    return { ok: false, code: "document_unverifiable", reason: unverifiable.reason };
  }
  if (verdict.missing.includes(record.id)) return { ok: false, code: "document_missing" };
  if (verdict.mismatched.includes(record.id)) return { ok: false, code: "document_altered" };

  // Verified. Produce the read-only copy from the SAME bytes that were just hashed.
  try {
    const source = path.join(deps.storageRoot, record.id, record.filename);
    const bytes = readFileSync(source);

    // Re-hash what we are about to hand over, closing the window between the check and the use:
    // `verifyDocumentStore` read this file a moment ago, and this proves the bytes being copied
    // are still those bytes.
    //
    // MEASURED, so the comment does not overstate it: for a file altered BEFORE the call, this
    // and the `mismatched` branch above are mutually redundant — removing either one leaves the
    // suite green, and removing BOTH turns it red. The suite cannot deterministically open the
    // TOCTOU window this guard exists for, so neither check is killable alone. Saying "this is
    // what catches an altered original" would therefore be a confident, unverified claim; what is
    // true is that the two together make the alteration unopenable by either route.
    if (createHash("sha256").update(bytes).digest("hex").toLowerCase()
        !== record.content_hash.toLowerCase()) {
      return { ok: false, code: "document_altered" };
    }

    disposePreviousCopy();
    const dir = mkdtempSync(path.join(os.tmpdir(), "lawbar-open-"));
    previousCopyDir = dir;
    const copy = path.join(dir, path.basename(record.filename));
    writeFileSync(copy, bytes, { mode: 0o400 });
    chmodSync(copy, 0o400); // umask applies to the create mode but not to chmod

    const failure = await deps.reveal(copy);
    if (failure !== "") return { ok: false, code: "open_failed" };
    return { ok: true, openedPath: copy };
  } catch {
    return { ok: false, code: "open_failed" };
  }
}
