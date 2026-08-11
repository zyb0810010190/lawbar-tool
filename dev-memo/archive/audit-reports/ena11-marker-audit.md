No Critical or High findings.

**Findings**

**Medium**: `a07_marker.py write` can write outside `--out-root` via `--repo-commit` path traversal.  
In [scripts/workflow/a07_marker.py](/Users/zhongyibao/ClaudeProjects/lawbar-tool/scripts/workflow/a07_marker.py:113), `marker_path` is built as:

```python
marker_path = os.path.join(marker_dir, f"{a.repo_commit}.marker.json")
```

The shell writer supplies `git rev-parse HEAD`, so the normal path is safe. But the Python core is itself an exposed write command and accepts arbitrary `--repo-commit`. A value like `../../somewhere` resolves outside `<out-root>/a07`, and can escape `--out-root` if parent directories exist. That violates the WI’s “no accidental writes outside --out-root” requirement. Fix by validating `repo_commit` as a hex SHA-like token or by resolving the final path and requiring it remains under `realpath(out_root)/a07`.

**Low**: `check-marker-guard.sh` header comments are stale and now contradict behavior.  
At [scripts/workflow/check-marker-guard.sh](/Users/zhongyibao/ClaudeProjects/lawbar-tool/scripts/workflow/check-marker-guard.sh:4), the comments still say no marker writer/validator is authorized and the accepted-marker set is empty. The implementation now accepts provenance-valid local markers during `--scan`. This is not a runtime bug, but this file is guard/security documentation too; stale comments are risky in this repo’s contract-heavy workflow.

**Confirmed**

Key custody is env-only in the implementation: write and validate fail closed when `LAWBAR_A07_MARKER_HMAC_KEY` is missing or shorter than 32 chars. I found no committed/persisted/cloud/keychain key path.

Forgery resistance is structurally sound: the HMAC and payload hash are over fixed-order canonical JSON payload fields, not the marker file. Validation reconstructs the canonical payload, checks `provenancePayloadHash`, then uses `hmac.compare_digest`. Schema-only markers do not validate.

Anti-replay ledger binding is present: validation requires exactly one ledger entry for `runId`, and binds marker path, payload hash, repo commit, and repo tree hash. Relocated/copied markers fail path binding.

Eligibility is enforced in both layers: `a07-marker-write.sh` refuses anything except `pass` + `ok`, and `a07_marker.py validate` rejects non-eligible marker payloads. The Swift CLI reuses `EvidenceCoreA07Harness.run`; I saw no harness semantics change or JS shim change.

Guard behavior matches the intended main policy: staged and tracked files under `dev-memo/run/evidence/**`, including the ledger, are rejected unconditionally. `--scan` only accepts untracked local `*.marker.json` files if validation succeeds, skips `ledger.jsonl`, rejects other files, and does not create the namespace.

Bound artifacts are re-read during validation and SHA-256 checked.

I could not run the full marker self-test in this environment because the sandbox denies `mktemp`/temporary writes. I did run `bash scripts/workflow/check-marker-guard.sh --scan`, which passed on the current clean marker namespace.

Verdict: **FAIL until the path traversal write bug is fixed; otherwise the security model is largely coherent for the stated local-only/HMAC-key-custody design.**
