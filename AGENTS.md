# Project Instructions

> lawbar-tool

⏺ Project: lawbar-tool                                                                                                                                     
                                                                                                                                                         
  OCR pipeline split across contract package + 4 sibling services. All TypeScript ESM, NodeNext, Node ≥20 node:test. Files inspected look benign — domain  
  code for legal-document OCR, not malware.                                                                                                                
                                                                                                                                                           
  docs/contracts/ — ocr-worker-contract                                                                                                                    
                                                                                                                                                         
  Contract package (treated as if packages/ocr-contract until monorepo). Wire-format only — no engine, queue, DB, UI, auth.                                
                                                        
  - schemas/ — JSON Schema 2020-12 source of truth: ocr-submission, ocr-result, ocr-status.                                                                
  - src/ — Ajv validator wrappers + state-machine + retry classifier.
    - validateSubmission / validateResult / validateStatusEnvelope / validateStatusTransitionSequence → { ok, value } or { ok:false, summary, errors }.    
    - assertValidOcrStatusTransition(from, to, controlledBy?) — throw-on-error guard.                                                                      
    - classifyOcrFailureForRetry → retry / dead_letter / not_failed. Caller owns queue mechanics.                                                          
    - transitions.ts — legal edges + owners (queue / worker / web_app).                                                                                    
    - retry-rules.ts — transient vs permanent.                                                                                                             
    - src/testing/fake-worker.ts (subpath export ocr-worker-contract/testing) — processFakeOcrJob, scenarios success / partial_failure / permanent_failure 
  / transient_then_success. Deterministic clock.                                                                                                           
    - src/generated/ — auto-gen types from schemas (json-schema-to-typescript). Not source of truth; cross-schema invariants only enforced at runtime.     
  - fixtures/{valid,invalid}/ — payload examples. Invalid carry _invalid_reason + _target_schema. Sweep test pins fixture list against explicit-test list. 
  - tests/contract.test.mjs + validators.test.mjs — schema + semantic + API surface.                                                                       
  - docs/adr/ocr-processing-coordinator-step-10c.md — ADR for Step 10C coordinator: persistence is source of truth, queue is transport-only, edge-ownership
   table, redelivery rules, queue-error → outcome mapping. Admits only success + partial_failure fake scenarios; rejects bundled-retry / DLQ.              
                                                                                                                                                           
  services/                                                                                                                                                
                                                                                                                                                         
  All four privately versioned 0.1.0, all depend on ocr-worker-contract via file:../../docs/contracts.                                                     
  
  ┌───────────────────────────┬───────────────────────────────────────────────────────────────────────────────────────┬────────────────────────────────┐   
  │          Package          │                                         Role                                          │              Deps              │
  ├───────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────────┤ 
  │ ocr-worker (name:         │ Queue-facing adapter around contract. In-memory default, BullMQ seam. Tests: adapter, │ contract                       │
  │ ocr-worker-adapter)       │  in-memory queue conformance, coordinator, worker loop.                               │                                │
  ├───────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────────┤   
  │                           │ Persistence boundary. In-memory + SQLite (better-sqlite3) impls behind one interface. │                                │
  │ ocr-persistence           │  Provides appendOcrStatusOnce, saveOcrResultOnce (replay-safe). Tests: inMemory +     │ contract                       │   
  │                           │ sqlite conformance + sqlite hardening.                                                │                                │
  ├───────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────────┤   
  │ ocr-ingestion             │ Domain → submission. Drives jobs across queue + persistence boundary.                 │ contract, ocr-worker-adapter,  │
  │                           │                                                                                       │ ocr-persistence                │   
  ├───────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────────┤
  │ ocr-review                │ Read-only read-model over persistence. Lawyer-facing review state per job. Step 8A    │ contract, ocr-persistence      │   
  │                           │ single-job-scope; cross-job in 8B.                                                    │ (dev: adapter, ingestion)      │
  └───────────────────────────┴───────────────────────────────────────────────────────────────────────────────────────┴────────────────────────────────┘   
   
  Architecture shape                                                                                                                                       
                                                        
  Contract (schemas + validators + state machine) is hub. Persistence = source of truth. Queue = transport. Coordinator (in ocr-worker-adapter, ADR-10C)   
  owns lifecycle: claim → inspect persistence → run worker → normalize edges → persist → ack/requeue. Review derives lawyer view downstream.

## Repo Brief — lawbar-tool

Contract package requires Node >=22 because it uses JSON import attributes.

`services/ocr-persistence` is pinned to **Node 22.x or 24.x** (LTS line; 23.x / 25.x permitted by the engines semver range but not exercised in the repo). Upper bound `<26.0.0` is enforced via `package.json` `engines` until this repo chooses to support Node 26 (a separate ~5-LOC bump WI after verifying `better-sqlite3` prebuilds for Node 26 ABI). An ABI smoke check (`services/ocr-persistence/scripts/abi-smoke.mjs`) runs as `pretest` in `services/ocr-persistence` and fast-fails on any stale `better-sqlite3` native binding so the failure surfaces as a clear `[abi-smoke] FAIL` line, not as opaque `ERR_DLOPEN_FAILED` inside one of dozens of SQLite test files. See `dev-memo/plan-abi-00-better-sqlite3.md`.

### Core architecture
- Contract hub: docs/contracts/
- Worker: services/ocr-worker/
- Persistence: services/ocr-persistence/
- Ingestion: services/ocr-ingestion/
- Review: services/ocr-review/

### Critical invariants
- Contract = vocabulary owner. Queue = transport. Persistence = source of truth.
- Queue dedupe key = job_id + canonical submission JSON, not transport metadata.
- OcrQueueError codes are stable: dedupe_conflict, unknown_receipt, stale_receipt, lease_expired, invalid_claim.
- OcrQueueError class identity must stay the same across import paths.
- Coordinator owns lifecycle. Adapter must not own lifecycle.
- No simplifying queue/persistence split.
- No collapsing unknown_receipt, stale_receipt, and lease_expired.
- No FK from queue rows to ocr_jobs.
- No read-layer re-sorting that masks persistence bugs.
- No mutating fixtures without schema and semantic tests both updated.
- Node 20 is insufficient for the contract package; use Node 22+.

### Test commands
npm --prefix docs/contracts test
npm --prefix docs/contracts/case-box-contract test
npm --prefix services/case-box-persistence test
npm --prefix services/ocr-persistence test
npm --prefix services/ocr-worker test
npm --prefix services/ocr-ingestion test
npm --prefix services/ocr-review test

## CC-Suite Integration Policy

Claude Code is the implementer. CC-Suite is the main Claude/Codex integration layer.

### Routing

- Use `cc-suite` as the default bridge for Claude ↔ Codex coordination.
- Do not use old `codex-octopus` MCP tools unless the user explicitly re-adds them after `/cc-suite:status` is healthy.
- Do not assume old `/codex-*` octopus commands exist.
- Verify available commands with `/cc-suite:status`, `/mcp`, and installed plugin help before relying on command names.

### Mutation policy

Codex-side tools are reviewers by default.

Codex must not write code, modify files, create branches, apply patches, or mutate repo/task state unless the user explicitly authorizes implementation in the current turn.

### Failure handling

If cc-suite, Codex, Claude bridge, MCP registration, authentication, or model availability fails:
- Report the failure explicitly.
- Do not treat a failed review as success.
- Use `/cc-suite:status` before assuming the bridge is healthy.

## Shared Memory

**Always write new instructions, rules, and memory to `AGENTS.md` only.**

Never modify `CLAUDE.md` or `GEMINI.md` directly — they only import `AGENTS.md`.
This keeps Claude Code, Codex CLI, and Gemini CLI on the same context.

## Project Structure

- `.claude/` — Claude Code skills, agents, rules, hooks, commands
- `.agents/skills/` — symlink to `.claude/skills/` (Codex skill scan path)
- `.codex/prompts/` — Codex slash-command prompts
- `.codex/hooks.json` / `.codex/config.toml` — Codex hooks/config (optional)
- `.gemini/skills/`, `.gemini/commands/` — Gemini skills and TOML commands
- `.mcp.json` — MCP server registrations (shared by all three tools)

## CC-Suite Autonomous Execution Policy

Claude Code may use cc-suite to plan, implement, audit, fix, verify, validate, and test bounded project work without asking for confirmation on every step, provided all conditions below hold.

### Allowed without further confirmation

- Planning and plan review.
- Documentation updates.
- Test writing and test repair.
- Implementation of one bounded work item at a time.
- Fixes for correctness, reliability, validation, observability, and test failures within the active work item.
- Running local test commands listed in this file.
- Running `/review-plan`, `/implement`, `/audit`, `/audit-fix`, `/verify`, `/status`, `/result`, `/continue`, and `/cancel`.

### Required stop-and-ask gates

Stop and ask the user before:
- Production deployment or release publication.
- Database migrations on real data.
- Secret, credential, billing, auth, authorization, or external account changes.
- New runtime dependencies.
- Public API, wire-format, schema, or CLI breaking changes.
- Security-sensitive rewrites, including SSRF, TLS, DNS, crypto, auth, tenant isolation, or sandboxing.
- Large cross-service refactors.
- Deleting data, deleting files not clearly generated, or destructive shell commands.
- Creating Git commits, tags, branches, or pushes unless explicitly authorized in the current task.

### Required loop

For each work item:

1. `/review-plan` before implementation when the change affects architecture, security, contracts, persistence, queue lifecycle, or multiple packages.
2. `/implement` for one bounded work item.
3. Run relevant local tests.
4. `/verify` after implementation.
5. `/audit` or `/audit-fix` on the changed scope.
6. Repeat until verification and audit pass.
7. Summarize changed files, tests run, remaining risks, and next recommended work item.

### Scope rule

Never interpret “finish the project” as permission to make unbounded changes. Convert it into a queue of small work items and process one item at a time.

### No-Choice Autonomous Default

During cc-suite autonomous execution, do not ask the user to choose among routine process options.

When multiple valid process paths exist, choose the safest optimal path automatically:

- Prefer the next executable WI with all predecessors satisfied.
- Prefer background cc-suite jobs for review-plan, audit, and long-running validation.
- Prefer Claude writes / Codex validates unless the WI explicitly authorizes Codex writing.
- Prefer `/audit-fix` when fixes are allowed, so audit → fix → verify happens as one loop.
- Prefer `/audit` only for read-only WIs or when fixes are not allowed.
- Prefer plan-review before implementation for security, TLS/DNS/SSRF, auth, migration, public API, CLI, schema, persistence, queue lifecycle, or multi-package changes.
- Prefer the smallest bounded change that satisfies the WI.
- Prefer opening a bounded sub-WI instead of expanding scope.

Only stop and ask the user when:
- production deployment or release publication is involved;
- secrets, credentials, billing, external accounts, or auth/authorization are involved;
- destructive commands or data deletion are involved;
- new runtime dependencies are required;
- public API, wire-format, schema, CLI, migration, persistence, or queue lifecycle changes require explicit approval;
- real user-provided fixtures or legal/business waivers are required;
- the plan has no safe path forward.

### Go-live rule

The project is not ready to go live until:
- All planned work items are complete.
- All package tests pass.
- Full audit has no unresolved Critical/High findings.
- Security, migration, persistence, queue, contract, and API risks have been explicitly cleared.
- A final go-live readiness report is produced.
