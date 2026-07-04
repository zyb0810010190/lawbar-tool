# Queue review — WI-FORMS-T3-S3-DOCX-EXPORT-00

Lane: Forms T3 slice S3 **DOCX renderer/dependency decision + governed-WI authoring** (Type: IMPL, future). Governance-authoring only — this lane produces the S3 decision ADR + the governed queue WI so a FUTURE lane can implement the T3 DOCX export. It implements nothing and adds NO dependency.
Date: 2026-07-04. Branch: `forms-t3-s3-docx-decision-governance` (from synced `main` @ `2b46696`). Batch: 1/3 since marker `1642a23` — no batch closeout this lane.

## What this is
The user explicitly resolved the prior new-runtime-dependency hard-stop in favor of the maintained `docx` npm package. Decision ADR: `dev-memo/adr-forms-t3-s3-docx-export.md` (choose `docx`; render EXCLUSIVELY from the merged S1 `T3CatalogModel`; main-process save-dialog delivery; normalized-OOXML golden; no PDF/T4-T5/A10-coupling/卷X页Y/evidence-write). The governed WI (`WI-FORMS-T3-S3-DOCX-EXPORT-00`) authorizes a FUTURE implementation: add `docx` (dependency-review-gated), a `T3CatalogModel → .docx` table builder, a main-process save-dialog export path (renderer never handles raw bytes), and a minimal 导出 DOCX trigger in the S2 preview.

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
All Path 1 runner foreground, resolved runner path `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`, retrievable YES (all envelopes `status:"completed"`), no failure class, no fallback. Governance-authoring lane → review-plan only (dependency-review + audit + verify are post-implementation and belong to the future S3 impl WI).

### review-plan (gpt-5.5/high/read-only; on the S3 decision ADR + the S3 WI)
- Attempt 1: `review-plan-mr62apje-4uviqo` · **NEEDS-FIX** (1 High, 2 Medium, 1 Low; `docx`-over-bespoke-OOXML choice confirmed sound) · sha256 `e7c68a4e4a9b8a39140a2f81343d026681d60ee418193291d7ca6dc169a5cadf`.
  - **H1** future IMPL commit boundary mixed this lane's governance artifacts (ADR/queue/review-125) into the code commit → FIXED: WI split into two lanes; the future IMPL commit is code-only and does NOT re-stage the ADR/queue governance/review artifact (records its chain in the commit message, per the S2 precedent).
  - **M1** dependency gate incomplete → FIXED: ADR §3 + WI Gates step 2 now require the dependency-risk review to clear `docx` + full transitive set for exact pin + integrity, license, no install/postinstall scripts, optional/peer surface, maintainer/release provenance, known advisories (`npm audit`/GHSA), package size/bundle impact, Node/Electron packaging compat (plus no native/network/template-exec).
  - **M2** export delivery path too open → FIXED: ADR §6 + WI DECIDE the main-process save-dialog path (renderer never handles raw `.docx` bytes) with explicit cancel ({written:false} no-op success), overwrite (OS dialog), `.docx` extension/filter, refusal (no document), error (inline `role="alert"`) semantics.
  - **L1** golden too loose → FIXED: ADR §5 + WI acceptance require BOTH a structural assertion AND a focused normalized-OOXML assertion (table header + row text), still forbidding raw-`.docx`-byte hashing (A10 invariant 9).
- Attempt 2 (re-review after fixes): `review-plan-mr62gi4j-o4kud9` · **substantively READY** — all six confirmations positive: (1) two-lane commit boundary correct; (2) dependency gate sufficient; (3) save-dialog delivery + semantics complete/safe; (4) golden requires both assertions + forbids raw-byte hashing; (5) scope contained (docx only, S1-model-only, no PDF/T4-T5/A10/卷X页Y/evidence-write/second-dep); (6) "WI text is governable after regenerating the governance sidecars and producing the named review artifact." · sha256 `8127bfc487bc3d2ac42732f53420e06c2b316402db08a56bfc279fe91d987cdd`.
  - The attempt-2 verdict line read NEEDS-FIX, but its ONLY residual finding was a **governance-sidecar freshness** observation (this `queue-review-125.md` not yet written; `queue.reviewed`/`queue.governed` not yet refreshed to the current `queue.md`) — a mechanical gap the reviewer explicitly said is closed by "regenerating the governance sidecars and producing the named review artifact." That is precisely this artifact + the `mark-queue-reviewed.sh` + `govern-queue.sh` step run immediately after it. No plan-content defect remains.
- Attempt 3 (confirmatory, on the fresh sidecars after mark-reviewed + govern): `review-plan-mr62kft5-bjg1ee` · **READY** — verified queue-review-125.md exists with exactly one QUEUE_REVIEW_VERDICT=PASS, queue.reviewed references it, and queue.governed `queue_sha256=2fe67af5…` matches the current queue.md; substantive points not reopened · sha256 `1b93c3146daa32128c94de5b8ddb18362b75c76cfee203e345f451f58a637c5c`.

## Verdict: READY (all substantive findings closed; sidecar gap closed by this artifact + govern)

QUEUE_REVIEW_VERDICT=PASS

## Gates (this authoring lane)
- `scripts/workflow/check-queue.sh` → PASS.
- `scripts/workflow/check-contract-integrity.sh` → PASS.
- `CURRENT_SCHEMA_VERSION` unchanged (12); no app/native/schema/contract/persistence/test/package code touched, and NO dependency added — this lane commits ONLY the decision ADR + queue governance + this review artifact.

## Deferred findings
None. Both review-plan Highs/Mediums/Low fixed in the ADR + WI before governance; the residual sidecar-freshness finding is closed by the govern step. The FUTURE S3 implementation WI still owes its own dependency-risk review + audit + verify (recorded then). T4/T5 remain design-gated.
