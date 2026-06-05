## WI-401: anchor parseFdesetupStatus so unexpected output fails closed
Type: IMPL
Scope: anchor the FileVault status regexes in apps/lawbar-desktop/src/security/fileVaultProbe.ts so output with an unexpected trailing suffix (e.g. "FileVault is On: weird") classifies as unknown instead of on/off, making decideAction block in production (fail-closed) instead of treating an ambiguous probe result as encrypted
Source of truth: dev-memo/deferred-audit-findings.md (AT1-L1 row); apps/lawbar-desktop/src/security/fileVaultProbe.ts (parseFdesetupStatus)
Allowed files: apps/lawbar-desktop/src/security/fileVaultProbe.ts, apps/lawbar-desktop/tests/main.test.mjs, dev-memo/deferred-audit-findings.md
Forbidden files: none
Gates: npm --prefix apps/lawbar-desktop test
Acceptance criteria: parseFdesetupStatus("FileVault is On: unexpected suffix") returns unknown (not on); exact "FileVault is On." and "FileVault is Off." still return on and off; a unit test for the suffix case passes and the full apps/lawbar-desktop test suite passes
Risk flags: security-boundary (FileVault enforcement probe); broker review-plan + audit + verify required; behavior change tightens fail-closed only
Depends on: none
Commit boundary: one local commit for the probe-anchoring fix + tests + ledger row

## WI-501: pin the never-classified document classification distinction in conformance
Type: TEST
Scope: add a case-box persistence conformance assertion that a never-classified document yields an empty listConfidentialityClassifications page AND getEffectiveClassification returns unclassified, so the intended (currently unpinned) distinction is regression-guarded across every persistence implementation; no production behavior change
Source of truth: dev-memo/deferred-audit-findings.md (F4.3 row); services/case-box-persistence/src/inMemoryRepo.ts (listConfidentialityClassifications + getEffectiveClassification); services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs (existing seedMatterDoc helper registers a matter+document without classifying it)
Allowed files: services/case-box-persistence/tests/conformance/runCaseBoxPersistenceConformance.mjs, services/case-box-persistence/tests/conformance/fixtures.mjs, services/case-box-persistence/tests/sqlite.conformance.test.mjs, dev-memo/deferred-audit-findings.md
Forbidden files: none
Gates: npm --prefix services/case-box-persistence test
Acceptance criteria: a new conformance case using the existing seedMatterDoc helper asserts that for a registered-but-never-classified document, listConfidentialityClassifications returns an empty page (rows is [] and next_cursor is null) AND getEffectiveClassification returns effectiveLevel "unclassified" with empty history; the case runs against in-memory AND SQLite (covered by the full sqlite-final conformance sweep that npm test runs, and if the new case id falls outside the filtered sqlite.conformance.test.mjs case-list range it is added to that list so the filtered SQLite run also exercises it); the full services/case-box-persistence test suite passes; no src/ production file is modified
Risk flags: test-only; no production behavior change; pins shipped behavior to prevent future regression; broker review-plan + audit + verify (case-box is a persistence contract surface)
Depends on: none
Commit boundary: one local commit for the conformance pin + ledger row
