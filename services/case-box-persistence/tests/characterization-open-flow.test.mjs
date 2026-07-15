// WI-PTA-02 — Characterization: existing matter/evidence open flow (regression guard).
//
// Pins the PRE-FEATURE baseline that WI-PRETRIAL-TRIAL-ADDON-01 must NOT break:
// a case-box store opens and the existing matter -> document -> evidence flow
// works with ZERO pre-trial preparation data (no ClaimTrack / EvidencePreparation
// / CrossExaminationOpinion / LegalOpinionCard tables exist yet). It asserts
// BEHAVIOUR, not a schema-version number, so the intended additive v13/v14
// migration does not falsely fail it — the test must stay green after that
// migration lands (existing matters open with empty preparation rows).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MATTER_ID,
  DEFAULT_EVIDENCE_ID,
  DEFAULT_TENANT_ID,
  makeMatterInput,
  makeDocumentInput,
  makeEvidenceItemInput,
} from "./conformance/fixtures.mjs";
import { makeAuditPair } from "./impl-parity-common.mjs";

test("characterization: matter/evidence open flow works with no pre-trial preparation data", async () => {
  const { inMem, sqlite } = makeAuditPair();
  for (const p of [inMem, sqlite]) {
    // 1. open a matter.
    await p.createMatter(makeMatterInput());
    const matter = await p.getMatter(DEFAULT_MATTER_ID);
    assert.ok(matter !== null && matter.id === DEFAULT_MATTER_ID, "matter opens");

    // 2. register an associated document.
    const doc = await p.registerDocument(DEFAULT_MATTER_ID, makeDocumentInput());

    // 2/3. open/select an evidence item linked to the document.
    await p.appendEvidenceItem(makeEvidenceItemInput({ source_document_id: doc.id }));

    // 3. view evidence detail + the associated document through the current flow.
    const evidence = await p.getEvidenceItem({
      tenant_id: DEFAULT_TENANT_ID,
      matter_id: DEFAULT_MATTER_ID,
      evidence_id: DEFAULT_EVIDENCE_ID,
    });
    assert.ok(evidence !== null, "evidence detail retrievable");
    assert.equal(evidence.source_document_id, doc.id, "evidence links to the document");
    const gotDoc = await p.getDocument(doc.id);
    assert.ok(gotDoc !== null && gotDoc.id === doc.id, "associated document retrievable");

    // 4. continue listing existing matters/evidence with no preparation data.
    const evPage = await p.listEvidenceItems({
      tenant_id: DEFAULT_TENANT_ID,
      matter_id: DEFAULT_MATTER_ID,
      limit: 10,
    });
    assert.equal(evPage.rows.length, 1, "evidence lists with no preparation data");
    const docPage = await p.listDocuments({
      tenant_id: DEFAULT_TENANT_ID,
      matter_id: DEFAULT_MATTER_ID,
      limit: 10,
    });
    assert.equal(docPage.rows.length, 1, "documents list with no preparation data");
  }
});
