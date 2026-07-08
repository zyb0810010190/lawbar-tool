# User Decision Record — remaining user-owned gates (gates 4/7/11/17/21)

**Status:** records the user's explicit decisions on the five user-owned go-live gates. **Date:** 2026-07-08. **Authority:** these are the **user's own STOP-AND-ASK decisions** (`.claude/rules/autonomy.md` hard-stop list) — this document RECORDS them; the agent decided nothing. **Governed by:** `dev-memo/run/queue.md` (queue.governed sha256 `c2afd998…`, WI-RELEASE-USER-DECISION-RECORD-00, PR #232 merge `fd1e5aa`), review `dev-memo/run/reviews/queue-review-177.md`.

**Overall product status per these decisions: INTERNAL / DEV USE authorized; NO PUBLIC GO-LIVE.** Public distribution + 律师法 confidentiality + external license/privacy review remain the user's, pending, for any external release. This record asserts **no external-distribution readiness and no public go-live**.

---

## Gate 4 — Distribution / signing / notarization
**Decision (user):** **A — internal/dev-use only.** No public distribution, no notarized release, no external download. The current unsigned local build (`mac.target: dir`, `identity: null`) may be used by the user internally. Signing / notarization / public distribution remain **deferred**.
**Recorded status:** **internal-use recorded; public-distribution gate deferred.** No signing/notarization/distribution action or `electron-builder` config change was taken. Gate 4 (public) stays user-owned.

## Gate 7 — Mutation-test / robustness policy (risk acceptance)
**Decision (user):**
- **D-G7-1 = YES** — accept v1 without mutation testing.
- **D-G7-2 = YES** — accept the completed crash-recovery drill as sufficient for v1.
**Preserved residuals (accepted internal-v1 residuals — not erased, not reclassified as solved):**
- **R-DRILL-2** — no storage-level power-loss / torn-WAL proof; the drill exercised abrupt process death (`kill -9`), WAL was 0 bytes at kill.
- **R-DRILL-1** — v1 uses a single `case-box.sqlite` (audit tables inside it), not the brief §14 two-file model.
- Mutation / fuzz testing deferred post-v1.
**Recorded status:** gate 7 **CLEARED** — the user's D-G7-1 YES + D-G7-2 YES satisfy gate 7's user-owned clearance condition, on the crash-recovery-drill PASS (`docs/release/gate7-crash-recovery-drill-00.md`) + the robustness policy (`gate7-robustness-policy-00.md`), with the residuals above accepted as non-blocking for internal v1. (Gate 7's clearance is the user's risk-acceptance; the agent did not decide it.)

## Gate 11 — 律师法 confidentiality / legal compliance
**Decision (user):** **NOT cleared.** No legal conclusion. Internal/personal use only until legal review / sign-off.
**Recorded status:** gate 11 **NOT cleared; internal-use-only until legal review.** No legal conclusion is stated in this record or by the agent. The engineering evidence (local-first/offline storage, no network egress per gate 20, a tamper-evident audit chain per gate 12, privilege/classification fields) exists as facts; whether it satisfies 律师法 confidentiality/compliance is the user's / their counsel's legal judgment, pending.

## Gate 17 — License / copyright / privacy
**Decision (user):** proprietary / internal-use posture; add LICENSE (proprietary), NOTICE (MIT dependency attributions), and a local-only privacy note. No public-OSS licensing assumption; no external-distribution-readiness claim.
**Deliverables authored (docs-only):**
- Root `LICENSE` — proprietary / all-rights-reserved / internal-use-only, with `Copyright (c) 2026 [COPYRIGHT HOLDER — to be confirmed]. All rights reserved.` (a deliberate **placeholder** — NOT invented, NOT the git identity — to be replaced before any external distribution).
- Root `NOTICE` — third-party attributions for the production + primary build dependencies (all MIT / Apache-2.0; the two first-party in-repo packages noted).
- `docs/release/privacy-notice-00.md` — the local-only v1 privacy note.
**Recorded status:** gate 17 **CLEARED for internal-use posture only.** The external-distribution license/attribution/privacy review (full transitive attribution / SBOM / public privacy policy) is a **separate future review** — not done, not claimed here.

## Gate 21 — Final go-live sign-off
**Decision (user):** **NO PUBLIC GO-LIVE.** Internal-use-only status may be recorded. The final PUBLIC GO remains blocked until gates 4, 11, and 17 are resolved **for external release**.
**Recorded status:** gate 21 **internal-use recordable; public GO blocked.** The report stays **INTERIM** for public go-live; gate 21 stays STOP-AND-ASK / BLOCKED for the final public sign-off. **Internal / dev use is authorized by the user (2026-07-08); no public go-live is asserted.**

---

## What remains for a future EXTERNAL release (the user's, pending)
- **Gate 4** — Apple Developer ID + code-signing + notarization + a distribution-channel choice; wire signing into `electron-builder` (a separate WI, needs the user's credentials).
- **Gate 11** — the 律师法 confidentiality/compliance legal sign-off.
- **Gate 17** — replace the `LICENSE`/`NOTICE` copyright placeholder with the exact holder; complete a full transitive attribution / SBOM + a public privacy policy; the license choice for external distribution.
- **Gate 21** — with 4/11/17 resolved for external release, the user fills the final public go-live verdict.

Optional post-v1 (non-blocking): R3-FUP-1/R3-FUP-2; electron-builder dev-toolchain advisory monitoring; an SBOM.
