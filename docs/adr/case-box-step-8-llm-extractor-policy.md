# ADR: Case-Box Step 8 — LLM Extractor Policy

## Status

**Accepted** — 2026-05-20. Docs-only policy. Closes the case-box ADR series sketched in `docs/adr/case-box-step-0-boundary.md` §"ADR series phasing". Does NOT introduce an LLM, choose a vendor, install a dependency, expose any document externally, or authorize any implementation. Authorizes only the rules that any future LLM-extraction implementation MUST satisfy and the gating it MUST pass before production enablement.

This ADR is **policy-only**. It does NOT:

- pick a vendor or a model;
- install a runtime dependency or an SDK;
- store any API key, token, or secret;
- enable LLM extraction at any user-visible surface;
- transmit any document, fact, page, or excerpt to any external endpoint;
- modify the case-box contract package's code, schemas, fixtures, or tests;
- alter `assertExternalHandlingAllowed` (Step 5) — instead, this ADR locks the LLM action's behavior under that existing resolver.

A future implementation WI is required to ship LLM extraction. That WI is itself a Stop-and-Ask under `AGENTS.md` (new runtime dep, external account, external document exposure, possibly auth provider) and additionally requires the security/privacy sign-off described in §"Future-implementation gate" below.

## Context

Step 0 §5 confidentiality posture: "documents never leave local storage unless `confidentiality_class = normal` AND user explicitly authorized external worker for that doc". Step 5 (`case-box-step-5-confidentiality-classification.md`) wired this into the per-target classification resolver `assertExternalHandlingAllowed`, which already recognizes three external actions:

```
externalAction: "external_ocr" | "sync_transmit" | "llm_extraction"
```

…each driven by an action-specific opt-in flag (`externalOcrAuthorized` / `syncGrantPresent` / `llmExtractionOptIn`). Step 5 also pre-staged the LLM gate's denial-reason vocabulary; the resolver returns `missing_action_specific_opt_in` when the relevant flag is false, and existing denial reasons (`unclassified_default_denies_external`, `classification_restricted`, `classification_highly_confidential`, `classification_confidential` for the LLM action, `privilege_protected`) cover the categorical denials.

Step 2 (`case-box-step-2-fact-promotion-and-provenance.md`) locked the fact-promotion invariant: every machine-extracted fact (LLM / OCR excerpt / imported) MUST land as `draft_status = candidate`. `assertValidNewFact` (already in the Step-2 contract package) rejects any new fact whose `status !== "candidate"` from a machine source. There is no auto-accept path; the contract refuses it.

Step 3 (`case-box-step-3-privilege-marker-model.md`) defined privilege resolution. The resolver `effectivePrivilegeStatus` returns `hasProtectiveAssertion: boolean`, deliberately without any `safeToDisclose` / `isPrivileged` field — callers MUST check `hasProtectiveAssertion === true` to detect a protective assertion and MUST NOT infer disclosure safety from any negative field. The `PrivilegeReviewState` vocabulary (`not_reviewed | reviewed_no_privilege_applies | privileged_protected | privileged_with_waiver`) is the operational input to `assertExternalHandlingAllowed`.

Step 4 (`case-box-step-4-audit-log-shape.md`) is the provenance backbone. Every external transmission, opt-in, opt-out, and authorization decision flows through an audit event keyed by `actor_user_id`.

Step 7 (`case-box-step-7-multi-user-readiness.md`) locked the actor posture. The `"local-user"` sentinel is valid only while no remote LLM is enabled, which means: once LLM extraction is authorized for any document, the local-only sentinel ceases to be valid for the matter that authorized it. A real principal must be threaded through every write that follows the authorization.

LLM extraction is therefore the LAST of the three external actions whose policy was deferred, and the strictest in v1 posture: extraction touches the **content** of legal documents (in addition to identifiers and metadata that OCR / sync transmissions might already include) and operates on those contents to produce derived artifacts (candidate facts, candidate deadlines, candidate evidence citations) that the lawyer will later review. The combination of full-content exposure plus output that materially shapes the case requires the tightest gating in the series.

## Decision

Adopt the following policy as authoritative for any future LLM-extractor implementation in case-box.

### 1. Feature-flagged off by default

LLM extraction is **disabled** at every layer in v1:

- `case-box-contract`: no `llmExtractionOptIn` defaults to `true` anywhere; the validator helpers never short-circuit the resolver. `llmExtractionOptIn` is sourced exclusively from explicit opt-in state — there is no global "enable LLM" toggle and there will not be one.
- `case-box-persistence` (when it ships): no on-disk flag enables LLM extraction process-wide. Any attempt to introduce one is a contract violation.
- `case-box-ingestion` (when it ships): the LLM extractor module, if added, MUST refuse to run unless the per-document or per-matter opt-in is present.
- Mac desktop (`apps/lawbar-desktop/`, when it ships): no menu item, no preference, no settings UI to "Enable LLM extraction globally". Opt-in is per-matter / per-document only, exposed through the same UI affordance as other per-document confidentiality choices.

The Step-1 contract field `CaseBoxMatter.llm_extraction_opt_in` (already in the schema, default `false`) is the only per-matter flag. Per-document grant is the only per-document flag. **No process-wide LLM enablement exists.**

### 2. Opt-in is per-matter AND per-document

To extract from a specific document via LLM, BOTH of the following must be true:

- `CaseBoxMatter.llm_extraction_opt_in === true` for the matter that owns the document.
- A document-scoped LLM-extraction grant exists (mechanism: the future implementation defines the grant record; this ADR fixes only that the grant MUST be per-document, not per-matter wildcard).

Matter-level alone is insufficient. A lawyer who opts the matter in must still authorize each document individually before its content reaches an LLM. This mirrors the per-document sync grant model from `docs/adr/sync-bridge-architecture.md`.

Both opt-ins are revocable. Revocation produces an audit event (Step 4). Revoking matter-level opt-in implicitly invalidates all document-level grants for that matter; the implementation MUST treat any post-revocation extraction attempt as a denial with a `missing_action_specific_opt_in` reason.

### 3. Confidentiality eligibility — eligible iff effective level is `normal`

Eligibility is computed via the existing Step-5 resolver `assertExternalHandlingAllowed` invoked with `externalAction: "llm_extraction"`. The action is **eligible** for an extraction call iff the resolver returns `allowed === true`. Concretely:

| Target effective classification | LLM-extraction eligibility |
|---|---|
| `unclassified` (default; outside lattice) | **DENIED** — `unclassified_default_denies_external` |
| `normal` (lattice ordinal 1) | eligible (subject to remaining gates) |
| `confidential` (lattice ordinal 2) | **DENIED** — `classification_confidential` (v1 hard-deny; this ADR does NOT relax) |
| `highly_confidential` (lattice ordinal 3) | **DENIED** — `classification_highly_confidential` |
| `restricted` (lattice ordinal 4) | **DENIED** — `classification_restricted` |

AND matter-level confidentiality (`CaseBoxMatter.confidentiality_class`):

| Matter confidentiality_class | LLM-extraction eligibility |
|---|---|
| `normal` | eligible (subject to remaining gates) |
| `heightened` | **DENIED** — matter-level categorical deny |
| `sealed` | **DENIED** — matter-level categorical deny |

Step 5 explicitly noted "v1 `confidential` hard deny for LLM is conservative; Step 8 LLM-extractor ADR may relax with explicit per-case opt-in + audit." **This ADR does NOT relax.** v1 stays at `normal`-only. A future, post-MVP ADR may revisit the `confidential` exemption with additional safeguards; that conversation is out of scope here.

### 4. Privilege review must be complete and clear

Eligibility requires the target's `PrivilegeReviewState` to be exactly `reviewed_no_privilege_applies`. The other three values are all ineligible:

| PrivilegeReviewState | LLM-extraction eligibility |
|---|---|
| `not_reviewed` | **DENIED** — `privilege_review_required` (callers MUST NOT submit unreviewed material to an LLM) |
| `reviewed_no_privilege_applies` | eligible (subject to remaining gates) |
| `privileged_protected` | **DENIED** — `privilege_protected` |
| `privileged_with_waiver` | **DENIED** — v1 hard-deny; per-action waiver is post-MVP per Step 5 |

`not_reviewed` is treated as a denial because privilege defaults to undetermined (Step 3): unmarked is neither privileged nor cleared for disclosure. Submitting unmarked material to an LLM would implicitly disclose it before the lawyer has decided whether it could be safely disclosed at all. The default refuses.

### 5. Combined eligibility — explicit list

A document is eligible for LLM extraction iff **all** of the following hold simultaneously:

1. `CaseBoxMatter.confidentiality_class === "normal"` (matter level).
2. Effective per-target classification (Step 5) === `normal`.
3. `PrivilegeReviewState === "reviewed_no_privilege_applies"`.
4. `CaseBoxMatter.llm_extraction_opt_in === true`.
5. A document-scoped LLM-extraction grant exists for this specific document.
6. The actor invoking extraction is a real principal — `isLocalOnlyActor(actor_user_id) === false` per Step 7. The `"local-user"` sentinel MUST NOT be allowed to authorize LLM extraction.
7. No revocation event for the matter or document grant has been audited since the most recent grant.

The negation of any of 1–7 is a denial. The implementation MUST surface the denial via `assertExternalHandlingAllowed` (or an equivalent resolver) returning `allowed: false` with `denialReasons` enumerating the failing conditions — never a single composite "ineligible" code.

### 6. Output is candidate-only — Step 2 reaffirmed

Every artifact the LLM produces (extracted fact, suggested deadline, candidate evidence citation, suggested privilege marker, etc.) MUST be persisted as `draft_status === "candidate"`. The Step-1/Step-2 contract already enforces this for facts via `assertValidNewFact`. Future LLM-extracted artifacts in other entity types (deadlines per Step 6, evidence citations, privilege markers per Step 3) MUST be similarly gated; if the existing contract surface does not yet refuse non-candidate machine inserts for those entity types, the future implementation WI MUST add the rejection helper before going live (a Step-2-style invariant for each LLM-extractable entity).

There is **no auto-accept path**. The implementation MUST NOT include logic that promotes a high-confidence LLM output to `accepted` without lawyer review, regardless of confidence score, citation strength, or model self-report. Confidence scores MAY accompany the candidate as advisory metadata; they MUST NOT short-circuit the human-review gate.

### 7. Human review required before promotion

Promotion of LLM-extracted candidates to `accepted` (or `confirmed`, depending on the entity) MUST go through the same lawyer-review path that human-entered candidates use. The lawyer's review:

- is recorded as a Step-4 audit event with `actor_user_id` set to the real principal who reviewed (NEVER `"local-user"` once any LLM extraction has run);
- carries the lawyer's explicit `acceptFact` / `confirmDeadline` / equivalent action — no batch-accept-all UI;
- does NOT pre-mark facts based on extractor self-confidence — the UI MUST present LLM-extracted candidates with no visual privilege over human-entered candidates.

The Step-2 `supersedes_fact_id` chain remains the only mechanism for replacing an accepted fact with a corrected one. An LLM cannot supersede an accepted fact silently.

### 8. Prompts and responses are NOT stored by default

Unless the user explicitly authorizes prompt/response retention for a specific extraction call, the implementation MUST NOT persist any of the following:

- The prompt or system instructions sent to the LLM.
- The LLM's raw response.
- Any intermediate tool-call transcript.
- Token counts or usage metering linked to a specific document or matter (aggregate usage for billing review MAY be retained but MUST NOT be keyed to document content).

What IS stored:

- The candidate artifacts the LLM produced (parsed into typed entities — facts, deadlines, evidence citations, etc.) with `extracted_by = "llm"` and `extractor_name = "<some-identifier>"` (the identifier is implementation-defined and MUST NOT include API keys or vendor credentials).
- An audit event (Step 4) recording the extraction call's input scope (which document, which extractor name, which actor), outcome (success / partial / failure), and outcome counts (N candidates produced). This audit event MUST NOT carry the prompt or response.

If the user opts in to prompt/response retention (an additional explicit per-extraction flag the future implementation defines), the retained material:

- is stored in the same local-only storage with `confidentiality_class` matching the source document;
- is itself subject to `assertExternalHandlingAllowed` before any future transmission;
- carries a retention deadline (default: matter-archive date) and is hard-deleted at that deadline with an audit event.

The retention opt-in is NOT a separate global toggle — it MUST be a per-extraction choice the lawyer makes at the moment of opting the document in.

### 9. No vendor, no model, no secrets, no production enablement

This ADR does NOT choose:

- A model provider (OpenAI / Anthropic / Google / on-prem / etc.).
- A specific model (GPT-X / Claude-Y / Gemini-Z / Llama-W).
- A hosting topology (vendor-hosted API / self-hosted inference / on-device).
- A protocol (HTTPS / gRPC / WebSocket / local IPC).

This ADR does NOT contain or reference:

- API keys, bearer tokens, OAuth client secrets, or any other credential.
- Endpoint URLs or hostnames for any LLM service.
- Pricing terms or rate-limit values.

This ADR does NOT enable LLM extraction in any deployable artifact. There is no "ship with extraction disabled" build option; there is "extraction is not implemented." When the future implementation WI lands, the implementation defaults to disabled at every layer per §1. No production enablement happens silently.

### 10. Future-implementation gate

Any future WI that ships LLM extraction MUST clear the following gates before production enablement:

1. **Vendor / model selection** — Stop-and-Ask per `AGENTS.md` (external account / new runtime dependency / possibly auth provider).
2. **Security sign-off** — a dedicated sign-off doc under `docs/release/` (proposed name: `docs/release/case-box-llm-security-signoff.md`) covering: how prompt/response data is held in transit, how prompts are constructed to avoid prompt injection from document content, how the implementation refuses prompts that exceed the eligible scope, how revocation is honored mid-flight, and how audit events capture exactly what was sent.
3. **Privacy sign-off** — distinct from security, covering: data residency, third-party processor agreement, sub-processor list, retention defaults at the vendor (does the vendor train on submitted text?), and the lawyer's user-facing disclosure / consent flow.
4. **Conformance tests** — the implementation MUST add test coverage proving:
   - eligibility gates of §5 reject every ineligible state with the correct denial reason;
   - `actor_user_id !== "local-user"` is enforced;
   - candidate-only output is enforced for every emitted entity type;
   - prompt/response are NOT persisted unless the explicit retention flag was set;
   - revocation mid-flight aborts and audits.
5. **Operator runbook** — incident-response procedure for "LLM vendor data breach" and "LLM produced output the lawyer disputes was theirs".
6. **No bypass flag** — the implementation MUST NOT ship with any `--enable-llm-anyway` / `LLM_FORCE=1` / `unsafe-mode` flag that bypasses the eligibility resolver. The resolver is the only gate.

Until ALL of those clear, the implementation MUST NOT enable any extraction call in any production-shaped build.

## Persistence obligations recorded

For the future LLM-extraction implementation WI (NOT authorized here):

1. **Resolver invocation per call.** Every LLM-extraction call site MUST invoke `assertExternalHandlingAllowed({ externalAction: "llm_extraction", ... })` immediately before transmission and MUST honor `decision.allowed === true` as a hard precondition. The check MUST happen inside the same transaction as the audit event recording the call.
2. **Audit event on every extraction call.** Step-4 `CASE_BOX_AUDIT_EVENT_KINDS` MUST gain a kind for LLM extraction (e.g. `llm_extraction_requested` / `llm_extraction_completed` / `llm_extraction_denied`); the future implementation WI defines the exact strings. Audit events MUST capture the actor, document, matter, extractor name, eligibility decision (`allowed` + `denialReasons`), and outcome (candidate count or failure mode).
3. **Candidate insertion uses existing helpers.** Any LLM-produced fact MUST go through `assertValidNewFact` (Step 2). Any LLM-produced deadline MUST go through the Step-6 docket-entry pathway. Any LLM-produced privilege marker MUST go through `assertValidNewPrivilegeMarker` (Step 3). The LLM does not get its own short path.
4. **Revocation honored mid-flight.** If an LLM call is in flight when the lawyer revokes the matter or document grant, the implementation MUST abort the call (or discard the response), MUST NOT persist any candidates from that call, and MUST audit the abort.
5. **No silent retention.** The default `false` for prompt/response retention is enforced at the persistence boundary — even if a future implementation passes a retention payload, persistence MUST refuse unless the per-extraction retention flag is set and the per-document opt-in is current.
6. **Tenant isolation for prompt/response storage.** If the lawyer opts in to retention, the retained material is scoped to the same `tenant_id` as the source document. Cross-tenant reads are forbidden by the same rules that apply to documents.

## Consequences

### Positive

- Step 5's resolver is the single decision point for LLM eligibility. Callers cannot accidentally permit extraction by checking a wrong field; the resolver returns a typed `HandlingDecision` whose only positive signal is `allowed === true`.
- v1 confidentiality posture is preserved: full-content document data does NOT flow to an external LLM by default and CANNOT flow without per-matter + per-document opt-in, `normal` classification on both levels, complete privilege review, a real (non-`local-user`) principal, and absence of revocation.
- The candidate-only rule reuses Step 2's existing `assertValidNewFact` — no new contract surface required for the most common LLM output (facts).
- Vendor / model / hosting decisions are explicitly deferred. The policy stays valid across vendor switches.
- Prompt/response retention is opt-in per extraction, not per session or per setting — minimizing the surface area of accidental retention.
- The future-implementation gate is named and enumerated; the next WI cannot quietly start production-grade extraction.

### Negative

- The combined eligibility checklist (§5) is long. UX work has to surface to the lawyer why a given document is ineligible — denial reasons from the resolver should be human-readable strings, not opaque codes. Step 5's `HandlingDecision.denialReasons` shape is the input the UI consumes; an LLM-extraction surface MUST render them.
- Refusing `not_reviewed` material means the lawyer must perform privilege review before any LLM extraction can run. This is correct (no LLM should see unreviewed material) but adds friction. A future "bulk privilege-review" UI WI may reduce that friction; it is out of scope here.
- The `confidential`-level hard-deny is conservative. Documents that are sensitive but not privileged (trade secrets, regulated PII) cannot benefit from LLM extraction in v1. A later ADR may revisit with strong additional guards.
- Prompts and responses being non-retained by default complicates debugging an LLM that produces wrong outputs. The implementation MUST surface the candidate artifacts the lawyer can inspect; vendor-side prompt/response logs (under whatever DPA the vendor agreement specifies) are the operational fallback. The default minimizes confidentiality risk at the cost of inspection difficulty — the right trade for legal-document workflows.

### Neutral

- No code, schema, or test change in this commit. Existing per-package tests stay green; AGENTS.md `npm --prefix docs/contracts/case-box-contract test` is unaffected.
- Step 5's `assertExternalHandlingAllowed` already supports the `llm_extraction` action; no contract API addition required.
- Step 7's actor invariants extend naturally — LLM extraction joins the list of triggers that lifts the `"local-user"` precondition.

## Cross-references

- `docs/adr/case-box-step-0-boundary.md` §5 confidentiality posture, §"ADR series phasing", §"Open questions deliberately deferred" #5 (LLM extractor default).
- `docs/adr/case-box-step-2-fact-promotion-and-provenance.md` — candidate-only fact lifecycle; `assertValidNewFact`; supersession.
- `docs/adr/case-box-step-3-privilege-marker-model.md` — `PrivilegeReviewState`; `effectivePrivilegeStatus`; `hasProtectiveAssertion`.
- `docs/adr/case-box-step-4-audit-log-shape.md` — `CASE_BOX_AUDIT_EVENT_KINDS`; chain integrity; new kinds the future LLM WI must add.
- `docs/adr/case-box-step-5-confidentiality-classification.md` — `assertExternalHandlingAllowed`; `externalAction: "llm_extraction"`; `llmExtractionOptIn`; conservative `confidential` hard-deny (NOT relaxed here).
- `docs/adr/case-box-step-6-deadline-docketing-rules.md` — candidate docket entries; same candidate-only discipline LLM outputs inherit if they produce deadlines.
- `docs/adr/case-box-step-7-multi-user-readiness.md` — `"local-user"` sentinel invalid once LLM extraction is authorized; real principal required.
- `docs/adr/sync-bridge-architecture.md` — companion-bridge per-document opt-in pattern that the LLM grant model mirrors.
- `docs/adr/client-application-surface.md` — v1 default workflow has no LLM enablement; matter-level + document-level opt-in is the only path.
- `docs/contracts/case-box-contract/src/invariants.ts` — `LOCAL_ONLY_ACTOR_USER_ID`, `isLocalOnlyActor`.
- `docs/product/product-definition.md Part I` §"Data Residency" row "LLM candidate-fact extraction" + §"Cross-cutting Invariants" #4 (no auto-accept).
- `docs/release/go-live-plan.md` — Stop-and-Ask gates.
- `AGENTS.md` — Stop-and-Ask gates including external account, runtime dependency, security-sensitive rewrites.

## Not in scope

This ADR does NOT:

- Implement any LLM-extraction code or test.
- Choose a vendor or a model.
- Install a runtime dependency.
- Authorize a security or privacy sign-off doc (only requires its existence as a future gate).
- Add or modify any schema, validator, state machine, or audit-event kind.
- Authorize prompt/response storage at any layer.
- Define the exact shape of a per-document LLM-extraction grant record (the future implementation defines it; this ADR only requires that one exist).
- Define the exact `extractor_name` namespace.
- Authorize LLM extraction for any actual document.
- Re-open Step 5's `confidential`-level hard-deny.
- Add or modify any UI screen, IPC handler, or sync-bridge route.

## Open questions deliberately deferred

For the future LLM-extraction implementation WI (NOT resolved here):

1. **Per-document grant record shape.** Schema + persistence rules. Future implementation defines.
2. **Vendor / model selection.** Stop-and-Ask.
3. **Prompt construction & prompt-injection defenses.** Security sign-off topic.
4. **Mid-flight cancellation protocol.** Operational topic.
5. **Vendor DPA + sub-processor list.** Privacy sign-off topic.
6. **Aggregate billing-metering retention** (without per-document attribution). Implementation defines.
7. **`extractor_name` namespace.** One-line follow-up ADR when chosen.
8. **Eventual `confidential`-level exemption.** Post-MVP; explicit future ADR.
9. **Bulk privilege-review UX** to reduce the `not_reviewed` friction. Out of this scope; UI WI.
10. **Vendor-side training opt-out enforcement audit.** Privacy sign-off topic.
