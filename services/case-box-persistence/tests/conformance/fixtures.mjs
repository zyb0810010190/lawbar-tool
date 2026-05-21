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
