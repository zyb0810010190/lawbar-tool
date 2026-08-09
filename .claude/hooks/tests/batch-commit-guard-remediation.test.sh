#!/bin/bash
# batch-commit-guard-remediation.test.sh — spec for the REMEDIATION LANE in batch-commit-guard.sh
# (WI-BATCH-REMEDIATION-LANE-00, plan dev-memo/plan-batch-remediation-lane-00.md).
#
# The lane exists because BATCH-AUDIT.md requires a FAILED batch audit's finding to be RESOLVED,
# batch-closeout.mjs refuses to carry a Medium+, and the audit-DUE deny blocks the very commit that
# resolves it. The lane permits ONE path-scoped commit authorized by dev-memo/run/remediation.authorized
# — an artifact the agent cannot create. It must be strictly NARROWER than human.override.
#
# Covers all 9 plan acceptance criteria (labelled AC1..AC9 below) plus the fail-closed edges:
#   AC1 FAILED audit + no artifact                 -> DENY (today's behaviour preserved byte-for-byte)
#   AC2 valid artifact, staged set within paths    -> ALLOW
#   AC3 valid artifact, ANY staged path outside    -> DENY (and the token is NOT spent)
#   AC4 artifact naming a non-FAIL job             -> DENY
#   AC5 range_base != current marker               -> DENY
#   AC6 consumed on use; a second commit           -> DENY
#   AC7 marker NOT advanced; commits stay blocked  -> marker unchanged + next commit DENY
#   AC8 merely-DUE audit (no FAIL recorded)        -> DENY  (the user's §8 answer: FAILED only)
#   AC9 every pre-existing guard behaviour intact  -> risk flag / governed / hash / sentinel /
#                                                      breaker / clean-window all still decide
# Agent-cannot-create (plan AC8's write-side) is asserted by protect-run-control.test.sh,
# runcontrol-canon.test.mjs and block-run-control-bash-write.test.sh, which enumerate the artifact.
#
# Run: bash .claude/hooks/tests/batch-commit-guard-remediation.test.sh   (exit 0 = all pass)

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../batch-commit-guard.sh"
# The hook's shebang is #!/bin/bash, which on macOS is bash 3.2 — the interpreter that actually runs
# it in production. Re-run this suite with BCG_TEST_BASH=/bin/bash to prove 3.2 compatibility.
GBASH=${BCG_TEST_BASH:-bash}

T=$(mktemp -d 2>/dev/null || mktemp -d -t bcgrem)
trap 'rm -rf "$T"' EXIT

git -C "$T" init -q
git -C "$T" config user.email t@t >/dev/null
git -C "$T" config user.name  t   >/dev/null
mkdir -p "$T/src" "$T/other"
declare -a C
for i in 0 1 2 3 4; do
  echo "$i" > "$T/f$i"; git -C "$T" add "f$i"; git -C "$T" commit -qm "C$i"
  C[$i]=$(git -C "$T" rev-parse HEAD)
done
# Two tracked files the remediation commit can stage.
echo base > "$T/src/fix.txt"; echo base > "$T/other/unrelated.txt"
git -C "$T" add src/fix.txt other/unrelated.txt; git -C "$T" commit -qm "C5 fixtures"
C[5]=$(git -C "$T" rev-parse HEAD)
HEADSHA=${C[5]}
# Window: batch-start = last-batch-audit = C0 -> BASE=C0, COUNT=5 >= EVERY=3 -> audit window CLOSED.
BASE=${C[0]}

RUNDIR="$T/dev-memo/run"; mkdir -p "$RUNDIR"
HOMEDIR="$T/home"
SLUG=$(basename "$T")
STATE="$HOMEDIR/.claude/plugins/data/cc-suite-xiaolai/state/$SLUG-deadbeef/jobs"
mkdir -p "$STATE"

t_sha256() { # t_sha256 <file>  (mirrors the guard's resolution order)
  local f=$1 h=""
  if command -v shasum >/dev/null 2>&1; then h=$(shasum -a 256 "$f" 2>/dev/null | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then h=$(sha256sum "$f" 2>/dev/null | awk '{print $1}')
  elif command -v openssl >/dev/null 2>&1; then h=$(openssl dgst -sha256 "$f" 2>/dev/null | awk '{print $NF}')
  fi
  printf '%s' "$h"
}
printf 'remediation-spec governed queue body\n' > "$RUNDIR/queue.md"
printf 'governed=lint+review t\nqueue_sha256=%s\n' "$(t_sha256 "$RUNDIR/queue.md")" > "$RUNDIR/queue.governed"

pass=0; fail=0; failed=""
chk() { # chk <label> <want> <got>
  if [ "$3" = "$2" ]; then pass=$((pass+1)); else fail=$((fail+1)); failed="$failed\n  [$1] want '$2' got '$3'"; fi
}

# --- fixture builders -------------------------------------------------------------------------
# mkjob <jobid> <range-line> <verdict-line> -> echoes the sha256 of the job's rawOutput bytes.
mkjob() {
  local id=$1 rangeline=$2 verdictline=$3 raw="$T/.raw.$1.txt"
  { printf 'Batch audit over the window.\n'
    [ -n "$rangeline" ]   && printf '%s\n' "$rangeline"
    [ -n "$verdictline" ] && printf '%s\n' "$verdictline"
    printf 'M1 privacy-gate bypass in the renderer.\n'; } > "$raw"
  python3 - "$raw" "$STATE/$id.json" <<'PY'
import json, sys
raw = open(sys.argv[1], encoding="utf-8").read()
json.dump({"rawOutput": raw, "threadId": "thread-x"}, open(sys.argv[2], "w", encoding="utf-8"))
PY
  t_sha256 "$raw"
}
# mkart <k=v>... -> writes dev-memo/run/remediation.authorized from explicit lines.
mkart() { : > "$RUNDIR/remediation.authorized"; for l in "$@"; do printf '%s\n' "$l" >> "$RUNDIR/remediation.authorized"; done; }
# stage <path>... -> index = HEAD tree, then stage exactly these paths (working tree dirtied first).
stage() {
  git -C "$T" read-tree HEAD
  local p
  for p in "$@"; do printf 'edited %s\n' "$(date +%s%N 2>/dev/null || date +%s)" > "$T/$p"; git -C "$T" add -- "$p"; done
}
setwin() { # setwin <batch-start> <marker> [max] [every]
  printf 'AUTO_ADVANCE_MAX=%s\nBATCH_AUDIT_EVERY=%s\n' "${3:-10}" "${4:-3}" > "$RUNDIR/config"
  printf '%s\n' "$1" > "$RUNDIR/batch-start"
  printf '%s\n' "$2" > "$RUNDIR/last-batch-audit"
}
# runhook [command] -> DENY|ALLOW. The decision JSON is written to a FILE (not a shell variable):
# runhook is called inside $( ), so any variable it set would be lost with the subshell.
runhook() {
  local cmd=${1:-"git commit -m fix"} out
  printf '%s' "$cmd" \
    | python3 -c "import json,sys; print(json.dumps({'tool_input':{'command':sys.stdin.read()}}))" \
    | CLAUDE_PROJECT_DIR="$T" HOME="$HOMEDIR" "$GBASH" "$HOOK" > "$T/.last.json" 2>/dev/null
  out=$(cat "$T/.last.json" 2>/dev/null)
  case "$out" in *'"permissionDecision":"deny"'*) printf DENY ;; *) printf ALLOW ;; esac
}
tokenstate() { [ -f "$RUNDIR/remediation.authorized" ] && printf present || printf absent; }
logcount() { local n; n=$(grep -c 'remediation consumed' "$RUNDIR/log.md" 2>/dev/null); printf '%s' "${n:-0}"; }
reasonhas() { case "$(cat "$T/.last.json" 2>/dev/null)" in *"$1"*) printf yes ;; *) printf no ;; esac; }

: > "$RUNDIR/log.md"
GOODSHA=$(mkjob audit-remgood "AUDIT-RANGE: $BASE..$HEADSHA" "AUDIT-VERDICT: BATCH-FAIL C0 H0 M1 L1")

# good_art [extra-allowed-path] -> the canonical VALID artifact
good_art() {
  mkart "# remediation-authorization v1" \
        "range_base=$BASE" \
        "audit_head=$HEADSHA" \
        "broker_job_id=audit-remgood" \
        "broker_output_sha256=$GOODSHA" \
        "finding_ids=M1, L1" \
        "reason=fix the privacy-gate bypass found by the failing batch audit" \
        "allowed_path=src/fix.txt" \
        ${1:+"allowed_path=$1"}
}

# ==============================================================================================
# AC1 — FAILED audit + NO artifact -> DENY (the pre-existing audit-DUE behaviour, unchanged)
# ==============================================================================================
setwin "$BASE" "$BASE"; rm -f "$RUNDIR/remediation.authorized"; stage src/fix.txt
chk "AC1 FAILED audit, no artifact -> deny" DENY "$(runhook)"
chk "AC1 denies as audit-DUE (not a lane error)" yes "$(reasonhas 'batch audit DUE')"

# ==============================================================================================
# AC2 / AC6 / AC7 — the happy path: allow, consume, log, and DO NOT advance the marker
# ==============================================================================================
setwin "$BASE" "$BASE"; good_art; stage src/fix.txt
MARKER_BEFORE=$(cat "$RUNDIR/last-batch-audit")
chk "AC2 valid artifact + in-scope staged set -> allow" ALLOW "$(runhook)"
chk "AC6 token consumed on use"                         absent "$(tokenstate)"
chk "AC6 consumption logged exactly once"               1      "$(logcount)"
chk "AC7 marker NOT advanced by a remediation commit"   "$MARKER_BEFORE" "$(cat "$RUNDIR/last-batch-audit")"
# AC6 second half: the SAME (now consumed) authorization cannot authorize a second commit.
chk "AC6 second commit on the spent token -> deny"      DENY "$(runhook)"
chk "AC6 second commit denies as audit-DUE"             yes  "$(reasonhas 'batch audit DUE')"
# AC7 second half: after the remediation commit lands, normal commits are STILL blocked until a
# follow-up audit over range_base..<new head> passes and the closeout advances the marker.
git -C "$T" read-tree HEAD; printf 'remediated\n' > "$T/src/fix.txt"
git -C "$T" add src/fix.txt; git -C "$T" commit -qm "remediation commit"
REMHEAD=$(git -C "$T" rev-parse HEAD)
chk "AC7 next normal commit still blocked"              DENY "$(runhook)"
chk "AC7 marker still at the pre-remediation window"    "$MARKER_BEFORE" "$(cat "$RUNDIR/last-batch-audit")"
# A follow-up FAIL audit over the SAME range_base but the NEW head keeps the lane usable (the
# audit_head only needs to be an ancestor-or-equal of HEAD), proving the lane is not one-shot-only
# by accident — it is one-shot per human-authored artifact.
NEWSHA=$(mkjob audit-remgood2 "AUDIT-RANGE: $BASE..$REMHEAD" "AUDIT-VERDICT: BATCH-FAIL C0 H0 M1 L0")
mkart "range_base=$BASE" "audit_head=$REMHEAD" "broker_job_id=audit-remgood2" \
      "broker_output_sha256=$NEWSHA" "finding_ids=M1" "reason=second remediation round" \
      "allowed_path=src/fix.txt"
stage src/fix.txt
chk "AC6 a NEW human artifact authorizes again"         ALLOW "$(runhook)"
chk "AC6 second token consumed too"                     absent "$(tokenstate)"
chk "AC6 two consumptions logged"                       2      "$(logcount)"
HEADSHA=$REMHEAD   # subsequent cases run against the post-remediation head
GOODSHA=$(mkjob audit-remgood "AUDIT-RANGE: $BASE..$HEADSHA" "AUDIT-VERDICT: BATCH-FAIL C0 H0 M1 L1")
PASSSHA=$(mkjob audit-rempass "AUDIT-RANGE: $BASE..$HEADSHA" "AUDIT-VERDICT: BATCH-PASS C0 H0 M0 L0")
NOVSHA=$(mkjob  audit-remnov  "AUDIT-RANGE: $BASE..$HEADSHA" "")
# A FAIL audit whose declared range starts at C1 (used for the marker/window-binding cases).
BADRSHA=$(mkjob audit-rembadr "AUDIT-RANGE: ${C[1]}..$HEADSHA" "AUDIT-VERDICT: BATCH-FAIL C0 H0 M1 L0")

# deny_case <label> <artifact-setup-fn-or-":"> <command> <reason-substring>
# Asserts DENY, that the token was NOT spent, and that the denial cites the expected cause.
deny_case() {
  local label=$1 cmd=$2 want=$3 got
  got=$(runhook "$cmd")
  chk "$label -> deny" DENY "$got"
  chk "$label keeps the token unspent" present "$(tokenstate)"
  chk "$label denies for the right reason" yes "$(reasonhas "$want")"
  rm -f "$RUNDIR/remediation.authorized"
}

# ==============================================================================================
# AC3 — path scoping: ANY staged path outside allowed_path is a DENY
# ==============================================================================================
setwin "$BASE" "$BASE"; good_art; stage src/fix.txt other/unrelated.txt
deny_case "AC3 staged path outside allowed_path" "git commit -m fix" "OUTSIDE the artifact's allowed_path set"
# only the out-of-scope file staged
good_art; stage other/unrelated.txt
deny_case "AC3 wholly out-of-scope staged set" "git commit -m fix" "OUTSIDE the artifact's allowed_path set"
# empty staged set cannot be proved in-scope
good_art; git -C "$T" read-tree HEAD
deny_case "AC3 empty staged set" "git commit -m fix" "staged file set is EMPTY"
# directory scope: a trailing slash is a prefix, a bare name is an EXACT file match only
mkart "range_base=$BASE" "audit_head=$HEADSHA" "broker_job_id=audit-remgood" \
      "broker_output_sha256=$GOODSHA" "finding_ids=M1" "reason=dir scope" "allowed_path=src/"
stage src/fix.txt
chk "AC3 'src/' directory scope covers src/fix.txt" ALLOW "$(runhook)"
mkart "range_base=$BASE" "audit_head=$HEADSHA" "broker_job_id=audit-remgood" \
      "broker_output_sha256=$GOODSHA" "finding_ids=M1" "reason=bare dir" "allowed_path=src"
stage src/fix.txt
deny_case "AC3 bare 'src' does NOT cover src/fix.txt" "git commit -m fix" "OUTSIDE the artifact's allowed_path set"

# ==============================================================================================
# AC4 / AC8 — only a FAILED audit opens the lane
# ==============================================================================================
art_job() { # art_job <jobid> <sha>
  mkart "range_base=$BASE" "audit_head=$HEADSHA" "broker_job_id=$1" "broker_output_sha256=$2" \
        "finding_ids=M1" "reason=r" "allowed_path=src/fix.txt"
}
setwin "$BASE" "$BASE"
art_job audit-rempass "$PASSSHA"; stage src/fix.txt
deny_case "AC4 job verdict is BATCH-PASS" "git commit -m fix" "BATCH-PASS"
art_job audit-remnov "$NOVSHA"; stage src/fix.txt
deny_case "AC4 job has no AUDIT-VERDICT line" "git commit -m fix" "does not declare 'AUDIT-VERDICT: BATCH-FAIL"
# AC8 (the user's §8 answer): a merely-DUE window — the audit was never RUN, so no broker job
# exists — must NOT be unblocked, even with a well-formed artifact.
art_job audit-remabsent "$GOODSHA"; stage src/fix.txt
deny_case "AC8 merely-DUE (audit never ran)" "git commit -m fix" "merely DUE, not FAILED"
# job artifact present but recording a broker error (no verdict at all)
python3 -c "
import json,sys
json.dump({'error':'spawnSync codex ETIMEDOUT'}, open('$STATE/audit-remerr.json','w'))"
art_job audit-remerr "$GOODSHA"; stage src/fix.txt
deny_case "AC8 broker job errored (no verdict)" "git commit -m fix" "did not complete"

# ==============================================================================================
# AC5 — window binding: range_base, audit_head, and the broker range must all agree
# ==============================================================================================
setwin "$BASE" "$BASE"
mkart "range_base=${C[1]}" "audit_head=$HEADSHA" "broker_job_id=audit-rembadr" \
      "broker_output_sha256=$BADRSHA" "finding_ids=M1" "reason=r" "allowed_path=src/fix.txt"
stage src/fix.txt
deny_case "AC5 range_base != current marker" "git commit -m fix" "!= the current batch-audit marker"
# marker moved forward but batch-start is older: range_base must equal the LIVE base too, so a
# stale FAIL from an older window cannot authorize work in the live one.
setwin "${C[0]}" "${C[1]}"
mkart "range_base=${C[1]}" "audit_head=$HEADSHA" "broker_job_id=audit-rembadr" \
      "broker_output_sha256=$BADRSHA" "finding_ids=M1" "reason=r" "allowed_path=src/fix.txt"
stage src/fix.txt
chk "AC5 marker==range_base and marker is the live base -> lane opens" ALLOW "$(runhook)"
setwin "${C[3]}" "${C[1]}"     # batch-start C3 is NEWER than marker C1 -> live BASE = C3 != C1
mkart "range_base=${C[1]}" "audit_head=$HEADSHA" "broker_job_id=audit-rembadr" \
      "broker_output_sha256=$BADRSHA" "finding_ids=M1" "reason=r" "allowed_path=src/fix.txt"
stage src/fix.txt
deny_case "AC5 stale window (marker older than batch-start)" "git commit -m fix" "!= the live window BASE"
setwin "$BASE" "$BASE"
# broker output declaring a DIFFERENT range than the artifact claims
mkart "range_base=$BASE" "audit_head=$HEADSHA" "broker_job_id=audit-rembadr" \
      "broker_output_sha256=$BADRSHA" "finding_ids=M1" "reason=r" "allowed_path=src/fix.txt"
stage src/fix.txt
deny_case "AC5 broker AUDIT-RANGE != artifact range" "git commit -m fix" "does not declare 'AUDIT-RANGE"
# broker_output_sha256 that does not hash the cited job's rawOutput
mkart "range_base=$BASE" "audit_head=$HEADSHA" "broker_job_id=audit-remgood" \
      "broker_output_sha256=$(printf 'a%.0s' $(seq 1 64))" "finding_ids=M1" "reason=r" "allowed_path=src/fix.txt"
stage src/fix.txt
deny_case "AC5 broker output hash mismatch" "git commit -m fix" "!= the artifact's broker_output_sha256"
# audit_head not an ancestor of HEAD (a side-branch commit). Built with commit-tree so it touches
# neither HEAD, the index, nor the working tree (a branch checkout would fight the staged fixture).
SIDE=$(git -C "$T" commit-tree "$(git -C "$T" rev-parse "${C[2]}^{tree}")" -p "${C[2]}" -m S1)
SIDESHA=$(mkjob audit-remside "AUDIT-RANGE: $BASE..$SIDE" "AUDIT-VERDICT: BATCH-FAIL C0 H0 M1 L0")
mkart "range_base=$BASE" "audit_head=$SIDE" "broker_job_id=audit-remside" \
      "broker_output_sha256=$SIDESHA" "finding_ids=M1" "reason=r" "allowed_path=src/fix.txt"
stage src/fix.txt
deny_case "AC5 audit_head not an ancestor of HEAD" "git commit -m fix" "not an ancestor of the current HEAD"

# ==============================================================================================
# Artifact well-formedness — strict parse, fail-closed on anything unexpected
# ==============================================================================================
setwin "$BASE" "$BASE"; stage src/fix.txt
mkart "range_base=$BASE" "audit_head=$HEADSHA" "broker_job_id=audit-remgood" \
      "broker_output_sha256=$GOODSHA" "finding_ids=M1" "reason=r"
deny_case "artifact with no allowed_path" "git commit -m fix" "declares no allowed_path"
mkart "range_base=$BASE" "audit_head=$HEADSHA" "broker_job_id=audit-remgood" \
      "broker_output_sha256=$GOODSHA" "reason=r" "allowed_path=src/fix.txt"
deny_case "artifact missing finding_ids" "git commit -m fix" "must appear EXACTLY once"
mkart "range_base=$BASE" "range_base=$BASE" "audit_head=$HEADSHA" "broker_job_id=audit-remgood" \
      "broker_output_sha256=$GOODSHA" "finding_ids=M1" "reason=r" "allowed_path=src/fix.txt"
deny_case "artifact with a duplicated key" "git commit -m fix" "must appear EXACTLY once"
mkart "range_base=$BASE" "audit_head=$HEADSHA" "broker_job_id=audit-remgood" \
      "broker_output_sha256=$GOODSHA" "finding_ids=M1" "reason=r" "allowed_path=src/fix.txt" "bypass_all=yes"
deny_case "artifact with an unknown key" "git commit -m fix" "unknown artifact key"
mkart "range_base=$BASE" "audit_head=$HEADSHA" "broker_job_id=audit-remgood" \
      "broker_output_sha256=$GOODSHA" "finding_ids=M1" "reason=" "allowed_path=src/fix.txt"
deny_case "artifact with an empty reason" "git commit -m fix" "reason is empty"
mkart "range_base=$BASE" "audit_head=$HEADSHA" "broker_job_id=../../../etc/passwd" \
      "broker_output_sha256=$GOODSHA" "finding_ids=M1" "reason=r" "allowed_path=src/fix.txt"
deny_case "artifact with a traversal job id" "git commit -m fix" "not a well-formed cc-suite audit job id"
mkart "range_base=$BASE" "audit_head=$HEADSHA" "broker_job_id=audit-remgood" \
      "broker_output_sha256=$GOODSHA" "finding_ids=M1" "reason=r" "allowed_path=../outside/x"
deny_case "artifact with a '..' allowed_path" "git commit -m fix" "contains a '..' segment"
mkart "range_base=$BASE" "audit_head=$HEADSHA" "broker_job_id=audit-remgood" \
      "broker_output_sha256=$GOODSHA" "finding_ids=M1" "reason=r" "allowed_path=/etc/passwd"
deny_case "artifact with an absolute allowed_path" "git commit -m fix" "must be repo-relative"
mkart "range_base=not-a-sha" "audit_head=$HEADSHA" "broker_job_id=audit-remgood" \
      "broker_output_sha256=$GOODSHA" "finding_ids=M1" "reason=r" "allowed_path=src/fix.txt"
deny_case "artifact with a non-hex range_base" "git commit -m fix" "range_base is not a 40-hex"
mkart "this line has no equals sign"
deny_case "artifact with a malformed line" "git commit -m fix" "malformed artifact line"
: > "$RUNDIR/remediation.authorized"
chk "empty artifact -> deny" DENY "$(runhook)"
chk "empty artifact cites emptiness" yes "$(reasonhas 'missing, unreadable, or empty')"
rm -f "$RUNDIR/remediation.authorized"

# ==============================================================================================
# Commit form — the commit must commit EXACTLY the verified index, or the subset check is a lie
# ==============================================================================================
setwin "$BASE" "$BASE"
formcase() { # formcase <label> <command> <want DENY|ALLOW> [reason-substring]
  local label=$1 cmd=$2 want=$3 sub=${4:-} got
  good_art; stage src/fix.txt
  got=$(runhook "$cmd")
  chk "$label" "$want" "$got"
  [ -n "$sub" ] && chk "$label reason" yes "$(reasonhas "$sub")"
  rm -f "$RUNDIR/remediation.authorized"
}
formcase "form: plain -m allowed"            "git commit -m fix"                    ALLOW
formcase "form: quoted multiword -m allowed" 'git commit -m "fix the M1 finding"'   ALLOW
formcase "form: -s -q allowed"               "git commit -s -q -m fix"              ALLOW
formcase "form: --message= allowed"          "git commit --message=fix"             ALLOW
formcase "form: -a DENIED"                   "git commit -a -m fix"                 DENY "not on the remediation lane's index-neutral allow-list"
formcase "form: -am DENIED"                  "git commit -am fix"                   DENY "not on the remediation lane's index-neutral allow-list"
formcase "form: --all DENIED"                "git commit --all -m fix"              DENY "not on the remediation lane's index-neutral allow-list"
formcase "form: --amend DENIED"              "git commit --amend --no-edit"         DENY "not on the remediation lane's index-neutral allow-list"
formcase "form: --only DENIED"               "git commit --only -m fix src/fix.txt" DENY "not on the remediation lane's index-neutral allow-list"
formcase "form: --include DENIED"            "git commit --include -m fix"          DENY "not on the remediation lane's index-neutral allow-list"
formcase "form: pathspec-from-file DENIED"   "git commit --pathspec-from-file=p -m fix" DENY "not on the remediation lane's index-neutral allow-list"
formcase "form: '--' pathspec DENIED"        "git commit -m fix -- src/fix.txt"     DENY "introduces a pathspec"
formcase "form: bare pathspec DENIED"        "git commit -m fix src/fix.txt"        DENY "is a pathspec"
formcase "form: redirection DENIED"          "git commit -m fix > /tmp/out"         DENY "chaining, redirection, command substitution"
formcase "form: substitution DENIED"         'git commit -m "$(cat /tmp/m)"'        DENY "chaining, redirection, command substitution"

# ==============================================================================================
# AC9 — every pre-existing guard behaviour survives; the lane bypasses ONLY the audit-DUE deny
# ==============================================================================================
# clean window (count < EVERY): normal rules already allow, and the lane is NOT engaged, so the
# artifact must be left UNSPENT.
setwin "$HEADSHA" "$HEADSHA"; good_art; stage src/fix.txt
chk "AC9 clean window allows without engaging the lane" ALLOW "$(runhook)"
chk "AC9 clean window leaves the token unspent"         present "$(tokenstate)"
rm -f "$RUNDIR/remediation.authorized"

# risk flag still blocks
setwin "$BASE" "$BASE"; good_art; stage src/fix.txt; printf 'LOC>300\n' > "$RUNDIR/risk.flag"
deny_case "AC9 risk flag still blocks a remediation commit" "git commit -m fix" "risk trigger is pending"
rm -f "$RUNDIR/risk.flag"
# ungoverned queue still blocks
good_art; stage src/fix.txt; mv "$RUNDIR/queue.governed" "$RUNDIR/queue.governed.bak"
deny_case "AC9 ungoverned queue still blocks" "git commit -m fix" "queue is not governed"
mv "$RUNDIR/queue.governed.bak" "$RUNDIR/queue.governed"
# BCG-6 content hash still blocks
good_art; stage src/fix.txt; printf 'TAMPERED AFTER GOVERNANCE\n' >> "$RUNDIR/queue.md"
deny_case "AC9 queue content-hash mismatch still blocks" "git commit -m fix" "does not match the governed hash"
printf 'remediation-spec governed queue body\n' > "$RUNDIR/queue.md"
# closeout sentinel still blocks
good_art; stage src/fix.txt; printf 'OLD=x\n' > "$RUNDIR/.closeout-pending"
deny_case "AC9 closeout sentinel still blocks" "git commit -m fix" "batch-closeout is in progress"
rm -f "$RUNDIR/.closeout-pending"
# AUTO_ADVANCE_MAX breaker still blocks (window past MAX)
setwin "$BASE" "$BASE" 3 3; good_art; stage src/fix.txt
deny_case "AC9 breaker still blocks after the lane opens" "git commit -m fix" "AUTO_ADVANCE_MAX=3 reached"
setwin "$BASE" "$BASE"
# multiple commits in one call still denied before the lane is even considered
good_art; stage src/fix.txt
chk "AC9 two commits in one call still denied" DENY "$(runhook 'git commit -m a && git commit -m b')"
chk "AC9 two-commit denial precedes the lane"  present "$(tokenstate)"
rm -f "$RUNDIR/remediation.authorized"
# gated mode is untouched: MAX=1 needs human.ack; the remediation artifact must NOT substitute
printf 'AUTO_ADVANCE_MAX=1\nBATCH_AUDIT_EVERY=1\n' > "$RUNDIR/config"; good_art; stage src/fix.txt
chk "AC9 gated mode still requires human.ack"  DENY    "$(runhook)"
chk "AC9 gated mode leaves the token unspent"  present "$(tokenstate)"
: > "$RUNDIR/human.ack"
chk "AC9 gated mode human.ack still allows"    ALLOW   "$(runhook)"
rm -f "$RUNDIR/human.ack" "$RUNDIR/remediation.authorized"
# batch-mode human.override still works and still bypasses the audit-DUE deny on its own
setwin "$BASE" "$BASE"; : > "$RUNDIR/human.override"; printf 'deliberate override\n' > "$RUNDIR/override-reason.md"
stage src/fix.txt
chk "AC9 human.override still allows"          ALLOW  "$(runhook)"
chk "AC9 human.override still consumed"        absent "$([ -f "$RUNDIR/human.override" ] && printf present || printf absent)"
rm -f "$RUNDIR/override-reason.md"

# ==============================================================================================
# Consume-on-success — a failure to remove or to log must DENY, never authorize a replayable token
# ==============================================================================================
ROOT=0; [ "$(id -u 2>/dev/null)" = 0 ] && ROOT=1
setwin "$BASE" "$BASE"; good_art; stage src/fix.txt
mv "$RUNDIR/log.md" "$RUNDIR/log.md.bak"; mkdir "$RUNDIR/log.md"   # append fails for any uid
chk "append-fail -> deny" DENY "$(runhook)"
chk "append-fail cites the atomic consume+log" yes "$(reasonhas 'atomically consumed+logged')"
rmdir "$RUNDIR/log.md"; mv "$RUNDIR/log.md.bak" "$RUNDIR/log.md"
rm -f "$RUNDIR/remediation.authorized"
if [ "$ROOT" -eq 0 ]; then
  good_art; stage src/fix.txt; chmod 0555 "$RUNDIR"
  g=$(runhook); chmod 0755 "$RUNDIR"
  chk "rm-fail -> deny"              DENY    "$g"
  chk "rm-fail keeps token present"  present "$(tokenstate)"
  rm -f "$RUNDIR/remediation.authorized"
else
  echo "  [SKIP under root: rm-fail case — chmod-unwritable dir not enforceable for root]"
fi

printf 'batch-commit-guard-remediation: %d passed, %d failed\n' "$pass" "$fail"
if [ "$fail" -ne 0 ]; then printf 'FAILED:%b\n' "$failed"; exit 1; fi
echo "ALL PASS"; exit 0
