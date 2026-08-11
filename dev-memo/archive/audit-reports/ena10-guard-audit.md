**Findings**

Medium: `--paths` normalization is incomplete in [check-marker-guard.sh](/Users/zhongyibao/ClaudeProjects/lawbar-tool/scripts/workflow/check-marker-guard.sh:64). It strips leading `./` and duplicate `/`, but does not normalize absolute repo paths or `..` segments before the namespace. I confirmed these incorrectly pass with rc 0:
`/Users/zhongyibao/ClaudeProjects/lawbar-tool/dev-memo/run/evidence/a07/x.marker.json`
`dev-memo/run/../run/evidence/a07/x.marker.json`
Current `--scan` is less exposed because `git ls-files` is canonical and `find` output is stripped to repo-relative, but the documented `--paths` classifier is bypassable.

Medium: `--scan` only finds untracked regular files under the namespace via `find ... -type f` in [check-marker-guard.sh](/Users/zhongyibao/ClaudeProjects/lawbar-tool/scripts/workflow/check-marker-guard.sh:57). An untracked symlink or other filesystem entry under `dev-memo/run/evidence/**` would not be rejected by scan mode. A staged symlink should be caught by `git ls-files`, but the working-tree scan is not truly “any path under the namespace.”

Low: The self-test does not fail fast on setup errors in [check-marker-guard.test.sh](/Users/zhongyibao/ClaudeProjects/lawbar-tool/scripts/workflow/check-marker-guard.test.sh:42). In this read-only sandbox, `mktemp`/`mkdir` failed and the script continued into misleading partial results. In a normal writable environment this likely passes, but the test harness should treat fixture setup failure as an immediate test failure.

**Confirmed**

No Critical/High findings.

The accepted set is genuinely empty: the only namespace match appends to `violations`, and any violation exits 2 in [check-marker-guard.sh](/Users/zhongyibao/ClaudeProjects/lawbar-tool/scripts/workflow/check-marker-guard.sh:79).

No marker/provenance writer exists in the guard. I found no mkdir/write/HMAC/signature/key/provenance behavior in the guard itself; only path classification plus rejection.

The namespace-as-substring case is not a false positive: `docs/dev-memo/run/evidence-notes.md`, `dev-memo/run/evidence-notes.md`, and `xdev-memo/run/evidence/a` all passed.

The `check-gates.sh` integration is additive and narrow: it runs `--scan`, runs the self-test, then preserves the existing desktop test gate and exit-on-failure behavior in [check-gates.sh](/Users/zhongyibao/ClaudeProjects/lawbar-tool/scripts/workflow/check-gates.sh:13).

Verdict: **FAIL pending Medium fixes to path normalization and scan coverage.**
