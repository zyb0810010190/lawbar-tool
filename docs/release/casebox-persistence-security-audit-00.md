# Case-Box Persistence Security-Boundary Audit — 00

**WI:** `WI-GATE10-CASEBOX-PERSISTENCE-SECURITY-BOUNDARY-AUDIT-00` (Type: EVIDENCE, read-only).
**M0 go-live gate:** gate 10 (`docs/release/go-live-readiness-report.md` §1 gate 10 = OPEN — this is the audit).
**Date:** 2026-07-04. **Branch:** `gate10-casebox-security-audit` (from `main` @ `3dc9808`).
**Nature:** read-only security-boundary audit. NO code / schema / contract / dependency change; NO go-live GO/NO-GO decision.
**Result:** **Gate 10 NOT CLEARED** — 2 Medium defense-in-depth findings escalated as blockers-to-clearance; a bounded follow-up security WI is PROPOSED for separate user authorization (not self-authorized, not executed in this lane).

---

## 1. Scope — exact files reviewed (READ-ONLY)

**Persistence — `services/case-box-persistence/src/`:**
`resolveTarget.ts`, `auditChain.ts`, `errors.ts`, `types.ts`, `inMemoryMatter.ts`, `inMemoryEvidence.ts`, `inMemoryDocument.ts`, `inMemoryRepo.ts`, `cursor.ts`; and `sqlite/`: `matterRepoQueries.ts`, `documentRepoQueries.ts`, `evidenceRepoQueries.ts`, `auditRepoQueries.ts`, `linkRepoQueries.ts`, `linkStatusResolverQueries.ts`, `exportCitationQueries.ts`, `sqliteBackedIdSet.ts`, `aggregationsRepoQueries.ts`, `docketRepoQueries.ts`, `factsRepoQueries.ts`, `privilegeRepoQueries.ts`, `classificationRepoQueries.ts`, `ocrLinkRepoQueries.ts`, `deadlineRepoQueries.ts`, `anchorDeleteGuardQueries.ts`, `schema.ts`, `SqliteCaseBoxPersistence.ts`, `openSqliteCaseBoxPersistence.ts`. (`linkStatusResolverQueries.ts` + `exportCitationQueries.ts` are the standalone raw-SQLite readers reached through the desktop link boundary at `linkHandlers.ts:45` via `resolveLinkStatuses` / `buildExportCitations`; both scope by tenant + matter — `linkStatusResolverQueries.ts:142-159`, `exportCitationQueries.ts:130-149` — and surfaced no additional finding.)

**Desktop boundary — `apps/lawbar-desktop/`:**
`src/caseBox/`: `handlerShared.ts`, `errorMap.ts`, `matterHandlers.ts`, `documentHandlers.ts`, `factHandlers.ts`, `docketHandlers.ts`, `auditHandlers.ts`, `deadlineHandlers.ts`, `linkHandlers.ts`, `t3Handlers.ts`, `t3ExportHandlers.ts`, `t3CatalogSource.ts`, `caseBoxRuntime.ts`, `handlers.ts`, `dto/*.ts`; `src/security/activeTenant.ts`, `src/security/activeActor.ts`; `electron/ipc/caseBoxHandlers.ts` + the `electron/main.ts` `getCaseBoxRuntime()` → `registerCaseBoxIpcHandlers()` registration slice.

**Tests:** `services/case-box-persistence/tests/` (conformance/, `hardening-*.test.mjs`, `impl-parity-*.test.mjs`, `tenant-filter-lists.test.mjs`, `invariants.test.mjs`); `apps/lawbar-desktop/tests/ipc-casebox-handlers.unit.test.mjs`, `renderer-dto-sync.test.mjs`.

## 2. Audit command / job metadata (cc-suite 11-field recording)

| Field | Value |
|---|---|
| Kind | `audit` (security persona, adversarial "try to refute") |
| Target scope | the §1 file set (case-box persistence boundary + desktop server-authority reach) |
| Invocation path | Path 1 — plugin runner `codex-runner.mjs`, foreground |
| Resolved runner | `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs` |
| Model / effort / sandbox / approval | `gpt-5.5` / `high` / `read-only` / runner default |
| Job ID | `audit-mr6eouaf-p0k7yg` |
| Codex threadId | (captured in job state) |
| Output location | `${CLAUDE_PLUGIN_DATA}/state/lawbar-tool-8153f46e0d61e5fb/jobs/audit-mr6eouaf-p0k7yg.json` |
| rawOutput SHA256 | `e995a91a9551a759f9f0e2fe759b53fb5a47d2f22d424dfff6e46eb67bf1a1d9` |
| `/cc-suite:status` / `:result` retrievable | YES (envelope `status:"completed"`) |
| Failure class / retry | none — completed first attempt, no timeout |

The audit was cross-checked against a first-hand read of the boundary-enforcement files (recorded inline below); the broker's file:line citations were independently verified before classification.

## 3. Boundary invariants checked

| # | Invariant | Verdict |
|---|---|---|
| 1 | Tenant/matter scoping — every read/write scoped by tenant_id (+ matter_id); mismatch enforced before cross-scope read | **PARTIAL** (see M-1, M-2) |
| 2 | IPC / server-authority boundary — renderer never supplies tenant_id/actor_user_id (main injects); forbidden-field rejection; response allowlist strips server-authority fields | **PASS** |
| 3 | SQLite access — parameterized (no injection); payload_json canonical; no read-layer re-sort; no queue→ocr_jobs FK | **PASS** (parameterization/canonical/FK); scope predicate gap tracked under M-1 |
| 4 | Error projection — raw messages never reach renderer; static safe message per stable code | **PASS** |
| 5 | Test coverage — conformance/hardening/IPC suites exercise tenant/matter isolation + forbidden-field + projection | **PARTIAL** (see L-1) |

## 4. Findings

### Invariant 2 — IPC / server-authority boundary: PASS

- **Server injects authority, renderer cannot supply it.** `activeTenant.ts` / `activeActor.ts` expose only getters (`getActiveTenantId()` → `"default-tenant"`, `getActiveActorUserId()` → `"local-user"`); the setters are `_*ForTesting`. Handlers inject these into the full row (`matterHandlers.ts:57-58`, `factHandlers.ts:193`, `docketHandlers.ts:110`) — the payload's copy is never trusted.
- **Forbidden-field rejection.** Every create/mutate handler rejects a payload carrying a server-authority key before any persistence call (`matterHandlers.ts:49-53`; `CREATE_MATTER_FORBIDDEN_FIELDS` incl. `id`, `tenant_id`, `actor_user_id`, `custody_chain`, opt-in flags, `litigation_position` — `dto/matter.ts:63-76`), returning `invalid_payload` via `forbiddenFieldFailure` (`handlerShared.ts:86`). Unknown-field DTO allowlists close the complement (`matterHandlers.ts:106-113`).
- **Response projection strips authority fields.** `projectRow` / `projectPage` (`handlerShared.ts:108-131`) copy only allowlisted keys; `MATTER_RESPONSE_FIELDS` (`dto/matter.ts:128-143`) EXCLUDES `tenant_id`/`actor_user_id`; the same pattern in `documentHandlers.ts:187`, `docketHandlers.ts:306`, `linkHandlers.ts:260`. `getMatter`/`archiveMatter` re-check `value.tenant_id === getActiveTenantId()` (defense-in-depth) BEFORE projecting (`matterHandlers.ts:125-129, 236-238`).
- **DoS bounds.** `MAX_LIST_LIMIT` 200, `MAX_CURSOR_LENGTH` 512 (`dto/shared.ts:20-22`); the T3 drain caps repeated cursors + `MAX_EVIDENCE_PAGES` (`t3CatalogSource.ts:133-172`) → error, never a truncated model.

### Invariant 3 — SQLite access: PASS (injection / canonical / FK)

- **No SQL injection.** All 122 `db.prepare(...)` calls bind values via `?` / named params. The only `${...}` interpolations inside SQL are CONSTANT clause fragments (`whereParts.join(" AND ")` where each part is a literal like `"tenant_id = ?"` / `"matter_id = ?"` / `"status = ?"`, values pushed to a params array — e.g. `documentRepoQueries.ts:129-137`, `evidenceRepoQueries.ts:335-357`) or an identifier validated against `/^[a-z_][a-z0-9_]*$/i` (`sqliteBackedIdSet.ts:23`) / passed as a code literal (`existsScoped(db, "case_box_anchors", …)` `linkRepoQueries.ts:211,219`; `new SqliteBackedIdSet(db, "case_box_facts")` etc.). No string concatenation builds SQL.
- **payload_json canonical.** Rows persist `JSON.stringify(entity)` as the source of truth (`matterRepoQueries.ts:14-27`); lifted columns are for indexing/seek-pagination only; list reads return `JSON.parse(payload_json)` (`evidenceRepoQueries.ts:373`). No read-layer re-sort masks a persistence ordering bug — `ORDER BY` mirrors the in-memory direction exactly (`documentRepoQueries.ts:134`, `evidenceRepoQueries.ts:355`).
- **No queue→ocr_jobs FK.** The case-box schema has no queue table; OCR state is stored by value (`schema.ts`), preserving the queue/persistence split invariant.

### Invariant 4 — Error projection: PASS

- Renderer receives only the static `SAFE_MESSAGES[code]` string; raw `err.message` (which may carry identifiers, tenant values, SQL param values) is logged main-side and NEVER crossed to the renderer (`errorMap.ts:13-26, 47-64`). Unknown non-`CaseBoxPersistenceError` throws map to a generic `"internal error (see main log)"`. Error codes are the stable enumerated set (`errors.ts`).

### Invariant 1 — Tenant/matter scoping: PARTIAL

The write boundary is airtight; two read/mutation paths at the persistence layer are tenant-scoped only *transitively* (via the matter), not directly in SQL. In v1 (single-tenant, `default-tenant`) these are not exploitable; as **defense-in-depth for a future multi-tenant runtime** they are gaps.

#### M-1 (Medium) — child-entity list reads carry no row-level `tenant_id` predicate (matter-tenant preflight IS present)

Several SQLite list/history reads run a matter-tenant preflight (`requireMatterTenant(db, query.matter_id, query.tenant_id)`, which throws `tenant_mismatch` when the matter is not owned by the caller's tenant) and THEN filter the child rows by `matter_id` alone — the child-row SELECT itself does NOT include the row's own `tenant_id` column in the WHERE clause:

- `listEvidenceItemsSqlite` — preflight `evidenceRepoQueries.ts:309`; child SELECT `whereParts = ["matter_id = ?"]` `:336`.
- `listDocketEntriesSqlite` — preflight `docketRepoQueries.ts:441`; child SELECT `:463`.
- `listAuditEventsSqlite` — matter-tenant check precedes the `matter_id = ?` select (`auditRepoQueries.ts:64-80`).
- `getEffectiveClassificationSqlite` / `listConfidentialityClassificationsSqlite` (`classificationRepoQueries.ts:261, 315`), `getPrivilegeStatusSqlite` / `listPrivilegeMarkersSqlite` (`privilegeRepoQueries.ts:291, 337`), `listOcrLinksSqlite` (`ocrLinkRepoQueries.ts:296`) — same shape (matter guard + `matter_id`-only child predicate).

**Corrected failure mode (narrower than a caller-supplied foreign `matter_id`):** because the preflight IS in the persistence read path, a caller supplying a foreign `matter_id` is REJECTED by `requireMatterTenant` — this is NOT bypassable by id-guessing. The residual gap is strictly belt-and-suspenders: the child SELECT trusts the write-time invariant `child.tenant_id === matter.tenant_id` (enforced at insert — `evidenceRepoQueries.ts:216-222`, `docketRepoQueries.ts:297`, `factsRepoQueries.ts:237`) rather than re-asserting it in the read. An inconsistent (wrong-tenant) child row could therefore surface ONLY if that write-time invariant were violated or the DB were directly corrupted/mutated out-of-band — not through the IPC/handler path. In v1 (single-tenant `default-tenant`) it is doubly moot. Classified Medium as forward-multi-tenant defense-in-depth (the schema retains `tenant_id` precisely for that future); a reviewer could reasonably call it Low given the preflight.

#### M-2 (Medium) — id-addressed mutations resolve the target row by global `id`; the `UPDATE` carries no row-level `tenant_id` predicate

Confirm/transition/dismiss/unlink resolve the target row by global `id` and issue `UPDATE … WHERE id = ?`:

- `factsRepoQueries.ts:117` resolves `factId` via `SELECT matter_id … WHERE id = ?`; `updateFactRow` is `WHERE id = ?` (`:176`).
- `deadlineRepoQueries.ts:79` (resolve by id) / `:106` (`UPDATE … WHERE id = ?`).
- `docketRepoQueries.ts:120` (confirm/dismiss resolve by id).
- `linkRepoQueries.ts:99` (load by id) / `:114` (`UPDATE … WHERE id = ?`).

**Compensating controls:** tenant ownership IS enforced, but transitively — the desktop mutation handlers tenant-check the matter before calling persistence (`factHandlers.ts:115, 190, 289`), and the persistence write wrappers assert `child.tenant_id === matter.tenant_id` (`factsRepoQueries.ts:227` + `requireMatterTenant` `:56-70`). ids are ULIDs; v1 is single-tenant. Residual gap: the `UPDATE` targets the row by `id` alone rather than an `id + tenant_id (+ matter_id)` predicate, so the row-level tenant scope is asserted by the surrounding resolve/preflight rather than atomically in the mutating statement — a forward-multi-tenant defense-in-depth hardening item, not a v1-reachable cross-tenant mutation.

#### L-1 (Low) — tenant-mismatch regression tests cover only facts + deadlines

`tenant-filter-lists.test.mjs` explicitly exercises the row-level tenant-mismatch guard for `listFacts` (`:43`) and `listDeadlines` (`:127`) but not the analogous docket / evidence / classification / privilege / ocr-link / audit list+history paths named in M-1. IPC-side coverage is present (forbidden-field rejection + response projection: `ipc-casebox-handlers.unit.test.mjs:124, 208`; `renderer-dto-sync.test.mjs:144`).

## 5. Finding table

| ID | Severity | Invariant | Summary | v1 exploitable? |
|---|---|---|---|---|
| M-1 | Medium | 1 / 3 | Child-entity list/history reads run a matter-tenant preflight (`requireMatterTenant`) but the child-row SELECT lacks a row-level `tenant_id` predicate — belt-and-suspenders gap | No (matter-tenant preflight closes foreign-`matter_id`; only a write-invariant violation / direct DB corruption could surface a wrong-tenant row) |
| M-2 | Medium | 1 | Id-addressed mutations (facts/deadline/docket/link confirm/transition/dismiss/unlink) `UPDATE … WHERE id = ?` — tenant asserted by resolve/preflight, not in the mutating statement | No (desktop preflight + write-time tenant==matter invariant; single-tenant v1) |
| L-1 | Low | 5 | Row-level tenant-mismatch tests cover only facts/deadlines, not the M-1 read paths | n/a (test-completeness) |

**FINDINGS: C0 H0 M2 L1.**

## 6. Escalation + proposed follow-up security WI (NOT self-authorized)

Per `.claude/rules/cc-suite.md` §"Audit remediation policy" (Medium+ are fixed-or-escalated, never silently deferred) and `.claude/rules/security-boundary.md` §"Required loop", M-1 and M-2 are ESCALATED as blockers to gate-10 clearance. They are NOT fixed in this read-only lane. The following bounded follow-up is PROPOSED for **separate user authorization** — it is a suggestion, not a queued/executed item:

> **WI-SEC-CASEBOX-TENANT-SCOPING-DEFENSE-00** (proposed; Type: security IMPL; HIGH-RISK — persistence + tenant isolation):
> Add `tenant_id` to the WHERE clause of the M-1 child-entity list/history reads, and add tenant/matter scoping to the M-2 id-addressed mutation resolvers, preserving the existing write-time `child.tenant == matter.tenant` invariant and the stable `CaseBoxPersistenceError` code surface (no code rename/removal). Extend `tenant-filter-lists.test.mjs` to cover every list/mutation path in M-1/M-2 (closes L-1). Full security-WI loop: `/cc-suite:review-plan` → tests-first (regression proving cross-tenant/cross-matter rows are excluded) → minimal implement → `/cc-suite:audit` → `/cc-suite:verify` → sign-off append here. No schema/DDL change (`CURRENT_SCHEMA_VERSION` stays 12); no contract change; no dependency.

Because M-2 touches the OcrQueueError/CaseBoxPersistenceError-adjacent surface only by adding predicates (not renaming/removing codes), no ADR is required for the proposed scope; if the follow-up WI finds it must change an error code or thrown shape, that requires an ADR + explicit approval per `.claude/rules/security-boundary.md` §"No silent surface changes".

## 7. Conclusion

The **IPC / server-authority boundary, SQLite parameterization + payload-json canonicality + FK-split, and error projection are SECURE** (invariants 2, 3-injection, 4 PASS), and the WRITE-side tenant/matter enforcement is airtight. Two **Medium defense-in-depth findings** (M-1, M-2) show the persistence layer's child-entity reads and id-addressed mutations are tenant-scoped only transitively (via the matter + write-time invariant + desktop preflight), not directly in SQL — not exploitable in the v1 single-tenant local-first model, but a hardening gap for any future multi-tenant runtime. One Low (L-1) test-coverage gap accompanies them.

**Gate 10 is NOT CLEARED.** Clearance is blocked on the two Mediums, to be resolved by the proposed **WI-SEC-CASEBOX-TENANT-SCOPING-DEFENSE-00** (user-authorized, separate security-WI loop). Per `.claude/rules/security-boundary.md` §"Go-live independence", clearing gate 10 would in any case NOT imply go-live readiness — the final GO/NO-GO verdict and the three STOP-AND-ASK hard-stops (framework/public-distribution/signing; 律师法 confidentiality compliance; final sign-off) remain the user's.

---

## 8. Sign-off — M-1 / M-2 / L-1 FIXED (WI-SEC-CASEBOX-TENANT-SCOPING-DEFENSE-00)

**Date:** 2026-07-04. **Fix WI:** `WI-SEC-CASEBOX-TENANT-SCOPING-DEFENSE-00` (Type: IMPL, security-boundary HIGH-RISK, user-authorized). **Branch:** `sec-casebox-tenant-scoping-defense`. Predicate-only; NO schema/DDL (`CURRENT_SCHEMA_VERSION` stays 12), NO contract/dependency/native/renderer change, NO error-code rename.

**What shipped:**
- **M-1 → FIXED (caller-tenant enforcement).** A row-level `tenant_id = ?` predicate (binding `query.tenant_id`) was added to the child-row SELECT of all 8 flagged SQLite reads (`listEvidenceItemsSqlite`, `listDocketEntriesSqlite`, `listAuditEventsSqlite`, `getEffectiveClassificationSqlite`, `listConfidentialityClassificationsSqlite`, `getPrivilegeStatusSqlite`, `listPrivilegeMarkersSqlite`, `listOcrLinksSqlite`), keeping the existing `requireMatterTenant` preflight (belt-and-suspenders). A cross-tenant row is now excluded at the SQL layer, not only by the matter preflight.
- **M-2 → FIXED (atomic-consistency hardening, not caller-rejection).** All 7 child-entity mutation UPDATEs (`updateFactRow`, `updateDeadlineRow`, `updateDocketEntryRow`, `updateDocketEntryEditRow`, `updateEvidenceItemRow`, `updateLinkMarkerRow`, `updatePrivilegeMarkerRow`) are scoped `WHERE id = ? AND tenant_id = ? AND matter_id = ?` bound to the resolved row's own `tenant_id`+`matter_id`, and assert `RunResult.changes === 1` (throwing the stable existing `invalid_argument` code) BEFORE the audit-event write — so a scope-drift / lifted-column-vs-payload divergence makes the UPDATE match zero rows and RAISES rather than writing an audit event for an unmodified row. `updateMatterRow` intentionally excluded (tenant-owning parent). The by-id resolve loaders are unchanged (the mutation APIs carry no caller tenant); no API/signature change beyond the private `updateLinkMarkerRow` gaining `tenantId`/`matterId` params.
- **L-1 → FIXED.** `tenant-filter-lists.test.mjs` extended with 14 regressions (8 M-1 cross-tenant-exclusion + 6 M-2 scope-drift-raises), red-before/green-after. `updateLinkMarkerRow`'s guard is implemented but has no tamper test (its resolver reads tenant/matter from the same lifted columns, so column tampering also moves the bound value — the guard defends only an out-of-band concurrent change unreachable through the synchronous single-transaction API); this is documented inline.

**Verification.**
- `npm --prefix services/case-box-persistence test`: **PASS** (587 / 273 / 288, 0 fail; conformance + hardening + impl-parity + tenant-filter all green; `tenant-filter-lists.test.mjs` 17/17). In-memory source untouched (its reads already tenant-filter, so parity holds). `check-queue` PASS, `check-contract-integrity` PASS, `CURRENT_SCHEMA_VERSION` = 12.
- Broker security `/cc-suite:audit` (security persona, Path 1 runner 0.2.18): attempt 1 `audit-mr70anim-61n6u0` FAILED **TIMEOUT** (`spawnSync codex ETIMEDOUT`, high effort over the diff); retry `audit-mr71e737-lqz7sg` (medium effort, lean prompt) → **CLEAN, FINDINGS: C0 H0 M0 L0**, rawOutput sha256 `6899e13d5bc2612bbe9f055af1a050228718c09e1d8fc900ab7b180d6bfa56c7` (placeholder order correct, guard-before-audit-write, no injection, no same-tenant regression, no scope creep, preflight preserved). A CLEAN audit has no findings to close → `/cc-suite:verify` is vacuously ALL CLOSED (no fixes to confirm).

**Gate 10 status: CLEARED pending user go-live approval.** The two Medium defense-in-depth findings (M-1, M-2) and the Low (L-1) are resolved and independently audited CLEAN. Per `.claude/rules/security-boundary.md` §"Go-live independence", this does **NOT** imply go-live readiness — the final GO/NO-GO verdict and the three STOP-AND-ASK hard-stops (framework/public-distribution/signing; 律师法 confidentiality compliance; final sign-off) remain the user's.
