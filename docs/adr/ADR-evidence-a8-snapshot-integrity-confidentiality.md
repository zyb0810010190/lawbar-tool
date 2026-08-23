# ADR — Evidence-Genie A8: Snapshot Integrity & Confidentiality (A8-DESIGN-00)

> **Provenance note (2026-08-22).** The governance queue, review tree and autonomy rules
> cited below were removed together with the agent-governance layer in commits `49dd7ad`
> and `e67b047`. Those citations — queue and review paths, sha256 digests, PR numbers —
> are retained deliberately as the audit trail of what authorized this work. They record
> provenance; they are not paths you can follow today. Current authority for hard stops
> is `docs/product/product-definition.md` §20.


- **Status:** Accepted (design-only; cc-suite review-plan `review-plan-mqz8ldue-ut1pn0` READY-WITH-LOW). **Authorizes no code, schema, migration, crypto, or export implementation.** Implementation happens only via the downstream governed WIs in §12, each separately authorized.
- **Date:** 2026-06-29.
- **WI:** WI-EVIDENCE-A8-DESIGN-00 (Type: PLAN; docs/ADR-only).
- **Authoritative source:** `docs/reference/evidence-genie-m0-developer-handover.md` (tracked) §3 (hard invariants), §"A8 — Freeze / backup / restore", §"Snapshot" + §"Anti-circularity rule" data model.
- **Composes under:** `AGENTS.md` §"Evidence-Genie M0 workflow composition" (layer 3) and `.claude/rules/evidence-genie.md` (invariants 6/7/8/9/10). Conflicts resolve in favor of the Evidence invariants.

This ADR **records and decides**; it does not enable any A8 behavior. A0.7 remains the first reality gate; nothing in A8 is built until A0.7 is green (see §8, §10).

---

## 1. What A8 is

A8 is the **snapshot integrity & confidentiality** architecture gate: the machinery that turns the live working case into a **frozen, immutable, verifiable, confidential** point-in-time artifact that can be (a) verified before a hearing, (b) exported as a portable encrypted bundle, and (c) restored byte-faithfully on a second counsel Mac. Per the handover §3:

> **A8 — Snapshot integrity & confidentiality.** A frozen snapshot is immutable, verifiable, and confidential: it contains no unresolved replacements; the manifest detects any post-freeze byte change and is itself tamper-evident via the seal; restored on any counsel Mac it reproduces the **byte-identical canonical export model** (and citations/anchors); the portable bundle is restorable **only with the user-held passphrase**, independent of the local device key.

A8 comprises seven tickets (handover §A8), to be implemented in the stated order **T2→T3→T5→T4→T6→T7→T1**:

| Ticket | Purpose | Verify harness | CI gate |
|---|---|---|---|
| A8.2 | Freeze service — SQLite **Online Backup API by default** (`VACUUM INTO` only as explicit compaction); enforce the A1.8 freeze-block gate; atomic; audited | `freeze-service` | — |
| A8.3 | Manifest + seal — SHA-256 over files(role)/logical SQLite payload/citation map/anchor set/export previews/optimized renditions; separate `SnapshotSeal`; **verify-before-hearing**; newer-app open **read-only, no migration** | `snapshot-verify` | ✅ |
| A8.5 | Two-key encryption — `LocalDatabaseKey` (Keychain/Secure-Enclave) vs `BundlePassphrase` (never stored, zeroized) → pinned **Argon2id** (OWASP floor 19 MiB / 2 / 1) → **AES-256-GCM**; forgotten passphrase = unrecoverable | `two-key-crypto` | ✅ |
| A8.4 | Export bundle — package snapshot+manifest; AES-GCM; refuse unfrozen; no partial | `export-bundle` | — |
| A8.6 | Restore on second Mac — decrypt → verify manifest → read-only; reproduce **byte-identical canonical model (A10-T6), citations (A1-T6), anchors (A3-T10)**; fresh `LocalDatabaseKey` | `restore-and-reproduce` | — |
| A8.7 | Snapshot versioning — keep last N; never overwrite; audited pruning | `snapshot-versioning` | — |
| A8.1 | Autosave + crash recovery — atomic/WAL; recover last consistent state | `autosave-recovery` | — |

## 2. Why A8 is the next critical-path gate after A3 (and why not A5)

The handover §"Build-readiness status" names **four hard invariants specified at ticket depth: A1 / A3 / A8 / A10** (citation identity, anchor resolution, snapshot integrity, court-fileable export), and states **"A5/A6/A9 are deliberately at epic level only — off the critical path."** A3 (anchor/link engine) shipped (12 A3 ADRs; persistence + IPC + UI + real packaged round-trip). The remaining un-built hard-invariant architecture gates are **A8** and **A10**. A8 is selected next because:

- A5 ("forms"), A6 ("search/coverage/synthesis"), A9 ("audit/offline") are explicitly off the critical path and not at ticket depth; designing them as architecture gates would contradict the handover. (They remain valid future product work, separately scoped.)
- A8 has a complete ticket-depth spec to design against; its surface on `main` is **zero** (no ADR, no code).
- A8 is the integrity/confidentiality substrate every court-facing deliverable depends on; A10 export reproducibility is *verified through* A8 restore (A8.6 → A10-T6), so the integrity contract should be decided before/with the export contract.

## 3. What A8 must NOT do

- **MUST NOT** weaken any A0.7 / A1 / A3 / A10 / A1-T9 invariant (`.claude/rules/evidence-genie.md`).
- **MUST NOT** break manifest/seal anti-circularity: the manifest hashes a deterministic **logical** payload, never the encrypted DB file holding the seal (§5).
- **MUST NOT** let an `OptimizedDocumentRendition` become a citation/anchor basis; renditions are manifest-tracked artifacts only (Evidence invariant 7).
- **MUST NOT** migrate a frozen snapshot in place — a newer app opens it **read-only, no migration**; any migration runs on a copy and re-manifests (handover §"do not migrate frozen snapshots in place").
- **MUST NOT** introduce network/cloud/sync/auth behavior — A8 is local-first/offline (App-Sandbox, no network entitlements; `.claude/rules/client-local-first.md`).
- **MUST NOT** ship plaintext production evidence at rest — A8.5 encryption-at-rest is gated behind the `ADR-evidence-a3-persistence-substrate` §5 HARD STOP + explicit user authorization (§7, §10).
- **MUST NOT** be built before A0.7 is green; **MUST NOT** invent A10's `CanonicalExportModel` (§6, §8).

## 4. Freeze / snapshot semantics (A8.2, A8.1, A8.7)

- **Freeze (A8.2):** produces a point-in-time-consistent, read-only `Snapshot { id, caseId, createdAt, path }`. Uses the **SQLite Online Backup API by default** (consistent live-DB copy without exclusive lock); `VACUUM INTO` is reserved for explicit compaction, not the default freeze path. Freeze is **atomic** (no partial snapshot) and **audited** (immutable `AuditEntry`).
- **A1.8 freeze-block gate:** freeze MUST refuse when the case "contains unresolved replacements" (the A8 invariant's "no unresolved replacements"). Decision: A8.2 enforces the A1.8 gate as a precondition — a `replaced_pending_review`/`superseded` document with dependent anchors/links resolving to `needs_review` blocks freeze until acknowledged (acknowledged-broken-links are recorded via `acknowledgedBrokenLinksSha256`, preserving A3 `needs_review`/`broken` semantics — never silently frozen as valid).
- **Autosave + crash recovery (A8.1):** atomic / WAL writes recover the last consistent state. Decided last in the order (T1) because it hardens the live DB and must not interfere with the freeze-consistency contract.
- **Versioning (A8.7):** keep last N snapshots; **never overwrite**; pruning is audited.

## 5. Manifest / seal semantics + anti-circularity (A8.3)

`SnapshotManifest` hashes (SHA-256) every artifact by role:
```
SnapshotManifest { snapshotId, createdAt, appVersion, schemaVersion,
  files:[{ path, sha256, role: original|optimized|exportPreview }],
  sqlitePayloadSha256, citationMapSha256, anchorSetSha256, acknowledgedBrokenLinksSha256?,
  exportPreviews:[ExportPreview.canonicalModelSha256 …],
  optimizedRenditions:[{ documentId, sourceDocumentSha256, optimizedSha256,
    compressionProfile, readabilityVerified, geometryVerified, anchorRoundTripVerified }] }
SnapshotSeal { snapshotId, manifestSha256, sealedAt, sealedByAppVersion,
  sealMethod: local_sqlcipher_hmac | bundle_aes_gcm }
```

**🔑 Anti-circularity rule (LOAD-BEARING — do not break):** `sqlitePayloadSha256` hashes a deterministic **logical** payload, **NOT** the encrypted DB file that holds the seal. The `SnapshotSeal` is **separate** from the manifest (`manifestSha256` makes the manifest tamper-evident without a circular self-hash). The seal lives in the SQLCipher DB (local) or inside the AES-GCM envelope (bundle). `sealedByAppVersion` lets a newer-app read-only open distinguish a known-older seal from an unknown/malformed one. Live-DB integrity is checked separately via `PRAGMA cipher_integrity_check`. (This is `.claude/rules/evidence-genie.md` invariant 8.)

**verify-before-hearing (CI gate `snapshot-verify`):** any post-freeze byte change is detected; the seal proves manifest authenticity; verification runs before a snapshot may be used in court. Newer-app open is **read-only, no migration**.

## 6. Restore / reproduce semantics (A8.6)

Restore on a second Mac: **decrypt → verify manifest (+ seal) → open read-only → reproduce**. Reproduction acceptance is **byte-identical** for three layers, each owned by a *different* gate:
- **Canonical export model** byte-identical → **A10-T6** (`golden-export`). A10 owns `CanonicalExportModel`; A8 only consumes it.
- **Citations** reproduced → **A1-T6** (`citation-stability-gate`).
- **Anchors** reproduced → **A3-T10** (`a3-regression`).
- A fresh `LocalDatabaseKey` is minted on the restoring device (device-local; not transported).

**Sequencing decision (does not invent A10):** A8.6's "byte-identical canonical model" acceptance is **sequenced behind A10** — see §8. A8 design defines the *dependency and the restore protocol*; it does **not** define `CanonicalExportModel`'s schema, serializer, fixture format, or export contract (those are A10's).

## 7. Confidentiality model & key-custody boundaries (A8.5)

Two independent keys, never conflated:
- **`LocalDatabaseKey`** — device-local, Keychain / Secure-Enclave resident; encrypts the live + local snapshot DB (SQLCipher). Never leaves the device; a fresh one is minted on restore.
- **`BundlePassphrase`** — **user-held, never stored, zeroized** after use; the only key that opens a portable export bundle. **Forgotten passphrase = unrecoverable** (no recovery, no escrow).

KDF + cipher: `BundlePassphrase` → **pinned Argon2id** (OWASP floor **19 MiB / 2 iterations / parallelism 1** minimum, pinned) → **AES-256-GCM** envelope for the bundle. The bundle's restorability is **independent of the local device key** (a different Mac with the passphrase can restore; the original `LocalDatabaseKey` is irrelelvant to the bundle).

**Composition with A0.7 marker custody (separate concern):** the A0.7 marker HMAC key (`LAWBAR_A07_MARKER_HMAC_KEY`, env-only, never committed; `ADR-evidence-a07-key-custody-operating-model`) is a **gate-attestation** key, orthogonal to A8's data-encryption keys. A8 MUST NOT reuse the marker key for data encryption and MUST NOT persist any A8 key material in env/CI. The two custody models coexist: A0.7 attests gate runs; A8 encrypts evidence at rest + in transit.

**Encryption-at-rest HARD STOP:** `ADR-evidence-a3-persistence-substrate` §5 forbids plaintext production evidence and defers encryption-at-rest (SQLCipher/Argon2id/AES-GCM) to a separately user-authorized WI. A8.5 **records the crypto architecture**; its **implementation remains behind that HARD STOP + explicit user authorization** (also on the `.claude/rules/autonomy.md` hard-stop list: crypto/secrets/key custody).

## 8. Interaction & sequencing with A0.7 / A1 / A3 / A10 (verified build state)

Build state on `main` (read-only verified, 2026-06-29):

| Gate | State | Consequence for A8 |
|---|---|---|
| **A0.7** geometry reality gate | **NOT green** — native `renderer-conformance` is `not_implemented` (a `not_implemented` harness is a FAIL by `.claude/rules/evidence-genie.md` invariant 10) | **A8 implementation MUST NOT begin until A0.7 is green.** A8 *design* (this ADR) may proceed; building on A0.7 may not. |
| **A1** citation identity | **PARTIAL** — persistence built (`case_box_document_pages` V9, `buildExportCitations`, ambiguity refusal, byte-stable 卷X页Y); A1-T6 `citation-stability-gate` native harness `not_implemented` | A8.3 `citationMapSha256` + A8.6 citation reproduction depend on A1-T6 being implemented; sequenced as a prerequisite. |
| **A3** anchor resolution | **BUILT** (anchors/links/persistence/IPC/UI/round-trip) | A8.3 `anchorSetSha256` + A8.6 anchor reproduction consume A3; A8 freeze MUST preserve INV-A3-1..A3-10. A3-T10 `a3-regression` native harness still `not_implemented` (needed for the A8.6 anchor-reproduce assertion). |
| **A10** export reproducibility | **SPEC-ONLY** — no `CanonicalExportModel` type; only the A3 precursor `ExportCitationResult`; all A10 harnesses absent | **A8.6's "byte-identical canonical model" cannot close until A10 (esp. A10-T1 contract + A10-T6 golden) exists.** A8 design references it; A8 does not build it. |

**Decided sequencing (the spine of this ADR):**
```
A0.7 green  ──┐
A1-T6 gate  ──┤
A3-T10 gate ──┼─→ (prerequisites)
A10-T1/T6   ──┘
                 ↓
A8.2 freeze → A8.3 manifest+seal → A8.5 crypto* → A8.4 bundle → A8.6 restore+reproduce → A8.7 versioning → A8.1 autosave
                 (* A8.5 implementation also gated behind encryption-at-rest user authorization)
```
A8.2/A8.3/A8.7/A8.1 (freeze, manifest/seal, versioning, autosave over the *logical* payload + anchor/citation maps) can be implemented once A0.7 is green and A1-T6/A3-T10 exist. **A8.6's canonical-model reproduction is the one acceptance that hard-blocks on A10-T6.** This ADR does not require A10 to be designed first to write the A8 architecture — but A8.6 cannot be *accepted complete* until A10 lands.

## 9. Schema / native / UI impact

- **Schema:** A8 will need new persisted entities (`Snapshot`, `SnapshotManifest`, `SnapshotSeal`, `ExportPreview` references, optimized-rendition manifest rows). **No schema change in this lane** (design-only); `CURRENT_SCHEMA_VERSION` stays 12. The schema additions are a future A8-persistence WI, reviewed under the persistence/security loop.
- **Native / Swift crypto:** **Yes** — A8.5 (Argon2id + AES-256-GCM + Keychain/Secure-Enclave) and SQLCipher are native concerns (CryptoKit / GRDB-SQLCipher per the handover), composing with the `native/evidence-core` harness surface. Implemented only post-A0.7-green + encryption-at-rest authorization.
- **Renderer UI:** **Yes, eventually** (freeze button, verify-before-hearing status, passphrase entry, restore flow) — but that is **Phase B (SwiftUI + PDFKit)** product UI, a separate UI-design-artifact lane, **not** this ADR and **not** before A0.7 green.

## 10. Out-of-scope / blockers (explicit)

- **Cloud / public deployment / auth provider / China filings / PIPL / local-first reconciliation:** **not blockers and not in scope.** A8 is local-first/offline by construction; no such decision is required to write or implement this architecture. (If a future portable-bundle *transport* over a network is ever proposed, that is a separate hard-stop ADR — not A8.)
- **A5 forms:** out of scope (off critical path).
- **Implementation of any A8 code/crypto/export/freeze:** out of scope here; each is a downstream governed WI (§12).

## 11. Invariant & threat-model summary

Threats A8 defends against: (a) **post-freeze tampering** → manifest + separate seal, verify-before-hearing CI gate; (b) **confidentiality breach of a portable bundle** → AES-256-GCM under a user-held, never-stored, Argon2id-stretched passphrase, independent of the device key; (c) **silent evidence drift across restore** → byte-identical canonical-model/citation/anchor reproduction (A10-T6/A1-T6/A3-T10); (d) **circular trust** → anti-circularity rule (manifest hashes logical payload, seal separate); (e) **migration corruption of frozen evidence** → read-only, no in-place migration. Invariants preserved verbatim: citations only from `DocumentPage` (A1); anchors version-pinned to persisted geometry, `needs_review` on mismatch (A3 INV-1..10); optimized renditions never citation/anchor basis (A1-T9 / invariant 7); manifest/seal anti-circularity (invariant 8); canonical-model-not-raw-bytes reproducibility (invariant 9); local-first offline.

## 12. Implementation WI sequence (each separately authorized; none authorized by this ADR)

Prerequisite lanes (must precede A8 *implementation*): **A0.7-green** (real Swift/PDFKit `renderer-conformance`); **A1-T6** (`citation-stability-gate`); **A3-T10** (`a3-regression`); **A10-T1 + A10-T6** (`CanonicalExportModel` contract + golden) for A8.6 closure; **encryption-at-rest user authorization** for A8.5.

Then, in handover order T2→T3→T5→T4→T6→T7→T1:
1. **WI-A8-2-FREEZE** — freeze service (Online Backup API), A1.8 gate, atomic, audited. Gate: `freeze-service`.
2. **WI-A8-3-MANIFEST-SEAL** — `SnapshotManifest` + separate `SnapshotSeal`, anti-circularity, verify-before-hearing, read-only newer-app open. Gate: `snapshot-verify` (CI). *Stop-point: anti-circularity must hold; no encrypted-DB self-hash.*
3. **WI-A8-5-TWO-KEY-CRYPTO** — LocalDatabaseKey vs BundlePassphrase, Argon2id(19/2/1), AES-256-GCM, zeroization. Gate: `two-key-crypto` (CI). *Stop-points: encryption-at-rest authorization; security-WI loop (review-plan→tests→audit→verify→sign-off); no key in env/CI.*
4. **WI-A8-4-EXPORT-BUNDLE** — package snapshot+manifest, AES-GCM, refuse unfrozen, no partial. Gate: `export-bundle`.
5. **WI-A8-6-RESTORE-REPRODUCE** — decrypt→verify→read-only→reproduce. Gate: `restore-and-reproduce`. *Stop-point: blocks on A10-T6 + A1-T6 + A3-T10 green.*
6. **WI-A8-7-VERSIONING** — keep last N, never overwrite, audited pruning. Gate: `snapshot-versioning`.
7. **WI-A8-1-AUTOSAVE** — atomic/WAL crash recovery. Gate: `autosave-recovery`.

## 13. Acceptance tests A8 must prove (per the handover verify harnesses)

`freeze-service` (atomic, consistent, A1.8-gated, audited) · `snapshot-verify` **CI** (tamper detection + seal + read-only newer-app) · `two-key-crypto` **CI** (Argon2id params pinned, AES-GCM, zeroization, unrecoverable-on-forgotten) · `export-bundle` (refuse-unfrozen, no-partial) · `restore-and-reproduce` (byte-identical canonical/citations/anchors, fresh device key) · `snapshot-versioning` (last-N, no-overwrite, audited prune) · `autosave-recovery` (last consistent state). A `not_implemented` harness is a FAIL, never a pass.

## 14. Per-lane stop-points (carried into the WIs above)

- A0.7 not green → **STOP** (no A8 implementation builds on a red reality gate).
- A8.5 without encryption-at-rest user authorization → **STOP** (`ADR-evidence-a3-persistence-substrate` §5 + autonomy hard-stop).
- A8.6 before A10-T6 / A1-T6 / A3-T10 are green → **STOP** (reproduction acceptance cannot be proven).
- Any anti-circularity violation (manifest hashing the encrypted DB) → **STOP**.
- Any in-place migration of a frozen snapshot → **STOP**.
- Any network/cloud/sync surface introduced → **STOP** (local-first hard stop).
- Any weakening of A0.7/A1/A3/A10/A1-T9 invariants → **STOP** (surface, never silently choose).

## 15. References
- `docs/reference/evidence-genie-m0-developer-handover.md` (tracked) §3, §A8, §Snapshot, §Anti-circularity.
- `.claude/rules/evidence-genie.md` (invariants 1/6/7/8/9/10), `AGENTS.md` §"Evidence-Genie M0 workflow composition".
- `docs/adr/ADR-evidence-a07-{renderer-conformance-gate,key-custody-operating-model,marker-provenance}.md`.
- `docs/adr/ADR-evidence-a3-{anchor-link-contract,persistence-substrate,export-degradation,durable-unlink-schema}.md` (A3 invariants; persistence-substrate §5 encryption-at-rest HARD STOP).
- `services/case-box-persistence/src/sqlite/{schema.ts,exportCitationQueries.ts}` (A1 PARTIAL build state).
- `native/evidence-core/lib/commands.mjs` (gate shim; `snapshot-verify`/`golden-export`/`two-key-crypto` currently `not_implemented`).
- `.claude/rules/{client-local-first,security-boundary,autonomy,cc-suite}.md`.
