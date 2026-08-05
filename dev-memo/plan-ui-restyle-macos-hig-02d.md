# PLAN — WI-UI-RESTYLE-2d: hide the audit-chain UI panel (mechanism preserved)

**Type:** UI (removes a display panel; NO logic/persistence change). **Status:** DRAFT.
**Branch:** `feature/pta-claimtrack-vertical-slice` (local; no push). **Design artifact:**
`dev-memo/design/2026-08-04-app-restyle-macos-hig.md` §2.5. Authorized by Frank (2026-08-04 "我不需要审计链",
confirmed as the hide-the-UI-panel reading + subsequent "go on"s).

## 1. Scope (REVISED after implementation surfaced the true blast radius; Frank chose full removal 2026-08-05)
The "audit chain" is not a one-line row — `renderChainHeadDisclosure` (in `viewMatterAudit.ts`) is a full in-app
**audit-events browser** (chain-head hash + copy, paginated event list, aria-live) and is the sole producer of all
`view-chain-*` / `view-audit-*` test-ids; **14 tests** depend on it. Frank authorized removing the **whole in-app
audit view**. The persistence audit-chain **mechanism stays completely untouched** (append-only chain, state-hash
continuity, verifyAuditChain, all audit-event kinds, export) — a critical court-facing invariant; this WI removes
only the on-screen view of it.

### Target files
- `apps/lawbar-desktop/renderer/screens/viewMatter.ts` — remove the import (L25), the `const chainHeadDetails =
  renderChainHeadDisclosure(...)` (L418), and its insertion into the right-column colophon `aside` (L506). Leave
  the rest (colophon id/created rows, archive zone) intact. Do NOT touch the colophon `§` marker (WI-2c scope).
- **DELETE** `apps/lawbar-desktop/renderer/screens/viewMatterAudit.ts` — its sole importer is `viewMatter.ts`
  (verify no other importer first: `grep -rn viewMatterAudit apps/lawbar-desktop`). Complete removal, no dead code.
- `apps/lawbar-desktop/tests/renderer-view-matter.test.mjs` — remove the 13 panel/audit tests (the 12 pure
  chain/audit tests at ~L308, L325, L342, L371, L389, L412, L494, L531, L552, L582, L1103, L1127 + the aria-live
  test ~L1171); **surgically trim** the mixed a11y test "a11y: document, audit, and copy controls expose
  aria-labels" (~L1152) to keep ONLY its document-control assertions (drop the audit-control assertions +
  ideally rename to reflect docs-only); remove the `auditEvent` import if it becomes unused. Keep every other test.

### Consequential files (mechanical ripple from removing the renderer view — added after full footprint mapping)
- `apps/lawbar-desktop/renderer/i18n/ui-strings-allowlist.json` — regenerate (drops the 6 `viewMatterAudit.ts`
  entries now that the file is gone; the drift guard requires an exact match).
- `apps/lawbar-desktop/tests/casebox-ui.electron.test.mjs` — remove the audit-panel assertion block (~L224-232:
  clicks `view-chain-summary`, waits for `view-chain-headhash`, asserts `view-chain-count`). This is a **packaged**
  electron test (NOT in the default `npm test` gate; runs via `test:ui-packaged`), so it cannot be run here without
  packaging — edit it to drop the removed-panel steps and note it as unrun.
- `apps/lawbar-desktop/tests/_view-matter-dom.mjs` — remove the `chainHead` stub (L174) + the `auditEvent` helper
  (L228) IF they become unused after the test removals (grep to confirm; leave if still used).
- `apps/lawbar-desktop/tests/renderer-audit-labels.test.mjs` — **ADDED to scope** (footprint gap found on the 3rd
  attempt): its 3 *integration* tests (~L70/L82/L89, "audit row: …") mount the deleted panel via `mountAuditRows`
  (mountViewMatter + click `view-chain-summary`) and break. **Remove those 3 integration tests + the `mountAuditRows`
  helper (~L57-68) + any now-unused imports** (`mountViewMatter`, `auditEvent`, `findByTestId`/`findAllByTestId`/
  `collectText` if unused). **Keep the 3 `isKnownAuditEventKind` unit tests** (L33/L39/L46 — pure guard, no render).
  No coverage lost: `eventKindLabel`'s humanization is already tested exhaustively in `renderer-i18n.test.mjs:72`
  ("resolves a non-empty zh-CN label for every audit event kind"); the view-only raw-action fallback (tests 2/3)
  is deleted with the view. `eventKindLabel` + `EVENT_KIND_ID` facade in `labels.ts` stay (used by renderer-i18n
  test).

### Explicitly LEFT INTACT (renderer-only removal; the read-path + mechanism stay)
- `api.chainHead` (renderer `api.ts`), the preload `chainHead` bridge, and the `chainHead` IPC handler
  (`ipc-handlers.unit.test.mjs`, 38 refs) — the chainHead read-path becomes UNUSED by the UI but is NOT removed;
  keeping it renderer-scoped avoids touching the IPC boundary, and `casebox-ipc.electron.test.mjs` uses
  `chainHead` to verify the audit MECHANISM records events (that verification must keep working). A later WI may
  remove the dormant read-path if desired.
- the audit-label facade `eventKindLabel` + `EVENT_KIND_ID` in `labels.ts` (kept; used by `renderer-i18n.test.mjs`);
  catalog `eventKind.*` entries; `renderer-i18n.test.mjs` (its exhaustive facade test stays).
- ANY `services/**`/persistence/contract (the MECHANISM); the `§`/eyebrow ornaments (WI-2c); serif/fonts (WI-2b);
  palette/tokens; no new dependency.

## 2. Acceptance criteria
1. The matter view no longer renders the audit view (no `view-chain-*`/`view-audit-*` in the mounted output); the
   colophon (created/id) + archive zone still render.
2. `viewMatterAudit.ts` is deleted; `grep -rn "viewMatterAudit\|renderChainHeadDisclosure\|chainHead" apps/lawbar-desktop/renderer`
   returns nothing (no dead import/const/reference).
3. The 13 panel/audit tests are removed; the mixed a11y test is trimmed to docs-only and still passes; the rest of
   `renderer-view-matter.test.mjs` passes. `auditEvent` import removed iff unused. No other test file changed.
4. **Persistence/audit mechanism unchanged** — `git diff` touches no `services/**`, no `docs/contracts/**`, no
   audit-event kinds; the audit records/chain still exist and export. Only renderer files change.
5. `npm --prefix apps/lawbar-desktop test` green except the pre-existing environmental `smoke.electron.test.mjs:21`
   launch timeout (accepted). `npm --prefix docs/contracts/case-box-contract test` unchanged-green. loc-guardian
   clean; one local commit; no push.

## 3. Governance
Type UI. Low-risk (removes a display panel; no logic/mechanism change) — but note it removes a court-facing
*visibility* affordance, so the commit message states clearly that only the panel is hidden and the tamper-evident
mechanism is preserved. Post-impl `/cc-suite:audit` on the diff (proportionate). Design artifact §2.5 satisfies
UI-GATES. No push.

## 4. Stop condition
Superseded when implemented + gates green. Remaining restyle: WI-2b (serif drop — S1-test care), WI-2c (ornament
removal — diffuse; scope deliberately, likely just the `§` section-marker/colophon-marker + drop uppercase eyebrows
only where they read as print-ornament, decided with review). Then the #2 edit vertical.
