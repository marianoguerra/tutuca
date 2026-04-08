clean:
    npm run clean

dist:
    npm run dist

dist-immutable:
    npm run dist-immutable

dist-all:
    npm run dist-all

publish:
    npm run publish

publish-dry:
    npm run publish-dry

test:
    npm run test

test-watch:
    npm run test-watch

format:
    npm run format

lint:
    npm run lint

lint-fix:
    npm run lint-fix

fix:
    npm run fix

render-examples MODULE:
    npm run render-examples -- {{MODULE}}

component-api-docs MODULE:
    npm run component-api-docs -- {{MODULE}}

vdom-stresstest iterations="100000" seed="":
    npm run vdom-stresstest -- {{iterations}} {{seed}}

smoke-test-cli-render-examples:
    npm run smoke-test-cli-render-examples

smoke-test-cli-component-api-docs:
    npm run smoke-test-cli-component-api-docs

smoke-test:
    npm run smoke-test

sync-playground:
    npm run sync-playground
