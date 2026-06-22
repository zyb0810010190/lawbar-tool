# DECISION MEMO — WeChat Mini Program companion (Gate 0)

**Status**: decision memo (doc-only). **Authorizes nothing.**
**Type**: DECISION-MEMO (doc-only).
**Date**: 2026-06-13.
**Author**: Claude Code.
**Input evidence**: WI-WX0 plan commit `1b34bb4`
(`dev-memo/plan-wechat-mini-program-00.md`) — backend/API finding **Category B**, Gate 0
**HOLD**, implementation **BLOCKED**.

> This memo resolves what it can from repo evidence and **explicitly marks unresolved** every
> item that depends on a hard-stop decision (`.claude/rules/autonomy.md`) or an external fact
> not present in the repo. A memo cannot grant a hard-stop authorization; only the user can.

## Repo constraints carried in (input, not re-decided here)

- Backend/API finding = **Category B** (reusable DTO/handler/persistence surfaces exist; no
  deployable internet-ready backend; Electron IPC only).
- **No Category-A authenticated HTTPS backend exists.**
- `client-local-first.md`: WeChat = **deferred companion only**; cloud/sync **opt-in, never
  default-on**; **"Public HTTP API" is a forbidden v1 framing**.
- `autonomy.md` hard-stops: auth-provider choice, cloud vendor / public deployment, external
  document exposure, new runtime dependencies.

## Decisions

### 1. Move from local-first-only to local-first-plus-internet-reachable backend?
**UNRESOLVED — requires explicit user authorization.** A WeChat companion structurally
requires an internet-reachable HTTPS backend. That crosses the `client-local-first.md`
posture (cloud opt-in, never default-on; no public HTTP API in v1). The repo does **not**
authorize the move; it is a deliberate product-direction decision the user must make, then
reconcile via the client-architecture-reconcile flow. **Default state: NOT allowed.**

### 2. Who owns the backend service operationally?
**UNRESOLVED.** No backend exists, no owner is recorded. Candidate shapes (not selected):
reuse `case-box-contract` DTOs + `case-box-persistence` handlers behind a new service vs a
separate service; in-house operation vs managed hosting. Ownership + operational
responsibility (on-call, patching, key custody) must be named before any build.

### 3. Should a Category-A authenticated HTTPS backend be built?
**UNRESOLVED — gated by #1.** Technically it is the prerequisite for any Mini Program. But it
cannot be authorized until #1 (product-direction move), #4 (auth), #5 (cloud), and #6
(exposure) are resolved. **Default state: do not build.**

### 4. Auth-provider decision required?
**REQUIRED; provider NOT selected.** A Mini Program backend needs identity + session +
tenant/matter authorization (today `tenant_id` is forward-compat-only, no auth surface
exists). Choosing an auth provider is an `autonomy.md` **hard stop** — STOP-AND-ASK. This
memo records that the decision is required and **does not select one** (no prior
authorization exists).

### 5. Public cloud / public deployment allowed?
**UNRESOLVED — hard stop; vendor NOT selected.** Cloud vendor and public deployment are
`autonomy.md` hard stops and conflict with the local-first default-off posture. This memo
records the decision is required and **selects no vendor and no deployment mode** (no prior
authorization exists). **Default state: not allowed.**

### 6. Expose legal matter metadata or documents to an external service?
**NOT ALLOWED by default → document/file content is OUT OF SCOPE.** Exposing legal documents
(real or production-shaped) to external/cloud services is an `autonomy.md` hard stop and a
`client-local-first.md` forbidden framing. Until #1 is authorized with an explicit,
per-action, opt-in exposure model, **file/document content stays out of scope entirely**, and
even matter *metadata* exposure remains unresolved (a companion may at most see an
intentionally-exposed, read-mostly subset — not defined here).

### 7. China entity, ICP domain, 小程序备案, legal-services category qualification?
**UNRESOLVED — no repo evidence any exist.** A legal-services Mini Program requires a China
business entity, an ICP-filed domain, 小程序备案 (Mini Program registration), and
service-category qualification. None is present or referenced in the repo. All four are
**open external prerequisites** that must be proven before implementation.

### 8. PIPL / confidentiality review required before implementation?
**YES — required and not yet done.** Before any implementation, the following must be
completed: PIPL sensitive-personal-information handling analysis, **separate consent**,
notice, **personal-information protection impact assessment (PIPIA)**, **data-residency**
determination, **retention/deletion** policy, and **attorney-confidentiality / privilege**
review for any matter data that would leave the lawyer's Mac. None exists today. These are
hard prerequisites, not parallel work.

### 9. Next technical artifact — ADR or remain HOLD?
**Remain HOLD.** An architecture ADR would presuppose a direction on the #1/#5/#6 hard stops
that the user has not authorized; drafting it now would encode a forbidden-by-default posture
as if decided. The correct next artifact is **user resolution of the #1–#8 hard stops**, not
an ADR.

## Unresolved-decision summary

| # | Decision | State | Why |
|---|----------|-------|-----|
| 1 | Local-first → +internet backend | UNRESOLVED (default: no) | product-direction hard stop |
| 2 | Backend operational owner | UNRESOLVED | none recorded |
| 3 | Build Category-A HTTPS backend | UNRESOLVED (default: no) | gated by 1/4/5/6 |
| 4 | Auth provider | REQUIRED, not selected | hard stop |
| 5 | Public cloud / deployment | UNRESOLVED (default: no), no vendor | hard stop |
| 6 | External exposure of matter data | NOT ALLOWED by default | hard stop; content out of scope |
| 7 | China entity / ICP / 备案 / category | UNRESOLVED | no repo evidence |
| 8 | PIPL + confidentiality review | REQUIRED, not done | legal prerequisite |
| 9 | ADR vs HOLD | HOLD | ADR would presuppose unauthorized direction |

## Recommendation — **KEEP HOLD**

**KEEP HOLD — no implementation, no ADR yet.**

Rationale: every load-bearing decision (#1, #5, #6 in particular) is an unresolved hard stop
defaulting to *not allowed*, and the legal/entity/compliance prerequisites (#7, #8) are
unproven. There is no evidence in the repo resolving any hard stop, so neither
`AUTHORIZE ADR ONLY` nor `AUTHORIZE WI-WX1 PLANNING ONLY` is justified. The project stays at
Gate-0 HOLD until the user explicitly resolves the #1–#8 items above. The next step is a
user decision, not a further technical artifact.

## References

- `dev-memo/plan-wechat-mini-program-00.md` (commit `1b34bb4`) — Gate-0 plan, Category-B
  finding, HOLD/BLOCKED.
- `.claude/rules/client-local-first.md` — WeChat deferred companion; cloud opt-in; no public
  HTTP API in v1.
- `.claude/rules/autonomy.md` — hard-stop list.
- `.claude/rules/security-boundary.md`, `.claude/rules/cc-suite.md` — security + review
  discipline for any future high-risk WI.
