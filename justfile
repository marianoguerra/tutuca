# Tasks for tutuca. `just` lists them.

port := "8000"

default:
    @just --list

# Install the dev dependencies.
install:
    npm install

# Run every test.
test:
    npm test

# Run the tests whose names match pattern, e.g. `just test-only "Todo/App"`.
test-only pattern:
    node --test --test-name-pattern="{{pattern}}" test/*/*.test.js

# Run the tests of one file, e.g. `just test-file stories`.
test-file name:
    node --test test/*/{{name}}.test.js

# Run the tests again on every change.
watch:
    node --test --watch test/*/*.test.js

# Lint and check formatting; biome.json leaves out the vendored deps/ and build output.
lint:
    npm run lint

# Format and apply safe lint fixes.
fmt:
    npm run fmt

# Lint, then test: what to run before a commit.
check: lint test

# Serve the repo for the browser pages, printing the URL of path.
serve path="":
    @echo "http://127.0.0.1:{{port}}/{{path}}"
    python3 -m http.server {{port}} --bind 127.0.0.1

# Serve and print the URL of the demos.
demos: (serve "demos/")

# Serve one demo as an app, without the demos' chrome, with the inference API beside it (its
# agents ask models; keys from tutuca-wax/.env): `just app canvas` → http://127.0.0.1:8010/,
# then ?bundle=, ?sync= and ?doc= as on the demo.
app demo="canvas" port="8010" *flags="":
    node scripts/app.js {{demo}} {{port}} {{flags}}

# Serve and print the URL of the storybook, optionally at a story, e.g. `just storybook Todo/App/Today`.
storybook story="": (serve "storybook.html#" + story)

# Build the CDN bundles in dist/.
dist:
    npm run dist

# immer is deps/immer.js; codemirror (site/deps/) and automerge (demos/deps/) are gitignored and
# `just site` builds them when missing.
# Rebuild a vendored bundle after bumping its packages, e.g. `just vendor immer`.
vendor name:
    node scripts/vendor.js {{name}}

# Check what gets published: imports by package name, bundle exports, tarball contents.
smoke: dist
    npm run smoke

# Typeset the formal semantics into spec/semantics.pdf (needs Racket with Redex).
spec:
    racket spec/render.rkt

# Run the tests of the formal semantics.
spec-test:
    raco test spec/

# Build the landing page, storybook and spec PDF into _site/ and serve it.
site: spec
    node scripts/site.js
    @echo "http://127.0.0.1:{{port}}/"
    python3 -m http.server {{port}} --bind 127.0.0.1 -d _site

# Print files, lines and code lines per src submodule.
loc:
    node scripts/loc.js

# Draw the class diagram of the core into <out>/tutuca-core.svg (needs Graphviz), beside the .dot, .mmd and .json it comes from.
class-diagram out=".":
    node scripts/class-diagram.js src/tutuca.js {{out}}
    dot -Tsvg {{out}}/tutuca-core.dot -o {{out}}/tutuca-core.svg
    @echo "{{out}}/tutuca-core.svg"

# Show what would be published, without publishing.
publish-dry:
    npm publish --dry-run --tag latest

# Publish to npm as latest (npm needs the tag spelled out for a prerelease); prepublishOnly lints, tests, builds and smoke tests first.
publish:
    npm publish --access public --tag latest

# Bump the version (e.g. `just release prerelease`), commit, tag and push.
release version:
    npm version {{version}}
    git push --follow-tags
