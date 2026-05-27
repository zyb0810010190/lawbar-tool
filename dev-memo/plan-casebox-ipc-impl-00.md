# PLAN — `WI-casebox-ipc-contract-impl` (implementation of the case-box IPC contract)

**SUPERSEDED** by `dev-memo/plan-casebox-ipc-impl-01.md` (rev-0.2) after the topology shift introduced by WI-pkg-verify-detection-impl (017c560) + WI-retire-probe-case-box (45167b1) + WI-tarball-poc-impl (e61d7d9). The successor plan retains this file's structural framing (file enumeration, channel mapping, validator pipeline, ULID utility, test plan, LOC budget) but updates: (a) packaged verification routes through the WI-2 crash-detection wrapper instead of raw `child_process.spawn`; (b) CaseBoxRuntime initialization is LAZY (first-IPC-call) instead of eager-at-app-whenReady AND the v1 backing is `InMemoryCaseBoxPersistence` (no SQLite, no DB file, no migrations — SQLite deferred to a later, separately-authorized WI); (c) v1 IPC method scope cut to **5 methods** (`casebox:matter:create` / `:get` / `:list` / `:archive` + `casebox:audit:chainHead`); (d) case-box-persistence + case-box-contract are now installable via the tarball PoC mechanism (commit e61d7d9). This file is kept as historical record; do NOT implement against this plan.

**Status**: PLAN-ONLY (DRAFT-PENDING-REVIEW). [Historical; superseded as above.]
**Date**: 2026-05-25.
**Author**: Claude Code on explicit user direction (case-box IPC impl plan lane).
**Authoritative after**: `/cc-suite:review-plan` returns READY (or only Low-risk clarifications remain).
**Authorization basis**:
- Case-box IPC contract plan (design authority) pushed at `9f9f79b`.
- Tier 1 FileVault enforcement pushed at `678bf16`.
- WI-B Option A better-sqlite3 packaged native-module smoke pushed at `c708ece`.
- Phase B SQLite implementation complete at `98446aa`.

This plan **maps the IPC contract (rev-3 READY) into exact files, functions, signatures, and tests**. It does NOT implement them. The contract plan is the design authority; this plan is the implementer's checklist.

## §1 — Scope + non-goals

**In scope** (plan-only):
- File-by-file enumeration of every file the impl WI creates or modifies.
- Exact function signatures + LOC budgets per file.
- Channel-to-handler mapping for the 12 v1 operations.
- Handler module template (one canonical shape; all per-domain handlers conform).
- Runtime singleton implementation outline (`createCaseBoxRuntime` + `getCaseBoxRuntime` + `dispose`).
- DTO TypeScript types module shape (matches contract plan §6.0 schema-correct DTO definitions verbatim).
- Validation pipeline ordering (mirrors contract §6 pipeline with concrete function calls).
- Active tenant/actor stubs (const seam per contract §6.3 + §6.4).
- Local ULID utility for `apps/lawbar-desktop/` (mirrors persistence's `generateUlid` semantics; avoids re-exporting from persistence package).
- Renderer-import lint script outline (TypeScript compiler API; 5 syntactic categories per contract §9 rev-1).
- Test plan: exact test file names + exact test case names + per-test acceptance assertion.
- First backing mode: in-memory fixture per contract plan §10 Option I.
- Acceptance gates for the impl WI.
- Order of operations (WI execution sequence).
- LOC budget reconciliation against `loc-guardian` thresholds.

**Explicitly out of scope** (deferred):
- Implementation itself.
- Adding any dependency (the impl uses only existing `electron`, `case-box-persistence`, `case-box-contract`, `typescript` devDep).
- Product UI / case-box-aware renderer screens.
- Real case data persistence (in-memory only).
- Tier 2 SQLCipher / Keychain.
- On-disk SQLite backing (separate WI per contract §10 migration path).
- Push channels (`casebox:*:eventAppended`).
- Operations outside the v1 12-op cut (classification, privilege, fact, docket, deadline, evidence, OCR-link).
- Auth provider, cloud sync, signing, distribution.
- Schema changes to `case-box-contract` or `case-box-persistence`.
- Brief amendments.

## §2 — Existing context used

- `dev-memo/plan-case-box-ipc-contract-00.md` (`9f9f79b`) — the contract plan; this plan is its impl-side counterpart.
- `apps/lawbar-desktop/` HEAD `9f9f79b`:
  - `electron/main.ts` (138 LOC; Tier 1 FileVault enforcement + 2 IPC channels + `nativeTheme.on` listener; `app.whenReady().then(async () => { ... })`).
  - `electron/preload.mts` (30 LOC; `contextBridge.exposeInMainWorld("lawbar", { theme: themeApi })`).
  - `src/security/fileVaultProbe.ts` (100 LOC; reference for in-app security module shape).
  - `src/security/activeTenant.ts` — **does NOT exist yet** (impl WI creates).
  - `src/persistence/themePreference.ts` (existing pattern; `loadThemePreference`/`saveThemePreference`).
  - `src/probes/caseBoxProbe.ts` (existing pattern for module-local TS-with-inline-type-shim).
  - `tests/main.test.mjs` (~290 LOC; reference for unit test conventions).
  - `tests/smoke.electron.test.mjs` (existing pattern for Playwright Electron E2E).
  - `package.json` — `dependencies`: `better-sqlite3 ^12.9.0`; `devDependencies`: includes `typescript ^5.6.0` (needed for AST lint).
- `services/case-box-persistence/`:
  - `src/index.ts` — public API entry; exports `InMemoryCaseBoxPersistence`, `openSqliteCaseBoxPersistence`, `CaseBoxPersistence` interface, `CaseBoxPersistenceError` + `CaseBoxPersistenceErrorCode`.
  - `src/types.ts` lines 132-194 — `CaseBoxPersistence` interface (~40 methods).
  - `src/errors.ts` — 11-value stable `CaseBoxPersistenceErrorCode` enum.
  - `src/ulid.ts` — `generateUlid` (INTERNAL; not in `index.ts`; mirror in `apps/lawbar-desktop/src/casebox/ulid.ts` instead of re-exporting).
  - `src/cursor.ts` — `MAX_LIMIT = 200`, `DEFAULT_LIMIT = 50` (consumed via the limit-cap rule in contract §3 T-5 rev-3).
- `docs/contracts/case-box-contract/`:
  - `schemas/case-box-matter.schema.json` — 13 required fields (renderer 5 + main 8).
  - `schemas/case-box-document.schema.json` — 11 required fields (renderer 5 + main 5 + matter_id as separate IPC arg + main-constructed custody_chain).
  - `src/index.ts` — Ajv validators per entity (`validateMatter`, `validateDocument`, etc.).
- `AGENTS.md` §"Critical invariants" — `CaseBoxPersistenceError` codes are STABLE.
- `.claude/rules/cc-suite.md` §"High-risk WIs" — this impl WI is HIGH-RISK (renderer trust boundary); cc-suite review-plan + audit + verify all required.
- `.claude/rules/loc-guardian.md` — hand-written source fail at 800 LOC per file; test fail at 1200 LOC per file.
- `.claude/rules/security-boundary.md` — `CaseBoxPersistenceError` codes MUST NOT be renamed/merged.

## §3 — Implementation file enumeration

| Path | Status | Purpose | Est LOC | Imports (runtime) |
|---|---|---|---|---|
| `apps/lawbar-desktop/electron/ipc/casebox.ts` | NEW | Channel registration entry; `registerCaseBoxIpc(runtime)` calls `ipcMain.handle(...)` for each of the 12 channels | 90 | `electron` (ipcMain); per-domain handler modules |
| `apps/lawbar-desktop/electron/ipc/handlers/matter.ts` | NEW | 5 matter handlers (list/get/create/archive/summary); each as `createMatterHandler(runtime) => (event, args) => Promise<CaseBoxIpcResult<T>>` | 200 | `case-box-persistence` types; `case-box-contract` validators; ipc envelope; runtime |
| `apps/lawbar-desktop/electron/ipc/handlers/document.ts` | NEW | 3 document handlers (register/list/detail); custody_chain reject-on-presence at top of `register` | 160 | same as matter.ts |
| `apps/lawbar-desktop/electron/ipc/handlers/audit.ts` | NEW | 3 audit handlers (listEvents/chainHead/verifyChain) | 110 | same |
| `apps/lawbar-desktop/electron/ipc/handlers/persistenceHealth.ts` | NEW | 1 diagnostic handler returning `{ok:true, value:{backing, schemaVersion, fileVaultState}}` | 45 | runtime; fileVaultProbe (READ STATE not RE-RUN) |
| `apps/lawbar-desktop/electron/ipc/errorEnvelope.ts` | NEW | `CaseBoxIpcErrorPayload` type + `toEnvelopeError(persistenceError)` serializer + `ok(value)`/`err(payload)` constructors | 60 | `case-box-persistence` (`CaseBoxPersistenceError` runtime + `CaseBoxPersistenceErrorCode` type) |
| `apps/lawbar-desktop/electron/ipc/validateReadQuery.ts` | NEW | Per-query lightweight validators for `ListMattersQuery`, `ListDocumentsQuery`, `ListAuditEventsQuery`, `GetMatterSummaryQuery`, `GetDocumentDetailQuery`; each `validate<Name>(raw): { ok: true, value: T } \| { ok: false, error: string }` | 130 | `case-box-persistence` types only (type-only) |
| `apps/lawbar-desktop/electron/ipc/timeout.ts` | NEW | `withTimeout(promise, ms, opChannel)` — async-guard wrapper per contract §3 T-5 | 35 | none |
| `apps/lawbar-desktop/electron/ipc/limitCap.ts` | NEW | `capLimit(limit?: number): number \| undefined` — cap at 200 max; preserve smaller positive; preserve absent (undefined → undefined; persistence applies DEFAULT_LIMIT) | 25 | none |
| `apps/lawbar-desktop/src/casebox/runtime.ts` | NEW | `CaseBoxRuntime` interface; `createCaseBoxRuntime()` / `getCaseBoxRuntime()` / `disposeCaseBoxRuntime()`; module-private `_singleton` per contract §10.1 | 100 | `case-box-persistence` (`InMemoryCaseBoxPersistence`, `openSqliteCaseBoxPersistence`); factory; fileVaultProbe (for `fileVaultState` field) |
| `apps/lawbar-desktop/src/casebox/persistenceFactory.ts` | NEW | `createPersistence(backing)` switch on `"in-memory"|"sqlite"`; SQLite branch returns the seam for the future on-disk WI (throws `"sqlite backing not yet enabled"` in v1) | 40 | `case-box-persistence` (`InMemoryCaseBoxPersistence`) |
| `apps/lawbar-desktop/src/casebox/dto.ts` | NEW | Pure type-only module: `MatterCreateDto`, `DocumentRegisterDto`, `ArchiveMatterDto` (matches contract §6.0 schema-correct field tables verbatim) | 90 | none (types only) |
| `apps/lawbar-desktop/src/casebox/ulid.ts` | NEW | Local `newCaseBoxId()` mirroring persistence's `generateUlid` (Crockford base32, 26 chars, `crypto.randomBytes`); avoids re-exporting from persistence package | 25 | `node:crypto` |
| `apps/lawbar-desktop/src/casebox/clock.ts` | NEW | `nowIso(): string` returning `new Date().toISOString()`; injected wrapper so tests can mock | 10 | none |
| `apps/lawbar-desktop/src/security/activeTenant.ts` | NEW | `export function getActiveTenantId(): string { return "default-tenant"; }` — const seam per contract §6.3 | 10 | none |
| `apps/lawbar-desktop/src/security/activeActor.ts` | NEW | `export function getActiveActorUserId(): string { return "local-user"; }` — const seam per contract §6.4 | 10 | none |
| `apps/lawbar-desktop/fixtures/casebox.fixture.json` | NEW | Seed data loaded at runtime construction: 2 matters + 3 documents + 5 audit events (deterministic); valid against schemas | 110 | (data file; not source) |
| `apps/lawbar-desktop/scripts/check-renderer-imports.mjs` | NEW | TS-AST lint per contract §9 rev-1; rejects 5 import categories against the forbidden module list | 160 | `typescript` (devDep; already present) |
| `apps/lawbar-desktop/electron/main.ts` | MOD | Insert `createCaseBoxRuntime` + `registerCaseBoxIpc(runtime)` between FileVault decision and `createWindow()` per contract §14 startup sequence; add `before-quit` dispose handler | +40 | adds runtime + ipc registrations |
| `apps/lawbar-desktop/electron/preload.mts` | MOD | Add `caseBox: caseBoxApi` namespace under `window.lawbar`; type-only imports of persistence types + DTO types | +50 | type-only |
| `apps/lawbar-desktop/package.json` | MOD | Add `"lint:renderer-imports": "node scripts/check-renderer-imports.mjs"`; chain into `pretest` | +5 | none |

**Total new files**: 17. **Total modified files**: 3. **Total new+modified source LOC**: ~1,375 (excluding tests + fixtures).

## §4 — Canonical handler shape

Every handler module exports `create<Op>Handler(runtime: CaseBoxRuntime)` returning the async handler. The handler shape is uniform:

```ts
export function createMatterCreateHandler(runtime: CaseBoxRuntime) {
  return async (_event: IpcMainInvokeEvent, raw: unknown): Promise<CaseBoxIpcResult<CaseBoxMatter>> => {
    // [1] argument-shape check
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return err({ kind: "case_box_persistence_error", code: "invalid_payload", message: "payload must be a non-null object" });
    }

    // [2a] reject-on-presence for custody_chain (document handlers only; matter omits this step)
    // (matter handler: skip [2a])

    // [2b] strip server-authority fields
    const stripped = stripServerFields(raw, ["id", "tenant_id", "actor_user_id"]);

    // [3] inject
    const payload = {
      ...stripped,
      id: newCaseBoxId(),
      tenant_id: getActiveTenantId(),
      actor_user_id: getActiveActorUserId(),
      status: "active" as const,
      external_ocr_authorized: false,
      sync_grant_present: false,
      llm_extraction_opt_in: false,
      created_at: nowIso(),
    };

    // [4] Ajv re-validation (FULL payload)
    const validation = validateMatter(payload);
    if (!validation.ok) {
      return err({ kind: "case_box_persistence_error", code: "invalid_payload", message: "payload failed schema validation" });
    }

    // [5] persistence call (with async-guard timeout)
    try {
      const created = await withTimeout(
        runtime.persistence.createMatter(payload),
        5000,
        "casebox:matter:create",
      );
      // [6] result normalization (verbatim)
      return ok(created);
    } catch (e) {
      if (e instanceof CaseBoxPersistenceError) {
        return err({ kind: "case_box_persistence_error", code: e.code, message: e.message });
      }
      // unexpected
      process.stderr.write(`[casebox:matter:create] unexpected: ${e instanceof Error ? e.message : String(e)}\n`);
      return err({ kind: "case_box_persistence_error", code: "not_implemented", message: "internal error (see main log)" });
    }
  };
}
```

Variants:
- **Document `register`**: prepends [2a] custody_chain reject-on-presence check; injects `received_at`, `status: "registered"`, custody_chain initial entry; signature is `(event, matterId, dto)` (matter_id is a separate IPC arg per contract §6.0).
- **Read handlers**: skip [2b] strip + [3] inject; instead run [4] as `validateReadQuery.*(raw)` for the corresponding query type; apply `capLimit` to `query.limit` before passing to persistence.
- **Archive**: signature is `(event, matterId, opts)`; opts = `{ reason }`; main does NOT inject IDs (transition op).
- **Health**: no validation pipeline at all; returns `ok({ backing: runtime.backing, schemaVersion: runtime.schemaVersion, fileVaultState: runtime.fileVaultState })`.

Helper functions:
- `stripServerFields(raw, fields)` in `electron/ipc/handlers/_strip.ts` (NEW; ~20 LOC) — returns a shallow copy with named keys removed.
- `ok<T>(value: T)` / `err(payload: CaseBoxIpcErrorPayload)` in `electron/ipc/errorEnvelope.ts`.

## §5 — Channel registration mapping

| # | Channel | Handler factory | Persistence method | Notes |
|---|---|---|---|---|
| 1 | `casebox:matter:list` | `createMatterListHandler(runtime)` | `listMatters` | `capLimit` applied; cursor passthrough |
| 2 | `casebox:matter:get` | `createMatterGetHandler(runtime)` | `getMatter` | `(event, matterId)` |
| 3 | `casebox:matter:create` | `createMatterCreateHandler(runtime)` | `createMatter` | DTO; full pipeline [1]-[6] |
| 4 | `casebox:matter:archive` | `createMatterArchiveHandler(runtime)` | `archiveMatter` | `(event, matterId, {reason})` |
| 5 | `casebox:matter:summary` | `createMatterSummaryHandler(runtime)` | `getMatterSummary` | read |
| 6 | `casebox:document:register` | `createDocumentRegisterHandler(runtime)` | `registerDocument` | `(event, matterId, dto)`; custody_chain reject-on-presence; constructs initial custody entry |
| 7 | `casebox:document:list` | `createDocumentListHandler(runtime)` | `listDocuments` | read; cap+cursor |
| 8 | `casebox:document:detail` | `createDocumentDetailHandler(runtime)` | `getDocumentDetail` | read |
| 9 | `casebox:audit:listEvents` | `createAuditListEventsHandler(runtime)` | `listAuditEvents` | read; cap+cursor |
| 10 | `casebox:audit:chainHead` | `createAuditChainHeadHandler(runtime)` | `getAuditChainHead` | `(event, matterId)` |
| 11 | `casebox:audit:verifyChain` | `createAuditVerifyChainHandler(runtime)` | `verifyAuditChainForMatter` | `(event, matterId)` |
| 12 | `casebox:persistence:health` | `createPersistenceHealthHandler(runtime)` | (no direct method) | diagnostic |

`registerCaseBoxIpc(runtime)` in `electron/ipc/casebox.ts` builds the table and loops:

```ts
const channels = [
  ["casebox:matter:list",       createMatterListHandler(runtime)],
  ["casebox:matter:get",        createMatterGetHandler(runtime)],
  // ... 10 more
] as const;
for (const [channel, handler] of channels) {
  ipcMain.handle(channel, handler);
}
```

A channel-allowlist test (§12 Tier A) asserts the registered set EQUALS the 12 names above (no missing, no extra).

## §6 — DTO type module

`apps/lawbar-desktop/src/casebox/dto.ts` — pure types, NO runtime code:

```ts
import type {
  CaseBoxParty,  // re-exported from case-box-persistence types if needed
} from "../../../../services/case-box-persistence/src/types.js";

// Matter DTO per contract §6.0 + matter.schema.json:
//   Renderer required: name, jurisdiction, matter_type, parties, confidentiality_class
//   Renderer optional: retainer_scope, case_type_text, case_progress_text, court_contact_text, contention_summary_text
//   Main-injected:     id, tenant_id, actor_user_id, status, 3 booleans, created_at
export interface MatterCreateDto {
  readonly name: string;
  readonly jurisdiction: { readonly value: string; readonly locked: boolean };
  readonly matter_type: "litigation" | "arbitration" | "advisory" | "due_diligence" | "criminal_defense" | "other";
  readonly parties: ReadonlyArray<{
    readonly role: "client" | "opposing" | "third_party";
    readonly display_name: string;
    readonly party_kind: "individual" | "organization" | "government" | "court" | "other";
    readonly notes?: string;
  }>;
  readonly confidentiality_class: "normal" | "heightened" | "sealed";
  readonly retainer_scope?: string;
  readonly case_type_text?: string;
  readonly case_progress_text?: string;
  readonly court_contact_text?: string;
  readonly contention_summary_text?: string;
}

// Document DTO per contract §6.0 + document.schema.json:
//   Renderer required: source, filename, content_hash, storage_uri, doc_type
//   Renderer optional: language, page_count, purpose, work_order_status, supersedes_document_id,
//                      letter_date, service_status, client_authorization_summary,
//                      preliminary_evidence_summary, review_date, final_version_marker,
//                      mime_type, byte_size, manual_extracted_text, ocr_job_id, submission_hash
//   IPC separate arg: matter_id
//   Main-injected:    id, tenant_id, actor_user_id, received_at, status
//   Main-constructed: custody_chain (DTO MUST NOT include this — reject-on-presence)
export interface DocumentRegisterDto {
  readonly source: "uploaded" | "produced" | "subpoena" | "court_filing" | "third_party";
  readonly filename: string;
  readonly content_hash: string;
  readonly storage_uri: string;
  readonly doc_type: "pleading" | "contract" | "correspondence" | "transcript" | "exhibit" | "other";
  readonly language?: string;
  readonly page_count?: number;
  readonly purpose?: string;
  readonly work_order_status?: "open" | "in_progress" | "answered" | "closed";
  readonly supersedes_document_id?: string;
  readonly letter_date?: string;
  readonly service_status?: string;
  readonly client_authorization_summary?: string;
  readonly preliminary_evidence_summary?: string;
  readonly review_date?: string;
  readonly final_version_marker?: string;
  readonly mime_type?: string;
  readonly byte_size?: number;
  readonly manual_extracted_text?: string;
  readonly ocr_job_id?: string;
  readonly submission_hash?: string;
  // NOTE: NO id, tenant_id, actor_user_id, matter_id, received_at, status, custody_chain.
  // custody_chain on a DTO triggers reject-on-presence per contract §6.5.
}

export interface ArchiveMatterDto {
  readonly reason: string;
}
```

## §7 — Runtime singleton

`apps/lawbar-desktop/src/casebox/runtime.ts`:

```ts
import type { CaseBoxPersistence } from "../../../../services/case-box-persistence/src/types.js";
import { createPersistence } from "./persistenceFactory.js";
import type { FileVaultState } from "../security/fileVaultProbe.js";

export interface CaseBoxRuntime {
  readonly persistence: CaseBoxPersistence;
  readonly backing: "in-memory" | "sqlite";
  readonly schemaVersion: number;
  readonly fileVaultState: FileVaultState;
  dispose(): Promise<void>;
}

let _singleton: CaseBoxRuntime | null = null;

export interface CreateRuntimeOptions {
  readonly backing?: "in-memory" | "sqlite";  // defaults to "in-memory" for v1
  readonly fileVaultState: FileVaultState;     // captured at create time from the pre-runtime FileVault probe
}

export async function createCaseBoxRuntime(opts: CreateRuntimeOptions): Promise<CaseBoxRuntime> {
  if (_singleton !== null) {
    throw new Error("CaseBoxRuntime already created; createCaseBoxRuntime is single-call");
  }
  const backing = opts.backing ?? "in-memory";
  const { persistence, schemaVersion, internalDispose } = createPersistence(backing);
  _singleton = {
    persistence,
    backing,
    schemaVersion,
    fileVaultState: opts.fileVaultState,
    dispose: async () => {
      await internalDispose();
      _singleton = null;
    },
  };
  return _singleton;
}

export function getCaseBoxRuntime(): CaseBoxRuntime {
  if (_singleton === null) {
    throw new Error("CaseBoxRuntime not created; call createCaseBoxRuntime() first");
  }
  return _singleton;
}

export async function disposeCaseBoxRuntime(): Promise<void> {
  if (_singleton === null) return;  // idempotent
  await _singleton.dispose();
}
```

Tests assert:
- `getCaseBoxRuntime() === getCaseBoxRuntime()` (singleton identity).
- `createCaseBoxRuntime()` called twice throws on the second call.
- `disposeCaseBoxRuntime()` called when no runtime exists is a no-op.
- `disposeCaseBoxRuntime()` called twice in a row is idempotent.

## §8 — Validation pipeline (mirrors contract §6 pipeline)

The pipeline IS the §4 handler shape, with these concrete function names:

- [1] `assertObjectPayload(raw)` — in `electron/ipc/handlers/_validate.ts` (~15 LOC).
- [2a] `assertNoCustodyChain(raw)` — same file (~10 LOC).
- [2b] `stripServerFields(raw, fields)` — same file (~15 LOC).
- [3] `inject<EntityName>Fields(dto, deps)` — per entity in the relevant handler.
- [4] Ajv: `validateMatter` / `validateDocument` from `case-box-contract`; for read ops, `validateReadQuery.<query>(raw)` from `electron/ipc/validateReadQuery.ts`.
- [5] `runtime.persistence.<method>(...)` wrapped in `withTimeout(promise, 5000, opChannel)`.
- [6] `ok<T>(value)` envelope wrap.

Outer try/catch maps `CaseBoxPersistenceError` → envelope; anything else → `code:"not_implemented"` + canonical timeout/internal-error message.

## §9 — Tenant/actor stubs

`apps/lawbar-desktop/src/security/activeTenant.ts`:

```ts
// Active-tenant seam per contract §6.3.
// v1 = single-lawyer; tenant_id is retained in schemas for forward compatibility.
// Auth-provider WI will replace this file with an auth-session reader.

const ACTIVE_TENANT_ID = "default-tenant";

export function getActiveTenantId(): string {
  return ACTIVE_TENANT_ID;
}
```

`apps/lawbar-desktop/src/security/activeActor.ts`:

```ts
// Active-actor seam per contract §6.4.
// v1 = "local-user" sentinel matching case-box-persistence's isLocalOnlyActor().
// Auth-provider WI will replace this file with an auth-session reader.

const ACTIVE_ACTOR_USER_ID = "local-user";

export function getActiveActorUserId(): string {
  return ACTIVE_ACTOR_USER_ID;
}
```

Both files are deliberately 10 LOC each — the impl WI MUST NOT add config-file reading, env-var reading, or any indirection. The single-line `return` is the seam; the auth WI replaces the return body.

## §10 — Local ULID utility

`apps/lawbar-desktop/src/casebox/ulid.ts`:

```ts
// Local schema-valid ID generator. Mirrors services/case-box-persistence/src/ulid.ts
// (Crockford base32, 26 chars, crypto.randomBytes). The persistence module's
// generateUlid is NOT exported from case-box-persistence's public index.ts,
// so re-exporting it from there would be a contract-surface change. Duplicating
// ~20 LOC of generator code is the smaller change; persistence's own validator
// still re-checks pattern at write time.

import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";  // Crockford base32, lowercase
const LENGTH = 26;

export function newCaseBoxId(): string {
  const bytes = randomBytes(LENGTH);
  let out = "";
  for (let i = 0; i < LENGTH; i++) {
    out += ALPHABET[(bytes[i] ?? 0) & 0x1f];
  }
  return out;
}
```

The alphabet + length pin is duplicated, but the duplication is acceptable because:
- The persistence schema enforces `^[0-9a-z]{26}$` at write time — duplicated alphabet is verifiable end-to-end.
- Re-exporting from the persistence package would expand its public surface (a contract-surface change requiring its own cc-suite review).
- The two implementations are tested for byte-equal alphabet via a comparison test (§12 Tier A: `alphabet-parity.test.mjs`).

## §11 — Lint script outline

`apps/lawbar-desktop/scripts/check-renderer-imports.mjs` (per contract §9 rev-1):

```js
#!/usr/bin/env node
// TS-AST renderer-import lint. Rejects 5 syntactic categories of imports
// against the forbidden module list. Type-only imports permitted.

import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

const FORBIDDEN = [
  "electron",
  /^node:/,
  "better-sqlite3",
  "better-sqlite3-multiple-ciphers",
  /^services\/case-box-persistence/,
  /^services\/ocr-/,
  "fs", "path", "os", "child_process",
];

function isForbidden(specifier) {
  for (const rule of FORBIDDEN) {
    if (typeof rule === "string" && rule === specifier) return true;
    if (rule instanceof RegExp && rule.test(specifier)) return true;
  }
  return false;
}

function lintFile(filePath) {
  const source = readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.ES2022, true);
  const findings = [];
  function visit(node) {
    // Category 1: static import (incl. side-effect)
    if (ts.isImportDeclaration(node)) {
      const isTypeOnly = node.importClause?.isTypeOnly === true;
      const specifier = node.moduleSpecifier.text;
      if (!isTypeOnly && isForbidden(specifier)) {
        findings.push({ kind: "static-or-side-effect", specifier, line: ... });
      }
    }
    // Category 2: export from
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const specifier = node.moduleSpecifier.text;
      const isTypeOnly = node.isTypeOnly;
      if (!isTypeOnly && isForbidden(specifier)) {
        findings.push({ kind: "export-from", specifier, line: ... });
      }
    }
    // Category 3: dynamic import("...")
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg) && isForbidden(arg.text)) {
        findings.push({ kind: "dynamic-import", specifier: arg.text, line: ... });
      }
    }
    // Category 4: non-type-import that's used ONLY in type position
    // (Handled by category 1: any non-type-only import of a forbidden source
    // is flagged regardless of usage; this enforces "use `import type`
    // for forbidden sources, period.")

    ts.forEachChild(node, visit);
  }
  visit(sf);
  return findings;
}

// Walk renderer/**/*.ts; lintFile each; if any finding, exit 1 with diagnostic.
```

The implementer fills in the line-number computation + the walker. Estimated 160 LOC total.

## §12 — Test plan

### Tier A — Unit tests (no Electron runtime; pure Node)

| File | LOC est | Tests |
|---|---|---|
| `tests/casebox/matter-handler.test.mjs` | 220 | `list returns ok envelope`, `list caps limit at 200`, `get returns ok envelope`, `get returns null wrapped in ok`, `create returns ok with injected id+tenant+actor`, `create with renderer-supplied id silently strips`, `create with malformed payload returns invalid_payload envelope`, `create with persistence error returns mapped envelope`, `archive returns ok`, `summary returns ok` |
| `tests/casebox/document-handler.test.mjs` | 240 | `register returns ok with main-constructed custody_chain`, `register rejects on custody_chain presence`, `register with renderer-supplied actor_user_id silently strips`, `register with malformed dto returns invalid_payload`, `register with matter_id from separate arg used`, `list caps limit`, `list returns ok envelope`, `detail returns ok envelope` |
| `tests/casebox/audit-handler.test.mjs` | 130 | `listEvents caps limit`, `listEvents returns ok envelope`, `chainHead returns ok envelope`, `verifyChain returns ok envelope (verify_ok)`, `verifyChain returns ok envelope (verify_err carries chain mismatch detail)` |
| `tests/casebox/persistenceHealth-handler.test.mjs` | 50 | `health returns ok with {backing, schemaVersion, fileVaultState}` |
| `tests/casebox/runtime-singleton.test.mjs` | 80 | `getCaseBoxRuntime is singleton across calls`, `createCaseBoxRuntime called twice throws`, `disposeCaseBoxRuntime is idempotent`, `dispose then create resets singleton` |
| `tests/casebox/error-envelope.test.mjs` | 70 | `ok(value) shape`, `err(payload) shape`, `toEnvelopeError preserves code verbatim across 11 stable codes`, `toEnvelopeError preserves safe message` |
| `tests/casebox/validateReadQuery.test.mjs` | 110 | `ListMattersQuery accepts valid`, `ListMattersQuery rejects extra keys`, `ListDocumentsQuery accepts valid`, `ListDocumentsQuery accepts cursor max 4096 chars`, `ListDocumentsQuery rejects cursor > 4096`, `ListAuditEventsQuery accepts valid`, `GetMatterSummaryQuery rejects missing tenant_id`, `GetDocumentDetailQuery rejects extra keys` |
| `tests/casebox/limit-cap.test.mjs` | 50 | `capLimit caps at 200`, `capLimit preserves smaller positive`, `capLimit returns undefined for undefined input`, `capLimit rejects negative / zero / non-integer` |
| `tests/casebox/timeout.test.mjs` | 60 | `withTimeout returns settled value`, `withTimeout rejects with timeout payload after ms`, `withTimeout passes channel name in error message` |
| `tests/casebox/dto-types.test.mjs` | 40 | `MatterCreateDto + injected fields produces post-injection payload that passes validateMatter`, `DocumentRegisterDto + injected fields produces post-injection payload that passes validateDocument` |
| `tests/casebox/ulid.test.mjs` | 50 | `newCaseBoxId returns 26-char string`, `newCaseBoxId matches /^[0-9a-z]{26}$/`, `newCaseBoxId uses Crockford alphabet only`, `newCaseBoxId is byte-distinct across 1000 calls` |
| `tests/casebox/alphabet-parity.test.mjs` | 30 | `local ulid alphabet matches services/case-box-persistence alphabet` (reads both source files, extracts the const, asserts equal) |
| `tests/casebox/startup-order.test.mjs` | 90 | `bootstrapMainProcess registers casebox channels before window create`, `bootstrapMainProcess on quit awaits dispose before app.quit` |

### Tier B — Preload contract tests (no Electron runtime)

| File | LOC est | Tests |
|---|---|---|
| `tests/casebox/preload-imports.test.mjs` | 70 | Parses `electron/preload.mts` with TS AST; asserts EVERY import from `services/case-box-persistence/**` is `import type` |
| `tests/casebox/channel-allowlist.test.mjs` | 80 | Compares preload-exposed methods (parsed from preload.mts TS AST) against registered IPC channel list (parsed from `electron/ipc/casebox.ts` TS AST); asserts they match exactly |

### Tier C — Renderer lint

`pretest` runs `npm run lint:renderer-imports`. Failure aborts the test run. No explicit test file; the script's exit code IS the test.

### Tier D — E2E (Playwright Electron)

| File | LOC est | Tests |
|---|---|---|
| `tests/casebox/smoke.e2e.test.mjs` | 70 | Launches dev shell with `LAWBAR_MODE=dev`; calls `window.lawbar.caseBox.persistence.health()` via `page.evaluate`; asserts `result.ok === true && result.value.backing === "in-memory" && result.value.schemaVersion >= 1` |

### Test totals

| Tier | Files | LOC |
|---|---|---|
| A unit | 13 | ~1,220 |
| B contract | 2 | ~150 |
| C lint | 0 (script-based) | 0 |
| D E2E | 1 | 70 |
| **Total** | **16** | **~1,440** |

No single test file exceeds the 1200-LOC test fail threshold. Largest is `document-handler.test.mjs` at ~240 LOC.

## §13 — First backing mode

Per contract §10 Option I (in-memory fixtures). `createCaseBoxRuntime` defaults `backing = "in-memory"`. The SQLite branch in `persistenceFactory.ts` throws `Error("sqlite backing not yet enabled; see WI-casebox-ipc-on-disk-backing")` to make the future swap point explicit AND to prevent accidental enabling before the on-disk WI lands.

Fixture loading: `fixtures/casebox.fixture.json` contains:
- 2 matters (different `matter_type`s; 1 active, 1 archived).
- 3 documents (different `source`s; spread across both matters).
- 5 audit events (chain-valid against `verifyAuditChainForMatter`).

Loaded by `createPersistence("in-memory")`: constructs `InMemoryCaseBoxPersistence` and seeds it by calling `createMatter`/`registerDocument` for each fixture entry. Failures during seed throw with the failing entry index — no silent skip.

## §14 — Acceptance gates (impl WI ready when)

1. **All 16 test files pass deterministically** (`npm test` exit 0 in `apps/lawbar-desktop/`).
2. **`npm run lint:renderer-imports` passes** (no forbidden imports in `renderer/**/*.ts`).
3. **`npm run dist` packages successfully** (arm64 + x64 .app produced).
4. **`npm run test:packaged` passes** (existing 3-test suite continues to pass + the new health-channel smoke can be exercised against the packaged binary).
5. **`/loc-guardian:scan` returns 0 over** for all 17 new + 3 modified source files AND all 16 test files.
6. **`/cc-suite:audit`** returns 0 Critical / 0 High / 0 Medium findings on the implementation diff (Lows acceptable per `.claude/rules/cc-suite.md` §"Audit remediation policy").
7. **Tier 1 FileVault enforcement** (commit `678bf16`) continues to BLOCK production launches on FileVault-off Macs (no behavioral regression).
8. **No new runtime dependency** (`package.json` `dependencies` unchanged; only `scripts` and `pretest` modified).
9. **No schema changes** to `case-box-contract` or `case-box-persistence`.
10. **No real case data persisted** to userData (in-memory backing only).

## §15 — Order of operations (WI execution sequence)

The impl WI executes in this strict order to keep each step independently verifiable:

1. **Scaffolding** (no IPC yet):
   1. Create `src/casebox/{ulid.ts, clock.ts, dto.ts, persistenceFactory.ts, runtime.ts}` + `src/security/{activeTenant.ts, activeActor.ts}`.
   2. Create the fixture JSON.
   3. Add `tests/casebox/{ulid.test.mjs, alphabet-parity.test.mjs, runtime-singleton.test.mjs}` and run them — verify scaffolding alone passes.
2. **Envelope + helpers**:
   1. Create `electron/ipc/{errorEnvelope.ts, limitCap.ts, timeout.ts, validateReadQuery.ts}` + handler shared `_strip.ts` + `_validate.ts`.
   2. Add `tests/casebox/{error-envelope.test.mjs, validateReadQuery.test.mjs, limit-cap.test.mjs, timeout.test.mjs, dto-types.test.mjs}` and run them.
3. **Handlers** (one domain at a time):
   1. Create `electron/ipc/handlers/persistenceHealth.ts` + `casebox.ts` registration entry + `tests/casebox/persistenceHealth-handler.test.mjs`. Wire `registerCaseBoxIpc` into `electron/main.ts` per contract §14 startup order. Run unit + smoke; verify health channel works end-to-end before adding more handlers.
   2. Create `handlers/matter.ts` + `tests/casebox/matter-handler.test.mjs`. Re-run all tests.
   3. Create `handlers/document.ts` + `tests/casebox/document-handler.test.mjs`. Re-run all tests.
   4. Create `handlers/audit.ts` + `tests/casebox/audit-handler.test.mjs`. Re-run all tests.
4. **Preload + renderer-import lint**:
   1. Create `scripts/check-renderer-imports.mjs` + hook into `pretest`. Run against current renderer (should pass — renderer is currently bundler-free with no forbidden imports).
   2. Modify `electron/preload.mts` to expose `caseBox` API. Re-run lint; renderer still passes (caseBox is in preload, NOT renderer).
   3. Add `tests/casebox/{preload-imports.test.mjs, channel-allowlist.test.mjs}`. Re-run all tests.
5. **E2E**:
   1. Add `tests/casebox/smoke.e2e.test.mjs`. Run `npm test` + `npm run dist` + `npm run test:packaged` + the new E2E.
6. **`startup-order` test**:
   1. Refactor `electron/main.ts`'s app.whenReady chain into `bootstrapMainProcess(deps)` so the test in `tests/casebox/startup-order.test.mjs` can inject timing observers. Run the test.
7. **`/loc-guardian:scan`** + **`/cc-suite:audit`** on the full diff. Apply Low fixes; re-run.
8. **`/cc-suite:verify`** against the audit report. Verify 0 unresolved C/H/M.
9. **Explicit-staging commit** per `.claude/rules/staging-hygiene.md`. The impl WI uses ONE commit unless plan-review divides it into bounded sub-WIs.

## §16 — Risks

| Severity | Risk | Mitigation |
|---|---|---|
| **High** | `bootstrapMainProcess(deps)` refactor of `electron/main.ts` may inadvertently change the FileVault enforcement timing or the `--probe-case-box` short-circuit, breaking Tier 1 (commit `678bf16`). | The refactor MUST preserve the exact existing order: probe-flag short-circuit → app.setName → ipcMain.handle for theme channels → nativeTheme.on listener → app.whenReady.then(... FileVault decision → createCaseBoxRuntime → registerCaseBoxIpc → createWindow). A regression test in `startup-order.test.mjs` asserts the FileVault decision still runs BEFORE createCaseBoxRuntime. Tier 1 unit + real-binary WARN evidence must continue to pass unchanged. |
| **Medium** | `alphabet-parity.test.mjs` regression: a future persistence-internal change to `ulid.ts` (e.g. alphabet swap) would not break persistence (it would still match its own pattern) but would make `apps/lawbar-desktop/src/casebox/ulid.ts` produce IDs persistence rejects. | The parity test reads both source files at runtime and asserts the alphabet constants match byte-for-byte. Persistence-side change WILL break this test, surfacing the drift before merge. |
| **Medium** | Fixture seeding via `createMatter`/`registerDocument` calls means schema-validation runs at startup; a future schema-required-field addition would break startup until the fixture is updated. | The fixture is at `fixtures/casebox.fixture.json` and the seed loop fails fast with the index of the failing entry. An impl-WI test (`fixture-seeds-cleanly.test.mjs`, ~30 LOC; added to Tier A) asserts the fixture loads against an empty in-memory persistence without throwing. |
| **Medium** | The `bootstrapMainProcess(deps)` refactor adds an injection surface that's normally invisible (production runs the real Electron globals). If the production wiring drifts from the test wiring, the test passes but production breaks. | The `bootstrapMainProcess` function is called from `electron/main.ts`'s top level; the test calls the SAME function with mocked `deps`. Production calls it with `{ app, BrowserWindow, ipcMain, dialog, process }` as the real globals. The `bootstrapMainProcess` function itself is the production entry point — there is no parallel production path. |
| **Medium** | `electron/ipc/timeout.ts` `withTimeout` async guard returns a timeout envelope but the underlying SQLite call keeps running on the main thread (per contract §3 T-5 rev-3). A subsequent IPC call may be blocked waiting for the previous call to release the persistence handle. | This is the documented limitation; in v1 with in-memory backing, ops are <1 ms so the issue is theoretical. The on-disk WI inherits the same limitation; the worker-thread WI (future) is the real fix. Risk recorded for future readers; no v1 mitigation needed. |
| **Low** | `electron/ipc/casebox.ts` channels const-array could drift from `tests/casebox/channel-allowlist.test.mjs` expectations if a future handler is added without updating the test. | The test loads both sources (casebox.ts AST + the expected channel list) and compares — adding a channel without updating the test is what the test catches. |
| **Low** | `apps/lawbar-desktop/fixtures/casebox.fixture.json` is a JSON file under `apps/lawbar-desktop/` — Electron-builder's `build.files` glob is `dist/**/*` + `package.json`, so the fixture is NOT included in the packaged .app by default. | Add `"fixtures/**/*"` to `build.files` in `package.json` so the packaged binary can load it. If the fixture is dev-only and the packaged binary should not seed from it, leave it out and document that the packaged binary opens with an empty persistence. (Plan-WI decision: include in packaged build because the test:packaged smoke needs the fixture too.) |

No Critical risks identified. If reviewer disagrees, the bootstrapMainProcess refactor is the most likely escalation candidate.

## §17 — Hard stops

This plan does NOT trigger any hard-stop in `.claude/rules/autonomy.md` §"Hard-stop list":
- No push, deploy, release, production, migration, auth provider, cloud vendor, public exposure.
- No new runtime dependency.
- No schema / CLI / wire-format breaking change (the IPC contract is NEW renderer-facing surface that ships in the same release; no external consumer).
- No secrets / credentials / billing.
- No real case data (in-memory only).
- No Tier 2 SQLCipher / Keychain.

The plan IS HIGH-RISK per `.claude/rules/cc-suite.md` §"High-risk WIs" because it implements a security-boundary IPC layer. The impl WI's `/cc-suite:review-plan` (against THIS plan) + `/cc-suite:audit` + `/cc-suite:verify` are all required.

## §18 — Review packet (compact)

**Active plan summary**: implementation plan for `WI-casebox-ipc-contract-impl` mapping the contract plan (`9f9f79b`) into 17 NEW source files + 3 modified source files + 16 NEW test files in `apps/lawbar-desktop/`. v1 12-op IPC scope; in-memory backing per contract §10 Option I; renderer-import lint via TS-AST; runtime singleton with before-quit dispose; envelope-only error contract; tenant/actor const stubs at swap seams; local ULID utility duplicating persistence's alphabet (avoiding contract-surface change). No new dependencies, no schema changes, no real data, no Tier 2.

**Exact target files** (impl WI; this plan is the spec): see §3 table — 17 new + 3 modified source + 16 new test files; total ~2,815 LOC across source + tests.

**Exact acceptance criteria**: see §14 — 10 gates: all 16 tests pass deterministically; renderer-import lint passes; npm run dist + test:packaged pass; loc-guardian 0 over; cc-suite audit 0 C/H/M; Tier 1 FileVault enforcement still works; no new deps; no schema changes; no real data.

**Exact out-of-scope list** (this impl WI):
- Product UI / case-box-aware screens.
- Real case data persistence (in-memory only).
- Tier 2 SQLCipher / Keychain.
- On-disk SQLite backing (separate `WI-casebox-ipc-on-disk-backing` per contract §10 migration path).
- Push channels.
- Operations outside the 12-op cut.
- Auth provider, cloud sync, signing, distribution.
- Schema changes.
- Brief amendments.

**Essential references**:
- `dev-memo/plan-case-box-ipc-contract-00.md` (`9f9f79b`) — the design authority. Specifically §6.0 (DTO schema-correct field tables), §6 (validation pipeline with [2a] reject-on-presence), §7 (envelope contract), §9 (renderer-import lint 5 categories), §10 + §10.1 (in-memory backing + CaseBoxRuntime singleton lifecycle), §14 (startup ordering).
- `services/case-box-persistence/src/{index.ts, types.ts, errors.ts, ulid.ts, cursor.ts}`.
- `docs/contracts/case-box-contract/schemas/{case-box-matter.schema.json, case-box-document.schema.json}`.
- `apps/lawbar-desktop/electron/main.ts` HEAD `9f9f79b` (Tier 1 FileVault enforcement; existing IPC pattern).
- `AGENTS.md` §"Critical invariants" — `CaseBoxPersistenceError` codes STABLE.

**Review questions** (target the highest-risk design choices):
1. Is the per-handler `create<Op>Handler(runtime)` factory pattern (§4) the right shape, or should handlers be free functions that import a module-private `getCaseBoxRuntime()`? Factory makes test injection trivial but adds a layer of indirection.
2. Is the local ULID utility (§10) the right call vs adding a 1-line re-export to `case-box-persistence/src/index.ts`? The re-export would be a contract-surface change but eliminate the alphabet-drift risk entirely.
3. Is the `bootstrapMainProcess(deps)` refactor of `electron/main.ts` (§15 step 6 + §16 H1) the right shape for the startup-order test, or should the test use a child-Electron-spawn approach asserting via stderr markers (as the rev-1 reviewer mentioned as an alternative)?
4. Are the 16 test files sized correctly for the 13 + 2 + 1 split, or should `document-handler.test.mjs` (240 LOC) be split into `document-register.test.mjs` + `document-read.test.mjs`? The 800/1200 thresholds are well below the largest planned file; splitting is preference, not requirement.
5. Should `apps/lawbar-desktop/fixtures/casebox.fixture.json` (§13) be a dev-only seed (NOT included in packaged binary), with an empty in-memory persistence in production? Including the fixture in the packaged binary means the packaged smoke test can exercise the same seeded data; excluding it means a cleaner production posture but a less expressive packaged smoke.
6. Does the §15 9-step execution order risk being too sequential — could parallel sub-WIs (e.g. matter + document + audit handlers in parallel) shorten the WI without losing safety? Trade-off: parallel is faster but each handler depends on `errorEnvelope.ts` + helpers, so step 2 must complete before step 3 in any case.

## §19 — LOC budget reconciliation

Per `.claude/rules/loc-guardian.md`:
- Hand-written source: fail at 800 LOC per file.
- Hand-written tests: fail at 1200 LOC per file.

| File | Est LOC | Threshold | Margin |
|---|---|---|---|
| `electron/ipc/handlers/matter.ts` | 200 | 800 src | 600 |
| `electron/ipc/handlers/document.ts` | 160 | 800 src | 640 |
| `electron/ipc/handlers/audit.ts` | 110 | 800 src | 690 |
| `electron/ipc/handlers/persistenceHealth.ts` | 45 | 800 src | 755 |
| `electron/ipc/casebox.ts` | 90 | 800 src | 710 |
| `electron/ipc/errorEnvelope.ts` | 60 | 800 src | 740 |
| `electron/ipc/validateReadQuery.ts` | 130 | 800 src | 670 |
| `electron/ipc/timeout.ts` | 35 | 800 src | 765 |
| `electron/ipc/limitCap.ts` | 25 | 800 src | 775 |
| `src/casebox/runtime.ts` | 100 | 800 src | 700 |
| `src/casebox/persistenceFactory.ts` | 40 | 800 src | 760 |
| `src/casebox/dto.ts` | 90 | 800 src | 710 |
| `src/casebox/ulid.ts` | 25 | 800 src | 775 |
| `src/casebox/clock.ts` | 10 | 800 src | 790 |
| `src/security/activeTenant.ts` | 10 | 800 src | 790 |
| `src/security/activeActor.ts` | 10 | 800 src | 790 |
| `scripts/check-renderer-imports.mjs` | 160 | 800 src | 640 |
| `electron/main.ts` (post-mod) | 138+40=178 | 800 src | 622 |
| `electron/preload.mts` (post-mod) | 30+50=80 | 800 src | 720 |
| Largest test: `document-handler.test.mjs` | 240 | 1200 test | 960 |

Total new+modified source: ~1,375 LOC. Total new tests: ~1,440 LOC. Combined ~2,815 LOC. No single file approaches its threshold.

## §20 — Stop condition

This plan becomes stale when:
- The impl WI it specifies lands and is verified. Then this plan is the as-built reference until a revised impl plan supersedes.
- The contract plan (`9f9f79b`) is amended in a way that changes a load-bearing decision (DTO shape, envelope shape, pipeline order, channel taxonomy, backing decision). Triggers an amendment to this plan + cc-suite re-review.
- The case-box-persistence public API changes (method added/removed/signature changed) — affects channel mapping in §5.
- The case-box-contract schema changes (required field added/removed) — affects DTO tables in §6.

## §21 — Required cc-suite review

This plan is not authorized for implementation until:
1. `/cc-suite:review-plan dev-memo/plan-casebox-ipc-impl-00.md` returns READY (or only Low-risk clarifications remain).
2. Any Critical/High findings are fixed and the plan is re-reviewed.
3. The chosen first-impl backing (§13 in-memory) is not changed without re-review.
4. The chosen ULID-duplication strategy (§10 local) is not flipped to re-export without re-review (because re-export touches the persistence package's public surface).

Review focus per `.claude/rules/cc-suite.md` §"High-risk WIs":
- Internal consistency across §3-§19.
- Consistency with contract plan (`9f9f79b`) — no contradiction with §6.0, §6 pipeline, §7, §9, §10, §10.1, §14.
- File-budget realism (do the LOC estimates hold given the per-handler complexity?).
- Test coverage adequacy for renderer trust boundary (does the test plan exercise both the strip-then-inject path AND the reject-on-presence path?).
- Hard-stop clarity (§17 must be explicit).
- Refactor safety of `bootstrapMainProcess(deps)` against Tier 1 FileVault enforcement (`678bf16`).
