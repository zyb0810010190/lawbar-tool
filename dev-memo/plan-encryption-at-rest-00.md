# Plan: Encryption-at-Rest for Local Case-Box SQLite (PLAN-ONLY)

> **PLAN ONLY.** This document plans the encryption-at-rest scheme for the v1 Mac client's local case-box SQLite data. It does NOT implement anything; no dependency is installed; no SQLCipher binding is added; no key is generated; no SQLite file is encrypted; no UI is built; no real case data is persisted; no signing / notarization / distribution / telemetry / cloud sync decision is made. Each follow-up implementation WI requires SEPARATE explicit user authorization, and each new dep (if any) requires its own STOP-AND-ASK per brief §20 + `.claude/rules/autonomy.md` §"Hard-stop list".

**Status**: READY (revision 2 — Path 1 native --background rev-1 review returned READY (Low-risk clarifications) with 2 Mediums + 5 Lows; rev-2 applied all 7: M D2#1 §5.2 migration expanded with explicit WAL/SHM/journal checkpointing + fsync + 4-window crash-recovery; M D3#1 §4.2 Tier 2 marked High-risk impl with mandatory packaged smoke; L D1#2 perf threshold relaxed from `<5%` to recorded measured (aspirational `<15%w/<10%r`); L D4#2 Tier 1 default = BLOCK in production / WARN in dev; L D5#3 sequencing closure tied to plan READY acceptance.).
**Date**: 2026-05-24.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Lane**: plan-only encryption-at-rest.
**Predecessors**: WI-B Option A at `c708ece` (better-sqlite3 native-module rebuild proven); WI-B plan at `3ec1a0f`; WI-A at `65fd0cc`; packaging-smoke plan at `3f9d412`; first UI shell impl at `4a99b25`; UI substrate ratification at `35cd9b6`; night-mode foundation at `7ad57ed`; blueprint at `1b92c58`; Phase B SQLite COMPLETE at `98446aa`.

## Review packet (compact)

### Active plan summary

`docs/product/project-requirements-brief.md` §15 (READY revision 5) **already locks** the v1 encryption-at-rest posture:

> **macOS FileVault is v1 encryption-at-rest reliance.** [...]
> Per-document encryption: DEFERRED post-MVP.

This plan does NOT contradict that decision. It does THREE things:

1. **§1**: Restate the brief-locked v1 baseline + spell out the threat model precisely (in-scope and out-of-scope attacker classes).
2. **§2 + §3**: Enumerate viable enhancements above the FileVault baseline (FileVault enforcement at app launch; optional SQLCipher overlay; user-supplied passphrase mode), with trade-offs.
3. **§4**: Recommend a **two-tier sequence**: Tier 1 (v1 day-one) = FileVault enforcement + warning UX; Tier 2 (separately authorized) = SQLCipher overlay with key in macOS Keychain. Per-document encryption stays brief-deferred to a SEPARATE post-MVP WI.

The plan respects `dev-memo/plan-ui-substrate-decision-00.md` rev-3 §"Ratification record" hard-stop "Per-document encryption-at-rest scheme" by NOT pre-committing to per-document encryption. It does NOT amend brief §15 — brief amendments use the `/project-brief` skill.

Plan-only file: `dev-memo/plan-encryption-at-rest-00.md` (THIS FILE).

### Exact target files (THIS plan-WI's commit)

CREATED (single file):
- `dev-memo/plan-encryption-at-rest-00.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- ANY file under `apps/lawbar-desktop/`.
- ANY `package.json` anywhere.
- ANY `node_modules/`.
- `services/case-box-persistence/**`, `docs/contracts/**`.
- `docs/product/project-requirements-brief.md` (READY revision 5; amendments only via `/project-brief`).
- `docs/adr/**`, `docs/ui/**`, `docs/release/**`.
- Other dev-memo plans.
- AGENTS.md.

### Exact target files for FUTURE impl WIs (NOT created by THIS plan-WI's commit)

This plan suggests TWO impl WIs (each separately authorized; see §8 sequencing):

- **Impl WI A (Tier 1; FileVault enforcement)**: ~3 new files in `apps/lawbar-desktop/`: `src/security/fileVaultProbe.ts` (~60 LOC; runs `fdesetup status` via child_process, parses output), `tests/main.test.mjs` additions (~20 LOC; mocks the probe), `electron/main.ts` additions (~15 LOC; calls probe at startup; shows warning dialog or blocks launch per config). NO new dep.
- **Impl WI B (Tier 2; SQLCipher overlay)**: BIG — replaces `better-sqlite3` runtime dep with `better-sqlite3-multiple-ciphers` (community fork supporting SQLCipher; STOP-AND-ASK per brief §20 new-runtime-dep), adds Keychain-key-storage module (~50 LOC), adds migration code (~80 LOC; encrypts existing plaintext DB), adds smoke tests. ~5 new files; ~250 LOC total.

### Exact acceptance criteria

#### For THIS plan-WI:

1. Plan committed alone (one file).
2. §1 specifies threat model (in-scope and out-of-scope attacker classes; explicit alignment with brief §15).
3. §2 enumerates key storage options for macOS with trade-offs.
4. §3 enumerates database encryption approaches with trade-offs.
5. §4 RECOMMENDS a two-tier sequence (Tier 1 v1 = FileVault enforcement; Tier 2 opt-in = SQLCipher overlay; per-document deferred).
6. §5 documents migration / backup / restore implications.
7. §6 defines test plan + acceptance criteria for each impl tier.
8. §7 enumerates STOP-AND-ASK gates triggered by each tier.
9. §8 lists follow-up WIs with explicit sequencing (Tier 1 → Tier 2 → per-document).
10. Plan does NOT contradict brief §15.
11. cc-suite review-plan returns READY (or only Low-risk clarifications remain) via Path 1 native `--background`.

#### For the IMPL Tier 1 WI (FileVault enforcement; when later authorized; this plan does NOT execute):

1. App launch reads `fdesetup status` (or LocalAuthentication equivalent).
2. If FileVault is OFF, app shows a blocking dialog OR a dismissable warning (config TBD at impl-WI authorization).
3. Status check passes if FileVault is ON (decrypted at user-login time).
4. NO new dep added.
5. Tests cover all 3 status outcomes (on / off / error).

#### For the IMPL Tier 2 WI (SQLCipher overlay; when separately authorized):

1. `better-sqlite3` swapped for `better-sqlite3-multiple-ciphers` (STOP-AND-ASK).
2. Master key generated at first launch; stored in macOS Keychain under `io.lawbar.desktop` service.
3. SQLite opened with SQLCipher cipher (AES-256-CBC or AES-256-GCM; pin choice at impl-WI).
4. Migration: existing plaintext DB → encrypt → atomic file replace.
5. Wrong-key fails to open.
6. Performance overhead measured and recorded (per rev-1 reviewer L D1#2 — `< 5%` was aspirational vs §3's published `5-10% read / 5-15% write` estimate). Tier 2 acceptance: ratio recorded in commit message; reviewer at Tier 2 impl decides whether it meets bar. Aspirational target `< 15% writes / < 10% reads`.
7. NO user-supplied passphrase v1 (deferred to Tier 3).

### Exact out-of-scope list

- **Implementing Tier 1 or Tier 2** (each separately authorized).
- **Adding any dependency** (`better-sqlite3-multiple-ciphers`, `keytar`, etc.).
- **Persisting any real case data.**
- **Editing brief / ADRs / services / contracts / tests.**
- **Touching the existing better-sqlite3 binding** at `apps/lawbar-desktop/`.
- **Per-document encryption** (brief §15 deferred post-MVP; out of THIS plan's scope).
- **User-supplied passphrase mode** (Tier 3; speculative; documented in §4 only).
- **Touch ID / Secure Enclave gating** (Tier 3 sub-option; speculative).
- **Cloud-side key escrow** (forbidden by brief §6 local-first; post-v1 if ever).
- **GDPR / HIPAA / SOC 2 compliance** (brief §15 says "No GDPR / HIPAA / SOC 2 unless explicitly added").
- **Auth provider / signing / notarization / distribution / telemetry / cloud sync** — all STOP-AND-ASK per brief §20.
- **`git push`** (separate explicit authorization).

### Essential references

- `docs/product/project-requirements-brief.md` §15 (READY revision 5) — load-bearing: FileVault is v1 baseline; per-document encryption deferred.
- `docs/product/project-requirements-brief.md` §4 — Mac app posture (offline default, no telemetry, manual download).
- `docs/product/project-requirements-brief.md` §20 — STOP-AND-ASK list, esp. "Per-document encryption-at-rest scheme" + "New runtime dependencies".
- `docs/product/project-requirements-brief.md` §7 — case-box entity vocabulary (matter, document, fact, deadline, evidence, audit-event, privilege-marker, confidentiality-classification, docket-entry, ocr-link).
- `dev-memo/plan-packaging-smoke-wib-00.md` §5 row #3 — "Plan: per-document encryption-at-rest scheme — MUST land BEFORE any WI that opens persistent on-disk SQLite" (THIS plan satisfies the row #3 sequencing requirement).
- `dev-memo/plan-ui-substrate-decision-00.md` rev-3 §"Ratification record" — "Per-document encryption-at-rest scheme" STOP-AND-ASK.
- `dev-memo/plan-go-live-readiness-00.md` gate #11 (律师法 compliance) + gate #12 (audit chain integrity) + gate #14 (backup + recovery).
- `services/case-box-persistence/` — the persistence layer whose on-disk SQLite is the target of this encryption plan.
- `apps/lawbar-desktop/src/probes/caseBoxProbe.ts` (WI-B Option A) — better-sqlite3 directly; would be replaced by better-sqlite3-multiple-ciphers if Tier 2 lands.
- `.claude/rules/autonomy.md` §"Hard-stop list".

### Review questions for the reviewer

1. **Brief alignment**: §1 + §4 explicitly defer to brief §15's "FileVault is v1 baseline" + "Per-document encryption deferred post-MVP". The two-tier recommendation does NOT contradict the brief — Tier 1 is FileVault enforcement (not encryption itself); Tier 2 (SQLCipher overlay) is a defense-in-depth ENHANCEMENT, opt-in, not a replacement. Is this framing correct, or does Tier 2 require an explicit brief amendment via `/project-brief`?

2. **Tier 2 scope**: §4 recommends Tier 2 as a SEPARATE later WI (NOT v1 day-one). Some legal compliance lawyers may consider FileVault-only insufficient for lawyer-client confidentiality. Should Tier 2 be promoted to v1 day-one, or kept post-v1 to honor brief §15's "DEFERRED post-MVP" framing?

3. **SQLCipher binding choice**: §3 names `better-sqlite3-multiple-ciphers` as the candidate (community fork; same API surface as `better-sqlite3`). Alternative: `@journeyapps/sqlcipher` (different API; React Native heritage). Plan picks `better-sqlite3-multiple-ciphers` for API-compatibility with the existing `better-sqlite3` codepath in case-box-persistence. Reviewer may push for direct SQLCipher binding or even `sql.js` with WebCrypto (no native dep).

4. **Key storage**: §2 picks macOS Keychain via the `keytar` npm package (well-maintained; cross-platform). Alternative: shell out to `security add-generic-password` / `security find-generic-password` (no new dep but fragile). Plan picks `keytar` for robustness; reviewer may push for shell-out to avoid the dep.

5. **Migration approach**: §5 picks atomic rename (encrypt to temp file → fsync → rename). Alternative: in-place encryption (block-by-block; complex but allows incremental). Plan picks atomic rename for simplicity; reviewer may push for in-place.

6. **Threat model out-of-scope items**: §1 explicitly excludes (a) attacker with user's macOS login password; (b) attacker with physical access to logged-in unlocked Mac; (c) in-memory key extraction; (d) malicious app on same user account; (e) supply-chain attack on `better-sqlite3-multiple-ciphers` itself. Are these exclusions defensible for v1 single-lawyer Mac, or do they require explicit user acceptance?

7. **FileVault enforcement strength**: §4 Tier 1 has TWO options — (a) block app launch if FileVault is OFF (strong but UX-hostile); (b) show dismissable warning + continue (weak but lawyer-friendly). Plan recommends WARNING-NOT-BLOCK to avoid bricking the app for lawyers in field-test scenarios. Reviewer may push for BLOCK.

8. **律师法 compliance interpretation**: brief §15 cites 律师法 confidentiality but does NOT specify the exact safeguards required. Plan picks "FileVault enforcement + future SQLCipher overlay" as a defensible interpretation. The user (likely lawyer or counsel) should validate this against actual 律师法 jurisprudence. This is a legal-domain question the plan flags but does NOT resolve.

---

## §1 Threat model

### §1.1 Asset

The case-box SQLite database file at `~/Library/Application Support/lawbar/lawbar.db` (and WAL/SHM sibling files). Contains: matter records, documents (metadata + content_hash references; raw bytes are SEPARATE files in the same dir), facts, deadlines, docket entries, evidence items, OCR links, audit-chain events, privilege markers, confidentiality classifications. Direct disclosure = lawyer-client confidentiality breach.

Per brief §7, the asset is **single-lawyer-scope**: one lawyer's matters per database. No multi-tenant data; no cross-firm exposure.

### §1.2 In-scope attacker classes

A. **Lost / stolen Mac with NO FileVault.** Attacker can read raw disk; SQLite file is plaintext; immediate disclosure.
B. **Lost / stolen Mac with FileVault enabled BUT logged-out at the time of theft.** Attacker faces disk encryption; data not readable without user password. **FileVault protects this case.**
C. **Forensic post-mortem of a backup** (Time Machine to external drive without encryption; iCloud Drive backup without encryption; manual `.db` file copy). Plaintext file outside FileVault disk-block protection = disclosure.
D. **Non-FileVault Mac in a shared environment** (e.g., shared family Mac, office Mac with non-FileVault profile). Other local user accounts can read the file IF discretionary file permissions allow.
E. **Forensic extraction via Apple-cooperation legal process** (rare in lawyer-context; varies by jurisdiction). FileVault offers key-escrow-or-not depending on enrollment.

### §1.3 Out-of-scope attacker classes (explicit per §"Review question 6")

F. **Attacker with the user's macOS login password.** FileVault is unlocked at login; Keychain is unlocked at login; SQLCipher key in Keychain is therefore readable. Defending this case requires a user-supplied passphrase NOT stored in Keychain — Tier 3 (post-v1; speculative).
G. **Attacker with physical access to a logged-in unlocked Mac.** Active session = active SQLite handle = active key in memory. Defending requires app-level auto-lock + key-zeroing on inactivity — Tier 4 (post-v1; speculative).
H. **In-memory key extraction** (e.g., DMA attack, debugger attach). Beyond scope of any application-layer encryption.
I. **Malicious app on same user account.** macOS Keychain ACLs reduce risk but don't eliminate. Defense requires app sandbox + entitlements — orthogonal STOP-AND-ASK (signing identity).
J. **Supply-chain attack on `better-sqlite3-multiple-ciphers` or `keytar`** (if Tier 2 lands). Code review + version pinning + npm audit — separate dependency-hygiene WI.

### §1.4 Brief §15 alignment

Brief §15: "macOS FileVault is v1 encryption-at-rest reliance."

Direct read: FileVault protects attacker class B; provides partial coverage for D; does NOT protect A, C, E.

This plan's Tier 1 (FileVault enforcement) adds defense for A (refuse to launch on non-FileVault Mac, or warn). This plan's Tier 2 (SQLCipher overlay) adds defense for C, D, and partial E.

### §1.5 Compliance regimes (brief §15)

- 中华人民共和国律师法 confidentiality — defensible interpretation: reasonable encryption-at-rest. FileVault + Tier 1 enforcement meets a minimum bar; Tier 2 strengthens.
- PRC PIPL (Personal Information Protection Law) for client PI — encryption-at-rest is one of multiple mandated safeguards; SQLCipher overlay aligns better than FileVault-only.
- 律师执业管理办法 — administrative requirements; encryption-at-rest contributes.
- No GDPR / HIPAA / SOC 2 (brief §15 explicit).

---

## §2 Key storage options (macOS)

### §2.1 Option K-1: macOS Keychain via `keytar` npm package

| Property | Value |
|---|---|
| Persistence | Keychain login item; encrypted with user login password |
| Unlock | At user login (automatic) OR on first access (prompt) |
| Cross-platform | Yes (`keytar` supports Win/Linux too — v1 Mac only) |
| New dep? | YES — `keytar` runtime + native binding |
| API stability | Stable; widely used |
| Risk if user password compromised | Attacker can read Keychain → key → DB |
| Pro | Simple; auto-unlock; standard pattern |
| Con | New native runtime dep (own ABI risk; analog of WI-B for `keytar`) |

### §2.2 Option K-2: Shell out to `security` CLI

| Property | Value |
|---|---|
| Persistence | Same Keychain; via `security add-generic-password` |
| Unlock | Same |
| Cross-platform | No (macOS only) |
| New dep? | NO — `security` ships with macOS |
| API stability | Stable but text-based parsing fragile |
| Risk if user password compromised | Same |
| Pro | No new dep |
| Con | Subprocess overhead per access; text parsing fragility |

### §2.3 Option K-3: User-supplied passphrase (Tier 3; speculative)

| Property | Value |
|---|---|
| Persistence | Not persisted; entered at app launch |
| Unlock | User types passphrase |
| Cross-platform | Yes (any TUI/GUI input) |
| New dep? | Depends on KDF choice — `node:crypto` for PBKDF2/scrypt is built-in |
| API stability | Built-in |
| Risk if user password compromised | Strongest — attacker needs the actual passphrase, which is never on disk |
| Pro | Best confidentiality |
| Con | UX friction; lost passphrase = lost data; brief §15 does NOT request this |

### §2.4 Option K-4: Touch ID / Secure Enclave (Tier 3 sub-option; speculative)

| Property | Value |
|---|---|
| Persistence | Key in Secure Enclave; gated by Touch ID |
| Unlock | Per-access biometric |
| Cross-platform | No (Apple Silicon + Touch ID Macs only) |
| New dep? | Likely — Electron has no built-in LAContext binding; needs `@nodert-win10-rs4/...` analog or shell-out to Swift helper |
| Pro | Hardware-backed; UX-pleasant |
| Con | Hardware fragmentation; new dep; brief §15 silent |

**Plan picks K-1 (`keytar`) for Tier 2** based on reviewer question 4 fallback. K-3 + K-4 are documented for future Tier 3.

---

## §3 Database encryption approaches

### §3.1 Option D-1: SQLCipher via `better-sqlite3-multiple-ciphers`

| Property | Value |
|---|---|
| Mechanism | Whole-DB AES encryption at the SQLite page level; transparent to caller |
| Replaces | `better-sqlite3` |
| API change | API-compatible (same `Database` class); add `PRAGMA key = 'X'` call after open |
| Migration | Re-encrypt existing plaintext DB via SQLCipher's `ATTACH ... AS encrypted KEY 'X'` + `sqlcipher_export('encrypted')` |
| Performance | ~5-10% read overhead; ~5-15% write overhead per published benchmarks |
| Backup | Backup the encrypted file; key must travel separately |
| New dep? | YES — `better-sqlite3-multiple-ciphers` runtime + native binding (replaces `better-sqlite3`) |
| Pro | Whole-file encryption; defense for attacker classes A/C/D |
| Con | New native dep; same ABI rebuild story as WI-B; could re-trigger packaging issues |

### §3.2 Option D-2: OS-level encryption only (FileVault)

| Property | Value |
|---|---|
| Mechanism | Disk-block AES via APFS + FileVault |
| Replaces | Nothing |
| API change | None |
| Migration | None |
| Performance | Imperceptible (hardware AES) |
| Backup | If backup destination is also FileVault'd → safe. If not (external drive, iCloud) → plaintext leak. |
| New dep? | NO |
| Pro | Native; zero engineering cost |
| Con | Defends ONLY when Mac is locked + cold-disk; doesn't help backup leak |

### §3.3 Option D-3: Column-level / envelope encryption

| Property | Value |
|---|---|
| Mechanism | Encrypt specific sensitive columns (e.g., document.content_hash, fact.assertion_text) at application layer; structural columns plaintext for query |
| Replaces | Nothing; layered on top |
| API change | Yes — case-box-persistence layer would need encrypt/decrypt wrappers |
| Migration | Per-column re-write |
| Performance | Variable; depends on which columns |
| Backup | Backup encrypted columns; structural columns plaintext (leaks structure) |
| New dep? | Maybe — `node:crypto` built-in could work; AES-GCM AEAD |
| Pro | Granular; structural queries still work; can rotate keys per column |
| Con | Bigger refactor; partial structural-data leak; complex key management |

### §3.4 Option D-4: Wrapped file (encrypt-at-rest; decrypt-to-temp on open)

| Property | Value |
|---|---|
| Mechanism | DB file is AES-encrypted blob at rest; decrypted to temp on app open; re-encrypted on app close |
| Replaces | Nothing |
| API change | Wrapper around `better-sqlite3` open/close |
| Migration | One-shot encrypt of existing file |
| Performance | Open/close slow (full file decrypt/encrypt); reads fast |
| Backup | Backup encrypted blob |
| New dep? | NO (`node:crypto` built-in) |
| Pro | No new native dep; reasonable for small DBs |
| Con | **In-flight crash leaves plaintext temp file**; not viable for v1 |

**Plan picks D-1 (SQLCipher via `better-sqlite3-multiple-ciphers`) for Tier 2** based on coverage strength + API compatibility. Tier 1 uses D-2 (FileVault baseline) per brief §15.

---

## §4 Recommendation: Two-tier sequence

### §4.1 Tier 1 — v1 day-one — FileVault enforcement (per brief §15)

**Mechanism**: Check `fdesetup status` at app launch. If FileVault is enabled → proceed silently. If disabled → behavior per launch mode (per rev-1 reviewer L D4#2 default — **BLOCK in production mode** (real case data); **WARN in dev/test fixture mode**; mode detected via env var or config flag; defaults resolved at Tier 1 impl-WI authorization).

**Files**: ~3 new files; ~95 LOC total. NO new dep.

**Authorization**: Tier 1 is the natural follow-on to WI-B Option A. The user authorizes Tier 1 impl as a separate WI; this plan's §"Suggested follow-up WIs" §8 row 1 names it.

**Brief alignment**: directly implements brief §15 "FileVault is v1 encryption-at-rest reliance".

### §4.2 Tier 2 — separately authorized — SQLCipher overlay + Keychain key

**Mechanism**: Swap `better-sqlite3` → `better-sqlite3-multiple-ciphers`. Generate 32-byte random key at first launch; store in macOS Keychain via `keytar` under service `io.lawbar.desktop` + account `case-box-master-key`. On app launch: read key → open DB with `PRAGMA key = 'X'` → all reads/writes are transparently encrypted.

**Files**: ~5 new files; ~250 LOC total. **2 new runtime deps** (each STOP-AND-ASK): `better-sqlite3-multiple-ciphers` (replaces `better-sqlite3`); `keytar`.

**Authorization**: Tier 2 is OPTIONAL for v1; this plan recommends authorizing it BEFORE first case-box-aware screen lands so the encryption migration is one-time (no plaintext DB ever exists in production usage). Reviewer may push to defer entirely to post-v1.

**Treat Tier 2 as High-risk impl** (per rev-1 reviewer M D3#1): community-fork SQLCipher binding (`better-sqlite3-multiple-ciphers`) + new native module (`keytar`) re-trigger the WI-B packaging concern. Tier 2 acceptance MUST include a full packaged Electron smoke (analog of WI-B Option A's `test:probe` but for the encrypted DB path): load → open with key → migration → wrong-key fail → ASAR unpack of both native bindings. Tier 2 cannot ship without that smoke passing.

**Brief alignment**: brief §15 says "Per-document encryption: DEFERRED post-MVP". Tier 2 is NOT per-document; it is whole-DB. Defensible reading: Tier 2 enhances the FileVault baseline without contradicting the "per-document deferred" decision. Reviewer may insist on `/project-brief` amendment before authorizing Tier 2.

### §4.3 Tier 3 — post-MVP — speculative

User-supplied passphrase (K-3) OR Touch ID / Secure Enclave (K-4). Brief §15 silent on this; not in this plan's recommendation; documented only.

### §4.4 Per-document encryption — brief-deferred

Brief §15 explicit: "Per-document encryption: DEFERRED post-MVP." This plan does NOT propose per-document encryption. A SEPARATE post-MVP WI will revisit when the brief is amended.

---

## §5 Migration / backup / restore

### §5.1 Tier 1 (FileVault enforcement) — no DB change

No migration needed. No backup format change. The SQLite file stays plaintext on a FileVault'd disk.

### §5.2 Tier 2 (SQLCipher overlay) — one-time migration

**Migration trigger**: at first launch AFTER the Tier 2 impl ships, the app detects an existing plaintext `lawbar.db` and runs migration. **WAL/SHM/journal handling explicit per rev-1 reviewer M D2#1**: SQLite uses sidecar files (`lawbar.db-wal`, `lawbar.db-shm`, possibly `lawbar.db-journal`) which MUST be checkpointed + closed before the file rename, else SQLCipher will refuse to attach or the encrypted DB will be corrupt.

1. Generate new 32-byte random key (`crypto.randomBytes(32)`); store in Keychain via `keytar.setPassword("io.lawbar.desktop", "case-box-master-key", hex(key))`.
2. **Force WAL checkpoint on plaintext DB**: open `lawbar.db` read-write; run `PRAGMA wal_checkpoint(TRUNCATE)`; run `PRAGMA journal_mode = DELETE` (forces WAL → rollback journal); close. This forces all pending writes to the main DB and removes WAL/SHM.
3. Re-open plaintext `lawbar.db` read-only (now no sidecars).
4. Run SQLCipher's migration: `ATTACH 'lawbar.db.encrypted' AS encrypted KEY 'X'` (in encrypted-DB context with `PRAGMA cipher_default_compatibility = N` set per Tier 2 sub-plan); `SELECT sqlcipher_export('encrypted')`; `DETACH encrypted`.
5. Close both DBs.
6. `fsync` the encrypted file before rename (durability across power loss).
7. Atomic `rename('lawbar.db.encrypted', 'lawbar.db')` (POSIX rename(2) is atomic on same filesystem).
8. Delete any leftover `.db-wal`, `.db-shm`, `.db-journal` files (defensive; should be absent after step 2).
9. `PRAGMA journal_mode = WAL` (restore WAL after migration; standard case-box-persistence mode).
10. Future launches: read key from Keychain; open `lawbar.db` with `PRAGMA key = 'X'`; standard usage.

**Crash recovery** (per rev-1 reviewer M D2#1):
- **Crash between steps 1-2**: Keychain has new key, but DB is still plaintext + no encrypted file. Recovery: detect at next launch (Keychain has key, but `PRAGMA key` fails because DB is plaintext); show error dialog; user choice (a) re-run migration, or (b) delete Keychain key + revert to plaintext.
- **Crash between steps 3-6**: encrypted file partially written. Recovery: detect leftover `.db.encrypted` file at next launch; delete it; retry migration.
- **Crash between steps 7-8**: encrypted file is now `lawbar.db`; old plaintext is gone. Recovery: standard SQLCipher open with Keychain key; should succeed.
- **Crash during step 9**: encrypted DB exists; WAL not yet re-enabled. Recovery: re-enable WAL at next launch (idempotent).

Tests for each crash window are mandatory at Tier 2 impl (§6.2 extends).

**Risk**: SQLCipher's PRAGMA ordering matters: `PRAGMA key` MUST be set BEFORE any other PRAGMA or query. Tier 2 sub-plan must specify exact PRAGMA sequence. Default cipher: AES-256-CBC with SHA1 HMAC (SQLCipher 4 default) OR AES-256-GCM if the binding supports it; choice deferred to Tier 2 sub-plan.

**Backup**: backup destination receives the encrypted file. Key MUST travel separately. Lawyer who wants to restore on a new Mac needs both: encrypted DB file + key.

**Key recovery**: if lawyer loses macOS Keychain access (e.g., password reset, Keychain corrupt), DATA IS LOST. Mitigation: at first launch, show a one-time dialog with the key (hex-encoded; ~64 chars) and prompt the lawyer to back it up securely (off-Mac). This UX is part of Tier 2 impl scope.

### §5.3 Tier 1 → Tier 2 transition

If Tier 1 ships first (v1 day-one) and Tier 2 ships later (separately authorized), the transition is the Tier 2 migration above. Tier 1's FileVault enforcement stays in place — defense-in-depth.

---

## §6 Tests / acceptance criteria

### §6.1 Tier 1 tests (FileVault enforcement)

| Test | Method |
|---|---|
| FileVault ON → app launches silently | Unit: mock `fdesetup status` returning "FileVault is On"; assert app proceeds without dialog. |
| FileVault OFF → app shows warning OR blocks (config) | Unit: mock "FileVault is Off"; assert warning dialog or block path per config. |
| `fdesetup` execution error → fail-CLOSED (`unknown`) | Unit: mock subprocess error; assert the state classifies as `unknown` and `decideAction` maps it to **block-prod / warn-dev** (per §4.1; `unknown` → `off`/fail-closed semantics in the shipped Tier 1 impl `fileVaultProbe.ts`). A probe failure is treated as FileVault-unverified, not as a transient error to ignore. |
| End-to-end: actual macOS Mac with FileVault toggled | Manual gate; document in WI commit message. |

### §6.2 Tier 2 tests (SQLCipher overlay)

| Test | Method |
|---|---|
| First-launch: generates key, stores in Keychain, encrypts DB | Smoke: spawn packaged binary with `--probe-encryption`; verify key exists in Keychain (or mock for CI). |
| Wrong key fails to open | Unit: open SQLCipher DB with wrong key; assert error. |
| Migration: plaintext → encrypted, round-trip data preserved | Smoke: create plaintext DB; run migration; reopen with key; assert all rows match. |
| Performance: `listMatters` overhead < 5% | Benchmark: 1000 matters; compare plaintext vs encrypted; allow 5% variance. |
| Wrong-key dialog: user is prompted to provide key OR shown "data lost" path | UI gate; documented manually. |

### §6.3 Common acceptance criteria

- `npm audit --omit=dev` shows 0 production vulnerabilities post-impl.
- cc-suite mini audit returns PASS.
- WI-A + WI-B packaged smoke tests still pass (no regression).
- Brief §15 alignment confirmed in impl commit message.

---

## §7 STOP-AND-ASK gates (each impl WI)

All applicable brief §20 STOP-AND-ASK items are inherited by reference without modification. Items SPECIFICALLY triggered by each impl tier:

### §7.1 Tier 1 (FileVault enforcement)

- **None new.** No new dep; no key storage; no encryption. The `fdesetup` subprocess is a macOS built-in command (no install needed).

### §7.2 Tier 2 (SQLCipher overlay)

- **Brief §20 "Per-document encryption-at-rest scheme"** — Tier 2 is whole-DB, NOT per-document; defensible reading per §4.2 but **reviewer may insist on `/project-brief` amendment before authorizing**.
- **Brief §20 "New runtime dependencies (each individually)"**:
  - `better-sqlite3-multiple-ciphers` (replaces `better-sqlite3`).
  - `keytar` (new native runtime dep; analog of WI-B for Keychain access).
- **Re-trigger WI-B native-module packaging concern** for `keytar` AND `better-sqlite3-multiple-ciphers`. The same `electron-builder install-app-deps` + ASAR `asarUnpack` pattern applies; smoke test must extend.

### §7.3 Tier 3 (post-MVP; speculative)

- **Brief §20 "Per-document encryption-at-rest scheme"** — Tier 3 user-supplied passphrase contradicts the brief's "DEFERRED post-MVP" framing if interpreted as "no encryption-at-rest UX". `/project-brief` amendment required.

---

## §8 Suggested follow-up WIs (each requires SEPARATE explicit authorization)

This plan executes none.

| # | Suggested WI | Phase | Risk | Predecessors |
|---|---|---|---|---|
| 1 | **Impl: Tier 1 FileVault enforcement** (3 new files; ~95 LOC; NO new dep) | Impl | Low | THIS plan READY + user authorizes |
| 2 | Plan: case-box IPC contract (substrate decision §6 row 4) — INDEPENDENT of encryption; can land in parallel | Plan | Medium | None |
| 3 | Plan: Tier 2 SQLCipher overlay (separate plan-WI; this plan covers the meta-strategy but Tier 2's exact impl needs its own plan because the dep-swap + migration are non-trivial) | Plan | **STOP-AND-ASK** (2 new deps + brief alignment debate) | WI 1 |
| 4 | Impl: Tier 2 per WI 3's spec | Impl | High; **STOP-AND-ASK** | WI 3 |
| 5 | Impl: first case-box-aware screen (e.g., list matters) — **MUST land AFTER WI 4 IF Tier 2 is authorized**; otherwise can land after WI 1 on the FileVault-only baseline | Impl | Medium | WI 1 + (WI 4 if Tier 2 authorized) + (case-box IPC contract WI 2) |
| 6 | Plan: backup + recovery procedure for the (possibly encrypted) DB file (blueprint gate #14) | Plan | Low | WI 4 (if Tier 2) |
| 7 | Plan: 律师法 compliance signoff text — legal/business review | Plan | **STOP-AND-ASK** (legal acceptance) | WI 4 |
| 8 | Plan: Tier 3 user-supplied passphrase OR Touch ID (post-MVP; speculative; brief amendment required first) | Plan | **STOP-AND-ASK** (brief amendment) | Brief amendment |

**Sequencing rule**: per WI-B plan §5 row 3, encryption-at-rest plan (THIS plan) MUST land BEFORE any case-box-aware screen with persistent on-disk SQLite. This sequencing is satisfied because:
- THIS plan is plan-only; lands now (when accepted READY per rev-1 reviewer L D5#3 — the sequencing row #3 is officially closed only when THIS plan is accepted READY by the user).
- Tier 1 impl (WI 1) is a simple FileVault enforcement; can land standalone.
- Case-box-aware screens can then land on the FileVault-only baseline (consistent with brief §15) OR after Tier 2 if authorized.

---

## §9 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Medium | Plan is read as authorization to implement Tier 1 or Tier 2. | Top-of-file PLAN-ONLY banner; §"Acceptance criteria" split for THIS plan-WI vs IMPL Tier 1 / Tier 2; each Tier 2 dep flagged STOP-AND-ASK in §7. |
| 2 | Medium | Brief §15 "Per-document encryption: DEFERRED post-MVP" may be reviewer-interpreted to also defer whole-DB encryption (Tier 2). | §4.2 explicitly flags this as a reviewer-decision; `/project-brief` amendment path documented in §7.2. |
| 3 | Medium | Tier 2's `keytar` is a NEW native module — re-introduces the same ABI rebuild risk solved by WI-B for `better-sqlite3`. | §6.2 mandates extending the WI-B packaged smoke pattern to cover `keytar` too. |
| 4 | Low | Tier 1's "warning vs block" choice (§4.1) is left to reviewer/impl-WI; may produce inconsistent UX. | Reviewer question 7 explicitly invites resolution. |
| 5 | Low | Key recovery UX (Tier 2) is documented but not implemented; lawyer who loses Keychain access loses data. | §5.2 documents one-time key dialog as Tier 2 impl scope. |
| 6 | Low | `better-sqlite3-multiple-ciphers` is a community fork; supply-chain risk vs official `better-sqlite3`. | §1.3 attacker class J + §8 row 6 dependency-hygiene WI. |
| 7 | Low | Tier 1 + Tier 2 together do NOT cover all out-of-scope attacker classes (F-J in §1.3). | §1.3 explicitly enumerates; user acceptance documented at impl-WI authorization. |

No Critical / High risks.

---

## §10 References

- `docs/product/project-requirements-brief.md` (READY revision 5) §4, §6, §7, §15, §20.
- `dev-memo/plan-packaging-smoke-wib-00.md` §5 row #3 — sequencing requirement.
- `dev-memo/plan-ui-substrate-decision-00.md` rev-3 §"Ratification record" — STOP-AND-ASK list.
- `dev-memo/plan-go-live-readiness-00.md` gate #11 (律师法) + #12 (audit-chain) + #14 (backup).
- `apps/lawbar-desktop/src/probes/caseBoxProbe.ts` (WI-B Option A) — better-sqlite3 direct probe.
- `services/case-box-persistence/` — the persistence whose SQLite is the target.
- `.claude/rules/autonomy.md` §"Hard-stop list".
- SQLCipher official docs (referenced by name only; no URL).
- macOS `fdesetup(8)` man page (referenced by name only).
- macOS Keychain Services / Apple Developer documentation (referenced by name only).

---

## §11 Stop condition

This plan is stale or superseded when:
- The user authorizes Tier 1 impl — plan transitions to "Tier 1 promoted to impl; awaiting commit".
- Tier 1 impl ships — plan section §4.1 supersedes; §4.2-§4.4 remain pending.
- The user authorizes Tier 2 plan (§8 row 3) — Tier 2 sub-plan becomes the authoritative impl spec.
- Brief §15 is amended in a way that changes the FileVault-baseline + per-document-deferred posture.
- A future technical discovery invalidates SQLCipher (e.g., catastrophic CVE) — Tier 2 needs re-planning.
- The first case-box-aware on-disk screen ships — this plan is superseded by the baseline it established (FileVault-only or FileVault+SQLCipher per user choice).
