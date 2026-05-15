// Pulls in the canonical JSON Schemas from docs/contracts/schemas/ at compile
// time using import attributes (Node 22+, JSON modules). The schemas are the
// source of truth — generated TypeScript types and runtime validators both
// derive from them.

import submissionSchema from "../schemas/ocr-submission.schema.json" with { type: "json" };
import resultSchema from "../schemas/ocr-result.schema.json" with { type: "json" };
import statusSchema from "../schemas/ocr-status.schema.json" with { type: "json" };
import outcomeSchema from "../schemas/ocr-job-outcome.schema.json" with { type: "json" };

export { submissionSchema, resultSchema, statusSchema, outcomeSchema };
