clean:
    rm -rf dist

dist: clean
    mkdir dist
    just dist-mod "index.js" "tutuca"
    just dist-mod "extra.js" "tutuca-extra"
    just dist-mod "dev.js" "tutuca-dev"
    cp -r resources/base-project dist/base-project
    mkdir dist/base-project/deps

dist-mod IN OUT:
    bun build {{IN}} --outfile dist/{{OUT}}.js --format esm
    bun build {{IN}} --outfile dist/{{OUT}}.min.js --format esm --minify
    brotli dist/{{OUT}}.min.js -o dist/{{OUT}}.min.js.br

dist-immutable repo="https://github.com/marianoguerra/immutable-js.git" branch="7.x":
    git clone --depth 1 --branch {{branch}} {{repo}}
    cd immutable-js; npm install; npm run build; cp dist/immutable.js ../deps/immutable.js
    rm -rf immutable-js

dist-all: dist-immutable dist

publish: dist-all
    npm publish --access public

publish-dry: dist-all
    npm publish --dry-run

test FILES="test/*.test.js":
    bun test {{FILES}}

test-watch FILES="test/*.test.js":
    bun test --watch {{FILES}}

format FILES="src test/*.js":
    bunx @biomejs/biome format --write {{FILES}}

lint FILES="src test/*.js":
    bunx @biomejs/biome lint {{FILES}}

lint-fix FILES="src test/*.js":
    bunx @biomejs/biome lint --write {{FILES}}

fix FILES="src test/*.js":
    bunx @biomejs/biome check --write {{FILES}}

render-examples MODULE:
    bun tools/render-examples.js {{MODULE}}

component-api-docs MODULE:
    bun tools/component-api-docs.js {{MODULE}}

vdom-stresstest iterations="100000" seed="":
    bun tools/vdom-stresstest.js {{iterations}} {{seed}}

smoke-test-cli-render-examples:
    bun tools/render-examples.js ./test/todo.js

smoke-test-cli-component-api-docs:
    bun tools/component-api-docs.js ./test/todo.js
    bun tools/component-api-docs.js ./test/json.js
