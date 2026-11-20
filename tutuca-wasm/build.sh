#!/bin/sh
# Builds dist/: the runtime (tutuca-wasm.wasm, with MoonBit), pure-js beside it (dist/pure-js/,
# from vendor/pure-js: its compiler and what runs what it compiles), the glue bundled for a page
# (tutuca-wasm.js), and the micro-agents' packages and engines.
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
# The micro-agents: each agent's folder packed, and the engines their host functions use (the
# bundles tutuca's scripts/vendor.js makes in ../demos/deps/); one that isn't there is left
# out, and the agents that need it say so.
node microagents/pack.mjs dist/agents > /dev/null
mkdir -p dist/engines
engines="ajv jq jsonpath picomatch vega echarts"
if [ -e ../scripts/vendor.js ] && [ -d ../node_modules ]; then
  (cd .. && node scripts/vendor.js --if-missing $engines) || true
fi
for engine in $engines; do
  if [ -e "../demos/deps/$engine.js" ]; then
    cp "../demos/deps/$engine.js" dist/engines/
  else
    echo "warning: no ../demos/deps/$engine.js: the agents that use $engine won't load" >&2
  fi
done
echo "dist/tutuca-wasm.wasm: $(wc -c < dist/tutuca-wasm.wasm) bytes"
