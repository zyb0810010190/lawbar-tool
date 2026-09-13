// ocr:extract and ocr:pages — the tier ladder, behind the case box's own scoping (R3, WI-12).
//
// THE RENDERER SUPPLIES AN IDENTITY, NEVER A PATH, and never a page's text on the way in. The
// payload is `{ matterId, documentId }` and nothing else. Main resolves the record, main authorises
// it against tenant and matter, main decides which file to read. That is the invariant
// `documentOpenHandlers` already holds, and a document id is a bearer token for any document in the
// box, so answering "that exists but is not yours" would confirm existence across a boundary:
// wrong tenant and no such document are the same refusal.
//
// THE LADDER, AS MEASUREMENT DECIDED IT (see the plan, WI-12 item 6):
//   Tier 0, the PDF text layer, runs first for the whole document in ONE helper call. On the
//   owner's 168 real born-digital pages it was exact, at 40–60 ms and ~18 MB a page. A page with a
//   usable layer never reaches OCR.
//   Tier 1, Apple Vision, runs only for pages with no usable layer, one call per page so a hang on
//   one page cannot cost the rest of the document. Chosen on cost, not accuracy: it ties PaddleOCR
//   at a fifth of the memory and ships no model.
// The layer threshold GATES ESCALATION, NEVER ACCEPTANCE. A short layer sends the page to OCR,
// which is the safe direction; nothing is accepted because the layer looked long enough.
//
// NOTHING HERE IS CERTIFIED. No control engine ships in this build, so every page is stored
// `unchecked` and the renderer is told how many pages need reading — which is all the evidence
// supports: agreement between two DIFFERENT engines was the only signal that accepted nothing
// wrong, and it is not in this build.
//
// WHAT CROSSES BACK IS COUNTS, then text on a second, explicit call. Codes, never a path, never a
// raw thrown message.

import { extractPages, type ExtractResult, type HelperDeps, type HelperPage } from "./helper.js";
import type { OcrControl, OcrOutcome, OcrPageRecord, OcrStore } from "./ocrStore.js";
import { getActiveTenantId } from "../security/activeTenant.js";

export const OCR_EXTRACT_CHANNEL = {
  extract: "ocr:extract",
  pages: "ocr:pages",
} as const;

/**
 * A layer this short is treated as no layer. It gates ESCALATION only: below it the page is
 * recognised, above it the layer is used. The same threshold classified the owner's corpus
 * (938 scanned pages, 168 born-digital) and separated them cleanly.
 */
export const MIN_USABLE_LAYER_CHARS = 20;

/** One page as the renderer may see it. No path, no digest, no timing it cannot interpret. */
export interface OcrPageView {
  readonly page: number;
  readonly pageCount: number;
  readonly outcome: OcrOutcome;
  readonly text: string;
  readonly failureCode: string | null;
  readonly control: OcrControl;
}

export interface OcrExtractSummary {
  readonly pageCount: number;
  readonly fromTextLayer: number;
  readonly recognised: number;
  readonly failed: number;
  /** Pages with no stored outcome at all. Non-zero means the run did not finish the document. */
  readonly missing: number;
  /**
   * Every page of the document, always, in this build. Not "every page that was read": a page
   * that failed or never ran needs the owner's eyes more than one that succeeded, so counting only
   * successes would shrink the number precisely when the document is worse.
   */
  readonly needsReview: number;
}

export type OcrExtractRefusal =
  | "invalid_request"
  | "unknown_document"
  | "unsupported_document"
  | "helper_unavailable"
  /** The derived store could not be opened or written. Regenerable, so this is recoverable. */
  | "store_unavailable"
  | "extract_failed";

export type OcrExtractResult =
  | { readonly ok: true; readonly value: OcrExtractSummary }
  | { readonly ok: false; readonly code: OcrExtractRefusal };

export type OcrPagesResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly pages: readonly OcrPageView[];
        /**
         * Pages with no stored outcome, or NULL when completeness is unknown — nothing has been
         * extracted, or this build cannot say which helper would have. Zero would claim the
         * document is fully accounted for; unknown is the honest answer and the caller must
         * distinguish the two.
         */
        readonly missing: number | null;
      };
    }
  | { readonly ok: false; readonly code: "invalid_request" | "unknown_document" | "helper_unavailable" | "store_unavailable" };

/** The slice of persistence these handlers need. Structural, so the runtime satisfies it as-is. */
export interface OcrDocumentPersistence {
  getMatter(matterId: string): Promise<{ readonly tenant_id: string } | null>;
  getDocument(documentId: string): Promise<{
    readonly id: string;
    readonly tenant_id: string;
    readonly matter_id: string;
    readonly filename: string;
  } | null>;
}

export interface OcrExtractDeps {
  readonly provide: () => { readonly persistence: OcrDocumentPersistence };
  /** Where registered originals live; the same root `document:open` reads. */
  readonly storageRoot: string;
  /**
   * The derived store, resolved ONLY once a request has passed scoping. A provider rather than a
   * value because building the deps object must not open a database: a profile that never OCRs
   * must never grow one, or the readiness guarantee that nothing is written behind the FileVault
   * gate quietly stops covering this store. An Electron test pins that.
   */
  readonly store: () => OcrStore;
  /**
   * The derived store IF it already exists, else null — never creating one. REQUIRED, and separate
   * from `store`, because opening the store CREATES it: reading "what has this document had read?"
   * must not be what brings a second database into a profile. The owner opening a disclosure to
   * look is not the owner asking for a reading. Found by the packaged acceptance, which watched
   * `ocr.sqlite` appear on a profile where nothing had been extracted.
   *
   * One provider rather than an exists-check plus an open, so there is no window between the two
   * in which the answer changes and the losing branch creates the thing it was checking for.
   */
  readonly existingStore: () => OcrStore | null;
  readonly helper: HelperDeps;
  /**
   * The deadline for ONE RECOGNISED PAGE, when it differs from the layer read's. The layer is a
   * whole-document call that measured 40–60 ms a page; recognition measured p95 1.04 s a page and
   * is retried per page. One number for both would either cut the layer short on a long document
   * or let a wedged page hold a 120 s slot for work that should take 50 ms.
   */
  readonly recogniseTimeoutMs?: number;
  /** Injectable for tests only; defaults to the active tenant. */
  readonly tenantId?: () => string;
  readonly now?: () => string;
  /** Injectable for tests only; defaults to the real helper. */
  readonly extract?: typeof extractPages;
  /** Joins the storage root, document id and filename. Injectable so a test needs no real store. */
  readonly resolveFile?: (storageRoot: string, documentId: string, filename: string) => string;
}

const ALLOWED_KEYS: ReadonlySet<string> = new Set(["matterId", "documentId"]);

function isValidRequest(payload: unknown): payload is { matterId: string; documentId: string } {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
  const keys = Object.keys(payload);
  if (keys.length !== 2 || !keys.every((k) => ALLOWED_KEYS.has(k))) return false;
  const p = payload as Record<string, unknown>;
  return typeof p.matterId === "string" && p.matterId.length > 0
    && typeof p.documentId === "string" && p.documentId.length > 0;
}

/** Both "wrong tenant" and "no such document" answer the same, so neither confirms the other. */
async function resolveDocument(
  deps: OcrExtractDeps,
  matterId: string,
  documentId: string,
): Promise<{ readonly filename: string } | null> {
  const tenant = (deps.tenantId ?? getActiveTenantId)();
  const { persistence } = deps.provide();
  const matter = await persistence.getMatter(matterId);
  if (matter === null || matter.tenant_id !== tenant) return null;
  const doc = await persistence.getDocument(documentId);
  if (doc === null || doc.tenant_id !== tenant || doc.matter_id !== matterId) return null;
  return { filename: doc.filename };
}

const defaultResolveFile = (root: string, documentId: string, filename: string): string =>
  `${root}/${documentId}/${filename}`;

/** A page whose layer is long enough to use. Short layers escalate; nothing is accepted by length. */
const layerIsUsable = (p: HelperPage): boolean =>
  p.error === null && p.layer_chars >= MIN_USABLE_LAYER_CHARS
  && typeof p.layer_text === "string" && p.layer_text.trim().length > 0;

function record(
  base: { matterId: string; documentId: string; helperDigest: string; pageCount: number; at: string },
  page: number,
  fields: Partial<OcrPageRecord> & { outcome: OcrOutcome; text: string; source: "pdf" | "image" },
): OcrPageRecord {
  return {
    matterId: base.matterId, documentId: base.documentId, page, pageCount: base.pageCount,
    helperDigest: base.helperDigest, failureCode: null, renderDigest: null,
    layerMs: null, visionMs: null, renderMs: null,
    // Unchecked, always, in a build with no control engine. The store refuses anything else.
    control: "unchecked", controlEngine: null, extractedAt: base.at,
    ...fields,
  };
}

export async function ocrExtractHandler(payload: unknown, deps: OcrExtractDeps): Promise<OcrExtractResult> {
  if (!isValidRequest(payload)) return { ok: false, code: "invalid_request" };
  const doc = await resolveDocument(deps, payload.matterId, payload.documentId);
  if (doc === null) return { ok: false, code: "unknown_document" };

  const helperDigest = deps.helper.pinnedDigest;
  if (helperDigest === null) return { ok: false, code: "helper_unavailable" };
  const run = deps.extract ?? extractPages;
  const file = (deps.resolveFile ?? defaultResolveFile)(deps.storageRoot, payload.documentId, doc.filename);
  // Opening a sqlite file can throw, and what it throws names the file. A code crosses; the path
  // does not. The store is derived, so this is recoverable: the owner can try again.
  let store: OcrStore;
  try {
    store = deps.store();
  } catch {
    return { ok: false, code: "store_unavailable" };
  }
  const at = (deps.now ?? (() => new Date().toISOString()))();
  const base = { matterId: payload.matterId, documentId: payload.documentId, helperDigest, pageCount: 1, at };

  // A THROWN helper is a coded refusal, never raw text across the boundary. `extractPages` returns
  // failures as fields, but an injected implementation, an OOM or a programming error can still
  // reject, and whatever message that carries may name a path.
  const runSafely = async (options: Parameters<typeof extractPages>[1], timeoutMs?: number): Promise<ExtractResult> => {
    const helper = timeoutMs === undefined ? deps.helper : { ...deps.helper, timeoutMs };
    try {
      return await run(helper, options);
    } catch {
      return { ok: false, code: "helper_bad_output", elapsed_ms: 0 };
    }
  };

  // TIER 0 — the whole document's text layer in one call.
  const layer: ExtractResult = await runSafely({ file, layerOnly: true });
  if (!layer.ok) {
    if (layer.code === "helper_unreadable_input" || layer.code === "helper_bad_arguments") {
      return { ok: false, code: "unsupported_document" };
    }
    if (layer.code === "helper_unpinned" || layer.code === "helper_stale"
      || layer.code === "helper_missing" || layer.code === "helper_not_executable") {
      return { ok: false, code: "helper_unavailable" };
    }
    return { ok: false, code: "extract_failed" };
  }
  const pageCount = layer.pages[0]?.page_count ?? 0;
  if (pageCount === 0) return { ok: false, code: "unsupported_document" };
  const withCount = { ...base, pageCount };

  // Every store WRITE below is inside this guard for the same reason: a disk error mid-document
  // must become a code, not a path in a dialog.
  const needOcr: HelperPage[] = [];
  try {
  for (const p of layer.pages) {
    if (layerIsUsable(p)) {
      store.putPage(record(withCount, p.page, {
        outcome: "text_layer", text: p.layer_text as string, source: p.source, layerMs: p.layer_ms,
      }));
    } else {
      needOcr.push(p);
    }
  }

  // TIER 1 — recognition, one call per page, so one hung page costs one page.
  for (const p of needOcr) {
    const one = await runSafely({ file, pages: { from: p.page, to: p.page } }, deps.recogniseTimeoutMs);
    if (!one.ok) {
      store.putPage(record(withCount, p.page, { outcome: "failed", text: "", source: p.source, failureCode: one.code }));
      continue;
    }
    const got = one.pages[0];
    if (got === undefined || got.error !== null || typeof got.vision_text !== "string") {
      store.putPage(record(withCount, p.page, {
        outcome: "failed", text: "", source: p.source, failureCode: got?.error ?? "extract_failed",
      }));
      continue;
    }
    store.putPage(record(withCount, p.page, {
      outcome: "ocr", text: got.vision_text, source: got.source,
      layerMs: got.layer_ms, visionMs: got.vision_ms, renderMs: got.render_ms, renderDigest: got.render_digest,
    }));
  }
  } catch {
    return { ok: false, code: "store_unavailable" };
  }

  let counts;
  let done;
  try {
    counts = store.countByOutcome(payload.matterId, payload.documentId, helperDigest);
    done = store.completeness(payload.matterId, payload.documentId, helperDigest);
  } catch {
    return { ok: false, code: "store_unavailable" };
  }
  return {
    ok: true,
    value: {
      pageCount, fromTextLayer: counts.text_layer, recognised: counts.ocr, failed: counts.failed,
      missing: done.missing,
      // Every page, because no control ships — including the failed and the unaccounted-for.
      needsReview: pageCount,
    },
  };
}

export async function ocrPagesHandler(payload: unknown, deps: OcrExtractDeps): Promise<OcrPagesResult> {
  if (!isValidRequest(payload)) return { ok: false, code: "invalid_request" };
  const doc = await resolveDocument(deps, payload.matterId, payload.documentId);
  if (doc === null) return { ok: false, code: "unknown_document" };
  const helperDigest = deps.helper.pinnedDigest;
  // No pin means no reading this build would stand behind, and no basis for a page count either.
  // A refusal, not an empty success: an empty list reads as "this document has no OCR", which is a
  // different fact from "this build cannot tell you".
  if (helperDigest === null) return { ok: false, code: "helper_unavailable" };
  let rows;
  let done;
  try {
    const store = deps.existingStore();
    // Nothing has ever been extracted into this profile. Same answer as an existing-but-empty
    // store: no pages, and completeness UNKNOWN rather than a claim of zero missing pages.
    if (store === null) return { ok: true, value: { pages: [], missing: null } };
    rows = store.listPages(payload.matterId, payload.documentId, helperDigest);
    done = store.completeness(payload.matterId, payload.documentId, helperDigest);
  } catch {
    return { ok: false, code: "store_unavailable" };
  }
  // Rebuilt field by field, not forwarded: a column added to the store later cannot cross by default.
  return {
    ok: true,
    value: {
      pages: rows.map((r) => ({
        page: r.page, pageCount: r.pageCount, outcome: r.outcome, text: r.text,
        failureCode: r.failureCode, control: r.control,
      })),
      // Nothing stored at all means nothing is known about how many pages there are.
      missing: rows.length === 0 ? null : done.missing,
    },
  };
}
