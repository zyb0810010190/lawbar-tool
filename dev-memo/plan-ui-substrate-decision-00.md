# Plan: UI Substrate / Framework Decision (RATIFIED — Electron)

> **DECISION PLAN — RATIFIED.** The Electron recommendation in §2 was **ratified by the user on 2026-05-23** against this plan at commit `b655b5f` on `origin/main`. See §"Ratification record" immediately below for the precise scope of what is and is NOT ratified. This document REMAINS plan-only: no UI code is authored, no dependency is installed in `package.json`, no renderer-framework / signing / notarization / distribution / telemetry / cloud-sync decision is made. Each follow-up implementation WI listed in §6 still requires SEPARATE explicit user authorization.

## Ratification record (revision 3)

**Date of ratification**: 2026-05-23.
**Ratifying decision**: the user, via the lane authorization message that triggered this revision, explicitly states: "Ratify Electron as the Mac-client UI substrate, based on the reviewed plan at `b655b5f0662f702c9136eeb0d04c80abc260a7c2`."
**Plan version ratified**: revision 2 (commit `b655b5f` on `origin/main`).
**Reviewed-and-READY status**: confirmed by cc-suite review-plan job `review-plan-mpj0bhaz-0v1u78` (Path 1 native --background; verdict READY with Low-risk clarifications; all 7 findings applied in rev-2).

### What IS ratified

- **The framework-choice STOP-AND-ASK item from `docs/product/project-requirements-brief.md` §20 line "Electron / Tauri / native runtime dependency"** is resolved in favor of **Electron** for the v1 Mac client substrate.
- The recommendation in §2 + reasoning in §1.2 + implications matrix in §3 + minimal first UI WI scope in §4 + follow-up WI list in §6 stand as the authoritative substrate baseline.

### What is NOT ratified (each remains a separate STOP-AND-ASK)

- **Adding `electron` to any `package.json`.** Ratification authorizes the FRAMEWORK CHOICE; it does NOT install the dependency. The first UI WI (§6 row 3) is the commit that introduces the `electron` dep and `electron-builder` dep. Each individual dep is its own STOP-AND-ASK at that WI's authorization.
- **Renderer UI framework choice** (React / Solid / Vue / Svelte / Lit / vanilla). §6 row 2 still requires user authorization.
- **Apple Developer ID acquisition / signing identity / notarization profile.** §6 row 6 + §3.7 — still STOP-AND-ASK.
- **Distribution channel** (Mac App Store / direct / in-firm IT). §6 row 7 + §3.8 — still STOP-AND-ASK.
- **Auto-update mechanism.** Brief §4 + brief §20 — manual download v1; auto-update post-v1.
- **All other brief §20 STOP-AND-ASK items** (brief §20 enumerates 21 items; Electron framework choice is ONE; **20 remain unresolved** — auth provider, cloud vendor, external document exposure, mini-program publication, sync bridge enablement, LLM enablement, renderer UI framework choice, document text-extraction engine choice, public deployment, code-signing identity + notarization profile, secret material handling, new runtime dependencies each individually, Apple Developer ID acquisition, per-document encryption-at-rest, hard-delete retention, tenant boundary widening, any external network surface beyond WI-03, real-data migration, monetization, redaction ADR). All 20 are inherited by reference per §5.

### Implications of ratification

- §6 WI #1 (user ratification) — **CLOSED by this commit**.
- §6 WI #2 (renderer-UI-framework decision plan) — UNBLOCKED; the user may now authorize this lane when ready.
- §6 WI #3 (first UI impl — `apps/lawbar-desktop/` greenfield) — UNBLOCKED in sequencing terms but BLOCKED until WI #2 ratifies the renderer choice AND until each new runtime dep is individually authorized at WI #3's authorization.
- §6 WIs #4 through #10 — sequencing unchanged; each remains separately authorized.
- The night-mode foundation plan at `dev-memo/plan-night-mode-foundation-00.md` §7 STOP-AND-ASK item #1 ("Desktop framework decision") is now RESOLVED; that plan's §8 WI #1 ("Plan: desktop framework decision") is correspondingly CLOSED.
- The `dev-memo/plan-client-00.md` §6 item #1 ("Desktop app framework") STOP-AND-ASK is RESOLVED in favor of Electron.

### Out of scope for this ratification record

- Editing `dev-memo/plan-night-mode-foundation-00.md` (a separate file; cross-reference only).
- Editing `dev-memo/plan-client-00.md` (a separate file; cross-reference only).
- Editing `docs/product/project-requirements-brief.md` (brief is READY revision 5; amendment uses `/project-brief` skill).
- Editing `dev-memo/plan-go-live-readiness-00.md` (a separate file; this ratification does NOT change any blueprint gate state).
- Editing any service / contract / test code.
- Adding `electron` to any `package.json`.
- `git push` (separate explicit authorization).

---

**Status**: READY (revision 3 — Electron substrate ratified by user against rev-2 at commit b655b5f on origin/main; §"Ratification record" added; document title + banner updated from "PLAN-ONLY RECOMMENDATION" to "RATIFIED — Electron"; recommendation in §2 + reasoning in §1.2 + implications matrix in §3 + first UI WI scope in §4 + follow-up WIs in §6 all preserved unchanged. rev-2 — Path 1 native --background rev-1 review returned READY (Low-risk clarifications) with 1 Medium + 6 Lows; rev-2 applied all 7: NEW §7 risk row #7 (Medium) — Electron native-module ABI/rebuild/notarization for `better-sqlite3` and OCR native deps; NEW §6 row 4.5 — Electron native-module packaging smoke runs BEFORE case-box screens (rev-1 reviewer R#1 + R#2); §1.1 explicit citations to AGENTS.md Repo Brief + Phase B SQLite completion at 98446aa (rev-1 reviewer M D3#1); §5 "by reference" wording clarified vs literal verbatim (L D2#2); §4 demo screen clarified as "TOKEN-COMPLIANCE FIXTURE, not product UI" (L D1#2); §3.1 vanilla-TS scope bounded to WI #3 only (L D4#2).).
**Date**: 2026-05-23.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Lane**: plan-only UI substrate / framework decision.
**Predecessor**: night-mode foundation at `7ad57ed`; legacy reconciliation amendments at `b5c7d9f`; blueprint at `1b92c58`; Phase B SQLite COMPLETE at `98446aa`.

## Review packet (compact)

### Active plan summary

`dev-memo/plan-client-00.md` §6 already opened the framework question and offered a brief Electron-leaning analysis. This decision plan formalizes that analysis: enumerates candidates, applies the repo's actual constraints (100% TypeScript ESM; case-box-persistence shipping `better-sqlite3` native binding; 1692/0 tests; ABI-pinned to Node 22+; pretest ABI smoke check), builds the implications matrix the lane authorization requires (renderer, runtime deps, local persistence, accessibility, testing, packaging, signing, distribution), and recommends **Electron** as the v1 Mac-client substrate.

The recommendation rests on ONE load-bearing constraint that no candidate other than Electron satisfies trivially: **the existing case-box-persistence + ocr-* services are Node-native TypeScript modules that depend on `better-sqlite3` (a native N-API binding pinned to Node 22+/24+/25+ via `services/ocr-persistence/scripts/abi-smoke.mjs`)**. Electron's main process IS a Node runtime — these modules drop in. Tauri (Rust main) and native macOS (Swift main) require a Node sidecar process + IPC-over-stdio-or-loopback to access them, which:

1. Re-introduces a network or stdio surface that the local-first posture (brief §6) is intentionally avoiding.
2. Doubles the failure modes (sidecar lifecycle, IPC marshaling, schema drift between Rust/Swift bindings and TS contract validators).
3. Adds a per-call marshaling cost on every persistence operation (case-box `listMatters`, `getMatterSummary`, `appendFact`, etc. — high-frequency).
4. Forces either (a) duplicating contract validators in Rust/Swift (banned by single-source-of-truth), or (b) marshaling every JSON payload through validation in BOTH the sidecar AND the renderer.

Electron preserves the existing service surface verbatim and uses Chromium for the renderer, which has the best macOS dark-mode + accessibility story among the candidates.

Plan-only file: `dev-memo/plan-ui-substrate-decision-00.md` (THIS FILE).

### Exact target files (THIS plan-WI)

CREATED (single file):
- `dev-memo/plan-ui-substrate-decision-00.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- `package.json` (root or any service).
- Any `node_modules/`.
- `dev-memo/plan-night-mode-foundation-00.md`.
- `dev-memo/plan-client-00.md`.
- `docs/product/project-requirements-brief.md`.
- `docs/adr/**`.
- `docs/ui/**`, `docs/release/**`.
- `services/**`, `docs/contracts/**`.
- AGENTS.md.

### Exact acceptance criteria (this plan-WI itself)

1. Plan committed alone (one file).
2. §1 enumerates ≥4 candidate substrates (Electron, Tauri, native macOS Swift, plus at least one "other justified option") with at least 5 criteria each.
3. §2 produces a recommendation with explicit load-bearing reasons; the recommendation is framed as a STOP-AND-ASK proposal for the user, not an autonomous commit.
4. §3 implications matrix covers all 8 axes the lane authorization names: renderer, runtime dependencies, local persistence, accessibility, testing, packaging, signing, distribution.
5. §4 identifies the **minimal first UI WI** that can implement theme tokens from line 1 (per night-mode foundation §5 + §8 WI #3).
6. §5 declares hard-stop inheritance from brief §20 without modification.
7. §6 lists bounded follow-up WIs; each requires SEPARATE user authorization.
8. cc-suite review-plan returns READY (or only Low-risk clarifications remain) via Path 1 native `--background`.

### Exact out-of-scope list

- **Implementing any UI scaffolding**, `package.json` change, dependency install, `npm init` of any app directory.
- **Choosing a renderer UI framework** (React / Solid / Vue / Svelte / Lit / vanilla) — flagged in §3 + §6 as a separate STOP-AND-ASK.
- **Apple Developer ID acquisition / code-signing identity / notarization profile / Mac App Store vs direct vs in-firm IT distribution** — all STOP-AND-ASK; this plan only documents the IMPLICATIONS of the framework choice on each.
- **Production deployment / real-data migration / auth provider / cloud vendor / legal-compliance / telemetry / cloud sync / external-document exposure** — all hard-stops; user-only.
- **Editing brief / ADRs / services / contracts / tests / other plans / readiness docs.**
- **`git push`** (separate explicit authorization).

### Essential references

- `dev-memo/plan-client-00.md` §3 (architecture decision matrix), §4.1 (primary v1 architecture), §6 (framework caveat — prior Electron-leaning quick analysis).
- `dev-memo/plan-night-mode-foundation-00.md` (READY at `7ad57ed` on `origin/main`) §1 (token-module shape), §5 (zero migration; first UI WI builds on tokens from line 1), §8 WIs 1-2 (framework + renderer decisions named there).
- `docs/product/project-requirements-brief.md` (READY revision 5) §3 (platform ranking), §4 (Mac app expectations), §20 (hard-stop list incl. framework + renderer + new runtime deps + signing).
- `dev-memo/plan-go-live-readiness-00.md` (READY at `1b92c58`) gate #3 (Mac-client surface) + gate #4 (distribution + signing).
- `dev-memo/plan-abi-00-better-sqlite3.md` — current `better-sqlite3` ABI pinning posture (Node 22+/24+ supported; 26+ requires bump WI).
- `AGENTS.md` §"Repo Brief" — `case-box-persistence` is Node 22.x or 24.x; `services/ocr-persistence/scripts/abi-smoke.mjs` runs as `pretest` and fast-fails on stale native binding.
- `docs/ui/current-ui-map.md` — baseline zero (no UI code in repo at any HEAD checked).
- `.claude/rules/autonomy.md` §"Hard-stop list" (new runtime dep; framework; signing).

### Review questions for the reviewer

1. **STOP-AND-ASK framing**: §2 RECOMMENDS Electron but explicitly says the user ratifies. Is the framing strong enough that the recommendation is not read as an autonomous commit?

2. **Load-bearing constraint**: §1.1 + §2 hang the recommendation on `better-sqlite3` + Node-native services. Is this load-bearing constraint accurate? Could case-box-persistence be ported to Rust (Tauri) or Swift (native) without major redo?

3. **Tauri-with-Node-sidecar dismissal**: §1.4 explicitly rejects the Tauri-with-Node-sidecar pattern on architectural grounds (IPC surface + marshaling cost + double validation). Is the rejection defensible, or should Tauri-with-sidecar remain a viable option in §2?

4. **Native macOS dismissal**: §1.5 dismisses native Swift on the same grounds plus the engineering-capacity profile shift. Is the dismissal defensible at v1, or should Swift remain a "long-term v2+" option?

5. **Other candidates**: §1.6 lists Neutralino, NWjs, Wails, Flutter Desktop, Sciter, Capacitor desktop as "other justified options" and dismisses each in 1-2 sentences. Are any unfairly dismissed?

6. **Minimal first UI WI**: §4 names the minimal first UI WI (greenfield `apps/lawbar-desktop/` with Electron + plain HTML/CSS/TS renderer + token module + System/Light/Dark + one demo screen). Is this minimal scope correct, or should it be even narrower (e.g., omit the demo screen)?

7. **Renderer UI framework**: §3 axis 1 (renderer) keeps the React-vs-Solid-vs-Vue-vs-Svelte-vs-Lit-vs-vanilla decision OPEN as a separate STOP-AND-ASK. Is this correct, or should this plan recommend one?

8. **Hard-stop inheritance**: §5 inherits brief §20 by reference. Are any §20 items left ambiguous by the framework decision?

---

## §1 Candidate substrates

Five candidates evaluated. Each scored against 8 criteria. The criteria are NOT weighted equally — §2 explains the load-bearing weighting.

### §1.1 Repo-constraint preface

Three constraints constrain every candidate before scoring:

1. **The existing services are Node-native TypeScript ESM.** Specifically (per rev-1 reviewer M D3#1 — citations to AGENTS.md §"Repo Brief" + the source files themselves):
   - `services/case-box-persistence` depends on `better-sqlite3` (a native N-API addon; AGENTS.md §"Repo Brief" pins to Node 22.x or 24.x and references the ABI smoke check at `services/ocr-persistence/scripts/abi-smoke.mjs` which runs as `pretest` and fast-fails on stale native binding). The case-box-persistence package's `package.json` declares the `better-sqlite3` dependency directly. Phase B SQLite implementation is COMPLETE at `98446aa` (B1-B11; Sqlite-Final 276/0; deterministic 1692/0).
   - `services/ocr-worker` depends on `@gutenye/ocr-node` (native OCR engine binding).
   - `services/ocr-persistence` depends on `better-sqlite3` (the canonical ABI-pinned consumer per AGENTS.md).
   - All packages are `type: "module"`, NodeNext, `node:test`.
   - `docs/contracts/case-box-contract` + `docs/contracts/` (ocr-worker-contract) are TypeScript ESM contract packages with Ajv validators.
2. **Reimplementing services in Rust/Swift is FORBIDDEN by single-source-of-truth.** The contract package owns the vocabulary; the persistence package owns the audit chain + state machine; reimplementing them in a second language guarantees drift.
3. **Brief §6 local-first posture FORBIDS introducing a network surface for the default workflow.** Sidecar-over-HTTP patterns therefore add a STOP-AND-ASK item the framework choice should avoid triggering.

### §1.2 Electron

| Criterion | Score | Notes |
|---|---|---|
| Hosts existing Node-native services without modification | **EXCELLENT** | Main process IS Node. `better-sqlite3` + Ajv validators + case-box-persistence drop in via `import`. Zero IPC marshaling between main and the services. |
| Mac dark-mode + accessibility | **EXCELLENT** | Chromium renderer with `nativeTheme` API; ARIA + macOS NSAccessibility bridge via Chromium; mature `prefers-color-scheme` support. |
| Bundle size | POOR | ~120-140MB after notarization. Lawyer downloads once. Acceptable for a desktop legal app. |
| Memory baseline | MEDIUM | ~200-300MB cold; Chromium + Node + renderer process(es). Acceptable on a modern Mac. |
| Mac code-signing + notarization story | EXCELLENT | `electron-builder` / `electron-osx-sign` are the de-facto path; well-documented; Apple Developer ID + notarization profile required (STOP-AND-ASK). |
| Testing | GOOD | Renderer testable with Playwright Electron; main testable with `node:test`; existing `services/**` tests stay unchanged. |
| Update cadence | MEDIUM | Electron version bumps required for Chromium security patches; manual download per brief §4 mitigates the urgency. |
| Long-term ecosystem risk | MEDIUM | Mature; backed by VS Code / Slack / etc.; no near-term deprecation risk. |

### §1.3 Tauri (Rust main + WKWebView)

| Criterion | Score | Notes |
|---|---|---|
| Hosts existing Node-native services | **POOR** | Rust main cannot embed Node modules. Requires Node sidecar process + IPC. See §1.4. |
| Mac dark-mode + accessibility | GOOD | WKWebView has good dark-mode + accessibility but varies by macOS version (older macOS = older WKWebView). |
| Bundle size | EXCELLENT | ~5-15MB. |
| Memory baseline | EXCELLENT | ~50-100MB. |
| Mac code-signing + notarization story | GOOD | Tauri docs cover Mac signing; less mature than Electron's ecosystem. |
| Testing | MEDIUM | Tauri E2E story is newer; sidecar-process testing adds complexity. |
| Update cadence | GOOD | Rust toolchain stable; Tauri stable since 1.0; smaller surface than Electron's Chromium. |
| Long-term ecosystem risk | MEDIUM | Younger ecosystem; Rust GUI long-term outlook positive but less battle-tested than Electron. |

### §1.4 Tauri-with-Node-sidecar (sub-variant of §1.3)

Tauri supports a "sidecar binary" pattern: bundle a Node executable as a sidecar; Rust main process spawns it; IPC over stdio or local-loopback.

| Criterion | Score | Notes |
|---|---|---|
| Hosts existing Node-native services | MEDIUM | Sidecar Node can host them. BUT IPC adds marshaling cost per call. |
| Mac dark-mode + accessibility | GOOD | Same as §1.3. |
| Bundle size | MEDIUM | Tauri (~10MB) + bundled Node (~50MB) + `better-sqlite3` native binding + OCR engine = ~70-100MB. Comparable to Electron but with two runtimes. |
| IPC surface | **POOR** | Stdio-or-loopback IPC reintroduces an attack surface the local-first posture is trying to avoid. Sidecar process lifecycle (start / restart / crash recovery) is a new failure mode. |
| Validation duplication | **POOR** | Either Rust must re-validate every payload (duplicating Ajv validators) OR the renderer must trust unvalidated Rust-relayed payloads. Both options are bad. |
| Per-call latency | POOR | Persistence reads (`listMatters`, `getMatterSummary`, `appendFact`, etc.) go renderer → Rust → stdio → Node → SQLite → Node → stdio → Rust → renderer. Adds 2-10ms per call vs Electron's ~0.1ms in-process call. |
| Testing | MEDIUM | Same as §1.3 plus sidecar tests. |
| Code-signing | MEDIUM | Tauri + bundled Node sidecar adds notarization complexity (signing both). |

### §1.5 Native macOS Swift (AppKit / SwiftUI)

| Criterion | Score | Notes |
|---|---|---|
| Hosts existing Node-native services | **VERY POOR** | Swift cannot host Node modules. Same sidecar pattern as §1.4 OR full Swift reimplementation of the persistence + contract validators (FORBIDDEN by single-source-of-truth). |
| Mac integration | **EXCELLENT** | Best macOS look, feel, accessibility, dark mode, font rendering, animation. |
| Bundle size | EXCELLENT | ~10-30MB. |
| Memory baseline | EXCELLENT | ~50-80MB. |
| Mac code-signing + notarization | EXCELLENT | Native Apple toolchain. |
| Engineering capacity | **POOR** | Swift skillset differs from TS; would split the codebase across two languages; staffing + CI + tooling overhead. |
| Renderer testing | POOR | XCUITest is heavier than Playwright; less integration with existing `node:test` patterns. |
| Long-term ecosystem risk | EXCELLENT | Apple-supported; SwiftUI maturing. |

### §1.6 Other candidates (dismissed in 1-2 sentences each)

- **Neutralino.js**: tiny embedded server + system webview. Web-renderer cross-platform story; for Mac specifically loses to Electron's `nativeTheme` integration and to Tauri's WKWebView use. No strong reason to pick.
- **NW.js**: Electron's older cousin. Smaller ecosystem; same trade-offs as Electron with less tooling. No reason to pick over Electron.
- **Wails (Go main + WKWebView)**: same sidecar problem as Tauri for Node services; Go skillset additional split.
- **Flutter Desktop**: forces a Dart codebase; everything else in the repo would orphan. Rendering is custom (not native widgets); macOS-specific affordances (NSToolbar, NSWindow chrome) are imperfectly mapped.
- **Sciter**: proprietary commercial GUI engine; license + ecosystem maturity not appropriate for a legal v1.
- **Capacitor desktop / Ionic desktop**: mobile-first heritage; Mac desktop posture is a side use case; doesn't fit a single-lawyer Mac product.
- **Raw Web Components in WKWebView via a thin Swift host**: equivalent to §1.5 + custom webview wiring; all the downsides of native Swift without the benefits.

---

## §2 RECOMMENDATION → RATIFIED

**RECOMMENDED** (rev-2): **Electron** (per §1.2). **RATIFIED** (rev-3, 2026-05-23): see §"Ratification record" at the top of this file. The reasoning + trade-offs + alternatives below stand as the authoritative record of the decision.

**Reasoning** (load-bearing first):

1. **Drop-in for the existing Node-native service surface.** Electron's main process IS a Node runtime; `case-box-persistence`, `case-box-contract`, `ocr-worker`, `ocr-persistence`, `ocr-ingestion`, `ocr-review` all `import` directly. `better-sqlite3`'s native binding (already ABI-pinned via `pretest`) runs unchanged. Ajv validators run unchanged. No IPC marshaling cost on persistence reads.
2. **No single-source-of-truth violation.** No need to reimplement validators / persistence in Rust or Swift, and no need to maintain a sidecar Node process. The contract package stays the sole vocabulary owner.
3. **Best Mac dark-mode + accessibility story among candidates with Node-native hosting.** `nativeTheme.shouldUseDarkColors`, `prefers-color-scheme`, ARIA + NSAccessibility bridge via Chromium.
4. **Mature Mac signing + notarization tooling.** `electron-builder` / `electron-osx-sign` are the established path; Apple Developer ID + notarization profile decisions are still STOP-AND-ASK (orthogonal).
5. **Acceptable bundle + memory cost.** 120-140MB bundle; 200-300MB cold memory. A single-lawyer Mac with 8GB+ RAM handles this without complaint. Lawyer downloads once per brief §4 (no auto-update v1).

**Trade-offs accepted by the recommendation**:

- Bundle size larger than Tauri / native Swift. v1 priority is shipping the correct case-box behavior, not minimizing binary size.
- Chromium memory baseline higher than WKWebView. Modern Macs absorb this.
- Periodic Electron-version bumps for Chromium security patches. Mitigated by brief §4 manual-download posture (no auto-update v1; the user controls when to upgrade).

**Alternatives explicitly ruled out**:

- **Tauri (with or without Node sidecar)**: §1.3 + §1.4. Sidecar pattern adds IPC surface (conflicts with brief §6 local-first), marshaling cost on high-frequency calls, and validation duplication problem.
- **Native macOS Swift**: §1.5. Single-source-of-truth violation OR sidecar pattern; engineering-capacity profile shift; long-term cost not justified for v1.
- **§1.6 others**: each dismissed in §1.6 with reason.

**STOP-AND-ASK status (rev-3 update)**: the framework-choice STOP-AND-ASK item from brief §20 "Electron / Tauri / native runtime dependency" is **RATIFIED** as Electron — see §"Ratification record" at the top of this file. Ratification clears the FRAMEWORK CHOICE only; **the first UI WI (§6 row 3) is the commit that introduces the `electron` dependency into a `package.json` AND each individual runtime dep (electron, electron-builder, etc.) remains its own SEPARATE STOP-AND-ASK at that WI's authorization** per `.claude/rules/autonomy.md` §"Hard-stop list" + brief §20 "New runtime dependencies (each individually)". This plan does NOT install any dependency; this plan does NOT author UI code.

---

## §3 Implications matrix (8 axes per lane authorization)

### §3.1 Renderer

Electron renderer is a Chromium WebView with full HTML/CSS/TS support. **Renderer UI framework choice (React / Solid / Vue / Svelte / Lit / vanilla TS) remains a SEPARATE STOP-AND-ASK** per brief §20. The night-mode foundation plan's token-module shape is framework-agnostic; it works with any of them.

Plan picks (recommendation only, NOT a decision): **plain HTML + CSS custom properties + vanilla TypeScript** for the FIRST UI WI ONLY (per rev-1 reviewer L D4#2 — vanilla-TS scope is bounded to WI #3 in §6; product-feature screens after that warrant a renderer framework). Rationale:

- Smallest possible first slice.
- Token module + CSS custom properties bridge already covers theming without any framework.
- Avoids triggering ANOTHER brief §20 STOP-AND-ASK in the first UI WI.
- A renderer framework can be added later without rewriting the token module.

Beyond WI #3 (app shell + tokens + demo screen): a renderer framework is expected. WI #2 (§6) authorizes that decision.

Reviewer may push back: "vanilla TS will not scale past a few screens — pick now". Plan accepts that pushback as legitimate; the user decides at WI authorization time.

### §3.2 Runtime dependencies

The framework choice triggers brief §20 item "Electron / Tauri / native runtime dependency" — **this plan does NOT install `electron` as a dependency**. The first UI WI does. Specifically, when authorized, the first UI WI would add:

- `electron` (devDependency in `apps/lawbar-desktop/package.json`) — the framework itself.
- `electron-builder` OR `@electron-forge/cli` (devDependency) — Mac packaging + signing path. **Tool choice is a sub-decision**: `electron-builder` is more mature for Mac; `electron-forge` is Electron's official maintained path. Plan picks `electron-builder` for the first UI WI; reviewer may push back.

Both deps are STOP-AND-ASK per `.claude/rules/autonomy.md` §"Hard-stop list" + brief §20 "New runtime dependencies (each individually)". The first UI WI's plan-WI must explicitly list each new dep and the user must explicitly authorize each.

**No new runtime dep is added by THIS plan.**

### §3.3 Local persistence

Case-box persistence is unchanged. Electron's main process embeds `services/case-box-persistence` directly; SQLite database lives at the brief §4 path `~/Library/Application Support/lawbar/lawbar.db` (or equivalent; exact filename a sub-decision in the first UI WI).

Theme preference (per night-mode foundation §3.2) lives at the same data path, separate file: `~/Library/Application Support/lawbar/theme-preference.json`.

No cloud persistence. No sync. No telemetry. (Brief §6 + §20.)

### §3.4 Accessibility

Electron's Chromium renderer bridges DOM ARIA → macOS NSAccessibility automatically. The first UI WI must:
- Use semantic HTML (`<button>`, `<nav>`, `<main>`, `<label for>`, etc.).
- Provide visible focus rings (per night-mode foundation §1 token #12 `focus-ring`).
- Test with VoiceOver before the first UI WI ships.

VoiceOver testing is a manual gate; no CI-automatable accessibility tool is added in v1 day-one. A future WI may add an automated audit (e.g., `@axe-core/playwright`) but that introduces a new runtime dep and is its own STOP-AND-ASK.

### §3.5 Testing

Three test layers expected (each a sub-decision in the first UI WI):

1. **Main-process tests** — reuse `node:test`. The main process is Node; existing `services/**` tests stay unchanged.
2. **Renderer-unit tests** — depends on renderer-framework choice. If vanilla TS per §3.1, then `node:test` + `jsdom` (if added; another STOP-AND-ASK) OR no renderer-unit tests v1 (rely on E2E).
3. **End-to-end tests** — Playwright supports Electron via `_electron.launch()`. Adds Playwright as devDependency (STOP-AND-ASK).

Plan picks: for the FIRST UI WI, only main-process tests + a smoke E2E test using `_electron`. Renderer-unit tests added in a later WI when complexity warrants.

### §3.6 Packaging

`electron-builder` produces `.app` and `.dmg` artifacts. The brief §4 expectation is a single `.app` bundle installed to `/Applications`. The first UI WI:
- Produces an unsigned `.app` for dev (works for the lawyer's own machine if `Gatekeeper` is bypassed manually — devs-only).
- Configures `electron-builder` for the final signed flow but does NOT sign in CI (signing requires Apple Developer ID — STOP-AND-ASK; orthogonal).

Notarization configuration is wired but inactive until signing identity arrives (STOP-AND-ASK).

### §3.7 Signing

**Code-signing identity + notarization profile + Apple Developer ID acquisition: STOP-AND-ASK** per brief §4 + §20. The first UI WI does NOT sign or notarize. The user opens a separate sub-WI when ready to ship to lawyers.

Plan picks: until signing is authorized, the `.app` is dev-only and may NOT be distributed beyond the lawyer's own machine.

### §3.8 Distribution

**Manual download v1** per brief §4. **NO auto-update v1**. The user downloads a `.dmg` from a (yet-to-be-determined) distribution channel — Mac App Store vs direct vs in-firm IT — each a STOP-AND-ASK per brief §20.

Plan picks: for the FIRST UI WI, the `.dmg` is a local artifact in the build output; distribution channel decision is deferred.

---

## §4 Minimal first UI WI

Per the lane authorization "Identify the minimal first UI WI that can implement theme tokens from line 1":

**WI name suggestion**: "first-ui-app-shell-electron" (final name when authorized).

**Scope (minimum viable)**:

1. NEW directory `apps/lawbar-desktop/`:
   - `package.json` — private; `type: "module"`; `electron` + `electron-builder` devDeps (each STOP-AND-ASK).
   - `electron/main.ts` — main process; spawns BrowserWindow; loads renderer; persists theme preference per night-mode foundation §3.2.
   - `electron/preload.ts` — contextBridge; exposes the narrow IPC surface (initially: `getTheme`, `setTheme`).
   - `renderer/index.html` — single empty `<main>` with `<title>` + `<meta charset>`.
   - `renderer/index.css` — bootstraps CSS custom properties from token module.
   - `renderer/index.ts` — applies the active palette; listens for OS appearance changes; renders ONE demo screen showing all 12 tokens. **Clarification per rev-1 reviewer L D1#2**: the demo screen is a TOKEN-COMPLIANCE FIXTURE, not product UI — it exists solely to prove every token renders correctly in both modes, NOT to ship a feature.
   - `src/theme/tokens.ts` — exports `ThemeTokens` + light + dark palettes per night-mode foundation §1 + §2.
   - `src/theme/applyTheme.ts` — hydrates CSS custom properties from `ThemeTokens`.
   - `tests/main.test.mjs` — main-process smoke test (theme preference round-trip).
   - `tests/smoke.electron.test.mjs` — Playwright Electron smoke (window opens; demo screen renders; Light → Dark toggle works).

2. NO connection to case-box-persistence yet. The first UI WI is **app shell + theme only** — it proves the substrate works, NOT that case-box reads run through it.

3. NO renderer UI framework. Vanilla TS + plain HTML/CSS only (per §3.1).

4. NO code signing, NO notarization, NO distribution channel (per §3.7 + §3.8).

5. NO `.app` bundle ships beyond the developer's own Mac.

**Acceptance criteria** (when this WI is later authorized):

- Window opens; closes cleanly.
- Demo screen shows all 12 tokens.
- System / Light / Dark switching works per night-mode foundation §3.
- Theme preference persists per night-mode foundation §3.2.
- Focus ring visible on every interactive element.
- VoiceOver reads the demo screen (manual gate).
- `npm --prefix apps/lawbar-desktop test` exits 0.
- `npm --prefix apps/lawbar-desktop run build` produces a `.app` artifact.
- No raw color literals outside `src/theme/**` (per night-mode foundation §4; enforced by lint added in the same WI OR a manual audit per night-mode foundation §5).

The first UI WI is **medium-risk**: it introduces the framework dependency (STOP-AND-ASK) and the renderer-stack pattern. It is the canonical example of work that the user explicitly authorizes per-dep + per-tool sub-decision.

---

## §5 Hard-stop inheritance

All 23 STOP-AND-ASK items in `dev-memo/plan-go-live-readiness-00.md` §4 (which inherits brief §20) are inherited by this plan **by reference without modification** (per rev-1 reviewer L D2#2 wording fix — "by reference" is accurate; the items themselves live in the blueprint and brief, not restated here). None is relaxed. The subset enumeration below highlights which items this plan SPECIFICALLY triggers; the others remain inherited even though they are not listed.

Items specifically triggered by the framework decision (each requires explicit user authorization at the first UI WI):

1. **§4.1 #5 Electron / Tauri / native runtime dependency** — this plan RECOMMENDS Electron; the user RATIFIES at first UI WI authorization.
2. **§4.1 #6 Renderer UI framework choice** — deferred to a SEPARATE STOP-AND-ASK in a later WI. The first UI WI uses vanilla TS to avoid triggering this in v1 day one.
3. **§4.1 #10 New runtime dependencies (each individually)** — `electron`, `electron-builder`, and any test tooling (Playwright, etc.) are each individual STOP-AND-ASK items at first UI WI authorization.
4. **§4.1 #8 Code-signing identity + notarization profile** — orthogonal; flagged in §3.7 + §3.8.
5. **§4.1 #11 Apple Developer ID acquisition** — orthogonal; flagged in §3.7 + §3.8.

Items NOT triggered by THIS plan (none):
- Auth provider choice (brief §20 #1) — UI substrate is auth-agnostic v1 (single-lawyer; `actor_user_id = "local-user"`).
- Cloud vendor choice (#2) — no cloud surface in v1 UI.
- Mini-program publication (post-v1).
- Sync bridge enablement (post-v1).
- LLM enablement (post-v1).
- Real-data migration (forbidden v1).
- Monetization decisions (post-v1).
- All other §20 items.

---

## §6 Suggested follow-up WIs (each requires SEPARATE explicit authorization)

This plan executes none. The user authorizes each individually.

| # | Suggested follow-up WI | Phase | Risk | Predecessors |
|---|---|---|---|---|
| 1 | ~~**User ratification** of the Electron recommendation~~ — **CLOSED 2026-05-23** by ratification recorded at top of this file (rev-3) | Decision | n/a | This plan READY |
| 2 | Plan: renderer-UI-framework decision (vanilla / React / Solid / Vue / Svelte / Lit) | Plan | **STOP-AND-ASK** on framework + new runtime dep | WI 1 |
| 3 | Impl: first UI WI per §4 — `apps/lawbar-desktop/` greenfield app shell + token module + System/Light/Dark + demo screen | Impl | Medium; **STOP-AND-ASK** on each new runtime dep (electron, electron-builder, Playwright) | WIs 1 + 2 |
| 4 | Plan: case-box IPC contract (renderer ↔ main; the narrow IPC surface for `listMatters`, `getMatterSummary`, etc.) | Plan | Medium | WI 3 |
| 4.5 | **Impl: Electron native-module packaging smoke** — `electron-rebuild` wires `better-sqlite3` against Electron's Node ABI; smoke test loads `case-box-persistence` + opens a SQLite DB in the packaged `.app` and exits 0. Per rev-1 reviewer R#1+R#2 — runs BEFORE case-box screens to surface ABI/signing failures early. | Impl | **Medium** (native-module ABI risk) | WI 3 |
| 5 | Impl: case-box-aware screens (list matters; matter summary; etc.) | Impl | Medium | WIs 4 + 4.5 |
| 6 | Plan: code-signing + notarization onboarding | Plan | **STOP-AND-ASK** on Developer ID, notarization profile, signing identity | brief §20 |
| 7 | Plan: distribution channel decision (Mac App Store vs direct vs in-firm IT) | Plan | **STOP-AND-ASK** on distribution choice | brief §20 + WI 6 |
| 8 | Plan: lint rule for "no raw color literals" (per night-mode foundation §4.2) — depends on WI 2 tooling choice | Plan | Low | WI 2 |
| 9 | Plan: CI contrast check (per night-mode foundation §6 + §8 WI 5) | Plan | Low; STOP-AND-ASK if new runtime dep needed | WI 3 |
| 10 | Plan: accessibility audit + VoiceOver test plan | Plan | Low | WI 3 |

---

## §7 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Medium | Plan is read as autonomous framework commit rather than STOP-AND-ASK proposal. | Top-of-file DECISION-PLAN-ONLY banner; §2 explicit "user ratifies"; §3.2 explicit "no new runtime dep added by THIS plan"; §6 WI 1 = "user ratification" not "implement". |
| 2 | Medium | Tauri-with-Node-sidecar dismissal in §1.4 may be over-confident — Tauri's sidecar story is improving. | §1.4 + §2 list specific failure modes (IPC latency, validation duplication, lifecycle). Review question #3 invites reviewer pushback. |
| 3 | Low | The "vanilla TS first" recommendation in §3.1 may not survive contact with reality (e.g., the first WI's demo screen reveals a need for a renderer framework on day 1). | §3.1 says reviewer pushback accepted; user decides at WI authorization. |
| 4 | Low | The 120-140MB Electron bundle may be a brief-§4 concern not yet surfaced. | §2 trade-offs section names this; lawyer's manual-download single-event mitigates. |
| 5 | Low | A future macOS version (e.g., 16+) may deprecate WKWebView features that other candidates rely on, but NOT Chromium. Risk for Electron is the inverse: future Electron may bump min-macOS. | Brief §4 manual-download posture lets the user control upgrade cadence; no auto-update v1. |
| 6 | Low | Brief §20 explicit non-relaxation means this plan inherits 23 items it does not need to actively check. If a future amendment to this plan relaxes one accidentally, the inheritance is silent. | §5 explicit list of triggered items; reviewer can spot a relaxation by diffing §5 vs blueprint §4. |
| 7 | **Medium** (added per rev-1 reviewer R#1) | Electron uses its own Node/V8 build, which may not be ABI-compatible with the Node version `better-sqlite3` (and `@gutenye/ocr-node`) is built against. The first UI WI must rebuild native modules for Electron's Node ABI (`electron-rebuild` / `@electron/rebuild`) AND notarize the rebuilt binaries. Failure mode: working in dev but crashing in the signed `.app`. | First UI WI (§4) acceptance MUST include: (a) `electron-rebuild` in the build pipeline; (b) a packaging smoke test that loads `case-box-persistence` + opens a SQLite DB in the packaged `.app`; (c) per rev-1 reviewer R#2 sequencing fix: this native-module packaging smoke runs BEFORE case-box-aware screens are built (i.e., before §6 WI 5). |

No Critical / High risks.

---

## §8 References

- `dev-memo/plan-client-00.md` §3-§6 (architecture decision matrix; framework caveat).
- `dev-memo/plan-night-mode-foundation-00.md` (READY at `7ad57ed` on `origin/main`) §1, §3.2, §4, §5, §8.
- `docs/product/project-requirements-brief.md` (READY revision 5) §3, §4, §6, §20.
- `dev-memo/plan-go-live-readiness-00.md` (READY at `1b92c58`) gate #3, #4, §4 (23 STOP-AND-ASK items).
- `dev-memo/plan-abi-00-better-sqlite3.md` — `better-sqlite3` ABI posture.
- `AGENTS.md` §"Repo Brief".
- `docs/ui/current-ui-map.md` — baseline zero.
- `.claude/rules/autonomy.md` §"Hard-stop list".

---

## §9 Stop condition

This plan is stale or superseded when:
- The user ratifies the recommendation (or selects a different substrate) — the plan becomes "decision recorded; superseded by WI #1 reply".
- The first UI WI (§6 row 3) ships an `apps/lawbar-desktop/` and adds `electron` as a dep — the plan becomes "decision implemented; superseded by `<WI commit hash>`".
- Brief §3 or §4 is amended in a way that invalidates the Mac-desktop posture.
- A subsequent technical discovery invalidates the load-bearing constraint in §1.1 (e.g., a Rust port of `better-sqlite3` with identical ABI + a Tauri tooling story that drops the sidecar pattern).
