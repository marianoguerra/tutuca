#!/bin/sh
# Builds dist/: the runtime (tutuca-wasm.wasm, with MoonBit), pure-js beside it (dist/pure-js/,
# from vendor/pure-js: its compiler and what runs what it compiles) and the glue bundled for a
# page (tutuca-wasm.js).
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$here"
moon build --target wasm-gc --release
mkdir -p dist
cp _build/wasm-gc/release/build/runtime/runtime.wasm dist/tutuca-wasm.wasm
mkdir -p dist/pure-js
cp vendor/pure-js/pure-js.js vendor/pure-js/pure-js.d.ts vendor/pure-js/pure-js-run.js \
  vendor/pure-js/pure-js-run.d.ts vendor/pure-js/pure-js.wasm dist/pure-js/
# For a page: the glue, the module front it shares with tutuca and pure-js's JavaScript as one
# file, beside the two WebAssembly modules.
if [ -x ../node_modules/.bin/esbuild ]; then
  ../node_modules/.bin/esbuild js/tutuca-wasm.js --bundle --format=esm --minify \
    --external:node:fs/promises --outfile=dist/tutuca-wasm.js --log-level=warning
fi
echo "dist/tutuca-wasm.wasm: $(wc -c < dist/tutuca-wasm.wasm) bytes"
