# PLAN — `WI-casebox-ipc-impl-refresh` (case-box IPC impl)

**Status**: PLAN-ONLY rev-0.3 READY-with-Low (promoted from rev-0.3-DRAFT-PENDING-REVIEW after `review-plan-mpnkh6ng-4iz5bq` returned READY-with-Low with 0 Critical / 0 High / 0 Medium / 3 Low; all 3 Lows applied inline before commit `d4f3abb`. Full review chain: rev-0 → rev-0.1 driven by `review-plan-mpmtyoyh-97zt15`; rev-0.1 → rev-0.2 driven by `review-plan-mpnhj20a-6yj24u`; rev-0.2 → rev-0.3 driven by `review-plan-mpnj8tsr-nujf3z`; rev-0.3 promoted by `review-plan-mpnkh6ng-4iz5bq`. See §25 review-item disposition table for per-finding mapping).
**Date**: 2026-05-26.
**Author**: Claude Code on explicit user direction (WI-casebox-ipc-impl-refresh lane).

> **SUPERSEDED IN PART 2026-06-02 — case-box now persists to SQLite.** This plan's v1 backing
> decision — "in-memory only", "SQLite persistence deferred to a later WI" — has been overtaken
> by reality: the desktop case-box runtime now persists to SQLite under Electron
> `app.getPath("userData")` (`PRODUCT(desktop): use SQLite case-box runtime`, proven across
> restart by `PRODUCT(desktop): prove case-box persistence across restart`). Treat every
> "in-memory only" / "volatile across app launches" / "nothing is persisted" statement below
> (e.g. §8, §15.5, §16.2, and the structural dummy-data claim) as a **historical record of the
> v1 plan, not current behavior**. In particular, the structural-safety claim that "nothing is
> persisted; there is no surface where real lawyer data could accidentally land" **no longer
> holds** — case-box data is durable on disk, so real-data hygiene must not rely on volatility
> (the no-real-data diff-scan gate remains the active safeguard). The plan body below is retained
> unedited as the reviewed v1 implementation record.
**Authoritative after**: `/cc-suite:review-plan` returns READY (or only Low-risk clarifications remain).
**Parent references**:
- `dev-memo/plan-case-box-ipc-contract-00.md` (rev-3 READY at `9f9f79b`) — the **IPC contract** (channel design, DTO shape, validation pipeline, error envelope, preload surface, runtime singleton lifecycle, renderer prohibitions). UNCHANGED by this plan; this plan maps it into impl steps.
- `dev-memo/plan-casebox-ipc-impl-00.md` (untracked DRAFT-PENDING-REVIEW at HEAD `e61d7d9`) — the **stopped predecessor plan** drafted 2026-05-25 and abandoned at an H finding before the WI-2 + WI-retire + tarball PoC topology landed. SUPERSEDED by this `-01.md` (see §5).
- WI-pkg-verify-detection-impl commit `017c560` — the fail-closed crash-detection wrapper at `apps/lawbar-desktop/scripts/test-packaged-wrapper.mjs`. Packaged IPC verification routes through this wrapper.
- WI-retire-probe-case-box commit `45167b1` — the raw-spawn `--probe-case-box` path is retired; cannot be reintroduced.
- WI-tarball-poc-impl commit `e61d7d9` — case-box-contract + case-box-persistence are now installable via `apps/lawbar-desktop/dist-tarballs/*.tgz`; `case-box-persistence/dist/index.js` resolves from packaged Electron's main process; `better-sqlite3` native binding loads under Electron ABI. Confirmed by `npm run test:tarball-poc` (7/7 PASS at 30s wrapper settle; crash count 4 → 4).
- `dev-memo/plan-desktop-package-architecture-00.md` rev-3 (commit `e5cb773`) — Option 2 packaging architecture. UNCHANGED.
- `docs/product/project-requirements-brief.md` — v1 client posture: single-lawyer / local-first / no auth provider / no real-data v1.

This plan does NOT implement anything. It produces the implementation blueprint for the eventual `WI-casebox-ipc-impl` impl WI.

## §1 — Scope + non-goals

### In scope (plan-only)
- A fresh implementation plan that takes the IPC contract (`9f9f79b`) into impl steps, factoring in the now-canonical topology (WI-2 wrapper + tarball PoC mechanism).
- Decide the disposition of the stopped `-00.md` draft (§5 — supersede + SUPERSEDED banner + commit).
- v1 IPC method scope cut — narrower than the contract's 32-method total surface (§6).
- Exact file enumeration for the impl WI (§7).
- Channel registration mapping + DTO design (§8) — extends the rev-2 contract.
- `CaseBoxRuntime` singleton lifecycle (§9) — LAZY initialization (first-IPC-call), not eager-at-app-whenReady.
- Validation pipeline + error envelope mapping (§10).
- Tenant/actor stubs per contract §6.3/§6.4 (§11).
- Preload exposure surface — narrow `window.lawbar.caseBox.*` namespace (§12).
- Renderer prohibition rules per contract §9 (§13).
- Test strategy — main-process unit + preload contract + packaged renderer→main round-trip through the WI-2 wrapper (§14).
- Packaged verification design — adapts the tarball PoC's `launchPackaged` + bounded readiness wait pattern (§15).
- Dummy-data-only acceptance (§16) — NO real legal data; synthetic IDs only.
- STOP-AND-ASK items the impl WI's authorization MUST address (§17).
- Acceptance gates G-IPC-1 through G-IPC-N (§18).

### Out of scope (deferred or forbidden by user authorization)
- Any code implementation. `services/case-box-persistence/src/`, `docs/contracts/case-box-contract/src/`, and the rest of the case-box-* monorepo stay UNCHANGED.
- Any new runtime dependency.
- Any package.json mutation in THIS plan (the impl WI MAY add an internal-package dep version bump if needed; that decision is its own authorization).
- Any `Info.plist` / `LSUIElement` / `LSBackgroundOnly` / crash-dialog suppression.
- Product UI / case-box-aware screens in the renderer. The renderer's existing 12-panel theme-token fixture STAYS as the production renderer; renderer-side IPC tests drive `window.lawbar.caseBox.*` via Playwright's `page.evaluate` without rendering any product UI.
- Real-data persistence — v1 backing is **in-memory only** (rev-0.1 H3). NO `case-box.db` file is ever created by this WI. All tests use synthetic Crockford-base32 26-char lowercase IDs matching `^[0-9a-z]{26}$`. Dummy-data discipline includes a diff-scan gate (rev-0.1 bonus per §16.9) that flags real-looking legal names + ensures all DB-related code paths run under temp roots.
- Tier 2 SQLCipher / Keychain (deferred).
- Auth provider, cloud sync, signing, notarization, distribution, telemetry.
- Cross-platform parity (the .app is darwin-only per `.claude/rules/client-local-first.md`).
- The full 32-method case-box-persistence surface — v1 scope cut is **5** channels (rev-0.2 F4; §4 + §6).

## §2 — Existing context used

- `dev-memo/plan-case-box-ipc-contract-00.md` rev-3 (commit `9f9f79b`) — the **design authority**. Its §6 validation pipeline, §7 error envelope, §8 preload surface, §10 first-impl backing decision are inherited.
- `dev-memo/plan-casebox-ipc-impl-00.md` (untracked at HEAD `e61d7d9`) — the predecessor implementer's checklist. Its §3 file enumeration, §4 canonical handler shape, §5 channel mapping, §10 ULID utility design, §11 lint script outline are REUSED as structural starting points; this `-01.md` updates them for the new topology (WI-2 wrapper; tarball PoC mechanism; case-box-persistence installable as tarball).
- WI-2 wrapper contract: `apps/lawbar-desktop/scripts/test-packaged-wrapper.mjs` + `apps/lawbar-desktop/tests/_launch-with-pid-log.mjs` + the Guard #3 sentinel-pair pattern.
- WI-tarball-poc-impl commit `e61d7d9`: `case-box-persistence` is installed as a runtime dep; `openSqliteCaseBoxPersistence` works in packaged main process; `app.getPath("userData")` resolves to `~/Library/Application Support/lawbar/`.
- `apps/lawbar-desktop/electron/main.ts` (post-`e61d7d9`): contains `ipcMain.handle("theme:get")` + `ipcMain.handle("theme:set")`; the env-gated `globalThis.__lawbarTarballPocProbe` hook at end of `app.whenReady`; FileVault enforcement; window creation; native-theme propagation.
- `apps/lawbar-desktop/electron/preload.mts` (post-`e61d7d9`): exposes `window.lawbar.theme.{get,set,onSystemChange}` via contextBridge. To extend: add `window.lawbar.caseBox.*` alongside.
- `apps/lawbar-desktop/dist-tarballs/manifest.json` — recorded sha512 integrity hashes for the tarballs (G-IPC-N may cross-check this against `package-lock.json` to detect supply-chain drift).
- `docs/contracts/case-box-contract/dist/index.js` exposes `validateMatter` + `validateDocument` + `validateAuditEvent` + ~7 more validators (per contract §6.1).
- `services/case-box-persistence/dist/index.js` exposes `openSqliteCaseBoxPersistence({path, now?, generateId?, busyTimeoutMs?})` + `SqliteCaseBoxPersistence` class with 32 methods (per d.ts inspection).
- `docs/product/project-requirements-brief.md` §13: single-lawyer v1; no real auth; `tenant_id` retained in schemas for forward compat but v1 uses constants.
- `.claude/rules/cc-suite.md` §"High-risk WIs" — IPC implementation IS high-risk; cc-suite review-plan + audit + verify chain REQUIRED.
- `.claude/rules/security-boundary.md` §"In-scope work" — IPC handlers ARE security-boundary code; the cc-suite audit MUST inspect for SSRF / sandbox-bypass / unintended renderer authority escalation.
- `.claude/rules/autonomy.md` §"Hard-stop list" — IPC implementation does NOT trigger any global hard-stop (no push, no auth provider, no real data). But IT DOES introduce a security-boundary surface, so the security WI loop applies.
- `.claude/rules/client-local-first.md` — confirmed v1 single-lawyer; IPC stays main-process-local.

## §3 — What changed since `-00.md` (the topology shift)

The stopped `-00.md` draft was authored before the following landed:

| Aspect | `-00.md` assumption | Refreshed `-01.md` reality |
|---|---|---|
| Packaged verification | Raw `child_process.spawn` of the packaged binary with a verification flag (effectively a Class A SIGABRT risk per parent rev-3.1 §22) | WI-2 fail-closed wrapper at `scripts/test-packaged-wrapper.mjs` (commit `017c560`) — crash-detection-wrapped Playwright launch |
| Probe handler in main.ts | `--probe-case-box` IIFE-process.exit pattern available as a sibling smoke for the IPC layer | RETIRED at `45167b1`; cannot be reintroduced. IPC tests MUST use the wrapper-driven `app.evaluate` / `page.evaluate` pattern only |
| Backing impl loadability | `c708ece` WI-B Option A smoke proved better-sqlite3 binding loads under Electron | WI-tarball-poc-impl commit `e61d7d9` proves the FULL case-box-persistence + case-box-contract chain loads + executes in packaged main process; `npm run test:tarball-poc` 7/7 PASS |
| Case-box-* installation method | Source-relative `file:` deps OR uncommitted local installs | Tarball-install via `dist-tarballs/*.tgz` (committed lockfile sha512 integrity; staged-rewrite of `case-box-persistence`'s deps; source manifests unchanged) |
| ESM `app.evaluate` limitation | Not yet observed | Empirically falsified per parent rev-3.1 §26 step 3 (dynamic-`import()` inside `app.evaluate`'s vm fails with "A dynamic import callback was not specified"). IPC tests MUST NOT rely on `app.evaluate` to dynamic-import case-box-* — they go through the renderer→main IPC channel like real users would |
| `globalThis` test hook pattern | Not yet established | Established by tarball PoC: env-gated `LAWBAR_TARBALL_POC_TEST_HOOK`. The IPC impl WI MAY introduce its own env-gated hook for renderer-bypass tests (e.g. `LAWBAR_CASEBOX_IPC_TEST_HOOK`) but NOT required (renderer→main path is the load-bearing test) |
| Production-binary impact | `-00.md` proposed instantiating CaseBoxRuntime eagerly at `app.whenReady` against on-disk SQLite | `-01.md` (rev-0.1 H3) keeps LAZY initialization AND switches the v1 backing to **in-memory only** per contract `9f9f79b` §10. The runtime is materialized only when an IPC call lands; production launches without case-box IPC use materialize NOTHING; volatile across app launches. SQLite persistence is deferred to a later, separately-authorized WI |
| Schema migration concerns | Not addressed | `-01.md` rev-0.2 F3: NOT APPLICABLE in v1. Backing is `InMemoryCaseBoxPersistence`; there is no schema, no DB file, no migration. SQLite + applySchema + forward-only migration semantics are DEFERRED to a later, separately-authorized WI per §15.5. The rev-0.1 mention of `openSqliteCaseBoxPersistence`'s schema behavior is removed here. |

## §4 — v1 IPC method scope cut (§6 of contract narrowed; rev-0.1 H1 + M3 fix)

The IPC contract `9f9f79b` defines DTOs + validators for 9 entities (matter / document / audit / classification / privilege / fact / docket entry / deadline / evidence). The case-box-persistence class has 32 methods. **v1 IPC scope is 5 channels** — the minimum set that proves the IPC topology end-to-end AND closes the audit-chain integrity gap per reviewer M3. Channel names follow the **contract pattern `casebox:<scope>:<op>`** (rev-0.1 H1 fix; greppable; part of the security allowlist + audit surface):

| Channel | Op | Why in v1 |
|---|---|---|
| `casebox:matter:create` | WRITE | Exercises DTO validation (`validateMatter`) + server-authority injection (id / tenant_id / actor_user_id / created_at / opt-in booleans) + in-memory backing write + contract-shape error envelope |
| `casebox:matter:get` | READ (single) | Exercises read path + null-handling envelope |
| `casebox:matter:list` | READ (paged) | Exercises pagination query type validation (cursor opacity + limit cap 200) + multi-row envelope |
| `casebox:matter:archive` | WRITE (state transition) | Exercises ID-only-input handler + state-machine validation + reversible-archive semantics per case-box-step-0-boundary ADR; emits audit state |
| `casebox:audit:chainHead` (rev-0.1 M3 add) | READ (single) | Read-only; reads the audit-chain head for a given matterId. Proves audit-chain integrity is observable via IPC; closes the M3 boundary-proof gap so product UI consumers can verify archive emitted the expected audit state. |

**Out of v1 (deferred to future WIs)**: documents, audit events (list), classifications, privilege markers, facts, docket entries, deadlines, evidence, OCR links. The impl WI's plan-review packet MUST justify each deferral; this plan defers to v1's narrowest viable surface.

## §5 — Disposition of the stopped `-00.md` draft

**Decision**: SUPERSEDE with `-01.md` + commit `-00.md` for the first time WITH a SUPERSEDED banner at the top. Same pattern as the tarball-poc plan refresh (`-00.md` SUPERSEDED + new `-01.md` at commit `1d04256`).

Rationale:
- The stopped `-00.md` (703 LOC) contains structurally-valuable scaffolding (file enumeration, channel-mapping table, validator-pipeline outline, ULID utility design, test plan, LOC budget) that `-01.md` REUSES.
- Discarding `-00.md` entirely would lose the diff-from-contract-9f9f79b traceability.
- Leaving `-00.md` untracked indefinitely accumulates working-tree clutter.
- The SUPERSEDED banner cites the topology shift (§3) + the impl WI's authorization (this plan).

The banner content:

```markdown
**SUPERSEDED** by `dev-memo/plan-casebox-ipc-impl-01.md` (rev-0.2) after the topology shift introduced by WI-pkg-verify-detection-impl (017c560) + WI-retire-probe-case-box (45167b1) + WI-tarball-poc-impl (e61d7d9). The successor plan retains this file's structural framing (file enumeration, channel mapping, validator pipeline, ULID utility, test plan, LOC budget) but updates: (a) packaged verification routes through the WI-2 crash-detection wrapper instead of raw `child_process.spawn`; (b) CaseBoxRuntime initialization is LAZY (first-IPC-call) instead of eager-at-app-whenReady AND the v1 backing is `InMemoryCaseBoxPersistence` (no SQLite, no DB file, no migrations — SQLite deferred); (c) v1 IPC method scope cut to **5 methods** (`casebox:matter:create` / `:get` / `:list` / `:archive` + `casebox:audit:chainHead`); (d) case-box-persistence + case-box-contract are now installable via the tarball PoC mechanism (commit e61d7d9). This file is kept as historical record; do NOT implement against this plan.
```

Both `-00.md` (banner-added) and `-01.md` (new) commit together in the eventual plan-promotion commit.

## §6 — Implementation file enumeration

### §6.1 NEW files (impl WI)

- `apps/lawbar-desktop/electron/ipc/caseBoxHandlers.ts` (~170 LOC) — the **5** `ipcMain.handle(...)` registrations for v1 channels (rev-0.2 F4 — was "4" in rev-0.1 stale text; canonical 5 are `casebox:matter:create` / `:get` / `:list` / `:archive` + `casebox:audit:chainHead`). Each handler: (a) accepts the renderer's DTO; (b) runs the §9.1 6-step pipeline (shape guard → forbidden-field scan → list-query bounds [list op only] → schema validation [write ops] → persistence call → result wrapping); (c) injects tenant_id + actor_user_id from the §10 stubs (actor injected on archive for the audit event per §7.3); (d) delegates to the CaseBoxRuntime singleton (in-memory backing per §8); (e) maps the result + any thrown errors into the §9.2 envelope.
- `apps/lawbar-desktop/src/caseBox/caseBoxRuntime.ts` (~120 LOC) — the lazy singleton per §9: factory that returns the same `{persistence, db}` instance after first init; tracks lifecycle for clean shutdown on `app.before-quit`.
- `apps/lawbar-desktop/src/caseBox/dto.ts` (~100 LOC; type-only) — DTO type definitions for **`CreateMatterDto`, `GetMatterDto`, `ListMattersDto`, `ArchiveMatterDto`, `ChainHeadDto`** (rev-0.2 F4 — 5 DTOs to match the 5 v1 methods; was "4" in rev-0.1 stale text), plus the `IpcEnvelope<T>` discriminated union shape + `IpcErrorEnvelope` whose `code` is strictly `CaseBoxPersistenceErrorCode` (rev-0.2 F2). Imported by both preload AND main process. Lives in `src/` (compiled into `dist/`); preload imports via `import type` only.
- `apps/lawbar-desktop/src/caseBox/errorMap.ts` (~60 LOC) — maps `CaseBoxPersistenceError` instances + Ajv validation errors + unknown errors to the `IpcEnvelope<never>` failure shape with stable codes (per contract §7).
- `apps/lawbar-desktop/src/security/activeActor.ts` (~10 LOC) — per contract §6.4, exposes `getActiveActorUserId()` returning `"local-user"`. Test-injectable via a setter for unit tests.
- `apps/lawbar-desktop/src/security/activeTenant.ts` (~10 LOC) — parallel to activeActor; returns `"default-tenant"`. Test-injectable.
- `apps/lawbar-desktop/tests/ipc-handlers.unit.test.mjs` (~250 LOC; pure-Node) — unit tests for `caseBoxHandlers.ts` with mocked CaseBoxRuntime. Covers each of the **5** channels (rev-0.2 F4): happy path, shape-guard failure → `invalid_payload`, forbidden-field present → `invalid_payload`, list-query bounds (list channel only), schema-validation failure → `invalid_payload`, persistence-thrown `CaseBoxPersistenceError` → code preserved verbatim, unknown thrown → `not_implemented` opaque (rev-0.2 F2 — codes match contract §7 stable enum).
- `apps/lawbar-desktop/tests/dto-contract.test.mjs` (~80 LOC; pure-Node) — asserts that the DTO type module's runtime shape (when re-exported as `as const` arrays of field names) matches the case-box-contract schema's `properties` for `Matter`. Catches drift if the schema adds a server-authority field that the DTO accidentally forwards.
- `apps/lawbar-desktop/tests/casebox-ipc.electron.test.mjs` (~280 LOC) — packaged renderer→main round-trip test under the WI-2 wrapper. Adapts the tarball PoC test pattern: launchPackaged + firstWindow + bounded wait for `window.lawbar.caseBox.createMatter` to be defined + invoke each of the **5** v1 methods (rev-0.2 F4 — including `chainHead`) via `page.evaluate` → assert envelope shape. Runs under isolated temp `HOME` (rev-0.1 M2).

### §6.2 MODIFIED files (impl WI)

- `apps/lawbar-desktop/electron/main.ts` — register the **5** ipcMain handlers (rev-0.2 F4) from `ipc/caseBoxHandlers.ts` at the end of `app.whenReady().then(...)` (after FileVault enforcement). Add an `app.before-quit` listener that closes the CaseBoxRuntime singleton if it was initialized. LOC delta: ~22 lines.
- `apps/lawbar-desktop/electron/preload.mts` — expose `caseBoxApi` alongside `themeApi` via the existing `contextBridge.exposeInMainWorld("lawbar", {...})` call. LOC delta: ~60 lines (5 methods + their invoke-wrappers; the envelope round-trips as a plain object — no preload-side rehydration per contract §7).
- `apps/lawbar-desktop/package.json` — add `test:ipc-unit` + `test:ipc-contract` + `test:ipc-packaged` + `lint:renderer-imports` npm scripts. `pretest` chain becomes `npm run build && npm run lint:renderer-imports && npm run check:no-real-data`. NO new runtime deps; `case-box-contract` + `case-box-persistence` already installed via tarball PoC.

### §6.3 NOT touched (re-affirmed)

- `services/case-box-persistence/src/` — UNCHANGED.
- `docs/contracts/case-box-contract/src/` + schemas + fixtures — UNCHANGED.
- `apps/lawbar-desktop/renderer/` — UNCHANGED. The 12-panel token fixture stays as production renderer.
- `apps/lawbar-desktop/scripts/pack-internal-packages.mjs` — UNCHANGED (tarball PoC mechanism continues to work for case-box-* tarball regeneration).
- `apps/lawbar-desktop/scripts/test-packaged-wrapper.mjs` — UNCHANGED (WI-2 wrapper is the canonical crash detector).
- `apps/lawbar-desktop/tests/_launch-with-pid-log.mjs` — UNCHANGED (helper).
- `apps/lawbar-desktop/src/tarball-poc/probe.ts` — UNCHANGED. The tarball PoC remains as a separate verification mechanism for the packaging architecture; the IPC impl is a separate runtime surface that exercises the same case-box-* deps but through the production-realistic renderer→main path.
- `apps/lawbar-desktop/electron/main.ts` env-gated tarball PoC hook — UNCHANGED. The IPC impl does NOT remove or modify the hook.

## §7 — Channel registration + DTO design (rev-0.1 H1 + H2 + H4 — rewritten against contract `9f9f79b` design authority)

### §7.1 Channels (all `casebox:<scope>:<op>` namespace; matches contract §4/§5)

```
casebox:matter:create(dto: CreateMatterDto)    → IpcEnvelope<CaseBoxMatter>
casebox:matter:get(dto: GetMatterDto)          → IpcEnvelope<CaseBoxMatter | null>
casebox:matter:list(dto: ListMattersDto)       → IpcEnvelope<ListMattersPage>
casebox:matter:archive(dto: ArchiveMatterDto)  → IpcEnvelope<CaseBoxMatter>
casebox:audit:chainHead(dto: ChainHeadDto)     → IpcEnvelope<AuditChainHead | null>
```

Channel names are part of the security allowlist + audit surface; the contract's `casebox:<scope>:<op>` pattern is greppable across main + preload + renderer for security review.

### §7.2 DTO type definitions (in `src/caseBox/dto.ts`; rev-0.2 F1 — rewritten directly from contract §6.0; rev-0.1 H2 history retained)

Per contract `9f9f79b` §6.0, the DTO is a subset of the full entity that EXCLUDES every server-authority field. Renderer supplies ONLY lawyer/user-input fields + allowed optional text per the case-box-matter schema. Main injects all server-authority fields including the three external-exposure opt-in booleans (which default to `false`; a separate per-flag opt-in op is required to flip them; out of v1 scope).

```ts
export interface CreateMatterDto {
  // Lawyer-supplied REQUIRED fields per contract §6.0 Matter table:
  readonly name: string;
  readonly matter_type:
    | "litigation" | "arbitration" | "advisory"
    | "due_diligence" | "criminal_defense" | "other";
  readonly jurisdiction: { readonly value: string; readonly locked: boolean };
  // parties: array of {role, display_name, party_kind, notes?} per schema +
  // contract §6.0 (rev-0.2 F1 — `notes?` was missing in rev-0.1).
  readonly parties: ReadonlyArray<{
    readonly role: string;
    readonly display_name: string;
    readonly party_kind: string;
    readonly notes?: string;
  }>;
  // Confidentiality enum per case-box-matter schema.
  readonly confidentiality_class: "normal" | "heightened" | "sealed";
  // Lawyer-supplied OPTIONAL free-text fields per contract §6.0 Matter table
  // (rev-0.2 F1 — rev-0.1 used non-schema `progress_text` + omitted
  // `retainer_scope` + `contention_summary_text`):
  readonly retainer_scope?: string;
  readonly case_type_text?: string;
  readonly case_progress_text?: string;
  readonly court_contact_text?: string;
  readonly contention_summary_text?: string;
  //
  // EXCLUDED from DTO — main injects (and §9.1 step 2 REJECTS if present):
  //   id, tenant_id, actor_user_id, status (defaults to "active"),
  //   created_at, archived_at, successor_matter_id,
  //   external_ocr_authorized (main injects false),
  //   sync_grant_present (main injects false),
  //   llm_extraction_opt_in (main injects false).
}

export interface GetMatterDto {
  readonly matterId: string;
}

export interface ListMattersDto {
  // Server-side injects tenant_id (renderer never sends a tenant scope).
  readonly status?: "active" | "archived";
  readonly limit?: number;       // 1..200; values > 200 capped to 200; values < 1 rejected; absent OK (persistence default applies).
  readonly cursor?: string;      // Opaque server-issued. Max length 512 chars. Validated as a string only; NOT logged in any context (errors hide the value).
}

export interface ArchiveMatterDto {
  readonly matterId: string;
  // `reason` is REQUIRED per contract §6.0 ArchiveMatter table + persistence
  // ArchiveMatterOpts (rev-0.2 F1 correction; was optional in rev-0.1).
  // Whitespace-only is rejected per contract §6.0 ArchiveMatter note.
  // Main injects `actor_user_id` for the audit event emitted by persistence
  // (renderer NEVER supplies actor on archive).
  readonly reason: string;
}

export interface ChainHeadDto {
  readonly matterId: string;
}

// Wire envelope per contract §7 (rev-0.2 F2 — `code` is STRICTLY typed
// `CaseBoxPersistenceErrorCode`; rev-0.1 H4 history retained).
//
// `CaseBoxPersistenceErrorCode` is re-exported verbatim from
// case-box-persistence; the 11 stable codes are listed in
// `services/case-box-persistence/src/index.ts` and pinned by AGENTS.md.
// Contract §7 lists them: `duplicate_id`, `unknown_matter`, `unknown_document`,
// `tenant_mismatch`, `matter_id_mismatch`, `illegal_transition`,
// `local_only_external_flag_rejected`, `invalid_payload`,
// `invalid_initial_state`, `invalid_argument`, `not_implemented`. The IPC
// layer ADDS NO new discriminator values.
import type { CaseBoxPersistenceErrorCode } from "case-box-persistence";

export type IpcEnvelope<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: IpcErrorEnvelope };

export interface IpcErrorEnvelope {
  readonly kind: "case_box_persistence_error";
  // STRICTLY one of CaseBoxPersistenceErrorCode (rev-0.2 F2). All IPC
  // validation failures map to `invalid_payload`; unexpected throws map to
  // `not_implemented`. NO invented codes (rev-0.1 strings
  // "invalid_shape" / "forbidden_input_field" / "schema_violation" are
  // REMOVED in rev-0.2).
  readonly code: CaseBoxPersistenceErrorCode;
  // Safe normalized message. NEVER includes offending values from the DTO;
  // NEVER includes raw Error.message text from unexpected throws (those
  // get replaced with "internal error (see main log)" per §9.2).
  readonly message: string;
  // Optional structured details. NEVER includes the validation input value
  // itself; only schema path + violated keyword per contract §6.
  readonly details?: { readonly schemaPath?: string; readonly keyword?: string };
}
```

### §7.3 Server-authority field injection (rev-0.1 H2 expansion)

For `casebox:matter:create`: the handler builds the full `CaseBoxMatter` from the DTO + injects ALL server-authority fields:

- `id` — generated by `apps/lawbar-desktop/src/caseBox/ulid.ts` (~30 LOC; Crockford base32 26-char shape; lowercase only per schema regex `^[0-9a-z]{26}$`).
- `tenant_id` — from `getActiveTenantId()` per §10.
- `actor_user_id` — from `getActiveActorUserId()` per §10.
- `created_at` — `new Date().toISOString()`.
- `status` — `"active"` (the v1 default per case-box-matter schema; never sent by DTO).
- `external_ocr_authorized` — **`false`** (rev-0.1 H2: main injects; renderer is FORBIDDEN from sending).
- `sync_grant_present` — **`false`** (rev-0.1 H2: main injects; renderer is FORBIDDEN from sending).
- `llm_extraction_opt_in` — **`false`** (rev-0.1 H2: main injects; renderer is FORBIDDEN from sending).
- `archived_at` — absent (the matter is `status: "active"` at create; archive op sets this).
- `successor_matter_id` — absent (set by a separate counsel-to-litigation evolution op; out of v1 scope).

Then runs `validateMatter(fullMatter)` BEFORE calling the persistence backing's `createMatter(fullMatter)`. If validation fails, returns an `IpcErrorEnvelope` with `code: "invalid_payload"` (rev-0.2 F2 — was rev-0.1's invented `"schema_violation"`; contract §7 has no such code). Details include `schemaPath` + `keyword` only (NOT the offending value).

For `casebox:matter:archive`: the handler accepts `{matterId, reason}` (reason REQUIRED per rev-0.2 F1). The persistence call is `persistence.archiveMatter(matterId, {reason, actor_user_id})` where `actor_user_id` is injected via `getActiveActorUserId()`; the renderer never supplies actor. Persistence emits the audit event recording the archive with that actor.

## §8 — CaseBoxRuntime singleton (LAZY init; **IN-MEMORY backing per contract §10**; rev-0.1 H3 fix)

The contract `9f9f79b` §10 explicitly chose **in-memory fixtures** as the first-impl backing AND deferred any SQLite/userData/migration decision to a later WI. The rev-0 plan unilaterally switched to on-disk SQLite at `userData/case-box.db` — a design-authority contradiction. rev-0.1 reverts to the contract-authorized in-memory backing per reviewer's H3 (Option 1 path chosen by user).

### §8.1 Backing choice (rev-0.1 H3)

v1 IPC backing = `InMemoryCaseBoxPersistence` from `case-box-persistence`. The instance is created lazily on the first IPC call and held for the lifetime of the main process. Data is volatile: every app launch starts with an empty in-memory store. This is the contract's intentional v1 trade-off.

**EXPLICITLY OUT OF v1 SCOPE** (deferred to a later, separately-authorized WI):
- On-disk SQLite persistence (`openSqliteCaseBoxPersistence`).
- `userData/case-box.db` path resolution.
- `applySchema` migration semantics.
- Schema-version forward-compat / downgrade design.
- DB encryption posture (Tier 2 SQLCipher).
- DB-path env override (`LAWBAR_CASEBOX_DB_PATH` is NOT introduced by this WI; the env name was a rev-0 invention that no longer applies).
- Test-side DB isolation (no DB file exists to isolate).

A later WI introducing SQLite persistence must carry: (a) migration design (forward + downgrade); (b) explicit path policy; (c) encryption-at-rest decision relative to Tier 2; (d) STOP-AND-ASK for the production-binary surface change; (e) its own cc-suite review-plan + audit + verify chain.

### §8.2 Lifecycle

```ts
// apps/lawbar-desktop/src/caseBox/caseBoxRuntime.ts
import { InMemoryCaseBoxPersistence, type CaseBoxPersistence } from "case-box-persistence";

let runtime: { persistence: CaseBoxPersistence } | null = null;

export function getCaseBoxRuntime(): { persistence: CaseBoxPersistence } {
  // LAZY init. Single-threaded Electron main: no `await` between the
  // null check and the assignment, so no TOCTOU window (per reviewer
  // confirmation under H3 / focus-answer C).
  if (runtime === null) {
    runtime = { persistence: new InMemoryCaseBoxPersistence() };
  }
  return runtime;
}

export function closeCaseBoxRuntime(): void {
  // In-memory backing has no OS handles to release. Drop the reference so
  // a subsequent test launch starts with a fresh store. No file cleanup;
  // no DB to flush.
  runtime = null;
}
```

### §8.3 Lifecycle hooks in `main.ts`

```ts
// At end of app.whenReady().then(...): register IPC handlers (do NOT
// call getCaseBoxRuntime — let the first IPC call materialize it).
registerCaseBoxIpcHandlers();

app.on("before-quit", () => {
  closeCaseBoxRuntime();
});
```

The runtime is initialized **only when an IPC handler first calls `getCaseBoxRuntime()`**. Production launches that never invoke a case-box IPC channel do NOT allocate the in-memory store. Per §16.2 the renderer's 12-panel token-fixture page does NOT call `window.lawbar.caseBox.*`, so in normal v1 production launches no case-box state is materialized.

### §8.4 Concurrent-access semantics

Electron's main process is single-threaded — the JS event loop serializes IPC handler entries. The lazy-init pattern is idempotent: the `if (runtime === null)` check and the `new InMemoryCaseBoxPersistence()` assignment happen in the same synchronous tick. There is no `await` between them. Two IPC calls cannot interleave inside `getCaseBoxRuntime`. No mutex needed.

### §8.5 No DB file ever created

A direct consequence of in-memory backing: **NO `case-box.db`, `*.sqlite`, `*.sqlite3`, `*.db-wal`, `*.db-shm`, or other persistence-file artifact is ever created by this WI**. The acceptance gate G-IPC-16 (§17) verifies this end-to-end by scanning BOTH an isolated temp `userData` root AND the repo working tree before AND after a packaged launch with the full 6-glob set (`*.db`, `*.sqlite`, `*.sqlite3`, `*.db-wal`, `*.db-shm`, `case-box.db*`), asserting no new entry appears between snapshots in either location.

## §9 — Validation pipeline + error envelope (rev-0.1 H4 + M4 — rewritten against contract `9f9f79b` §6, §7, §12)

### §9.1 Validation order (rev-0.2 F2 — codes corrected to contract §7 stable enum; rev-0.1 M4 pipeline shape retained)

Every handler entry runs these steps in order, before any persistence call. **All validation failures map to `code: "invalid_payload"`** (rev-0.2 F2 — the rev-0.1 invented codes `"invalid_shape"` / `"forbidden_input_field"` / `"schema_violation"` are REMOVED; contract §7 defines only the 11 stable persistence codes plus `"not_implemented"` for opaque unexpected). The `message` field disambiguates per step for log/debug readability; the structured `code` discriminator stays stable.

1. **Shape guard (JSON-shaped object check)**: assert the IPC payload is a plain JSON-shaped object. REJECT if any of: not an object, an array (where the DTO expects a struct), `null`, has a non-default prototype (e.g. `Object.getPrototypeOf(x) !== Object.prototype`), contains any symbol keys, contains any function values, contains any non-JSON values (Date / undefined / BigInt / Map / Set). On rejection: return `IpcErrorEnvelope` `code: "invalid_payload"`, message `"DTO must be a plain JSON-shaped object"`. NO details field (the payload is the offending input; never logged).
2. **DTO server-authority rejection** (per contract §6.0): the handler scans the DTO for forbidden field names. The forbidden list for `casebox:matter:create` per rev-0.1 H2:
   - `id`, `tenant_id`, `actor_user_id`, `created_at`, `status`, `archived_at`, `successor_matter_id`, `custody_chain`.
   - `external_ocr_authorized`, `sync_grant_present`, `llm_extraction_opt_in` (rev-0.1 H2 additions: external-exposure opt-in booleans; main injects `false`; renderer is FORBIDDEN).
   For list / read ops: the forbidden list is `tenant_id` (the renderer NEVER scopes its own tenant). For `casebox:matter:list`, `tenant_id` is server-injected via §10.
   On any forbidden field present: return `IpcErrorEnvelope` `code: "invalid_payload"`, message `"DTO contains a server-authority field"` + `details.schemaPath` = the field name (NO value).
3. **List-query bounds check** (rev-0.1 M4): for `casebox:matter:list`, validate the `limit` + `cursor` shape:
   - `limit`: if present, must be a positive integer; values > 200 are CAPPED to 200 (NOT rejected — preserves caller intent); values < 1 rejected with `code: "invalid_payload"`; absent OK (persistence default applies).
   - `cursor`: if present, must be a string with `length <= 512`. Treated as OPAQUE — the cursor value is NEVER logged in any code path, NEVER included in any error envelope, NEVER inspected for semantics by the IPC layer.
4. **Schema validation (write ops only)**: construct the full entity by injecting server-authority fields per §7.3; then call `validateMatter(fullMatter)` (or the entity-appropriate validator). If `!validation.ok`, return `IpcErrorEnvelope` `code: "invalid_payload"`, message `"persistence schema violation"` + `details.schemaPath` + `details.keyword` from the FIRST Ajv error (NO offending value; NO array of all errors).
5. **Persistence call**: invoke `getCaseBoxRuntime().persistence.<method>(...)`. Try-catch.
6. **Result wrapping**: success → `{ok: true, value: result}`; thrown `CaseBoxPersistenceError` → mapped per §9.2 (its own `code` preserved verbatim from the 11-code enum); thrown unknown → §9.3 opaque mapping (`"not_implemented"`).

### §9.2 Error code map (rev-0.2 F2 — every wire `code` is one of the 11 contract codes plus `not_implemented`; no invented values)

`code` is STRICTLY `CaseBoxPersistenceErrorCode`. IPC-layer validation failures fold into the existing stable code `invalid_payload` (rev-0.2 F2); unexpected throws fold into `not_implemented`. NO new discriminator values; the 11 codes + `not_implemented` are the closed set.

| Source | Mapped `code` | Mapped `message` | Mapped `details` |
|---|---|---|---|
| Step 1 shape-guard failure | `"invalid_payload"` | `"DTO must be a plain JSON-shaped object"` | (none) |
| Step 2 forbidden-field present | `"invalid_payload"` | `"DTO contains a server-authority field"` | `{schemaPath: "<fieldName>"}` |
| Step 3 limit < 1 or non-integer | `"invalid_payload"` | `"limit must be a positive integer"` | (none) |
| Step 3 cursor not a string or > 512 chars | `"invalid_payload"` | `"cursor must be an opaque string ≤512 chars"` | (none) |
| Step 4 validateMatter / other validator returns !ok | `"invalid_payload"` | `"persistence schema violation"` | `{schemaPath, keyword}` (no value) |
| Thrown CaseBoxPersistenceError | (preserve `error.code` verbatim — one of the 11 stable codes) | persistence's own normalized message (validated as safe) | (none unless persistence supplies safe details) |
| Other thrown (unexpected) | **`"not_implemented"`** | **`"internal error (see main log)"`** | (none) |

### §9.3 Unexpected-error opacity contract (rev-0.1 H4)

For any thrown that is NOT a `CaseBoxPersistenceError`:

1. The handler logs the FULL error (stack + message) main-side via `console.error` with a structured prefix `[casebox-ipc-handler:<channel>]`. The main-process log is the audit trail for unexpected errors.
2. The IPC envelope returned to the renderer carries `code: "not_implemented"` + message `"internal error (see main log)"`. NO `Error.message` text. NO `details` field. The renderer learns ONLY that something failed — never the underlying message text, which might contain SQL parameter values or other internal state.

This prevents error-message data leaks per contract §7. The renderer's UI design must treat `"not_implemented"` as an opaque "something went wrong; please file an issue" condition. The main-process log contains the diagnostic detail.

## §10 — Tenant/actor stubs (per contract §6.3 + §6.4)

`apps/lawbar-desktop/src/security/activeTenant.ts` (NEW; ~10 LOC):

```ts
let activeTenantId = "default-tenant";
export function getActiveTenantId(): string { return activeTenantId; }
export function _setActiveTenantIdForTesting(value: string): void { activeTenantId = value; }
```

`apps/lawbar-desktop/src/security/activeActor.ts` (NEW; ~10 LOC) — parallel; returns `"local-user"`.

The handler MUST call these per-invocation (not cache); test-injectable via the `_setXForTesting` setters.

## §11 — Preload exposure surface (`window.lawbar.caseBox.*`; rev-0.1 H1 + M3 — channel renames + chainHead added)

Extend `apps/lawbar-desktop/electron/preload.mts`:

```ts
import { contextBridge, ipcRenderer } from "electron";
import type {
  CreateMatterDto, GetMatterDto, ListMattersDto, ArchiveMatterDto, ChainHeadDto,
  IpcEnvelope,
} from "../src/caseBox/dto.js";
// ... existing themeApi unchanged ...

export interface CaseBoxApi {
  createMatter(dto: CreateMatterDto):  Promise<IpcEnvelope<unknown>>;
  getMatter(dto: GetMatterDto):        Promise<IpcEnvelope<unknown>>;
  listMatters(dto: ListMattersDto):    Promise<IpcEnvelope<unknown>>;
  archiveMatter(dto: ArchiveMatterDto): Promise<IpcEnvelope<unknown>>;
  chainHead(dto: ChainHeadDto):        Promise<IpcEnvelope<unknown>>;  // rev-0.1 M3
}

const caseBoxApi: CaseBoxApi = {
  createMatter:  (dto) => ipcRenderer.invoke("casebox:matter:create", dto),
  getMatter:     (dto) => ipcRenderer.invoke("casebox:matter:get", dto),
  listMatters:   (dto) => ipcRenderer.invoke("casebox:matter:list", dto),
  archiveMatter: (dto) => ipcRenderer.invoke("casebox:matter:archive", dto),
  chainHead:     (dto) => ipcRenderer.invoke("casebox:audit:chainHead", dto),  // rev-0.1 M3
};

contextBridge.exposeInMainWorld("lawbar", { theme: themeApi, caseBox: caseBoxApi });
```

Renderer-side type: `Window["lawbar"]["caseBox"]: CaseBoxApi`. The channel name strings on the right side of `ipcRenderer.invoke` are the security-allowlist identifiers; the JS method names on the left are renderer-facing aliases.

## §12 — Renderer prohibition rules (contract §9; rev-0.1 M1 — TypeScript-AST lint restored)

The renderer MUST NOT:
- Send any server-authority field per §9.1 step 2 forbidden list (`id` / `tenant_id` / `actor_user_id` / `created_at` / `status` / `archived_at` / `successor_matter_id` / `custody_chain` / `external_ocr_authorized` / `sync_grant_present` / `llm_extraction_opt_in`).
- Hold a reference to `getCaseBoxRuntime()` or any persistence handle (impossible in the renderer — no Node access via `contextIsolation: true` + `nodeIntegration: false`).
- Import `case-box-persistence` or `case-box-contract` (or `better-sqlite3`, `node:fs`, etc.) directly OR transitively from any renderer module.
- Bypass the envelope shape — every IPC call MUST handle both `{ok: true}` and `{ok: false}` branches.

### §12.1 Static enforcement via `check-renderer-imports.mjs` (rev-0.2 F5 — forbidden list expanded to contract §9; rev-0.1 M1 history retained)

The structural prohibition (no Node access in renderer; preload's narrow surface) is necessary but not sufficient — a developer could accidentally write `import { foo } from "case-box-persistence"` in a renderer-side `.ts` file. This compiles (TypeScript's `tsc` doesn't enforce renderer/main isolation) and only fails at runtime in the renderer (no Node).

A new pre-test lint script `apps/lawbar-desktop/scripts/check-renderer-imports.mjs` (~180 LOC) scans the renderer's TypeScript AST for forbidden imports. Wire into `pretest` so every test run gates against re-introduction.

The lint covers all 5 import forms (per contract §9 + reviewer M1):

1. **Static `import` declaration**: `import { X } from "<forbidden>"` — REJECT (regardless of named/default/namespace).
2. **`export … from` re-export**: `export { X } from "<forbidden>"`, `export * from "<forbidden>"`, `export * as ns from "<forbidden>"` — REJECT.
3. **Side-effect import**: `import "<forbidden>"` — REJECT.
4. **Dynamic `import()` call**: `await import("<forbidden>")` — REJECT (call expression form, NOT the type-only `import(...)` type query).
5. **Non-type imports of forbidden modules**: `import type { … } from "<forbidden>"` and `import { type X } from "<forbidden>"` are ALLOWED (types erased at compile); `import { value } from "<forbidden>"` is REJECTED even when the binding is used only in a type position (TypeScript may still emit the runtime import).

**Forbidden module specifier list** (rev-0.2 F5 — expanded to the full contract §9 table; was 4-entry list in rev-0.1):

| Specifier pattern | Match | Why |
|---|---|---|
| `electron` (exact) + `electron/*` sub-paths | exact + prefix | Renderer must use only `window.lawbar.*`; contract §9 |
| `node:*` (any Node built-in protocol) | prefix `node:` | No Node APIs in renderer |
| `fs` / `fs/promises` / `path` / `os` / `child_process` (bare specifiers) | exact-match list | rev-0.2 F5: bare Node built-ins resolve to Node under Node-emulating bundlers; contract §9 |
| `better-sqlite3` (exact) + sub-paths | exact + prefix | No native SQLite in renderer |
| `better-sqlite3-multiple-ciphers` (exact) + sub-paths | exact + prefix | rev-0.2 F5: SQLCipher-flavored fork; contract §9 |
| `case-box-persistence` (exact) + sub-paths (`case-box-persistence/dist/...` etc.) | exact + prefix | No persistence in renderer |
| `case-box-contract` (value imports only) | exact + prefix; `importKind !== "type"` | Schema/validator package; type imports OK; value imports forbidden |
| `services/ocr-*` (runtime; any sub-path) | regex `^services/ocr-[^/]+(/.*)?$` | rev-0.2 F5: OCR pipeline stays out of renderer; contract §9 |
| Relative paths into `apps/lawbar-desktop/src/caseBox/**` (excluding `dto.ts` which is type-only re-export) | path resolution | Internal main-side modules; renderer must not bypass preload |
| Relative paths into `apps/lawbar-desktop/electron/**` | path resolution | Main-process source; renderer never imports |
| Relative paths into `services/case-box-persistence/src/**` | path resolution | rev-0.2 F5: service-source bypass attempt; contract §9 |

Renderer-scope is computed by reading `apps/lawbar-desktop/tsconfig.json`'s `include` + filtering to files under `renderer/**/*.ts`. The lint uses TypeScript's compiler API (already a devDependency via `typescript ^5.6.0`) to walk the AST; no new dependency.

Pretest wiring: `apps/lawbar-desktop/package.json` `scripts.pretest` chain becomes `npm run build && npm run lint:renderer-imports && npm run check:no-real-data`. The lint script exits 0 if no offenders, exits 1 with a clear per-file/per-line listing of offenders (file + line + import-form category + matching forbidden specifier).

§17 G-IPC-17 acceptance gate verifies the lint covers all 5 import forms × representative package + relative/internal path variants (rev-0.2 F5: self-test fixture covers `electron`, `node:fs`, bare `fs`, `better-sqlite3`, `better-sqlite3-multiple-ciphers`, `case-box-persistence`, `case-box-contract` value-import, `services/case-box-persistence/src/index`, and a relative `../../electron/main` form).

## §13 — Test strategy

### §13.1 Main-process unit tests (pure-Node; rev-0.2 F2 + F4 — 5 channels; contract-shape codes)

`apps/lawbar-desktop/tests/ipc-handlers.unit.test.mjs` exercises `caseBoxHandlers.ts` with a mocked CaseBoxRuntime + mocked tenant/actor getters. Covers each of the 5 v1 channels (`casebox:matter:create` / `:get` / `:list` / `:archive` + `casebox:audit:chainHead`):
- Happy path: DTO → injected fields → validate → persistence call → envelope `{ok: true}`.
- Shape-guard failure: non-object / array / null / non-default-prototype payload → envelope `{ok: false, error: {kind: "case_box_persistence_error", code: "invalid_payload", message: "DTO must be a plain JSON-shaped object"}}`.
- Server-authority field rejection: DTO containing `tenant_id` (or any other forbidden field per §9.1 step 2) → envelope `{ok: false, error: {code: "invalid_payload", message: "DTO contains a server-authority field", details: {schemaPath: "<field>"}}}`.
- Schema-validation failure: DTO with invalid `matter_type` enum value → envelope `{ok: false, error: {code: "invalid_payload", message: "persistence schema violation", details: {schemaPath, keyword}}}`.
- List-query bounds: `limit < 1` / `limit` non-integer / `cursor` > 512 chars → envelope `{ok: false, error: {code: "invalid_payload"}}` with the per-step message from §9.2.
- Persistence error mapping: mocked persistence throws `CaseBoxPersistenceError` with each of the 11 stable codes (notably `unknown_matter`, `illegal_transition`, `local_only_external_flag_rejected`, `tenant_mismatch`) → envelope `{ok: false, error: {kind: "case_box_persistence_error", code: <verbatim>}}` (rev-0.2 F2 — no remap).
- Unknown error opacity: mocked persistence throws plain `Error("internal SQL detail …")` → envelope `{ok: false, error: {code: "not_implemented", message: "internal error (see main log)"}}`; assert renderer envelope NEVER includes the raw Error.message; assert main-side `console.error` (spied) was called once with the full Error.

LOC: ~250.

### §13.2 DTO contract test (pure-Node)

`apps/lawbar-desktop/tests/dto-contract.test.mjs` asserts the DTO type module's runtime metadata (e.g. an exported `CREATE_MATTER_DTO_FIELDS: readonly string[]`) does NOT include any server-authority field from `case-box-matter.schema.json`. Catches drift if a future schema change accidentally appears in the DTO.

LOC: ~80.

### §13.3 Preload contract test (pure-Node)

Light-touch test that asserts the preload's exposed surface matches the CaseBoxApi interface (e.g. via reading preload.mts AST or via a smoke test that loads preload in a sandboxed context). Probably folded into `ipc-handlers.unit.test.mjs`.

### §13.4 Packaged renderer→main round-trip (Playwright via WI-2 wrapper; rev-0.2 F6 — full no-DB glob set; rev-0.1 H3 + M2 retained)

`apps/lawbar-desktop/tests/casebox-ipc.electron.test.mjs` — adapts the tarball PoC test pattern. Backing is **`InMemoryCaseBoxPersistence`** (rev-0.2 F3 — no SQLite). No DB path; no `LAWBAR_CASEBOX_DB_PATH` env (rev-0 SQLite-era invention removed in rev-0.1 H3 — no env override exists; the test does not set or rely on one).

1. Guard #3 sentinel block at top of file (Guard #3 sentinel-pair from WI-2; LAWBAR_TEST_PID_LOG + LAWBAR_WRAPPER_VERSION).
2. Set up an **isolated temp-root environment** (rev-0.1 M2): create a temp dir under `os.tmpdir()` named e.g. `lawbar-ipc-test-XXXX`; set `HOME` to point at this temp root; this redirects `app.getPath("userData")` to `<temp>/Library/Application Support/lawbar/` on macOS. The temp root is cleaned up in `t.after`.
3. **Pre-launch snapshot (rev-0.2 F6)**: scan the isolated temp `userData` root + the repo working tree for ANY of `*.db`, `*.sqlite`, `*.sqlite3`, `*.db-wal`, `*.db-shm`, `case-box.db*`. Assert empty (proves clean state).
4. `launchPackaged({executablePath, env: {...process.env, LAWBAR_MODE: "dev", HOME: <tempRoot>}}, {testName: ...})`.
5. `await app.firstWindow()`.
6. Bounded readiness poll for `window.lawbar.caseBox.createMatter` definition via `page.evaluate(() => typeof window.lawbar?.caseBox?.createMatter === "function")` — timeout 5s with HARNESS FAILURE message naming the cause.
7. Invoke each of the **5** v1 channels (rev-0.1 M3 — `createMatter` / `getMatter` / `listMatters` / `archiveMatter` + `chainHead`) via `page.evaluate(() => window.lawbar.caseBox.createMatter({...synthetic DTO...}))`. Synthetic DTOs ONLY (per §15 dummy-data rules).
8. Assert envelope shape: `{ok: true, value: {...}}` for happy paths; `{ok: false, error: {kind: "case_box_persistence_error", code, message}}` for the forbidden-field test, where `code` is strictly one of the contract §7 11-code enum (rev-0.2 F2 — typically `invalid_payload` for the forbidden-field test).
9. **Post-suite snapshot (rev-0.2 F6)**: re-scan the isolated temp `userData` root + the repo working tree for the same expanded glob set. Diff the pre/post sets; assert no new entry appeared during the test. Since v1 backing is in-memory, this gate proves the impl WI introduced no on-disk persistence side effect — a regression here means SQLite or other DB code accidentally landed.

LOC: ~280. Runs under the WI-2 wrapper at default 30s settle. Tests do NOT close the app inside the test body (`t.after` handles close + temp-root cleanup); the wrapper's post-suite crash scan still fires.

### §13.5 What this exercises end-to-end

- Renderer → preload bridge (`window.lawbar.caseBox.*` shape correct).
- IPC channel registration (main process handles received).
- DTO server-authority rejection (renderer attempts to send `tenant_id` → main process rejects).
- Schema validation via `case-box-contract.validateMatter`.
- Persistence call via `case-box-persistence.InMemoryCaseBoxPersistence` (rev-0.2 F3 — v1 backing is in-memory; SQLite + `openSqliteCaseBoxPersistence` are out of v1 scope per §8 + §15.5).
- LAZY runtime init on first IPC call.
- Error envelope mapping for at least 2 wire-shape variants: `invalid_payload` (validation-layer failure) and a preserved `CaseBoxPersistenceError.code` (persistence-layer failure such as `unknown_matter`) — both serialized per the contract §7 stable enum (rev-0.2 F2).
- The WI-2 wrapper's crash-detection wraps the whole run.

## §14 — Packaged verification (route through WI-2 wrapper)

Same pattern as `test:tarball-poc`:

- `npm run test:ipc-packaged` invokes the wrapper with `LAWBAR_TEST_FILES=tests/casebox-ipc.electron.test.mjs`.
- Wrapper records launched pid + scans `~/Library/Logs/DiagnosticReports/lawbar*.ips` post-settle.
- Any new `.ips` attributable to the launched .app fails the run (per WI-2 contract).

The WI-2 wrapper's contract is inherited unchanged from `017c560`. No wrapper changes.

## §15 — Dummy-data acceptance — no-DB-file / no-persistent-state ruleset (rev-0.1 H3 + bonus)

For this WI, "dummy-data acceptance" does **NOT** mean creating any persistent case-box database. The IPC boundary is tested against an in-memory backing only.

### §15.1 No persistent DB file

The impl WI MUST NOT:
- Create `case-box.db` (anywhere).
- Create `userData/case-box.db` (anywhere).
- Use `LAWBAR_CASEBOX_DB_PATH` (the env var was a rev-0 invention now removed).
- Define migrations or migration state.
- Write case-box data into `~/Library/Application Support/lawbar/`, `~/.config/lawbar/`, or any real user-state path.

The CaseBoxRuntime singleton per §8 uses `InMemoryCaseBoxPersistence` only. SQLite persistence is deferred per §15.5.

### §15.2 Isolated environment

Packaged renderer→main tests (§13.4) MUST run with isolated temp roots:
- Temp `HOME` (redirects `app.getPath("userData")` on macOS to `<temp>/Library/Application Support/lawbar/`).
- Implicit isolated `userData` + app-support path inheritance via the temp `HOME`.
- Per-test cleanup of the temp root in `t.after`.

Before AND after every IPC test, take **explicit pre/post snapshots** of the persistence-file extension set across BOTH the isolated temp `userData` root AND the repo working tree. The full no-DB scan glob set (rev-0.2 F6 — expanded to the reviewer-required list):

- `*.db`
- `*.sqlite`
- `*.sqlite3`
- `*.db-wal`
- `*.db-shm`
- `case-box.db*` (covers `case-box.db`, `case-box.db-journal`, `case-box.db-shm`, `case-box.db-wal`, `case-box.db.bak`, etc.)

Pre-snapshot: assert the set is empty under the isolated temp root + the repo working tree. Post-snapshot: assert the set is still empty (no file appeared during the test). Diff the pre/post sets; any new entry fails the gate with the offending path. This is a positive existence assertion in BOTH directions — pre-test and post-test — so the gate cannot be silently degraded by a stale pre-existing artifact OR by a regression that creates one during the run.

The same pre/post pattern applies to G-IPC-11, G-IPC-16, and G-IPC-19. The "no `LAWBAR_CASEBOX_DB_PATH`" semantics are preserved (the env var does not exist in v1; the test does NOT set it; the scan looks for files regardless of whether any env override could have placed them elsewhere).

### §15.3 In-memory-only dummy data (rev-0.2 bonus phrasing — heuristic + diff-scan + audit gate, NOT mathematical proof)

The dummy-data discipline is a defense-in-depth combination of structural choice + automated gate + reviewer-on-audit, not a formal guarantee:

- **Structural** — the v1 backing is `InMemoryCaseBoxPersistence`; data lives only in JS memory + dies on process exit. Nothing is persisted; there is no surface where real lawyer data could accidentally land. **[SUPERSEDED 2026-06-02 — case-box now persists to SQLite under `userData`; this structural-volatility claim no longer holds and real-data hygiene must not rely on it. See the banner at the top of this file. The diff-scan gate below remains active.]**
- **Convention** — dummy matters are generated in memory at test time + discarded at process exit. Test data uses clearly fictional names ("PoC synthetic matter", "IPC test fixture", "Acme Demonstration LLC", "Example v. Specimen") — never real client names. Synthetic ULID IDs (26-char Crockford lowercase per schema regex `^[0-9a-z]{26}$`) generated by the §7.3 utility OR hardcoded `01jpoc00ipctest…` constants.
- **Diff-scan gate** — a new `apps/lawbar-desktop/scripts/check-no-real-data.mjs` (~80 LOC) scans the impl WI's diff (and any committed fixture files) for real-looking markers — real-court-name regexes (`/(supreme court|district court|高级人民法院|中级人民法院)/i`), real-bar-number patterns (e.g. `/[A-Z]{2}\d{6,}/` for US state bar formats), phone numbers, email addresses, postal addresses, national-ID patterns. Exits non-zero (per-match listing) if any match in newly-added/modified case-box-related code or fixtures. Wired into `pretest`. <!-- no-real-data: detector-pattern-doc — this line documents the scanner's own court-name regex; the strings above are rule documentation, not real client data. See check-no-real-data.mjs isDetectorDoc/DOC_EXEMPT_MARKER. -->
- **Audit gate** — cc-suite audit inspects test fixtures + diff for synthetic-only content; flags any pattern the diff-scan missed.

This is a heuristic + gate combination; it does NOT claim to prevent "ANY" real legal data in the absolute sense — a sufficiently obfuscated string could in principle slip through all three layers. The combination is designed to make accidental real-data inclusion observable in the normal contributor workflow, not provable absent in the abstract.

### §15.4 Renderer/main boundary only

The acceptance target is proving the boundary: **renderer → preload → main IPC → contract-shaped in-memory persistence**. It is NOT proving:
- SQLite persistence.
- Migration semantics.
- Encryption-at-rest.
- Production-data readiness.
- Multi-launch durability.
- Cross-process concurrency.

If a renderer-side caller wants persistence semantics, that requires a separately-authorized future WI.

### §15.5 SQLite persistence deferred (later WI; rev-0.1 H3)

The contract `9f9f79b` §10 deferred SQLite to a later WI. A later, explicitly-authorized WI that introduces SQLite persistence MUST separately review:
- **Path policy**: where `case-box.db` lives (per-user / per-firm / per-matter); how multi-account macOS users are handled.
- **Migration policy**: forward-only? Downgrade allowed? Schema-version field; per-version test matrix.
- **Encryption expectations**: relative to Tier 2 SQLCipher; whether the DB-at-rest encryption posture is decided before or after Tier 2 lands.
- **Test isolation**: how `npm test` runs avoid touching the real DB; how CI fresh-clone runs initialize a clean DB.
- **User-data cleanup**: what the user can/cannot delete; how uninstall removes case data.
- **Production-vs-test database authority**: which env vars / config flags select which DB; how a misconfigured production launch fails closed.

This impl WI introduces NONE of those. The diff scan (§15.3) backed by G-IPC-22 (§17) is the load-bearing gate that no SQLite/persistent-DB code accidentally lands.

## §16 — STOP-AND-ASK items (impl WI authorization MUST address each)

### §16.1 IPC handlers as security-boundary code

Per `.claude/rules/security-boundary.md` §"In-scope work" — IPC handlers ARE security-boundary code. The impl WI MUST follow the security WI loop: plan-review → tests-first → impl → audit → verify → sign-off.

**STOP-AND-ASK**: confirm the security WI loop applies; reviewer-on-audit MUST inspect for SSRF / sandbox-bypass / unintended renderer authority escalation. The current preload's `contextIsolation: true` + `nodeIntegration: false` + `sandbox: false` config (from `apps/lawbar-desktop/electron/main.ts:42`) is preserved; the impl WI's plan-review must confirm `sandbox: false` is still acceptable for the case-box surface OR propose hardening.

### §16.2 SQLite persistence explicitly deferred (rev-0.1 H3 — replaces rev-0's userData/case-box.db item)

v1 backing is in-memory only (§8). SQLite persistence is deferred to a later, separately-authorized WI that MUST address path policy, migrations, encryption, test isolation, user-data cleanup, and production-vs-test database authority (§15.5 enumerates the full review surface).

**STOP-AND-ASK**: confirm v1 stays in-memory; confirm a future SQLite WI is required before any product UI reads persistent state. The impl WI's commit message MUST acknowledge this deferral verbatim + reference §15.5.

### §16.3 No real auth provider; tenant + actor are constants

Per contract §6.3/§6.4 + brief §13. The `getActiveTenantId() → "default-tenant"` and `getActiveActorUserId() → "local-user"` constants are NOT auth identities. Any future WI that introduces a real auth provider is a STOP-AND-ASK per `.claude/rules/autonomy.md` global hard-stop list.

### §16.4 v1 scope cut to 5 channels; remaining persistence methods deferred (rev-0.1 M3 — 4 → 5 methods)

5 channels in v1: `casebox:matter:create / :get / :list / :archive` + `casebox:audit:chainHead`. Out of v1: documents, audit-events list, classifications, privilege markers, facts, docket entries, deadlines, evidence, OCR links — all deferred. The impl WI's commit message MUST list deferred methods + reference future WI tags. Each future WI requires its own cc-suite review-plan.

### §16.5 Renderer prohibition is structural + AST-lint-enforced (rev-0.1 M1)

Per §12, the renderer CANNOT bypass the IPC envelope shape OR import case-box-* directly. Enforced by (a) Electron's `contextIsolation` + `nodeIntegration: false` config — verified unchanged in the diff; (b) the new `check-renderer-imports.mjs` AST lint (rev-0.1 M1) wired into `pretest`. The impl WI MUST verify both layers are present.

### §16.6 ~~LAWBAR_CASEBOX_DB_PATH env var test surface~~ — REMOVED (rev-0.1 H3)

The env var was a rev-0 SQLite-era invention. v1 backing is in-memory; no DB path; no DB-path env override. This STOP-AND-ASK is no longer applicable.

### §16.7 ~~Schema-migration forward-only assumption~~ — REMOVED (rev-0.1 H3)

No schema, no migration in v1. This STOP-AND-ASK is no longer applicable; rolled into §16.2 + §15.5 SQLite-deferred review surface.

### §16.8 Cross-package side-effects on tarball mechanism

The impl WI does NOT touch case-box-persistence or case-box-contract source. The tarball PoC's pack mechanism + bootstrap workflow remain authoritative for installing case-box-* into apps/lawbar-desktop. The impl WI's tests REQUIRE bootstrap to have run (case-box-* must be in node_modules); failure to bootstrap shows a clear error message.

### §16.9 `sandbox: false` posture explicitly accepted (rev-0.1 bonus)

The current `apps/lawbar-desktop/electron/main.ts:42`-area `webPreferences` config has `sandbox: false` because the preload uses ESM (`preload.mts`). Electron's sandbox mode requires a CommonJS-compiled preload. Switching to `sandbox: true` would require a separate WI to compile preload to CJS + rewire the existing theme preload.

**STOP-AND-ASK**: confirm `sandbox: false` is the accepted constraint for this impl WI. The case-box IPC surface inherits the existing posture; this WI does NOT propose hardening to `sandbox: true`. Future hardening is its own WI. The cc-suite audit MUST note this posture as accepted (NOT as a violation).

### §16.10 Cross-arch packaged testing posture (rev-0.1 bonus)

The packaged renderer→main test runs against `dist/mac-arm64/lawbar.app` (the host-arch build per the tarball PoC test's bundle-root resolution). `npm run dist` builds BOTH arm64 + x64 outputs, but only the host-arch binary is exercised by `npm run test:tarball-poc` or `npm run test:ipc-packaged`. **Cross-arch packaged IPC testing is OUT of v1 scope**; an x64 host (or CI runner) would naturally exercise the x64 build, but a single workspace does not exercise both. Recorded here so future CI matrix design knows to add the cross-arch run.

**STOP-AND-ASK**: confirm cross-arch packaged-IPC testing is deferred. The impl WI's acceptance gate uses host-arch only.

### §16.11 Dummy-data diff-scan gate (rev-0.1 bonus)

Per §15.3 — `check-no-real-data.mjs` scans the impl WI's diff for real-looking legal markers (real court names; bar number regexes; phone numbers; emails; addresses; national-ID patterns). Wired into `pretest`. Acceptable false-positive rate; reviewer should flag any obvious bypass.

**STOP-AND-ASK**: confirm the diff-scan gate scope is appropriate. Any false negatives surface in cc-suite audit (which inspects test fixtures + diff for synthetic-only content).

## §17 — Acceptance gates G-IPC-1 through G-IPC-N

- **G-IPC-1** — `apps/lawbar-desktop/electron/ipc/caseBoxHandlers.ts` exists per §6.1; registers **5** ipcMain handlers (rev-0.1 H1 + M3 channel names): `casebox:matter:create` / `casebox:matter:get` / `casebox:matter:list` / `casebox:matter:archive` / `casebox:audit:chainHead`. Each handler implements the §9 validation pipeline + §9.2 contract-shape error envelope.
- **G-IPC-2** — `apps/lawbar-desktop/src/caseBox/caseBoxRuntime.ts` exists; LAZY init pattern per §8 against **`InMemoryCaseBoxPersistence`** (rev-0.1 H3); `closeCaseBoxRuntime()` exported + called from `app.before-quit`. No SQLite, no `openSqliteCaseBoxPersistence`, no `case-box.db` path.
- **G-IPC-3** — `apps/lawbar-desktop/src/caseBox/dto.ts` exists (type-only); **5** DTO types (CreateMatterDto / GetMatterDto / ListMattersDto / ArchiveMatterDto / ChainHeadDto) per §7.2 with corrected confidentiality enum `normal|heightened|sealed` (rev-0.1 H2) + `IpcEnvelope<T>` + `IpcErrorEnvelope` matching contract `9f9f79b` §7 wire shape (rev-0.1 H4).
- **G-IPC-4** — `apps/lawbar-desktop/src/caseBox/errorMap.ts` exists; maps known `CaseBoxPersistenceError` codes (preserved verbatim from the contract §7 11-code enum) + IPC-layer validation failures (all → `invalid_payload` per rev-0.2 F2, with disambiguating `message` and optional `details: {schemaPath, keyword}`) + unknown errors (opaque `not_implemented` + `"internal error (see main log)"` + main-side `console.error` log). The wire `code` is typed as `CaseBoxPersistenceErrorCode` (no invented codes). NO arbitrary `Error.message` forwarded to renderer.
- **G-IPC-5** — `apps/lawbar-desktop/src/security/activeTenant.ts` + `activeActor.ts` exist; return constants + test-injectable. The `getActiveTenantId()` is the server-side source for `ListMattersDto` queries (rev-0.1 M4 — renderer NEVER scopes tenant).
- **G-IPC-6** — `apps/lawbar-desktop/electron/main.ts` registers the 5 ipcMain handlers at end of `app.whenReady().then(...)`; adds `app.before-quit` listener for `closeCaseBoxRuntime`. Production launch behavior IS BYTE-IDENTICAL to pre-impl baseline for window creation + theme handlers + FileVault enforcement + tarball PoC env-gated hook. No new `webPreferences` changes (rev-0.1 §16.9 — `sandbox: false` accepted).
- **G-IPC-7** — `apps/lawbar-desktop/electron/preload.mts` exposes `window.lawbar.caseBox.*` (5 methods) alongside `window.lawbar.theme.*`; the existing theme surface is UNCHANGED. Channel names match contract pattern `casebox:<scope>:<op>` (rev-0.1 H1).
- **G-IPC-8** — `apps/lawbar-desktop/package.json` adds new npm scripts: `test:ipc-unit`, `test:ipc-contract`, `test:ipc-packaged`, `lint:renderer-imports` (rev-0.1 M1), `check:no-real-data` (rev-0.1 §15.3). `pretest` chain becomes **`npm run build && npm run lint:renderer-imports && npm run check:no-real-data`** (rev-0.3 M-1 — was `npm run build && npm run lint:renderer-imports` in rev-0.2; rev-0.2 F5 disposition claimed the chain was extended but the gate text lagged; this rev-0.3 gate matches §6.2 + §12.1 + §15.3 + §16.11 + §22 wording). G-IPC-18 remains the scanner self-test (poisoned fixture). NO new runtime deps. NO mutation to the WI-2 wrapper or tarball PoC scripts.
- **G-IPC-9** — `tests/ipc-handlers.unit.test.mjs` covers all 5 channels × the relevant validation/error paths (happy / shape-guard / forbidden-field / schema-violation / persistence-error / opaque-not_implemented). ≥25 sub-cases. ALL PASS.
- **G-IPC-10** — `tests/dto-contract.test.mjs` asserts the DTO type module's runtime metadata (exported `*_DTO_FIELDS` arrays) excludes every server-authority field listed in §9.1 step 2 forbidden list (including the 3 opt-in booleans + matter lifecycle fields per rev-0.1 H2). PASS.
- **G-IPC-11** — `tests/casebox-ipc.electron.test.mjs` exercises the 5 channels through the renderer→main path under the WI-2 wrapper; asserts envelope shapes (`{ok: true, value}` for happy paths; `{ok: false, error: {kind: "case_box_persistence_error", code, message}}` for failure paths; `code` strictly one of contract §7 11-code enum per rev-0.2 F2). Runs under **isolated temp `HOME`** (rev-0.1 M2); pre-launch AND post-suite snapshots scan the isolated temp root + repo working tree for the full no-DB glob set `*.db / *.sqlite / *.sqlite3 / *.db-wal / *.db-shm / case-box.db*` (rev-0.2 F6) and assert no new entry appeared. PASS at 30s settle; crash count unchanged.
- **G-IPC-12** — WI-A regression (`npm run test:packaged`): 3/3 PASS; no regression.
- **G-IPC-13** — Tarball PoC regression (`npm run test:tarball-poc`): 7/7 PASS; no regression. The lazy CaseBoxRuntime singleton (in-memory) does NOT interfere with the tarball PoC's probe (which uses `openSqliteCaseBoxPersistence` directly via the env-gated hook); the two runtimes are independent.
- **G-IPC-14** — wrapper.test.mjs (WI-2 regression): 31/31 PASS; no regression.
- **G-IPC-15** — npm test (main + dev smoke): 26+/26+ PASS; no regression. New ipc-handlers + dto-contract unit tests ADD to the count.
- **G-IPC-16** — Production-launch no-persistent-state check (rev-0.3 M-2 — scan scope expanded to BOTH directions; rev-0.2 F6 / rev-0.1 H3 + M2 history retained): launch the .app with `LAWBAR_MODE=dev` + isolated temp `HOME` + no IPC calls; render the 12-panel token fixture; close. Pre-launch AND post-launch snapshots scan **BOTH the isolated temp `userData` root AND the repo working tree** (rev-0.3 M-2 — rev-0.2 stopped at the temp root, but §13.4 + §15.2 require both directions) for the full no-DB glob set: `*.db`, `*.sqlite`, `*.sqlite3`, `*.db-wal`, `*.db-shm`, `case-box.db*`. The pre/post diff across BOTH locations MUST be empty (no new entry between snapshots). (In-memory backing → file should NEVER appear regardless; this gate catches accidental SQLite reintroduction.)
- **G-IPC-17** — `apps/lawbar-desktop/scripts/check-renderer-imports.mjs` lint covers all 5 forbidden import forms (rev-0.1 M1); test pass: lint exits 0 on the impl WI's renderer code AND exits 1 when a deliberately-injected forbidden import is added to a test fixture (proves the lint actually catches violations).
- **G-IPC-18** — `apps/lawbar-desktop/scripts/check-no-real-data.mjs` diff-scan (rev-0.1 §15.3) finds NO real-looking legal markers in the impl WI's diff or committed fixtures. Test pass: scan a deliberately-poisoned fixture (e.g. containing `"Smith & Jones LLP"`) and confirm it's caught.
- **G-IPC-19** — Repo-root working-tree no-DB-file check (rev-0.3 M-2 — scan scope corrected to repo root; rev-0.2 F6 / rev-0.1 §15.2 history retained): after the entire impl + test cycle, scan from the **repo root** (NOT only `apps/lawbar-desktop`; rev-0.2 wording was too narrow). Concrete command:
  ```
  find . \
    \( -path './node_modules' -o -path './**/node_modules' \
       -o -path './dist' -o -path './**/dist' \
       -o -path './coverage' -o -path './**/coverage' \
       -o -path './apps/lawbar-desktop/dist-tarballs' \
       -o -path './apps/lawbar-desktop/staging' \) -prune \
    -o \( -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' \
         -o -name '*.db-wal' -o -name '*.db-shm' \
         -o -name 'case-box.db*' \) -print
  ```
  returns empty. Excluded paths are the known generated/dependency dirs: `node_modules/`, `dist/`, `coverage/` (recursive), plus the tarball PoC's intentional artifacts (`apps/lawbar-desktop/dist-tarballs/` + `apps/lawbar-desktop/staging/`). NO persistence-file artifact may appear anywhere else in the repo. Pre-impl baseline snapshot recorded in the WI's plan-review attachment; post-impl snapshot diffed; any new entry fails the gate with the offending path.
- **G-IPC-20** — Cross-arch posture explicitly stated (rev-0.1 §16.10): host-arch-only packaged-IPC tests are sufficient for v1; cross-arch matrix deferred. Recorded in commit message.
- **G-IPC-21** — cc-suite review-plan on the impl WI's plan returns READY (or Low-only) per security WI loop.
- **G-IPC-22** — cc-suite audit on impl diff returns 0 C/H/M.
- **G-IPC-23** — cc-suite verify confirms G-IPC-22.
- **G-IPC-24** — Commit message records 11-field cc-suite recording + STOP-AND-ASK confirmations from §16 (including §16.2 SQLite-deferred, §16.9 sandbox: false accepted, §16.10 cross-arch deferred, §16.11 diff-scan gate) + parent reference chain.

## §18 — Risks (rev-0.1 — DB-related rows removed per H3; sandbox + cross-arch rows added per bonus)

| Severity | Risk | Mitigation |
|---|---|---|
| **High** | The IPC handlers are security-boundary code. A flaw in DTO validation could let the renderer impersonate a different tenant/actor OR flip an external-exposure opt-in boolean. | §9.1 step 2 enforces server-authority field rejection (incl. the 3 opt-in booleans) BEFORE validation; tenant + actor are read from §10 stubs per call (never from DTO). cc-suite audit MUST inspect each handler for any path that accepts a forbidden field from DTO. G-IPC-9's forbidden-field sub-cases prove the reject path; G-IPC-22 catches code-level regressions. rev-0.1 H2 + H4 + M4 jointly close this risk. |
| **Medium** | The IPC envelope is the renderer's only view of failures. If error mapping leaks raw `Error.message` text from unexpected throws, sensitive internal state (SQL parameter values; file paths; etc.) could surface in the renderer. | §9.3 opacity contract: unexpected errors log main-side via `console.error` (audit trail) + return opaque `{code: "not_implemented", message: "internal error (see main log)"}`. NO `Error.message` forwarded. rev-0.1 H4 fix. |
| **Medium** | The renderer prohibition rules (§12) are enforced by structure (no Node in renderer) + AST lint. A developer who circumvents the lint (e.g. by editing a renderer file without running pretest) could land a forbidden import in CI. | §13 `check-renderer-imports.mjs` is wired into `pretest`; CI runs `npm test` which triggers `pretest`. The lint catches all 5 forbidden import forms (rev-0.1 M1). |
| **Medium** | `sandbox: false` posture in main.ts inherited from ESM preload requirement. The case-box IPC surface inherits this. A renderer compromise (e.g. via a future XSS in some product UI WI) has broader privilege than under `sandbox: true`. | §16.9 STOP-AND-ASK records explicit acceptance; cc-suite audit MUST note as accepted, NOT as a violation. A future hardening WI (separate from this impl) compiles preload to CJS + flips to `sandbox: true`. v1 single-lawyer + local-first + 12-panel-token-fixture renderer limits the practical exposure. |
| **Medium** | LAZY runtime init could TOCTOU under truly concurrent IPC. | Electron main process is single-threaded; `if (runtime === null)` check + assignment happen in the same synchronous tick (no `await` between them). Reviewer confirmed safety under focus-answer C. If multi-process workers are introduced in a future WI, the singleton needs revisiting. |
| **Medium** | The 5-method v1 scope means most case-box-persistence methods are not exercised by IPC tests. Drift between persistence's evolving API + the impl WI's handlers could surface only when future WIs add the missing methods. | Acceptable v1 risk; deferred per §16.4. |
| **Low** | DTO type module's `import type` only — preload imports types; renderer imports types. TypeScript erases types at runtime, so a malicious renderer COULD construct a JS object that LOOKS like the DTO but contains extra fields. | The §9.1 step 1 shape guard + step 2 forbidden-field scan run at runtime; type-level constraint is NOT the load-bearing check. Reject path returns `code: "invalid_payload"` (rev-0.2 F2 — contract §7 stable enum; no invented codes). |
| **Low** | Cross-arch packaged-IPC testing is deferred per §16.10. An arm64-host workspace exercises only the arm64 .app build; x64 regressions would surface only if a CI matrix added an x64 runner. | Recorded as a known v1 gap; CI matrix design (future WI) closes this. |

No Critical risks. The H1 security-boundary risk is the most likely escalation candidate during cc-suite audit.

## §19 — Hard stops

Per `.claude/rules/autonomy.md` §"Hard-stop list" — this plan triggers:
- **Security-boundary surface change** — YES. cc-suite review-plan + audit + verify chain REQUIRED per security WI loop. STOP-AND-ASK §16.1.

This plan does NOT trigger:
- Push, deploy, release, production, migration, auth provider, cloud vendor, public exposure.
- New runtime dependency (case-box-* deps already added by tarball PoC commit `e61d7d9`).
- Public API breakage on existing channels (theme:get / theme:set unchanged; the new caseBox:* channels are additive).
- `Info.plist` / `LSUIElement` / `LSBackgroundOnly` / crash suppression.
- IPC implementation restart (the IPC layer DOES NOT yet exist; this is its first introduction — not a restart of a prior IPC layer).
- Product UI / case-box UI (the renderer's existing 12-panel token fixture is UNCHANGED).
- Real-data persistence (synthetic-only).
- Tier 2 SQLCipher / Keychain.
- Auth / cloud / signing / notarization / distribution / telemetry / cloud / go-live.

This plan IS HIGH-RISK per `.claude/rules/cc-suite.md` §"High-risk WIs" because it introduces a NEW security-boundary surface (the renderer→main IPC channels for case-box operations). cc-suite review-plan is REQUIRED.

## §20 — LOC budget hints

| Artifact | Est new LOC | Threshold |
|---|---|---|
| `apps/lawbar-desktop/electron/ipc/caseBoxHandlers.ts` | ~150 | 800 (source) |
| `apps/lawbar-desktop/src/caseBox/caseBoxRuntime.ts` | ~120 | 800 |
| `apps/lawbar-desktop/src/caseBox/dto.ts` (type-only) | ~80 | 800 |
| `apps/lawbar-desktop/src/caseBox/errorMap.ts` | ~60 | 800 |
| `apps/lawbar-desktop/src/caseBox/ulid.ts` | ~30 | 800 |
| `apps/lawbar-desktop/src/security/activeTenant.ts` | ~10 | 800 |
| `apps/lawbar-desktop/src/security/activeActor.ts` | ~10 | 800 |
| `apps/lawbar-desktop/electron/main.ts` additions | ~20 | 800 (existing main.ts ~140 LOC → ~160 LOC) |
| `apps/lawbar-desktop/electron/preload.mts` additions | ~50 | 800 (existing preload.mts ~30 LOC → ~80 LOC) |
| `apps/lawbar-desktop/tests/ipc-handlers.unit.test.mjs` | ~250 | 1200 (test) |
| `apps/lawbar-desktop/tests/dto-contract.test.mjs` | ~80 | 1200 |
| `apps/lawbar-desktop/tests/casebox-ipc.electron.test.mjs` | ~250 | 1200 |
| `apps/lawbar-desktop/package.json` | +3 script lines | n/a |
| This plan file (`-01.md`) | ~750 (doc) | 1200 |
| `-00.md` SUPERSEDED banner | +3 lines | n/a |

All well within loc-guardian thresholds.

## §21 — Sequencing relative to parent and downstream WIs

Sequencing chain (updated through `e61d7d9`):
- WI-pkg-verify-detection-redesign ✅ (`7f16c5d`).
- WI-pkg-verify-detection-impl ✅ (`017c560`).
- WI-retire-probe-case-box ✅ (`45167b1`).
- WI-revive-tarball-poc-refresh (plan) ✅ (`1d04256`).
- WI-tarball-poc-impl ✅ (`e61d7d9`).
- **WI-casebox-ipc-impl-refresh: this plan** (pending review).
- WI-casebox-ipc-impl: the eventual implementation per this plan (pending; requires this plan READY first).

Downstream WIs unlocked once WI-casebox-ipc-impl lands:
- v1 product-UI scaffolding (renderer-side case-box screens that consume `window.lawbar.caseBox.*`). NOT in scope of this plan or its impl WI.
- Future per-entity IPC impl WIs (documents / audit / classifications / etc.) — each adds 1-3 ipcMain handlers + DTOs + tests.
- Tier 2 SQLCipher migration — a separate lane that re-opens the DB encryption posture.

## §22 — Review packet (compact) — for cc-suite review-plan

**Active plan summary (rev-0.3)**: WI-casebox-ipc-impl-refresh refreshes the stopped `dev-memo/plan-casebox-ipc-impl-00.md` (untracked at HEAD `e61d7d9`) into an implementable blueprint for v1 case-box IPC. **v1 scope is 5 channels** (rev-0.1 M3) with **contract-pattern names** (rev-0.1 H1): `casebox:matter:create` / `casebox:matter:get` / `casebox:matter:list` / `casebox:matter:archive` / `casebox:audit:chainHead`. Maps to contract `9f9f79b`'s validation pipeline + error envelope + preload surface + runtime singleton lifecycle. Topology shift since `-00.md`: WI-2 wrapper crash-detection (`017c560`); WI-retire `--probe-case-box` excised (`45167b1`); WI-tarball-poc-impl installs case-box-* via tarball + proves runtime loadability (`e61d7d9`). **Backing: in-memory only** (rev-0.1 H3 / rev-0.2 F3 stale-text sweep) — `InMemoryCaseBoxPersistence`; NO `userData/case-box.db`; NO `LAWBAR_CASEBOX_DB_PATH`; SQLite + migrations + persistent DB path deferred to a later, separately-authorized WI per §15.5. LAZY runtime singleton (first-IPC-call init; closed on `app.before-quit`). Production launches that never call case-box IPC materialize NO state. Renderer→main path: contextBridge surface `window.lawbar.caseBox.*` (**5 methods**) extends existing `window.lawbar.theme.*`. DTO rewritten directly from contract `9f9f79b` §6.0 (rev-0.2 F1): required `name` + `matter_type` + `jurisdiction{value,locked}` + `parties[{role,display_name,party_kind,notes?}]` + `confidentiality_class∈{normal,heightened,sealed}`; optional `retainer_scope` + `case_type_text` + `case_progress_text` + `court_contact_text` + `contention_summary_text`. `ArchiveMatterDto.reason` REQUIRED; main injects `actor_user_id` on archive (renderer NEVER supplies actor). Main injects all server-authority fields including `external_ocr_authorized=false`, `sync_grant_present=false`, `llm_extraction_opt_in=false`, plus `id`, `tenant_id`, `actor_user_id`, `created_at`, `status`, `archived_at` (archive op only). Error envelope follows contract `9f9f79b` §7 verbatim (rev-0.2 F2): `kind: "case_box_persistence_error"`; `code` STRICTLY typed `CaseBoxPersistenceErrorCode` (the 11 stable codes); ALL IPC-layer validation failures map to `invalid_payload`; unexpected throws map to opaque `not_implemented` + `"internal error (see main log)"`. NO invented codes (rev-0.1's strings `invalid_shape` / `forbidden_input_field` / `schema_violation` are REMOVED in rev-0.2). Main-side `console.error` logs full Error for audit. Validation pipeline restated exactly per contract §6 (rev-0.1 M4): JSON-shape guard rejects no-prototype/symbols/functions; forbidden-field scan; list-query bounds (limit cap at 200; cursor opaque max 512); schema validation; persistence call; result wrapping. Renderer prohibition is structural + AST-lint-enforced via new `check-renderer-imports.mjs` (rev-0.2 F5 — forbidden list expanded to full contract §9: `electron`, bare Node builtins `fs`/`path`/`os`/`child_process`, `node:*`, `better-sqlite3` + `better-sqlite3-multiple-ciphers`, `case-box-persistence`, `case-box-contract` value imports, `services/ocr-*`, `services/case-box-persistence/src/**`, internal main-process relative paths). Lint covers all 5 import forms × representative package + relative/internal path variants. Packaged renderer→main test (§13.4) runs under isolated temp `HOME` (rev-0.1 M2); pre/post snapshots scan the full glob set `*.db / *.sqlite / *.sqlite3 / *.db-wal / *.db-shm / case-box.db*` (rev-0.2 F6) in BOTH the isolated temp root AND the repo working tree. Dummy-data discipline is heuristic + diff-scan + audit gate (rev-0.2 bonus phrasing — does NOT claim to prevent "ANY" real data in the absolute sense); structural in-memory backing + fictional-name convention + `check-no-real-data.mjs` diff scan + cc-suite audit are the four layers. STOP-AND-ASK items (§16): §16.1 security WI loop; §16.2 SQLite-deferred + future WI surface; §16.3 no real auth; §16.4 5-method scope cut; §16.5 structural + lint enforcement; §16.6 + §16.7 REMOVED (DB env vars + schema migrations no longer applicable in v1); §16.8 tarball mechanism unchanged; §16.9 `sandbox: false` accepted; §16.10 cross-arch packaged-test deferred; §16.11 dummy-data diff-scan gate. Acceptance gates **G-IPC-1 through G-IPC-24** (rev-0.2 — was stale "G-IPC-1 through G-IPC-20" in rev-0.1 review packet) cover impl deliverables + 5-channel × validation/error paths + DTO contract test + AST-lint pretest gate (full §9 forbidden set) + diff-scan dummy-data gate + packaged renderer→main smoke under isolated HOME + full no-DB glob set + WI-A/wrapper/tarball-poc regressions + working-tree no-DB-file check + cross-arch posture statement + cc-suite review/audit/verify chain. Risks: 1 H (security-boundary surface — closed by F1/F2/M4 combined) + 6 M + 2 L; 0 Critical. High-risk per cc-suite §"High-risk WIs" + security-boundary rule; review-plan + audit + verify REQUIRED. Disposition of `-00.md`: SUPERSEDE + SUPERSEDED banner + commit both files together (§5).

**Exact target files (this plan)**:
- `dev-memo/plan-casebox-ipc-impl-01.md` (new; this file).
- `dev-memo/plan-casebox-ipc-impl-00.md` (modified — SUPERSEDED banner added; first time committed to git).

**Exact target files (eventual impl WI; NOT this plan)**: see §6.1 + §6.2 (8 NEW + 3 MODIFIED files).

**Exact acceptance criteria (eventual impl WI)**: §17 G-IPC-1 through **G-IPC-24** (rev-0.2 F4 — was stale `G-IPC-1 through G-IPC-20` in rev-0.1 review packet).

**Exact out-of-scope (this plan)**:
- Any code implementation.
- Any package.json mutation in THIS commit.
- Any renderer / product-UI changes.
- Per-entity IPC handlers beyond the **5 v1 methods** (rev-0.2 F4 — was stale "4 v1 methods" in rev-0.1).
- SQLite persistence, `userData/case-box.db`, migrations, persistent DB path, `LAWBAR_CASEBOX_DB_PATH` — all deferred per §15.5 (rev-0.2 F3 — explicit restatement here).
- Tier 2 / signing / distribution / telemetry / cloud / go-live.

**Essential references**:
- `dev-memo/plan-case-box-ipc-contract-00.md` at `9f9f79b` (contract; design authority).
- `dev-memo/plan-casebox-ipc-impl-00.md` at HEAD `e61d7d9` (untracked; SUPERSEDED by this plan).
- WI-tarball-poc-impl commit `e61d7d9` (case-box-* now installable; runtime loadability proven).
- WI-2 commit `017c560` (wrapper for packaged verification).
- `.claude/rules/security-boundary.md` (IPC is security-boundary code).
- `.claude/rules/cc-suite.md` §"High-risk WIs".

**Review questions** (rev-0.1; for the cc-suite reviewer):

1. Does the rev-0.1 5-method scope (createMatter / getMatter / listMatters / archiveMatter / **chainHead**) close the audit-trail integrity boundary-proof gap raised in rev-0 M3? The plan adopted reviewer's preferred path (add chainHead now).
2. Is LAZY in-memory runtime init the right v1 tradeoff? Eager init would still materialize an empty InMemoryCaseBoxPersistence on every launch — wasted but harmless. Lazy preserves "no state until IPC called". Reviewer's H3 confirmation accepted lazy + in-memory as the correct contract-aligned path; review should confirm no second-thought.
3. Is the server-authority field rejection list (rev-0.1 H2) complete? Plan lists `id, tenant_id, actor_user_id, created_at, status, archived_at, successor_matter_id, custody_chain, external_ocr_authorized, sync_grant_present, llm_extraction_opt_in`. Reviewer flagged the 3 opt-in booleans + matter lifecycle fields — both now included. Any others missed?
4. Is the §9.2 error code map sufficient given the contract's CaseBoxPersistenceErrorCode set? Should additional codes be reserved for race conditions (e.g. matter created between getMatter and archiveMatter; persistence reports `state_transition_invalid`)?
5. Is the §11 preload surface design correct in extending `window.lawbar` (existing namespace) vs creating a separate `window.lawbarCaseBox` top-level? The plan keeps it under `window.lawbar.caseBox` per contract §8 + reviewer confirmation under focus-answer E.
6. Is the §13.4 packaged renderer→main test design sound under isolated temp `HOME` (rev-0.1 M2)? Specifically: does setting `HOME=<tempRoot>` cleanly redirect Electron's `app.getPath("userData")` on all macOS versions the project targets, or does any version use a different env-var? Plan assumes macOS 15.x semantics (where `HOME` → `~/Library/Application Support/lawbar/` resolves through the temp root).
7. Is the §5 disposition of `-00.md` (SUPERSEDE + commit with banner) still correct, or should it be archived under `dev-memo/superseded/` instead? Rev-0 reviewer accepted as-is; rev-0.1 maintains the same disposition.
8. Are the §16 STOP-AND-ASK items correctly classified after rev-0.1 reshape? §16.2 + §16.6 + §16.7 (DB-related) are REMOVED; §16.9 + §16.10 + §16.11 (sandbox / cross-arch / diff-scan) are ADDED. Anything still missing (e.g. should an impl-WI authorization checklist include explicit acknowledgment of the SQLite-deferred decision, separate from §16.2)?
9. Is the §17 G-IPC-17 lint-self-test sufficient to prove `check-renderer-imports.mjs` actually catches violations? Plan injects a deliberately-poisoned fixture + asserts lint exits 1. Any false-negative pattern the test should also cover?

## §23 — Stop condition

This plan becomes stale when:
- The impl WI (`WI-casebox-ipc-impl`) lands per §17 acceptance gates. After: this plan is the as-built reference.
- The IPC contract `9f9f79b` is revised (e.g. by a future rev-4); this plan needs amendment to track.
- The case-box-persistence public API changes incompatibly (e.g. v0.2.0 introduces breaking changes to `createMatter`). Triggers a plan amendment.
- The renderer-side product UI lands and the IPC scope cut must expand. New WI plan.

## §24 — Required cc-suite review

This plan is not authorized for promotion (status flip to READY) until:
1. `/cc-suite:review-plan dev-memo/plan-casebox-ipc-impl-01.md` returns READY (or only Low-risk clarifications remain).
2. Any Critical/High findings are fixed and the plan is re-reviewed.
3. The §6-§16 design decisions are not overridden without re-review.
4. The impl WI (WI-casebox-ipc-impl) does NOT begin until this plan is READY AND user has acknowledged each STOP-AND-ASK item in §16.

Review focus per `.claude/rules/cc-suite.md` §"High-risk WIs" + `.claude/rules/security-boundary.md`:
- Internal consistency between this plan and contract `9f9f79b`.
- Completeness: STOP-AND-ASK list is exhaustive; acceptance gates cover impl + tests + WI-A/tarball-poc/wrapper regressions + DB-untouched production-launch check + cc-suite chain.
- Feasibility: 5-method scope is achievable in ~1200 new LOC + ~70 modified LOC; no new dependencies; no production-binary surface beyond the additive IPC handlers + preload exposure.
- Ambiguity: STOP-AND-ASK items have clear authorization shape; the LAZY in-memory runtime + contract-shape error envelope are fully specified.
- Risk & sequencing: H1 security-boundary mitigation is convincing; §21 sequencing is correct (this plan unlocks the impl WI, which unlocks downstream product UI / per-entity IPC WIs / future SQLite WI / Tier 2).

This plan is HIGH-RISK per `.claude/rules/cc-suite.md` §"High-risk WIs" because it introduces a new renderer-facing security-boundary surface (the case-box IPC channels). `/cc-suite:review-plan` is REQUIRED before any impl WI authorization.

## §25 — Review-item disposition table (rev-0.3)

This table covers the full rev-0 → rev-0.1 → rev-0.2 → rev-0.3 chain. Maps each prior finding to the exact plan sections changed.

### Prior reviews (review-plan jobIds)

- `review-plan-mpmtyoyh-97zt15` — rev-0 review; NEEDS-FIX with 4 H + 4 M (closed in rev-0.1; see rev-0.1 rows below).
- `review-plan-mpnhj20a-6yj24u` — rev-0.1 re-review; NEEDS-FIX with 3 H + 3 M (closed in rev-0.2; see rev-0.2 rows below).
- `review-plan-mpnj8tsr-nujf3z` — rev-0.2 re-review; NEEDS-FIX with 0 C / 0 H / 2 M / 0 L (closed in rev-0.3; see rev-0.3 rows below). Reviewer recorded F1/F2/F3/F4 as **RESOLVED**; F5 / F6 had body resolved but two acceptance gates still lagged.

### rev-0.3 dispositions (from `review-plan-mpnj8tsr-nujf3z`)

| Finding | Severity | Sections changed (rev-0.3) | Disposition |
|---|---|---|---|
| M-1 — G-IPC-8 pretest chain stale (F5 partial residual) | M | §17 G-IPC-8 (pretest chain extended to `npm run build && npm run lint:renderer-imports && npm run check:no-real-data`); G-IPC-18 retained as the scanner self-test; consistency confirmed across §6.2 / §12.1 / §15.3 / §16.11 / §22 (all already said the extended chain in rev-0.2; only G-IPC-8 wording lagged) | **RESOLVED.** G-IPC-8 now matches §6.2 / §12.1 / §15.3 / §16.11 / §22. No gate-vs-prose contradiction remains for the pretest chain. |
| M-2 — G-IPC-16 + G-IPC-19 scan scope wrong (F6 residual) | M | §17 G-IPC-16 (scans BOTH isolated temp `userData` AND repo working tree pre/post; full 6-glob set); §17 G-IPC-19 (scope changed from `find apps/lawbar-desktop …` to repo-root `find . …` with `-prune` exclusions for `node_modules`, `dist`, `coverage` and the tarball PoC's intentional `dist-tarballs/` + `staging/` artifacts; full 6-glob set; pre/post diff semantics preserved) | **RESOLVED.** Both gates now match §13.4 + §15.2 prose. Scan scope is both-direction (temp root + working tree); G-IPC-19 covers the entire repo, not just one subtree. |

### rev-0.1 dispositions (from `review-plan-mpmtyoyh-97zt15`)

> NOTE (rev-0.2 re-align): The rev-0.1 disposition rows below describe what the rev-0.1 edits did. Reviewer `review-plan-mpnhj20a-6yj24u` re-rated rev-0.1 H2/H3/H4/M1/M2/M3 as NOT fully resolved because rev-0.1 body wording lagged behind the disposition claims. rev-0.2 closes those gaps per the rev-0.2 rows further below. The rev-0.1 rows are retained as history; do NOT read them as standalone proof of resolution.

| Finding | Severity | Sections changed | Disposition |
|---|---|---|---|
| H1 — Channel names mismatch with contract | H | §4 (channel table + 5-method scope); §7.1 (channel list); §7.2 (DTO module imports unchanged but reference channel constants); §11 (preload `ipcRenderer.invoke` strings); §17 G-IPC-1/G-IPC-7 (acceptance gates); §22 review packet | **RESOLVED.** All v1 channels renamed to contract pattern `casebox:matter:*` + `casebox:audit:chainHead`. JS method names on the preload API surface kept as camelCase aliases. |
| H2 — DTO schema-wrong + authority-wrong | H | §7.2 (CreateMatterDto rewritten — confidentiality enum `normal\|heightened\|sealed`; 3 opt-in booleans + `archived_at` + `successor_matter_id` REMOVED from DTO; allowed optional text fields added); §7.3 (server-authority injection list expanded to include the 3 booleans); §9.1 step 2 (forbidden-field list expanded); §17 G-IPC-3, G-IPC-10 (DTO contract test ensures field-list correctness); §18 risk H1 mitigation references rev-0.1 H2 closure | **RESOLVED.** DTO rewritten from the case-box-matter schema. Renderer cannot send the 3 external-exposure opt-in booleans; main injects all as `false`. |
| H3 — SQLite first-impl backing contradicts contract | H | §8 (full rewrite — `InMemoryCaseBoxPersistence`; no `openSqliteCaseBoxPersistence`; no `LAWBAR_CASEBOX_DB_PATH`; explicit deferral list); §1 (out-of-scope updated); §3 (topology-shift table row updated); §15 (full rewrite — no-DB-file ruleset); §15.5 (deferred SQLite WI review surface); §16.2 (rewritten as SQLite-deferred STOP-AND-ASK); §16.6 + §16.7 REMOVED; §17 G-IPC-2 (in-memory) + G-IPC-16 + G-IPC-19 (no-DB-file gates); §18 risk rows updated | **RESOLVED.** v1 backing reverted to contract-authorized in-memory. SQLite + userData + migrations + path policy ALL deferred to a later, separately-authorized WI with its own cc-suite review-plan + audit + verify chain. |
| H4 — Error envelope contradicts contract; leaks Error.message | H | §7.2 (`IpcErrorEnvelope` type matches contract §7 wire shape — `kind: "case_box_persistence_error"` + `code` + safe `message` + optional `details: {schemaPath, keyword}`); §9.2 (error code map rewritten — preserves `CaseBoxPersistenceErrorCode` as-is; no invented codes; unexpected → opaque `not_implemented`); §9.3 (opacity contract — main-side `console.error` log; renderer never sees raw Error.message); §17 G-IPC-4 (errorMap.ts acceptance); §18 risk M2 (opacity contract mitigation) | **RESOLVED.** Envelope follows contract verbatim. Unexpected errors are opaque to renderer + logged main-side for audit. |
| M1 — Missing TypeScript-AST renderer forbidden-import lint | M | §6.1 (new `scripts/check-renderer-imports.mjs` file); §12.1 (lint design — 5 import forms + forbidden module list); §17 G-IPC-8 (pretest wiring); G-IPC-17 (lint self-test); §18 risk M3 references the lint | **RESOLVED.** Lint script added; covers static / export-from / side-effect / dynamic / non-type imports of case-box-persistence, case-box-contract value imports, better-sqlite3, node:*, and forbidden internal paths. Wired into `pretest`. |
| M2 — DB-untouched gate could touch real user state | M | §13.4 (test now sets isolated temp `HOME`; pre/post snapshots); §15.2 (isolated-environment rule); §17 G-IPC-11 + G-IPC-16 + G-IPC-19 (gates use isolated temp root + working-tree no-DB-file scan) | **RESOLVED.** Packaged test runs under isolated `HOME` → temp `userData`. Pre/post snapshots assert no DB file in temp root OR repo working tree. Production `~/Library/Application Support/lawbar/` is NEVER touched by tests. |
| M3 — Audit-chain integrity gap in v1 scope | M | §4 (5-method scope cut; added `casebox:audit:chainHead`); §6.1 (handler enumeration adds chainHead); §7.1 + §7.2 (ChainHeadDto + channel); §11 (preload api adds `chainHead`); §13 unit tests cover chainHead; §17 G-IPC-1 + G-IPC-9 + G-IPC-11 + G-IPC-15 reference 5 channels | **RESOLVED.** Added `casebox:audit:chainHead` as the 5th v1 method per reviewer's preferred path. Read-only; small; materially improves boundary proof. |
| M4 — Runtime input validation underspecified | M | §9.1 (validation pipeline restated — shape guard rejects no-prototype/symbols/functions/non-JSON; forbidden-field scan; list-query bounds with limit cap 200 + cursor opacity ≤512); §17 G-IPC-9 (unit tests cover shape-guard sub-cases); §18 risk L1 references shape-guard | **RESOLVED.** Pipeline restated exactly per contract §6 + §12 with explicit sub-cases for shape guard + list-query bounds. |

**Reviewer bonus guidance applied (rev-0.1)**:

- §16.9 `sandbox: false` posture explicitly accepted (was buried).
- §16.10 cross-arch packaged-test deferral explicitly recorded.
- §16.11 dummy-data diff-scan gate added (`check-no-real-data.mjs` + pretest wiring + G-IPC-18 self-test).

### rev-0.2 dispositions (from `review-plan-mpnhj20a-6yj24u`)

Reviewer flagged that rev-0.1's §25 disposition claims were ahead of the body wording. rev-0.2 closes the body-vs-claim gaps. Mapping each finding to the exact section now edited:

| Finding | Severity | Sections changed (rev-0.2) | Disposition |
|---|---|---|---|
| F1 — H2 not actually resolved (DTO mismatch contract/schema) | H | §7.2 (CreateMatterDto rewritten directly from contract §6.0: required `name`/`matter_type`/`jurisdiction`/`parties[{role,display_name,party_kind,notes?}]`/`confidentiality_class`; optional `retainer_scope`/`case_type_text`/`case_progress_text`/`court_contact_text`/`contention_summary_text`; non-schema `progress_text` REMOVED; `ArchiveMatterDto.reason` made REQUIRED + main injects `actor_user_id` on archive); §7.3 closing line restates archive op behavior; §22 review packet restates DTO field list | **RESOLVED.** DTO now matches contract §6.0 exactly. `progress_text` no longer used. `parties[].notes?` added. `retainer_scope` + `contention_summary_text` added. Archive op `reason` required; `actor_user_id` server-injected on archive. |
| F2 — H4 not actually resolved (invented codes; `code` typed as string) | H | §7.2 `IpcErrorEnvelope.code` typed as `CaseBoxPersistenceErrorCode` (rev-0.2 F2; was rev-0.1 `string`); §9.1 step-by-step now maps every IPC-layer validation failure to `invalid_payload` (rev-0.1 invented codes `invalid_shape` / `forbidden_input_field` / `schema_violation` REMOVED from the wire); §9.2 error-code map rewritten so every row uses one of the 11 contract codes plus `not_implemented`; §7.3 archive narrative aligned; §22 review packet restates the discriminator policy; G-IPC-4 + §18 risk-L1 row updated to drop the invented codes | **RESOLVED.** Wire `code` is now strictly `CaseBoxPersistenceErrorCode`. No invented discriminator values anywhere in the plan body. |
| F3 — H3 only partially resolved (stale openSqlite + migration mentions) | H | §3 topology table "Schema migration concerns" row rewritten to "NOT APPLICABLE in v1; deferred per §15.5"; §13.5 end-to-end summary now says `InMemoryCaseBoxPersistence` (was `openSqliteCaseBoxPersistence`); §6.2 + §22 explicit deferral restatement; §13.4 narrative rewritten to clarify backing | **RESOLVED.** No active section now describes SQLite/openSqlite/migration as part of v1 IPC test or impl surface. All SQLite references in the plan body are framed as deferred future WI material per §15.5. |
| F4 — M3 not cleanly resolved (4-method drift) | M | §5 SUPERSEDED banner content updated (5 methods); §6.1 caseBoxHandlers.ts narrative (5 ipcMain.handle); §6.1 dto.ts narrative (5 DTOs incl. `ChainHeadDto`); §6.1 unit-tests narrative (5 channels); §6.1 packaged-test narrative (5 channels); §6.2 main.ts narrative (5 handlers) + preload.mts narrative (5 methods); §13.1 unit-test channels enumerated; §22 review packet "5 v1 methods" (was "4"); §22 out-of-scope "5 v1 methods" (was "4"); §22 acceptance-criteria pointer "G-IPC-1 through G-IPC-24" (was "G-IPC-20") | **RESOLVED.** Every active and banner section says 5 methods. No "4-method/handler/channel" drift remains in the plan body. |
| F5 — M1 incomplete (lint forbidden list short of contract §9) | M | §12.1 rewritten with the full contract-§9 forbidden table: `electron`, bare Node builtins `fs`/`path`/`os`/`child_process`, `node:*`, `better-sqlite3` + `better-sqlite3-multiple-ciphers`, `case-box-persistence` + sub-paths, `case-box-contract` (value imports only), `services/ocr-*`, internal `apps/lawbar-desktop/src/caseBox/**` + `electron/**`, `services/case-box-persistence/src/**`; G-IPC-17 self-test fixture enumeration expanded; pretest chain extended (`npm run lint:renderer-imports && npm run check:no-real-data`) | **RESOLVED.** Lint forbidden list now mirrors contract §9 entry-for-entry; self-test fixture covers representative package + relative/internal path variants across all 5 import forms. |
| F6 — M2 patterns incomplete (no-DB scan globs short) | M | §15.2 expanded glob set (`*.db` / `*.sqlite` / `*.sqlite3` / `*.db-wal` / `*.db-shm` / `case-box.db*`); §13.4 step 3 pre-launch snapshot + step 9 post-suite snapshot use the expanded set across BOTH the isolated temp `userData` root AND the repo working tree; G-IPC-11 + G-IPC-16 + G-IPC-19 updated with the same glob set + explicit pre/post diff semantics | **RESOLVED.** No-DB-file gates now scan the full pattern set in BOTH directions (temp root + working tree) with explicit pre/post snapshots. `LAWBAR_CASEBOX_DB_PATH` semantics ("no env override exists in v1") restated. |

**Reviewer bonus guidance applied (rev-0.2)**:

- §22 review packet now says `G-IPC-1 through G-IPC-24` (was stale `G-IPC-1 through G-IPC-20` in rev-0.1).
- §15.3 dummy-data discipline rewritten as heuristic + diff-scan + audit gate (rev-0.2 — no longer claims to prevent "ANY" real data in the absolute sense).
- §1 out-of-scope "v1 scope cut is 5 channels" (was "4 methods").
- §22 out-of-scope "5 v1 methods" (was "4").

### rev-0.1 dispositions (history; superseded where rev-0.2 reverified)

Maps each finding from `review-plan-mpmtyoyh-97zt15` (NEEDS-FIX; 4 H + 4 M) to the exact plan sections changed in rev-0.1:

**Diff scope (rev-0.1 vs rev-0)**:

- Top Status line (rev-0.1 banner).
- §1 Out of scope: real-data row updated (in-memory, no DB).
- §3 topology-shift table: production-binary impact row reframed.
- §4 v1 scope: 4 → 5 methods; channel names corrected to `casebox:<scope>:<op>`.
- §7 rewritten: channels + DTO + server-authority injection + ChainHeadDto + IpcErrorEnvelope per contract wire shape.
- §8 rewritten: in-memory CaseBoxRuntime; no SQLite; explicit out-of-v1 list.
- §9 rewritten: 6-step pipeline (shape guard / forbidden-field / list-query bounds / schema / persistence / wrap); 7-row error map preserving CaseBoxPersistenceErrorCode + opaque unexpected; opacity contract.
- §11 preload api updated for channel names + chainHead.
- §12 + §12.1: TypeScript-AST lint design.
- §13.4 packaged test: isolated temp HOME; 5 channels; pre/post snapshots; no LAWBAR_CASEBOX_DB_PATH.
- §15 fully rewritten: 5-rule no-DB-file / isolated-env / in-memory-only / boundary-only / SQLite-deferred ruleset; diff-scan gate.
- §16 substructure: §16.2 reframed; §16.6 + §16.7 REMOVED; §16.9 / §16.10 / §16.11 added.
- §17 G-IPC-1 through G-IPC-24 (rev-0.1 expanded from 20).
- §18 risks rewritten — DB-related rows removed; sandbox + cross-arch added.
- §22 review packet rewritten.
- §22 review questions updated.
- §25 (this disposition table) appended.

**Diff scope (rev-0.2 vs rev-0.1)**:

- Top Status line (rev-0.2 banner + cite of `review-plan-mpnhj20a-6yj24u`).
- §1 out-of-scope row "v1 scope cut is 5 channels" (was "4 methods").
- §3 topology table "Schema migration concerns" row rewritten (no SQLite mention as v1).
- §5 SUPERSEDED-banner content updated to 5 methods + in-memory backing.
- §6.1 file enumeration: 5 ipcMain.handle / 5 DTOs / 5 unit-test channels / 5 packaged-test channels; pretest chain extended.
- §6.2 main.ts narrative (5 handlers) + preload.mts narrative (5 methods + plain-object envelope).
- §7.2 DTO rewritten directly from contract §6.0: `parties[].notes?`, `retainer_scope?`, `case_progress_text?` (replacing non-schema `progress_text`), `contention_summary_text?`, `ArchiveMatterDto.reason` REQUIRED, main injects actor_user_id on archive.
- §7.2 `IpcErrorEnvelope.code: CaseBoxPersistenceErrorCode` (was `string`); imports `CaseBoxPersistenceErrorCode` from `case-box-persistence`.
- §7.3 archive op narrative addition.
- §9.1 step prose: validation failures all map to `invalid_payload`; rev-0.1 invented strings REMOVED.
- §9.2 error-code map rewritten to use only contract §7 stable codes + `not_implemented`.
- §12.1 lint forbidden list expanded to contract §9 (electron / bare fs/path/os/child_process / node:* / better-sqlite3 + multiple-ciphers / case-box-* / services/ocr-* / internal main-side relative paths / services/case-box-persistence/src/**); pretest chain restated.
- §13.1 unit-test sub-cases enumerated with contract-shape codes + 5 channels.
- §13.4 packaged-test backing restated as `InMemoryCaseBoxPersistence`; expanded no-DB glob set in pre/post snapshots.
- §13.5 end-to-end summary backing line corrected to `InMemoryCaseBoxPersistence`.
- §15.2 expanded no-DB glob set + explicit pre/post diff semantics.
- §15.3 dummy-data discipline rewritten (heuristic + diff-scan + audit gate; no "ANY"-claim).
- G-IPC-4 wording updated to contract-shape codes.
- G-IPC-11 + G-IPC-16 + G-IPC-19 patterns expanded.
- §18 risk-L1 row updated to drop invented codes.
- §22 review packet rewritten as rev-0.2 (5 methods explicit; G-IPC-1..24; contract-§9 lint forbidden list; expanded no-DB glob set; dummy-data heuristic framing).
- §22 out-of-scope updated ("5 v1 methods"; SQLite deferral restated).
- §25 disposition table re-aligned (rev-0.2 dispositions added; rev-0.1 dispositions marked superseded-where-reverified; bonus drift fixes).

**Diff scope (rev-0.1 vs rev-0)**:

(Retained from rev-0.1; see history block above and the rev-0.1 disposition rows below.)

### Diff scope (rev-0.3 vs rev-0.2)

- Top Status line (rev-0.3 banner + cite of `review-plan-mpnj8tsr-nujf3z`).
- §17 G-IPC-8 pretest chain extended to `npm run build && npm run lint:renderer-imports && npm run check:no-real-data`.
- §17 G-IPC-16 scan scope expanded to BOTH isolated temp `userData` root AND repo working tree (pre/post diff across both).
- §17 G-IPC-19 scope changed from `find apps/lawbar-desktop …` to repo-root `find . …` with `-prune` exclusions for known generated/dependency dirs.
- §25 disposition table extended with rev-0.3 row + new prior-review entry for `review-plan-mpnj8tsr-nujf3z`.

### Re-review request (rev-0.3)

`/cc-suite:review-plan dev-memo/plan-casebox-ipc-impl-01.md` against rev-0.3 to confirm M-1 (G-IPC-8 pretest chain) + M-2 (G-IPC-16/G-IPC-19 scan scope) are both resolved + no new C/H/M findings + no regression of prior rev-0.1 / rev-0.2 fixes (H1 / H2 / H3 / H4 / M1 / M2 / M3 / M4 / F1-F6 + bonus drift).
