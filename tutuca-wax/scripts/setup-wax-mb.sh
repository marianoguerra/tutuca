#!/bin/sh
# Builds the wax-mb compiler into .tools/wax-mb, pinned to the commit this
# project was written against. scripts/build.mjs uses it unless WAX_MB points
# at another wax-mb binary.
set -eu
REPO=https://github.com/marianoguerra/wax-mb
COMMIT=bc9c769
DIR="$(dirname "$0")/../.tools/wax-mb"
if [ ! -d "$DIR/.git" ]; then
	git clone "$REPO" "$DIR"
fi
cd "$DIR"
git fetch --quiet origin
git checkout --quiet "$COMMIT"
moon build --target native
echo "built $(pwd)/_build/native/debug/build/marianoguerra/wax-cli/wax-mb/wax-mb.exe"
