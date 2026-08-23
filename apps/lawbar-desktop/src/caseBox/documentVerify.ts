// Re-verification of stored exhibit bytes against the content_hash recorded at ingest.
//
// Why this exists: the audit chain is hash-chained and tamper-evident, but until this
// module the DOCUMENTS the chain points at were hashed once at ingest and never checked
// again. An exhibit could be replaced on disk and the whole suite still passed.
//
// Two design decisions carry the weight, both from a spec-adversary pass run before any
// code existed:
//
// 1. THE STORED PATH IS DERIVED, never read from `storage_uri`.
//    The court-facing claim is not "a file with this digest exists somewhere" — it is
//    "the file in the application's custody is the file that was ingested". Deriving
//    join(storageRoot, id, safeBasename(filename, id)) makes containment STRUCTURAL: a
//    `storage_uri` edited to point at the user's Desktop is inert rather than merely
//    detectable. It also keeps the documented backup/restore flow working, because
//    `storage_uri` bakes in an absolute path containing the macOS username — a
//    URI-authoritative verifier would report 100% missing after a restore under a
//    different account, which is a false alarm across the entire corpus.
//
// 2. THERE ARE THREE BUCKETS, not two.
//    "The file is gone" and "the file is there and I could not verify it" are different
//    statements to a court, and the second is the more alarming one. With only
//    missing/mismatched an implementer either drops the unverifiable cases (a false
//    green) or folds them into `missing` (a false story). Every `unverifiable` entry
//    carries a machine-readable reason.
//
// Reads only. Never writes, moves, or opens anything for modification.

import { createHash } from "node:crypto";
import { constants as FS } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import { safeBasename } from "./documentStorage.js";

/** Why a document could not be verified. Distinct from absent and from altered. */
export type DocumentVerifyReason =
  | "unusable_digest"     // content_hash is not a SHA-256 digest, so nothing can be compared
  | "unusable_id"         // id is not a ULID, so the derived path is not trustworthy
  | "unusable_filename"   // filename is not a string; no path can be derived from it
  | "store_unavailable"   // the storage root itself is absent or not a directory
  | "outside_store"       // the path escapes storageRoot — via traversal or a symlinked ancestor
  | "not_a_regular_file"  // a directory, a symlink, a device — bytes not under our custody
  | "not_exclusively_held" // hardlinked: another path can mutate the same inode
  | "unreadable";         // present and regular, but the read failed (permissions, I/O)

export interface DocumentVerifyRecord {
  readonly id: string;
  readonly filename: string;
  readonly content_hash: string;
}

export interface DocumentVerifyResult {
  readonly ok: boolean;
  /**
   * How many documents were actually examined. Without it `{ok:true, [], [], []}` is
   * byte-identical whether 2,400 exhibits were re-hashed or the caller passed an empty
   * array because a query silently failed — and this result is offered as evidence.
   */
  readonly checked: number;
  readonly missing: string[];
  readonly mismatched: string[];
  readonly unverifiable: { readonly id: string; readonly reason: DocumentVerifyReason }[];
}

/**
 * A SHA-256 digest. Case-INSENSITIVE deliberately: this codebase writes lowercase, but
 * uppercase hex is still a usable digest, and rejecting a valid one is a false-alarm
 * class. False alarms destroy trust in an integrity report as surely as a false green.
 */
const DIGEST = /^[0-9a-f]{64}$/i;

/** ULID as the document schema defines it. `id` is an untrusted string on the record. */
const ULID = /^[0-9a-z]{26}$/;

/**
 * Hash by STREAM, not readFile. A scanned exhibit can exceed Node's ~2 GiB buffer cap,
 * where readFile throws ERR_FS_FILE_TOO_LARGE; streaming also keeps memory flat when a
 * matter holds thousands of documents.
 */
/**
 * Open the leaf WITHOUT following a symlink, confirm it is an exclusively-held regular
 * file, and hash it from that same handle.
 *
 * O_NOFOLLOW closes two holes at once: a symlinked leaf (ELOOP rather than a silent
 * follow) and the TOCTOU window between a separate stat and the open — the bytes hashed
 * are the bytes of the object that was checked, because it is the same descriptor.
 * Streaming keeps memory flat and avoids readFile's ~2 GiB cap on a scanned exhibit.
 *
 * KNOWN LIMIT, stated rather than implied: O_NOFOLLOW closes the race on the LEAF, but a
 * race remains between validating the per-document directory and opening the file inside
 * it — an attacker swapping that directory in the microseconds between the two would be
 * unseen. Closing it needs openat(2) relative to a held directory descriptor, which Node
 * does not expose. The window requires local write access to the store while a
 * verification is mid-flight; an adversary with that access has cheaper options. Recorded
 * as a limit of this implementation, not as something handled.
 */
async function hashExclusiveFile(
  p: string,
): Promise<{ hash: string } | { reason: DocumentVerifyReason }> {
  let fh;
  try {
    fh = await open(p, FS.O_RDONLY | FS.O_NOFOLLOW);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { reason: "absent" as never };
    if (code === "ENOTDIR") return { reason: "not_a_regular_file" };
    if (code === "ELOOP") return { reason: "not_a_regular_file" };
    return { reason: "unreadable" };
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) return { reason: "not_a_regular_file" };
    // A hardlink means another pathname shares this inode and can mutate it after
    // verification. The store COPIES files in, so nlink > 1 is anomalous by construction.
    if (st.nlink > 1) return { reason: "not_exclusively_held" };
    const h = createHash("sha256");
    for await (const chunk of fh.createReadStream()) h.update(chunk as Buffer);
    return { hash: h.digest("hex") };
  } catch {
    return { reason: "unreadable" };
  } finally {
    await fh.close().catch(() => {});
  }
}

/**
 * Re-hash every stored document and compare against its recorded digest.
 *
 * Reports EVERY defect: an integrity report that stops at the first bad exhibit
 * understates the scope of a tamper. Results are order-independent and the input array is
 * never mutated.
 */
export async function verifyDocumentStore(
  documents: readonly DocumentVerifyRecord[],
  { storageRoot, concurrency = 8 }: { storageRoot: string; concurrency?: number },
): Promise<DocumentVerifyResult> {
  const missing: string[] = [];
  const mismatched: string[] = [];
  const unverifiable: { id: string; reason: DocumentVerifyReason }[] = [];

  // A non-finite or non-positive worker count produced ZERO workers, so Promise.all([])
  // resolved instantly and `ok` was computed over three empty arrays — a clean bill of
  // health on a tampered store. Validate before it can matter.
  const workers = Number.isSafeInteger(concurrency) && concurrency >= 1
    ? Math.min(concurrency, Math.max(1, documents.length))
    : 8;

  // realpath the root ONCE so a symlinked ancestor cannot smuggle the path outside the
  // store. lstat on the leaf alone never sees an ancestor symlink.
  //
  // If the root itself is absent or is not a directory — a restore still running, an
  // unmounted volume, a wrong root from the caller — every per-document lstat would
  // return ENOENT and the report would read "all exhibits were deleted". That is a false
  // mass-deletion claim, and the more damaging of the two errors in a spoliation
  // argument. Fail once, at the root, with a statement that says what is actually true.
  let realRoot: string;
  try {
    // lstat BEFORE realpath. realpath resolves a symlinked root and then hands back the
    // target as though it were the store — an attacker who replaces the root with a link
    // to a directory of planted files gets every one of them certified. The caller may
    // pass an already-resolved path deliberately; it may not have one resolved for it.
    const linkStat = await lstat(storageRoot);
    if (linkStat.isSymbolicLink()) throw new Error("storage root is a symlink");
    realRoot = await realpath(storageRoot);
    const rootStat = await lstat(realRoot);
    if (!rootStat.isDirectory()) throw new Error("not a directory");
  } catch {
    return {
      ok: documents.length === 0,
      checked: documents.length,
      missing: [],
      mismatched: [],
      unverifiable: documents.map((d) => ({ id: d.id, reason: "store_unavailable" as const })),
    };
  }

  // A shared cursor, not queue.shift(): same single-threaded safety, without O(n) per item.
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const doc = documents[cursor++];
      if (doc === undefined) return;
      // Belt and braces: whatever an individual row does, it may not take the report with
      // it. A thrown row becomes `unreadable`, never a lost verdict on every other row.
      try {

        if (!DIGEST.test(doc.content_hash)) {
          unverifiable.push({ id: doc.id, reason: "unusable_digest" });
          continue;
        }
        // `id` is an untrusted string. Unconstrained, `id: ".."` walks the derived path out
        // of the store, and any matching file on disk would then certify as the exhibit.
        if (!ULID.test(doc.id)) {
          unverifiable.push({ id: doc.id, reason: "unusable_id" });
          continue;
        }
        // path.basename throws ERR_INVALID_ARG_TYPE on a non-string. Unguarded, that
        // rejection escaped Promise.all and destroyed the whole report — one tampered row
        // erasing the verdict on every other exhibit, which is the strongest possible
        // violation of "report EVERY defect".
        if (typeof doc.filename !== "string") {
          unverifiable.push({ id: doc.id, reason: "unusable_filename" });
          continue;
        }

        const docDir = path.join(realRoot, doc.id);
        const p = path.join(docDir, safeBasename(doc.filename, doc.id));

        // Containment, checked rather than assumed: the per-document directory must really
        // live under the real root, with no symlinked component in between.
        try {
          const realDir = await realpath(docDir);
          if (realDir !== docDir || !p.startsWith(realRoot + path.sep)) {
            unverifiable.push({ id: doc.id, reason: "outside_store" });
            continue;
          }
          // realpath also succeeds on a regular FILE. Without this the subsequent open
          // returns ENOTDIR, which mapped to `absent` — reporting a present-but-wrong
          // object as a deleted exhibit.
          const dirStat = await lstat(realDir);
          if (!dirStat.isDirectory()) {
            unverifiable.push({ id: doc.id, reason: "not_a_regular_file" });
            continue;
          }
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code;
          if (code === "ENOENT") { missing.push(doc.id); continue; }
          unverifiable.push({ id: doc.id, reason: "unreadable" });
          continue;
        }

        const out = await hashExclusiveFile(p);
        if ("reason" in out) {
          // Only a genuinely absent file is "missing". Permission, loop and I/O errors mean
          // "could not verify", which is the distinction the third bucket exists for.
          if ((out.reason as string) === "absent") missing.push(doc.id);
          else unverifiable.push({ id: doc.id, reason: out.reason });
          continue;
        }
          if (out.hash !== doc.content_hash.toLowerCase()) mismatched.push(doc.id);
      } catch {
        unverifiable.push({ id: doc?.id ?? "<unknown>", reason: "unreadable" });
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, worker));

  return {
    ok: missing.length === 0 && mismatched.length === 0 && unverifiable.length === 0,
    checked: documents.length,
    missing,
    mismatched,
    unverifiable,
  };
}
