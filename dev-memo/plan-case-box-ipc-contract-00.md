# PLAN — Case-box IPC contract (Electron renderer ↔ preload ↔ main ↔ case-box-persistence)

**Status**: PLAN-ONLY (DRAFT-PENDING-REVIEW; rev-3 after third review).
**Date**: 2026-05-25.
**Author**: Claude Code on explicit user direction (case-box IPC contract lane).
**Authoritative after**: `/cc-suite:review-plan` returns READY (or only Low-risk clarifications remain).
**Authorization basis**:
- Tier 1 FileVault enforcement pushed at `678bf16`.
- WI-B Option A native-module smoke pushed at `c708ece`.
- Phase B SQLite implementation complete at `98446aa`.
- rev-1: applies all 7 findings from `review-plan-mpkn1r4v-xb46m4` (4 High + 3 Medium, 0 Critical / 0 Low). Findings touched §1 (cursor non-goal), §3 (timeout T-5), §5 (renderer-DTO note), §6 (DTO pipeline), §7 (error envelope wording), §9 (lint coverage), §10 (CaseBoxRuntime lifecycle), §11 (lifecycle tests), §12 (risks), §14 (startup ordering + lifecycle files + tests). No scope, dependency, or hard-stop change.
- rev-2: applies all 4 findings from `review-plan-mpknjicu-6cty6c` (1 High + 3 Medium, 0 Critical / 0 Low). Findings touched §6.0 (DTO table rewritten against authoritative `case-box-matter.schema.json` + `case-box-document.schema.json`), §5 row 6 + §6.5 (custody-chain naming + reject-on-presence), §3 T-1 (envelope wording), §3 T-5 + risk row (IPC limit clamp to exactly 200 to match persistence `MAX_LIMIT = 200`). No scope, dependency, or hard-stop change. NO schema change to `docs/contracts/case-box-contract`.
- rev-3: applies both Mediums + embedded Low from `review-plan-mpkp496q-19o3k6` (0 Critical / 0 High / 2 Medium / 0 Low + 1 L clarification). Surgical line-level fixes only: §6 pipeline (custody_chain detect-before-strip + reject-on-presence aligned with §5/§6.5), §3 T-5 timeout wording ("returns" not "rejects"; canonical message `"operation timed out"`), §11 timeout test wording (same canonical message; `code:"not_implemented"` retained per the stable `CaseBoxPersistenceErrorCode` invariant — NO new code added; user authorized the keep-not_implemented path to honor the no-schema-changes hard-stop), §3 T-5 limit clamp text ("capped at 200 max" not "exactly 200"; preserves persistence `DEFAULT_LIMIT = 50` and smaller positive values). No scope, dependency, or hard-stop change.

This plan **defines the boundary contract** between the Electron renderer, preload, main, and `services/case-box-persistence`. It does NOT implement that contract. Implementation requires a separate authorized WI plan + cc-suite review-plan + impl + audit + verify pass.

## §1 — Scope + non-goals

**In scope** (plan-only):
- Trust boundary + threat model for renderer ↔ main when case-box data flows.
- IPC channel design (namespacing, single-dispatcher vs per-op channels, naming, error mapping).
- v1 operation taxonomy — which subset of `CaseBoxPersistence` methods the v1 IPC contract exposes.
- Validation strategy (Ajv re-validation; tenant_id injection; argument shape).
- Error envelope shape on the wire (preserving the `CaseBoxPersistenceErrorCode` discriminator).
- Preload exposure surface (`window.lawbar.caseBox.*`) — contextBridge boundary.
- Renderer prohibitions (no Node, no SQLite, no direct persistence import; enforcement mechanism).
- First-impl backing decision (in-memory fixtures vs on-disk FileVault-gated SQLite).
- Test strategy for preload/main IPC without product UI.
- Suggested follow-up WIs to land in sequence.

**Explicitly out of scope** (deferred to later WIs):
- Implementation of any IPC handler.
- Product UI / case-box-aware screens / matter list view / document detail view.
- Adding dependencies (no `electron-store`, no IPC RPC library, no Ajv build-time helper).
- Real case data persistence.
- Tier 2 SQLCipher / Keychain integration (separate lane).
- Real-data migration tooling.
- LLM extraction, OCR worker bridging, deadline reminders, calendar export.
- Multi-window / multi-process IPC fanout.
- Cross-process renderer ↔ renderer IPC (single renderer in v1).
- Translation between renderer-facing pagination cursors and persistence cursors. Per rev-1 M1 fix: cursors are persistence-issued **bearer tokens** — main validates only the string type + a reasonable max length (≤ 4096 chars), never logs cursor values, and passes them through verbatim. Cursor opacity is not asserted (the persistence cursor format is currently a base64url-encoded JSON object carrying `kind`, `filters_hash`, and sort-tuple fields per the persistence `cursor.ts` module — implementation detail, not a contract guarantee). If cursors later need to hide sort tuples from the IPC layer, that becomes a separate "cursor-wrapping" WI before any external or synced client consumes them.
- Schema migration UI surface.
- Persistence backup / restore UI.

## §2 — Existing context used

- `AGENTS.md` §"Project Instructions" — contract = vocabulary owner; queue = transport; persistence = source of truth; coordinator owns lifecycle.
- `AGENTS.md` §"Critical invariants" — `CaseBoxPersistenceError` codes are STABLE (see §7 error envelope).
- `dev-memo/plan-encryption-at-rest-00.md` §4.1 (Tier 1 FileVault enforcement; implemented at `678bf16`).
- `dev-memo/plan-first-ui-shell-00.md` §3 — current Electron shell: `sandbox: false`, `contextIsolation: true`, `nodeIntegration: false`, ESM preload (`preload.mjs`), single BrowserWindow.
- `apps/lawbar-desktop/electron/main.ts` (HEAD `678bf16`) — current main process: 138 LOC, 2 IPC channels (`theme:get`, `theme:set`) via `ipcMain.handle`, 1 push channel (`theme:system-change`) via `webContents.send`, FileVault enforcement wrapping `app.whenReady`.
- `apps/lawbar-desktop/electron/preload.mts` — current preload pattern: `contextBridge.exposeInMainWorld("lawbar", { theme: themeApi })` with typed interface.
- `services/case-box-persistence/src/index.ts` — full public API (entry surface, error class, ~40-method `CaseBoxPersistence` interface).
- `services/case-box-persistence/src/types.ts` lines 132-194 — `CaseBoxPersistence` interface (matter / document / audit / classification / privilege / facts / docket / deadline / evidence / OCR-links / aggregations).
- `services/case-box-persistence/src/errors.ts` — `CaseBoxPersistenceErrorCode` enum (11 codes: `duplicate_id`, `unknown_matter`, `unknown_document`, `tenant_mismatch`, `matter_id_mismatch`, `illegal_transition`, `local_only_external_flag_rejected`, `invalid_payload`, `invalid_initial_state`, `invalid_argument`, `not_implemented`).
- `services/case-box-persistence/src/sqlite/openSqliteCaseBoxPersistence.ts` — opener signature: `openSqliteCaseBoxPersistence({ path?: string }): OpenSqliteCaseBoxPersistenceResult`; default path `:memory:`.
- `docs/contracts/case-box-contract/src/index.ts` — Ajv validators per entity (matter, document, audit-event, confidentiality, privilege, fact, docket, deadline, evidence).
- `docs/product/project-requirements-brief.md` §3 (Mac primary), §6 (local-first), §13 (single-lawyer v1; multi-user-ready schemas), §15 (FileVault baseline).
- `.claude/rules/security-boundary.md` — security-sensitive change loop (this plan touches it: renderer trust boundary).
- `.claude/rules/client-local-first.md` — v1 = Mac desktop single-lawyer; cloud = opt-in per document; no public HTTP gateway.
- `.claude/rules/cc-suite.md` §"High-risk WIs" — public API / framework / security work triggers cc-suite review-plan (this plan must run through it).
- `.claude/rules/loc-guardian.md` — fail thresholds for any implementation flowing from this plan.

## §3 — Trust boundary + threat model

### Trust assumptions

| Surface | Trust level | Reasoning |
|---|---|---|
| **Main process** | FULL | Can `require`/`import` Node, SQLite native binding, case-box-persistence. Owns the userData path, the active tenant_id, the FileVault enforcement decision. Owns all schema validation. |
| **Preload** | NARROW | Runs in renderer context (chromium) but with `nodeIntegration: false` + `contextIsolation: true`. Can call `ipcRenderer.invoke / on / removeListener`. CANNOT import case-box-persistence (would bundle SQLite native into renderer). CAN import pure type-only modules. |
| **Renderer** | UNTRUSTED-ISH | Bundler-free vanilla TS (per first UI shell). No `require`. CAN call `window.lawbar.*` (the preload-exposed API). CANNOT use `process`, `Buffer`, `Node.fs`. Treated as **untrusted input source for IPC validation purposes**, even though we ship the renderer code ourselves. |

### Threat classes considered

**T-1 Malformed IPC argument**: a renderer call passes a payload that does not match the contract schema (e.g. missing required field, wrong type, extra property the schema rejects). **Mitigation (rev-2 per M-b)**: main re-validates every IPC argument with Ajv before invoking `case-box-persistence`. Validation failure causes the handler to **return** `{ok: false, error: {kind: "case_box_persistence_error", code: "invalid_payload", message: "payload failed schema validation"}}`. The handler does NOT throw and does NOT reject the IPC promise — that would contradict the §7 envelope contract. Thrown errors are reserved for truly unexpected bugs caught + normalized at the outer boundary per §7.

**T-2 Tenant-id spoofing**: a renderer call attempts to specify a `tenant_id` different from the active lawyer's tenant. **Mitigation**: main NEVER accepts `tenant_id` from renderer; main injects the active tenant_id server-side. Per brief §13 v1 is single-lawyer / single-tenant; tenant_id is retained in schemas but main holds the source of truth (initially a const, later a launch-time lookup).

**T-3 Matter-scope escape**: renderer calls `getDocument(documentId)` for a document outside the current matter. **Mitigation**: read paths re-resolve the matter scope and reject if the document's `matter_id` does not match the asserted scope. This is the same defence that the persistence layer's own `tenant_mismatch` / `matter_id_mismatch` checks provide; main re-enforces at the IPC boundary as defence in depth.

**T-4 Channel-name forgery**: renderer attempts to invoke a channel name not exposed by the preload. **Mitigation**: contextBridge isolation makes `ipcRenderer.invoke` unreachable from renderer; ONLY `window.lawbar.caseBox.*` exists. Main also `ipcMain.handle`s ONLY the explicit allowlist of channels — any `invoke` for an unregistered channel rejects automatically. Belt + suspenders.

**T-5 Privilege escalation via long-running IPC**: a renderer call hangs and locks the main thread / persistence handle.

**Mitigation (rev-1, per H4)**: `better-sqlite3` calls are SYNCHRONOUS under any async wrapper, so `Promise.race` **cannot interrupt them or unlock the main thread once a sync SQLite call is mid-flight**. The earlier framing overclaimed availability protection. Correct v1 framing:

- **Bounded inputs** are the primary defence (rev-2 per M-c; rev-3 clarification): every `limit` is **capped server-side at 200 max**, matching the persistence-side `MAX_LIMIT = 200` defined in `services/case-box-persistence/src/cursor.ts`. Cap = upper bound, NOT a force-to-200 — smaller positive limits round-trip unchanged, and an absent limit defaults to persistence's `DEFAULT_LIMIT = 50`. The IPC cap MUST NOT exceed the persistence cap — if IPC allowed values above 200, persistence would reject them anyway and the renderer would see opaque error mismatches. Raising the cap beyond 200 is a separate persistence-layer WI that must land first; this contract WI does NOT depend on it. No operation accepts an unbounded scan or an arbitrary user-supplied SQL fragment.
- **Validator-bounded payloads**: Ajv validators reject any unbounded array / string-length payload before persistence sees it.
- **SQLite `busy_timeout`** (per `services/case-box-persistence/src/sqlite/openSqliteCaseBoxPersistence.ts`) handles concurrent-writer contention without blocking the main thread indefinitely; the on-disk WI inherits this.
- **Async guard only** for *post*-persistence async work: the IPC handler wraps any post-call async chain (e.g. result normalization that might await) in a per-op timeout map (default 5000 ms; per-op overridable). The async guard catches main-side bugs (a misbehaving wrapper that awaits forever) but **does NOT and CANNOT cancel a running sync SQLite call**.
- **Future cancellation**: if true cancellation of in-flight persistence work becomes necessary (e.g. user clicks "cancel" on a large `listDeadlines` calendar query), that work moves to a **worker_thread** off the main thread. That is a separate WI scoped to "case-box-persistence worker thread offload"; v1 does NOT attempt it.

On timeout (async guard tripping), the handler **returns** (NOT rejects — rev-3 per Medium timeout-envelope drift) `{ok: false, error: {kind:"case_box_persistence_error", code:"not_implemented", message:"operation timed out"}}` and logs the channel + op name (not the payload) to stderr. `code:"not_implemented"` is the existing stable `CaseBoxPersistenceErrorCode` value used to signal "no real cancellation surface exists yet"; introducing a dedicated `"timeout"` code would be a contract-surface change to `services/case-box-persistence/src/errors.ts` (which `AGENTS.md` §"Critical invariants" marks STABLE) and is out of scope for this WI. Canonical message string `"operation timed out"` is used here AND in §11's timeout test for consistency.

**T-6 Replay / dedupe weakness**: renderer calls `createMatter` twice in rapid succession (network flap, double-click). **Mitigation**: this is *not* an IPC concern in v1 — `case-box-persistence` already enforces `duplicate_id` at write time. The IPC layer does not add idempotency keys beyond what the persistence layer requires (matter `id` provided by main).

**T-7 Sensitive data leakage through error message**: persistence error message contains a SQL fragment or schema validator dump that quotes user input. **Mitigation**: on the wire, the IPC error envelope carries `{code, message}` where `message` is a SAFE NORMALIZED string (the persistence error's `.message` is permitted because case-box-persistence already enforces safe error messages per its conformance tests; no SQL fragments leak). Validator-detail errors collapse to `code: "invalid_payload"` + `message: "payload failed schema validation"` WITHOUT including the offending value.

**Explicitly NOT in this threat model** (deferred or out of project posture):
- CSRF (single renderer in a desktop app; no cross-origin attacker).
- XSS sourced from external data (no external data flows into renderer in v1).
- Renderer-process compromise via Chromium 0day (Tier 2 SQLCipher will tighten this; Tier 1 baseline is FileVault).
- Network-borne adversary (no outbound network in this lane; OCR worker is the only place that does network and that is its own security boundary per `.claude/rules/security-boundary.md`).
- Side-channel timing analysis.

## §4 — Channel design (chosen + alternative)

### Chosen: **per-operation channel names under a namespaced prefix**

Pattern: `casebox:<scope>:<op>` (matches existing `theme:get` / `theme:set` precedent).

Examples:
- `casebox:matter:list`
- `casebox:matter:get`
- `casebox:matter:create`
- `casebox:matter:archive`
- `casebox:document:register`
- `casebox:document:list`
- `casebox:document:detail`
- `casebox:audit:listEvents`
- `casebox:audit:chainHead`

Rationale:
- Each channel has ONE persistence method, ONE validator, ONE error mapping. Independently auditable.
- `ipcMain.handle("casebox:matter:list", ...)` is greppable.
- Adding a new operation = adding a new channel registration; no central dispatcher to grow.
- Matches the working theme-IPC pattern, so no new convention to learn.

### Alternative considered: **single dispatcher channel** (`casebox:invoke {method, args}`)

Pros:
- One registration line.
- Easy to wrap all calls in a single audit/metric/error-shaping middleware.

Cons:
- The single channel must validate its own envelope (`method` is a string from renderer; allowlist must be inside the dispatcher).
- Auditing the per-method validation surface becomes a single big switch statement.
- Loses the granular `ipcMain.handle` registration log that cc-suite audit currently relies on for "which channels exist".

**Decision: chosen pattern over alternative.** The dispatcher pattern would be a premature abstraction at v1 scale (~12 operations); revisit if the operation count exceeds ~40 or if cross-cutting middleware becomes load-bearing.

### Push channels (main → renderer)

Pattern: `casebox:<scope>:<event>`. Examples:
- `casebox:audit:eventAppended` (push when a new audit event lands; opt-in subscription).
- `casebox:matter:invalidated` (push when external code modifies a matter; not in v1 scope, mentioned for completeness).

v1 implementation should NOT enable push channels initially — the first case-box-aware screen polls. Push is added in a later WI when realtime updates are user-visible.

## §5 — v1 operation taxonomy (scope cut)

The `CaseBoxPersistence` interface has ~40 methods. The v1 IPC contract exposes a **bounded subset** sufficient to drive the first case-box-aware screen (a matter list + selected-matter detail). Additional methods land in later WIs as screens need them.

### v1 IPC operations (12)

| # | Channel | Persistence method | Notes |
|---|---|---|---|
| 1 | `casebox:matter:list` | `listMatters` | tenant_id injected; `cursor` + `limit` from renderer (clamped server-side) |
| 2 | `casebox:matter:get` | `getMatter` | by `matter_id`; tenant scope enforced |
| 3 | `casebox:matter:create` | `createMatter` | renderer supplies a **DTO** (per §6.0); `id`, `tenant_id`, and `actor_user_id` are injected server-side; full result validated by Ajv (matter schema) after injection |
| 4 | `casebox:matter:archive` | `archiveMatter` | reason text passed; transition validator enforces |
| 5 | `casebox:matter:summary` | `getMatterSummary` | read-side aggregation (Phase A8) |
| 6 | `casebox:document:register` | `registerDocument` | renderer supplies a **DTO** (per §6.0); `id`, `tenant_id`, `actor_user_id`, `received_at`, `status` are injected server-side; `custody_chain` is constructed by main from the active actor (rev-2 per M-a: reject-on-presence — DTO MUST NOT include `custody_chain`); `matter_id` passed as a separate IPC argument (NOT a DTO body field); full result validated by Ajv (document schema) after injection |
| 7 | `casebox:document:list` | `listDocuments` | matter_id scope; cursor + limit |
| 8 | `casebox:document:detail` | `getDocumentDetail` | read-side aggregation (Phase A8) |
| 9 | `casebox:audit:listEvents` | `listAuditEvents` | matter_id scope; cursor + limit |
| 10 | `casebox:audit:chainHead` | `getAuditChainHead` | matter_id scope; returns `event_count + head_hash` |
| 11 | `casebox:audit:verifyChain` | `verifyAuditChainForMatter` | matter_id scope; returns `ChainVerifyOk | ChainVerifyErr` |
| 12 | `casebox:persistence:health` | (no direct persistence method) | returns `{ ok: true, backing: "in-memory" \| "sqlite", schemaVersion: number, fileVaultState: "on" \| "off" \| "non-macos" }` — diagnostic surface |

### Operations DEFERRED (later WIs; one row per future WI suggestion)

- All confidentiality classification ops (`appendConfidentialityClassification`, `getEffectiveClassification`, `listConfidentialityClassifications`) — deferred to "classification UI" WI.
- All privilege marker ops — deferred to "privilege UI" WI.
- All fact ops — deferred to "fact-target" WI when fact target surface lands.
- All docket / deadline ops — deferred to "deadline UI" WI.
- All evidence item ops — deferred to "evidence UI" WI.
- All OCR link ops — deferred to "OCR review" WI bridging this contract with the OCR worker.
- `unarchiveMatter` — deferred (no UI need until archive-management screen lands).
- `getMatterSummary` is in v1; `listMatters` is in v1; `getMatterSummary` per-row is NOT (avoid N+1 from renderer).
- Push channels — deferred.

## §6 — Validation strategy

Every IPC argument that crosses into main from renderer goes through THIS pipeline before reaching persistence:

```
renderer payload (DTO — see §6.0)
   │
   ▼
[1] argument-shape check
    - typeof argument is "object" (or "string" / "number" for primitive args)
    - no functions, no prototypes, no symbols
    - JSON-serializable (Electron IPC already enforces; double-check)
   │
   ▼
[2a] REJECT-on-presence check (rev-3 per M-a residual)
    - For document write ops only: if the DTO contains a `custody_chain`
      property (regardless of value), handler returns
      {ok:false, error:{kind:"case_box_persistence_error",
       code:"invalid_payload",
       message:"custody_chain is server-authority; renderer must not supply it"}}
      and STOPS. Detect-before-strip; no silent acceptance.
    - This is the §6.5 reject-on-presence policy applied at the pipeline
      entry. The old "strip then construct OR validate to match" wording
      from rev-1 is DELETED — §5 row 6, §6.5, and this pipeline now agree.
   │
   ▼
[2b] STRIP server-authority fields (NOT custody_chain — that was rejected at [2a])
    - main strips ALL of {id, tenant_id, actor_user_id} from the
      incoming payload, regardless of whether the renderer supplied them
    - the strip is silent (no error; renderer cannot probe by sending
      tenant_id to see if it was accepted)
   │
   ▼
[3] INJECT server-authority fields
    - tenant_id = getActiveTenantId() (per §6.3)
    - actor_user_id = getActiveActorUserId() (per §6.4)
    - id = newUlid() for write ops that need a server-generated primary
      key (createMatter, registerDocument). Ops that use the id as a
      lookup key (getMatter, getDocument) read the id from the typed
      parameter slot, NOT from a DTO body field.
    - for document register: construct initial custody_chain entry per §6.5
      = [{actor_user_id: getActiveActorUserId(), at: nowIso(), action: "register"}]
   │
   ▼
[4] Ajv RE-validation against the contract schema
    - now validates the FULL payload (post-injection) against the
      corresponding schema in docs/contracts/case-box-contract/
    - for read ops: the corresponding query-shape validator (NEW; see §6.2)
    - failure → handler returns CaseBoxIpcResult.error with
      code: "invalid_payload" (NOT thrown — see §7)
   │
   ▼
[5] persistence call
    - main calls the case-box-persistence method
    - persistence has its OWN Ajv validators; main's re-validation is
      defence in depth, NOT a substitute for persistence's own checks
   │
   ▼
[6] result normalization
    - read paths return persistence row(s) verbatim
    - write paths return the freshly-written row
    - all results are JSON-serializable (Electron IPC enforces)
```

### §6.0 — Renderer DTO contract (rev-1 per H1; rev-2 per H-new — rewritten against authoritative schemas)

For every write op, the renderer sends a **Data Transfer Object (DTO)** — a subset of the full entity that EXCLUDES every server-authority and system field. The DTO type lives in a TYPE-ONLY module the preload exposes and the renderer imports as `import type`:

```
apps/lawbar-desktop/src/casebox/dto.ts  (NEW; pure types; ~80 LOC)
```

DTOs are derived exactly from `docs/contracts/case-box-contract/schemas/case-box-matter.schema.json` and `case-box-document.schema.json`. Field categories per entity:

#### Matter (per `case-box-matter.schema.json`)

| Category | Fields | Source |
|---|---|---|
| **DTO renderer-supplied (required)** | `name`, `jurisdiction` (object: `value` + `locked`), `matter_type` (enum), `parties` (array of `{role, display_name, party_kind, notes?}`), `confidentiality_class` (enum) | Renderer |
| **DTO renderer-supplied (optional)** | `retainer_scope`, `case_type_text`, `case_progress_text`, `court_contact_text`, `contention_summary_text` | Renderer (free-text fields) |
| **Main-injected (server authority)** | `id` = `newUlid()`; `tenant_id` = `getActiveTenantId()`; `actor_user_id` = `getActiveActorUserId()` | Main |
| **Main-injected (system defaults)** | `status` = `"active"`; `external_ocr_authorized` = `false`; `sync_grant_present` = `false`; `llm_extraction_opt_in` = `false`; `created_at` = `nowIso()` | Main (per brief §6 local-first opt-in defaults) |
| **NOT in v1 DTO** | `archived_at` (set only by `archiveMatter` op); `successor_matter_id` (later WI) | Out of v1 scope |

NOTES:
- The plan deliberately uses `name` and the 4 optional text fields (`case_type_text` etc.) — these ARE in the matter schema. There is NO `client_id` field; the schema uses `parties[]` with `role: "client"` to identify the client.
- The 3 opt-in booleans are injected as `false` in v1 to honor brief §6 (local-first default; cloud / external is per-explicit-action). A later UI WI that adds the "enable cloud sync for this matter" toggle will route through a dedicated `casebox:matter:setOptIn` op, NOT through the create DTO.
- `jurisdiction.locked` is `false` at create time (persistence locks it to `true` only after the first deadline is created).

#### Document (per `case-box-document.schema.json`)

| Category | Fields | Source |
|---|---|---|
| **IPC argument (separate)** | `matter_id` | Passed as a separate IPC arg to `casebox:document:register(matterId, dto)`, NOT a DTO body field |
| **DTO renderer-supplied (required)** | `source` (enum), `filename`, `content_hash`, `storage_uri`, `doc_type` (enum) | Renderer |
| **DTO renderer-supplied (optional)** | `language`, `page_count`, `purpose` (enum), `work_order_status` (enum; conditional with `purpose=work_order` per schema `allOf`), `supersedes_document_id`, `letter_date`, `service_status`, `client_authorization_summary`, `preliminary_evidence_summary`, `review_date`, `final_version_marker`, `mime_type`, `byte_size`, `manual_extracted_text`, `ocr_job_id`, `submission_hash` | Renderer (lawyer-supplied workflow metadata) |
| **Main-injected (server authority)** | `id` = `newUlid()`; `tenant_id` = `getActiveTenantId()`; `actor_user_id` = `getActiveActorUserId()` | Main |
| **Main-injected (system defaults)** | `received_at` = `nowIso()`; `status` = `"registered"` | Main |
| **Main-constructed (server authority; reject-on-presence per §6.5)** | `custody_chain` = `[{actor_user_id: getActiveActorUserId(), at: nowIso(), action: "register"}]` | Main only; DTO presence → `invalid_payload` |
| **NOT in v1 DTO** | none — document optional fields all map to lawyer workflow inputs | n/a |

NOTES:
- `matter_id` is passed as a SEPARATE IPC argument (`casebox:document:register(matterId, dto)`) so the renderer never inlines it into the DTO body and so the channel signature mirrors the persistence method shape (`registerDocument(matterId, document)`).
- `ocr_job_id` and `submission_hash` are renderer-supplied (NOT main-injected) because at register time the document may be linked to an existing OCR job by value; a later OCR-bridge WI may move these to a separate `casebox:document:linkOcr` op, but for v1 the renderer can supply them at create time if known.
- The schema's `allOf` invariant — `work_order_status` only when `purpose = "work_order"` — is enforced by Ajv re-validation in step [4] of the §6 pipeline. The IPC layer does not need to duplicate the conditional check.

#### ArchiveMatter

| Category | Fields | Source |
|---|---|---|
| **IPC argument (separate)** | `matter_id` | Passed as separate IPC arg |
| **DTO** | `reason` (string; required by persistence; whitespace-only rejected per A1 audit accepted) | Renderer |
| **Main-injected** | `actor_user_id` for the resulting audit event | Main (constructed by persistence's audit emitter; renderer never supplies actor) |

#### Validation order recap (post-injection Ajv)

For Matter and Document write ops: after step [3] injection in §6 pipeline, the FULL payload (DTO + injected fields) is the input to `validateMatter` / `validateDocument` from `docs/contracts/case-box-contract`. Validation failure returns `{ok:false, error:{code:"invalid_payload"}}` per §3 T-1 rev-2.

If a future schema field is required and the renderer cannot reasonably supply it from the UI, the right resolution is one of:
- **(a) Add it to the main-injected category** if it's server-authority by nature (timestamps, IDs, actor).
- **(b) Add it as a default in the impl WI** if the schema marks it required but allows a reasonable default (e.g. opt-in booleans default `false`).
- **(c) Open a separate contract-schema WI** to make the field optional in the schema if the field is genuinely lawyer-input-only and the UI can't ask for it.

None of these resolutions are needed for the v1 12-op cut; both Matter and Document DTOs above cover every required schema field after main injection.

### §6.1 — Write-op validation

Existing `docs/contracts/case-box-contract` provides:
- `validateMatter`, `validateDocument`, `validateAuditEvent`, `validateConfidentialityClassification`, `validatePrivilegeMarker`, `validateFact`, `validateDocketEntry`, `validateDeadline`, `validateEvidenceItem`.

Main imports the relevant validators and runs them BEFORE calling persistence. Persistence runs them AGAIN internally (per the existing contract package). Cost of double-validation is negligible for desktop scale.

### §6.2 — Read-op validation

Read queries (`ListMattersQuery`, `ListDocumentsQuery`, etc.) are TypeScript types in `services/case-box-persistence/src/types.ts`. They do NOT have JSON-Schema counterparts.

**Decision**: introduce per-query **lightweight runtime validators in the IPC handler module itself** (NOT in the contract package, NOT a new validator harness). Each validator is ~10 lines of typeof / pattern checks. Reason:

- Adding JSON-Schema definitions for read queries would require contract-package changes, which is a higher-blast-radius lane (changes the public schema surface).
- Read queries are renderer-supplied only; persistence does not consume them from external systems.
- The handler-local validator is auditable per-channel.

If review-plan reviewer disagrees and prefers schemas in the contract package, that flips to a Critical finding and we open a separate "case-box-contract read-query schemas" WI before this contract lands.

### §6.3 — Tenant_id source

For v1: main holds `const ACTIVE_TENANT_ID = "default-tenant"` (or equivalent) as a launch-time constant. NOT a real auth source. The brief §13 (single-lawyer v1) + the autonomy hard-stop on auth-provider choice means this is the safe, non-deferral default.

The constant lives in `apps/lawbar-desktop/src/security/activeTenant.ts` (NEW; ~10 LOC) so a later WI can swap it for a real auth source by replacing one file. The IPC handler always reads `getActiveTenantId()`; never inlines.

### §6.4 — Active actor source (rev-1 per H1)

Parallel to §6.3. For v1: main holds `const ACTIVE_ACTOR_USER_ID = "local-user"` in `apps/lawbar-desktop/src/security/activeActor.ts` (NEW; ~10 LOC). NOT a real auth identity; the brief §13 (single-lawyer v1) makes "local-user" the safe default. The IPC handler always reads `getActiveActorUserId()`; never inlines.

When the auth-provider WI lands, both `activeTenant.ts` and `activeActor.ts` swap to read from the auth session in a single bounded change (no IPC contract change required).

### §6.5 — Custody-chain handling (rev-1 per H1; rev-2 per M-a — schema-correct naming + reject-only)

Per the `case-box-document.schema.json` definition, `custody_chain` is an OPTIONAL array on the document entity; each entry requires `{actor_user_id, at}` with optional `action` and `notes`. The IPC handler treats `custody_chain` as **server-authority** with the strictest policy:

- For `casebox:document:register`: the DTO MUST NOT include `custody_chain` at all. If the renderer supplies it, main returns `{ok:false, error:{code:"invalid_payload", message:"custody_chain is server-authority; renderer must not supply it"}}` — REJECT-ON-PRESENCE only; the "or validated to match active actor" alternative previously in §5 row 6 is **DELETED** per rev-2 M-a. Main constructs the initial `custody_chain` as a one-element array: `[{actor_user_id: getActiveActorUserId(), at: nowIso(), action: "register"}]`.
- For any future custody transition op (not in v1 scope): same rule. Main is the only writer; renderer never supplies entries.

Justification for reject-on-presence (stricter than the silent-strip rule for `id`/`tenant_id`/`actor_user_id`): there is no document UPDATE op in v1, so a fetched full document is never re-submitted as a create DTO; the field's presence on a write DTO therefore always indicates a buggy renderer or a forge attempt. Silent strip would hide both. The other server-authority fields (`id`, `tenant_id`, `actor_user_id`, `received_at`, `status`) tolerate echo-back because read-paths might legitimately return them and a sloppy renderer might forward them; for those, silent-strip + inject is sufficient defence.

## §7 — Error envelope on the wire

### Error class on the persistence side

`CaseBoxPersistenceError(code: CaseBoxPersistenceErrorCode, message: string)`. Codes (11): `duplicate_id` / `unknown_matter` / `unknown_document` / `tenant_mismatch` / `matter_id_mismatch` / `illegal_transition` / `local_only_external_flag_rejected` / `invalid_payload` / `invalid_initial_state` / `invalid_argument` / `not_implemented`. **STABLE per `AGENTS.md`** — IPC must NOT collapse / rename these.

### Wire shape (rev-1 per M3)

Electron IPC `invoke` resolves the renderer-side promise with the value the main-side handler returns, OR rejects it with a JS Error if the handler throws. Electron's structured-clone serialization preserves plain-object shape (including discriminator strings) for resolved values, but DOES NOT preserve custom Error subclass shape on thrown errors — only `name + message + stack` survives.

**Contract**: handlers **never throw** for *expected* persistence errors (the 11 stable codes). They ALWAYS return a `CaseBoxIpcResult<T>` value. The wire shape is therefore the value itself, never an exception:

```
type CaseBoxIpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CaseBoxIpcErrorPayload };
```

There is NO custom Error subclass crossing the wire. There is NO preload-side rehydration. The renderer switches on `result.ok` and reads `result.error.code` directly (the discriminator round-trips through structured clone as a plain string). Earlier rev-0 wording about "re-throw a serializable error class that the preload re-hydrates" is **deleted** as self-contradictory.

Unexpected errors (a bug in main, a corrupted SQLite handle, an OS-level fault) ARE allowed to throw — they are not part of the expected-result contract. When that happens, the handler catches at the outer boundary and returns `{ok:false, error:{kind:"case_box_persistence_error", code:"not_implemented", message:"internal error (see main log)"}}`. The full error (with stack) is logged main-side to stderr; nothing leaks to the wire.

Wire envelope (plain object):
```ts
interface CaseBoxIpcErrorPayload {
  readonly kind: "case_box_persistence_error";  // discriminator vs other error sources
  readonly code: CaseBoxPersistenceErrorCode;   // verbatim from persistence
  readonly message: string;                     // safe message (see threat T-7)
}
```

### Main-side serialization

```
ipcMain.handle("casebox:matter:create", async (_event, raw) => {
  try {
    // [1] shape, [2] tenant inject, [3] Ajv, [4] persistence
    const created = await persistence.createMatter(prepared);
    return { ok: true, value: created };          // RESULT envelope
  } catch (e) {
    if (e instanceof CaseBoxPersistenceError) {
      return {
        ok: false,
        error: {
          kind: "case_box_persistence_error",
          code: e.code,
          message: e.message,
        } as CaseBoxIpcErrorPayload,
      };
    }
    // Unexpected: log on main side; surface as opaque on wire
    return {
      ok: false,
      error: {
        kind: "case_box_persistence_error",
        code: "not_implemented",
        message: "internal error (see main log)",
      } as CaseBoxIpcErrorPayload,
    };
  }
});
```

Why a `{ok, value | error}` envelope instead of throw-via-reject:
- Preserves the `code` discriminator verbatim (Electron's auto-serialization would drop it).
- Renderer can switch on `error.code` without re-parsing message strings.
- Symmetric with `docs/contracts/ocr-worker-contract` validator pattern (`{ ok, value } | { ok: false, summary, errors }`).

### Preload-side handling (rev-1 per M3)

The preload returns the envelope verbatim. No rehydration, no `instanceof` checks. Renderer code switches on the discriminator:

```ts
const result = await window.lawbar.caseBox.matter.create(dto);
if (!result.ok) {
  // result.error.code is a CaseBoxPersistenceErrorCode (11-value union)
  // result.error.message is a safe string
  // result.error.kind === "case_box_persistence_error"
  handleError(result.error);
  return;
}
useMatter(result.value);
```

This is the canonical pattern for Electron `contextBridge`-fronted IPC under structured-clone serialization, per the Electron IPC docs the rev-0 reviewer cited.

## §8 — Preload exposure surface

```ts
// apps/lawbar-desktop/electron/preload.mts (additions)

interface CaseBoxApi {
  readonly matter: {
    list(query: ListMattersQuery): Promise<CaseBoxIpcResult<ListMattersPage>>;
    get(matterId: string): Promise<CaseBoxIpcResult<CaseBoxMatter | null>>;
    create(input: unknown): Promise<CaseBoxIpcResult<CaseBoxMatter>>;
    archive(matterId: string, opts: ArchiveMatterOpts): Promise<CaseBoxIpcResult<CaseBoxMatter>>;
    summary(query: GetMatterSummaryQuery): Promise<CaseBoxIpcResult<MatterSummary | null>>;
  };
  readonly document: {
    register(matterId: string, input: unknown): Promise<CaseBoxIpcResult<CaseBoxDocument>>;
    list(query: ListDocumentsQuery): Promise<CaseBoxIpcResult<ListDocumentsPage>>;
    detail(query: GetDocumentDetailQuery): Promise<CaseBoxIpcResult<DocumentDetail | null>>;
  };
  readonly audit: {
    listEvents(query: ListAuditEventsQuery): Promise<CaseBoxIpcResult<ListAuditEventsPage>>;
    chainHead(matterId: string): Promise<CaseBoxIpcResult<AuditChainHead>>;
    verifyChain(matterId: string): Promise<CaseBoxIpcResult<VerifyAuditChainResult>>;
  };
  readonly persistence: {
    health(): Promise<CaseBoxIpcResult<CaseBoxHealth>>;
  };
}

type CaseBoxIpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CaseBoxIpcErrorPayload };

contextBridge.exposeInMainWorld("lawbar", {
  theme: themeApi,          // existing
  caseBox: caseBoxApi,      // NEW
});
```

The preload imports persistence TYPES only:

```ts
import type {
  ListMattersQuery,
  ListMattersPage,
  CaseBoxMatter,
  // etc.
} from "../../services/case-box-persistence/src/types.js";
```

Type-only imports are erased by tsc; they do NOT bundle SQLite / fs / process into the renderer.

## §9 — Renderer prohibition rules

### Build-time (rev-1 per M2)

1. `apps/lawbar-desktop/tsconfig.json` `include`:
   - `renderer/**/*.ts` is included (existing).
   - Adding a build-time constraint: the renderer compile target MUST fail if any renderer file imports from `node:*`, `electron`, `better-sqlite3`, or `services/case-box-persistence` (the runtime barrel — type-only imports are OK).

2. Enforcement: **`apps/lawbar-desktop/scripts/check-renderer-imports.mjs`** (NEW; ~150 LOC; hooked as `pretest`). The script parses each `renderer/**/*.ts` file with the **TypeScript compiler API** (the `typescript` devDep is already present) — NOT a regex — and rejects any of the following when the import specifier is on the forbidden list:

   - **Static `import`** declarations (`import X from "..."`, `import {X} from "..."`, `import "..."`).
   - **Side-effect** imports (`import "..."` alone).
   - **`export from`** declarations (`export {X} from "..."`, `export * from "..."`, `export * as ns from "..."`).
   - **Dynamic `import("...")`** calls (`import("...")` returning a Promise).
   - **Non-type-import type usages** that resolve to forbidden modules (e.g. `import { X } from "electron"` used purely as a type — without the `type` keyword — still bundles `electron` at runtime). The script flags any `import { ... }` without `type` whose target is forbidden, even if the imported binding appears only in a type position.

   The script categorizes each finding as a structural error (process exit 1) and prints the file + line + import specifier + category. Type-only imports (`import type { ... } from "..."` and `import { type X } from "..."`) are PERMITTED for every path on the forbidden list because tsc erases them.

   The dynamic-`import("...")` case is no longer a deferred "uncovered case" — it is a first-class checked case. The rev-0 plan's Low-risk listing for this is replaced by a Medium-fix-now resolution.

   The script logs a one-line summary at exit-0 ("renderer-imports lint: N files OK; M dynamic-import call sites OK") so a future audit can grep for regressions.

### Runtime

- `nodeIntegration: false` (already set).
- `contextIsolation: true` (already set).
- `sandbox: false` (already set; required for ESM preload; future WI may flip to CJS preload to enable sandbox).
- Renderer code is bundler-free vanilla TS — `import` statements in renderer source are visible in the lint script.

### Forbidden imports (lint script enforces)

| Source | Why |
|---|---|
| `electron` | Renderer must use only `window.lawbar.*` |
| `node:*` | No Node APIs in renderer |
| `better-sqlite3` / `better-sqlite3-multiple-ciphers` | No native SQLite in renderer |
| `services/case-box-persistence` (runtime) | Persistence stays in main; only TYPE imports allowed |
| `services/case-box-persistence/src/**` (runtime) | Same |
| `services/ocr-*` (runtime) | OCR pipeline stays out of renderer |
| `fs` / `path` / `os` | No filesystem in renderer |
| `child_process` | No subprocess in renderer |

Type-only imports (`import type { ... }`) are PERMITTED for all paths above and pass the lint script (the script parses ImportDeclaration nodes and matches on `importKind === "type"`).

## §10 — First-impl backing decision

**Two options:**

**Option I — In-memory fixtures**
- v1 IPC handlers are wired to `new InMemoryCaseBoxPersistence(...)`.
- Each app launch starts fresh (no persistence to disk).
- Fixtures are seeded at launch from a JSON file in `apps/lawbar-desktop/fixtures/` (NEW).
- Zero risk of corrupting real case data because no real data exists.
- FileVault enforcement runs normally (the Tier 1 baseline applies), but no actual sensitive data is at risk.

**Option II — On-disk SQLite at the userData path**
- v1 IPC handlers are wired to `openSqliteCaseBoxPersistence({ path: <userData>/casebox.sqlite })`.
- Real persistence; survives launches.
- Requires schema migration discipline from day one.
- Tier 1 FileVault enforcement is the only encryption-at-rest defence (Tier 2 SQLCipher is a later WI).
- Forces commitment to a userData path layout that later impls must respect.

### Chosen: **Option I (in-memory fixtures)**

Rationale:
1. **Scope discipline.** This contract WI is about the IPC SHAPE. Forcing an on-disk decision smuggles in: a path layout, a migration story, an empty-state UX, and a "delete the file to recover" question — each of which is a separate WI's worth of decision.
2. **Iteration cost.** If the IPC shape needs to change after the first screen lands, in-memory backing means no data migration penalty.
3. **Brief §15 alignment.** The encryption-at-rest plan §4.2 explicitly defers per-document encryption; starting with in-memory keeps the encryption surface trivially zero until Tier 2 lands.
4. **Test simplicity.** In-memory IS the test backing, so unit tests and dev runs share one backing.
5. **No risk of leaking real lawyer data** while the IPC contract is still under review.

### Migration to on-disk

Defined as a separate WI ("Case-box IPC on-disk SQLite backing") that swaps the construction of `persistence` from `new InMemoryCaseBoxPersistence()` to `openSqliteCaseBoxPersistence({ path: ... })`. No IPC handler changes; the swap is one factory call.

The factory function lives in `apps/lawbar-desktop/src/casebox/persistenceFactory.ts` (NEW; ~30 LOC) so the swap is one file. Factory selection key: env var `LAWBAR_CASEBOX_BACKING` ∈ `{"in-memory"|"sqlite"}` (default `"in-memory"` in v1; flips to `"sqlite"` after the on-disk WI lands).

If swap-WI also requires schema migration on existing SQLite files, that becomes its own bounded WI (no schema yet at swap time, so migration is null).

### §10.1 — `CaseBoxRuntime` singleton + lifecycle (rev-1 per H2)

The factory produces a value that is bigger than just "the `persistence` interface" — `openSqliteCaseBoxPersistence` returns `{ persistence, db }` where `db` is the `better-sqlite3` handle the caller must `close()` to release the OS file descriptor and avoid a stale WAL. The IPC handler MUST NOT instantiate this per call.

**Singleton**: `CaseBoxRuntime` is a per-app-launch value created once and reused by every IPC handler for the life of the process.

```
apps/lawbar-desktop/src/casebox/runtime.ts  (NEW; ~80 LOC)

export interface CaseBoxRuntime {
  readonly persistence: CaseBoxPersistence;
  readonly backing: "in-memory" | "sqlite";
  readonly schemaVersion: number;
  readonly dispose: () => Promise<void>;
}

let _singleton: CaseBoxRuntime | null = null;

export async function createCaseBoxRuntime(): Promise<CaseBoxRuntime>;
export function getCaseBoxRuntime(): CaseBoxRuntime;  // throws if not yet created
```

**Lifecycle**:

| Phase | Action |
|---|---|
| Pre-`app.whenReady` | Singleton is `null`. Calling `getCaseBoxRuntime()` throws. |
| `app.whenReady` → after FileVault decision | Main calls `await createCaseBoxRuntime()` exactly once. Stores in module-private `_singleton`. |
| Each IPC handler call | Handler imports `getCaseBoxRuntime()` from `runtime.ts` and uses `.persistence`. Handler does NOT construct its own runtime. |
| `app.on("before-quit") / app.on("will-quit")` | Main calls `await runtime.dispose()` which calls `db.close()` for SQLite backing (no-op for in-memory). Idempotent: a second dispose is safe. |

**Backing dispose semantics**:
- **In-memory**: `dispose()` is a no-op resolved Promise. Nothing to close. Useful for symmetry.
- **SQLite**: `dispose()` calls `db.close()`. If the WAL is not checkpointed at close, `better-sqlite3`'s close performs an implicit checkpoint (per its docs). No data loss.

**Test obligations** (added to §11 Tier A):
- A new test asserts `getCaseBoxRuntime() === getCaseBoxRuntime()` (same reference; factory called once).
- A new test asserts that creating two handlers in sequence and invoking them both does NOT trigger more than one factory call (verifiable via a spy on the factory module).
- A new test asserts `dispose()` is idempotent (calling twice does not throw).

The earlier §10 factory description still holds; §10.1 is the lifecycle wrapper around it.

## §11 — Test strategy

### Tier A — Unit tests (no Electron runtime)

Per-handler test exercises the validation pipeline (§6) + the error mapping (§7) AGAINST `new InMemoryCaseBoxPersistence()`.

Suite layout:
- `apps/lawbar-desktop/tests/casebox/matter-handler.test.mjs`
- `apps/lawbar-desktop/tests/casebox/document-handler.test.mjs`
- `apps/lawbar-desktop/tests/casebox/audit-handler.test.mjs`
- `apps/lawbar-desktop/tests/casebox/persistence-health-handler.test.mjs`

Each test imports the handler module directly (handlers are exported pure functions, not just inline `ipcMain.handle` lambdas) and asserts:
- happy path returns `{ok: true, value: ...}`.
- invalid payload returns `{ok: false, error: {code: "invalid_payload", ...}}`.
- tenant spoof attempts are silently overridden (assertion: written row's tenant_id equals injected tenant, NOT renderer-supplied).
- timeout path (slow persistence) — handler **returns** (NOT rejects — rev-3 per Medium timeout-envelope drift) `{ok:false, error:{kind:"case_box_persistence_error", code:"not_implemented", message:"operation timed out"}}` — verifiable via a mock persistence that hangs. Canonical message string `"operation timed out"` matches §3 T-5 verbatim; `code:"not_implemented"` is the existing stable enum value (no new code introduced; see §3 T-5 rev-3 note).

### Tier B — Preload contract tests (no Electron runtime)

Asserts the type-only nature of preload imports:
- `apps/lawbar-desktop/tests/casebox/preload-imports.test.mjs` parses `electron/preload.mts` and asserts every import from `services/case-box-persistence/**` is `import type`.

### Tier C — Renderer prohibition lint

`apps/lawbar-desktop/scripts/check-renderer-imports.mjs` (NEW; §9) runs as `pretest` and exits non-zero on any forbidden import.

### Tier D — E2E (Playwright Electron)

ONE smoke that:
1. Launches the dev shell with `LAWBAR_MODE=dev` + a fixture-seeded in-memory backing.
2. Calls `window.lawbar.caseBox.persistence.health()` from the renderer console.
3. Asserts `result.ok === true && result.value.backing === "in-memory"`.

No product UI involved. This is a `console.log`-of-result smoke confirming the bridge is wired end-to-end.

### Tier E — Acceptance gates (per WI implementing this plan)

- All Tier A handler tests pass.
- Tier B preload-imports test passes.
- Tier C lint passes (no forbidden imports in renderer).
- Tier D E2E passes.
- `loc-guardian:scan` returns 0 over for all new files.
- cc-suite audit returns 0 C/H/M findings (Lows acceptable per §"Audit remediation policy").

## §12 — Risks

| Severity | Risk | Mitigation |
|---|---|---|
| **High** | Renderer's `window.lawbar.caseBox` surface drifts from the IPC channel allowlist (e.g. preload exposes a method but the channel is missing in main). | Tier A handler tests + Tier B preload-imports test + a NEW `tests/casebox/channel-allowlist.test.mjs` that diffs the preload-exposed method tree against the `ipcMain.handle` channel list. Tests are deterministic; drift is detected pre-commit. |
| **Medium** | Cursor scheme (rev-1 per M1): the renderer-supplied `cursor` is verbatim-passed to persistence. The persistence cursor is currently a base64url-encoded JSON object carrying `kind`, `filters_hash`, and sort-tuple fields per `services/case-box-persistence/src/cursor.ts`. It does NOT currently encode SQL OFFSET or rowid, so today's renderer cannot derive SQL execution plan details from inspecting a cursor. The risk is bounded but real: future cursor scheme changes could leak more. | Treat cursors as **persistence-issued bearer tokens** (per rev-1 §1 update): validate only string type + max length (4096 chars); never log values; never display in errors; pass through verbatim. If cursor-hiding becomes required (e.g. when a synced or external client appears), open a "cursor-wrapping" WI before that client lands. |
| **Medium** | `CaseBoxRuntime` singleton (rev-1 per H2): if the impl WI accidentally constructs the runtime per IPC call (instead of using the §10.1 singleton), each call would open a new SQLite handle, leak file descriptors, and corrupt the WAL across concurrent writers. | Factory-call-once tests in §11 Tier A enforce singleton at test time. The lifecycle rules in §10.1 are explicit; impl WI's plan §"Review packet (compact)" must restate them. |
| **Medium** | Startup ordering (rev-1 per H3): if the impl WI registers handlers AFTER `createWindow()`, the first renderer call races an unregistered channel and gets an Electron-default error instead of a `CaseBoxIpcResult.error`. | Hard ordering rule in §14 startup sequence: handlers registered BEFORE `createWindow()`. A startup-order test in §11 Tier A asserts that `casebox:persistence:health` is registered before the BrowserWindow loads. |
| **Medium** | Timeout claim correction (rev-1 per H4): `Promise.race` cannot interrupt a sync `better-sqlite3` call. The earlier T-5 framing overclaimed availability protection. | Per §3 T-5 rev-1: timeout is an async guard only; v1 DoS protection comes from bounded validators, max `limit`, no unbounded scans, and SQLite `busy_timeout`. True cancellation is deferred to a separate worker-thread WI. |
| **Medium** | The `tenant_id` constant lives in code; a later auth-provider lane will need to wire a real source without breaking the IPC contract. | The factory in §6.3 (`getActiveTenantId()`) is the swap seam; auth WI replaces one file. |
| **Medium** | `CaseBoxIpcErrorPayload.message` may inadvertently include user input via persistence error messages. | The persistence layer's conformance harness already asserts safe error messages (no SQL fragments, no user-value substring inclusion for validation errors). If a regression there leaks, this IPC layer leaks too. The IPC tests in Tier A add explicit per-code assertions that the wire message matches a small allowlist of safe strings. |
| **Medium** | Schema-drift: an Ajv validator update in `case-box-contract` changes accepted payloads; main re-validates AND persistence re-validates; if the two go out of sync (e.g. main pinned to an older version), users see inconsistent errors. | Main and persistence are in the same monorepo at the same version; no separate pinning. Tier A tests run against the same validator instance. Recorded as `Risk-M3`. |
| **Low** | `casebox:persistence:health` exposes the backing kind (`in-memory` vs `sqlite`); arguably leaks v1-vs-later distinction. | Acceptable; it's a diagnostic for the lawyer ("which backing am I running?"), not a security secret. |
| ~~Low~~ → **Resolved in rev-1** | The lint script's coverage gaps (dynamic `import()`, re-exports, side-effect imports, non-type-import type usages) flagged in rev-0 as Low + M2 in review. | Per rev-1 §9 update: lint script parses with TypeScript compiler API and rejects all 5 syntactic categories (static / side-effect / export-from / dynamic-import / non-type-import). Type-only imports still permitted. No deferred coverage gaps. |
| **Low** | Per-op 5000 ms timeout (§T-5) may be too tight for `listDocuments` on a future large matter. | Configurable per op; in-memory ops are <1 ms so default works for v1. Revisit when on-disk backing lands. |

No Critical risks identified. If reviewer disagrees, treat the H2 cursor concern as the most likely candidate to escalate.

## §13 — Hard stops

This plan **does NOT trigger any hard-stop in `.claude/rules/autonomy.md` §"Hard-stop list"**:

- No `git push`, no remote write.
- No deploy / release / production / migration / auth provider / cloud vendor / public exposure.
- No new runtime dependency in this plan (the eventual impl WI does not require any either — `electron`, `case-box-persistence`, `case-box-contract` are all already present).
- No public API change (the IPC contract IS new public surface for renderer, but renderer ships with the same release; no external consumer).
- No schema / CLI / wire-format breaking change to existing surfaces (no change to `CaseBoxPersistenceError` codes, no change to `case-box-contract` schemas).
- No secrets / credentials / billing.
- No real case data persistence (Option I in-memory; no userData write of real data).
- No Tier 2 SQLCipher / Keychain work.
- No telemetry, no cloud sync.

The plan IS HIGH-RISK per `.claude/rules/cc-suite.md` §"High-risk WIs" because it defines a security boundary (renderer trust). Therefore `/cc-suite:review-plan` is required. The §14 review packet provides the compact prompt.

## §14 — Review packet (compact)

**Active plan summary**: define the IPC contract between Electron renderer/preload/main and `services/case-box-persistence`. Plan-only; no implementation, no dependencies, no real-data persistence. v1 scope = 12 operations covering matter / document / audit / health. Validation = main re-validates with Ajv + injects tenant_id. Error envelope = `{ok, value | error}` with stable `code` discriminator. First-impl backing = in-memory fixtures (Option I); on-disk SQLite deferred to a later WI. Renderer prohibitions enforced via a hand-rolled lint script + contextIsolation runtime barrier.

**Exact target files (this plan)**:
- `dev-memo/plan-case-box-ipc-contract-00.md` (new, this file).

**Exact target files (eventual impl WI, NOT this plan)** — updated per rev-1 H2 + H3:
- NEW: `apps/lawbar-desktop/electron/ipc/casebox.ts` (handler registrations; called by `registerCaseBoxIpc(runtime)`).
- NEW: `apps/lawbar-desktop/electron/ipc/handlers/{matter,document,audit,persistenceHealth}.ts` (per-domain handlers; consume `getCaseBoxRuntime().persistence`).
- NEW: `apps/lawbar-desktop/electron/ipc/errorEnvelope.ts` (`CaseBoxIpcErrorPayload` + serializer; handlers never throw expected persistence errors).
- NEW: `apps/lawbar-desktop/electron/ipc/validateReadQuery.ts` (lightweight read-query validators per §6.2).
- NEW: `apps/lawbar-desktop/src/casebox/runtime.ts` (rev-1 §10.1; `CaseBoxRuntime` singleton + lifecycle).
- NEW: `apps/lawbar-desktop/src/casebox/persistenceFactory.ts` (in-memory by default; SQLite swap seam).
- NEW: `apps/lawbar-desktop/src/casebox/dto.ts` (rev-1 §6.0; pure DTO types for renderer write payloads).
- NEW: `apps/lawbar-desktop/src/security/activeTenant.ts` (const tenant; swap seam for auth).
- NEW: `apps/lawbar-desktop/src/security/activeActor.ts` (rev-1 §6.4; const actor; swap seam for auth).
- NEW: `apps/lawbar-desktop/fixtures/casebox.fixture.json` (seed data).
- NEW: `apps/lawbar-desktop/scripts/check-renderer-imports.mjs` (TS-AST lint per rev-1 §9).
- MOD: `apps/lawbar-desktop/electron/preload.mts` (expose `caseBox` API; type-only imports of persistence types + DTO types).
- MOD: `apps/lawbar-desktop/electron/main.ts` (rev-1 startup ordering — see "Startup sequence (rev-1 per H3)" below).
- NEW: `apps/lawbar-desktop/tests/casebox/*.test.mjs` (4 handler tests + preload-imports + channel-allowlist + runtime-singleton + dispose-idempotent + startup-order tests).
- NEW: `apps/lawbar-desktop/tests/casebox/smoke.e2e.test.mjs` (Tier D Playwright).

**Startup sequence (rev-1 per H3)** — exact ordering inside `electron/main.ts`:

```
1. app.whenReady().then(async () => {
2.   // a) FileVault decision (existing Tier 1 from commit 678bf16; UNCHANGED)
3.   if (process.argv.includes("--probe-case-box")) return;  // existing short-circuit
4.   const mode = resolveMode(process.env);
5.   const probe = await probeFileVault();
6.   const action = decideAction(probe.state, mode);
7.   if (action === "block") { dialog.showErrorBox(...); app.quit(); return; }
8.   if (action === "warn")  { process.stderr.write(WARN_LINE); }
9.
10.  // b) Create the case-box runtime EXACTLY ONCE (rev-1 §10.1)
11.  const runtime = await createCaseBoxRuntime();
12.
13.  // c) Register ALL casebox:* IPC handlers BEFORE the BrowserWindow exists
14.  registerCaseBoxIpc(runtime);  // ipcMain.handle("casebox:matter:list", ...), etc.
15.
16.  // d) Now (and only now) create the window
17.  createWindow();
18.  app.on("activate", () => {
19.    if (BrowserWindow.getAllWindows().length === 0) createWindow();
20.  });
21. });
22.
23. // e) Lifecycle: dispose runtime on quit
24. app.on("before-quit", async (e) => {
25.   if (_runtime !== null) {
26.     e.preventDefault();
27.     try { await _runtime.dispose(); } finally { _runtime = null; app.quit(); }
28.   }
29. });
```

The renderer cannot send an IPC `invoke` before the BrowserWindow loads, so step (d) happening after step (c) guarantees the first renderer call sees a registered channel. The `before-quit` handler (e) defers the actual quit until `dispose()` resolves, ensuring SQLite close runs even on Cmd-Q.

**Tests** (Tier A additions per rev-1):
- `runtime-singleton.test.mjs`: factory-call-once assertion across multiple `getCaseBoxRuntime()` calls + multiple IPC handler invocations.
- `dispose-idempotent.test.mjs`: `dispose()` called twice resolves cleanly.
- `startup-order.test.mjs`: spies on `registerCaseBoxIpc` + `createWindow` and asserts registration completes before window creation in the main module's exported orchestrator function (the test imports a refactored `bootstrapMainProcess(deps)` that takes injected timing observers — keeps the test deterministic without spawning Electron).

**Exact acceptance criteria (eventual impl WI)**:
- All §11 Tier A/B/C/D tests pass deterministically.
- `loc-guardian:scan` 0 over.
- cc-suite audit 0 C/H/M (Lows acceptable).
- Tier 1 FileVault enforcement (`678bf16`) continues to BLOCK production launches on FileVault-off Macs.
- No new runtime dependency.
- Renderer lint blocks any commit that adds a forbidden import.

**Exact out-of-scope list**:
- Product UI / case-box-aware screens.
- Real case data persistence (in-memory only).
- Tier 2 SQLCipher / Keychain.
- Real-data migration tooling.
- LLM / OCR worker bridging.
- Multi-window / cross-process IPC.
- Push channels (`casebox:*:eventAppended` etc.).
- All entity ops outside the 12 listed in §5: classification, privilege, fact, docket, deadline, evidence, OCR link — each deferred to its own UI WI.
- JSON-Schema definitions for read queries (per §6.2 lightweight validators are local; if reviewer escalates, separate WI for contract-package read-query schemas).

**Essential ADR / contract references**:
- `services/case-box-persistence/src/index.ts` (full public API entry).
- `services/case-box-persistence/src/types.ts` lines 132-194 (CaseBoxPersistence interface).
- `services/case-box-persistence/src/errors.ts` (CaseBoxPersistenceError + stable code list).
- `dev-memo/plan-encryption-at-rest-00.md` §4.1 (Tier 1 FileVault interaction).
- `apps/lawbar-desktop/electron/main.ts` HEAD `678bf16` (current IPC + FileVault wiring).

**Review questions (target the high-risk surfaces)**:
1. Is `tenant_id` injection at the IPC handler the right defence-in-depth boundary, or should persistence be the only enforcer (the plan picks both)?
2. Is the lightweight read-query validator approach (§6.2) acceptable, or should read queries get JSON-Schema definitions in `case-box-contract`? If the latter, that becomes a prerequisite WI before this contract impl can land.
3. Does the `{ok, value | error}` envelope correctly preserve `CaseBoxPersistenceErrorCode` semantics across the Electron IPC serialization boundary, including for the renderer-side switch-on-discriminator pattern? Specifically: does Electron's structured-clone serialization round-trip a plain object with a `kind: "case_box_persistence_error"` discriminator safely?
4. Is Option I (in-memory fixtures) the right first-impl backing, or should v1 commit to on-disk SQLite at the userData path now to avoid a later migration? Recall Tier 1 FileVault is now in place; persistence-on-disk would be FileVault-protected from day one.
5. Are 12 operations the right v1 scope cut, or should a subset (e.g. matter + audit only, defer document) be deferred further to keep the first impl WI bounded? LOC budget hint: `loc-guardian` fail threshold for hand-written source is 800 LOC per file; per-handler files (matter / document / audit) should each stay <200 LOC.

## §15 — LOC budget hint (for eventual impl WI)

| File | Estimated LOC |
|---|---|
| `electron/ipc/casebox.ts` (registrations) | ~80 |
| `electron/ipc/handlers/matter.ts` | ~180 (DTO strip + inject + validate + call) |
| `electron/ipc/handlers/document.ts` | ~140 (DTO strip + inject + custody construct + call) |
| `electron/ipc/handlers/audit.ts` | ~100 |
| `electron/ipc/handlers/persistenceHealth.ts` | ~40 |
| `electron/ipc/errorEnvelope.ts` | ~50 |
| `electron/ipc/validateReadQuery.ts` | ~120 (per-query mini-validators) |
| `src/casebox/runtime.ts` (rev-1 §10.1) | ~80 |
| `src/casebox/persistenceFactory.ts` | ~30 |
| `src/casebox/dto.ts` (rev-1 §6.0; type-only) | ~80 |
| `src/security/activeTenant.ts` | ~10 |
| `src/security/activeActor.ts` (rev-1 §6.4) | ~10 |
| `fixtures/casebox.fixture.json` | ~100 |
| `scripts/check-renderer-imports.mjs` (rev-1 §9 TS-AST) | ~150 |
| `electron/preload.mts` (delta) | +~50 |
| `electron/main.ts` (delta; rev-1 startup ordering) | +~40 |
| Tests (all; rev-1 adds runtime-singleton + dispose + startup-order) | ~750 across 10 files |

Total new + modified: ~2,010 LOC. No single file approaches the 800 fail threshold; all per-handler files stay under 200. The `scripts/check-renderer-imports.mjs` grew (~80 → ~150) to cover the 5 import categories per rev-1 §9; still well under the 800 threshold.

## §16 — Suggested follow-up WIs (max 8)

1. **WI-casebox-ipc-contract-impl** — implement the contract per this plan.
2. **WI-casebox-ipc-on-disk-backing** — flip factory from in-memory to `openSqliteCaseBoxPersistence` at userData path; add schema-migration check; smoke against packaged binary.
3. **WI-casebox-classification-ipc** — extend IPC with confidentiality classification ops.
4. **WI-casebox-privilege-ipc** — extend IPC with privilege marker ops.
5. **WI-casebox-fact-ipc** — extend IPC with fact ops + supersession chain read.
6. **WI-casebox-docket-deadline-ipc** — extend IPC with docket / deadline ops + calendar read.
7. **WI-casebox-evidence-ocr-ipc** — extend IPC with evidence + OCR link ops; bridges to OCR worker.
8. **WI-casebox-push-channels** — add push notifications for audit events when first realtime UI surface needs them.

## §17 — Stop condition

This plan becomes stale when:
- The first impl WI (suggested follow-up #1) lands and is verified. After that, this plan is the authoritative contract reference until either it's superseded by a revised plan OR a Critical drift between this plan and the as-built code is recorded in `dev-memo/deferred-audit-findings.md`.
- `services/case-box-persistence`'s public `CaseBoxPersistence` interface changes shape (method added / removed / signature changed). Triggers an amendment to this plan + cc-suite re-review.
- The Tier 2 SQLCipher impl lands and the persistence factory needs to know about an encrypted-DB code path that did not exist when this plan was written.
- A reviewed ADR supersedes this plan's IPC channel design (e.g. an ADR adopting a different dispatcher pattern across multiple Electron apps).

## §18 — Required cc-suite review

This plan is not authorized for implementation until:
1. It is promoted into a tracked WI plan (suggested follow-up #1 above).
2. The implementation plan includes a `## Review packet (compact)` section (the implementer copies §14 of this plan and tightens to the implementation's exact target files).
3. `/cc-suite:review-plan dev-memo/plan-case-box-ipc-contract-00.md` returns READY (or only Low-risk clarifications remain) for THIS plan; AND the impl WI plan also passes its own `/cc-suite:review-plan`.
4. Any Critical/High findings are fixed and the affected plan is re-reviewed.
5. The chosen first-impl backing (§10 Option I in-memory) is not changed without re-review.

Review focus per `.claude/rules/project-brief.md` §"cc-suite review focus":
- Internal consistency across §3-§13.
- Consistency with existing ADRs / `AGENTS.md` invariants (CaseBoxPersistenceError codes stable; queue/persistence split; contract = vocabulary owner).
- Scope creep (v1 12-op list vs ~40 persistence methods).
- Unsafe assumptions about renderer trust.
- Hard-stop clarity (§13 must be explicit).
