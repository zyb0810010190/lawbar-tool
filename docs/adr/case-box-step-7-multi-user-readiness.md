# ADR: Case-Box Step 7 — Multi-User Readiness

## Status

**Accepted** — 2026-05-20. Docs-only. Records the v1 actor-and-tenant posture and the conditions under which it ceases to be valid. Promotes the "Multi-user readiness summary" stub from `docs/adr/case-box-step-0-boundary.md` to its dedicated ADR per the Step-0 §"ADR series phasing" plan.

This ADR does NOT introduce or modify any code, schema, persistence behavior, API/gateway surface, UI, auth provider, cloud or sync mechanism, or external document exposure. It documents the contract-layer invariants already encoded by Steps 1–6 and the layered enforcement obligations that fall to future persistence / API / UI work items.

## Context

`docs/adr/case-box-step-0-boundary.md` §7 locked the v1 actor posture:

> v1 ships single-user. `actor_user_id = "local-user"` (per `case-box-plan.md` pre-Phase-0 acceptance) is the default.
> Every persistence record continues to carry `tenant_id`. v1 uses a single retained tenant id; data shape stays multi-user-ready for the future single-firm-multi-user phase.
> No auth provider is chosen.

The Step-1 contract package (`docs/contracts/case-box-contract/`) wired this into every persisted shape: `tenant_id` and `actor_user_id` are required on `CaseBoxMatter`, `CaseBoxDocument`, `CaseBoxDeadline`, `CaseBoxEvidenceItem`, `CaseBoxOcrLink`, `CaseBoxAuditEvent` (and the Step-2/3/4/5/6 follow-ups). Step 4's audit log carries `actor_user_id` on every event and is the provenance backbone the future auth layer will key against.

The v1 product surface — Mac desktop in-process embedding per `docs/adr/client-application-surface.md` — does not run an authentication challenge. The desktop process IS the lawyer; the OS is the trust boundary. This is acceptable while four preconditions all hold:

1. The workflow stays entirely local on one lawyer's Mac.
2. No sync bridge is enabled.
3. No LLM extractor with remote calls is enabled.
4. No multi-user write path exists.

The moment any of those preconditions changes (sync bridge ships per `docs/adr/sync-bridge-architecture.md`, single-firm-multi-user lands, WeChat mini-program ships, or remote LLM is enabled per the forthcoming case-box-step-8 ADR), the `"local-user"` sentinel becomes a confidentiality and accountability hazard — a real principal must be threaded through every write.

This ADR fixes the rules so that future implementation WIs can recognize and obey them without re-deriving the posture.

## Decision

Adopt the following multi-user-readiness invariants as authoritative for v1. None of them introduces enforcement at the contract layer (the contract is shape-only); each names the layer that must enforce it when that layer ships.

### 1. v1 actor sentinel

The constant string value `"local-user"` is the v1 actor sentinel. It is recognized by `LOCAL_ONLY_ACTOR_USER_ID` and `isLocalOnlyActor()` in `case-box-contract`. The contract layer does not pin the value (the schema accepts any non-empty string) precisely so the shape remains multi-user-compatible; the sentinel value is a runtime convention.

The sentinel is valid **only** when ALL of the following hold:

- The workflow runs entirely in the Mac desktop process (no sync bridge listener, no inbound HTTP).
- No external OCR worker has been authorized for any document.
- No remote LLM extractor is enabled (future case-box-step-8 deferred).
- No multi-user phase is active (single-firm-multi-user not yet enabled).

When ANY of those preconditions changes, the persistence layer MUST refuse new writes carrying `actor_user_id === "local-user"` and the IPC / sync / API layers (whichever is the relevant entrypoint) MUST resolve a real principal before invoking persistence. Refusal at the persistence layer is the load-bearing gate; everything above it is defense-in-depth.

### 2. `tenant_id` retained on every persisted shape

Every Step-1 entity carries `tenant_id` as a required field. v1 uses a single retained tenant id; multi-tenant queries and cross-tenant scoping are out of v1 scope. The field is present so the future single-firm-multi-user phase can populate distinct tenants without a v1 data-shape migration; multi-firm SaaS remains explicitly NOT v1 per Step 0.

The contract does not enforce `tenant_id` matching across cross-entity references. That enforcement falls to the persistence and read-model layers when they ship.

### 3. Auth provider deferred — Stop-and-Ask

This ADR does NOT choose an auth provider. The provider Stop-and-Ask gate from `AGENTS.md` and `docs/release/go-live-plan.md` remains open. The case-box data shape is forward-compatible (`tenant_id` + `actor_user_id` on every row) so whichever provider lands later — custom JWT, WeChat session, IdP integration, or single-firm SSO via SAML/OIDC — can populate the existing fields without schema migration. The provider choice opens when the first of these lands:

- The sync bridge (`docs/adr/sync-bridge-architecture.md` SYNC-01+).
- The single-firm multi-user phase.
- The WeChat mini-program client.
- Any remote LLM extractor with authenticated remote calls.

Whichever of those triggers the provider choice, the choice ITSELF must come via explicit user authorization per `AGENTS.md` Stop-and-Ask. No autonomous WI may pre-commit a provider.

### 4. Single-firm multi-user is future work

Single-firm multi-user (multiple lawyer / paralegal users inside one firm, one shared case box) is a recognized future phase. v1 does NOT ship it. The data shape (`actor_user_id` per row, `tenant_id` per row, audit events keyed by actor) is forward-compatible. The future WI must:

- Choose an auth provider (Stop-and-Ask, per §3).
- Define a role / permission model. This ADR does NOT design one. Roles are deliberately not modeled in the v1 contract — modeling them prematurely would freeze a guess against use cases that are not yet observed.
- Threading the resolved principal through every persistence write replaces `"local-user"` as a side effect.
- Add a multi-actor concurrency model (lawyer + paralegal writing the same record). Conflict resolution is deferred to that WI.

### 5. Multi-firm SaaS is NOT v1

Multi-firm SaaS (cross-tenant queries, per-tenant configuration, per-tenant billing, public sign-up) is explicitly NOT a v1 path. The `tenant_id` field exists for forward compatibility, not for SaaS readiness. Treating v1 as a SaaS substrate would violate `docs/adr/client-application-surface.md` (Mac desktop primary, local-first) and `docs/adr/sync-bridge-architecture.md` (opt-in narrow companion bridge, not a public API).

### 6. No authorization model in this ADR

This ADR does NOT define:

- Roles (e.g. `partner`, `associate`, `paralegal`, `client`).
- Permissions (e.g. `case.create`, `document.export`, `privilege.waive`).
- Access control lists per document or per matter.
- Approval chains for privilege waivers or external transmissions.
- Group memberships across matters.

Any of these is a separate ADR when the relevant layer (single-firm-multi-user or sync bridge) actually requires it. Authoring them now would be premature.

### 7. No runtime enforcement claim

The case-box contract package (`docs/contracts/case-box-contract/`) is shape-only. It validates that `actor_user_id` and `tenant_id` are present as non-empty strings; it does NOT validate that the value is a real principal, that the principal has rights to write the entity, or that the tenant matches the caller's authorized tenants. Those checks live at the persistence / API / UI / sync-bridge layers when they ship. The contract layer's job here is to keep the shape forward-compatible — nothing more.

### 8. Sync / mini-program / multi-device paths MUST NOT use the local-user sentinel

When any of the following lands, the relevant entrypoint MUST resolve a real `actor_user_id` BEFORE invoking case-box persistence:

- The sync bridge (`docs/adr/sync-bridge-architecture.md`). Every inbound bridge request resolves to a principal via the bridge's auth seam; the bridge MUST NOT pass `"local-user"` through to persistence.
- The WeChat mini-program (post-SYNC-05). The mini-program client authenticates against the bridge; the bridge's resolved principal is the only acceptable `actor_user_id`.
- A future browser SPA. Same constraint as mini-program.
- A future remote LLM extractor (case-box-step-8 deferred). LLM-extracted facts MUST carry the principal of the lawyer who opted-in for that case, NOT a synthetic `"local-user"` or `"llm-bot"`.

The persistence layer enforces this gate; the bridge / IPC / extractor layers cooperate. The contract layer surfaces `isLocalOnlyActor()` so callers can detect and reject the sentinel programmatically.

## Persistence obligations recorded

For the future persistence + API + UI work items (not authorized here):

1. **Refuse `"local-user"` writes once any precondition lifts.** When any of {sync bridge enabled, external OCR authorized for any doc, remote LLM enabled, multi-user phase active} becomes true, every new write carrying `actor_user_id === "local-user"` MUST be rejected at the persistence boundary with a typed `OcrPersistenceError`-equivalent (or the case-box-persistence-error equivalent when that package ships) named something like `LocalUserSentinelNotAllowed` — a distinct, machine-readable signal.
2. **`tenant_id` cross-entity matching.** When persistence enforces foreign-keys-by-value (per Step-0 §"Cross-boundary rules"), it MUST also assert `tenant_id` equality across related rows (matter ↔ document ↔ deadline ↔ evidence ↔ audit). The contract layer does not encode this; persistence does.
3. **Audit-event provenance.** Every audit event (Step 4) is keyed by `actor_user_id`. Replacing `"local-user"` with a real principal on subsequent writes does NOT rewrite historical audit events; the hash chain preserves what was true at write time. Operators reading the audit log must understand that pre-multi-user events legitimately read `"local-user"`.
4. **No silent backfill.** When the multi-user phase lands, persistence MUST NOT silently rewrite historical `"local-user"` rows to a chosen principal. Backfill, if any, is a separate explicit migration with its own audit events.

## Consequences

### Positive

- The v1 product can ship without an auth provider while leaving every realistic future path open (single-firm multi-user, mini-program, browser SPA, remote LLM, cloud sync).
- `tenant_id` already in the data shape means no schema migration when the auth gate opens.
- `actor_user_id` already in every audit event means the provenance chain is intact from day 1 — future auth can be retrofitted without rewriting history.
- A single named layer (persistence) is responsible for refusing the local-only sentinel once preconditions lift. Defense-in-depth at higher layers is welcome but not load-bearing.
- The "no authorization model" stance keeps v1 free of premature role-and-permission baggage. Roles can be designed once real multi-user use cases are observed.

### Negative

- v1 has no defense against an attacker who can run code in the Mac desktop process: any code in-process can write any audit event with any `actor_user_id`. This is the price of in-process embedding; the OS is the trust boundary. Documented here so it is not mistaken for a contract guarantee.
- The `"local-user"` sentinel is a meaningful magic string. A future contributor MUST consult `isLocalOnlyActor()` rather than typing the literal — this is documented in the Step-1 contract's `invariants.ts` but worth restating for ADR readers.
- The audit log will permanently contain `"local-user"` rows from v1, even after a real auth provider lands. Operators querying historical data must accept this. The hash chain forbids silent rewrite.

### Neutral

- Existing per-package tests stay green. Step 1 invariants tests (`tests/invariants.test.mjs`) already assert `LOCAL_ONLY_ACTOR_USER_ID === "local-user"` and `isLocalOnlyActor("local-user") === true`.
- No new entity, no new schema field, no new state machine. The Step-1 contract is sufficient as-is for the multi-user-readiness posture.

## Cross-references

- `docs/adr/case-box-step-0-boundary.md` §7 "actor_user_id" + §"Multi-user readiness summary" — promoted by this ADR.
- `docs/adr/case-box-step-1-contract-vocabulary.md` (= the contract package, see `docs/contracts/case-box-contract/`) — entities carrying `actor_user_id` + `tenant_id`.
- `docs/adr/case-box-step-4-audit-log-shape.md` — audit events keyed by `actor_user_id`; provenance backbone.
- `docs/adr/case-box-step-5-confidentiality-classification.md` — confidentiality posture interacts with multi-user (external transmissions require both a real actor and explicit per-document opt-in).
- `docs/adr/client-application-surface.md` — v1 Mac desktop in-process embedding; the OS is the trust boundary in v1.
- `docs/adr/sync-bridge-architecture.md` — first non-local entrypoint; first place the local-user sentinel MUST be replaced.
- `docs/contracts/case-box-contract/src/invariants.ts` — `LOCAL_ONLY_ACTOR_USER_ID` constant + `isLocalOnlyActor()` helper.
- `docs/contracts/case-box-contract/src/audit-log.ts` — audit-event helpers (Step 4).
- `docs/product/product-definition.md Part I` §"Primary User" + §"Cross-cutting Invariants" #7 + #8.
- `docs/release/go-live-plan.md` — Stop-and-Ask gates including the auth provider gate.
- `AGENTS.md` — Stop-and-Ask gates.

## Not in scope

This ADR does NOT:

- Choose an auth provider.
- Choose a role / permission model.
- Add or modify any code, schema, or contract test.
- Authorize the single-firm multi-user phase, the sync bridge, the mini-program, or any LLM extractor implementation.
- Introduce persistence enforcement code. The obligations in §"Persistence obligations recorded" are forward references for future WIs, not work items authorized here.
- Specify a migration plan from `"local-user"` to real principals. That is a future WI when the auth gate opens.
- Define what cross-tenant queries look like. Multi-firm SaaS is not v1.
- Specify any inbound network surface beyond what `docs/adr/sync-bridge-architecture.md` already records.

## Open questions deliberately deferred

For the next authorization gate (NOT resolved here):

1. **First auth provider.** Triggered by sync bridge, single-firm multi-user, WeChat mini-program, or remote LLM — whichever first. Stop-and-Ask.
2. **Role / permission model.** Designed when multi-user phase needs it. Likely a separate ADR (no number reserved yet).
3. **Per-document / per-matter ACLs.** Deferred to the sync-grants design under `docs/adr/sync-bridge-architecture.md` SYNC-04 and to the multi-user phase.
4. **`actor_user_id` value namespace.** Once a provider is chosen, the namespace (`@domain` email, ULID, IdP-issued sub claim) needs a one-line ADR. v1 stays free-form.
5. **Cross-actor concurrency.** Conflict resolution model for multiple users writing the same record (e.g. paralegal accepts a candidate fact while the partner rejects it). Deferred to the multi-user-phase WI.
6. **Audit-trail visibility.** Which roles see which audit events. Deferred to the role/permission ADR.
7. **Reading historical "local-user" rows after multi-user lands.** Operator UX question: do we surface a note "this row predates multi-user; actor was the local OS user"? Deferred to the multi-user-phase UI WI.
