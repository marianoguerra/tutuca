#!/bin/sh
# Refreshes vendor/pure-js from a checkout of pure-js in MoonBit with its wasm built
# (PURE_JS_MB, ../../mb/pure-js when unset): the compiler (pure-js.wasm), the JavaScript that
# reads what it gives and the one that runs what it compiles. Run it after changing pure-js;
# build.sh uses what is vendored.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
purejs="${PURE_JS_MB:-$here/../../mb/pure-js}"
out="$here/vendor/pure-js"
mkdir -p "$out"
cp "$purejs/js/pure-js.js" "$purejs/js/pure-js.d.ts" "$purejs/js/pure-js-run.js" \
  "$purejs/js/pure-js-run.d.ts" "$purejs/js/pure-js.wasm" "$purejs/js/LICENSE" "$out/"
(cd "$out" && sha256sum pure-js.wasm > pure-js.wasm.sha256)
rev=$(git -C "$purejs" rev-parse --short HEAD)
branch=$(git -C "$purejs" rev-parse --abbrev-ref HEAD)
dirty=$(git -C "$purejs" status --porcelain | head -1)
echo "vendored pure-js $rev ($branch${dirty:+, with uncommitted changes})"
