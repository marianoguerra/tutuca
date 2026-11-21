#!/bin/sh
# Assembles tutuca-wasm's pages as a static site, in _site/ (or the directory given): the
# playground, the demos and the studio, with the runtime, the compiler and what they load.
# Only what a page reads is copied.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$here"
./build.sh
out="${1:-$here/_site}"
rm -rf "$out"
mkdir -p "$out/dist/pure-js" "$out/js" "$out/playground/deps" "$out/demos" "$out/vendor"
cp dist/tutuca-wasm.js dist/tutuca-wasm.wasm "$out/dist/"
cp dist/pure-js/pure-js.wasm "$out/dist/pure-js/"
cp js/page.js js/paths.js "$out/js/"
cp playground/index.html playground/playground.js playground/examples.js "$out/playground/"
cp playground/deps/editor.js "$out/playground/deps/"
cp demos/index.html demos/demos.js "$out/demos/"
cp -r vendor/margaui "$out/vendor/"
cp -r components "$out/"
mkdir -p "$out/studio/assistant/examples"
cp studio/index.html studio/*.js studio/studio.tutuca.ts "$out/studio/"
cp studio/assistant/examples/*.tutuca.ts "$out/studio/assistant/examples/"
cat > "$out/index.html" <<'HTML'
<!doctype html>
<meta charset="utf-8">
<title>tutuca-wasm</title>
<ul>
<li><a href="playground/">playground</a></li>
<li><a href="demos/">demos</a></li>
<li><a href="studio/">studio</a></li>
</ul>
HTML
echo "site: $out ($(du -sh "$out" | cut -f1))"
