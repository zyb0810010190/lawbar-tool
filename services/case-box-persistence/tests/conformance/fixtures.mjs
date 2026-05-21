// Deterministic fixture builders for case-box-persistence Phase A1 tests.

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** Pad-and-counter id generator producing schema-valid 26-char ULIDs. */
export function makeIdGenerator(prefix) {
  if (typeof prefix !== "string" || prefix.length === 0 || prefix.length > 17) {
    throw new Error(`makeIdGenerator: prefix must be 1-17 lowercase chars+digits, got ${JSON.stringify(prefix)}`);
  }
  if (!/^[0-9a-z]+$/.test(prefix)) {
    throw new Error(`makeIdGenerator: prefix must match /^[0-9a-z]+$/, got ${JSON.stringify(prefix)}`);
  }
  let counter = 0;
  const padded = (prefix + "00000000000000000").slice(0, 18); // 18-char prefix region
  return () => {
    const c = counter++;
    let n = c;
    const out = [];
    for (let i = 0; i < 8; i++) {
      out.unshift(ALPHABET[n & 0x1f]);
      n >>>= 5;
    }
    const id = padded + out.join("");
    if (!/^[0-9a-z]{26}$/.test(id)) {
      throw new Error(`makeIdGenerator: produced invalid id ${JSON.stringify(id)}`);
    }
    return id;
  };
}

/** Deterministic clock returning Date instances `stepMs` apart starting at `start`. */
export function makeClock(start, stepMs = 1000) {
  let t = new Date(start).getTime();
  return () => {
    const d = new Date(t);
    t += stepMs;
    return d;
  };
}

const VALID_MATTER_ID = "01jcasemattermockid0000001";
const VALID_TENANT_ID = "tenant-local-v1";

export function makeMatterInput(overrides = {}) {
  return {
    id: VALID_MATTER_ID,
    tenant_id: VALID_TENANT_ID,
    actor_user_id: "local-user",
    name: "Test Matter",
    jurisdiction: { value: "cn-sh", locked: false },
    matter_type: "litigation",
    parties: [
      { role: "client", display_name: "ACME Corp", party_kind: "organization" },
    ],
    confidentiality_class: "normal",
    status: "active",
    external_ocr_authorized: false,
    sync_grant_present: false,
    llm_extraction_opt_in: false,
    created_at: "2026-05-20T09:00:00.000Z",
    ...overrides,
  };
}

export function makeDocumentInput(overrides = {}) {
  return {
    id: "01jcasedocmockid000000001a",
    tenant_id: VALID_TENANT_ID,
    actor_user_id: "local-user",
    matter_id: VALID_MATTER_ID,
    source: "uploaded",
    filename: "complaint.pdf",
    content_hash: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    storage_uri: "file:///tmp/x.pdf",
    ocr_job_id: null,
    doc_type: "pleading",
    received_at: "2026-05-20T09:04:30.000Z",
    status: "registered",
    ...overrides,
  };
}

export const DEFAULT_MATTER_ID = VALID_MATTER_ID;
export const DEFAULT_TENANT_ID = VALID_TENANT_ID;
export const DEFAULT_DOCUMENT_ID = "01jcasedocmockid000000001a";
export const DEFAULT_PRIVILEGE_MARKER_ID = "01jcasepmkmockid0000000001";
export const DEFAULT_FACT_ID = "01jcasefactmockid000000001";
export const DEFAULT_DOCKET_ENTRY_ID = "01jcasedockmockid000000001";
export const DEFAULT_DEADLINE_ID = "01jcasedlinemockid00000001";
export const DEFAULT_EVIDENCE_ID = "01jcaseevidmockid000000001";

export function makeEvidenceItemInput(overrides = {}) {
  return {
    id: DEFAULT_EVIDENCE_ID,
    tenant_id: VALID_TENANT_ID,
    actor_user_id: "local-user",
    matter_id: VALID_MATTER_ID,
    source_document_id: null,
    exhibit_page_range: null,
    lawyer_weight: "moderate",
    status: "proposed",
    supersedes_evidence_id: null,
    created_at: "2026-05-21T22:00:00.000Z",
    ...overrides,
  };
}

export function makeDocketEntryInput(overrides = {}) {
  return {
    id: DEFAULT_DOCKET_ENTRY_ID,
    tenant_id: VALID_TENANT_ID,
    actor_user_id: "local-user",
    matter_id: VALID_MATTER_ID,
    source_type: "manual",
    proposed_kind: "filing",
    proposed_due_at: "2026-06-15T17:00:00.000Z",
    proposed_due_at_kind: "datetime",
    proposed_due_at_timezone: "America/New_York",
    proposed_owner_user_id: "local-user",
    source_rule_citation: null,
    extractor_name: null,
    extractor_version: null,
    extraction_confidence: null,
    source_document_id: null,
    source_page_number: null,
    source_excerpt: null,
    reminder_offsets: [],
    confirmation_state: "proposed",
    proposed_at: "2026-05-21T20:00:00.000Z",
    confirmation_actor_user_id: null,
    confirmed_at: null,
    confirmed_deadline_id: null,
    dismissal_actor_user_id: null,
    dismissed_at: null,
    dismissal_reason: null,
    created_at: "2026-05-21T20:00:00.000Z",
    ...overrides,
  };
}

export function makeFactInput(overrides = {}) {
  return {
    id: DEFAULT_FACT_ID,
    tenant_id: VALID_TENANT_ID,
    actor_user_id: "local-user",
    matter_id: VALID_MATTER_ID,
    statement_text: "Plaintiff signed contract on 2024-01-15.",
    status: "candidate",
    source_type: "lawyer_authored",
    source_document_id: null,
    source_page_number: null,
    source_excerpt: null,
    source_ocr_job_id: null,
    extractor_name: null,
    extractor_version: null,
    extraction_confidence: null,
    reviewer_actor_user_id: null,
    reviewed_at: null,
    accepted_at: null,
    rejected_at: null,
    rejection_reason: null,
    supersedes_fact_id: null,
    created_at: "2026-05-21T15:00:00.000Z",
    ...overrides,
  };
}

export function makePrivilegeMarkerInput(overrides = {}) {
  return {
    id: DEFAULT_PRIVILEGE_MARKER_ID,
    tenant_id: VALID_TENANT_ID,
    actor_user_id: "local-user",
    matter_id: VALID_MATTER_ID,
    target_type: "document",
    target_id: DEFAULT_DOCUMENT_ID,
    kind: "attorney_client",
    status: "proposed",
    source_type: "lawyer_authored",
    basis_text: "Attorney-client communication.",
    extractor_name: null,
    extractor_version: null,
    extraction_confidence: null,
    proposed_at: "2026-05-21T10:00:00.000Z",
    confirmed_actor_user_id: null,
    confirmed_at: null,
    dismissed_actor_user_id: null,
    dismissed_at: null,
    dismissal_reason: null,
    waiver_actor_user_id: null,
    waived_at: null,
    waiver_reason: null,
    created_at: "2026-05-21T10:00:00.000Z",
    ...overrides,
  };
}

export function makeClassificationInput(overrides = {}) {
  return {
    id: "01jcaseclassmockid00000001",
    tenant_id: VALID_TENANT_ID,
    actor_user_id: "local-user",
    matter_id: VALID_MATTER_ID,
    target_type: "document",
    target_id: DEFAULT_DOCUMENT_ID,
    level: "normal",
    prior_level: null,
    change_reason_code: null,
    change_reason_text: null,
    set_at: "2026-05-21T09:00:00.000Z",
    ...overrides,
  };
}
