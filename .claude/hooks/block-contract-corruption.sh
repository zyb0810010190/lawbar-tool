#!/bin/bash
# block-contract-corruption.sh — PreToolUse(Bash) hook (WI-CI1, BATCH-WORKFLOW-CONTRACT-INTEGRITY-GUARD-00).
#
# DEFENSE-IN-DEPTH against silent corruption of the always-loaded CONTRACT DOCS
# (AGENTS.md, CLAUDE.md, GEMINI.md, .claude/rules/*.md) landing in a commit. An external editor
# markdown formatter once mangled AGENTS.md with HTML numeric entities, escaped underscores, and
# stray quad-asterisks; no repo/Claude formatter exists, so this guard defends the commit boundary.
#
# SCOPE (honest): covers the literal `git add` / `git commit` PORCELAIN surface — exactly what the
# autonomous pipeline uses (`git add <path>` + `git commit -m`). It does NOT and cannot intercept
# git PLUMBING (commit-tree/update-ref, hash-object/update-index), shell ALIASES, or `git -c alias.*`
# indirection — a command-string PreToolUse hook can't reach those; the standalone
# scripts/workflow/check-contract-integrity.sh (pre-push/CI gate) + cc-suite/human review are the
# complementary layers. This guard is ADDITIVE: it never modifies the other five guards and is framed
# as an ADDITIONAL deny, never the sole boundary.
#
# v1 corruption markers (contract-doc scope only): numeric HTML entity &#x..;, literal ****, prose \_.
# Fails CLOSED (deny) on an INSPECTION error (git show / read fails on a contract doc being checked).
# A command that cannot be TOKENIZED (exotic quoting) is OUTSIDE the clean porcelain surface and takes
# NO action (allow) — a real `git add <path>` / `git commit -m` always tokenizes and is fully checked;
# the complementary checker + commit-time staged-index net + review cover the exotic remainder.
# NEVER mutates files.

INPUT=$(cat)

# emit_deny <reason> — valid-JSON PreToolUse deny (mirrors block-commit-stage-all.sh).
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

# smells_git_ac <text> — true only if a REAL git add/commit invocation is plausibly present at a
# statement boundary (not prose merely mentioning "git commit"). Used by the rare bash-level
# fail-closed fallbacks (jq/python3 unavailable) so they don't over-deny non-git commands.
smells_git_ac() {
  printf '%s' "$1" | grep -qE '(^|[;&|])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*(env[[:space:]]+|command[[:space:]]+|exec[[:space:]]+)*\\?([^[:space:]]*/)?git[[:space:]]+(-[^[:space:]]+[[:space:]]+)*(add|commit)([[:space:]]|$)'
}

# Extract the command string.
if command -v jq >/dev/null 2>&1; then
  CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  CMD=$(printf '%s' "$INPUT" | tr -d '\n' | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -1 | sed -E 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')
fi

if [ -z "$CMD" ]; then
  # Could not parse the command out of the payload, but it smells like a git add/commit → fail closed.
  if smells_git_ac "$INPUT"; then
    emit_deny "Contract-integrity guard: could not parse the git command to confirm it does not stage/commit a corrupted contract doc; denying as a precaution (fail-closed)."
  fi
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  # No tokenizer available; fail closed only when the command smells like git add/commit.
  if smells_git_ac "$CMD"; then
    emit_deny "Contract-integrity guard: python3 unavailable to safely analyze the git command; denying as a precaution (fail-closed)."
  fi
  exit 0
fi

# All the git-surface analysis + marker inspection happens in python3 (correct shlex tokenization,
# git pathspec resolution). It prints a deny reason and exits 10 to request a deny; exits 0 to allow.
REASON=$(CMD_ENV="$CMD" python3 <<'PY'
import os, re, shlex, subprocess, sys

CMD = os.environ.get("CMD_ENV", "")
CGLOBS = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".claude/rules"]

def has_marker(data):
    s = data.decode("utf-8", "replace") if isinstance(data, (bytes, bytearray)) else data
    if re.search(r"&#x[0-9A-Fa-f]+;", s):
        return "an HTML numeric character entity"
    if "*" * 4 in s:
        return "a stray quad-asterisk run"
    if re.search(r"\\_", s):
        return "a backslash-escaped underscore"
    return None

def is_contract(p):
    if p.startswith("./"):
        p = p[2:]
    if p in ("AGENTS.md", "CLAUDE.md", "GEMINI.md"):
        return True
    return p.startswith(".claude/rules/") and p.endswith(".md")

def git(*args, cwd=None):
    return subprocess.run(["git"] + list(args), capture_output=True, cwd=cwd)

def deny(msg):
    sys.stdout.write(msg)
    sys.exit(10)

# Repo top-level. ALL index/worktree reads are anchored here (run with `git -C TOP`, paths via
# --full-name) so a `git -C <dir>` invocation cannot relocate pathspec resolution away from the
# contract docs. If we are not in a git repo, there is nothing to corrupt-commit (the command will
# fail on its own) → allow.
_top = git("rev-parse", "--show-toplevel")
if _top.returncode != 0:
    sys.exit(0)
TOP = _top.stdout.decode("utf-8", "replace").strip()

def staged_contract_docs():
    r = git("-C", TOP, "diff", "--cached", "--name-only", "-z", "--", *CGLOBS)
    if r.returncode != 0:
        deny("Contract-integrity guard: `git diff --cached` failed while checking staged contract docs; denying (fail-closed).")
    return [p.decode("utf-8", "replace") for p in r.stdout.split(b"\x00") if p and is_contract(p.decode("utf-8", "replace"))]

def check_staged():
    for p in staged_contract_docs():
        b = git("-C", TOP, "show", ":" + p)
        if b.returncode != 0:
            deny("Contract-integrity guard: cannot read the staged blob for %s; denying (fail-closed)." % p)
        m = has_marker(b.stdout)
        if m:
            deny("Contract-integrity guard: the STAGED contract doc %s contains %s — a markdown-autofix corruption marker. Restore it (git restore --staged %s; git restore %s) before committing. See scripts/workflow/check-contract-integrity.sh." % (p, m, p, p))

def check_worktree_pathspecs(pathspecs, eff):
    # Resolve pathspecs RELATIVE TO the effective cwd (eff, honoring `git -C`), returning repo-root-
    # relative names via --full-name; read each contract-doc match anchored at TOP.
    if not pathspecs:
        return
    r = git("-C", eff, "ls-files", "--full-name", "-z", "--", *pathspecs)
    if r.returncode != 0:
        deny("Contract-integrity guard: `git ls-files` failed resolving pathspecs %r; denying (fail-closed)." % pathspecs)
    for pb in r.stdout.split(b"\x00"):
        if not pb:
            continue
        p = pb.decode("utf-8", "replace")
        if not is_contract(p):
            continue
        full = os.path.join(TOP, p)
        try:
            with open(full, "rb") as fh:
                data = fh.read()
        except OSError:
            deny("Contract-integrity guard: cannot read %s; denying (fail-closed)." % p)
        m = has_marker(data)
        if m:
            deny("Contract-integrity guard: the contract doc %s (working tree) contains %s and would be staged/committed by this command. Restore it (git restore %s) before proceeding." % (p, m, p))

def check_all_tracked_contract_worktree():
    # Catch-all + commit -a: inspect every tracked contract doc's working-tree content (anchored at TOP,
    # independent of any -C). Unmodified docs equal the clean HEAD and carry no marker → no over-deny.
    check_worktree_pathspecs(CGLOBS, TOP)

def strip_heredocs(s):
    # Remove heredoc BODIES (<<['"]?WORD['"]? ... \nWORD) so embedded prompt prose — which routinely
    # contains "git add"/"git commit" and unbalanced quotes — is never tokenized or pattern-matched.
    lines = s.split("\n")
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        m = re.search(r"<<-?\s*([\"']?)([A-Za-z_]\w*)\1", line)
        if m:
            delim = m.group(2)
            i += 1
            while i < len(lines) and lines[i].strip() != delim:
                i += 1
            i += 1  # drop the closing delimiter line too
            continue
        i += 1
    return "\n".join(out)

# --- tokenize into statements (heredoc bodies stripped first) ---
CMD_T = strip_heredocs(CMD)
try:
    lex = shlex.shlex(CMD_T, posix=True, punctuation_chars=True)
    lex.whitespace_split = True
    toks = list(lex)
except ValueError:
    # Tokenization failed even after heredoc stripping (exotic/unbalanced quoting). Such a command is
    # OUTSIDE the cleanly-analyzable porcelain surface: a real autonomous/normal `git add <path>` or
    # `git commit -m` always tokenizes and is fully checked above. Per the honest defense-in-depth
    # scope, take NO action here rather than over-deny an unrelated complex command — the complementary
    # standalone checker (pre-push/CI), the commit-time staged-index check, and review cover the rest.
    sys.exit(0)

OPS = {";", "&", "|", "&&", "||", "|&"}
stmts, cur = [], []
for t in toks:
    if t in OPS:
        if cur:
            stmts.append(cur)
            cur = []
    else:
        cur.append(t)
if cur:
    stmts.append(cur)

WRAPPERS = {"command", "exec", "time", "env", "nice", "nohup", "stdbuf", "setsid", "builtin"}
COMMIT_VALUE_FLAGS = {"-m", "--message", "-F", "--file", "-C", "--reuse-message", "-c", "--reedit-message",
                      "--author", "--date", "--cleanup", "-S", "--gpg-sign", "-t", "--template", "--fixup", "--squash", "--trailer"}
ADD_VALUE_FLAGS = {"--chmod"}

def read_pathspec_file(path, nul):
    try:
        with open(path, "rb") as fh:
            raw = fh.read()
    except OSError:
        return None
    sep = b"\x00" if nul else b"\n"
    return [x.decode("utf-8", "replace") for x in raw.split(sep) if x]

CONTROL = {"if", "then", "elif", "else", "fi", "while", "until", "for", "do", "done",
           "case", "esac", "{", "}", "(", ")", "!", "in"}

for stmt in stmts:
    i = 0
    # unwrap leading env-assignments, wrappers, and shell control keywords so a `git` command word
    # inside e.g. `if git commit ...; then` is still reached (audit Medium).
    while i < len(stmt):
        w = stmt[i]
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", w):
            i += 1
            continue
        if w in WRAPPERS:
            i += 1
            while i < len(stmt) and (stmt[i].startswith("-") or re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", stmt[i])):
                i += 1
            continue
        if w in CONTROL:
            i += 1
            continue
        break
    if i >= len(stmt):
        continue
    cmd0 = stmt[i]
    if cmd0 != "git" and not cmd0.endswith("/git"):
        continue
    i += 1
    # skip git global options to the subcommand, capturing any -C <dir> so pathspecs resolve from the
    # effective cwd (audit High: `git -C <dir> commit --only <rel-path>` bypass).
    sub = None
    cdirs = []
    while i < len(stmt):
        a = stmt[i]
        if a == "-C":
            if i + 1 < len(stmt):
                cdirs.append(stmt[i + 1])
            i += 2
            continue
        if a in ("-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--exec-path"):
            i += 2
            continue
        if a.startswith("-"):
            i += 1
            continue
        sub = a
        i += 1
        break
    if sub not in ("add", "commit"):
        continue

    # effective cwd for pathspec resolution: apply each -C onto the hook's cwd (absolute -C resets).
    eff = os.getcwd()
    for d in cdirs:
        eff = os.path.join(eff, d)

    rest = stmt[i:]
    # parse rest into mode flags + pathspecs
    interactive = False
    all_flag = False
    include = False
    only = False
    update = False
    addall = False
    psff = None          # pathspec-from-file value (or '-')
    psff_nul = False
    pathspecs = []
    j = 0
    after_dd = False
    while j < len(rest):
        a = rest[j]
        if after_dd:
            pathspecs.append(a)
            j += 1
            continue
        if a == "--":
            after_dd = True
            j += 1
            continue
        if a.startswith("--pathspec-from-file="):
            psff = a.split("=", 1)[1]
            j += 1
            continue
        if a == "--pathspec-from-file":
            psff = rest[j + 1] if j + 1 < len(rest) else "-"
            j += 2
            continue
        if a == "--pathspec-file-nul":
            psff_nul = True
            j += 1
            continue
        if sub == "commit":
            if a in ("-a", "--all"):
                all_flag = True; j += 1; continue
            if a in ("-p", "--patch", "--interactive"):
                interactive = True; j += 1; continue
            if a in ("-i", "--include"):
                include = True; j += 1; continue
            if a in ("-o", "--only"):
                only = True; j += 1; continue
            if a in COMMIT_VALUE_FLAGS:
                j += 2; continue
            if a.startswith("--"):
                j += 1; continue
            if a.startswith("-") and len(a) > 1:
                # clustered short flags, e.g. -am, -ap, -Sm. Detect mode letters; if the cluster ends
                # in a value-taking short flag (m/F/C/c/t/S) with no attached value, consume the next token.
                cluster = a[1:]
                if "a" in cluster:
                    all_flag = True
                if "p" in cluster:
                    interactive = True
                consume_next = False
                for idx, ch in enumerate(cluster):
                    if ch in "mFCctS":
                        consume_next = (idx == len(cluster) - 1)
                        break
                j += 2 if consume_next else 1
                continue
            pathspecs.append(a); j += 1; continue
        else:  # add
            if a in ("-p", "--patch", "-i", "--interactive", "-e", "--edit"):
                interactive = True; j += 1; continue
            if a in ("-u", "--update"):
                update = True; j += 1; continue
            if a in ("-A", "--all", "--no-ignore-removal"):
                addall = True; j += 1; continue
            if a in ADD_VALUE_FLAGS:
                j += 2; continue
            if a.startswith("--"):
                j += 1; continue
            if a.startswith("-") and len(a) > 1:
                # clustered short flags, e.g. -pv, -ie. git add short flags take no values.
                cluster = a[1:]
                if any(c in cluster for c in "pie"):
                    interactive = True
                if "A" in cluster:
                    addall = True
                if "u" in cluster:
                    update = True
                j += 1; continue
            pathspecs.append(a); j += 1; continue

    # resolve --pathspec-from-file
    if psff is not None:
        if psff == "-":
            interactive = True   # stdin unreadable from the hook → catch-all
        else:
            pf = psff if os.path.isabs(psff) else os.path.join(eff, psff)
            fps = read_pathspec_file(pf, psff_nul)
            if fps is None:
                deny("Contract-integrity guard: cannot read --pathspec-from-file=%s; denying (fail-closed)." % psff)
            pathspecs.extend(fps)

    # a bare '.' or ':/' pathspec stages/commits the whole tree → treat as catch-all
    if any(p in (".", ":/", "./") for p in pathspecs):
        interactive = True

    # decide what to inspect
    if sub == "commit":
        if interactive:
            check_staged(); check_all_tracked_contract_worktree()
        elif all_flag:
            check_staged(); check_all_tracked_contract_worktree()
        elif include:
            check_staged(); check_worktree_pathspecs(pathspecs, eff)
        elif only or pathspecs:
            check_worktree_pathspecs(pathspecs, eff)
        else:
            check_staged()
    else:  # add
        if interactive or addall:
            check_all_tracked_contract_worktree()
        elif pathspecs:
            check_worktree_pathspecs(pathspecs, eff)
        elif update:
            pass   # un-named `git add -u` → caught at commit-time via the staged-index net
        else:
            pass   # `git add` with no actionable pathspec → no-op

sys.exit(0)
PY
)
RC=$?

if [ "$RC" -eq 10 ]; then
  emit_deny "$REASON"
elif [ "$RC" -ne 0 ]; then
  # python crashed unexpectedly while analyzing a git command → fail closed if it smells like add/commit.
  if smells_git_ac "$CMD"; then
    emit_deny "Contract-integrity guard: analysis failed unexpectedly (rc=$RC); denying as a precaution (fail-closed)."
  fi
fi
exit 0
