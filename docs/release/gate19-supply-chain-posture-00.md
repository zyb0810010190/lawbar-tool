# Gate 19 — Supply-Chain Posture (v1 dependency inventory + audit + provenance)

> **Provenance note (2026-08-22).** The governance queue, review tree and autonomy rules
> cited below were removed together with the agent-governance layer in commits `49dd7ad`
> and `e67b047`. Those citations — queue and review paths, sha256 digests, PR numbers —
> are retained deliberately as the audit trail of what authorized this work. They record
> provenance; they are not paths you can follow today. Current authority for hard stops
> is `docs/product/product-definition.md` §20.


**Status:** supply-chain inventory + `npm audit` + provenance sweep **RECORDED** — the v1 production dependency surface is clean (`npm audit --omit=dev` = **0 vulnerabilities** across all six packages), native-binary + tarball provenance is traced, and the license inventory is descriptive-only. **One surfaced Electron-runtime risk item (covering two HIGH advisories on the shipped `electron` runtime) is recorded** (not fixed here; a follow-up dependency WI + gate 4). **Gate 19 stays `OPEN`** (a posture record is not a go-live sign-off). This is **NOT** a clearance of gates 4/6/12/13/17/20, **NOT** a license/legal/business decision (gate 17, user-owned), and **NOT** a go-live decision. **Date:** 2026-07-08. **Author:** Claude Code (WI-RELEASE-G19-SUPPLY-CHAIN-POSTURE-00 execution lane). **Governed by:** `dev-memo/run/queue.md` (queue.governed sha256 `2744e686…`, PR #218 merge `50377fd`), review `dev-memo/run/reviews/queue-review-164.md`.

**Read-only sweep.** This lane read manifests + lockfiles + tarball metadata and ran `npm audit` / `npm ls`. It ran **no** `npm install` / `npm audit fix` / `npm update` and mutated **no** `package.json` / `package-lock.json` / dependency / tarball. Environment: Node `v24.14.0`, npm `11.9.0`, 2026-07-08.

---

## 1. Manifests + lockfiles inspected
**10 `package.json`** (non-node_modules): `apps/lawbar-desktop`, `docs/contracts`, `docs/contracts/case-box-contract`, `native/evidence-core`, `services/case-box-persistence`, `services/ocr-ingestion`, `services/ocr-persistence`, `services/ocr-review`, `services/ocr-worker`, `services/ocr-worker-bakeoff`.
**9 `package-lock.json`** — all of the above **except `native/evidence-core`** (no lockfile; a Swift/native harness package, no npm dependency tree).

**v1 production surface** = the Mac client `apps/lawbar-desktop` + its transitive first-party tarballs. The OCR services are test-verified standalone (gate 2) but **not wired into the v1 client** (gate 13 finding); `services/ocr-worker-bakeoff` is **out of the production graph** (ADR-11A.1).

## 2. Runtime dependency inventory (declared → resolved)
**v1 Mac client (`apps/lawbar-desktop`) runtime deps:**
| Dependency | Declared | Resolved | Kind |
|---|---|---|---|
| `better-sqlite3` | `^12.9.0` | **12.10.0** | native (compiled) |
| `docx` | `9.7.1` (exact) | **9.7.1** | pure-JS (DOCX export) |
| `case-box-contract` | `file:dist-tarballs/case-box-contract-0.1.0.tgz` | 0.1.0 | first-party committed tarball |
| `case-box-persistence` | `file:dist-tarballs/case-box-persistence-0.1.0.tgz` | 0.1.0 | first-party committed tarball |

`docx@9.7.1` carries a **prior ACCEPTABLE dependency-risk-review** (job `audit-mr63d6y7`, MIT / pure-JS) — cited, not re-decided.

**v1 client build/runtime devDeps:** `electron ^34` → **34.5.8**, `electron-builder ^25` → **25.1.8**, `@playwright/test ^1.50`, `playwright`, `@types/node ^22`, `typescript ^5.6`.

**OCR-service engine (`services/ocr-worker`, not wired into v1 client):** `@gutenye/ocr-node` `^1.4.8` → **1.4.8** (+ transitive `@gutenye/ocr-common` 1.4.8, `@gutenye/ocr-models` 1.4.2). Real-PaddleOCR is model-gated / post-v1 (gate-2 residual R-G2-3).

**Native deps:** `better-sqlite3 ^12.9.0` appears in three manifests (`apps/lawbar-desktop`, `services/ocr-persistence`, `services/case-box-persistence`).

## 3. Native-binary + tarball provenance
- **`better-sqlite3` 12.10.0 (MIT).** Install script `prebuild-install || node-gyp rebuild --release` — a prebuilt binary with a compile-from-source fallback. In the current host tree the compiled `build/Release/better_sqlite3.node` is present (no `prebuilds/` dir → built from source via node-gyp on this host). ABI integrity is guarded by the `services/ocr-persistence` `abi-smoke` pretest (`services/ocr-persistence/scripts/abi-smoke.mjs`), which fails a stale native binding as a clear `[abi-smoke] FAIL` rather than an opaque `ERR_DLOPEN_FAILED` (`AGENTS.md` §"Repo brief"). Packaging rebuilds the binding for the electron-builder `mac.target` arches (arm64 + x64) with a `postdist` host-restore (`AGENTS.md` §"Test-environment notes").
- **OCR engine `@gutenye/ocr-node` 1.4.8 (MIT)** + `@gutenye/ocr-models` 1.4.2 (MIT). Provenance: npm registry. Not wired into the v1 client; the real engine path is model-gated / post-v1.
- **Committed internal tarballs** (`apps/lawbar-desktop/dist-tarballs/`): `case-box-contract-0.1.0.tgz` (`package/dist/**` — built from the in-repo `docs/contracts/case-box-contract`) + `case-box-persistence-0.1.0.tgz` (built from in-repo `services/case-box-persistence`). Both are **first-party** artifacts (no declared `license` field — in-repo source, not third-party redistribution) traceable to in-repo source packages. Note (residual R-G19-2): a committed pre-built tarball's byte-provenance is only as good as its rebuild discipline; a reproducible-rebuild check is a post-v1 hardening candidate.

## 4. `npm audit` results (read-only, scoped)
**Production surface — `npm audit --omit=dev`, per package:**
| Package | Result |
|---|---|
| `apps/lawbar-desktop` | **found 0 vulnerabilities** |
| `services/ocr-worker` | **found 0 vulnerabilities** |
| `services/ocr-persistence` | **found 0 vulnerabilities** |
| `services/case-box-persistence` | **found 0 vulnerabilities** |
| `services/ocr-ingestion` | **found 0 vulnerabilities** |
| `services/ocr-review` | **found 0 vulnerabilities** |

**The `--omit=dev` app/service dependency audits are clean: 0 advisories.** (This is bounded to the `--omit=dev` production dependency tree; the shipped **Electron runtime** — a declared devDependency — is audited + surfaced separately below.)

**Dev / build toolchain — `npm audit` (dev-inclusive), `apps/lawbar-desktop`:** 13 advisories (1 moderate, 12 high). These are almost entirely the **build/packaging toolchain** (`electron-builder` → `app-builder-lib`, `dmg-builder`, `@electron/rebuild`, `node-gyp`, `tar`, `cacache`, `make-fetch-happen`, `tmp`, `form-data`, `js-yaml`) — build-time only, **not shipped in the packaged app**, advisory-only (disposition: monitor; a future toolchain bump).

### Surfaced advisory (SURFACED, not silently passed)
- **`electron` 34.5.8 — 2 HIGH advisories** (ASAR Integrity Bypass via resource modification; AppleScript injection in `app.moveToApplicationsFolder` on macOS). `electron` is declared a **devDependency** (so it does not appear in the `--omit=dev` production audit), **but it is the runtime the packaged app ships on** — so this is a genuine v1 consideration, not pure dev-tooling. **Disposition: SURFACED / escalated as follow-up R-G19-1** — recommend bumping `electron` to a patched `34.x` (or newer supported line) **before gate-4 signing/distribution**. This read-only lane records it; it does **not** fix it (a dependency bump is a separate WI, out of scope here) and it does **not** clear gate 19. It is **not** a new agent risk-acceptance; the bump/accept decision is the user's at gate 4.

## 5. License inventory (descriptive — NOT a gate-17 decision)
| Dependency | License |
|---|---|
| `better-sqlite3` 12.10.0 | MIT |
| `docx` 9.7.1 | MIT |
| `@gutenye/ocr-node` 1.4.8 / `ocr-common` 1.4.8 / `ocr-models` 1.4.2 | MIT |
| `electron` 34.5.8 | MIT (devDep / runtime) |
| `electron-builder` 25.1.8 | MIT (devDep) |
| `case-box-contract` / `case-box-persistence` tarballs | first-party (in-repo; no third-party license) |

This is a **descriptive inventory only**. It makes **no** legal/business decision about license acceptability, compliance obligations, or attribution requirements — those are **gate 17 (user-owned STOP-AND-ASK)**. This inventory does **not** clear gate 17.

## 6. Exclusions / post-v1
- `services/ocr-worker-bakeoff` (tesseract / paddleocr-onnx engine bakeoff) — **excluded**, out of the production dependency graph (ADR-11A.1).
- The OCR services — **not wired into the v1 Mac client** (post-v1 surface); their supply-chain re-audit is a post-v1 concern if/when OCR is integrated.
- **SBOM** — optional / post-v1 (not generated here).
- Dev-only transitive advisories — recorded as advisory-only (§4), not a v1-production blocker.

## 7. Posture sweep result
**Posture sweep result: PASS (evidence recorded) — Gate 19 remains `OPEN`** (a sweep PASS is evidence, NOT a gate clearance). (a) The inventory is complete — all v1-production deps enumerated with declared + resolved versions + provenance; (b) `npm audit --omit=dev` ran and is **0** across all six packages; (c) the one High advisory affecting the shipped Electron runtime is **surfaced + dispositioned** (R-G19-1, follow-up bump before gate 4), not silently passed; (d) the license inventory is recorded with the gate-17 boundary preserved; (e) no gate-17 legal/business decision was made. FAIL would have been: an incomplete inventory, a hidden/unrun audit, an unsurfaced Critical/High in a production dep, or a legal decision smuggled in — none occurred.

## 8. How this feeds gate 19 without clearing gate 17 / 4 / 6 / go-live
A recorded inventory + audit + provenance supplies the "supply-chain posture recorded" evidence. Per the governed WI, **gate 19 MUST remain `OPEN`** — the row is enriched with a `[Δ] supply-chain inventory + audit + provenance recorded` marker (roll-up bucket unchanged); an `OPEN → PARTIAL/CLEARED` move belongs to a SEPARATE holistic readiness-refresh WI. This does **NOT** clear **gate 17** (license/business decision, user-owned), **gate 4** (signing/distribution — where the Electron-runtime advisory disposition lands), **gate 6** (the full-project audit, which consumes this posture later), or gates 12/13/20; go-live independence is kept (the final GO/NO-GO + the STOP-AND-ASK hard-stops 4/11/17/21 remain the user's).

## 9. Residual risks / follow-up WIs (separate future WIs — not opened here)
- **R-G19-1 (surfaced High):** bump `electron` off 34.5.8 to a patched line to clear the ASAR-integrity-bypass + macOS-AppleScript-injection advisories **before** gate-4 signing/distribution. A dependency-bump WI (out of this read-only lane). User-owned accept/bump decision.
- **R-G19-2:** reproducible-rebuild verification for the two committed first-party tarballs (post-v1 hardening).
- Dev/build toolchain advisories (electron-builder chain) — monitor; a toolchain bump WI (post-v1; build-time only).
- **SBOM** generation (optional / post-v1).
- **Gate-17 license decision** — user-owned; this inventory is its input, not its resolution.
- OCR-service supply-chain re-audit when/if OCR is wired into the v1 client (post-v1).
- The posture is a snapshot; a dependency change or a new advisory re-triggers gate-19 verification.
