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
