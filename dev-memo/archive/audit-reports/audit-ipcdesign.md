**Findings**

- **A3-LINK-IPC-DESIGN-M1** — **Medium** — [docs/adr/ADR-evidence-a3-link-ipc-surface.md](/Users/zhongyibao/ClaudeProjects/lawbar-tool/docs/adr/ADR-evidence-a3-link-ipc-surface.md:67)  
  The ADR says it “strictly” adopts existing IPC conventions, but D2 defines renderer request IDs as snake_case: `matter_id`, `link_id`, `source_type`, `source_id`, `anchor_id`. Existing renderer-facing DTOs use camelCase for scope/entity identifiers (`matterId`, `documentId`, `deadlineId`, `factId`) and often explicitly forbid snake_case `matter_id`. Examples: [document.ts](/Users/zhongyibao/ClaudeProjects/lawbar-tool/apps/lawbar-desktop/src/caseBox/dto/document.ts:6), [deadline.ts](/Users/zhongyibao/ClaudeProjects/lawbar-tool/apps/lawbar-desktop/src/caseBox/dto/deadline.ts:59), [fact.ts](/Users/zhongyibao/ClaudeProjects/lawbar-tool/apps/lawbar-desktop/src/caseBox/dto/fact.ts:188).  
  **Fix:** Revise request DTOs to renderer/API casing, e.g. `matterId`, `linkId`, `sourceType`, `sourceId`, `anchorId`, and state that handlers translate to persistence snake_case before calling concrete SQLite link functions. Keep response rows snake_case only where existing response allowlists do that.

- **A3-LINK-IPC-DESIGN-L1** — **Low** — [docs/adr/ADR-evidence-a3-link-ipc-surface.md](/Users/zhongyibao/ClaudeProjects/lawbar-tool/docs/adr/ADR-evidence-a3-link-ipc-surface.md:63)  
  D2 says renderer-supplied authority fields are rejected as `invalid_argument / forbidden-field failure`, but the existing helper returns `invalid_payload` via `makeInvalidPayload`: [handlerShared.ts](/Users/zhongyibao/ClaudeProjects/lawbar-tool/apps/lawbar-desktop/src/caseBox/handlerShared.ts:59), [errorMap.ts](/Users/zhongyibao/ClaudeProjects/lawbar-tool/apps/lawbar-desktop/src/caseBox/errorMap.ts:31). This is a wording/error-model mismatch.  
  **Fix:** Change the ADR to say forbidden renderer fields are rejected with the existing `forbiddenFieldFailure`, i.e. `invalid_payload` with `details.schemaPath`.

Other checked areas were consistent: channel naming, `IpcEnvelope`, LINK-surfaced `SAFE_MESSAGES`, concrete SQLite-only link method typing, main-injected actor/tenant, `ExportCitationResult` shape, A0.7 as commit-time only, confidentiality, and design-only scope.

AUDIT-VERDICT: FAIL C0 H0 M1 L1
