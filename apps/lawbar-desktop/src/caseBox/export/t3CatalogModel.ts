// t3CatalogModel.ts — T3 证据目录及说明 deterministic LOGICAL export model
// (WI-FORMS-T3-S1-LOGICAL-EXPORT-ADAPTER-00).
//
// Per dev-memo/plan-forms-t3-evidence-catalog-00.md §4 slice S1 + dev-memo/adr-forms-t3-s0-schema.md §6
// (BINDING): a renderer-independent, pure logical model for the internal lawyer trial-review 证据目录及说明
// form, built ONLY from the already-merged S0 payload fields (evidence_title / proof_statement /
// display_order / matter litigation_position + the existing exhibit_page_range). It mirrors the A10-T6
// deterministic-serialization pattern (a10CanonicalExportModel.ts): the small nfc / stableStringify /
// sha256 helpers are DUPLICATED locally because `stableStringify` is module-private there — this module
// does NOT import, extend, or modify a10CanonicalExportModel.ts (ADR §6).
//
// This slice writes NOTHING and renders NOTHING: no DOCX/PDF, no UI/preview, no IPC channel, no DTO, no
// schema/contract/persistence change (DR-00; parent plan §6). 页码 is always the exhibit_page_range
// passthrough; the A10 卷X页Y citation is DELIBERATELY NOT attached here (it would require the
// DocumentPage / A10 citation pipeline = scope expansion) — so 页码 can never be replaced (DR-00 Q4).
// Manual-truth posture (.claude/rules/evidence-genie.md invariant 2): a missing/blank lawyer-entered
// value renders an explicit needs-review marker; nothing is derived from a document filename, `notes`,
// or `party_side`, and an ambiguous submitter is REFUSED, never guessed (mirrors the A1 posture).

import { createHash } from "node:crypto";

/** The form identity constant (not fabricated matter data; a stable discriminator). */
export const T3_FORM_TYPE = "证据目录及说明" as const;

/** A resolved display value. */
export interface T3TextCell {
  readonly text: string;
}
/** An explicit lawyer-review marker for a missing/blank value — never a fabricated or substituted value. */
export interface T3ReviewNeededCell {
  readonly reviewNeeded: true;
}
/** A visible table cell: EXACTLY one of a resolved text value XOR an explicit needs-review marker. */
export type T3Cell = T3TextCell | T3ReviewNeededCell;
/** The header 提交人诉讼地位 cell: a procedural position XOR an explicit needs-review marker. */
export type T3PositionCell = { readonly value: "plaintiff" | "defendant" } | T3ReviewNeededCell;

/** One T3 catalog row: 序号 + traceable evidence id + the three visible columns (证据名称/证明内容/页码). */
export interface T3CatalogRow {
  readonly sequence: number;
  readonly evidenceId: string;
  readonly evidenceName: T3Cell;
  readonly proofStatement: T3Cell;
  readonly pageRange: T3Cell;
}

/**
 * The deterministic T3 logical model. Header carries the matter-level 提交人诉讼地位 and the resolved
 * submitter 名称/姓名; rows are ordered + sequentially numbered. Renderer-independent; no timestamps,
 * machine paths, raw display_order values, or citation metadata.
 */
export interface T3CatalogModel {
  readonly formType: typeof T3_FORM_TYPE;
  readonly matterId: string;
  readonly litigationPosition: T3PositionCell;
  readonly submitterName: T3TextCell;
  readonly rows: ReadonlyArray<T3CatalogRow>;
}

/** Structural, type-only inputs (no runtime dependency, no contract-package import). */
export interface T3PartyInput {
  readonly role: string;
  readonly display_name: string;
}
export interface T3MatterInput {
  readonly id: string;
  readonly parties: ReadonlyArray<T3PartyInput>;
  readonly litigation_position?: string;
}
export interface T3EvidenceInput {
  readonly id: string;
  readonly status: string;
  readonly created_at: string;
  readonly evidence_title?: string;
  readonly proof_statement?: string;
  readonly exhibit_page_range?: string | null;
  readonly display_order?: number;
}
/**
 * Export-time submitter selection for a matter that does NOT have exactly one client party. Identifies the
 * chosen party by its INDEX in `matter.parties` plus a `displayNameEcho` (the model refuses if the echo no
 * longer matches the party at that index — catching a reordered/edited parties array). Per ADR §2/§4.
 */
export interface T3SubmitterSelection {
  readonly partyIndex: number;
  readonly displayNameEcho: string;
}

/** Refusal codes for an unresolvable/ambiguous submitter — the model refuses rather than guesses. */
export type T3RefusalCode =
  | "submitter_selection_required"
  | "submitter_index_out_of_range"
  | "submitter_not_client"
  | "submitter_selection_stale";

/** Thrown when the submitter cannot be resolved deterministically (an expected outcome, not a bug). */
export class T3CatalogRefusal extends Error {
  readonly code: T3RefusalCode;
  constructor(code: T3RefusalCode, message: string) {
    super(message);
    this.name = "T3CatalogRefusal";
    this.code = code;
  }
}

/** NFC-normalize a string (Unicode normalization is part of the determinism rule; A10-T6 convention). */
function nfc(s: string): string {
  return s.normalize("NFC");
}

/**
 * Resolve a lawyer-entered text column to a cell. A non-string or a value that is whitespace-only (after
 * NFC) is BLANK → `{ reviewNeeded: true }` (do not rely solely on upstream validation, per review-plan
 * Low). A non-blank value is preserved VERBATIM (NFC only) — multi-clause Chinese proof text is not
 * trimmed or altered; trim() is used ONLY for the blankness decision.
 */
function textCell(raw: unknown): T3Cell {
  if (typeof raw === "string") {
    const v = nfc(raw);
    if (v.trim().length > 0) return { text: v };
  }
  return { reviewNeeded: true };
}

/** matter.litigation_position → position cell; anything not in the enum (incl. absent) is needs-review. */
function positionCell(pos: unknown): T3PositionCell {
  if (pos === "plaintiff" || pos === "defendant") return { value: pos };
  return { reviewNeeded: true };
}

/** display_order is usable for ordering ONLY when a non-negative integer; else treated as absent. */
function validOrder(d: unknown): number | null {
  return typeof d === "number" && Number.isInteger(d) && d >= 0 ? d : null;
}

/**
 * Resolve the submitter 名称/姓名. The submitter is the single `role === "client"` party (auto-selected).
 * A matter with ZERO or >1 client parties REFUSES unless an explicit `selection` resolves to a client
 * party whose NFC display_name still equals the echo. Even a single-client matter validates a supplied
 * selection. Refuse-not-guess (ADR §2/§4; A1 ambiguous-citation posture).
 */
function resolveSubmitter(matter: T3MatterInput, selection?: T3SubmitterSelection): T3TextCell {
  if (!selection) {
    const clients = matter.parties.filter((p) => p.role === "client");
    if (clients.length === 1) return { text: nfc(clients[0].display_name) };
    throw new T3CatalogRefusal(
      "submitter_selection_required",
      `matter has ${clients.length} client parties; an explicit submitterSelection is required`,
    );
  }
  const { partyIndex, displayNameEcho } = selection;
  if (!Number.isInteger(partyIndex) || partyIndex < 0 || partyIndex >= matter.parties.length) {
    throw new T3CatalogRefusal(
      "submitter_index_out_of_range",
      `submitterSelection.partyIndex ${partyIndex} is out of range (parties: ${matter.parties.length})`,
    );
  }
  const party = matter.parties[partyIndex];
  if (party.role !== "client") {
    throw new T3CatalogRefusal(
      "submitter_not_client",
      `party at index ${partyIndex} has role "${party.role}", not "client"`,
    );
  }
  if (nfc(party.display_name) !== nfc(displayNameEcho)) {
    throw new T3CatalogRefusal(
      "submitter_selection_stale",
      `submitterSelection.displayNameEcho no longer matches the party at index ${partyIndex}`,
    );
  }
  return { text: nfc(party.display_name) };
}

/**
 * Deterministic row order: valid-`display_order` rows first (ascending), then rows without a valid order,
 * with a stable `created_at ASC, id ASC` fallback for ties and unordered rows. `created_at` is compared as
 * a raw NFC string (never Date.parse — avoids timezone/runtime parsing variance; review-plan Low).
 */
function compareEvidence(a: T3EvidenceInput, b: T3EvidenceInput): number {
  const oa = validOrder(a.display_order);
  const ob = validOrder(b.display_order);
  const ha = oa !== null;
  const hb = ob !== null;
  if (ha !== hb) return ha ? -1 : 1;
  if (ha && hb && oa !== ob) return (oa as number) < (ob as number) ? -1 : 1;
  const ca = nfc(a.created_at);
  const cb = nfc(b.created_at);
  if (ca !== cb) return ca < cb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Build the deterministic T3 catalog model. Rows are filtered to `includeStatuses` (default `["accepted"]`,
 * which excludes proposed/rejected/superseded — a supersession chain shows only the live row), ordered per
 * {@link compareEvidence}, and numbered 1..n. 证据名称/证明内容/页码 bind to evidence_title/proof_statement/
 * exhibit_page_range ONLY — `notes`, document filename, and `party_side` are never promoted.
 */
export function buildT3CatalogModel(params: {
  matter: T3MatterInput;
  evidenceItems: ReadonlyArray<T3EvidenceInput>;
  submitterSelection?: T3SubmitterSelection;
  includeStatuses?: ReadonlyArray<string>;
}): T3CatalogModel {
  const includeStatuses = params.includeStatuses ?? ["accepted"];
  const submitterName = resolveSubmitter(params.matter, params.submitterSelection);
  const ordered = params.evidenceItems
    .filter((e) => includeStatuses.includes(e.status))
    .slice()
    .sort(compareEvidence);
  const rows: T3CatalogRow[] = ordered.map((e, i) => ({
    sequence: i + 1,
    evidenceId: e.id,
    evidenceName: textCell(e.evidence_title),
    proofStatement: textCell(e.proof_statement),
    pageRange: textCell(e.exhibit_page_range),
  }));
  return {
    formType: T3_FORM_TYPE,
    matterId: params.matter.id,
    litigationPosition: positionCell(params.matter.litigation_position),
    submitterName,
    rows,
  };
}

/**
 * Deterministic serialization (A10-T6 rule): recursively sort object keys, NFC-normalize every string,
 * preserve the (already content-stable) array order, emit compact JSON. No timestamps / machine paths /
 * renderer metadata are present, so the output is byte-identical across runs and machines.
 */
export function serializeT3CatalogModel(model: T3CatalogModel): string {
  return stableStringify(model);
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(nfc(value));
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number is not canonically serializable");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
  }
  throw new Error(`unserializable value of type ${typeof value}`);
}

/** SHA-256 (hex) of the deterministic serialization — the reproducibility unit (A10-T6 convention). */
export function t3CatalogModelSha256(model: T3CatalogModel): string {
  return createHash("sha256").update(serializeT3CatalogModel(model), "utf8").digest("hex");
}
