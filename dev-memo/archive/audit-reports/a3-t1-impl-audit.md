# A3-T1-IMPL Anchor/Link schema V11 audit report

AUDIT-SCOPE: services/case-box-persistence/src/sqlite/schema.ts + services/case-box-persistence/tests/hardening-schema.test.mjs
AUDIT-VERDICT: PASS C0 H0 M0 L0 (audit-mqspp58m-f58ydw, rawOutput sha256
  32a98544672cae3d02e056aaf8a410e43c6d2b04019d1358df0439fb824e0a70)

Confirmed: V11 registered [11, ...]; CURRENT_SCHEMA_VERSION=11; forward-only via the existing applySchema loop;
V1-V10 DDL unmodified. Anchor/link DDL matches A3-SCHEMA-00 §3 + A3-CONTRACT-00 §4: no FK, no ON DELETE cascade,
no viewport, no implicit valid (LinkStatus NOT NULL no-default), page_ratio rects as TEXT COLLATE BINARY,
coordinate_space/origin_ref consts, page_rotation/source_type CHECKs, geometry_captured_at NOT NULL. Tests cover
V11 creation, V10->V11 preservation, enum/CHECK failures, no-default status, byte-stable TEXT round-trip, empty
FK lists for both tables. No scope creep; no Evidence invariant weakened; cascade not invented.

Note: the auditor's full `npm test` was blocked by its read-only sandbox during contract prebuild (EPERM) — not
a diff issue. The agent ran the real suite locally: 288/288 pass; hardening-schema 28/28 (incl. 9 new V11 cases).

verify: N/A — audit returned C0 H0 M0 (no Critical/High/Medium findings to close).

Human custody-mode-9b gated verification (reported PASS): namespace cleared pre-run; marker minted for
governance commit be47c2a; writer-exit=0; A07_REQUIRED=1 check-a07-gate exit 0; A07_REQUIRED=1 check-gates ended
GATES OK (gates-exit=0); LAWBAR_A07_MARKER_HMAC_KEY unset after; no marker/ledger/key/evidence-run staged or
committed; the local marker stays gitignored under dev-memo/run/evidence/.
