#!/bin/bash
# block-run-control-bash-write.sh — PreToolUse(Bash) hook.
# Denies DIRECT Bash writes to the dev-memo/run/ AUTHORITY/STATE files (governance + audit
# state), closing the High-severity tamper path that protect-run-control.sh leaves open:
# that hook covers Write|Edit|MultiEdit but NOT Bash, so `echo X > dev-memo/run/config`,
# `tee dev-memo/run/queue.governed`, `ln dev-memo/run/human.ack ...`, `sed -i ... config`,
# `rm dev-memo/run/queue.reviewed`, etc. can forge governance/override/audit state and bypass
# batch-commit-guard.sh. Evidence: dev-memo/hook-audit-canary-01.md (BASH-WRITE-BYPASS, High).
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
# Fails SAFE: an unparseable command that appears to write into dev-memo/run/ is denied.
# BSD/macOS-portable: no GNU-only regex idioms (see dev-memo/hook-audit-canary-01.md).
# This hook is conservative — a write verb co-occurring with an authority path is denied even
# if that path is only a read source; the legitimate workflow scripts never name state files
# directly, so they are unaffected.

INPUT=$(cat)

emit_deny() {
  esc=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$esc"
  exit 0
}

# --- parse .tool_input.command (jq preferred; portable fallback) ---
if command -v jq >/dev/null 2>&1; then
  CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  CMD=$(printf '%s' "$INPUT" | tr -d '\n' | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -1 | sed -E 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')
fi

# Authority/state basenames. Keep in sync with protect-run-control.sh.
AUTH='config|batch-start|last-batch-audit|queue\.governed|queue\.linted|queue\.reviewed|risk\.flag|human\.ack|human\.override|override-reason\.md|forbidden-paths\.txt'

# --- fast exit / fail-safe when nothing references dev-memo/run/ ---
if [ -z "$CMD" ]; then
  # No parsed command. If the raw payload looks like it writes into run/, fail safe.
  if printf '%s' "$INPUT" | grep -qE 'dev-memo/run/' \
     && printf '%s' "$INPUT" | grep -qE '(>|tee|sed[[:space:]]+-i|[[:space:]](cp|mv|ln|rm|unlink|install|truncate|dd)[[:space:]])'; then
    emit_deny "Run-control guard: could not parse a Bash command that appears to write into dev-memo/run/; denying as a precaution. Re-issue an explicit, parseable command."
  fi
  exit 0
fi
printf '%s' "$CMD" | grep -qE 'dev-memo/run/' || exit 0

# --- helpers --- token classifiers: does a single (quote-stripped) token name an authority file?
tok_auth()  { local t=$1; t=${t#\"}; t=${t%\"}; t=${t#\'}; t=${t%\'}
  case "$t" in *dev-memo/run/*) printf '%s' "${t##*/}" | grep -qE "^($AUTH)$" ;; *) return 1 ;; esac; }
tok_logmd() { local t=$1; t=${t#\"}; t=${t%\"}; t=${t#\'}; t=${t%\'}
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
      t=${t#\"}; t=${t%\"}; t=${t#\'}; t=${t%\'}   # strip one layer of surrounding quotes
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

# Primary scan of the top-level command line.
scan_redir "$CMD" blank
scan_verbs "$CMD"

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
    printf '%s' "$body" | grep -qE 'dev-memo/run/' || continue
    scan_redir "$body" ""
    scan_verbs "$body"
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
