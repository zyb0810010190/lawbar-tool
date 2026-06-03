// documentStorage util tests. Real temp dir; no Electron.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { storeDocumentFile, makeStoreFile } from "../dist/src/caseBox/documentStorage.js";

const DOC_ID = "01jzdoc0000000000000000000";

async function tmpRoots() {
  const base = await mkdtemp(path.join(os.tmpdir(), "lawbar-docstore-"));
  const src = path.join(base, "src");
  const storage = path.join(base, "storage");
  await mkdir(src, { recursive: true });
  return { base, src, storage };
}

test("storeDocumentFile: hashes (sha256), copies into storageRoot/<id>/<file>, returns file:// uri + size", async () => {
  const { base, src, storage } = await tmpRoots();
  try {
    const bytes = Buffer.from("the quick brown fox\n", "utf8");
    const sourcePath = path.join(src, "evidence.pdf");
    await writeFile(sourcePath, bytes);

    const out = await storeDocumentFile({ sourcePath, storageRoot: storage, documentId: DOC_ID, filename: "evidence.pdf" });

    const expectedHash = createHash("sha256").update(bytes).digest("hex");
    assert.equal(out.content_hash, expectedHash);
    assert.equal(out.byte_size, bytes.length);
    assert.equal(out.stored_filename, "evidence.pdf");

    const destPath = path.join(storage, DOC_ID, "evidence.pdf");
    assert.equal(out.storage_uri, pathToFileURL(destPath).href);
    // file actually copied with identical bytes; source untouched
    assert.deepEqual(await readFile(destPath), bytes);
    assert.deepEqual(await readFile(sourcePath), bytes);
    // storage_uri resolves back under the storage root
    assert.ok(fileURLToPath(out.storage_uri).startsWith(path.resolve(storage) + path.sep));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("storeDocumentFile: a filename with path components is reduced to its basename (no traversal)", async () => {
  const { base, src, storage } = await tmpRoots();
  try {
    const sourcePath = path.join(src, "x.bin");
    await writeFile(sourcePath, Buffer.from("data"));
    const out = await storeDocumentFile({
      sourcePath,
      storageRoot: storage,
      documentId: DOC_ID,
      filename: "../../etc/passwd",
    });
    // basename of "../../etc/passwd" is "passwd"; stored strictly under the doc dir
    assert.equal(out.stored_filename, "passwd");
    const resolved = fileURLToPath(out.storage_uri);
    assert.ok(resolved.startsWith(path.join(path.resolve(storage), DOC_ID) + path.sep));
    assert.equal(path.basename(resolved), "passwd");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("storeDocumentFile: a pure '..' filename falls back to the documentId", async () => {
  const { base, src, storage } = await tmpRoots();
  try {
    const sourcePath = path.join(src, "y.bin");
    await writeFile(sourcePath, Buffer.from("z"));
    const out = await storeDocumentFile({
      sourcePath,
      storageRoot: storage,
      documentId: DOC_ID,
      filename: "..",
    });
    assert.equal(out.stored_filename, DOC_ID);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("makeStoreFile binds a storage root", async () => {
  const { base, src, storage } = await tmpRoots();
  try {
    const sourcePath = path.join(src, "z.txt");
    await writeFile(sourcePath, Buffer.from("hi"));
    const store = makeStoreFile(storage);
    const out = await store({ sourcePath, documentId: DOC_ID, filename: "z.txt" });
    assert.equal(out.byte_size, 2);
    assert.ok(out.storage_uri.startsWith("file://"));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
