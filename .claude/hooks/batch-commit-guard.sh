#!/bin/bash
# batch-commit-guard.sh — PreToolUse(Bash) hook on `git commit*`.
# Enforces the autonomous-batch boundary mechanically (not by instruction). Fails SAFE.
#
# Gated mode (AUTO_ADVANCE_MAX<=1): every commit requires a single-use dev-memo/run/human.ack.
# Batch mode (AUTO_ADVANCE_MAX>1): denies the commit unless the queue is GOVERNED, no risk
#   flag is pending, a batch audit is not due, and the git-derived auto-commit count is under
#   the breaker. Two human-authorized escapes exist, both single-use and logged:
#     - human.override + reason file — general-purpose break glass; bypasses risk/governed/count.
#     - remediation.authorized — the NARROW remediation lane (WI-BATCH-REMEDIATION-LANE-00):
#       bypasses ONLY the audit-DUE deny, only after a FAILED broker audit over the current
#       window is verified, and only for a commit whose staged set is inside the artifact's
#       declared allowed paths. It never advances the marker. See §"REMEDIATION LANE" below.
# Authority: this hook is the enforcement truth for the commit boundary (see README Authority
#   map). It does NOT own staging/secrets checks — those are the other two commit hooks.

INPUT=$(cat)
if command -v jq >/dev/null 2>&1; then
  CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  CMD=$(printf '%s' "$INPUT" | tr -d '\n' | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -1 | sed -E 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')
fi

# deny <reason>: emit the PreToolUse deny decision as VALID JSON (PRC-4-FU; mirrors
# protect-run-control.sh deny()). Escaping only `\` and `"` (the old behaviour) left ASCII C0
# control bytes (newline/tab/CR, 0x00-0x1F) UNescaped, which is invalid JSON (RFC 8259 §7) and
# could make the harness fail to register the deny (fail-open). jq -Rs encodes the whole reason as
# a JSON string literal (quotes + all escaping incl C0 + UTF-8). If jq is unavailable OR errors
# (e.g. invalid UTF-8), fall back to stripping C0 controls to spaces + escaping `\`/`"` — still
# valid JSON (non-UTF-8 bytes in that degraded path are a documented residual).
deny() {
  local reason=$1 enc
  if command -v jq >/dev/null 2>&1 && enc=$(printf '%s' "$reason" | jq -Rs . 2>/dev/null) && [ -n "$enc" ]; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' "$enc"
  else
    enc=$(printf '%s' "$reason" | tr '\000-\037' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$enc"
  fi
  exit 0
}

# Portable sha256 of a file's bytes -> 64 lowercase hex, or empty string on any failure.
# Resolution order matches scripts/workflow/govern-queue.sh's writer so the digests are comparable.
# Used by the BCG-6 governance-content-binding check below.
guard_sha256() {
  local f=$1 h=""
  if command -v shasum >/dev/null 2>&1; then
    h=$(shasum -a 256 "$f" 2>/dev/null | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then
    h=$(sha256sum "$f" 2>/dev/null | awk '{print $1}')
  elif command -v openssl >/dev/null 2>&1; then
    h=$(openssl dgst -sha256 "$f" 2>/dev/null | awk '{print $NF}')
  fi
  printf '%s' "$h"
}

# Portable sha256 of STDIN's bytes -> 64 lowercase hex, or empty on failure. Same resolution order
# as guard_sha256. Used by the remediation lane to hash a broker job's rawOutput WITHOUT routing it
# through a shell variable (command substitution strips trailing newlines and drops NUL bytes, which
# would change the digest and break the binding to batch-closeout.mjs's sha256(rawOutput)).
guard_sha256_stdin() {
  local h=""
  if command -v shasum >/dev/null 2>&1; then
    h=$(shasum -a 256 2>/dev/null | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then
    h=$(sha256sum 2>/dev/null | awk '{print $1}')
  elif command -v openssl >/dev/null 2>&1; then
    h=$(openssl dgst -sha256 2>/dev/null | awk '{print $NF}')
  else
    cat >/dev/null 2>&1
  fi
  printf '%s' "$h"
}

# Only act on git commit. If we can't read the command but it smells like a git commit, fail safe.
if [ -z "$CMD" ]; then
  if printf '%s' "$INPUT" | grep -qE 'git' && printf '%s' "$INPUT" | grep -qE 'commit'; then
    deny "Batch guard: could not parse the git commit to verify batch limits; denying as a precaution."
  fi
  exit 0
fi

# Count git-commit invocations robustly (closes bypasses in audit job audit-mpuesqmt-4zzpxr):
#   - absolute/relative path command word:  /usr/bin/git commit ,  ./git commit
#   - git global options before the subcommand:  git -c k=v commit ,  git --no-pager commit
#   - leading environment assignments:  FOO=bar git commit
#   - MULTIPLE commits in one Bash call (one PreToolUse decision must not authorize several)
# Statement-aware: the COMMAND WORD of each ;/&&/||/|/&-separated statement must itself be git
# (optionally path-prefixed), so `echo "git commit"` and `git config commit.x` are NOT counted.
# Out of scope (deferred to a later WI): command-substitution / variable-indirected forms
# such as `git $(echo commit)` or `c=commit; git $c` — see dev-memo/deferred-audit-findings.md.
count_git_commits() {
  # BCG-9: QUOTE-AWARE statement splitting. The split below treats ;  &&  ||  |  & as statement
  # separators, but those characters are ALSO ordinary text inside a quoted `-m` commit message.
  # A blind global split mis-counted `git commit -m "revert; git commit"` as TWO commits (the
  # in-message `git commit` became a second statement) and over-DENIED a legitimate single commit.
  # The neutralize pass below walks each line with a 3-state quote machine (unquoted / single /
  # double, honoring backslash escapes OUTSIDE single quotes per POSIX) and replaces any
  # ;  |  & that occurs INSIDE a quoted span with `_`, so the subsequent split only breaks on
  # OUT-OF-QUOTE separators. If a line's quotes are UNBALANCED (state != unquoted at EOL) the pass
  # falls back to the ORIGINAL line, preserving the old over-deny behavior — it must never turn a
  # genuine multi-command shell into a single counted statement (over-deny is safe; under-count is
  # a security regression). This is bounded quote handling, NOT a full shell parser; a separator
  # inside a quoted message that SPANS multiple physical lines is out of scope (per-line, like the
  # split itself) and falls back to over-deny.
  printf '%s\n' "$1" \
    | awk '{
        s=$0; out=""; st=0   # st: 0=unquoted 1=single 2=double
        for (i=1;i<=length(s);i++) {
          c=substr(s,i,1)
          if (st==0) {
            if (c=="\\") { out=out c; if(i<length(s)){i++; out=out substr(s,i,1)} continue }
            if (c=="'\''") { st=1; out=out c; continue }
            if (c=="\"") { st=2; out=out c; continue }
            out=out c
          } else if (st==1) {                 # single quotes: literal, only '\'' closes (no escapes)
            if (c=="'\''") { st=0; out=out c; continue }
            if (c==";"||c=="|"||c=="&") { out=out "_"; continue }
            out=out c
          } else {                            # double quotes: backslash escapes next char
            if (c=="\\") { out=out c; if(i<length(s)){i++; out=out substr(s,i,1)} continue }
            if (c=="\"") { st=0; out=out c; continue }
            if (c==";"||c=="|"||c=="&") { out=out "_"; continue }
            out=out c
          }
        }
        if (st!=0) print s; else print out    # unbalanced -> fall back to original (over-deny)
      }' \
    | awk '{gsub(/&&|\|\||[;|&]/, "\n"); print}' \
    | while IFS= read -r stmt; do
        set -f; set -- $stmt; set +f
        # Unwrap leading VAR=value assignments and benign command-prefix wrappers
        # (env / command / exec / time / nice / nohup / stdbuf / setsid) plus a backslash-escaped
        # `\git`, to reach the real command word. Only no-arg wrapper flags + assignments are
        # skipped; exotic arg-taking wrapper forms (env -u NAME, exec -a NAME) remain a recorded
        # gap (dev-memo/deferred-audit-findings.md). This is bounded unwrapping, NOT a shell parser.
        while [ $# -gt 0 ]; do
          w=$1; w=${w#\"}; w=${w#\'}; w=${w#\\}      # strip one quote / backslash-escape
          case "$w" in
            [A-Za-z_]*=*) shift ;;                    # VAR=value assignment
            command|exec|time|env|nice|nohup|stdbuf|setsid)
              shift                                   # drop wrapper, then its flags + assignments
              while [ $# -gt 0 ]; do
                case "$1" in -*) shift ;; [A-Za-z_]*=*) shift ;; *) break ;; esac
              done ;;
            *) break ;;                               # real command word reached
          esac
        done
        [ $# -gt 0 ] || continue
        cmd0=$1; cmd0=${cmd0#\"}; cmd0=${cmd0#\'}; cmd0=${cmd0#\\}   # strip quote / backslash-escape
        case "$cmd0" in git|*/git) ;; *) continue ;; esac
        shift
        sub=""
        while [ $# -gt 0 ]; do                        # walk git global options to the subcommand
          case "$1" in
            -C|-c|--git-dir|--work-tree|--namespace|--super-prefix|--exec-path)
              shift; [ $# -gt 0 ] && shift ;;         # these take a separate argument
            -*) shift ;;                              # other global flags / --opt=val forms
            *) sub=$1; break ;;
          esac
        done
        [ "$sub" = "commit" ] && echo X
      done | grep -c X
}
NCOMMIT=$(count_git_commits "$CMD")
[ "${NCOMMIT:-0}" -eq 0 ] && exit 0
[ "${NCOMMIT:-0}" -ge 2 ] && deny "Batch guard: $NCOMMIT git-commit invocations in one command — a single PreToolUse decision cannot authorize multiple commits. Issue one 'git commit' per command so each is gated."

RUN="${CLAUDE_PROJECT_DIR}/dev-memo/run"

# Read config FIRST — authorization rules depend on mode. Missing/unreadable = fail safe.
[ -r "$RUN/config" ] || deny "Batch guard: dev-memo/run/config unreadable; cannot verify batch limits. Restore run state or use a gated-mode human.ack."
# BCG-7 hardening: read the RAW value (full RHS, trailing inline #comment + surrounding whitespace
# normalized) and validate STRICTLY so a malformed / out-of-set / huge-digit value FAILS CLOSED (deny)
# instead of being captured and then crashing a later bash integer compare ([ COUNT -ge EVERY/MAX ]),
# which returned non-true and SILENTLY SKIPPED the breaker (fail-OPEN). AUTO_ADVANCE_MAX must be one of
# the documented modes {1,3,10}; BATCH_AUDIT_EVERY, WHEN PRESENT, must be a bare integer in [1,100].
# Strip ONLY a whitespace-separated trailing inline comment (`value  # note`), then trim trailing
# whitespace. A `#` with NO preceding whitespace is NOT a comment (shell assignment semantics treat
# `VAR=3#x` as the literal `3#x`), so e.g. `BATCH_AUDIT_EVERY=3#junk` survives as `3#junk` and fails the
# bare-integer check below (fail-closed) rather than being silently normalized to `3` (audit Low).
cfgval(){ sed -n "s/^$1=//p" "$RUN/config" | head -1 | sed 's/[[:space:]][[:space:]]*#.*$//; s/[[:space:]]*$//'; }
RAWMAX=$(cfgval AUTO_ADVANCE_MAX)
RAWEVERY=$(cfgval BATCH_AUDIT_EVERY)
[ -n "$RAWMAX" ] || deny "Batch guard: AUTO_ADVANCE_MAX not set in config; denying."
case "$RAWMAX" in
  1|3|10) MAX=$RAWMAX ;;
  *) deny "Batch guard: AUTO_ADVANCE_MAX='$RAWMAX' is not one of the allowed modes {1,3,10}; refusing to evaluate batch limits on a malformed config (fail-closed)." ;;
esac
if [ -n "$RAWEVERY" ]; then
  # Reject any non-digit first; then bound the digit LENGTH (<=3, since 100 has 3 digits) BEFORE any
  # arithmetic/compare so a huge-digit value cannot overflow/crash the integer compare (the BCG-7 bug).
  case "$RAWEVERY" in
    *[!0-9]*) deny "Batch guard: BATCH_AUDIT_EVERY='$RAWEVERY' is not a bare positive integer; fail-closed." ;;
  esac
  if [ "${#RAWEVERY}" -gt 3 ] || [ "$((10#$RAWEVERY))" -lt 1 ] || [ "$((10#$RAWEVERY))" -gt 100 ]; then
    deny "Batch guard: BATCH_AUDIT_EVERY='$RAWEVERY' is outside the allowed range [1,100]; fail-closed."
  fi
  EVERY=$((10#$RAWEVERY))
else
  EVERY=$MAX   # documented fallback: an unset/empty BATCH_AUDIT_EVERY defaults to the (validated) MAX
fi

# --- Gated mode (MAX<=1): every commit needs a single-use human.ack. Nothing else applies. ---
if [ "$MAX" -le 1 ]; then
  # BCG-4: consume-on-success. Authorize ONLY if the single-use ack was actually removed; if removal
  # fails (read-only dir / permission), the token PERSISTS, so allowing would make it reusable — deny.
  if [ -f "$RUN/human.ack" ]; then
    if rm -f "$RUN/human.ack" 2>/dev/null && [ ! -e "$RUN/human.ack" ]; then exit 0; fi
    deny "Batch guard: gated-mode dev-memo/run/human.ack could not be consumed (removal failed); refusing to authorize on a token that still exists (fail-closed)."
  fi
  deny "Batch guard: gated mode (AUTO_ADVANCE_MAX=$MAX) requires a single-use dev-memo/run/human.ack for every commit."
fi

# --- REMEDIATION LANE (WI-BATCH-REMEDIATION-LANE-00) ------------------------------------------
# Problem it solves: BATCH-AUDIT.md requires a FAILED batch audit's finding to be RESOLVED, and
# batch-closeout.mjs refuses to carry a Critical/High/Medium — so fix-and-re-audit is the only
# path for a Medium+ and that path needs a commit. But the audit-DUE deny below blocks EVERY
# commit, including the one that resolves the finding. Twice this deadlock was broken with a
# single-use human.override, which spends a general-purpose break-glass on routine remediation.
#
# The lane permits exactly ONE narrow class of commit — a path-scoped remediation commit —
# authorized by dev-memo/run/remediation.authorized, an artifact the agent cannot create
# (protect-run-control.sh + runcontrol-canon.mjs + block-run-control-bash-write.sh cover it
# exactly like human.override). It is strictly NARROWER than an override: an override permits ANY
# commit and bypasses risk/governed/count; this lane bypasses ONLY the audit-DUE deny, and only
# for a commit whose staged set is a subset of the artifact's declared allowed paths, bound to a
# specific FAILED broker audit job over the current window.
#
# Verified, fail-closed on any doubt (each check DENIES; the token is spent only after ALL pass):
#   R1 artifact present, readable, non-empty, strictly well-formed (known keys, no duplicates)
#   R2 range_base == the CURRENT marker (dev-memo/run/last-batch-audit) AND == the derived BASE
#      (so a stale FAIL from an older window cannot authorize work in the live window)
#   R3 audit_head is a real commit, range_base is its ancestor, and it is an ancestor of HEAD
#   R4 the named broker job's rawOutput hashes to broker_output_sha256 AND declares, on their own
#      lines, `AUDIT-RANGE: <range_base>..<audit_head>` and `AUDIT-VERDICT: BATCH-FAIL …`
#      (this is what makes the lane apply ONLY to a FAILED audit — a merely-DUE audit has no such
#      job, and a BATCH-PASS job is rejected)
#   R5 the commit form cannot smuggle content past the index (no -a/--all, -p, -i, -o, --amend,
#      --pathspec-from-file, `--`, pathspec operands, chaining, redirection, substitution)
#   R6 the staged set is non-empty and every staged path is inside allowed_path
#   R7 single-use: consumed (removed) and logged atomically, exactly like human.override
# The marker is NEVER written here — a remediation commit does not advance it, so commits stay
# blocked until a follow-up Layer-B audit over range_base..<new head> PASSes and the closeout runs.
REMFILE="$RUN/remediation.authorized"

rem_deny() {
  deny "Batch guard: remediation lane REFUSED — $1. The remediation lane (dev-memo/run/remediation.authorized) authorizes exactly one path-scoped commit that resolves a FAILED batch audit; it is not a general override. Fix the artifact (a human must re-create it) or run the batch audit. Fail-closed."
}

# rem_path_allowed <staged-path> — true iff the path is covered by REM_PATHS (newline-separated).
# An allowed_path ending in '/' is a directory prefix; anything else is an EXACT file match.
# Patterns are quoted so glob metacharacters in an allowed_path are literal, never wildcards.
rem_path_allowed() {
  local sp=$1 ap
  while IFS= read -r ap; do
    [ -n "$ap" ] || continue
    case "$ap" in
      */) case "$sp" in "$ap"*) return 0 ;; esac ;;
      *)  [ "$sp" = "$ap" ] && return 0 ;;
    esac
  done <<REM_PATHS_EOF
$REM_PATHS
REM_PATHS_EOF
  return 1
}

# rem_tokenize <command> — quote-aware tokenizer for the remediation commit-form check.
# Emits one shell WORD per line with quotes removed, and the sentinel __REM_META__ if the command
# contains anything the lane refuses to reason about OUTSIDE single quotes: a statement separator
# (; | &), a redirection (< >), a subshell/substitution (( ) ` $), or unbalanced quotes. Those
# constructs can change WHAT is committed (or hide a second command) and this lane must not guess.
# Over-denial here is friction on a break-glass path, never a bypass.
rem_tokenize() {
  printf '%s\n' "$1" | awk '
    BEGIN { meta=0 }
    {
      s=$0; st=0; tok=""; have=0
      for (i=1;i<=length(s);i++) {
        c=substr(s,i,1)
        if (st==0) {
          if (c=="\\") { if(i<length(s)){i++; tok=tok substr(s,i,1); have=1} continue }
          if (c=="'\''") { st=1; have=1; continue }
          if (c=="\"") { st=2; have=1; continue }
          if (c==" "||c=="\t") { if(have){print tok; tok=""; have=0} continue }
          if (c==";"||c=="|"||c=="&"||c==">"||c=="<"||c=="("||c==")"||c=="`"||c=="$") { meta=1; continue }
          tok=tok c; have=1
        } else if (st==1) {            # single quotes: fully literal, only '\'' closes
          if (c=="'\''") { st=0; continue }
          tok=tok c; have=1
        } else {                       # double quotes: expansion is possible -> $ and ` are meta
          if (c=="\\") { if(i<length(s)){i++; tok=tok substr(s,i,1); have=1} continue }
          if (c=="\"") { st=0; continue }
          if (c=="`"||c=="$") { meta=1; continue }
          tok=tok c; have=1
        }
      }
      if (have) print tok
      if (st!=0) meta=1                # unbalanced quotes -> cannot tokenize safely
    }
    END { if (meta) print "__REM_META__" }'
}

# rem_commit_form_ok — verify the git-commit invocation commits EXACTLY the index, so the
# staged-set subset check below is the real content check and not a formality. Denies internally.
# Allow-list, not deny-list: any option not known to be index-neutral is refused.
#   forbidden by construction: -a/--all, -p/--patch, -i/--include, -o/--only, --amend,
#   --pathspec-from-file, a `--` separator, and ANY bare operand (a pathspec).
rem_commit_form_ok() {
  local toks t name rest c i n sawgit=0 sub="" need_val=""
  toks=$(rem_tokenize "$CMD")
  case "$toks" in
    *__REM_META__*) rem_deny "the commit command contains chaining, redirection, command substitution, or unbalanced quotes; the lane requires a single plain 'git commit' whose content is exactly the index" ;;
  esac
  # Walk tokens with a here-doc read loop (preserves tokens that contain spaces).
  local -a A=()
  while IFS= read -r t; do A+=("$t"); done <<REM_TOK_EOF
$toks
REM_TOK_EOF
  n=${#A[@]}; i=0
  # 1. unwrap leading VAR=value assignments and benign command wrappers to the real command word
  while [ "$i" -lt "$n" ]; do
    t=${A[$i]}; t=${t#\\}
    case "$t" in
      [A-Za-z_]*=*) i=$((i+1)) ;;
      command|exec|time|env|nice|nohup|stdbuf|setsid)
        i=$((i+1))
        while [ "$i" -lt "$n" ]; do
          case "${A[$i]}" in -*) i=$((i+1)) ;; [A-Za-z_]*=*) i=$((i+1)) ;; *) break ;; esac
        done ;;
      *) break ;;
    esac
  done
  [ "$i" -lt "$n" ] || rem_deny "could not locate the git command word in the commit invocation"
  t=${A[$i]}; t=${t#\\}
  case "$t" in git|*/git) sawgit=1 ;; *) rem_deny "the gated command word is '$t', not git; refusing to authorize a remediation commit for an unrecognized command" ;; esac
  [ "$sawgit" -eq 1 ] || rem_deny "not a git invocation"
  i=$((i+1))
  # 2. walk git GLOBAL options to the subcommand
  while [ "$i" -lt "$n" ]; do
    case "${A[$i]}" in
      -C|-c|--git-dir|--work-tree|--namespace|--super-prefix|--exec-path) i=$((i+2)) ;;
      -*) i=$((i+1)) ;;
      *) sub=${A[$i]}; i=$((i+1)); break ;;
    esac
  done
  [ "$sub" = "commit" ] || rem_deny "the git subcommand is '$sub', not commit"
  # 3. validate the commit's own arguments against the index-neutral allow-list
  while [ "$i" -lt "$n" ]; do
    t=${A[$i]}
    if [ -n "$need_val" ]; then need_val=""; i=$((i+1)); continue; fi
    case "$t" in
      --) rem_deny "'--' introduces a pathspec; a remediation commit must commit exactly the staged index (no pathspec operands)" ;;
      --*)
        name=${t%%=*}
        case "$name" in
          --message|--file|--template|--author|--date|--reuse-message|--reedit-message|--cleanup|--trailer|--fixup|--squash)
            case "$t" in *=*) : ;; *) need_val=1 ;; esac ;;
          --signoff|--no-signoff|--quiet|--verbose|--edit|--no-edit|--verify|--no-verify|--allow-empty-message|--long|--short|--branch|--no-branch|--status|--no-status|--porcelain|--dry-run|--reset-author|--gpg-sign|--no-gpg-sign|--no-post-rewrite|--no-pager) : ;;
          *) rem_deny "commit option '$name' is not on the remediation lane's index-neutral allow-list (options such as --all/--include/--only/--amend/--pathspec-from-file can commit content that is not in the verified staged set)" ;;
        esac ;;
      -?*)
        rest=${t#-}
        while [ -n "$rest" ]; do
          c=${rest%"${rest#?}"}      # first character of $rest
          rest=${rest#?}
          case "$c" in
            m|F|t|C|c)               # value-taking: attached remainder, else the next token
              if [ -n "$rest" ]; then rest=""; else need_val=1; fi ;;
            S|u)                     # optional ATTACHED value only (-S<keyid>, -u<mode>)
              if [ -n "$rest" ]; then rest=""; fi ;;
            s|q|v|e|n) : ;;          # boolean: --signoff --quiet --verbose --edit --no-verify
            *) rem_deny "commit short option '-$c' is not on the remediation lane's index-neutral allow-list (e.g. -a/-p/-i/-o can commit content outside the verified staged set)" ;;
          esac
        done ;;
      *) rem_deny "bare operand '$t' after 'git commit' is a pathspec; a remediation commit must commit exactly the staged index" ;;
    esac
    i=$((i+1))
  done
  [ -z "$need_val" ] || rem_deny "a value-taking commit option is missing its value; refusing to guess"
  return 0
}

# rem_authorize <base> — full remediation verification. DENIES on any failure; returns 0 (and only
# then) after the token has been consumed and logged. Called ONLY from the audit-DUE branch.
rem_authorize() {
  local base=$1 line k v marker head sd slug d jobf raw_ok got
  local n_rb=0 n_ah=0 n_job=0 n_sha=0 n_fid=0 n_reason=0 n_paths=0
  local rb="" ah="" job="" osha="" fids="" reason=""
  REM_PATHS=""

  # R1. present + readable + non-empty, then STRICT key=value parse.
  [ -f "$REMFILE" ] && [ -r "$REMFILE" ] && [ -s "$REMFILE" ] \
    || rem_deny "dev-memo/run/remediation.authorized is missing, unreadable, or empty"
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line#"${line%%[![:space:]]*}"}          # ltrim
    line=${line%"${line##*[![:space:]]}"}          # rtrim
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in *=*) ;; *) rem_deny "malformed artifact line (expected key=value): '$line'" ;; esac
    k=${line%%=*}; v=${line#*=}
    k=${k%"${k##*[![:space:]]}"}
    v=${v#"${v%%[![:space:]]*}"}; v=${v%"${v##*[![:space:]]}"}
    case "$k" in
      range_base)           rb=$v;     n_rb=$((n_rb+1)) ;;
      audit_head)           ah=$v;     n_ah=$((n_ah+1)) ;;
      broker_job_id)        job=$v;    n_job=$((n_job+1)) ;;
      broker_output_sha256) osha=$v;   n_sha=$((n_sha+1)) ;;
      finding_ids)          fids=$v;   n_fid=$((n_fid+1)) ;;
      reason)               reason=$v; n_reason=$((n_reason+1)) ;;
      allowed_path)         REM_PATHS="${REM_PATHS}${v}
"; n_paths=$((n_paths+1)) ;;
      *) rem_deny "unknown artifact key '$k' — the artifact must contain only range_base, audit_head, broker_job_id, broker_output_sha256, finding_ids, reason, allowed_path" ;;
    esac
  done < "$REMFILE"
  { [ "$n_rb" -eq 1 ] && [ "$n_ah" -eq 1 ] && [ "$n_job" -eq 1 ] && [ "$n_sha" -eq 1 ] \
    && [ "$n_fid" -eq 1 ] && [ "$n_reason" -eq 1 ]; } \
    || rem_deny "each of range_base, audit_head, broker_job_id, broker_output_sha256, finding_ids, reason must appear EXACTLY once (got $n_rb/$n_ah/$n_job/$n_sha/$n_fid/$n_reason)"
  [ "$n_paths" -ge 1 ] || rem_deny "the artifact declares no allowed_path — a remediation commit must be path-scoped"
  printf '%s' "$rb"   | grep -qE '^[0-9a-f]{40}$'          || rem_deny "range_base is not a 40-hex commit sha"
  printf '%s' "$ah"   | grep -qE '^[0-9a-f]{40}$'          || rem_deny "audit_head is not a 40-hex commit sha"
  printf '%s' "$job"  | grep -qE '^audit-[A-Za-z0-9._-]{1,64}$' || rem_deny "broker_job_id '$job' is not a well-formed cc-suite audit job id"
  printf '%s' "$osha" | grep -qE '^[0-9a-f]{64}$'          || rem_deny "broker_output_sha256 is not a 64-hex digest"
  [ -n "$fids" ]   || rem_deny "finding_ids is empty — the artifact must record which audit finding(s) this commit resolves"
  [ -n "$reason" ] || rem_deny "reason is empty — a bypass with no recorded reason is not authorized"
  while IFS= read -r v; do
    [ -n "$v" ] || continue
    case "$v" in
      /*)        rem_deny "allowed_path '$v' must be repo-relative (no leading '/')" ;;
      ..|../*|*/../*|*/..) rem_deny "allowed_path '$v' contains a '..' segment" ;;
      ./*)       rem_deny "allowed_path '$v' must not start with './'" ;;
    esac
  done <<REM_PATHCHK_EOF
$REM_PATHS
REM_PATHCHK_EOF

  # R2. Window binding: range_base must be the CURRENT marker AND the live derived BASE. Requiring
  # BOTH is what keeps a stale FAIL from an older window from authorizing work in the live window
  # (which would let a merely-DUE window be unblocked by an old failure).
  [ -r "$RUN/last-batch-audit" ] || rem_deny "dev-memo/run/last-batch-audit (the batch-audit marker) is missing/unreadable; there is no window to remediate"
  marker=$(tr -dc '0-9a-f' < "$RUN/last-batch-audit")
  printf '%s' "$marker" | grep -qE '^[0-9a-f]{40}$' || rem_deny "the batch-audit marker is not a 40-hex commit sha"
  [ "$rb" = "$marker" ] || rem_deny "range_base ($rb) != the current batch-audit marker ($marker)"
  [ "$rb" = "$base" ]   || rem_deny "range_base ($rb) != the live window BASE ($base) — the artifact belongs to a different (older) audit window"

  # R3. audit_head must be a real commit that the current HEAD descends from, and range_base must
  # be its ancestor — i.e. the failing audit covered a prefix of the history we are committing onto.
  valid_ref "$ah" || rem_deny "audit_head ($ah) is not a commit in this repository"
  head=$(GIT rev-parse HEAD 2>/dev/null) || rem_deny "could not resolve HEAD"
  printf '%s' "$head" | grep -qE '^[0-9a-f]{40}$' || rem_deny "could not resolve HEAD to a 40-hex sha"
  GIT merge-base --is-ancestor "$rb" "$ah" 2>/dev/null || rem_deny "range_base ($rb) is not an ancestor of audit_head ($ah)"
  GIT merge-base --is-ancestor "$ah" "$head" 2>/dev/null || rem_deny "audit_head ($ah) is not an ancestor of the current HEAD ($head) — the cited audit does not cover this history"

  # R4. Range-bound broker binding — the ONLY evidence that an audit actually RAN and FAILED over
  # this window. Mirrors scripts/workflow/batch-closeout.mjs verifyBrokerRangeBound(), inverted to
  # BATCH-FAIL. Without this the lane would also unblock a merely-DUE window, which it must not.
  command -v jq >/dev/null 2>&1 || rem_deny "jq is unavailable, so the broker job JSON cannot be decoded safely; refusing to authorize on an unverified audit verdict"
  slug=${CLAUDE_PROJECT_DIR##*/}
  jobf=""
  for d in "$HOME"/.claude/plugins/data/cc-suite-xiaolai/state/"$slug"-*; do
    [ -d "$d" ] || continue
    if [ -f "$d/jobs/$job.json" ]; then jobf="$d/jobs/$job.json"; break; fi
  done
  [ -n "$jobf" ] || rem_deny "no cc-suite broker job artifact found for '$job' — a batch audit that has not RUN is merely DUE, not FAILED, and the correct response is to run it"
  jq -e 'type == "object"' "$jobf" >/dev/null 2>&1 || rem_deny "broker job artifact for '$job' is not readable JSON"
  jq -e 'has("error") and (.error != null)' "$jobf" >/dev/null 2>&1 \
    && rem_deny "broker job '$job' did not complete (it recorded an error), so it carries no audit verdict"
  raw_ok=$(jq -r 'if (.rawOutput | type) == "string" and (.rawOutput | length) > 0 then "yes" else "no" end' "$jobf" 2>/dev/null)
  [ "$raw_ok" = "yes" ] || rem_deny "broker job '$job' has no non-empty rawOutput"
  got=$(jq -j '.rawOutput' "$jobf" 2>/dev/null | guard_sha256_stdin)
  case "$got" in *[!0-9a-f]*|"") rem_deny "could not hash the broker job's rawOutput (no hash tool available or read error)" ;; esac
  [ "$got" = "$osha" ] || rem_deny "broker rawOutput sha256 ($got) != the artifact's broker_output_sha256 ($osha)"
  jq -j '.rawOutput' "$jobf" 2>/dev/null | grep -qE "^AUDIT-RANGE:[[:space:]]*${rb}\.\.${ah}[[:space:]]*$" \
    || rem_deny "the broker job's rawOutput does not declare 'AUDIT-RANGE: $rb..$ah' on its own line"
  jq -j '.rawOutput' "$jobf" 2>/dev/null | grep -qE '^AUDIT-VERDICT:[[:space:]]*BATCH-PASS' \
    && rem_deny "the broker job's rawOutput declares a BATCH-PASS verdict; a passing (or ambiguous) audit is not a FAILED audit and cannot open the remediation lane"
  jq -j '.rawOutput' "$jobf" 2>/dev/null | grep -qE '^AUDIT-VERDICT:[[:space:]]*BATCH-FAIL([[:space:]]+[CHML][0-9]+)*[[:space:]]*$' \
    || rem_deny "the broker job's rawOutput does not declare 'AUDIT-VERDICT: BATCH-FAIL …' on its own line — only a FAILED audit opens this lane (a merely-DUE audit must simply be run)"

  # R5. The commit must commit exactly the index (else the subset check below proves nothing).
  rem_commit_form_ok

  # R6. Staged set: non-empty and a SUBSET of allowed_path. core.quotePath=false keeps UTF-8 paths
  # literal; --no-renames lists BOTH sides of a staged rename so neither can escape the subset.
  # A path git still C-quotes (embedded newline/quote/control byte) cannot be compared safely -> deny.
  local staged rc sp
  staged=$(GIT -c core.quotePath=false diff --cached --name-only --no-renames 2>/dev/null); rc=$?
  [ "$rc" -eq 0 ] || rem_deny "could not read the staged file set (git diff --cached failed rc=$rc)"
  [ -n "$staged" ] || rem_deny "the staged file set is EMPTY — a remediation commit must stage the fix explicitly so it can be checked against allowed_path"
  while IFS= read -r sp; do
    [ -n "$sp" ] || continue
    case "$sp" in '"'*) rem_deny "staged path $sp is git-quoted (embedded newline/quote/control byte) and cannot be compared to allowed_path" ;; esac
    rem_path_allowed "$sp" || rem_deny "staged path '$sp' is OUTSIDE the artifact's allowed_path set — a remediation commit is path-scoped to the declared fix"
  done <<REM_STAGED_EOF
$staged
REM_STAGED_EOF

  # R7. Single-use, exactly like human.override (BCG-5): every check above already passed, so the
  # token is spent only on a genuinely authorized commit. Remove FIRST, confirm gone, then append
  # the audit line — so log.md never records a "consumed" token that still exists, and a failure to
  # remove or to log DENIES rather than authorizing on a token that could be replayed.
  if rm -f "$REMFILE" 2>/dev/null && [ ! -e "$REMFILE" ] \
     && { printf '%s remediation consumed: job=%s range_base=%s audit_head=%s findings=%s paths=%s reason=%s\n' \
            "$(date -u +%FT%TZ)" "$job" "$rb" "$ah" "$fids" \
            "$(printf '%s' "$REM_PATHS" | tr '\n' ',' | sed 's/,*$//')" "$reason" >> "$RUN/log.md"; } 2>/dev/null; then
    return 0
  fi
  rem_deny "dev-memo/run/remediation.authorized could not be atomically consumed+logged (token removal or the dev-memo/run/log.md append failed). Refusing to authorize on a token that may still exist"
}

# --- Batch mode (MAX>1). human.ack does NOT apply here (it's a gated-mode token). ---
# The only batch-mode escape is a deliberate, logged human.override + non-empty reason file.
# It still does NOT bypass the staging/secrets checks enforced by the other commit hooks.
# BCG-5: grant the batch-mode override (which bypasses risk/governed/count) ONLY when it is fully
# consumed. Authorization chain, left-to-right: (1) the override REASON (first line of
# override-reason.md) is readable + non-empty — a bypass with no recorded reason is not authorized,
# checked BEFORE removal so a blank/unreadable reason denies WITHOUT spending the token; (2) the token
# is removed and confirmed gone; (3) only THEN is the "consumed" audit line appended. OVERRIDE=1 iff
# all three succeed, so log.md never records a "consumed" override that is still present or had no
# reason. Any failure -> deny (fail-closed; the token is single-use and is spent only if removal ran).
OVERRIDE=0
if [ -f "$RUN/human.override" ] && [ -s "$RUN/override-reason.md" ]; then
  ovreason=$(head -1 "$RUN/override-reason.md" 2>/dev/null)
  if [ -n "$ovreason" ] \
     && rm -f "$RUN/human.override" 2>/dev/null && [ ! -e "$RUN/human.override" ] \
     && { printf '%s override consumed: %s\n' "$(date -u +%FT%TZ)" "$ovreason" >> "$RUN/log.md"; } 2>/dev/null; then
    OVERRIDE=1
  else
    deny "Batch guard: dev-memo/run/human.override could not be atomically consumed+logged — the override reason (first line of dev-memo/run/override-reason.md) is empty/unreadable, or token removal / audit-log append failed. Refusing to authorize (the override is single-use; it is spent only if removal succeeded). Re-create dev-memo/run/human.override + a non-empty override-reason.md and ensure dev-memo/run/log.md is writable (fail-closed)."
  fi
fi

if [ "$OVERRIDE" -eq 0 ]; then
  # Risk trigger pending → must be cleared (audited) before any further commit.
  [ -f "$RUN/risk.flag" ] && deny "Batch guard: a Layer-C risk trigger is pending ($(cat "$RUN/risk.flag" 2>/dev/null)). Run the batch audit and clear dev-memo/run/risk.flag first."

  # Queue must be GOVERNED. governed is written ONLY by govern-queue.sh, which requires BOTH
  # queue.linted (check-queue.sh) AND queue.reviewed (Codex /review-plan) — or human approval.
  [ -f "$RUN/queue.governed" ] || deny "Batch guard: queue is not governed. Need queue.linted + queue.reviewed (then govern-queue.sh), or explicit human approval. Lint alone is not sufficient."

  # BCG-6 / GOVERNANCE-CHAIN-001: governance must be CONTENT-BOUND, not presence-only. The old
  # gate above proved only THAT a governance ceremony happened, never that the queue being
  # committed against is the queue that was linted + reviewed. govern-queue.sh records
  # queue_sha256=sha256(queue.md) into queue.governed; here we recompute it and FAIL CLOSED (deny)
  # when the recorded hash is absent, malformed (not 64 lowercase hex), the queue.md is unreadable
  # / unhashable, or the digests MISMATCH (queue.md edited after governance). This block is
  # STRICTLY ADDITIVE: it can only ADD a denial after the presence check, never authorize a commit
  # the prior checks blocked.
  # STRICT parse: require EXACTLY ONE queue_sha256 assignment line AND that it be the canonical
  # form queue_sha256=<64-lowercase-hex>. A lax `tr -d '[:space:]'` extraction would have normalized
  # embedded whitespace (`queue_sha256= <hash>`) into a "valid" digest, and counting ONLY canonical
  # lines would still ALLOW a valid line accompanied by an EXTRA malformed `queue_sha256=` line.
  # TOTAL counts every queue_sha256 assignment (any form); CANON counts only the canonical form.
  # Require TOTAL==1 AND CANON==1 so any malformed/duplicate/whitespace companion line fails closed.
  TOTAL=$(grep -cE '^[[:space:]]*queue_sha256[[:space:]]*=' "$RUN/queue.governed" 2>/dev/null)
  CANON=$(grep -cE '^queue_sha256=[0-9a-f]{64}$' "$RUN/queue.governed" 2>/dev/null)
  { [ "${TOTAL:-0}" -eq 1 ] && [ "${CANON:-0}" -eq 1 ]; } || deny "Batch guard: queue.governed must contain EXACTLY ONE canonical 'queue_sha256=<64-lowercase-hex>' line and no other queue_sha256 line (found total=${TOTAL:-0}, canonical=${CANON:-0}) — governance absent, legacy, malformed, whitespace-padded, or duplicated. Re-run scripts/workflow/govern-queue.sh on the reviewed queue. Fail-closed (BCG-6 / GOVERNANCE-CHAIN-001)."
  RECORDED=$(grep -E '^queue_sha256=[0-9a-f]{64}$' "$RUN/queue.governed" | head -1 | sed 's/^queue_sha256=//')
  [ -r "$RUN/queue.md" ] || deny "Batch guard: dev-memo/run/queue.md is missing/unreadable; cannot verify the governance content hash. Fail-closed (BCG-6)."
  ACTUAL=$(guard_sha256 "$RUN/queue.md")
  case "$ACTUAL" in
    *[!0-9a-f]* | "" ) deny "Batch guard: could not compute sha256(queue.md) (no hash tool available or read error). Fail-closed (BCG-6)." ;;
  esac
  [ "$ACTUAL" = "$RECORDED" ] || deny "Batch guard: queue.md content hash ($ACTUAL) does not match the governed hash ($RECORDED) — queue.md changed after governance. Re-run scripts/workflow/govern-queue.sh on the reviewed queue before committing. Fail-closed (BCG-6 / GOVERNANCE-CHAIN-001)."

  # Closeout-in-progress (BATCH-CLOSEOUT-AUTO-00). The verified closeout
  # (scripts/workflow/batch-closeout.mjs) writes dev-memo/run/.closeout-pending BEFORE it mutates
  # the marker and removes it only after its own batch-close commit succeeds. While the sentinel
  # exists the audit window is, by construction, NOT yet cleared — so treat the batch as still
  # audit-DUE and deny every normal agent commit. This is STRICTLY ADDITIVE: it can only ADD a
  # denial (it never permits a commit the count/governed/risk checks already blocked). The
  # closeout's own commit is a child process of node, not a Claude Bash-tool call, so it is not
  # gated here. A crash mid-closeout leaves the sentinel → this deny holds → re-running the
  # closeout reconciles. The sentinel is tamper-protected by protect-run-control.sh +
  # block-run-control-bash-write.sh (only the closeout script may write/remove it).
  [ -f "$RUN/.closeout-pending" ] && deny "Batch guard: a batch-closeout is in progress (dev-memo/run/.closeout-pending present); the audit window is not yet cleared, so commits remain blocked as audit-DUE. Re-run scripts/workflow/batch-closeout.mjs to complete or reconcile the closeout first."

  # Counter is GIT-DERIVED, not agent-maintained: commits since the current window start.
  # BASE = the NEWER of batch-start and last-batch-audit (BATCH-COUNTER-001 fix).
  #   - batch-start defines the current batch window (reset when a new batch begins).
  #   - last-batch-audit advances the window when a Layer-B audit is recorded mid-batch.
  # The newer commit is the live boundary; a stale predecessor must NOT override it (the old
  # code always preferred last-batch-audit, so resetting batch-start forward had no effect and
  # non-batch commits before the stale audit kept counting). Moving batch-start forward is a
  # privileged act — protect-run-control.sh + block-run-control-bash-write.sh restrict those
  # files to the workflow scripts or a deliberate human action — so newer-wins is not an
  # agent-exploitable escape. Invalid/garbage refs are dropped (closes a fail-open where an
  # unresolvable last-batch-audit yielded COUNT=0 and the breaker never fired).
  GIT() { git -C "$CLAUDE_PROJECT_DIR" "$@"; }
  valid_ref() { [ -n "$1" ] && GIT cat-file -e "${1}^{commit}" 2>/dev/null; }
  BS=""; LBA=""
  [ -r "$RUN/batch-start" ]      && BS=$(tr -dc '0-9a-f' < "$RUN/batch-start")
  [ -r "$RUN/last-batch-audit" ] && LBA=$(tr -dc '0-9a-f' < "$RUN/last-batch-audit")
  valid_ref "$BS"  || BS=""
  valid_ref "$LBA" || LBA=""
  BASE=""
  if [ -n "$BS" ] && [ -n "$LBA" ]; then
    if [ "$BS" = "$LBA" ]; then
      BASE=$BS
    elif GIT merge-base --is-ancestor "$BS" "$LBA" 2>/dev/null; then
      BASE=$LBA   # batch-start is an ancestor of the audit checkpoint -> audit is newer
    elif GIT merge-base --is-ancestor "$LBA" "$BS" 2>/dev/null; then
      BASE=$BS    # audit checkpoint is an ancestor of batch-start -> reset batch-start is newer
    else
      # Divergent/unrelated history: fail SAFE toward auditing sooner (larger count = older base).
      # Fail-closed like the final count: a rev-list failure here must NOT coerce to 0 and let a
      # wrong base be chosen (audit job audit-mpufm338-2gtelo finding #4).
      cbs=$(GIT rev-list --count "${BS}..HEAD" 2>/dev/null);  cbsrc=$?
      clba=$(GIT rev-list --count "${LBA}..HEAD" 2>/dev/null); clbarc=$?
      if [ "$cbsrc" -ne 0 ] || [ "$clbarc" -ne 0 ] \
         || ! printf '%s' "$cbs" | grep -qE '^[0-9]+$' \
         || ! printf '%s' "$clba" | grep -qE '^[0-9]+$'; then
        deny "Batch guard: could not compare divergent batch-start/last-batch-audit (git rev-list failed); denying as a precaution — check repository history integrity."
      fi
      if [ "$cbs" -ge "$clba" ]; then BASE=$BS; else BASE=$LBA; fi
    fi
  elif [ -n "$BS" ]; then
    BASE=$BS
  elif [ -n "$LBA" ]; then
    BASE=$LBA
  fi
  [ -n "$BASE" ] || deny "Batch guard: no valid last-batch-audit or batch-start commit recorded; cannot derive the auto-commit count. Record dev-memo/run/batch-start (current HEAD) before auto-committing."
  # Capture rev-list exit status: a runtime failure (shallow/damaged history) must NOT silently
  # become COUNT=0 and pass the breaker (fail-open closed; audit job audit-mpuesqmt-4zzpxr).
  COUNT=$(GIT rev-list --count "${BASE}..HEAD" 2>/dev/null); rlrc=$?
  if [ "$rlrc" -ne 0 ] || ! printf '%s' "$COUNT" | grep -qE '^[0-9]+$'; then
    deny "Batch guard: could not derive a reliable commit count (git rev-list failed rc=$rlrc or returned non-numeric '$COUNT') for BASE=$BASE. Denying as a precaution — check repository history (shallow/damaged?) and the recorded batch-start/last-batch-audit."
  fi

  # Audit window closed. The ONLY escape here is the remediation lane, and ONLY when the artifact
  # exists — with no artifact this is byte-for-byte the original audit-DUE deny. The lane is
  # engaged solely inside this branch: when the audit is not due the artifact is neither read nor
  # consumed (normal rules already permit the commit, so there is nothing to authorize).
  # rem_authorize denies internally on ANY failure and returns only after consuming+logging the
  # token, so reaching the next line means a fully verified remediation commit.
  deny_breaker() { deny "Batch guard: AUTO_ADVANCE_MAX=$MAX reached ($COUNT consecutive auto-commits). Stop for human review; use a logged human.override to continue."; }
  if [ "$COUNT" -ge "$EVERY" ]; then
    if [ -f "$REMFILE" ]; then
      # The breaker is evaluated BEFORE the lane runs, so a commit the breaker will refuse anyway
      # cannot burn the human's single-use authorization. (Risk flag / governance / sentinel are
      # already checked above, i.e. also before the token is touched.)
      [ "$COUNT" -ge "$MAX" ] && deny_breaker
      rem_authorize "$BASE"
    else
      deny "Batch guard: batch audit DUE ($COUNT commits since last audit >= BATCH_AUDIT_EVERY=$EVERY). Run the batch audit and record new HEAD in dev-memo/run/last-batch-audit, then commit."
    fi
  fi
  [ "$COUNT" -ge "$MAX" ] && deny_breaker
fi

# Allowed. Count is git-derived — no counter file to maintain.
exit 0
