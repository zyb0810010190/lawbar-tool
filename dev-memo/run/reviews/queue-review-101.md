# Queue review — WI-A3-INTERNAL-DEPS-PACKAGING-ADR-00

Lane: decide stable desktop internal-dependency packaging (Type: PLAN; design/doc-only; HIGH-RISK-ADJACENT — governs a future packaging/dependency change).
Date: 2026-06-28. Branch: `evidence-a3-internal-deps-packaging-adr` (from `main` @ `f45f589`).
Artifact: `docs/adr/ADR-evidence-desktop-internal-deps-packaging.md` (DESKTOP-DEPS-00) + `dev-memo/deferred-audit-findings.md` (DESKTOP-DEPS-STALE-LOCK-01) + this queue.

## cc-suite invocation recording (per .claude/rules/cc-suite.md §"Required recording")
- **Kind:** review-plan · **Target scope:** the packaging ADR + defect record + this queue.
- **Resolved runner path:** `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs` (Path 1, foreground).
- **Model / effort / sandbox:** gpt-5.5 / high / read-only. **Retrievable:** YES (all `completed`).
- **Failure classification:** n/a. **Fallback:** n/a.

### Round log
| Round | Job ID | rawOutput sha256 (16) | Verdict | Fix applied |
|---|---|---|---|---|
| 1 | `review-plan-mqxux0nb-u32a86` | `309880f6ef463557` | NEEDS-FIX (Medium + 2 Low) | Diagnosis confirmed accurate. Medium: drift guard too narrow (LINK-grep only) → rewrote §6 to a semantic-payload comparison of both internal packages (extract committed tarballs vs freshly-staged source, normalized payload-hash compare ignoring tar/gzip/mtime/packedAt; LINK grep demoted to smoke). Low: Option 2 over-credited → §3 now states it doesn't preserve plain fresh-clone `npm ci`. Low: acceptance → §6 now also proves the `case-box-persistence` payload + its staged manifest dep on `case-box-contract:"0.1.0"` with no residual file:/link: specs. |
| 2 | `review-plan-mqxv0a1s-igjuau` | `7699f28ddd49c2e8` | **READY** | — |

## Verdict
**READY** (round 2). Reviewer confirmed: the defect diagnosis is accurate + grounded (lock pins `sha512-XFMRa8b…` stale vs current `sha512-9O4iETK…`; `npm pack` non-reproducible; `npm ci` EINTEGRITY / `npm install` silent-stale; clean packaged build ships a contract missing LINK_* → A3 link IPC broken); the 5 options are compared fairly; Option 1 (commit tarballs + semantic drift guard) is the right recommendation under the prior Option-2 tarball-install decision (`plan-desktop-package-architecture-00.md` rev-3); the drift guard + clean-build acceptance are now adequate (semantic payload compare + persistence-payload + staged-manifest-rewrite checks); no defect/architecture split required (stop-point 1 not triggered); the next-WI scope is concrete and unblocks D1. Reviewer also cross-checked the pack script and found the staged-rewrite requirement matches the actual mechanism.

QUEUE_REVIEW_VERDICT=PASS

## Post-authoring cc-suite records
### audit
- Kind: audit · Job ID: `audit-mqxv2nt5-7q5n5f` · completed (retrievable YES) · gpt-5.5/high/read-only
- rawOutput sha256: `49ba61417db49a490aa70ccb7ccff70d38d779cdbf927d81325bff89e0d01518`
- Result: **No Critical/High/Medium finding against the tracked diff** (docs/governance only; ADR internally consistent; DESKTOP-DEPS-STALE-LOCK-01 recorded open; LINK-IPC-T1-D1 open). One Medium caveat = untracked residue in the tree (not in the diff), resolved by exact-path staging.
### verify
- Kind: verify · consumed `/tmp/cleanup-reports/deps-audit.md`
- Round 1 `verify-mqxv4w4l-ba7xck`: flagged the intentionally-recorded open defect DESKTOP-DEPS-STALE-LOCK-01 as "open High" (scope misread — a design lane that RECORDS a defect open is correct; it is not an audit finding on the diff).
- Round 2 `verify-mqxv6xxt-ba8yr6` (scope clarified): **no genuine Critical/High/Medium audit finding against this WI's diff**; DESKTOP-DEPS-STALE-LOCK-01 + LINK-IPC-T1-D1 intentionally open, non-blocking; the only condition is performing the exact-path staging (done below). → audit findings CLOSED for this design ADR once the 7 allowed paths are staged.

Gates: check-contract-integrity PASS 14. No A0.7 custody (doc-only). The recorded defect DESKTOP-DEPS-STALE-LOCK-01 stays OPEN by design (fixed by the future WI-A3-INTERNAL-DEPS-COMMIT-TARBALLS-00).
