# Queue review — WI-EVIDENCE-A8-DESIGN-00

Lane: Evidence-Genie A8 snapshot integrity & confidentiality architecture gate (Type: PLAN; docs/ADR-only, HIGH-RISK court-facing design).
Date: 2026-06-29. Branch: `evidence-a8-design` (from `main` @ `06d9660`).

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
### review-plan
- Kind: review-plan · Path 1 runner 0.2.18, gpt-5.5/high/read-only · Job ID `review-plan-mqz8ldue-ut1pn0` · completed (retrievable YES) · **READY-WITH-LOW** · rawOutput sha256 `36536687489c84895314406b8555194086f3fec228ece5884672e3548f228ac7`.
- Low fix (applied): cite the TRACKED handover `docs/reference/evidence-genie-m0-developer-handover.md` as authoritative source, not the untracked root copy. queue.md §Scope + §Source-of-truth updated; re-lint PASSED.

## Verdict: READY-WITH-LOW → fixed (A0.7 NOT required for this docs-only lane)
Reviewer confirmed: (1) A8 is correctly the next critical-path hard-invariant gate after A3 (A1/A3/A8/A10), not A5 (A5/A6/A9 are off-critical-path epic-level). (2) A8 design CAN be written now with A1=PARTIAL / A10=SPEC-ONLY / A0.7=not-green modeled as explicit sequencing + stop-points — no prerequisite A10/A0.7 lane must precede this docs-only ADR — provided the ADR does not design/instantiate `CanonicalExportModel` beyond what the handover states. (3) A8.6 byte-identical-canonical-model acceptance correctly sequenced behind A10-T6; A8 must not invent its schema/serializer/contract. (4) No source/schema/native/crypto change required in this lane (any such need = STOP + new WI). (5) ONE ADR is appropriate (freeze/manifest/seal/crypto/bundle/restore are one integrity/confidentiality architecture; split implementation later by sub-ticket). (6) No invariant weakening in the framing, given the ADR keeps the hard lines (DocumentPage-only citations; version-pinned anchors; renditions never citation/anchor basis; manifest hashes logical payload not encrypted DB; frozen snapshots read-only under newer apps); no cloud/auth/PIPL/China-filing decision required; local-first/offline governs. A0.7 custody NOT required for a non-authorizing ADR.

QUEUE_REVIEW_VERDICT=PASS

## Post-implementation cc-suite records
### audit
- Kind: audit · Path 1 runner 0.2.18, gpt-5.5/high/read-only (pre-commit working-tree scope) · Job ID `audit-mqz8roa4-uekkqv` · **PASS, no findings** · rawOutput sha256 `b5a1382dcdbc81b155c5020e7afe0b028b85ab92814cdfd6c1a8161668b7e26d`.
- Confirmed: scope = ADR + queue.md/queue.linted only (no source/schema/native/contract/test/UI/package; schema 12); invariant fidelity (DocumentPage citations, version-pinned anchors, renditions-not-basis, manifest/seal anti-circularity, canonical-not-raw-bytes, local-first); grounding honest (A0.7 not-green, A1 PARTIAL, A10 SPEC-ONLY; does not invent CanonicalExportModel; A8.6 sequenced behind A10-T6/A1-T6/A3-T10); crypto params + ticket order match the handover (Argon2id 19/2/1, AES-256-GCM, T2→T3→T5→T4→T6→T7→T1); design-only, no secrets/keys embedded.
### verify
- Kind: verify · Path 1 runner 0.2.18 · consumed the audit (no-findings PASS).
- Attempt 1: Job ID `verify-mqz8tty8-pfzfdz` · NOT-ALL-CLOSED on a residue mis-read — flagged pre-existing untracked root-intake/run-state residue as scope creep. That residue is out-of-WI and excluded by exact-path staging (per `.claude/rules/staging-hygiene.md`); not a real finding. Re-verified with the exact-path-staging contract clarified.
- Attempt 2: Job ID `verify-mqz8vrpq-2zjdmc` · **ALL CLOSED** · rawOutput sha256 `7aebb7707cb2f395546b058f958f74fabf7fac60df325b84a1cf869a6bf91fa2`. No prior C/H/M open; deliverable intact (design-only; A0.7/A1/A10 grounding honest; CanonicalExportModel not invented; anti-circularity + A1/A3 invariants preserved); WI scope = ADR + queue.md + queue.linted; schema 12; residue excluded.

Verification run: `scripts/workflow/check-contract-integrity.sh` PASS (14 docs); `CURRENT_SCHEMA_VERSION` 12; ADR present (169 LOC). No A0.7 custody (docs-only; review-plan confirmed not required).
