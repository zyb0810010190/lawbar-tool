// Shared fixtures and helpers for the OcrPersistence conformance harness.
//
// Implementation-neutral: contains no reference to InMemoryOcrPersistence
// (or any other concrete persistence implementation). Used by:
//   - tests/inMemory.conformance.test.mjs (today)
//   - future SQLite-backed conformance test entry-point (Step 9)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(
  here,
  "..",
  "..",
  "node_modules",
  "ocr-worker-contract",
  "fixtures",
  "valid",
);

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

export const rawBaseSubmission = readJson(
  join(fixtureDir, "submission-s3.json"),
);
export const successResult = readJson(
  join(fixtureDir, "result-chinese-litigation.json"),
);
export const failureResult = readJson(
  join(fixtureDir, "result-partial-failure.json"),
);

// Persistence enforces every result.page_id ∈ submission.pages. successResult
// binds to p01 (the only fixture page), failureResult binds to p04 — so the
// shared baseSubmission carries BOTH pages. p04 is derived from p01 with the
// page_id/page_number/source.key rewritten and document_revision preserved.
export const baseSubmission = (() => {
  const sub = JSON.parse(JSON.stringify(rawBaseSubmission));
  const p1 = sub.pages[0];
  const p4 = JSON.parse(JSON.stringify(p1));
  p4.page_id = failureResult.page_id;
  p4.page_number = failureResult.page_number;
  p4.source = {
    ...p4.source,
    key: p4.source.key.replace("page-001", "page-004"),
  };
  sub.pages = [p1, p4];
  return sub;
})();

export function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

// Replace the trailing chars of a ULID-like id while keeping it 26-long,
// lowercase alphanumeric (matches contract pattern ^[0-9a-z]{26}$).
export function bumpUlidTail(ulid, suffix) {
  const tail = String(suffix).padStart(6, "0").toLowerCase();
  return ulid.slice(0, ulid.length - tail.length) + tail;
}

// Build a contract-valid submission variant for cross-job testing.
export function makeJob({
  jobIdSuffix = "0001",
  tenantTail,
  documentTail,
  caseTail,
  documentRevision,
  pages,
  metadataTags,
}) {
  const sub = clone(rawBaseSubmission);
  sub.job_id = bumpUlidTail(sub.job_id, jobIdSuffix);
  if (tenantTail !== undefined) {
    sub.tenant_id = bumpUlidTail(sub.tenant_id, tenantTail);
  }
  if (documentTail !== undefined) {
    sub.document_id = bumpUlidTail(sub.document_id, documentTail);
  }
  if (caseTail !== undefined) {
    sub.case_id = bumpUlidTail(sub.case_id, caseTail);
  }
  if (documentRevision !== undefined) {
    sub.document_revision = documentRevision;
  }
  if (metadataTags) {
    sub.metadata = { ...sub.metadata, client_tags: metadataTags };
  }
  if (pages) {
    const p1 = sub.pages[0];
    sub.pages = pages.map(({ idSuffix, page_number }) => {
      const p = clone(p1);
      p.page_id = bumpUlidTail(p1.page_id, idSuffix);
      p.page_number = page_number;
      p.source = {
        ...p.source,
        key: p.source.key.replace(
          "page-001",
          `page-${String(page_number).padStart(3, "0")}`,
        ),
      };
      return p;
    });
  }
  return sub;
}

// Build a contract-valid result variant for cross-job testing.
export function makeResult({
  base,
  jobIdSuffix,
  tenantTail,
  documentTail,
  documentRevision,
  pageIdSuffix,
  pageNumber,
  manualReview,
}) {
  const r = clone(base);
  r.job_id = bumpUlidTail(rawBaseSubmission.job_id, jobIdSuffix);
  if (tenantTail !== undefined) {
    r.tenant_id = bumpUlidTail(rawBaseSubmission.tenant_id, tenantTail);
  }
  if (documentTail !== undefined) {
    r.document_id = bumpUlidTail(rawBaseSubmission.document_id, documentTail);
  }
  if (documentRevision !== undefined) {
    r.document_revision = documentRevision;
  }
  if (pageIdSuffix !== undefined) {
    r.page_id = bumpUlidTail(rawBaseSubmission.pages[0].page_id, pageIdSuffix);
  }
  if (pageNumber !== undefined) r.page_number = pageNumber;
  if (manualReview !== undefined) {
    r.review = {
      manual_review_recommended: manualReview,
      reasons: manualReview ? ["seal_overlap"] : [],
    };
  }
  return r;
}

// Default monotonic-second clock used by most conformance tests.
// Each call advances by 1 second; persisted_at and created_at therefore
// land on a strictly increasing sequence.
export function monotonicClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2030, 0, 1, 0, 0, tick++));
}

// Fixed clock for tests that need ties on persisted_at / created_at.
export function fixedClock(iso = "2030-06-01T00:00:00.000Z") {
  const d = new Date(iso);
  return () => d;
}
