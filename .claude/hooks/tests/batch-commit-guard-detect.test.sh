#!/bin/bash
# batch-commit-guard-detect.test.sh — git-commit DETECTION spec for batch-commit-guard.sh.
#
# Covers the bypasses in cc-suite audit job audit-mpuesqmt-4zzpxr (WI-SCAFFOLD-004 scope):
#   - command word with a path:        /usr/bin/git commit
#   - git global options before commit: git -c k=v commit , git --no-pager commit
#   - leading env assignment:           FOO=bar git commit
#   - MULTIPLE commits in one Bash call: git commit && git commit  (one decision != many commits)
# And confirms non-commits / quoted mentions are NOT treated as commits.
#
# Method: a temp repo C0..C4 with batch-start chosen so a DETECTED single commit is audit-due
# (DENY). A bypass form that used to slip past detection (and silently commit) must now DENY.
# Run: bash .claude/hooks/tests/batch-commit-guard-detect.test.sh   (exit 0 = all pass)

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; HOOK="$HERE/../batch-commit-guard.sh"
T=$(mktemp -d 2>/dev/null || mktemp -d -t bcgdet); trap 'rm -rf "$T"' EXIT
git -C "$T" init -q; git -C "$T" config user.email t@t >/dev/null; git -C "$T" config user.name t >/dev/null
declare -a C; for i in 0 1 2 3 4; do echo "$i">"$T/f$i"; git -C "$T" add "f$i"; git -C "$T" commit -qm "C$i"; C[$i]=$(git -C "$T" rev-parse HEAD); done
mkdir -p "$T/dev-memo/run"
# BCG-6: a governed queue must be CONTENT-BOUND. Provide a queue.md + a queue.governed carrying its
# matching sha256 so these DETECTION cases (about commit-counting, not governance binding) reach the
# count logic instead of tripping the new content-hash check. Setup-only; no assertion changes.
t_sha256() {
  local f=$1 h=""
  if command -v shasum >/dev/null 2>&1; then h=$(shasum -a 256 "$f" 2>/dev/null | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then h=$(sha256sum "$f" 2>/dev/null | awk '{print $1}')
  elif command -v openssl >/dev/null 2>&1; then h=$(openssl dgst -sha256 "$f" 2>/dev/null | awk '{print $NF}')
  fi
  printf '%s' "$h"
}
printf 'detect-spec governed queue body\n' > "$T/dev-memo/run/queue.md"
printf 'governed=lint+review t\nqueue_sha256=%s\n' "$(t_sha256 "$T/dev-memo/run/queue.md")" > "$T/dev-memo/run/queue.governed"
pass=0; fail=0; failed=""

# run <command> <batch-start> <max> <every>
run() {
  printf 'AUTO_ADVANCE_MAX=%s\nBATCH_AUDIT_EVERY=%s\n' "$3" "$4" > "$T/dev-memo/run/config"
  rm -f "$T/dev-memo/run/last-batch-audit"; printf '%s\n' "$2" > "$T/dev-memo/run/batch-start"
  local out; out=$(printf '%s' "$1" | python3 -c "import json,sys; print(json.dumps({'tool_input':{'command':sys.stdin.read()}}))" | CLAUDE_PROJECT_DIR="$T" bash "$HOOK" 2>/dev/null)
  case "$out" in *'"permissionDecision":"deny"'*) printf DENY ;; *) printf ALLOW ;; esac
}
expect() { local want="$1" label="$2" got; got=$(run "$3" "$4" "$5" "$6"); if [ "$got" = "$want" ]; then pass=$((pass+1)); else fail=$((fail+1)); failed="$failed\n  [want $want got $got] $label :: $3"; fi; }

# --- audit-due window (batch-start=C0 -> count 4 >= every 3): a DETECTED commit must DENY ---
BS0="${C[0]}"
expect DENY  "normal git commit detected"        "git commit -m x"            "$BS0" 10 3
expect DENY  "absolute path /usr/bin/git"        "/usr/bin/git commit -m x"   "$BS0" 10 3
expect DENY  "global -c option"                  "git -c user.name=x commit"  "$BS0" 10 3
expect DENY  "global --no-pager"                 "git --no-pager commit -m x" "$BS0" 10 3
expect DENY  "leading env assignment"            "FOO=bar git commit -m x"    "$BS0" 10 3
expect DENY  "multiple -c options"               "git -c a=b -c c=d commit"   "$BS0" 10 3

# --- command-prefix wrappers (WI-SCAFFOLD-004 scope-extension; audit-mpufm338-2gtelo #1) ---
expect DENY  "backslash-escaped \\git"           '\git commit -m x'           "$BS0" 10 3
expect DENY  "command wrapper"                   "command git commit -m x"    "$BS0" 10 3
expect DENY  "exec wrapper"                      "exec git commit -m x"       "$BS0" 10 3
expect DENY  "time wrapper"                      "time git commit -m x"       "$BS0" 10 3
expect DENY  "env with assignment"              "env FOO=bar git commit"      "$BS0" 10 3
expect DENY  "env -i with assignment"           "env -i FOO=bar git commit -m x" "$BS0" 10 3
expect DENY  "nohup wrapper"                     "nohup git commit -m x"      "$BS0" 10 3
# wrappers in front of a NON-git command must still ALLOW (not falsely gated)
expect ALLOW "command ls (non-git)"             "command ls -la"             "$BS0" 10 3
expect ALLOW "nohup ls (non-git)"               "nohup ls"                   "$BS0" 10 3
expect ALLOW "time echo (non-git)"              "time echo hi"               "$BS0" 10 3

# --- non-commits / quoted mentions must NOT be treated as a commit (guard exits 0 -> ALLOW) ---
expect ALLOW "git status (not commit)"           "git status"                 "$BS0" 10 3
expect ALLOW "git log --grep commit"             "git log --grep commit"      "$BS0" 10 3
expect ALLOW "git config commit.x"               "git config commit.gpgsign false" "$BS0" 10 3
expect ALLOW "echo mentioning git commit"        'echo "git commit"'          "$BS0" 10 3
expect ALLOW "plain ls"                          "ls -la"                     "$BS0" 10 3

# --- MULTIPLE commits in one call: DENY regardless of window (even a clean one) ---
BS4="${C[4]}"   # batch-start=HEAD -> count 0, a single commit would ALLOW
expect DENY  "two commits via &&"                "git commit -m a && git commit -m b" "$BS4" 10 3
expect DENY  "two commits via ;"                 "git commit -m a ; git commit -m b"  "$BS4" 10 3
expect DENY  "path + global on 2nd commit"       "git commit -m a && /usr/bin/git -c x=y commit" "$BS4" 10 3

# --- single commit in a clean window ALLOWS; && inside a quoted message is NOT two commits ---
expect ALLOW "single commit, clean window"       "git commit -m x"            "$BS4" 10 3
expect ALLOW "&& inside quoted message = 1"      'git commit -m "a && b"'     "$BS4" 10 3

# --- BCG-9: quote-aware counting. A separator + the literal text "git commit" INSIDE a quoted
# message must NOT be counted as a second commit (the old global split over-DENIED these). ---
expect ALLOW "; + 'git commit' in dquote msg = 1" 'git commit -m "revert; git commit was wrong"' "$BS4" 10 3
expect ALLOW "| + 'git commit' in dquote msg = 1" 'git commit -m "use | not && ; git commit"'    "$BS4" 10 3
expect ALLOW "& + 'git commit' in dquote msg = 1" 'git commit -m "fix & also git commit later"'  "$BS4" 10 3
expect ALLOW "; in single-quoted message = 1"     "git commit -m 'revert; git commit was wrong'"  "$BS4" 10 3
expect ALLOW "| in single-quoted message = 1"     "git commit -m 'a | b ; git commit'"            "$BS4" 10 3
expect ALLOW "separators-only quoted msg = 1"     'git commit -m "a; b | c & d"'                  "$BS4" 10 3
# real chained commands OUTSIDE quotes still DENY (separators not inside any quote)
expect DENY  "chained after quoted msg still 2"   'git commit -m "msg" && git commit -m "msg2"'   "$BS4" 10 3
expect DENY  "quoted msg then ; real commit = 2"  'git commit -m "a; b" ; git commit -m "c"'      "$BS4" 10 3
expect DENY  "quoted msg then | real commit = 2"  'git commit -m "a | b" | git commit -m "c"'     "$BS4" 10 3
# unbalanced quote -> fall back to over-deny (never under-count a real chain)
expect DENY  "unbalanced quote + real && = 2"     'git commit -m "oops && git commit -m x'        "$BS4" 10 3

# --- divergent batch-start/last-batch-audit: selection path executes coherently (finding #4) ---
# Defensive branch, not reached in linear history. The rev-list-FAILURE deny inside it cannot be
# unit-forced with valid refs (same as the final-count deny) -> covered by code inspection +
# symmetry; here we assert the SELECTION path runs and the chosen count is actually used.
CUR=$(git -C "$T" rev-parse --abbrev-ref HEAD)
git -C "$T" checkout -q -b side "${C[2]}"
echo d1 > "$T/d1"; git -C "$T" add d1; git -C "$T" commit -qm D1
echo d2 > "$T/d2"; git -C "$T" add d2; git -C "$T" commit -qm D2
DSIDE=$(git -C "$T" rev-parse HEAD)
git -C "$T" checkout -q "$CUR"                          # HEAD back on the C-line tip (C4)
printf '%s\n' "${C[4]}" > "$T/dev-memo/run/batch-start"  # count 0
printf '%s\n' "$DSIDE"  > "$T/dev-memo/run/last-batch-audit"  # divergent; count C3,C4 = 2
divrun() { printf 'AUTO_ADVANCE_MAX=10\nBATCH_AUDIT_EVERY=%s\n' "$1" > "$T/dev-memo/run/config"
  local o; o=$(printf '{"tool_input":{"command":"git commit -m x"}}' | CLAUDE_PROJECT_DIR="$T" bash "$HOOK" 2>/dev/null)
  case "$o" in *'"permissionDecision":"deny"'*) printf DENY ;; *) printf ALLOW ;; esac; }
g=$(divrun 3); [ "$g" = ALLOW ] && pass=$((pass+1)) || { fail=$((fail+1)); failed="$failed\n  [divergent every=3 want ALLOW got $g]"; }
g=$(divrun 2); [ "$g" = DENY ]  && pass=$((pass+1)) || { fail=$((fail+1)); failed="$failed\n  [divergent every=2 want DENY got $g]"; }

printf 'batch-commit-guard-detect: %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then printf 'FAILED:%b\n' "$failed"; exit 1; fi
echo "ALL PASS"; exit 0
