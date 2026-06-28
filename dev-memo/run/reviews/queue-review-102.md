# Queue review — WI-A3-INTERNAL-DEPS-COMMIT-TARBALLS-T2

Lane: combined packaging (commit internal tarballs + matching lock + drift guard, DESKTOP-DEPS-00 Option 1) **+** minimal renderer A3-link audit-event-label completion. Type: UI (court-facing audit labels; `Design artifact: dev-memo/design/2026-06-28-a3-link-audit-event-labels.md`). A0.7: **downgraded to no** by review-plan (see below).
Date: 2026-06-28. Branch: `evidence-a3-internal-deps-commit-tarballs` (from `main` @ `189fd2d`).

## cc-suite invocation recording (per .claude/rules/cc-suite.md §"Required recording")
- **Kind:** review-plan · Path 1 runner 0.2.18, gpt-5.5 / high / read-only. Retrievable: YES (all `completed`).

### Round log (packaging-only → combined re-scope)
| Round | Job ID | rawOutput sha256 (16) | Verdict | Note |
|---|---|---|---|---|
| 1 | `review-plan-mqxvtslv-d9rgtg` | `e70d7d16af8013a1` | NEEDS-FIX | (packaging-only WI) High: replace `rm lock && npm install` with a narrow two-entry integrity refresh; Med: manifest packedAt; Low: guard file-list compare. |
| 2 | `review-plan-mqxvxcrk-49ftc3` | `35bc902becc00280` | NEEDS-FIX | stale Gates lock wording; manifest self-consistency vs fresh-pack. Both fixed. |
| 3 | `review-plan-mqxw07q7-mfmack` | `afae83b6c13df4d2` | READY | (packaging-only) — implementation then revealed the compile-coupled renderer gap → re-scoped to T2. |
| 4 | `review-plan-mqxwmfeq-4lns17` | `ba738705769cbb27` | **READY** | (combined T2) — see below. |

| 5 | `review-plan-mqxx5kvn-2vkgmh` | `28754580e3a620e4` | **READY** | (carve-out) user-authorized narrow add of `tests/renderer-i18n.test.mjs` for a count-accuracy bump 50→53 (3 new LINK_* keys); reviewer confirmed non-weakening + catalog now has exactly 53 eventKind keys. |

## Verdict (T2, round 4): READY
Reviewer confirmed:
1. **Combining is correct** — the halves are compile-coupled (refreshed `case-box-contract` exposes the 3 LINK_* kinds; `labels.ts` uses an exhaustive `Record<CaseBoxAuditEventKind, CatalogId>` — splitting creates an intentionally-failing intermediate). No separate UI lane required (stop-point 1 not triggered).
2. **Design artifact sufficient** for the `Type: UI` gate (labels-only scope, tightly defined; satisfies UI-GATES.md).
3. **Renderer scope correctly bounded** to the 3 LINK_* labels. **Implementation note (load-bearing): `renderer/screens/auditEventLabels.ts` MUST be edited** — it independently enumerates every event kind with its own exact map + test coverage (auditEventLabels.ts:11); it is not optional. No broader layout/behavior/permission/data-exposure/semantics change (stop-point 2 not triggered).
4. **Lock refresh + drift guard sound** (unchanged from the round-3 READY): lock diff limited to the two internal integrity values; guard validates manifest self-consistency + re-stages both packages + compares extracted payload file sets + sha256.
5. **A0.7 downgrade APPROVED** — custody-9b NOT required: no geometry, marker rendering, citation identity, anchor placement, export behavior, or new Evidence UI workflow; only static labels for already-defined/persisted audit kinds + packaging determinism. `Requires-A07` set to `no` with this concrete reason recorded.

QUEUE_REVIEW_VERDICT=PASS

## Post-implementation cc-suite records
### audit
- Kind: audit · Job ID: `audit-mqxxavxf-wdoocr` · gpt-5.5/high/read-only · rawOutput sha256 `95d1d63dd0b5479ad97f4209942e82096b0119b35cd81df5649136ce9b0881e5`
- Result: **no Critical/High.** Medium: drift guard didn't verify package-lock integrity → FIXED (added `checkLockIntegrity`: asserts the lock's `node_modules/<pkg>` integrity == committed tarball sha512; proven PASS / tamper-FAIL / PASS). Low1: `renderer-i18n.test.mjs` ALL_EVENT_KINDS runtime list omits LINK_* → DEFERRED as `T2-AUD-L1` (out of the count-only carve-out; mitigated by the compile-time exhaustive `EVENT_KIND_ID` Record + the 53-count test + the 3 catalog keys). Low2: exact-path staging (done at commit). Confirmed: lock diff = only the 2 internal integrity lines; renderer diff = only the 3 LINK_* labels; no electron/src/IPC/persistence/schema/contract-source/native change; schema 12; D1 open; packaged contract carries LINK_*.
### verify
- Kind: verify · consumed `/tmp/cleanup-reports/t2-audit.md` · Job ID: `verify-mqxxg0s9-qqc1im`
- Verdict: **ALL CLOSED** — Medium fixed (independently re-checked both lock integrities match the tarballs); Low1 deferral legitimate + recorded; no open Critical/High/Medium.

Verification run: `npm --prefix apps/lawbar-desktop run build` GREEN; `npm --prefix apps/lawbar-desktop test` 666/666; `node scripts/workflow/check-internal-tarballs.mjs` PASS (+ proven FAIL on injected source-payload drift AND on tampered lock integrity); `rm -rf node_modules && npm --prefix apps/lawbar-desktop ci` succeeds with resolved contract = 3 LINK_* kinds; `npm --prefix apps/lawbar-desktop run dist` succeeds + packaged asar contract carries the LINK_* kinds; `check-contract-integrity` PASS 14. DESKTOP-DEPS-STALE-LOCK-01 flipped to closed; LINK-IPC-T1-D1 stays open. No A0.7 custody (downgraded by review-plan).
