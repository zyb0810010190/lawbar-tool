#!/bin/bash
# block-run-control-bash-write.sh — PreToolUse(Bash) hook.
#
# ===========================================================================================
# WHAT THIS IS: BEST-EFFORT COMMAND HYGIENE. NOT AN ENFORCEMENT BOUNDARY.
# ===========================================================================================
# This hook reads the TEXT of a proposed Bash command and denies the ones that look like they
# write the dev-memo/run/ governance and audit-state files. That is all it does.
#
# It prevents MISTAKES. It does NOT prevent FORGERY.
#
# Why it cannot: once an agent is allowed to run a shell at all, deciding what a command will
# actually touch is an unbounded parsing problem, not a matching problem. `sh -c`, `eval`,
# variables, aliases and functions, subshells, `$(...)`, process substitution, parameter and
# brace expansion, `$IFS` games, base64/printf-assembled strings, an interpreter that spawns
# its own shell, or simply a helper script written elsewhere and then executed — each is a way
# to name a file that no amount of string matching on the ORIGINAL command line will see. Every
# guard below is a lexical heuristic over one line of text; the heuristics are deliberately
# fail-closed and deliberately over-deny, and they are still, in principle, defeatable by
# anyone who is trying.
#
# So: this hook is cooperative friction — it keeps an honest agent (and an honest human in a
# hurry) from casually clobbering governance state, and it makes the accidental path loud. It
# is not a security control and must not be relied on as one.
#
# THEREFORE:
#   - Do NOT treat "the guard passed" as proof that a command is safe. A pass is the absence of
#     a match, not evidence of intent or of effect.
#   - Do NOT make a downstream decision (accepting a batch, trusting queue.governed, believing
#     an audit trail is intact) on the strength of this hook having run. Verify the state files
#     themselves — content, git history, human tokens — not the fact that a hook was installed.
#   - Do NOT weaken any check here on the grounds that "it's only advisory". A partial guard
#     that people rely on is worse than no guard; the honest framing above is what keeps this
#     from becoming a false assurance.
#   - Real enforcement, if it is ever needed, has to come from something outside the command
#     text: filesystem permissions, a separate privilege domain, signed/attested state, or
#     review of the resulting diff.
#
# Origin (still accurate as the description of the ACCIDENT class this covers): protect-run-
# control.sh covers Write|Edit|MultiEdit but NOT Bash, so `echo X > dev-memo/run/config`,
# `tee dev-memo/run/queue.governed`, `ln dev-memo/run/human.ack ...`, `sed -i ... config`,
# `rm dev-memo/run/queue.reviewed`, etc. would otherwise sail straight past it and change
# governance/override/audit state that batch-commit-guard.sh reads.
# Evidence: dev-memo/hook-audit-canary-01.md (BASH-WRITE-BYPASS).
#
# Policy:
#   - Authority/state files (mirror protect-run-control.sh): ALL Bash writes denied
#     (redirection, tee, cp, mv, install, ln, truncate, dd of=, sed -i, rm, unlink, touch).
#     These change only via the workflow scripts (which name script paths, not the state
#     files, on the command line) or a deliberate human action.
#   - log.md (the audit trail): APPEND-ONLY. `>>` / `tee -a` allowed; truncate/overwrite (`>`),
#     rm, mv, cp, ln, dd, sed -i denied. This preserves the agent-appended audit trail that
#     batch-commit-guard.sh and the workflow lifecycle rely on.
#   - queue.md (authored), README.md, queue.example.md, reviews/ are NOT authority state —
#     writes allowed.
#
# Fails CLOSED *within the limits stated at the top*: when the text it CAN see is ambiguous —
# unparseable command, unresolvable substitution, unbalanced quoting — it denies rather than
# guesses. That is a property of the parsing it attempts; it says nothing about text it never
# sees (indirection through eval/sh -c/an interpreter/a written-then-run script).
# BSD/macOS-portable: no GNU-only regex idioms (see dev-memo/hook-audit-canary-01.md).
# This hook is conservative — a write verb co-occurring with an authority path is denied even
# if that path is only a read source; the legitimate workflow scripts never name state files
# directly, so they are unaffected.

INPUT=$(cat)

# emit_deny <reason>: emit the PreToolUse deny decision as VALID JSON (PRC-4-FU; mirrors
# protect-run-control.sh deny()). Escaping only `\` and `"` (the old behaviour) left ASCII C0
# control bytes (newline/tab/CR, 0x00-0x1F) UNescaped, which is invalid JSON (RFC 8259 §7) and
# could make the harness fail to register the deny (fail-open). jq -Rs encodes the whole reason as
# a JSON string literal (quotes + all escaping incl C0 + UTF-8). If jq is unavailable OR errors
# (e.g. invalid UTF-8), fall back to stripping C0 controls to spaces + escaping `\`/`"` — still
# valid JSON (non-UTF-8 bytes in that degraded path are a documented residual).
emit_deny() {
  local reason=$1 enc
  if command -v jq >/dev/null 2>&1 && enc=$(printf '%s' "$reason" | jq -Rs . 2>/dev/null) && [ -n "$enc" ]; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' "$enc"
  else
    enc=$(printf '%s' "$reason" | tr '\000-\037' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$enc"
  fi
  exit 0
}

# --- parse .tool_input.command (jq preferred; fail-closed fallback) ---
# jq is the only safe JSON decoder here. Its absence forces a regex fallback that extracts the
# RAW command string WITHOUT decoding JSON string escapes. ANY JSON escape then becomes a
# bypass vector for the lexical `grep dev-memo/run/` that follows (BRCBW-6):
#   - `\/`  : JSON `/`->`\/`, so `dev-memo\/run\/config` never matches `dev-memo/run/`.
#   - `\uXXXX`: any path char encoded as `/` (/), `.` (.), letters, etc.
#   - `\\`  : JSON `\\`->`\`, and Bash then STRIPS that backslash during word-splitting, so
#             `dev-memo/r\\un/config` (raw) -> Bash target `dev-memo/run/config` (Codex
#             audit-mpxi9cp3-oz4ae8).
#   - `\"`  : quote-splicing inside a path segment, same effect.
# A narrow allow-list (only `\/`+`\uXXXX`) is whack-a-mole — `\\` and `\"` defeat it. Per the WI
# (prefer fail-closed over a partial JSON decoder): when jq is unavailable AND the raw payload
# contains ANY backslash, deny. In well-formed JSON a backslash appears ONLY inside a string
# escape, so a backslash IS an escape we cannot safely resolve without jq. Plain commands carry no
# backslash and are unaffected; this only bites the (already anomalous) jq-absent path. When jq IS
# available it decodes everything and behavior is entirely unchanged (this branch never runs).
# NOTE: a Bash-metacharacter path obfuscation that needs no JSON escape (e.g. jq-PRESENT
# `echo X > dev-memo/r\un/config`, or quote-splicing) is a SEPARATE, pre-existing path-indirection
# gap tracked with BRCBW-1/2 (WI-B) — not closed here; this WI closes only the jq-absent class.
if command -v jq >/dev/null 2>&1; then
  CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  case "$INPUT" in
    *\\*)
      emit_deny "Run-control guard: 'jq' is not available to parse the tool input, and the payload contains a JSON string escape (backslash) that cannot be safely decoded without it — an escaped or backslash-spliced dev-memo/run/ path could be hidden, so the guard cannot prove the command is safe. Denying as a precaution (fail-closed). Install jq, or re-issue the command without backslash escapes in the path." ;;
  esac
  CMD=$(printf '%s' "$INPUT" | tr -d '\n' | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -1 | sed -E 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')
fi

# Authority/state basenames. Keep in sync with protect-run-control.sh.
# `.closeout-pending` is the batch-closeout sentinel (BATCH-CLOSEOUT-AUTO-00): writable/removable
# ONLY by the named closeout script (script channel), never by a direct agent write — else the
# additive batch-commit-guard.sh deny it drives could be forged or cleared.
# `remediation.authorized` is the remediation-lane token (WI-BATCH-REMEDIATION-LANE-00): a HUMAN
# creates it, batch-commit-guard.sh consumes it. If the agent could write it, it would be
# self-authorizing its own commit past a FAILED batch audit — the whole point of the lane is that
# it cannot. Same protection class as human.ack / human.override.
AUTH='config|batch-start|last-batch-audit|queue\.governed|queue\.linted|queue\.reviewed|risk\.flag|human\.ack|human\.override|override-reason\.md|remediation\.authorized|forbidden-paths\.txt|\.closeout-pending'

# --- fast exit / fail-safe when nothing references dev-memo/run/ ---
if [ -z "$CMD" ]; then
  # No parsed command. If the raw payload looks like it writes into run/, fail safe.
  if printf '%s' "$INPUT" | grep -qE 'dev-memo/run/' \
     && printf '%s' "$INPUT" | grep -qE '(>|tee|sed[[:space:]]+-i|[[:space:]](cp|mv|ln|rm|unlink|install|truncate|dd)[[:space:]])'; then
    emit_deny "Run-control guard: could not parse a Bash command that appears to write into dev-memo/run/; denying as a precaution. Re-issue an explicit, parseable command."
  fi
  exit 0
fi
# --- BRCBW-12: candidate-target termination at ANY shell metacharacter ---
# A file-name word in a shell command ends at the first UNQUOTED metacharacter, not only at
# whitespace. Every scan below whitespace-splits (`for tok in $norm` / `set -- $stmt`), so a
# protected path glued straight onto a metacharacter used to survive as part of the token and
# its BASENAME then matched nothing in $AUTH — an ALLOW. The original truncation set was
# `; | & )`; it omitted `< > (`, which left these VERIFIED bypasses (each confirmed by feeding
# crafted JSON to this hook on stdin):
#     echo X > dev-memo/run/config<foo          (redirect target glued to a `<` redirection)
#     echo X > dev-memo/run/config(foo
#     rm|cp|mv|tee|touch|sed -i|dd of= dev-memo/run/config<foo   (and the `>` spelling: the verb
#     scan has no `__TRUNC__` normalisation, so BOTH `<` and `>` were live there)
# cut_meta sets $CUT to the token truncated at the first char of `; | & ( ) < >` or whitespace.
# Deliberately quote-BLIND: a metacharacter inside quotes is really data (`rm "…/a;b"` names a
# file called `a;b`), and cutting there can only SHORTEN the candidate, i.e. only turn a
# non-match into a match. Worst case is an over-denial of an exotic real filename under
# dev-memo/run/ — friction, never a bypass. Strictly ADDITIVE: every check that fired before
# fires on the same or a shorter prefix ($AUTH contains none of these characters).
cut_meta() {
  CUT=${1%%[\;\|\&\(\)\<\>]*}
  case $CUT in *[[:space:]]*) CUT=${CUT%%[[:space:]]*} ;; esac
}

# --- BRCBW-10 + BRCBW-12: de-obfuscate lexical shell-word obfuscation of the path ---
# deobf_scan walks the command ONE CHARACTER AT A TIME with a per-token quote state machine and
# sets three globals:
#   DEOBF       — quote-context-aware de-obfuscation: a backslash removes itself and makes the
#                 next character data (`r\un` -> `run`); a quote character that OPENS or CLOSES
#                 a token's quoting is structural and dropped (`"run"` -> `run`, `ru''n` ->
#                 `run`); a quote of the OTHER type inside a quoted span is data and kept.
#   DEOBF_FLAT  — the same walk but with EVERY surviving quote character removed too. This is a
#                 deliberate superset of DEOBF and of the old implementation's output; it exists
#                 so that this change cannot LOSE a denial the parity heuristic used to produce
#                 (e.g. `rm "dev-memo/'run'/config"`, where the inner quotes are really data).
#   DEOBF_NEUT  — like DEOBF, but every `; | & ( ) < > [ ]` that was QUOTED or backslash-escaped
#                 is replaced by `_`. In a real shell those characters are DATA there, not
#                 syntax; two scans below reason about them over the whole string and were
#                 fooled by that (see the VERIFIED bypasses under "quote-blind shell syntax").
#   DEOBF_UNBAL — 1 when the final token is still inside a quote at end-of-string.
#
# VERIFIED bypasses closed by DEOBF_NEUT (both are the same defect as the parity heuristic —
# reasoning about shell syntax by matching the whole string, with no idea what is quoted):
#   (i)  scan_redir/scan_indirection blank `[[ ... ]]` spans with a plain sed, because `>` inside
#        a test is a comparison. A QUOTED literal bracket pair drags a real redirection into the
#        blanked span: `echo "[[" > dev-memo/run/config; echo "]]"` was ALLOWED.
#   (ii) scan_verbs/scan_indirection split statements with `awk gsub(/&&|\|\||[;|&]/)`. A QUOTED
#        metacharacter in an argument ends the statement early, so the real target lands in a
#        fragment whose first word is not a write verb: `rm 'a;b' dev-memo/run/config`,
#        `tee 'a;b' …`, `cp /tmp/x 'a;b' …`, `touch 'a;b' …` were all ALLOWED.
# Neutralising only the characters that are unambiguously literal when quoted keeps `$` and
# backtick meaningful, and the NEUT rescan is purely ADDITIVE — an extra pass that can call
# emit_deny, never one that turns a deny into an allow.
#
# What this REPLACES and why (BRCBW-12, VERIFIED bypass): the old deobf() counted `"` and `'`
# over the WHOLE command and stripped quotes only when BOTH counts were even. One odd count
# ANYWHERE disabled stripping EVERYWHERE — fail-OPEN. So `echo X > dev-memo/"run"/config` was
# correctly denied, but `echo it's X > dev-memo/"run"/config` was ALLOWED: an unrelated
# apostrophe in `it's` (or `don't`, `can't`) was enough to hide the path. The decision is now
# per token and per quote-span, so an apostrophe in one word cannot un-de-obfuscate another.
# Unbalanced quoting is no longer "leave unchanged" (which was the fail-open branch) — it is a
# DENY, applied below once we know the command references run-control state.
# Still NOT resolved (documented non-goals, unchanged): $IFS, $(...), variables, brace
# expansion, and everything named in the header's "not an enforcement boundary" note.
deobf_scan() {
  local s=$1 i=0 n c st="" out="" flat="" neut="" lit
  # Shortcut: with no backslash and no quote in the command there is nothing to de-obfuscate,
  # nothing that can be unbalanced, and nothing that is quoted-literal, so the walk below would
  # return the input verbatim in all three views. Provably identical, and it keeps the
  # per-character loop off long ordinary command lines.
  case $s in
    *\\*|*\"*|*\'*) ;;
    *) DEOBF=$s; DEOBF_FLAT=$s; DEOBF_NEUT=$s; DEOBF_UNBAL=0; return 0 ;;
  esac
  n=${#s}                 # separate statement: `local` expands all its words BEFORE assigning
  DEOBF_UNBAL=0
  while [ "$i" -lt "$n" ]; do
    c=${s:i:1}; i=$((i + 1))
    lit=0                 # 1 => this character is DATA in a real shell, never syntax
    if [ "$c" = '\' ]; then
      # Backslash: drop it, take the next character as DATA (it can no longer open/close a
      # quote, and it is not syntax). Applied inside single quotes too, where real Bash would
      # keep it literal — we over-strip on purpose, because stripping MORE can only reveal more
      # paths (more denials), and the previous implementation stripped unconditionally as well.
      [ "$i" -lt "$n" ] || continue     # trailing backslash: nothing to unescape
      c=${s:i:1}; i=$((i + 1)); lit=1
    else
      case "$st" in
        '')   case "$c" in "'") st="s"; continue ;; '"') st="d"; continue ;; esac ;;
        s)    [ "$c" = "'" ] && { st=""; continue; }; lit=1 ;;
        d)    [ "$c" = '"' ] && { st=""; continue; }; lit=1 ;;
      esac
    fi
    out=$out$c
    case "$c" in "'"|'"') : ;; *) flat=$flat$c ;; esac
    if [ "$lit" = 1 ]; then
      case "$c" in
        \;|\||\&|\(|\)|\<|\>|\[|\]) neut=${neut}_ ;;   # quoted/escaped => literal, not syntax
        *) neut=$neut$c ;;
      esac
    else
      neut=$neut$c
    fi
  done
  # An unterminated quote swallows the rest of the line, so the "current token" at end-of-string
  # is the one that is unbalanced; every earlier token closed its quotes by construction.
  [ -n "$st" ] && DEOBF_UNBAL=1
  DEOBF=$out
  DEOBF_FLAT=$flat
  DEOBF_NEUT=$neut
}
# Fast-exit gate (BRCBW-10/-1 High fix): proceed iff the command references dev-memo/run — NO
# trailing-slash requirement, so `cd dev-memo/run` (no slash) and de-obfuscated paths are seen.
# PRESTRIP is CMD with EVERY backslash and quote character deleted. It is a SUPERSET of both
# de-obfuscated views: DEOBF and DEOBF_FLAT keep every character PRESTRIP keeps (plus some quote
# / escaped-backslash characters), and `dev-memo/run` contains no quote or backslash, so if that
# substring is contiguous in either view it is contiguous in PRESTRIP too. Gating on PRESTRIP
# therefore cannot skip anything the full scan would have caught.
# It is also the HOT PATH: this hook runs on every Bash tool call, and deobf_scan below is a
# per-character bash loop (~90ms on a 9KB command line). Both the strip and the test are pure
# parameter expansion / `case` — no forks — so an ordinary command that never mentions
# dev-memo/run exits here without paying for the character walk.
PRESTRIP=${CMD//\\/}
PRESTRIP=${PRESTRIP//\"/}
PRESTRIP=${PRESTRIP//\'/}
case "$CMD" in
  *dev-memo/run*) ;;
  *) case "$PRESTRIP" in *dev-memo/run*) ;; *) exit 0 ;; esac ;;
esac
deobf_scan "$CMD"
# BRCBW-12: unbalanced quoting means the token boundaries are not knowable from this text, so no
# scan below can be trusted about which word is the write target. Deny. This is bounded to
# commands that reference run-control state (the gate above already ran), so an ordinary
# `echo it's fine` is unaffected; an apostrophe in a sentence that ALSO names dev-memo/run is
# over-denied, which is friction, not a bypass. Re-issue with the quote closed or escaped.
if [ "$DEOBF_UNBAL" = 1 ]; then
  emit_deny "Run-control guard: this command references dev-memo/run/ and has an unbalanced quote (a ' or \" that is never closed), so the guard cannot tell where the target word ends or which file would be written. Denying as a precaution (fail-closed). Close or escape the quote and re-issue; change run-control state via the workflow scripts or a deliberate human action."
fi

# --- helpers --- token classifiers: does a single token name an authority file?
# Each candidate is (a) cut at the first shell metacharacter, (b) stripped of one surrounding
# quote layer, (c) cut again — so `"dev-memo/run/config"<x` and `dev-memo/run/config<x` both
# resolve to the real target word (BRCBW-12).
tok_auth()  { local t; cut_meta "$1"; t=$CUT
  t=${t#\"}; t=${t%\"}; t=${t#\'}; t=${t%\'}; cut_meta "$t"; t=$CUT
  case "$t" in *dev-memo/run/*) printf '%s' "${t##*/}" | grep -qE "^($AUTH)$" ;; *) return 1 ;; esac; }
tok_logmd() { local t; cut_meta "$1"; t=$CUT
  t=${t#\"}; t=${t%\"}; t=${t#\'}; t=${t%\'}; cut_meta "$t"; t=$CUT
  case "$t" in *dev-memo/run/log.md) return 0 ;; *) return 1 ;; esac; }

# --- pass 1: redirection targets (handles > >> >| and fd-prefixed forms) ---
# scan_redir <string> [blank]: deny if a redirection target is a protected run-control file.
# When "blank" is passed, [[ ... ]] conditional spans are first neutralized: inside them, > and
# < are string-comparison operators, NEVER redirection (bash does not redirect from within
# [[ ]]). Blanking stops pass-1 from mistaking `[[ "$x" > dev-memo/run/config ]]` for a redirect
# (BRCBW-7). A redirect ATTACHED to the compound sits AFTER ]] (e.g. `[[ -f x ]] > file`) —
# outside the span — so it is still detected. This removes only comparison operators, never a
# real redirection. Command-substitution bodies are scanned WITHOUT "blank" (pass 4) so a write
# inside `$(...)`/`` `...` `` within a test expression is still caught, not hidden by the blank.
scan_redir() {
  local src=$1 norm tok t base mode=""
  [ "$2" = "blank" ] && src=$(printf '%s' "$src" | sed -E 's/\[\[[^]]*\]\]/ __TEST__ /g')
  norm=$(printf '%s' "$src" | sed -E 's/[0-9]*>>/ __APPEND__ /g; s/[0-9]*>[|]/ __TRUNC__ /g; s/[0-9]*>/ __TRUNC__ /g')
  set -f
  for tok in $norm; do
    if [ "$mode" = "APP" ] || [ "$mode" = "TRUNC" ]; then
      t=$tok
      # BRCBW-11 (High, PRE-EXISTING — found while proving WI-BATCH-REMEDIATION-LANE-00's "the agent
      # cannot create the token" criterion): a redirection target word is terminated by an UNQUOTED
      # shell metacharacter as well as by whitespace. `for tok in $norm` only splits on whitespace,
      # so `> dev-memo/run/config;echo x`, `…/config|cat` and `> …/human.override; ls` produced the
      # tokens `…/config;echo`, `…/config|cat`, `…/human.override;` — whose BASENAMES never matched
      # ^($AUTH)$ — and the write was ALLOWED. That under-denied EVERY protected run-control file
      # (config, human.ack/override, batch-start, last-batch-audit, queue.*, risk.flag,
      # remediation.authorized, .closeout-pending) and log.md truncation, via the most obvious
      # spelling an agent would type. Truncate the target at the first `; | & )` — before and after
      # quote-stripping, so `"…/config";ls` is covered too.
      # Strictly ADDITIVE: the check now runs on a PREFIX of the old token. A token that matched
      # before had no metacharacter in its basename (AUTH contains none), so it is unchanged; a
      # token that did not match can now only start matching. Worst case is an over-denial of an
      # exotic real filename containing ';' under dev-memo/run/ — friction, never a bypass.
      # BRCBW-12: the truncation set was `; | & )` and omitted `< > (`. `>` was masked here by
      # the `__TRUNC__` normalisation above, but `<` and `(` were live, so
      # `echo X > dev-memo/run/config<foo` and `…/config(foo` were ALLOWED (verified). cut_meta
      # now terminates the target at any of `; | & ( ) < >` or whitespace.
      cut_meta "$t"; t=$CUT
      t=${t#\"}; t=${t%\"}; t=${t#\'}; t=${t%\'}   # strip one layer of surrounding quotes
      cut_meta "$t"; t=$CUT
      case "$t" in
        *dev-memo/run/*)
          base=${t##*/}
          if printf '%s' "$base" | grep -qE "^($AUTH)$"; then
            set +f
            emit_deny "Run-control guard: Bash redirection into dev-memo/run/$base is forbidden. Governance/audit state changes only via the workflow scripts or a deliberate human action (protect-run-control.sh covers Write/Edit; this hook covers Bash)."
          fi
          if [ "$base" = "log.md" ] && [ "$mode" = "TRUNC" ]; then
            set +f
            emit_deny "Run-control guard: dev-memo/run/log.md is the append-only audit trail; truncating/overwriting it with '>' is forbidden. Append with '>>' instead."
          fi
          ;;
      esac
      mode=""
      continue
    fi
    case "$tok" in
      __APPEND__) mode="APP" ;;
      __TRUNC__)  mode="TRUNC" ;;
    esac
  done
  set +f
}

# --- pass 2/3: write VERBS targeting an authority file (statement-aware, command-word gated) ---
# scan_verbs <string>: a write-like word only counts when it is the COMMAND WORD of a
# ;/&&/||/|/&-separated statement (after unwrapping env-assignments + wrappers + a leading
# backslash). So a write word in prose (echo "...touch..."), or an authority path named by a
# read-only tool (cat / grep / gh / ls), no longer false-denies (BRCBW-5). Only an authority
# path in a WRITE-TARGET position denies: for cp/install/rsync the destination (a source may be
# read); for dd the of= file (not if=); for mv/ln/rm/unlink/truncate/touch/chmod/chown/shred and
# tee/sed-i any target operand. log.md stays append-only. This NARROWS false-positives without
# weakening any real write (every write form above stays covered; redirection is handled by pass 1).
scan_verbs() {
  local stmt w cmd0 vbase a dest tdir ofv has_i appendf
  set -f
  while IFS= read -r stmt; do
    set -- $stmt
    while [ $# -gt 0 ]; do                          # unwrap env assignments + wrappers + \cmd
      w=$1; w=${w#\"}; w=${w#\'}; w=${w#\\}
      case "$w" in
        [A-Za-z_]*=*) shift ;;
        command|exec|time|env|nice|nohup|stdbuf|setsid)
          shift; while [ $# -gt 0 ]; do case "$1" in -*) shift ;; [A-Za-z_]*=*) shift ;; *) break ;; esac; done ;;
        *) break ;;
      esac
    done
    [ $# -gt 0 ] || continue
    cmd0=$1; cmd0=${cmd0#\"}; cmd0=${cmd0#\'}; cmd0=${cmd0#\\}
    vbase=${cmd0##*/}                               # strip any path prefix (/bin/rm -> rm)
    shift                                           # $@ now = the command's arguments

    case "$vbase" in
      rm|unlink|truncate|touch|chmod|chown|shred|mv|ln)
        # mutation/removal/link/rename: ANY authority operand is a write target.
        for a in "$@"; do
          [ "$a" = "--" ] && break
          tok_auth  "$a" && { set +f; emit_deny "Run-control guard: '$vbase' targets dev-memo/run/${a##*/} — governance/audit state changes only via the workflow scripts or a deliberate human action."; }
          tok_logmd "$a" && { set +f; emit_deny "Run-control guard: '$vbase' on dev-memo/run/log.md is forbidden — the audit trail is append-only."; }
        done ;;
      cp|install|rsync)
        # destination = value of -t/--target-directory if given, else the last non-flag operand.
        dest=""; tdir=""
        while [ $# -gt 0 ]; do
          case "$1" in
            -t|--target-directory) shift; tdir=$1 ;;
            --target-directory=*) tdir=${1#--target-directory=} ;;
            --) shift; while [ $# -gt 0 ]; do dest=$1; shift; done; break ;;
            -*) : ;;
            *) dest=$1 ;;
          esac
          [ $# -gt 0 ] && shift
        done
        [ -n "$tdir" ] && dest=$tdir
        tok_auth  "$dest" && { set +f; emit_deny "Run-control guard: '$vbase' writes dev-memo/run/${dest##*/} (destination) — change run-control state via the workflow scripts or a deliberate human action."; }
        tok_logmd "$dest" && { set +f; emit_deny "Run-control guard: '$vbase' overwriting dev-memo/run/log.md is forbidden — the audit trail is append-only."; } ;;
      dd)
        for a in "$@"; do
          case "$a" in
            of=*) ofv=${a#of=}
                  tok_auth  "$ofv" && { set +f; emit_deny "Run-control guard: 'dd of=' writes dev-memo/run/${ofv##*/} — forbidden."; }
                  tok_logmd "$ofv" && { set +f; emit_deny "Run-control guard: 'dd of=' on dev-memo/run/log.md is forbidden — append-only."; } ;;
          esac
        done ;;
      tee)
        appendf=""; for a in "$@"; do case "$a" in -a|--append) appendf=1 ;; esac; done
        for a in "$@"; do
          case "$a" in -*) continue ;; esac
          tok_auth "$a" && { set +f; emit_deny "Run-control guard: 'tee' writes dev-memo/run/${a##*/} — forbidden."; }
          if tok_logmd "$a" && [ -z "$appendf" ]; then set +f; emit_deny "Run-control guard: 'tee' without -a to dev-memo/run/log.md would truncate the append-only audit trail. Use 'tee -a'."; fi
        done ;;
      sed|perl)
        # In-place edit detection. The flag is -i (optionally with a backup-suffix:
        # sed -i.bak, perl -i.orig) OR the long form --in-place[=SUFFIX]. Perl also CLUSTERS
        # flags in one dash group, so the in-place 'i' can be preceded by other flag letters:
        # perl -pi, -ni, -wpi, -pi.bak (= -p -i / -n -i / ... with i). The old `-i*` glob only
        # caught a LEADING -i, missing the clustered perl forms (BRCBW-4). A single-dash token
        # containing a lowercase 'i' (`-*i*`) is in-place for both tools; this is a strict
        # SUPERSET of the old detection (it still matches -i and -i.bak), so it weakens nothing.
        # Long opts other than --in-place are explicitly ignored so e.g. sed --separate / perl
        # one-liners are not mistaken for in-place. The 'i' here is a flag letter, never the
        # script body: the -e 'script' / sed program is a separate, non-dash-leading argument.
        has_i=""
        for a in "$@"; do
          case "$a" in
            --in-place|--in-place=*) has_i=1 ;;
            --*) : ;;                 # other long options are not in-place
            -*i*) has_i=1 ;;          # single-dash cluster containing i: -i, -i.bak, perl -pi, -wpi.bak
          esac
        done
        if [ -n "$has_i" ]; then
          for a in "$@"; do
            tok_auth  "$a" && { set +f; emit_deny "Run-control guard: in-place edit (sed -i / perl -pi) of dev-memo/run/${a##*/} is forbidden — governance/audit state changes only via the workflow scripts or a deliberate human action."; }
            tok_logmd "$a" && { set +f; emit_deny "Run-control guard: in-place edit of dev-memo/run/log.md is forbidden — append-only."; }
          done
        fi ;;
    esac
  done < <(printf '%s\n' "$1" | awk '{gsub(/&&|\|\||[;|&]/, "\n"); print}')
  set +f
}

# --- pass 5: interpreter inline-code mutations of an authority file (payload-scoped) ---
# Closes the pre-existing loophole that a shell redirection/verb scan cannot see: an interpreter
# given INLINE CODE (node -e/-p/--eval, python -c, perl -e, ruby -e) that writes an authority
# file (e.g. `node -e "fs.writeFileSync('dev-memo/run/last-batch-audit', …)"`) is not a shell
# redirection and carries no shell write-verb, so passes 1-4 allow it.
# Scope (narrow, per the cc-suite review-plan of BATCH-CLOSEOUT-AUTO-00, to avoid the lexical
# whole-string over-deny): deny ONLY when ALL hold — (a) the statement command word is an
# interpreter; (b) it carries an inline-code flag; (c) the inline payload (the post-command
# remainder of that interpreter statement) names a protected dev-memo/run/ authority file AND a
# mutation indicator. A read-only ref (readFileSync) or a payload naming no protected file is
# ALLOWED. A NAMED script (`node scripts/…batch-closeout.mjs`) carries no inline-code flag, so it
# stays on the sanctioned script channel. Residual (documented): a mutation routed through a
# child-process shell string the interpreter spawns is the same cooperative-agent floor as the
# rest of this hook; the outer shell form is still caught by passes 1-4.
# Mutation primitives (fs method names + pathlib writers). The write-mode open(...) family
# (python open(path,'w'|'a'|'x'|'+'), perl open(FH,'>file') / open(FH,'>',$p)) is matched
# separately by OPENMUT because its signal is the MODE ARGUMENT after the first comma, not a
# method name (audit finding H2: open()/write_text/perl-'>' were false negatives).
MUT='writeFile|appendFile|truncate|unlink|rename|symlink|chmod|chown|mkdir|rmdir|copyFile|createWriteStream|write_text|write_bytes|\.touch[[:space:]]*\(|\.write[[:space:]]*\('
OPENMUT='open[[:space:]]*\([^,)]*,[[:space:]]*.?[awx+>]'
scan_interp() {
  local stmt w cmd0 vbase payload sawflag a full=$1
  set -f
  while IFS= read -r stmt; do
    set -- $stmt
    while [ $# -gt 0 ]; do                          # unwrap env-assignments + benign wrappers
      w=$1; w=${w#\"}; w=${w#\'}; w=${w#\\}
      case "$w" in
        [A-Za-z_]*=*) shift ;;
        command|exec|time|env|nice|nohup|stdbuf|setsid)
          shift; while [ $# -gt 0 ]; do case "$1" in -*) shift ;; [A-Za-z_]*=*) shift ;; *) break ;; esac; done ;;
        *) break ;;
      esac
    done
    [ $# -gt 0 ] || continue
    cmd0=$1; cmd0=${cmd0#\"}; cmd0=${cmd0#\'}; cmd0=${cmd0#\\}
    vbase=${cmd0##*/}
    case "$vbase" in node|nodejs|python|python3|perl|ruby) ;; *) continue ;; esac
    shift
    sawflag=""                                       # inline-code flag present?
    for a in "$@"; do
      case "$a" in -e|-p|--eval|-c|-e*|-p*|--eval=*) sawflag=1 ;; esac
    done
    [ -n "$sawflag" ] || continue
    # Inline code can legitimately contain `;` (e.g. python `import x; Path(p).write_text(y)`),
    # which the statement splitter breaks on — so once ANY statement is an interpreter+inline-flag
    # invocation, scan the WHOLE command for a protected-path + mutation pair (not just this
    # fragment), else the in-quote `;` case is a false negative (audit finding H2). Over-deny stays
    # narrow: it only fires when an interpreter inline-flag invocation co-occurs with a protected
    # path AND a write primitive. A read-only inline ref (readFileSync / open(...,'r')) has no
    # mutation match and is allowed; a write primitive in a SEPARATE shell statement is the concern
    # of scan_redir/scan_verbs, not this pass.
    payload="$full"
    printf '%s' "$payload" | grep -qE "dev-memo/run/($AUTH|log\.md)" || continue
    if printf '%s' "$payload" | grep -qE "$MUT" \
       || printf '%s' "$payload" | grep -qE "$OPENMUT"; then
      set +f
      emit_deny "Run-control guard: interpreter inline-code ($vbase -e/-c) that mutates a dev-memo/run/ authority file is forbidden. Change run-control state via the workflow scripts (which name a script path, not inline code) or a deliberate human action."
    fi
  done < <(printf '%s\n' "$1" | awk '{gsub(/&&|\|\||[;|&]/, "\n"); print}')
  set +f
}

# --- pass 6: bounded indirection resolver (BRCBW-1/2) — literal cd + literal-var, context-gated ---
# Tracks, within a single command line, a literal `cd dev-memo/run` directory and standalone
# `VAR=<literal>` assignments, then resolves a write-verb operand / redirection target through them
# before the authority check. Bounded/lexical (spec §3 Mechanism B): literal RHS only (no $/$()/`);
# same line, last-assignment-wins, prior-assignments-only; subshell scope over-approximated to the
# enclosing cd (deny-safe); a BARE reserved basename is denied ONLY when a run-control cd is tracked
# (the narrow reserved-basename fallback — no global bare-basename deny). Non-goals (computed paths,
# $IFS, brace, eval, dynamic cd) are documented residuals. Strictly ADDITIVE — only adds DENYs.
ind_check() {            # ind_check <token> <cwd> <vars> <verb> <append:0|1>
  local t cwd=$2 vars=$3 verb=$4 append=${5:-0} v base was_var=0
  # BRCBW-12: cut at the first shell metacharacter BEFORE and AFTER quote-stripping, exactly as
  # tok_auth does — otherwise `rm config<foo` (under a tracked cd) and `rm "$p"<foo` (literal
  # var) kept the metacharacter inside the candidate and resolved to nothing. Both were verified
  # ALLOWs. Also applied to the resolved variable VALUE, defensively.
  cut_meta "$1"; t=$CUT
  t=${t#\"}; t=${t%\"}; t=${t#\'}; t=${t%\'}; cut_meta "$t"; t=$CUT
  case "$t" in
    '$'*) was_var=1; v=${t#\$}; v=${v#\{}; v=${v%\}}
      t=$(printf '%s\n' "$vars" | grep -E "^${v}=" 2>/dev/null | tail -1 | cut -d= -f2-)
      [ -n "$t" ] || return 0             # unresolved var -> Mechanism-C non-goal, allow
      cut_meta "$t"; t=$CUT ;;
  esac
  case "$t" in
    *dev-memo/run/*)
      # A token that is ALREADY a literal dev-memo/run/ path is handled by scan_redir/scan_verbs
      # (which correctly honour >> append + [[ ]] comparison). Only act here when it was RESOLVED
      # from a variable — otherwise return so we never re-deny a direct path (and never re-introduce
      # the log.md-append / BRCBW-7 [[ ]] false positives).
      [ "$was_var" = 1 ] || return 0
      base=${t##*/}
      if [ "$base" = "log.md" ]; then
        [ "$append" = 1 ] || { set +f; emit_deny "Run-control guard: indirected '$verb' (via variable) truncates dev-memo/run/log.md — the audit trail is append-only."; }
      else
        printf '%s' "$base" | grep -qE "^($AUTH)$" && { set +f; emit_deny "Run-control guard: indirected '$verb' resolves to dev-memo/run/$base (via variable) — governance/audit state changes only via the workflow scripts or a deliberate human action."; }
      fi ;;
    */*) : ;;                               # relative path with a dir prefix, not bare -> bound
    *) [ "$cwd" = "dev-memo/run" ] || return 0   # bare basename: deny ONLY under a tracked run-control cd
      if [ "$t" = "log.md" ]; then
        [ "$append" = 1 ] || { set +f; emit_deny "Run-control guard: '$verb $t' after 'cd dev-memo/run' truncates dev-memo/run/log.md — append-only."; }
      else
        printf '%s' "$t" | grep -qE "^($AUTH)$" && { set +f; emit_deny "Run-control guard: '$verb $t' after 'cd dev-memo/run' resolves to dev-memo/run/$t — forbidden."; }
      fi ;;
  esac
}
scan_indirection() {
  local full=$1 stmt t name val w cmd0 vbase a norm mode cwd="" vars="" onlyassign ta dest tdir has_i
  set -f
  while IFS= read -r stmt; do
    set -- $stmt
    [ $# -gt 0 ] || continue
    onlyassign=1
    for t in "$@"; do case "$t" in [A-Za-z_]*=*) ;; *) onlyassign=0; break ;; esac; done
    if [ "$onlyassign" = 1 ]; then          # standalone assignment statement -> record literal vars
      for t in "$@"; do
        name=${t%%=*}; val=${t#*=}
        case "$val" in *'$'*|*'`'*) : ;;     # computed RHS -> non-goal, not recorded
          *) val=${val#\"}; val=${val%\"}; val=${val#\'}; val=${val%\'}
             vars="${vars}
${name}=${val}" ;;
        esac
      done
      continue
    fi
    while [ $# -gt 0 ]; do                   # unwrap env-assigns + wrappers + leading "("
      w=$1; w=${w#\"}; w=${w#\'}; w=${w#\\}; w=${w#(}
      case "$w" in
        [A-Za-z_]*=*) shift ;;
        command|exec|time|env|nice|nohup|stdbuf|setsid) shift; while [ $# -gt 0 ]; do case "$1" in -*) shift ;; [A-Za-z_]*=*) shift ;; *) break ;; esac; done ;;
        '') shift ;;
        *) break ;;
      esac
    done
    [ $# -gt 0 ] || continue
    cmd0=$1; cmd0=${cmd0#\"}; cmd0=${cmd0#\'}; cmd0=${cmd0#\\}; cmd0=${cmd0#(}
    vbase=${cmd0##*/}
    shift
    case "$vbase" in
      cd) a=$1; a=${a#\"}; a=${a%\"}; a=${a#\'}; a=${a%\'}; a=${a%)}
        # BRCBW-12: the cd operand ends at the first shell metacharacter too, else
        # `cd dev-memo/run<x && rm config` never tracked the run-control cwd (verified ALLOW).
        cut_meta "$a"; a=$CUT
        case "$a" in
          dev-memo/run|dev-memo/run/|*/dev-memo/run|*/dev-memo/run/) cwd="dev-memo/run" ;;
          ''|..|../*|-|*'$'*) : ;;           # cd-up / cd- / cd"$x" / computed -> KEEP prior cwd (deny-safe)
          *) cwd="$a" ;;                     # absolute or other literal relative -> leaves run-control
        esac
        continue ;;
      rm|unlink|truncate|touch|chmod|chown|shred|mv|ln)
        for a in "$@"; do [ "$a" = "--" ] && break; a=${a%)}; ind_check "$a" "$cwd" "$vars" "$vbase" 0; done ;;
      tee)
        ta=0; for a in "$@"; do case "$a" in -a|--append) ta=1 ;; esac; done
        for a in "$@"; do case "$a" in -*) continue ;; esac; a=${a%)}; ind_check "$a" "$cwd" "$vars" "tee" "$ta"; done ;;
      cp|install|rsync)                     # destination operand (a source may be read); mirror scan_verbs
        dest=""; tdir=""
        while [ $# -gt 0 ]; do
          case "$1" in
            -t|--target-directory) shift; tdir=$1 ;;
            --target-directory=*) tdir=${1#--target-directory=} ;;
            --) shift; while [ $# -gt 0 ]; do dest=$1; shift; done; break ;;
            -*) : ;;
            *) dest=$1 ;;
          esac
          [ $# -gt 0 ] && shift
        done
        [ -n "$tdir" ] && dest=$tdir
        dest=${dest%)}; ind_check "$dest" "$cwd" "$vars" "$vbase" 0 ;;
      dd)
        for a in "$@"; do case "$a" in of=*) a=${a#of=}; a=${a%)}; ind_check "$a" "$cwd" "$vars" "dd" 0 ;; esac; done ;;
      sed|perl)                             # in-place edit (-i / -*i* / --in-place) targets
        has_i=""
        for a in "$@"; do case "$a" in --in-place|--in-place=*) has_i=1 ;; --*) : ;; -*i*) has_i=1 ;; esac; done
        if [ -n "$has_i" ]; then
          for a in "$@"; do case "$a" in -*) continue ;; esac; a=${a%)}; ind_check "$a" "$cwd" "$vars" "$vbase" 0; done
        fi ;;
    esac
    # Blank [[ ... ]] spans before redirection normalization: inside them, > is a comparison, not a
    # redirect (BRCBW-7) — the resolver's redirect scan must not treat it as a write (even under a
    # tracked cd). A redirect ATTACHED after ]] sits outside the span and is still seen.
    stmt=$(printf '%s' "$stmt" | sed -E 's/\[\[[^]]*\]\]/ /g')
    norm=$(printf '%s' "$stmt" | sed -E 's/[0-9]*>>/ __RA__ /g; s/[0-9]*>[|]/ __R__ /g; s/[0-9]*>/ __R__ /g')
    mode=""
    for t in $norm; do
      case "$mode" in
        R)  t=${t%)}; ind_check "$t" "$cwd" "$vars" "redirect" 0; mode="" ; continue ;;
        RA) t=${t%)}; ind_check "$t" "$cwd" "$vars" "redirect" 1; mode="" ; continue ;;
      esac
      case "$t" in __R__) mode=R ;; __RA__) mode=RA ;; esac
    done
  done < <(printf '%s\n' "$full" | awk '{gsub(/&&|\|\||[;|&]/, "\n"); print}')
  set +f
}

# Primary scan of the top-level command line.
scan_redir "$CMD" blank
scan_verbs "$CMD"
scan_interp "$CMD"
scan_indirection "$CMD"
# BRCBW-10 + mixed obfuscation/indirection: additive rescan over the de-obfuscated form (only when it
# differs — keeps the un-obfuscated path identical and avoids any DEOBF-mangling regression). Runs the
# full resolver too, so `cd dev-memo/r\un && rm config` (mixed) reaches the cd/var resolution.
if [ "$DEOBF" != "$CMD" ]; then
  scan_redir "$DEOBF" blank
  scan_verbs "$DEOBF"
  scan_indirection "$DEOBF"
fi
# BRCBW-12: the FLAT view (every quote character removed, no parity gate) is rescanned as well.
# Two reasons, both about not losing ground: (1) it is a strict superset of what the old
# parity heuristic produced when the counts happened to be even, so no denial that used to fire
# can stop firing because DEOBF is now quote-context-aware (e.g. `rm "dev-memo/'run'/config"`,
# where the inner quotes are data to a real shell but were stripped by the old code); (2) it
# reveals quote-obfuscated paths regardless of where the quotes sit. Additive only — it can call
# emit_deny, never turn a deny into an allow. Skipped when it adds nothing new.
if [ "$DEOBF_FLAT" != "$CMD" ] && [ "$DEOBF_FLAT" != "$DEOBF" ]; then
  scan_redir "$DEOBF_FLAT" blank
  scan_verbs "$DEOBF_FLAT"
  scan_indirection "$DEOBF_FLAT"
fi
# BRCBW-12: the NEUT view neutralises quoted/escaped `; | & ( ) < > [ ]`, which is what the
# `[[ ... ]]` blanking and the `awk`-based statement splitter get wrong (they match the whole
# string with no idea what is quoted). Rescanning it recovers the target word that a quoted
# metacharacter used to hide — `echo "[[" > dev-memo/run/config; echo "]]"` and
# `rm 'a;b' dev-memo/run/config` were both verified ALLOWs. Additive only; skipped when it adds
# nothing new.
if [ "$DEOBF_NEUT" != "$CMD" ] && [ "$DEOBF_NEUT" != "$DEOBF" ] && [ "$DEOBF_NEUT" != "$DEOBF_FLAT" ]; then
  scan_redir "$DEOBF_NEUT" blank
  scan_verbs "$DEOBF_NEUT"
  scan_indirection "$DEOBF_NEUT"
fi

# --- pass 4: command-substitution bodies, ANY nesting depth (innermost peeling) ---
# `$(...)` and `` `...` `` EXECUTE regardless of surrounding context — including inside [[ ]],
# where pass-1's [[ ]] blanking would otherwise hide a real write. A write inside a substitution
# (redirection, tee, or a write verb) is therefore a real write and must deny. The previous
# implementation extracted only NON-NESTED bodies (`[^)]*` stops at the first `)`), so a write in
# a NESTED substitution like `$(echo $(tee config))` was missed (BRCBW-8). This pass closes that
# by peeling INNERMOST substitutions layer by layer (WI-A of dev-memo/plan-brcbw-parser-depth-00.md):
#
#   1. Match every INNERMOST substitution — `$(...)` whose body has no `(`/`)`/backtick, or
#      `` `...` `` whose body has no backtick. Scan each body with scan_redir (no [[ ]] blank —
#      the body has no enclosing test) + scan_verbs.
#   2. Replace this layer with a space so the next-outer substitution becomes innermost.
#   3. Repeat until no substitution remains (bounded to MAXDEPTH as a runaway backstop).
#
# Why this is correct AND additive:
#   - Only SUBSTITUTION BODY interiors are scanned, never the surrounding tokens. So an outer
#     `[[ "$x" > config ]]` comparison (no substitution) is untouched here and stays handled by
#     the top-level scan_redir "$CMD" blank above — no BRCBW-7 regression. A `>` that is a
#     comparison OUTSIDE a substitution never enters a body, so it is never read as redirection.
#   - The top-level passes (lines 202-203) already ran, so every prior denial is emitted before
#     this pass. Peeling can only CALL emit_deny (add a denial); it never converts deny -> allow.
#   - A body that only READS a protected path (cat/grep/…) names no write verb and no redirection,
#     so it still allows.
# SCOPE LIMITS (intentional, lexical-heuristic — documented, all fail-closed or pre-existing):
#   - Escaped/single-quoted LITERAL `$(...)` (e.g. echo '$(rm config)') is quote-blind here and
#     OVER-denies. Fail-closed friction (denies a safe command), never a bypass; same behavior as
#     before this change — no false-positive change. (Spec Option 1.)
#   - A substitution body containing a literal `(` or backtick char (e.g. `$(echo "(")`) is not
#     matched by the innermost regex and is left for the next outer layer / unscanned. Esoteric;
#     does not affect any authority-write fixture. Full quoting/paren awareness needs a real lexer
#     (out of scope; would be a separate WI).
#   - Variable/`cd`-indirected targets are still BRCBW-1/2 (separate WI-B), not this pass.
MAXDEPTH=16
work=$CMD
peel=0
while [ "$peel" -lt "$MAXDEPTH" ]; do
  peel=$((peel + 1))
  subs=$(printf '%s' "$work" | grep -oE '\$\([^()`]*\)|`[^`]*`' 2>/dev/null)
  [ -n "$subs" ] || break
  while IFS= read -r s; do
    [ -n "$s" ] || continue
    body=$s; body=${body#\$\(}; body=${body%\)}; body=${body#\`}; body=${body%\`}
    printf '%s' "$body" | grep -qE 'dev-memo/run' || continue   # no trailing slash: catch `cd dev-memo/run` bodies
    scan_redir "$body" ""
    scan_verbs "$body"
    scan_indirection "$body"
  done <<SUBS_EOF
$subs
SUBS_EOF
  # Remove this innermost layer so the next-outer substitution becomes innermost next iteration.
  work=$(printf '%s' "$work" | sed -E 's/\$\([^()`]*\)/ /g; s/`[^`]*`/ /g')
done

# --- pass 4b: fail-closed backstop for substitutions the peeler could not fully resolve ---
# Two residual cases leave an UNRESOLVED `$(`/backtick in $work after the loop, each a real
# under-denial if allowed (found by cc-suite audit audit-mpxebdwd-4vuouz + verifies
# verify-mpxehbp8 / verify-mpxelds9, all High):
#   1. nesting deeper than MAXDEPTH — peeling stops before reaching an outer body that writes
#      (e.g. >16 inner read-only subs wrapping `… > dev-memo/run/config`);
#   2. a body containing a literal `(`, `)`, or backtick the innermost regex cannot classify
#      (e.g. `$(printf "("; rm dev-memo/run/config)`), so that layer is never peeled or scanned.
# In both, the top-level pass-1 [[ ]] blank can hide the write. Earlier attempts gated this on a
# write-INDICATOR allow-list (redirection / specific write verbs); the verifies kept finding write
# vectors the list missed (`;rm` with no space, `sed -n -i`, `sed --in-place`, `perl -0pi`, …).
# Chasing that tail is a losing game. So adopt the SAME posture pass-0 already uses for an
# unparseable command: if an unresolved command substitution REMAINS and it references a protected
# authority file (the AUTH set or log.md), the peeler could not prove what it does — refuse to
# guess and DENY. This closes the whole class rather than enumerating verbs.
# Cost: a read-only substitution that happens to contain a literal paren/backtick AND names a
# protected file (e.g. `$(printf "("; cat dev-memo/run/config)`) also denies. That is a fail-closed
# OVER-denial of a pathological, rarely-written command — acceptable per the spec (over-denials are
# friction, not bypass) and consistent with pass-0. Fully-resolved commands (no residual `$(`) are
# untouched: the BRCBW-7 comparison cases and all normally-nested read cases peel cleanly and still
# allow. This is fail-closed — it can only ADD a denial.
if printf '%s' "$work" | grep -qE '\$\(|`'; then
  if printf '%s' "$work" | grep -qE "dev-memo/run/($AUTH|log\.md)"; then
    emit_deny "Run-control guard: a command substitution referencing a protected dev-memo/run/ file could not be fully parsed (nested beyond the peel limit, or a body with a literal paren/backtick), so a hidden write cannot be ruled out. Denying as a precaution (fail-closed). Simplify the command, or change run-control state via the workflow scripts or a deliberate human action."
  fi
fi

exit 0
