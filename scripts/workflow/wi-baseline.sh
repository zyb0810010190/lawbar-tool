#!/bin/bash
# wi-baseline.sh — the executable half of stages 2 and 5 in docs/development-workflow.md.
#
# WHY THIS IS A SCRIPT AND NOT A CODE BLOCK IN A MARKDOWN FILE.
# Four adversarial audits of that document found 46 defects, and roughly two thirds of the
# later ones were in shell that lived inside prose: a verification loop that skipped git tree
# objects so a tampered baseline passed; a lockfile guard that could never pass; `$SCRATCH`
# used everywhere and defined nowhere, so cleanup resolved to `rm -rf /baseline-desktop`; an
# apostrophe inside "${VAR:?the WI's files}" that unterminated a quote and broke 200 lines of
# parsing; a required-variable check that aborted every desktop item before it reached its own
# procedure. Every one of those fails loudly the first time a test runs the code, and none of
# them fails while sitting in a fence nobody executes.
#
# Ported verbatim in behaviour, with each historical defect pinned by a case in
# scripts/workflow/wi-baseline.test.mjs.
#
# bash 3.2 (macOS system bash). No associative arrays, no mapfile, no ${x^^}.
# `set -u` catches the undefined-variable class; `set -e` is deliberately NOT used, because
# this script tests exit codes on purpose and would trip over its own conditionals.

set -u
set -o pipefail   # `git archive | tar` reported tar's status, hiding a failed producer

usage() {
  cat <<'USAGE'
wi-baseline.sh <command>

  check-paths      validate PATHS_UNDER_CHANGE holds git pathspecs, not the queue prose column
  preserve         snapshot the baseline for PATHS_UNDER_CHANGE, then verify it
  verify           verify an ALREADY-preserved baseline against HEAD (no re-snapshot)
  classify         read a baseline test-run log and return the stage-5 verdict
  package-baseline build a BUILT copy of a package at its pre-change state, so tests that
                   statically import ../dist can be run against it
  desktop-baseline build a BUILDABLE desktop baseline: a HEAD worktree with node_modules
                   cloned and committed tarballs restored, or a snapshot of a dirty tree

Environment, per command. Every one fails by name when unset rather than expanding to "".
  check-paths  PATHS_UNDER_CHANGE
  preserve     PATHS_UNDER_CHANGE  SCRATCH  GREENFIELD(yes|no)  [ALLOW_DIRTY=1]
  verify       PATHS_UNDER_CHANGE  SCRATCH  GREENFIELD(yes|no)
  classify     BASELINE_LOG  BASELINE_STATUS
  package-baseline  PACKAGE_DIR  SCRATCH  [BASELINE_REF=HEAD]
  desktop-baseline  SCRATCH  [DESKTOP_DIR=apps/lawbar-desktop]
USAGE
}

# --- path resolution -----------------------------------------------------------------
#
# ONE resolver, used by every command, because the snapshot loop and the verify loop
# disagreeing is how a baseline silently covers nothing.
#
# `git cat-file -t HEAD:<p>` was the old test and it fails on the syntax the queue actually
# uses: WI-01 declares `services/case-box-persistence/tests/**`, which is neither a blob nor
# a tree, so it was reported as new-at-HEAD and verified zero files while exiting 0.
# `git ls-tree` does not expand `**` either, so the suffix is normalised away first.
normalise_pathspec() {
  case "$1" in
    */\*\*) echo "${1%/\*\*}" ;;   # foo/** -> foo, which IS a tree
    */\*)    echo "${1%/\*}" ;;      # foo/*  -> foo
    *)        echo "$1" ;;
  esac
}

# Emit one tracked file per line for a pathspec, or nothing if it is new at HEAD.
resolve_at_head() {
  git ls-tree -r --name-only HEAD -- "$(normalise_pathspec "$1")" 2>/dev/null
}

# --- guards ------------------------------------------------------------------------------

# A destructive path must never be derived from an empty variable. This is not theoretical:
# the doc version used "$SCRATCH/..." with SCRATCH undefined, so `rm -rf "$BASE"` resolved to
# `rm -rf /baseline-desktop`.
require_scratch() {
  if [ -z "${SCRATCH:-}" ]; then
    echo "SCRATCH is unset — refusing to run: every path below would resolve under /" >&2
    return 1
  fi
  if [ ! -d "$SCRATCH" ]; then
    echo "SCRATCH is not a directory: $SCRATCH" >&2
    return 1
  fi
  return 0
}

# --- check-paths -------------------------------------------------------------------------
#
# The queue's "Declared files" column is written for humans. WI-05's reads
# "auditHandlers.ts, persistence read paths", and word-splitting that yields the bare words
# `persistence`, `read` and `paths`. None is a git object, so each counted as new-at-HEAD and
# skewed the greenfield evidence.
cmd_check_paths() {
  if [ -z "${PATHS_UNDER_CHANGE:-}" ]; then
    echo "PATHS_UNDER_CHANGE is unset or empty" >&2
    return 1
  fi
  local p bad=0
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    case "$p" in
      *" "*) echo "AMBIGUOUS: '$p' contains a space. One pathspec PER LINE — space-separated" >&2
             echo "           input splits a single path into fragments that each pass a shape" >&2
             echo "           check, resolve to nothing, and are counted as new-at-HEAD." >&2
             bad=1 ;;
      *,*) echo "NOT A PATHSPEC: '$p' contains a comma — that is the queue's prose column" >&2
           echo "               punctuation, and 'src/a.ts,' resolves to nothing while still" >&2
           echo "               looking like a path. Strip the commas." >&2
           bad=1 ;;
      *) # Resolving at HEAD is the real test, and a shape heuristic is only the fallback for
         # paths that do not resolve. A bare directory like `src` is a perfectly good tree
         # pathspec with neither a slash nor a dot, so shape alone rejected legitimate input.
         if [ -n "$(resolve_at_head "$p")" ]; then
           :                                   # exists at HEAD: unambiguously a real path
         else
           case "$p" in
             */*|*.*) ;;                       # new file being created: plausible
             *) echo "NOT A PATHSPEC: '$p' — does not exist at HEAD and does not look like a" >&2
                echo "               file path. This is the queue prose column, not a pathspec." >&2
                bad=1 ;;
           esac
         fi ;;
    esac
  done <<EOF
$PATHS_UNDER_CHANGE
EOF
  [ "$bad" -eq 0 ] || return 1
  echo "pathspecs ok"
  return 0
}

# --- preserve ----------------------------------------------------------------------------
cmd_preserve() {
  require_scratch || return 1
  # Validate here too: relying on the caller having run check-paths first is a promise, and
  # this script exists because promises of that shape kept being broken.
  cmd_check_paths >/dev/null || return 1
  case "${GREENFIELD:-}" in
    yes|no) ;;
    *) echo "GREENFIELD must be yes or no — it is asserted, never inferred. See below." >&2
       return 1 ;;
  esac

  # HEAD is the baseline only when the tree is clean. This repo routinely carries many
  # completed-but-uncommitted items, and a HEAD baseline then fails for unrelated older work
  # which reads as regression evidence. ALLOW_DIRTY=1 is for the tests, which run against
  # purpose-built temp repos.
  if [ "${ALLOW_DIRTY:-0}" != "1" ] && [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    echo "WORKING TREE IS DIRTY, so HEAD is not the baseline and any stage-5 result read" >&2
    echo "against it would be meaningless. Commit the completed items first — commits are" >&2
    echo "local and need no authorization; only push, PR, merge and branch deletion do." >&2
    return 1
  fi

  mkdir -p "$SCRATCH/baseline" || return 1

  # Snapshot. Branch on the OBJECT TYPE: `git cat-file -e` succeeds for trees as well as
  # blobs, so testing existence alone leaves the directory case unreachable.
  local p files
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    files="$(resolve_at_head "$p")"
    if [ -z "$files" ]; then
      echo "NO BASELINE: $p is new at HEAD"
      continue
    fi
    printf '%s\n' "$files" | while IFS= read -r f; do
      [ -n "$f" ] || continue
      mkdir -p "$SCRATCH/baseline/$(dirname "$f")" || exit 1
      git show "HEAD:$f" > "$SCRATCH/baseline/$f" || exit 1
    done || return 1
  done <<EOF
$PATHS_UNDER_CHANGE
EOF

  cmd_verify
}

# --- verify ---------------------------------------------------------------------------
#
# Deliberately a SEPARATE entry point from the snapshot, so a test can corrupt a preserved
# baseline and re-verify it. When snapshot and verify were fused, the only tamper test that
# could be written re-snapshotted first and therefore could not fail — which is exactly the
# "test that cannot fail" class this repo treats as the primary defect.
cmd_verify() {
  require_scratch || return 1
  if [ -z "${PATHS_UNDER_CHANGE:-}" ]; then
    echo "PATHS_UNDER_CHANGE is unset or empty" >&2; return 1
  fi
  case "${GREENFIELD:-}" in
    yes|no) ;;
    *) echo "GREENFIELD must be yes or no — it is asserted, never inferred." >&2; return 1 ;;
  esac

  # A tree must be expanded to its blobs and each one compared: the original loop verified
  # only objects of type blob and skipped trees entirely, while still printing
  # "baseline verified against HEAD".
  local p verified=0 nobaseline=0 files f a b
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    files="$(resolve_at_head "$p")"
    if [ -z "$files" ]; then nobaseline=$((nobaseline + 1)); continue; fi
    for f in $files; do
      if [ ! -f "$SCRATCH/baseline/$f" ]; then
        echo "BASELINE MISSING: $f" >&2; return 1
      fi
      a=$(git show "HEAD:$f" | shasum -a 256 | cut -d" " -f1)
      b=$(shasum -a 256 "$SCRATCH/baseline/$f" | cut -d" " -f1)
      if [ "$a" != "$b" ]; then
        echo "BASELINE MISMATCH: $f" >&2; return 1
      fi
      verified=$((verified + 1))
    done
  done <<EOF
$PATHS_UNDER_CHANGE
EOF

  # Verifying nothing at all must not report success — but "nothing to verify because every
  # declared path is new" is a legitimate greenfield item, not a broken loop. Two counters.
  if [ "$verified" -eq 0 ] && [ "$nobaseline" -eq 0 ]; then
    echo "BASELINE EMPTY: nothing was even examined — stage 2 has NOT passed" >&2
    return 1
  fi

  # Cross-check the GREENFIELD assertion against the evidence. Agreement is not proof (the
  # new-helper facade passes it), but disagreement is proof of a mistake and is free to catch.
  if [ "$GREENFIELD" = yes ] && [ "$verified" -gt 0 ]; then
    echo "CONTRADICTION: greenfield asserted, but $verified declared path(s) exist at HEAD" >&2
    return 1
  fi
  if [ "$GREENFIELD" = no ] && [ "$verified" -eq 0 ]; then
    echo "NOTE: nothing exists at HEAD yet you asserted NOT greenfield — the new-helper case."
    echo "NOTE: name the existing entrypoint in Notes so the waiver is reviewable."
  fi

  echo "baseline verified against HEAD ($verified file(s); $nobaseline new at HEAD)"
  return 0
}

# --- classify ----------------------------------------------------------------------------
#
# The verdict is the FAILURE KIND, not the exit code, and it must be computed BEFORE any
# cleanup: `git worktree remove` succeeds and would overwrite $? with 0, discarding the only
# machine-visible result of the stage.
cmd_classify() {
  if [ -z "${BASELINE_LOG:-}" ] || [ ! -f "${BASELINE_LOG:-}" ]; then
    echo "BASELINE_LOG is unset or not a file" >&2; return 1
  fi
  case "${BASELINE_STATUS:-}" in
    ''|*[!0-9]*) echo "BASELINE_STATUS must be a number — a non-numeric value made the" >&2
                 echo "                 numeric test error out and fall through to TEETH." >&2
                 return 1 ;;
  esac

  if grep -qE 'ERR_MODULE_NOT_FOUND|Cannot find module' "$BASELINE_LOG"; then
    # NOT a greenfield waiver. A typo, a missing fixture, an absent dependency and a change
    # routed through a new wrapper all produce this, and all of them would otherwise pass.
    echo "INCONCLUSIVE: the test never executed at baseline — module load failed"
    return 1
  fi
  if [ "$BASELINE_STATUS" -eq 0 ]; then
    echo "NO TEETH: the test PASSES against pre-change code — stage 5 FAILS"
    return 1
  fi
  if grep -q 'AssertionError' "$BASELINE_LOG"; then
    echo "TEETH: an assertion failed at baseline"
    return 0
  fi
  echo "INCONCLUSIVE: baseline run crashed before asserting — harness fault, not evidence"
  return 1
}

# --- package-baseline --------------------------------------------------------------------
#
# WI-01 asked for a `LAWBAR_SCRIPT_DIR`-style env seam for case-box-persistence. Measurement
# says that cannot work: 17 of its 41 test files use STATIC ESM imports of `../dist/...`,
# resolved at parse time, and no environment variable redirects those. It is the same finding
# D-7 recorded for the desktop package.
#
# So build the baseline instead of simulating it, which is what the desktop already does — and
# here it is cheap: this package has no Electron ABI and no committed tarballs, just source
# and a tsc build. The tests then run inside the baseline copy and their relative imports
# resolve, unchanged, to baseline code.
cmd_package_baseline() {
  require_scratch || return 1
  : "${PACKAGE_DIR:?the package to baseline, e.g. services/case-box-persistence}"
  local ref="${BASELINE_REF:-HEAD}"
  if [ ! -d "$PACKAGE_DIR" ]; then
    echo "PACKAGE_DIR is not a directory: $PACKAGE_DIR" >&2; return 1
  fi

  local dest="$SCRATCH/package-baseline"
  rm -rf "$dest" || return 1
  mkdir -p "$dest" || return 1

  # The WHOLE tracked tree at the baseline ref, not just this package. Archiving the package
  # alone failed immediately: case-box-persistence's build chains a sibling build through a
  # relative path, and that sibling was not in the archive. Reasoning about each package's
  # local dependency graph is a rot source; the whole tree costs ~39 MB of tracked files and
  # removes the question. `git archive` writes only tracked files, so build output and
  # node_modules are excluded by construction rather than by an exclude list.
  # A ref omits UNTRACKED files, and `git stash create` — the natural way to baseline a dirty
  # tree — captures only tracked changes. WI-06 hit this: the baseline source imported a file
  # that was untracked, so the build failed with no hint of the cause. Warn by name; the build
  # guard below still refuses a half-built copy, but a warning beats a puzzle.
  local untracked
  untracked="$(git ls-files --others --exclude-standard -- "$PACKAGE_DIR" 2>/dev/null)"
  if [ -n "$untracked" ]; then
    echo "NOTE: $PACKAGE_DIR has UNTRACKED files. A ref-based baseline omits them, and if the" >&2
    echo "      baselined source imports one, the build below fails for a reason that looks" >&2
    echo "      unrelated. Copy them in deliberately if they predate the change:" >&2
    printf '        %s\n' $untracked >&2
  fi
  git archive "$ref" | tar -x -C "$dest" || return 1
  if [ ! -d "$dest/$PACKAGE_DIR" ]; then
    echo "no tracked files for $PACKAGE_DIR at $ref" >&2; return 1
  fi

  # Dependencies: reuse the live installs for every package that has one. COPY, never symlink
  # — a symlink points into the working tree, and anything the baseline build writes would
  # land in the package the real lane uses. APFS clone-on-write makes this nearly free.
  local pj d
  for pj in $(cd "$dest" && find . -name package.json -not -path '*/node_modules/*' -maxdepth 5); do
    d="${pj%/package.json}"
    if [ -d "$d/node_modules" ] && [ ! -d "$dest/$d/node_modules" ]; then
      cp -Rc "$d/node_modules" "$dest/$d/node_modules" 2>/dev/null \
        || cp -R "$d/node_modules" "$dest/$d/node_modules" || return 1
    fi
  done

  ( cd "$dest/$PACKAGE_DIR" && npm run build ) >/dev/null 2>&1 || {
    echo "BASELINE BUILD FAILED for $PACKAGE_DIR at $ref — the copy is not usable, and a" >&2
    echo "  stage-5 result read against it would be meaningless. Do not read one." >&2
    return 1
  }
  if [ ! -d "$dest/$PACKAGE_DIR/dist" ]; then
    echo "BASELINE BUILD produced no dist/ — nothing for the tests to import" >&2; return 1
  fi
  echo "$dest/$PACKAGE_DIR"
  return 0
}


# --- desktop-baseline --------------------------------------------------------------------
#
# GAP-3. The last piece of stage 2 still living as prose. It stayed behind because the real
# thing clones 613 MB of node_modules and runs a full build — but that is the SIZE of the
# production input, not a property of the logic. The branch selection, the marker, the
# lockfile comparator and the tarball restore are all size-independent, so a fixture of a few
# files exercises exactly the same code paths.
#
# Ported in behaviour from docs/development-workflow.md with two deliberate differences, both
# noted at their sites: the internal-package list is DERIVED rather than hardcoded, and the
# internal-lock guard is skipped (loudly) when the package does not declare that script.
#
# DESKTOP_DIR defaults to the real package; tests point it at a fixture.
cmd_desktop_baseline() {
  require_scratch || return 1
  local pkgdir="${DESKTOP_DIR:-apps/lawbar-desktop}"
  if [ ! -d "$pkgdir" ]; then
    echo "DESKTOP_DIR is not a directory: $pkgdir" >&2; return 1
  fi

  local base="$SCRATCH/baseline-desktop"
  rm -rf "$base" || return 1

  if [ -z "$(git status --porcelain)" ]; then
    # ---- clean tree: HEAD is the baseline ----
    echo head > "$SCRATCH/baseline-kind"
    git worktree add --detach "$base" HEAD >/dev/null 2>&1 || {
      echo "could not create a worktree at $base" >&2; return 1; }

    # CLONE node_modules; never symlink. A symlink points into the LIVE tree, and the tarball
    # restore below would then corrupt the packages the real build uses. APFS copy-on-write
    # makes the safe option the fast one; the plain -R fallback is for non-APFS volumes.
    if [ -d "$pkgdir/node_modules" ]; then
      cp -Rc "$pkgdir/node_modules" "$base/$pkgdir/node_modules" 2>/dev/null \
        || cp -R "$pkgdir/node_modules" "$base/$pkgdir/node_modules" || return 1
    fi

    # In THIS branch the tree is clean, so HEAD's lockfile and the working lockfile are the
    # same file and comparing them cannot fail — an earlier draft did exactly that and called
    # it a guard. The real question here is node_modules drifting from the lockfile it was
    # installed from, which the repo already answers. Skipped (loudly) if undeclared, so the
    # subcommand stays usable against a package that has no such script.
    if node -e 'const p=require("./"+process.argv[1]+"/package.json");process.exit(p.scripts&&p.scripts["check:internal-lock"]?0:1)' "$pkgdir" 2>/dev/null; then
      npm --prefix "$pkgdir" run check:internal-lock >/dev/null 2>&1 || {
        echo "node_modules has drifted from the lockfile — npm install before baselining" >&2
        return 1; }
    else
      echo "NOTE: $pkgdir declares no check:internal-lock script — drift guard skipped" >&2
    fi

    # Kept for the case where this is pointed at an OLDER commit than HEAD, where the two
    # lockfiles genuinely differ. It MUST compare package ENTRIES, not raw lines: a package's
    # name and its "integrity" hash sit on DIFFERENT lines, so a line-wise grep excluding
    # "case-box-" sees only anonymous sha512 strings and reports "external dependency moved"
    # on the one case it exists to permit.
    if [ -f "$pkgdir/package-lock.json" ]; then
      INTERNAL_PKGS="$(_internal_pkg_names "$pkgdir")" \
      node -e '
        const fs = require("fs"), cp = require("child_process");
        const dir = process.argv[1];
        const internal = (process.env.INTERNAL_PKGS || "").split(/\s+/).filter(Boolean);
        let head;
        try { head = JSON.parse(cp.execSync(`git show HEAD:${dir}/package-lock.json`, {stdio:["pipe","pipe","ignore"]})); }
        catch { process.exit(0); }   // no lockfile at HEAD: nothing to compare
        const now = JSON.parse(fs.readFileSync(`${dir}/package-lock.json`, "utf8"));
        const keys = new Set([...Object.keys(head.packages || {}), ...Object.keys(now.packages || {})]);
        const moved = [...keys].filter((k) =>
          !internal.some((n) => k.includes(n)) &&
          JSON.stringify((head.packages||{})[k]) !== JSON.stringify((now.packages||{})[k]));
        if (moved.length) { console.error("moved: " + moved.slice(0, 5).join(", ")); process.exit(1); }
      ' "$pkgdir" || {
        echo "external dependency moved since HEAD — full npm install in $base instead" >&2
        return 1; }
    fi

    # A desktop baseline is source AND TARBALLS: the internal packages arrive as committed
    # tarballs, so HEAD source built against CURRENT tarballs is a MIXED tree, not a baseline.
    # This restore belongs to THIS branch only — see the other branch for why.
    #
    # The list is DERIVED from the package's own file:dist-tarballs dependencies rather than
    # hardcoded as the document had it. A literal list duplicates knowledge that already lives
    # in package.json and silently omits a third internal package the day one is added.
    local pkg
    for pkg in $(_internal_pkg_names "$pkgdir"); do
      git show "HEAD:$pkgdir/dist-tarballs/$pkg-0.1.0.tgz" > "$SCRATCH/$pkg.tgz" 2>/dev/null || {
        echo "no committed tarball for $pkg at HEAD" >&2; return 1; }
      rm -rf "$SCRATCH/x" && mkdir -p "$SCRATCH/x" || return 1
      tar -xzf "$SCRATCH/$pkg.tgz" -C "$SCRATCH/x" || return 1
      rm -rf "$base/$pkgdir/node_modules/$pkg"
      mkdir -p "$base/$pkgdir/node_modules" || return 1
      mv "$SCRATCH/x/package" "$base/$pkgdir/node_modules/$pkg" || return 1
    done
  else
    # ---- dirty tree: the baseline is the WORKING TREE as it stands, not HEAD ----
    # Found the hard way: HEAD was 69 files behind, so a HEAD baseline was missing three
    # earlier work items and the new test failed there for unrelated reasons — which reads as
    # "regression confirmed" and is worthless.
    echo snapshot > "$SCRATCH/baseline-kind"
    mkdir -p "$base/$(dirname "$pkgdir")" || return 1
    cp -Rc "$pkgdir" "$base/$pkgdir" 2>/dev/null || cp -R "$pkgdir" "$base/$pkgdir" || return 1
    # NO tarball restore in this branch. The copied node_modules is ALREADY the correct
    # baseline; overwriting it with HEAD's tarballs yields a tree that is neither HEAD nor the
    # pre-edit working tree, and it can then fail for stale-tarball reasons that get
    # misreported as "baseline incoherent".
  fi

  rm -rf "$base/$pkgdir/dist"
  npm --prefix "$base/$pkgdir" run build >/dev/null 2>&1 || {
    echo "BASELINE INCOHERENT: the baseline source did not compile against its own deps." >&2
    echo "  The tree is MIXED, not a baseline. Stage 5 would be VOID — do not read its result." >&2
    return 1; }
  # ^ a free self-check, and it really fires: HEAD source + CURRENT tarballs exits 2.

  echo "$base/$pkgdir"
  return 0
}

# Internal packages, read from the package's own `file:dist-tarballs/<name>-<ver>.tgz`
# dependencies. Printed space-separated; empty when there are none.
_internal_pkg_names() {
  node -e '
    const p = require("./" + process.argv[1] + "/package.json");
    const out = [];
    for (const [name, spec] of Object.entries(p.dependencies || {})) {
      if (typeof spec === "string" && spec.startsWith("file:dist-tarballs/")) out.push(name);
    }
    process.stdout.write(out.join(" "));
  ' "$1" 2>/dev/null
}

case "${1:-}" in
  check-paths) cmd_check_paths ;;
  preserve)    cmd_preserve ;;
  verify)      cmd_verify ;;
  package-baseline) cmd_package_baseline ;;
  desktop-baseline) cmd_desktop_baseline ;;
  classify)    cmd_classify ;;
  -h|--help|"") usage ;;
  *) echo "unknown command: $1" >&2; usage >&2; exit 2 ;;
esac
