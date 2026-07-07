# Gate 18 — Data-Export / Backup-Format Certification (v1 bounded surface)

**Status:** the **bounded v1 export/backup formats are certified** (surface enumerated + fidelity evidence run green). This is **NOT** a clearance of gate 12 (audit-chain), gate 14 (backup+recovery — cited here as *supporting evidence*, not cleared), or gate 15 (rollback); it does **NOT** imply gate 7 is cleared; and a v1-surface certification is **NOT** a go-live sign-off (gate 21 STOP-AND-ASK, user). **Date:** 2026-07-07. **Author:** Claude Code (WI-RELEASE-G18-EXPORT-BACKUP-FORMAT-CERT-00 execution lane). **Governed by:** `dev-memo/run/queue.md` (queue.governed sha256 `bd85b206…`, PR #198 merge `ff40720`), review `dev-memo/run/reviews/queue-review-148.md`.

Environment of record: macOS 15.6.1 · Node v24.14.0 · `CURRENT_SCHEMA_VERSION = 12`. Fidelity evidence RUN 2026-07-07 (see §2). No export functionality is created or altered by this certification — the T3 export + A10 model + their tests are read-only evidence.

---

## 1. The bounded v1 export / backup surface

v1 export/backup is deliberately minimal (`.claude/rules/client-local-first.md`; brief §165/§166). Two surfaces ship:

### 1.1 Backup format = backup-as-directory
Per brief §165 ("Export (v1 day-one): lawyer-driven local file copy of original files and audit log out of the data directory. **No structured export entity, no PDF report, no signed bundle**") and §283 (backup/export tooling beyond Finder + Time Machine is post-v1). The "format" is the on-disk data directory itself (`~/Library/Application Support/lawbar/` = `case-box.sqlite` + `case-box-documents/` + `theme-preference.json`), copied as a directory.

The manifest + backup/restore procedure for this format is documented and drill-verified in **`docs/release/gate14-backup-recovery-00.md`** — **cited here as supporting evidence for the backup format + procedure, NOT as a certification that gate 14 itself is complete** (gate 14 stays `OPEN — procedure documented + drill-verified`, non-cleared). A directory copy is trivially format-reproducible (byte-for-byte identical files); its recovery fidelity is what the gate-7 crash-recovery drill (PASS) and the gate-14 runbook establish.

### 1.2 The only shipped v1 structured export = the T3 证据目录及说明 (evidence catalog) DOCX
The forms-T3 evidence-catalog DOCX export (`apps/lawbar-desktop/src/caseBox/t3ExportHandlers.ts`; IPC channels `casebox:t3:previewCatalog` / `casebox:t3:exportDocx`; forms-T3 S3 COMPLETE) is the single structured export in v1. It renders the evidence catalog (证据目录及说明) as a Word document (a header + a four-column table, one row per catalog row).

---

## 2. Fidelity evidence (run green 2026-07-07)

Fidelity is framed via the **A10 CanonicalExportModel reproducibility** (`.claude/rules/evidence-genie.md` invariant 9: reproducibility is measured against the deterministic `CanonicalExportModel` serialization, **NOT** raw `.docx`/PDF bytes by default). An `OptimizedDocumentRendition` is never a canonical basis (invariant 7). The exec lane ran the cited tests:

```
node --test apps/lawbar-desktop/tests/a10-canonical-export.unit.test.mjs \
                 tests/t3-docx-export.unit.test.mjs \
                 tests/ipc-casebox-t3-export.unit.test.mjs \
                 tests/t3-catalog-model.unit.test.mjs
# → tests 60 · pass 60 · fail 0
```

| Evidence | What it certifies | Result |
|---|---|---|
| `a10-canonical-export.unit.test.mjs` | The **CanonicalExportModel** deterministic serialization: byte-identical to a locked golden fixture + sha256; rebuild + input-reordering yield the identical hash; optional `generatedFromSnapshotId` omitted (never serialized null). This is the reproducibility layer. | **green** |
| `t3-docx-export.unit.test.mjs` | The T3 DOCX structural + OOXML shape: header + four-column table, one row per model row; verbatim NFC Chinese text; `reviewNeeded` markers rendered (never blank-as-data); no `卷X页Y` citation column; empty model → header-only table; no T4/T5 (证明对象/三性/质证) leakage. | **green** |
| `ipc-casebox-t3-export.unit.test.mjs` | The T3 export IPC round-trip (`casebox:t3:exportDocx`). | **green** |
| `t3-catalog-model.unit.test.mjs` | The T3 catalog logical model (序号 1..n ordering; column headers; submitter/litigation-position rendering). | **green** |

The backup-as-directory format (§1.1) is a **file-copy that preserves the underlying file bytes** (byte-for-byte directory copy — file-copy preservation, not deterministic regeneration of contents) and is recovery-verified by the gate-7 crash-recovery drill (`docs/release/gate7-crash-recovery-drill-00.md`, PASS: `integrity_check=ok`, audit `event_count==COUNT==MAX(sequence)` across crash+restore).

---

## 3. Post-v1 export exclusions (recorded, NOT designed here)

The following are certified as **OUT of the v1 export surface** and each deferred to its own **STOP-AND-ASK ADR** (brief §166), NOT designed or built by this certification:

- Signed evidence bundle (format TBD, tamper-evident) — brief §166.
- PDF chronology / proof matrix / privilege log — brief §166 (proof matrix = T4, post-v1).
- Plain-text fact dump — brief §166.
- Bulk export / cross-matter aggregation / privilege-log export — brief §64 (NO).
- Redacted-derivative export — brief §164 (NOT designed v1; STOP-AND-ASK post-v1 ADR).

---

## 4. Scope boundaries + honest status

**Certified:** the two bounded v1 formats above (backup-as-directory + the T3 证据目录及说明 DOCX export) and their fidelity evidence (§2, run green).

**NOT cleared / NOT implied by this certification:**
- **Gate 14** (backup + recovery) — cited as supporting evidence for the backup format; stays `OPEN — procedure documented + drill-verified`, non-cleared.
- **Gate 12** (audit-chain tamper-evidence) — the audit log is part of what a backup preserves; related, not cleared here.
- **Gate 15** (rollback dry-run) — related recovery surface; not cleared here.
- **Gate 7** (robustness) — the crash-recovery drill exercised the backup format; informs, does not clear; gate 7 stays user-decision-dependent (D-G7-1/D-G7-2).
- **Gate 6** (full-project audit) — a certification gap would be a finding there.

**Go-live independence:** a bounded v1-surface export/backup-format certification does **NOT** imply go-live. The final GO/NO-GO and the STOP-AND-ASK hard-stops (gate 4 signing/distribution, gate 11 律师法, gate 17 license/business, gate 21 final sign-off) remain the user's.

**Gate-18 status:** the v1 export/backup formats are now certified; gate 18 stays **OPEN** in the readiness matrix (`OPEN — v1 export/backup formats certified`, PARTIAL-eligible at the next holistic readiness refresh, which owns the roll-up bucket move). No post-v1 export format is designed here.

---

## 5. Dependencies mapped (not cleared)

- **gate 14** — the backup-as-directory format is documented + drill-verified there; CITED as supporting evidence, NOT cleared.
- **gate 12** — audit-chain integrity (part of a backup's preserved content); related, not cleared.
- **gate 15** — rollback (related recovery path; the crash-recovery drill is a cited exercised recovery); not cleared.
- **gate 7** — robustness (the drill that exercised the backup format); informs, not cleared.
- **gate 6** — full-project audit; a certification gap would surface there.
