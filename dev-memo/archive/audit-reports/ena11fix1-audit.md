**Findings**

No Critical / High / Medium findings.

**Audit Notes**

`isMarker` is now in `PAYLOAD_FIELDS` at [scripts/workflow/a07_marker.py](/Users/zhongyibao/ClaudeProjects/lawbar-tool/scripts/workflow/a07_marker.py:37), so `_canonical()` includes it for both `provenancePayloadHash` and HMAC. Writer and validator both use the same `PAYLOAD_FIELDS` and `_canonical()` path: write at line 115, validate at lines 170-175.

`cmd_write` sets `"isMarker": True` inside the payload before canonicalization at [scripts/workflow/a07_marker.py](/Users/zhongyibao/ClaudeProjects/lawbar-tool/scripts/workflow/a07_marker.py:95). The old redundant post-canonical `marker["isMarker"] = True` assignment is removed; marker output is now `dict(payload)` plus provenance fields.

`cmd_validate` has the strict identity check `m.get("isMarker") is not True` at [scripts/workflow/a07_marker.py](/Users/zhongyibao/ClaudeProjects/lawbar-tool/scripts/workflow/a07_marker.py:165), so `"true"`, `1`, `false`, missing, and null all reject. Because `isMarker` is also HMAC-bound, a true-to-false edit changes the rebuilt canonical payload and would also mismatch the stored payload hash/HMAC if the explicit check were not present.

The regression adds an `isMarker` true-to-false mutation test at [scripts/workflow/a07-marker.test.sh](/Users/zhongyibao/ClaudeProjects/lawbar-tool/scripts/workflow/a07-marker.test.sh:48). Existing touched/copied/schema-only/wrong-key/duplicate-runId/traversal/eligibility checks remain intact. `git status` showed only the two scoped files modified.

I attempted `bash scripts/workflow/a07-marker.test.sh`, but this environment is read-only and `mktemp`/temp writes were denied, so the run failed for sandbox reasons rather than code behavior.

Verdict: **PASS for WI-ENA11-FIX1 remediation; no Critical/High/Medium issues found.**
