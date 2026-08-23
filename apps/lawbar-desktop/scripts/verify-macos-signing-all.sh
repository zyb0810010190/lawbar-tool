#!/bin/bash
# D-5. Verify EVERY signed .app the release build produced.
#
# `dist:release` used to end at electron-builder, so nothing in any ship path ran the exit
# contract in verify-macos-signing.sh. The stapling half in particular was never checked
# after a build — the tool shipped a claim about its own signing that no ship path tested.
#
# Why discovery instead of a path argument: the signed config targets BOTH arm64 and x64, and
# verify-macos-signing.sh defaults to release/mac-arm64/lawbar.app. A single call would have
# verified one architecture and silently ignored the other. Rather than hardcode two paths I
# cannot confirm without credentials to run a signed build, find what was actually produced.
#
# Finding NOTHING is a failure, not a pass. That is the specific shape this repo keeps
# hitting: a scanner that reports clean having scanned zero files.
set -u

ROOT="${1:-release}"
VERIFY="$(dirname "$0")/verify-macos-signing.sh"

if [ ! -d "$ROOT" ]; then
  echo "verify:all: no build output at '$ROOT' — run the build first" >&2
  exit 1
fi

# WHICH bundles must exist. Reviewing the first version found the hole: it required at least
# ONE .app and verified whatever it discovered, so if the x64 build silently vanished the
# arm64 bundle would verify and the gate would pass — contradicting the very reason discovery
# was added. Requiring a count is not enough either; it must be the RIGHT bundles.
#
# The expectation is derived from the signed config rather than hardcoded, so it cannot drift
# away from what the build is actually told to produce.
EXPECTED_ARCHES="$(node -p "
  const t = require('./electron-builder.signed.cjs').mac.target;
  [...new Set([].concat(...t.map((x) => x.arch)))].sort().join(' ')
" 2>/dev/null)"
if [ -z "$EXPECTED_ARCHES" ]; then
  echo "verify:all: could not read the target architectures from electron-builder.signed.cjs." >&2
  echo "            Refusing rather than verifying an unknown subset." >&2
  exit 1
fi
echo "verify:all: expecting a signed bundle for each of: $EXPECTED_ARCHES"

found=0
failed=0
# -maxdepth 3: release/<mac-arch>/<name>.app. Deeper matches are nested bundles inside an
# .app (frameworks, helpers), which codesign checks as part of their container.
while IFS= read -r app; do
  [ -n "$app" ] || continue
  found=$((found + 1))
  echo "verify:all: checking $app"
  if ! bash "$VERIFY" "$app"; then
    echo "verify:all: FAILED for $app" >&2
    failed=$((failed + 1))
  fi
done <<EOF
$(find "$ROOT" -maxdepth 3 -type d -name "*.app" 2>/dev/null | sort)
EOF

if [ "$found" -eq 0 ]; then
  echo "verify:all: NO .app bundles found under '$ROOT'. A release that verified nothing" >&2
  echo "            must not report success — that is a pass with no evidence behind it." >&2
  exit 1
fi

# Every expected architecture must be represented. A build that produced one and lost the
# other must not ship on the strength of the survivor.
missing=""
for arch in $EXPECTED_ARCHES; do
  if ! find "$ROOT" -maxdepth 3 -type d -name "*.app" 2>/dev/null | grep -q -- "$arch"; then
    missing="$missing $arch"
  fi
done
if [ -n "$missing" ]; then
  echo "verify:all: the build is INCOMPLETE — no bundle found for:$missing" >&2
  echo "            $found bundle(s) were checked, but a release missing an architecture" >&2
  echo "            must not pass on the strength of the ones that survived." >&2
  exit 1
fi
if [ "$failed" -gt 0 ]; then
  echo "verify:all: $failed of $found bundle(s) failed the exit contract" >&2
  exit 1
fi
echo "verify:all: $found bundle(s) passed, covering every expected architecture"
