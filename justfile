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

# Serve the repo for the browser pages.
serve:
    python3 -m http.server {{port}} --bind 127.0.0.1

# Serve and print the URL of the demos.
demos:
    @echo "http://127.0.0.1:{{port}}/demos/"
    python3 -m http.server {{port}} --bind 127.0.0.1

# Serve and print the URL of the storybook, optionally at a story, e.g. `just storybook Todo/App/Today`.
storybook story="":
    @echo "http://127.0.0.1:{{port}}/storybook.html#{{story}}"
    python3 -m http.server {{port}} --bind 127.0.0.1

# Build the CDN bundles in dist/.
dist:
    npm run dist

# Rebuild deps/immer.js from the immer devDependency, after bumping it in package.json.
vendor-immer:
    npm run vendor-immer

# Rebuild site/deps/codemirror.js for the playground, after bumping the codemirror packages.
vendor-codemirror:
    npm run vendor-codemirror

# Rebuild demos/deps/automerge.js for the Automerge demo (gitignored; `just site` builds it).
vendor-automerge:
    npm run vendor-automerge

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
    npm run site
    @echo "http://127.0.0.1:{{port}}/"
    python3 -m http.server {{port}} --bind 127.0.0.1 -d _site

# Show what would be published, without publishing.
publish-dry:
    npm publish --dry-run --tag next

# Publish to npm under the next tag; prepublishOnly lints, tests, builds and smoke tests first.
publish:
    npm publish --access public --tag next

# Bump the version (e.g. `just release prerelease`), commit, tag and push.
release version:
    npm version {{version}}
    git push --follow-tags
