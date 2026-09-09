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
//
// WHAT IS NOT PROVED, stated here so no reader infers it. Every containment check in this file
// is made on a PATH at a moment; the bytes are then read from a DESCRIPTOR opened afterwards.
// The descriptor is re-checked for file type, link count and (dev, ino) identity, and the path
// is re-resolved and required to sit under the resolved store root. A leaf swapped for a symlink
// after verification is therefore refused, and so is a leaf replaced after the open. What cannot
// be excluded is a swap that lands in the gap between the final resolve and the open itself:
// closing that needs openat-style directory-relative traversal, which Node does not expose.
// That residual is narrow, real, and deliberately left visible rather than claimed away.

import { createHash } from "node:crypto";
import {
  chmodSync, closeSync, createReadStream, createWriteStream, fstatSync, mkdtempSync, openSync,
  realpathSync, rmSync, statSync,
} from "node:fs";
import { Transform } from "node:stream";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
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

/**
 * Discriminated so the TYPE enforces what the comment used to only assert: `reason` is required
 * for `document_unverifiable` and impossible anywhere else. The previous shape allowed a reason to
 * be omitted where it is the whole point, or attached where it means nothing.
 */
export type DocumentOpenOutcome =
  /**
   * Success carries NO path. `reveal` has already handed the copy to the OS inside this call, so
   * no caller needs it — and returning one would send a filesystem path across a boundary whose
   * stated invariant is that paths never cross it. It also made serialization insufficient: a
   * caller holding the path could use it after a later open had disposed of it.
   */
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: "document_unverifiable";
      readonly reason: DocumentVerifyReason;
    }
  | {
      readonly ok: false;
      readonly code: Exclude<DocumentOpenRefusal, "document_unverifiable">;
      readonly reason?: never;
    };

export interface DocumentOpenDeps {
  /**
   * Resolve the record for (matterId, documentId) WITHIN the caller's tenant, or null.
   *
   * Scoping is the lookup's job, not this module's: a document id alone is a bearer token for
   * any document in the box, and taking the matter on trust from the renderer is exactly the
   * check the other case-box handlers make in their own preflight.
   */
  readonly lookup: (
    matterId: string,
    documentId: string,
  ) => DocumentVerifyRecord | null | Promise<DocumentVerifyRecord | null>;
  readonly storageRoot: string;
  /** Hands the finished read-only copy to the OS. Injected so tests never launch an application. */
  readonly reveal: (file: string) => Promise<string>;
  /**
   * The store verifier. Defaults to the real one; injectable ONLY so its failure modes can be
   * exercised.
   *
   * This seam was missing, and its absence was invisible until mutation testing: the two guards
   * that exist for a verifier that misbehaves — the affirmative-verdict check and the descriptor
   * re-assertion — could not be reached by any test, so removing either left the suite green. A
   * guard no test can reach is indistinguishable from one that is not there.
   */
  readonly verify?: typeof verifyDocumentStore;
  /**
   * Opens the read stream over the verified descriptor. Defaults to `createReadStream`; injectable
   * ONLY so a READ-side failure can be exercised — on a real regular file one cannot be induced
   * from outside (reads survive permission changes, deletion and replacement; truncation is an
   * early EOF, which is `document_altered`). Same pattern and reason as `verify`.
   */
  readonly openReadStream?: (fd: number) => Readable;
  /**
   * Directory the read-only copy's private 0700 directory is created inside. Defaults to
   * `os.tmpdir()`, which is what production uses and what the comment on `previousCopyDir`
   * describes; injectable ONLY so a test can measure what THIS call left behind.
   *
   * The seam exists because its absence made a test unsound rather than merely awkward. AUDIT-6
   * asserts that a failed hand-off leaves no copy, and it did so by counting `lawbar-open-*`
   * directories in the shared `os.tmpdir()` before and after. That count is not private to the
   * test: `documentOpenHandlers` calls this same engine, so `document-open-handlers.test.mjs`
   * creates directories with that prefix, and under `--test-isolation=process` the two files run
   * at once. A directory created by the other file inside the window failed the assertion, and a
   * directory removed inside it could have hidden a real leak. Unsound in both directions, and
   * intermittent, which is the worst way to be wrong.
   */
  readonly tmpBase?: string;
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
    previousCopyDir = null;
  } catch {
    // KEEP the pointer. Nulling it after a failed delete orphaned privileged client material
    // permanently — the next call would forget the directory existed and create another beside
    // it, which is precisely what the "only one copy at a time" comment promises will not happen.
    // Retaining it means the next open retries the delete.
  }
}

/** Remove a directory we created but will not hand over, so a failed open leaves nothing behind. */
function discardCopyDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort; it is 0400 inside a 0700 directory either way.
  }
  if (previousCopyDir === dir) previousCopyDir = null;
}

/**
 * Every open runs to completion before the next begins.
 *
 * `previousCopyDir` is one slot. Without serialization, call A awaits `reveal`, call B runs to
 * completion during that await and disposes A's directory, and A's `reveal` finishes against a
 * file that is gone. "One renderer, one request at a time" was the only thing preventing that,
 * and it is an unenforced UI convention a double-click defeats.
 *
 * A FIFO promise chain is the smallest correct fix. `runOpen` never rejects — every failure is
 * already an outcome — so one operation's failure cannot poison the queue for the next; the
 * `.catch` below exists only so an unforeseen throw cannot either. MEASURED: because `runOpen`
 * cannot reject, that `.catch` is unreachable and no test can kill it. It is defence in depth,
 * not the mechanism, and the comment says so rather than claiming otherwise.
 *
 * WHAT SERIALIZATION PROVES, and what it does not. The ordering fix from the audit (set
 * `previousCopyDir` only after a reveal completes) already guarantees no in-flight reveal's
 * directory is disposed of by another call. What was still wrong without serialization is
 * ORDER: a slow earlier open finishing after a fast later one would treat the later copy as
 * superseded and delete the document the owner most recently asked for. The test pins that.
 */
let queue: Promise<unknown> = Promise.resolve();

export function openRegisteredOriginal(
  matterId: string,
  documentId: string,
  deps: DocumentOpenDeps,
): Promise<DocumentOpenOutcome> {
  const next = queue.then(() => runOpen(matterId, documentId, deps));
  queue = next.catch(() => undefined);
  return next;
}

async function runOpen(
  matterId: string,
  documentId: string,
  deps: DocumentOpenDeps,
): Promise<DocumentOpenOutcome> {
  // EVERYTHING is inside the boundary, including the lookup and the verification.
  //
  // They used to sit outside it. A throw from either — a database error, a verifier bug — escaped
  // to the IPC caller carrying an exception message, and an exception message here can contain a
  // filesystem path, and a path can contain a client's name. This file's own header states that
  // failures cross as codes and never as messages; the code did not honour it on the one route
  // that matters most, the unexpected one.
  let dirToDiscard: string | null = null;
  try {
    const record = await deps.lookup(matterId, documentId); // persistence lookups are async
    if (record === null) return { ok: false, code: "unknown_document" };

    const verify = deps.verify ?? verifyDocumentStore;
    const verdict = await verify([record], { storageRoot: deps.storageRoot });

    // Classification PRECEDENCE, not a claim about readability. A hardlinked or outside-store file
    // is perfectly readable; what it is not is under our exclusive custody at a path we vouch for.
    // "This file is not where it should be" and "this file has been changed" are different facts
    // for a litigator, and reporting the second when the first is true loses the one that matters.
    const unverifiable = verdict.unverifiable.find((u) => u.id === record.id);
    if (unverifiable !== undefined) {
      return { ok: false, code: "document_unverifiable", reason: unverifiable.reason };
    }
    if (verdict.missing.includes(record.id)) return { ok: false, code: "document_missing" };
    if (verdict.mismatched.includes(record.id)) return { ok: false, code: "document_altered" };

    // AN AFFIRMATIVE VERDICT IS REQUIRED — absence from three arrays is not proof of health.
    //
    // `documentVerify.ts` carries a comment about the exact defect this guards: a worker-count bug
    // once made it return three empty arrays, "a clean bill of health on a tampered store". Reading
    // only the failure lists inherits that failure mode, and any future reason category it learns
    // to report would also arrive here as silence. Demand `ok`, and demand that this record was
    // actually examined.
    if (!verdict.ok || verdict.checked !== 1) {
      return { ok: false, code: "document_unverifiable", reason: "unreadable" };
    }

    // ONE DESCRIPTOR, opened once and used for everything that follows.
    //
    // The previous version re-opened by pathname after verification, then re-hashed the bytes and
    // called the window closed. Re-hashing proves the CONTENT is what was attested; it proves
    // nothing about containment, regular-file-ness, or exclusive links, because a leaf swapped for
    // a symlink or a device between the check and the open would simply be hashed in its place.
    // Holding the descriptor is what carries the verifier's guarantees forward to the bytes we
    // actually copy.
    const source = path.join(deps.storageRoot, record.id, record.filename);
    let fd: number;
    try {
      fd = openSync(source, "r");
    } catch {
      // The verifier said this was fine a moment ago; if it is not openable now it has moved or
      // changed underneath us. That is not a copy-or-handoff failure, so it must not be reported
      // as one.
      return { ok: false, code: "document_unverifiable", reason: "unreadable" };
    }

    try {
      const st = fstatSync(fd);
      // Re-assert on the DESCRIPTOR what the verifier asserted on the path. A regular file with
      // one link cannot have been swapped for a symlink or shared with another writer.
      if (!st.isFile() || st.nlink !== 1) {
        return { ok: false, code: "document_unverifiable", reason: "not_exclusively_held" };
      }

      // COMPENSATING CONTAINMENT AND IDENTITY CHECK. The verifier proved containment on a path a
      // moment ago; the descriptor proved type and custody. Neither proves the path resolves inside
      // the store NOW, nor that the opened inode is the one the path names. Resolve again and
      // require the result under the resolved root; then require its (dev, ino) to match the
      // descriptor. Ordinary swaps fail one or the other. The gap that remains is in the header.
      let resolved: string;
      let root: string;
      try {
        resolved = realpathSync(source);
        root = realpathSync(deps.storageRoot);
      } catch {
        return { ok: false, code: "document_unverifiable", reason: "unreadable" };
      }
      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        return { ok: false, code: "document_unverifiable", reason: "outside_store" };
      }
      if (resolved === root) {
        return { ok: false, code: "document_unverifiable", reason: "outside_store" };
      }
      const onDisk = statSync(resolved);
      if (onDisk.dev !== st.dev || onDisk.ino !== st.ino) {
        return { ok: false, code: "document_unverifiable", reason: "outside_store" };
      }

      // STREAM, hashing as the bytes pass. `readFileSync` held the whole document in memory on the
      // main process — then the write held it a second time — and the owner's store already has an
      // 86.8 MB original. Every IPC response and window operation stalled for the duration: the app
      // does not freeze visibly, it stops answering. Bounded memory now, whatever the size.
      //
      // Create the new copy BEFORE disposing of the old one. Disposing first meant a failure here
      // left the owner with neither the previous copy nor a new one.
      const dir = mkdtempSync(path.join(deps.tmpBase ?? os.tmpdir(), "lawbar-open-"));
      dirToDiscard = dir;
      const copy = path.join(dir, path.basename(record.filename));
      const hash = createHash("sha256");
      const tap = new Transform({
        transform(chunk: Buffer, _enc, cb) { hash.update(chunk); cb(null, chunk); },
      });

      // WHICH SIDE FAILED is a fact the owner needs, and `pipeline` alone does not tell us.
      //
      // It rejects with one error and then destroys every stream WITH THAT SAME OBJECT, so neither
      // identity nor `stream.errored` distinguishes a source that could not be read from a temp
      // file that could not be written. Event ORDER does: the originating stream emits `error`
      // first; the rest emit only after pipeline destroys them. Record the first origin only.
      //
      // A read-side failure is a statement about the EVIDENCE — `document_unverifiable`. A write-
      // side failure is a statement about THIS MACHINE — `open_failed`. Collapsing them told a
      // litigator "the copy could not be made" when the truth was "the original could not be read".
      const openRead = deps.openReadStream ?? ((h: number) => createReadStream("", { fd: h, autoClose: false, start: 0 }));
      const readStream = openRead(fd); // our fd; the finally closes it
      const sink = createWriteStream(copy, { mode: 0o400, flags: "wx" });
      let origin: "read" | "write" | null = null;
      readStream.once("error", () => { origin ??= "read"; });
      sink.once("error", () => { origin ??= "write"; });
      try {
        await pipeline(readStream, tap, sink);
      } catch {
        if (origin === "read") return { ok: false, code: "document_unverifiable", reason: "unreadable" };
        return { ok: false, code: "open_failed" };
      }
      chmodSync(copy, 0o400); // umask subtracts from a create mode; it does not apply to chmod

      // The digest is checked BEFORE reveal, exactly as before; a mismatch returns and the outer
      // finally discards the directory. Nothing unverified is ever handed to the OS.
      if (hash.digest("hex").toLowerCase() !== record.content_hash.toLowerCase()) {
        return { ok: false, code: "document_altered" };
      }

      const failure = await deps.reveal(copy);
      if (failure !== "") return { ok: false, code: "open_failed" };

      // Handed over successfully: this copy becomes the one we hold, and the previous one goes.
      const superseded = previousCopyDir;
      previousCopyDir = dir;
      dirToDiscard = null;
      if (superseded !== null && superseded !== dir) discardCopyDir(superseded);
      return { ok: true };
    } finally {
      try {
        closeSync(fd);
      } catch {
        // Nothing actionable; the process is closing a descriptor it owns.
      }
    }
  } catch {
    return { ok: false, code: "open_failed" };
  } finally {
    // Any directory created but not handed over is privileged client material that no one asked
    // for. It goes, on every path out of here.
    if (dirToDiscard !== null) discardCopyDir(dirToDiscard);
  }
}
