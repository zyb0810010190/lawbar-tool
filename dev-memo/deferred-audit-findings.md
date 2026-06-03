# Deferred Audit Findings — Backlog

**Status**: append-only-ish backlog of cc-suite audit findings that were not fixed in their originating WI. Started 2026-05-21.

**Purpose**: provide a durable, scannable location for every Low (and any escalated Medium-or-higher) the assistant chose not to fix inside its originating WI. The commit-message recording per `.claude/rules/cc-suite.md` §"Audit remediation policy" is per-WI; this file is the project-wide rollup so future WIs can find prior deferrals without scraping `git log`.

**Update rules**:

- **Append on every WI close** when the audit deferred any finding. Group entries by WI / commit.
- **Update `status`** (open / closed / superseded) when a later WI addresses an open entry. Do NOT delete rows — flip the status and add a "resolved-in" reference. The historical evidence stays visible.
- **Group several findings into one row** only when they share severity + deferral category + target backlog label. Otherwise keep one row per finding for greppability.
- **Security-adjacent Lows** (SSRF / TLS / DNS / auth / sandbox per `.claude/rules/security-boundary.md`) MUST NOT appear here as `status: open` — `.claude/skills/security-wi-loop/SKILL.md` §6 requires escalation, not deferral, for those.

**Column legend**:

- `WI` — work-item label and resolution commit short hash.
- `Audit job` — `/cc-suite:status`-retrievable Path-1 job id from the originating WI.
- `Verify job` — `/cc-suite:status`-retrievable verify-pass job id that recorded the deferral.
- `Finding ID` — the auditor's identifier (e.g. `F2.1`, `Dim 3 #1`).
- `Severity` — Critical / High / Medium / Low. Anything above Low SHOULD appear as `status: escalated`, NOT `status: open` per `.claude/rules/cc-suite.md` §"Audit remediation policy" item 1.
- `Reason for deferral` — one sentence citing which clause of §"Resolution rules" item 2 applies.
- `Target` — future WI label, backlog tag, or `cleanup-accepted (no follow-up planned)`.
- `Safe-to-proceed?` — `YES` / `NO`. `NO` means this row should already be an escalation, not a deferral.
- `Status` — `open` / `closed` / `superseded`. `closed` means a later WI addressed it (cite the resolution commit in `Notes`). `superseded` means the underlying audit pattern stopped applying (e.g. the affected code was deleted).
- `Notes` — free-form context + resolution-commit reference once closed.

---

## Staging-guard detection hardening (WI-SCAFFOLD-006, commit `<pending>`)

Closes the gap surfaced when WI-SCAFFOLD-005 removed the `if` filters so all git guards run on
every Bash call: `batch-commit-guard.sh` had statement-aware command-word detection (WI-SCAFFOLD-004)
but the two staging guards still used substring/boundary matching, so path-prefixed forms slipped
them even when invoked. Ported the command-word detection (path-prefix, wrappers, env assignments,
git global options) into both staging guards.

| Finding ID | Severity | Reason for deferral / disposition | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| BGAA-1 | High | FIXED in WI-SCAFFOLD-006 — `block-git-add-all.sh` now detects broad `git add` across `/usr/bin/git`, `./git`, `\git`, wrappers (`env`/`command`/`exec`/`time`/…), env assignments, and global options (`-c`/`-C`/`--no-pager`); also catches quoted broad pathspecs (`"*"`, `"."`). | — | YES | closed | resolved-in `<pending>`; tests `block-git-add-all.test.sh` (30 cases) |
| BCSA-1 | High | FIXED in WI-SCAFFOLD-006 — `block-commit-stage-all.sh` now detects `git commit -a/--all/-am…` across the same git forms; quoted message content stripped first so `-a` in a message is ignored. | — | YES | closed | resolved-in `<pending>`; tests `block-commit-stage-all.test.sh` (26 cases) |
| BGAA/BCSA-2 | Low | Deferred (bounded, mirrors batch-commit-guard) — both staging guards inherit the same out-of-scope limits: command-substitution / variable-indirected forms, arg-taking wrapper flags (`env -u NAME`). | WI: shell-aware parsing (shared with BCG-8/9/10, BRCBW path-indirection) | YES | open | consistent with the rest of the guard suite |

---

## Independent enforcement-hook audits — post-canary (WI-SCAFFOLD-004, commit `059e7f6`)

Three independent cc-suite full audits of the workflow enforcement hooks, run while Codex exec was responsive. Severities below are my adjudicated values; the hooks' own headers state the threat model is "cooperative agent + direct-write block, NOT cryptographic", so most bypasses are defense-in-depth gaps, not active Criticals. User (2026-05-31) authorized fixing ONLY the batch-commit-guard git-detection set + rev-list fail-open in WI-SCAFFOLD-004; path-indirection and token-nonce hardening are explicitly deferred to later WIs.

| Audit job | Scope |
|---|---|
| `audit-mpuesqmt-4zzpxr` | `.claude/hooks/batch-commit-guard.sh` |
| `audit-mpuesqil-hgp1vs` | `.claude/hooks/block-run-control-bash-write.sh` |
| `audit-mpuesqrc-zmw5b5` | `.claude/hooks/protect-run-control.sh` |

| Finding ID | Severity | Reason for deferral / disposition | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| BCG-1 | High | FIXED in WI-SCAFFOLD-004 — git-detection now statement-aware: `/usr/bin/git commit`, `git -c k=v commit`, `git --no-pager commit`, `FOO=bar git commit`, plus command-prefix wrappers `\git` / `command` / `exec` / `time` / `env [-i] FOO=bar git` (scope-extension, audit-mpufm338-2gtelo #1) | — | YES | closed | resolved-in `059e7f6`; tests `batch-commit-guard-detect.test.sh` (28 cases) |
| BCG-2 | High | FIXED in WI-SCAFFOLD-004 — multiple `git commit` in one Bash call now denied (one decision != many commits) | — | YES | closed | resolved-in `059e7f6` |
| BCG-3 | High | FIXED in WI-SCAFFOLD-004 — `rev-list` non-zero/non-numeric now denies, in BOTH the final count AND the divergent-base helpers (was fail-open COUNT=0; audit-mpufm338-2gtelo #4) | — | YES | closed | resolved-in `059e7f6` |
| BCG-4 | High | Deferred (user-authorized) — `human.ack` consumed even if `rm -f` fails -> reusable gated token | WI: token-nonce hardening | YES | open | nonce + recency instead of file-presence |
| BCG-5 | High | Deferred (user-authorized) — `human.override` consumed even if log append / rm fails | WI: token-nonce hardening | YES | open | require successful append+removal or deny |
| BCG-6 | High | Deferred (user-authorized) — governed-queue check trusts `queue.governed` presence; stale marker survives `queue.md` edits | WI: queue-content-hash governance (GOVERNANCE-CHAIN-001) | YES | open | record + verify a queue content hash |
| BCG-7 | Medium | Deferred — huge-digit config values -> bash integer compare error disables checks | WI: config validation | YES | open | whitelist AUTO_ADVANCE_MAX in {1,3,10}, bound EVERY |
| BCG-8 | Low | Deferred per user (no alias resolution) — git aliases that invoke commit (`git -c alias.x=commit x`) evade subcommand detection (audit-mpufm338-2gtelo #2). Esoteric; generic alias resolution in-hook is heavy. | WI: (only if a real alias-commit workflow appears) | YES | open | my calibration Low vs Codex Critical — needs a deliberately commit-aliased subcommand |
| BCG-9 | Medium | Deferred per user (no full quote-aware parser) — a single commit whose `-m` message contains `; git commit …` (or `|`/`&`) splits and is wrongly counted as 2 -> DENIED (audit-mpufm338-2gtelo #3). Fails CLOSED (over-denies a legit commit), not a security bypass. | WI: quote-aware statement splitting | YES | open | `&&`-in-message is safe; other separators are not |
| BCG-10 | Low | Deferred (bounded unwrap only) — command-prefix wrappers with arg-taking flags (`env -u NAME`, `exec -a NAME`) can consume the next token and miss `git` (fail-open for that exotic form). Only no-arg wrapper flags + assignments are unwrapped in WI-SCAFFOLD-004. | WI: shell-aware parsing (with BRCBW path-indirection) | YES | open | `env -i FOO=bar git commit` IS handled; `env -u X git commit` is not |
| BRCBW-1 | High | Deferred (user-authorized) — `cd dev-memo/run && echo x > config` (relative-after-cd) + variable/`$()`-indirected paths bypass literal matching | WI-B: Bash path-indirection hardening (spec: `dev-memo/plan-brcbw-parser-depth-00.md` §3 Mechanism B) | YES | open | needs shell-aware parsing/canonicalization; design specified, not yet implemented |
| BRCBW-2 | High | Deferred — dynamic redirection targets (`echo x > "$p"`, `$(printf …)`) not caught | WI-B: Bash path-indirection hardening (spec: `dev-memo/plan-brcbw-parser-depth-00.md` §3 Mechanism B) | YES | open | deny dynamic targets when run-control paths in scope; design specified, not yet implemented |
| BRCBW-3 | High | Closed — the BRCBW-5 statement-aware rewrite (split on `;`/`&&`/`\|\|`/`\|`/`&`, `-a` detected per statement) already parses each `tee` invocation separately; per-invocation regression proof added (`tee -a /tmp/ok; tee dev-memo/run/log.md` denies, `tee dev-memo/run/log.md; tee -a /tmp/ok` denies, `tee -a /tmp/ok` alone allows, prose mentions of `tee`+protected paths do not false-deny) | WI: per-invocation tee/sed parsing | YES | closed (regression proof, no guard change; tests in `.claude/hooks/tests/block-run-control-bash-write.test.sh`) | parse each `tee` separately |
| BRCBW-4 | High | Closed — in-place detection in the `sed\|perl` branch now matches any single-dash cluster containing `i` (`-*i*`: `-i`, `-i.bak`, and the clustered perl forms `-pi`/`-ni`/`-wpi`/`-pi.bak`) plus `--in-place[=…]`, while explicitly ignoring other long opts; a strict SUPERSET of the prior `-i*` glob so no existing protection weakened. `sed -i.bak` was already covered by `-i*`; this WI closes the perl-cluster gap. | WI: per-invocation tee/sed parsing | YES | closed (commit on `workflow-brcbw4-perl-inplace`; tests in `.claude/hooks/tests/block-run-control-bash-write.test.sh`) | match `-iEXT`, `-i ''`, perl `-pi`/`-i.bak` |
| BRCBW-5 | Medium | FIXED — `block-run-control-bash-write.sh` pass 2/3 is now statement-aware + command-word gated: a write verb only counts as a statement's command word, and only an authority path in a WRITE-TARGET position denies (cp/install/rsync destination, `dd of=`, any operand for rm/mv/ln/touch/truncate/tee/sed-i). Read-source (`cp dev-memo/run/config /tmp/x`, `dd if=`) and prose mentions now pass; no real write weakened. | — | YES | closed | resolved-in `<pending>`; tests `block-run-control-bash-write.test.sh` (63 cases, +18). BRCBW-6 NOT bundled. |
| BRCBW-6 | Medium | Closed — when jq is unavailable the parse fallback cannot decode JSON escapes, so an escaped protected path (`dev-memo\/run\/config`, `\uXXXX`, `\\`-spliced, `\"`-spliced) slipped the post-parse `grep dev-memo/run/`. Fix: the jq-absent branch now FAILS CLOSED on ANY backslash in the raw payload (in well-formed JSON a backslash occurs only inside a string escape, so its presence = an escape we cannot safely resolve without jq). Closes the whole jq-absent obfuscation class, not a narrow allow-list. jq-PRESENT behavior byte-for-byte unchanged (fix is wholly in the else branch). cc-suite chain: audit `audit-mpxi9cp3-oz4ae8` (High: `\\`/`\"` defeated the initial `\/`+`\uXXXX` allow-list) → broadened to any-backslash → Path-1 verify TIMEOUT (`spawnSync codex ETIMEDOUT`) → Path-2 direct MCP verify (session `019e8ba6-835a-7553-a363-e8e3197b5116`, gpt-5.5) = "JQ-ABSENT CLASS CLOSED". Tests 126→143, 0 failed (controlled missing-jq harness: temp PATH without jq); main's 126-case suite passes against the new hook (additive). | WI: require-jq-or-deny (commit on `workflow-brcbw6-jq-failclosed`) | YES | closed | jq-absent class closed; bash-metacharacter path obfuscation split to BRCBW-10 |
| BRCBW-10 | Low | Open — Bash-metacharacter path obfuscation defeats the lexical `grep dev-memo/run/` REGARDLESS of jq. A command whose redirect/operand spells the protected path via Bash word-mechanics rather than a JSON escape — e.g. jq-PRESENT `echo X > dev-memo/r\un/config` (Bash strips the `\` → `run`), `dev-memo/"run"/config` (quote concatenation), `dev-memo/ru''n/config`, `$IFS`/brace tricks — is ALLOWED because the guard matches the literal pre-resolution string, not Bash's resolved target. Surfaced by `audit-mpxi9cp3-oz4ae8` during BRCBW-6; NOT the jq-absent class (needs no JSON escape; reproduces with jq present). Same root cause family as BRCBW-1/2 (lexical matching vs Bash's actual path resolution). | WI-B / path-indirection (spec `dev-memo/plan-brcbw-parser-depth-00.md`; pairs with BRCBW-1/2) | YES | open | recorded during BRCBW-6, NOT bundled; needs canonicalization or a real shell-token resolver, not a lexical patch |
| BRCBW-7 | Low | Closed for the proven behaviors only: (a) the `==`/`!=`/`=`/`test` co-occurrence forms already allow via the BRCBW-5 command-word gating (`[[`/`[`/`test` are not write verbs), proven by regression; (b) the literal `[[ x > config ]]` case (where pass-1 read `>` as redirection) is fixed by blanking `[[ … ]]` spans before pass-1 redirection detection — bash never redirects from inside `[[ ]]`, and a redirect OUTSIDE/after `]]` stays outside the span and is still denied; (c) **non-nested** `$(...)` / backtick command substitutions containing a real write (redirection, `tee`, or a write verb) deny — closed by an ADDITIVE pass-4 that scans each non-nested substitution body with the same redirection + write-verb detection (no `[[ ]]` blank) — it can only ADD denials, so no write protection is weakened; substitutions that only READ a protected path still allow. NOT covered (see BRCBW-8): NESTED substitutions. Known fail-closed friction: an escaped/single-quoted literal `$(...)` (e.g. `echo "\$(rm config)"`, `echo '$(rm config)'`) that bash would NOT execute is still scanned textually and over-denies — harmless (denies a safe command), not a bypass. | WI: shell-token parsing | YES | closed (commit on `workflow-brcbw7-test-expr`; tests in `.claude/hooks/tests/block-run-control-bash-write.test.sh`) | ignore `[[ … ]]` contexts |
| BRCBW-8 | Low | Closed (WI-A) — nested/unparseable command-substitution inner writes now deny. pass-4 replaced with INNERMOST-substitution peeling (any depth) + a fail-closed pass-4b backstop: if an UNRESOLVED `$(`/backtick remains after peeling (nesting beyond MAXDEPTH, or a body with a literal paren/backtick the innermost regex cannot classify) AND it references a protected authority file, deny (pass-0 posture). cc-suite chain: audit `audit-mpxebdwd-4vuouz` (2 High under-denials: depth cap + literal-paren body) → fixes → verify `verify-mpxehbp8` (Finding 2 partial: space-only verb regex) → word-boundary fix → verify `verify-mpxelds9` (sed/perl in-place variants) → authority-ref fail-closed backstop → verify `verify-mpxerfok`. Tests `block-run-control-bash-write.test.sh` 103→126, 0 failed; main's 103-case suite passes against the new hook (additive). | WI-A (commit on `workflow-brcbw8-flatten-impl`; spec `dev-memo/plan-brcbw-parser-depth-00.md` §3 Mechanism A) | YES | closed | additive (deny-only); BRCBW-1/2 (var/cd indirection) still WI-B; interpreter-internal writes split to BRCBW-9 |
| BRCBW-9 | Low | Open — interpreter-internal writes to a protected path are not detected, e.g. `awk 'BEGIN{print "x" > "dev-memo/run/config"}'`, `ex -sc 'wq' dev-memo/run/config`, `ruby -e 'File.write "dev-memo/run/config","x"'`, `python -c "open('dev-memo/run/config','w')…"`. The write happens inside the interpreter's OWN language, not via a shell verb/redirection, so the lexical bash guard cannot see it. Surfaced by `verify-mpxerfok` during WI-A. NOT BRCBW-8 and NOT introduced by WI-A: verified ALLOW on `main` AND the new hook, WITH and WITHOUT command substitution (the `$(...)` wrapper is irrelevant) — pre-existing and substitution-independent. Explicitly OUTSIDE the guard's stated threat model ("cooperative agent + direct-write block, NOT cryptographic") and the spec's Mechanism A non-goals ("runtime/semantic, not lexical"). Closing it is an unbounded interpreter allow-list (awk/ex/ed/ruby/python/lua/…) and/or a threat-model change → requires explicit user authorization (security policy). | WI: interpreter-write policy decision (threat-model change; needs user authorization) | YES | open | ESCALATED to user during WI-A; over-deny-all-interpreters-touching-authority is the only lexical option and is high-friction; recommend accept-as-known-gap unless the threat model changes |
| PRC-1 | High | DISPUTED, deferred — auditor wants `log.md` in protect-run-control's deny list; I reject a blanket Write/Edit block (it would break the lifecycle's own append step). Real need is append-only enforcement. | WI: append-only audit-trail enforcement | YES | open | not the auditor's proposed fix; see hook-audit-canary-01.md |
| PRC-2 | High | Deferred (user-authorized) — path-normalization bypass `dev-memo/run/./config`, `//config`, `x/../config` (verified allowed) | WI: path canonicalization (shared w/ BRCBW) | YES | open | canonicalize before matching |
| PRC-3 | High | FIXED — `protect-run-control.sh` now fails CLOSED: an unparseable/missing target path that still references a protected `dev-memo/run/` file is denied (was fail-open `[ -z "$P" ] && exit 0`). A parse failure with no run-control reference still passes (not over-blocking). | — | YES | closed | resolved-in `<pending>`; tests `protect-run-control.test.sh` (14 cases). Note: BRCBW-6 (jq-absent fallback escapes) is a SEPARATE finding, not bundled here. |
| PRC-4 | Medium | Deferred — `deny()` doesn't escape newline/control chars; hostile path with newline emits invalid JSON | WI: deny() JSON hardening | YES | open | use `jq -n --arg` or escape control bytes |
| PRC-5 | Low | Deferred — substring glob `*dev-memo/run/config` also matches `xdev-memo/run/config` (false-positive, not bypass) | WI: path canonicalization | YES | open | exact normalized-path compare |

---

## Tier 1 FileVault enforcement impl (commit `<pending Tier 1 impl commit hash>`)

| Audit job | Verify job |
|---|---|
| `audit-mpkmebjv-65rgwo` | (not run — VERDICT was 0 C/H/M; verify pass only required when fixes apply) |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| AT1-L1 | Low | Out-of-scope-for-this-WI — auditor (`audit-mpkmebjv-65rgwo`) flagged `parseFdesetupStatus` at `apps/lawbar-desktop/src/security/fileVaultProbe.ts:30` as prefix-based, so an input like `FileVault is On: unexpected suffix` would classify as `on`/`off` instead of `unknown`. Auditor explicitly assessed Low because `/usr/bin/fdesetup` output is not attacker-controlled. | future Tier 1 hardening WI when a real-world fdesetup variant motivates anchoring | YES | open | Anchoring (`/^FileVault is On\.?$/i`) would tighten fail-closed intent but is a behavior change for unknown future fdesetup outputs; deferring until evidence of mis-classification appears. |
| AT1-L2 | Low | Cleanup-only / coverage gap — auditor flagged that `tests/main.test.mjs:218` covers the pure `decideAction` matrix but does NOT include an Electron-level smoke that asserts `BrowserWindow` does NOT open after a `block` verdict (e.g. an `electron.launch({env: {LAWBAR_MODE: "production"}})` against a FileVault-off Mac that times out without a window). Code ordering in `electron/main.ts:111` is correct; this is a pin-with-test gap, not a behavior gap. | future Tier 1 hardening WI OR Tier 2 SQLCipher WI (which will need an analogous block-on-missing-key smoke) | YES | open | Cannot be exercised in dev environments with FileVault OFF without an environment flag to FORCE block; would require either fdesetup mocking inside main.ts (additional surface) or a CI-gated test. Reasonable to defer. |
| AT1-L3 | Low | Cleanup-only (doc-only) — auditor flagged `dev-memo/plan-encryption-at-rest-00.md:377` says subprocess error should "proceed with audit log" while §4.1 + the Tier 1 impl treat command failure as `unknown` → block-prod / warn-dev. Impl is stricter than §6.1 text; impl matches §4.1. Plan text is stale, not the code. | future plan-doc cleanup commit OR captured in Tier 2 plan when written | YES | open | Plan section §6.1 row "command failure → proceed with audit log" is the stale line; should read "→ unknown → block-prod / warn-dev (per §4.1)". No impl change needed. |

---

## Phase B11 — SQLite replay-safe Once variants + Phase B FINAL sweep (commit `<pending B11 impl commit hash>`)

**Phase B SQLite implementation declared COMPLETE.** Go-live readiness remains separately gated per `.claude/rules/autonomy.md` §"Hard-stop list".

| Audit job | Verify job |
|---|---|
| `audit-mpi0qhw5-y5xo98` (mini; Path 1 native --background) | not invoked (0 C/H/M; 3 Lows — 1 fixed in-WI, 2 deferred) |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| D2#1 (B11) | Low | Cleanup-only — `SqliteCaseBoxPersistenceTestWrapper` class duplicated between `sqlite.conformance.test.mjs` and `sqlite-final.conformance.test.mjs` (~15 LOC). Reviewer accepted: "optional cleanup; not blocking". | Future shared test-wrapper extraction WI | YES | open | Reviewer: extract only if more SQLite conformance entrypoints appear. |
| D4#1 (B11) | Low | Cleanup-only — `SqliteCaseBoxPersistence.ts` at 610 LOC (was 609 post-B10; +1 net LOC after thin call-through + dead-helper deletion). Carried debt from B7-B10. | Re-evaluate at Phase C if it appears | YES | open | Reviewer: "carried debt rather than B11 regression". |

Lows fixed in-WI:
- L D3#1 (dead `notImplemented()` + `methodSubWiHint()` helpers + stale B1-era comment in `SqliteCaseBoxPersistence.ts`): FIXED — both helpers deleted; top-of-file comment refreshed to reflect "Phase B SQLite implementation complete".

---

## Phase B10 — SQLite read-side aggregations (commit `bb40855`)

| Audit job | Verify job |
|---|---|
| `audit-mphygc7h-vsklaa` (mini; Path 1 native --background) | not invoked (0 C/H/M; 4 Lows — 1 fixed in-WI, 3 deferred) |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| D2#1 (B10) | Low | Cleanup-only — local `loadMatterChecked` helper continues the matter+tenant duplication pattern across sibling RepoQueries files (B7 L D2#1 / B9 D2#1 progression). | Future shared SQLite matter-guard extraction WI | YES | open | Reviewer accepted: "do not refactor this lane to reduce duplication". |
| D2#2 (B10) | Low | Cleanup-only — `getMatterSummarySqlite` uses 8 inline bucket queries; repetitive but clear. UNION ALL deferred until profiling shows latency impact. | Future perf WI if measured | YES | open | v1 lawyer-scale acceptable. |
| D4#1 (B10) | Low | Cleanup-only — `SqliteCaseBoxPersistence.ts` at 609 LOC (was 602 post-B9; +7 LOC for 5 thin call-throughs). Same posture as B7-B9 deferred Lows. | Re-evaluate at B11 if class grows materially | YES | open | `#runImmediateWrite` extraction pattern not applicable here (B10 is read-only). |

---

## Phase B9 — SQLite OCR links (read-only mirror by value) (commit `6289d89`)

| Audit job | Verify job |
|---|---|
| `audit-mphx2ods-qf6qsv` (mini; Path 1 native --background) | not invoked (0 C/H/M; 5 Lows — 2 fixed in-WI, 3 deferred) |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| D2#1 (B9) | Low | Cleanup-only — `loadMatter` / `loadDocumentEntry` helpers duplicate per-file patterns across `ocrLinkRepoQueries.ts` + sibling RepoQueries files. Reviewer accepted: "consistent with sibling pattern; defer until naturally touched". | Future shared SQLite read-helper extraction WI | YES | open | Reviewer recommendation: do not block B9. |
| D4#1 (B9) | Low | Cleanup-only — `SqliteCaseBoxPersistence.ts` at 602 LOC (was 596 post-B8; +6 LOC for 3 thin call-throughs). Same posture as B7 D4#2 / B8 D4#1. | Re-evaluate at B10/B11 if class grows materially | YES | open | `#runImmediateWrite` pattern keeps growth flat per added method. |
| D4#2 (B9) | Low | Cleanup-only — `schema.ts` at 547 LOC (was 500 post-B8; over warn by ~47 LOC after DDL_V8). | Next schema-bearing WI (B10/B11) should extract DDL by version. | YES | open | Reviewer recommendation: defer DDL extraction; not B9 blocker. |

---

## Phase B8 — SQLite evidence items (commit `bfda127`)

| Audit job | Verify job |
|---|---|
| `audit-mphtd7pt-ajcyux` (mini; Path 1 native --background) | not invoked (0 C/H, 1 M + 1 L; M fixed in-WI, 1 L deferred) |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| D4#1 (B8) | Low | Cleanup-only — `SqliteCaseBoxPersistence.ts` at 596 LOC (was 588 post-B7; +8 LOC for 4 thin call-throughs). Same posture as B7 D4#2. | Re-evaluate at B9/B10 if class grows materially | YES | open | `#runImmediateWrite` pattern keeps growth flat per added method. |
| D4#2 (B8) | Low | Cleanup-only — `schema.ts` at 500 LOC (exactly at warn boundary; +42 from B7 v7 DDL). Future B9-B11 schema additions will push it over. | Re-evaluate at next schema-bearing WI (B9 or B11) | YES | open | Acceptable at boundary; flag for next schema-bearing WI to consider DDL split (e.g., one constant per phase). |
| D2#1 (B8) | Low | Cleanup-only — `package.json` `--test-name-pattern` regex duplicates `sqlite.conformance.test.mjs` B8_PATTERN. Drifted before during B6→B7 renaming. | Future shared-pattern-source refactor (B11 cleanup or dedicated WI) | YES | open | Preflight inventory enforcement reduces but does not eliminate the drift risk. |

---

## Phase B7 — SQLite docket entries + deadline materialization (commit `69db974`)

| Audit job | Verify job |
|---|---|
| `audit-mphm1ece-aki58h` (mini; Path 1 native --background) | not invoked (0 C/H, 1 M + 4 L; M + 3 Lows fixed in-WI, 1 Low deferred at the time; D4#1 now CLOSED by B8) |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| D4#1 (B7) | Low | `sqlite.hardening.test.mjs` at 882 LOC over 700 warn. Per B7 plan §6 risk #6: B8 split if crossed. | WI-B8-pre-impl split into per-entity hardening test files | YES | closed | Resolved in B8 (commit `<pending B8 impl commit hash>`): 882-LOC monolith split into 1 shared module + 8 per-phase files (hardening-{pragma, schema, audit, classification, privilege, facts, docket, evidence}.test.mjs). 40 pre-split test names preserved verbatim post-split (verified via grep inventory diff). |
| D4#2 (B7) | Low | `SqliteCaseBoxPersistence.ts` at 588 LOC over warn (was 572 post-B6). Same posture as B5/B6 D4#1; reviewer accepted under 800 fail. | Re-evaluate at B8/B9 if class grows materially | YES | open | B8 adds +8 LOC (596 LOC); see B8 D4#1 entry above. Same band. |

---

## Phase B6 — SQLite facts (commit `667bb9c`)

| Audit job | Verify job |
|---|---|
| `audit-mph4cun6-aav6q2` (mini; Path 1 native --background) | not invoked (no C/H/M to verify; 0 C/H/M, 4 Lows; 2 Lows fixed in-WI, 2 Lows deferred at the time; D4#1 now CLOSED by B7) |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| D4#1 (B6) | Low | `impl-parity.test.mjs` at 773 LOC over 700 warn. Per B6 plan §"Review packet" Q7 + Risk #6: B7 MANDATORY split when crossed. | WI-B7-pre-impl split into `impl-parity-{matter,document,audit,classification,privilege,facts,docket,stub-frontier}.test.mjs` | YES | closed | Resolved in B7 (commit `<pending B7 impl commit hash>`): 773-LOC monolith split into 7 per-entity test files + 1 shared common module; each well under warn threshold. |
| D4#2 (B6) | Low | `SqliteCaseBoxPersistence.ts` over warn (572 LOC; B6 added +9 LOC for 4 thin call-throughs). Same posture as B5 D4#1. | Re-evaluate at B7/B8 if class grows materially | YES | open | B7 adds +16 LOC (588 LOC); see B7 D4#2 entry above. Same band. |

---

## Phase B5 — SQLite privilege markers (commit `<pending B5 impl commit hash>`)

| Audit job | Verify job |
|---|---|
| `audit-mpgzx0ka-r4jne5` | not invoked (no C/H/M to verify; 0 C/H/M, 5 Lows; 1 Low fixed in-WI, 4 Lows deferred) |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| D1#2 | Low | Cleanup-only — `getPrivilegeStatusSqlite` loads ALL matter markers then lets `effectivePrivilegeStatus` filter; could narrow at SQL level via `WHERE matter_id, target_type, target_id`. Acceptable at v1 lawyer-scale. | Future perf WI when marker volume grows | YES | open | Reviewer accepted as Phase-B debt. |
| D2#1 | Low | Cleanup-only — `buildShadowAppendState` and `buildShadowTransitionState` in `privilegeRepoQueries.ts` duplicate the global id+markerIndex SELECT loop. Two callers today; extract if a third privilege helper appears. | Future privilege-side extraction OR B-future-WI | YES | open | Reviewer accepted: "extract `loadPrivilegeIdIndex(db, state)` if a third privilege helper appears." |
| D4#1 | Low | Cleanup-only — `SqliteCaseBoxPersistence.ts` at 563 LOC over the 500-LOC LOC-01 extraction trigger (under 800 fail). B4 D4#1 was naturally fixed structurally via `#runImmediateWrite` + `#writeAudit` + `validateDocumentTarget` extractions; residual LOC is mostly imports + 33 `not_implemented` stubs. Reviewer: "Do not introduce a stub mixin yet; it would add indirection without reducing real complexity." | Re-evaluate at B6/B7 if growth continues | YES | open | Treated as accepted-as-known-divergence under 800 fail floor. |
| D4#2 | Low | Cleanup-only — global privilege id scans (and the analogous global classification id scans from B4) will not scale as a long-term pattern. v1 acceptable. | Future targeted-existence-lookup WI once multiple SQLite entity helpers repeat this pattern | YES | open | Reviewer: "Backlog a targeted existence/indexed lookup refactor once multiple SQLite entity helpers repeat this pattern." |

---

## Phase B4 — SQLite confidentiality classification (commit `bb285ca`)

| Audit job | Verify job |
|---|---|
| `audit-mpgyzp9t-iftt4p` | not invoked (no C/H/M to verify; 0 C/H/M, 4 Lows; 2 Lows fixed in-WI, 2 Lows deferred at the time; both now CLOSED by B5) |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| D4#1 | Low | LOC trigger 524 > 500 in SqliteCaseBoxPersistence.ts; transaction-wrapper extraction. | WI-B5-impl OR dedicated extraction WI before B5 | YES | closed | Resolved in B5 (commit `<pending B5 impl commit hash>`) — extracted `#runImmediateWrite` + `#writeAudit` private helpers per NIGHT-RUN-SQLITE-B5-IMPL lane "fix cleanly when naturally touched" instruction. Class still 563 LOC (mostly stubs + imports); structural duplication eliminated. |
| D2#1 | Low | `getEffectiveClassificationSqlite` re-implements in-memory `getEffectiveClassificationHelper` validation (matter / tenant / target_type / document resolution). | WI-B5-impl OR future docs-only extraction WI | YES | closed | Resolved in B5 (commit `<pending B5 impl commit hash>`) — extracted shared `validateDocumentTarget(db, query)` helper in `documentRepoQueries.ts`; both B4 `getEffectiveClassificationSqlite` and B5 `getPrivilegeStatusSqlite` now call it. |

---

## Phase A6 — evidence items (commit `<pending A6 commit hash>`)

| Audit job | Verify job |
|---|---|
| `audit-mpfm9yx3-u37dx3` | `verify-mpfmi1u1-m2rzhh` |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| F5.1 | Low | Cleanup-only — defensive cross-tenant supersession branch is unreachable through the public API (matter-tenant binding enforces; same-matter cross-tenant evidence would require direct state tampering). Plan's §6.A6.16b test was never added; helper's defensive code retained for forward compatibility. Audit accepted the deferral. | cleanup-accepted (no follow-up planned; revisit only if a future WI introduces a path that allows same-matter cross-tenant rows) | YES | open | Defense-in-depth witness. No test fixture available without a tamper seam. |

---

## Phase A5 — docket entries + deadline materialization (commit `<pending A5 commit hash>`)

| Audit job | Verify job |
|---|---|
| `audit-mpfktk5e-pac8by` | `verify-mpfl8uz3-ajvcvj` |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| _no deferred findings_ | — | All findings (1 Low stale-imports) fixed inline rather than deferred. | n/a | YES | n/a | Verify verdict ALL CLOSED. |

Backlog relabel (NOT a closure): A2 F4.3's `Target` field updated from "future A5-fact-targets WI" to "future fact-target broadening WI" — A5 is dockets/deadlines, not fact-targets; the original label was a misnomer.

---

## Phase A4 — facts (commit `<pending A4 commit hash>`)

| Audit job | Verify job |
|---|---|
| `audit-mpfi97ns-kf42ma` | `verify-mpfijdi4-6cdzoi` |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| _no deferred findings_ | — | All Medium/High closed; no Lows deferred (one Low — `PrepareTransitionResult.prior` dead surface — was fixed inline rather than deferred). | n/a | YES | n/a | Verify verdict ALL CLOSED. The audit re-verified the round-1 reconciliation; no residual issues. |

---

## Phase A3 — privilege markers (commit `b2ef9f1`)

| Audit job | Verify job |
|---|---|
| `audit-mpfgref5-1drdsi` | `verify-mpfgxs2h-xxgvzi` |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| F2.1 | Low | Cleanup-only — local interfaces in `inMemoryPrivilege` duplicate the public types in `types.ts`. No behavior or invariant impact. Audit accepted deferral. | Phase A4 (broader sibling-module refactor when fact entities land) | YES | closed | Closed in Phase A4 (commit `<pending A4>`). `ListPrivilegeMarkersQuery` and `ListPrivilegeMarkersPage` were removed from `inMemoryPrivilege.ts` and imported from `types.ts` instead; same refactor applied to `inMemoryClassification.ts` for the parallel `ListClassifications*` types. |
| F2.2 | Low | Out-of-scope — tenant/matter/document consistency path overlaps with `inMemoryClassification`. Resurfaces in A4 when facts add a third sibling. Audit accepted deferral. | Phase A4 (extract `resolveDocumentTarget` helper) | YES | closed | Closed in Phase A4 (commit `<pending A4>`). New shared helper `src/resolveTarget.ts` consumed by `inMemoryClassification`, `inMemoryPrivilege`, and `inMemoryFact`. Preserves the exact error-code semantics (unknown_document / tenant_mismatch / matter_id_mismatch). |
| F4.2 | Low | Cleanup-only — defensive markerIndex behavior is acceptable (no delete API exists; an index miss throws before mutation). Audit verdict: "no code change required". | cleanup-accepted (no follow-up planned) | YES | open | Defense-in-depth defensive path. Resurfaces only if A3+ introduces a marker-delete API; reopen this row at that time. |
| F5.2 | Low | Audit verdict was CLEAN — no tenant/matter leak found in `getPrivilegeStatus`. Recorded as "deferred" only in the sense that it stayed an inspected-and-accepted item; no fix required. | cleanup-accepted (no follow-up planned) | YES | open | Persistent-cleanliness witness. Keep an eye on it during A4 when `target_type === "fact"` opens up. |
| F5.3 | Low | Audit verdict was CLEAN — no disclosure-safety inference from `hasProtectiveAssertion` in any persistence path. Recorded as "deferred" only in the same sense as F5.2. | cleanup-accepted (no follow-up planned) | YES | open | Anti-disclosure-clearance invariant witness. Defended by invariants test §6.2.A3.2; that test must not be deleted or weakened without an ADR. |

---

## Phase A2 — confidentiality classification (commit `f7f4bf5`)

| Audit job | Verify job |
|---|---|
| `audit-mpfcyd9a-l60m5r` | `verify-mpfd4e2y-6hzr6w` |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| F2.2 | Low | Out-of-scope — tenant/matter/document consistency check pattern repeated across append and get-effective paths. Small now; would grow with facts. Audit accepted deferral. | Phase A4 (extract `resolveDocumentTarget` helper) | YES | closed | Closed in Phase A4 (commit `<pending A4>`) alongside A3 F2.2 — shared `resolveDocumentTarget` helper now consumed by `inMemoryClassification`. |
| F3.1 | Low | Cleanup-only — `unknown_document` code retained for forward compatibility per the documented 10-code set; not emitted by A2 methods. | cleanup-accepted (no follow-up planned) | YES | open | A3 introduced paths that DO emit `unknown_document` (appendPrivilegeMarker, getPrivilegeStatus). Mark for **review on A4 close**: if at least one A3 conformance case exercises every documented code, this row can flip to `closed`. |
| F3.2 | Low | Cleanup-only — invariants test §6.2.6 SAMPLES error codes rather than exhaustively triggering each. Acceptable per audit. | cleanup-accepted (no follow-up planned) | YES | open | Same paired observation as F3.1 — if A3+ tests reach full code coverage, the §6.2.6 sampled comment can be rephrased to "comprehensive" without code changes. |
| F4.2 | Low | Cleanup-only — whitespace-only reasons accepted by `appendConfidentialityClassification` for codes other than `"other"`. Audit accepted. | cleanup-accepted (no follow-up planned) | YES | open | Persistence DOES reject whitespace for `change_reason_code === "other"` (added during A2 audit-fix). Other reason codes are enum-bound so the whitespace concern is bounded. |
| F4.3 | Low | Out-of-scope — `listConfidentialityClassifications` returns empty for never-classified documents while `getEffectiveClassification` returns `unclassified`. Distinction is intended; only conformance pinning was missing. | future fact-target broadening WI (relabeled by A5 — A5 is dockets/deadlines, NOT fact-targets; the original "A5-fact-targets" label set by A4 was a misnomer) | YES | open | Pure test gap; behavior is correct. Target field relabeled by Phase A5 (commit `<pending A5>`); row remains open. |

---

## Phase A1 — case-box persistence in-memory base (commit `5de5530`)

| Audit job | Verify job |
|---|---|
| `audit-mpf8prhx-qenxkd` | `verify-mpf974sx-sn3hum` |

| Finding ID | Severity | Reason for deferral | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| F2.1 | Low | Cleanup-only — audit-event construction sequencing duplicated across matter create / document register / matter transition paths. Small; refactor would not change behavior. | future bounded refactor WI when a 4th audit-emitting path lands | YES | open | A2 + A3 added more audit-emitting paths (classification, privilege). The duplication factor is now ~5; consider opening a refactor WI once A4 (facts) lands. |
| F3.1 | Low | Cleanup-only — `unknown_document` retained for forward compatibility (see A2 F3.1). | (paired with A2 F3.1) | YES | superseded by A3 | A3's `appendPrivilegeMarker` and `getPrivilegeStatus` exercise this code. Closing under that justification — see `b2ef9f1` conformance §6.A3.10, §6.A3.24. |
| F3.2 | Low | Cleanup-only — test exhaustiveness for §6.2.6 (see A2 F3.2). | (paired with A2 F3.2) | YES | open | Cross-WI test coverage may have grown enough; revisit comment after A4. |
| F4.2 | Low | Cleanup-only — whitespace-only `reason` accepted by `archiveMatter` / `unarchiveMatter`. Audit accepted. | cleanup-accepted (no follow-up planned) | YES | open | Same pattern as A2 F4.2; matter-transition reasons are free-text by design. |

---

## Legend for future entries

When closing an entry, leave the row in place and update `Status` + append to `Notes` like:

```
| ... | closed | Resolved in WI-XX (commit abc1234) — extracted `resolveDocumentTarget`; conformance case 6.A4.N covers. |
```

When a finding becomes irrelevant (e.g. the affected code was removed by another WI), mark `superseded` and cite the commit that removed the underlying surface.

When several rows close together (e.g. A2 F2.2 + A3 F2.1 + A3 F2.2 all close under one A4 refactor), keep them as separate rows so the grep for any one of them still surfaces the close.

## Case-box list channels — persistence tenant-filter gap (facts WI, audit `audit-mpxoq4ma-dn3m0h`)

Surfaced during the read-only facts WI (UI+IPC). The findings are NOT in that WI's scope
(`services/**` SQL) and are pre-existing; the WI's IPC/UI layer audited clean. Recorded here
for a dedicated persistence-hardening WI.

| Finding ID | Severity | Reason for deferral / disposition | Target | Safe? | Status | Notes |
|---|---|---|---|---|---|---|
| FACTS-AUD-1 | Medium | ESCALATED (out of UI-WI scope; pre-existing; v1-single-tenant-moot) — `listFactsSqlite` (`services/case-box-persistence/src/sqlite/factsRepoQueries.ts:124`) and `listDeadlines` (`deadlineRepoQueries.ts:86`) filter `WHERE matter_id = ?` only, NOT `tenant_id`. The IPC handlers verify the MATTER's tenant + inject `tenant_id` into the query, but the SQL ignores it, so a fact/deadline row whose own `tenant_id` differs from its matter's (a data-integrity violation, impossible in single-tenant v1) would be returned. `listDocuments` already tenant-filters (`documentRepoQueries.ts:117`) — the fix is to make facts + deadlines match. Touching `services/**` SQL is a security-boundary/persistence change requiring the full review-plan→tests→audit→verify loop. | WI: persistence list tenant-filter hardening (facts + deadlines list SQL; align with documents) | YES (v1 single-tenant) | open | NOT introduced by the facts WI; affects the already-merged deadline list channel (PR #32) too |
| FACTS-AUD-2 | Low | Accepted-as-intentional (consistent + prior-CLEAN) — `listFactsHandler` returns `unknown_matter` for a missing matter vs `tenant_mismatch` for a wrong-tenant matter, a cross-tenant matter-existence oracle. This is the SAME pattern used by every handler (matter/audit/document/deadline), audited CLEAN in each prior WI, and the distinct boundary error codes are a deliberate stable contract per `.claude/rules/security-boundary.md` (do not collapse codes). Single-tenant-moot in v1. | cleanup-accepted (no follow-up planned; revisit if multi-tenant ships) | YES | open | revisiting requires an ADR if the error-code contract is to change |
