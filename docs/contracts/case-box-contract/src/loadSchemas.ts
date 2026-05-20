// Pulls in the canonical JSON Schemas at compile time using import attributes
// (Node 22+, JSON modules). The schemas are the source of truth — generated
// TypeScript types and runtime validators both derive from them.

import matterSchema from "../schemas/case-box-matter.schema.json" with { type: "json" };
import documentSchema from "../schemas/case-box-document.schema.json" with { type: "json" };
import partySchema from "../schemas/case-box-party.schema.json" with { type: "json" };
import deadlineSchema from "../schemas/case-box-deadline.schema.json" with { type: "json" };
import evidenceItemSchema from "../schemas/case-box-evidence-item.schema.json" with { type: "json" };
import ocrLinkSchema from "../schemas/case-box-ocr-link.schema.json" with { type: "json" };
import auditEventSchema from "../schemas/case-box-audit-event.schema.json" with { type: "json" };
import factSchema from "../schemas/case-box-fact.schema.json" with { type: "json" };

export {
  matterSchema,
  documentSchema,
  partySchema,
  deadlineSchema,
  evidenceItemSchema,
  ocrLinkSchema,
  auditEventSchema,
  factSchema,
};
