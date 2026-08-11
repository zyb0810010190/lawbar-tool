# A3-PAGE-T1 DocumentPage schema V9 audit report

AUDIT-SCOPE: services/case-box-persistence/src/sqlite/schema.ts + services/case-box-persistence/tests/hardening-schema.test.mjs
AUDIT-VERDICT: PASS C0 H0 M0 L0 (audit-mqro8amd-1n4t9l, rawOutput sha256
  4377260297c027efbe91d6a25c7ee1d89441de1f4fe0438015ab2441bcfb71bd)

Confirmed: CURRENT_SCHEMA_VERSION=9; [9, DDL_STATEMENTS_V9] registered; applySchema forward-only/idempotent via
the existing loop; V1-V8 DDL unmodified; V9 adds only case_box_document_pages + one index. Table has the
identity columns, physical_page_index INTEGER NOT NULL CHECK >= 0 (0-based), UNIQUE(document_id,
physical_page_index), NO SQLite FK, NO geometry/viewport/anchor/link surface. Tests cover empty-apply-to-V9,
V8->V9 additive upgrade with retained data, schema_version=9, columns, index-0 accepted, negative rejected,
uniqueness, empty FK pragma, absence of geometry/anchor/link tables. No scope creep; no Evidence invariant
weakened; A3-DB-00 encryption hard stop untouched; machine 0-based index not conflated with the human citation
label.

Note: the auditor's own `npm --prefix services/case-box-persistence test` was blocked by its read-only sandbox
during contract type generation (not a diff issue). The agent ran the real suite locally: 288/288 pass;
hardening-schema 11/11 pass (incl. 7 new V9 cases).

Human custody-mode-9b gated verification (reported PASS): writer-exit=0; A07_REQUIRED=1 check-a07-gate exit 0;
A07_REQUIRED=1 check-gates ended GATES OK (gates-exit=0); LAWBAR_A07_MARKER_HMAC_KEY unset after; no
marker/ledger/key/evidence-run staged or committed; the local marker stays gitignored under
dev-memo/run/evidence/.

verify: N/A — audit returned C0 H0 M0 L0 (no findings to close).
