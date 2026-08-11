# A3-PAGE-T2 DocumentPageGeometry schema V10 audit report

AUDIT-SCOPE: services/case-box-persistence/src/sqlite/schema.ts + services/case-box-persistence/tests/hardening-schema.test.mjs
AUDIT-VERDICT: PASS C0 H0 M0 L2 (audit-mqrphx2u-vlg5cg, rawOutput sha256
  5314357421b6387d674a26f131d057ed60edd7ff13e022e7b3a7459ba0d90f8b)

Confirmed: DDL_STATEMENTS_V10 registered as [10, ...]; CURRENT_SCHEMA_VERSION=10; forward-only/idempotent via
the existing applySchema loop; V1-V9 DDL untouched. case_box_document_page_geometries has the resolved schema
(bounds_x/y/width/height TEXT NOT NULL COLLATE BINARY [12-dp, not REAL]; resolved_box CHECK cropBox/mediaBox;
rotation CHECK 0/90/180/270; physical_page_index CHECK >= 0 [0-based]; captured_at version; UNIQUE(document_id,
physical_page_index) single-current; NO FK; NO viewport/anchor/link). No scope creep; no Evidence invariant
weakened; A3-DB-00 encryption hard stop untouched; bounds byte-stability preserved (TEXT). Focused suite
21/21 pass.

## Deferred Lows (test-coverage breadth; safe to proceed; out-of-scope strengthening for this WI)
- L1: the NOT-NULL test proves only document_id/physical_page_index/captured_at; the DDL correctly marks the
  other required columns (tenant_id, matter_id, resolved_box, bounds_*, rotation, created_at, payload_json)
  NOT NULL, but the tests do not individually assert each. The column-inspection test (PRAGMA table_info)
  already proves all columns exist; the DDL is the source of truth for NOT NULL. Reason: cleanup/test-breadth,
  no correctness/invariant impact. Target: a future A3 test-hardening WI. Safe-to-proceed: YES.
- L2: byte-identical TEXT round-trip is proven for bounds_width only; all four bounds columns share the
  identical TEXT NOT NULL COLLATE BINARY definition, so bounds_width is representative. Reason: test-breadth.
  Target: a future A3 test-hardening WI. Safe-to-proceed: YES.

verify: N/A — audit returned C0 H0 M0 (no Critical/High/Medium findings to close).

Human custody-mode-9b gated verification (reported PASS): writer-exit=0; A07_REQUIRED=1 check-a07-gate exit 0;
A07_REQUIRED=1 check-gates ended GATES OK (gates-exit=0); LAWBAR_A07_MARKER_HMAC_KEY unset after; no
marker/ledger/key/evidence-run staged or committed; the local marker stays gitignored under
dev-memo/run/evidence/.
