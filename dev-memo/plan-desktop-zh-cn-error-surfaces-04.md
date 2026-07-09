# Plan — WI-DESKTOP-ZH-CN-ERROR-SURFACES-04

**Type**: UI (i18n — error surfaces). **Design artifact**: `dev-memo/design/2026-07-09-desktop-zh-cn-settings-entry.md`.
Follows `WI-DESKTOP-I18N-DEAD-LABELS-03` (merged `120ebdc`). Closes the WI-01-declared out-of-scope gap
(main-process `errorMap.ts` safe messages / rare IPC-failure paths).

## Goal

Make rare-but-user-visible desktop error copy Chinese, while preserving internal error codes, main-side
diagnostics/logs, schema/IPC compatibility, and the safe-message contract (no raw stack/SQL/path/identifier
reaches the renderer).

## Approach — localize at the DISPLAY layer, keyed by the stable code

The main process returns `{ kind: "case_box_persistence_error", code, message }` where `code` is the stable
`CaseBoxPersistenceErrorCode` and `message` is a generic English safe string kept for main-side
`console.error` diagnostics. The renderer was displaying `env.error.message` (English) at ~30 sites. This WI
adds a small stable mapping layer in the renderer — `renderer/i18n/errorMessage.ts`
`errorMessage(error)` → `t("error.<code>")` (zh-CN catalog) with `error.unknown` as the fallback — and
rewires every display site to `errorMessage(env.error)`.

Main process is unchanged: codes stay English, `message` stays English for logs, IPC channel names and
schema enum values are untouched, no contract data value is localized. The renderer never shows the raw
`message` — only the code-keyed generic zh-CN string (strengthens the safe-message contract: even a leaky
`message` carrying SQL/paths/identifiers is not surfaced).

## Changes

- `renderer/i18n/errorMessage.ts` (new): `errorMessage({ code })` — known code → `error.<code>`; unknown /
  missing → `error.unknown`. Guards `t()` (which throws on a missing key) via a known-code set.
- `renderer/i18n/catalog.ts`: 13 new `error.*` keys (12 codes + `error.unknown`).
- 11 screens: replaced `env.error.message` / `envSubmit.error.message` (29 sites) with
  `errorMessage(env.error)` + the import. No other logic changed.
- Tests: 25 error-envelope display assertions updated to the zh-CN `CATALOG["error.<code>"]` (kept role=alert
  / no-refresh / no-nav / DTO-passthrough / button-re-enabled); the two "HTML-shaped … echoed safely" tests
  now also assert the raw message is ABSENT (raw detail not exposed). New `renderer-error-message.test.mjs`
  proves: every code → zh-CN, unknown → fallback, raw diagnostic message never surfaced. Allowlist
  regenerated (display-site line shifts only; count unchanged).

## Error surfaces found / localized / intentionally-English

- **Localized (display)**: every renderer error banner/alert/status — create/archive matter, matter detail
  envelope error, list-matters, and the sub-screens (audit / documents / deadlines / facts / docket / links
  / T3) — all now render the zh-CN code-mapped message.
- **Intentionally English (internal, not user-visible)**: `errorMap.ts` `SAFE_MESSAGES` + custom
  `makeInvalidPayload` messages (main-side logs / diagnostics), the stable `code` values, IPC channel names,
  `console.error` output. These are contract/diagnostic, not user copy.
- **Out of scope**: T3 refusal-code surface (`T3RefusalCode`) is already zh-CN via `viewT3.refusal.*` — not
  an IPC error envelope; untouched. FileVault launch-block dialog is a native pre-window main-process dialog
  (not a renderer surface).

## Acceptance (to verify)

- user-facing English (static guard) **0 → 0** (error display is a runtime value, not a static literal; the
  guard is unaffected — this WI localizes the runtime path the static guard cannot see).
- allowlist count **100 → 100** (regen = display-site line shifts only).
- `npm --prefix apps/lawbar-desktop test` green; `npm run dist` success; packaged smoke green (renderer error
  behavior changed).

## Guard conditions

safe user-facing error copy is Chinese ✓ · internal code/key stable ✓ · raw underlying detail not exposed ✓
(`renderer-error-message.test.mjs`) · success flows unchanged ✓ · i18n guard still 0 user-facing ✓ · no
schema enum / contract value localized ✓.

## cc-suite audit — verdict PASS (after one TIMEOUT + retry)

- **Retry (authoritative)**: job `audit-mrcyxa5p-3a2e3p` — **PASS, no findings** (Path 1 runner, gpt-5.5/high/
  read-only). Confirmed: (1) safe-message contract preserved — no remaining `env.error.message` / `.details`
  display path; (2) unknown/missing codes fall back to `error.unknown` without a `t()` throw; (3) no missed
  display site; (4) no contract enum / IPC channel / error code localized internally (main process + catalog
  keys stay English); (5) no behavior change beyond the display string; `tsc --noEmit` passed.
  - **Low (non-blocking) → RESOLVED in-WI**: the renderer duplicated the persistence error-code list
    (because `CaseBoxPersistenceErrorCode` is a type-only export). Added a **contract-sync test**
    (`renderer-error-message.test.mjs`) that parses `case-box-persistence/dist/errors.d.ts` and asserts the
    renderer's exported `KNOWN_ERROR_CODES` matches the union EXACTLY and every code has an `error.<code>`
    catalog key — so a future persistence code addition fails the build until the renderer + catalog keep up.
- **First attempt (superseded)**: job `audit-mrcxqk87-clyhpu` — FAILED `spawnSync codex ETIMEDOUT`
  (class TIMEOUT; terminal envelope, not HARNESS_REAP; Codex was momentarily unresponsive under parallel
  load). Recorded in `dev-memo/cc-suite-reliability-log.md`. The retry above supersedes the interim
  self-review; the self-review's findings matched the broker verdict.

### Interim self-review (retained for the record; superseded by the PASS above)

- **Kind**: audit. **Scope**: `errorMessage.ts` + catalog `error.*` + representative screen wiring + the
  "no remaining `.error.message`" proof. **Runner**: Path 1 (`codex-runner.mjs` 0.2.18), gpt-5.5/high/read-only.
- **Job ID**: `audit-mrcxqk87-clyhpu`. **Outcome**: FAILED — `spawnSync codex ETIMEDOUT`. **Failure class**:
  TIMEOUT (terminal `status:"failed"` envelope written — NOT a HARNESS_REAP; the runner reached its failure
  branch and returned; Codex was unresponsive/slow this session). Recorded in `dev-memo/cc-suite-reliability-log.md`.
- **Fallback**: this is a non-high-risk WI (display-layer i18n; not persistence/security-boundary/crypto/
  cloud/public-API/migration/LLM). Per `.claude/rules/cc-suite.md` §"Low-risk WIs" the broker being
  unavailable permits a recorded self-review. Self-review:
  1. **Why cc-suite could not run**: Path 1 audit returned `spawnSync codex ETIMEDOUT`; Codex unresponsive
     this session (four prior audits ran earlier; this one and the parallel batch load timed out).
  2. **Scope reviewed**: `renderer/i18n/errorMessage.ts`, the catalog `error.*` block, and the 11 screen
     wirings.
  3. **Findings** (positive):
     - **Safe-message contract preserved/strengthened**: `grep '.error.message' renderer/screens` = 0 — no
       site still shows the raw main-side message; `errorMessage` returns ONLY a catalog constant keyed by
       `code`. `renderer-error-message.test.mjs` asserts a leaky raw message (SQL / `Application Support`
       path / `tenant=` / `<script>` / identifier) is NOT present in the output.
     - **No `t()` throw on unknown/missing code**: guarded by a known-code `Set` → routes to `error.unknown`
       (unit-tested).
     - **No internal localization**: main-process `errorMap.ts` untouched; codes + English `message` (logs)
       + IPC channel names + schema enum VALUES unchanged. Only `renderer/i18n` + screen display sites changed.
     - **Behavior otherwise unchanged**: the 25 updated display tests keep role=alert / no-refresh / no-nav /
       button-re-enabled / DTO-passthrough; packaged smoke green.
  4. **Why acceptable**: low-risk display i18n; the one security-adjacent property is directly unit-tested
     and passing; the change is mechanical (one display-call swap) across screens.

## Out of scope

Backend/main-process error text, schema, settings redesign, UI visual redesign, new i18n surfaces.
