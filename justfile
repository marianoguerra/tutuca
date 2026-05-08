clean:
    npm run clean

dist:
    npm run dist

dist-immutable:
    npm run dist-immutable

dist-all:
    npm run dist-all

publish:
    bun run release

publish-dry:
    bun run release-dry

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

tutuca *ARGS:
    bun tools/tutuca.js {{ARGS}}

get MODULE:
    bun tools/tutuca.js get {{MODULE}}

list MODULE:
    bun tools/tutuca.js list {{MODULE}}

examples MODULE:
    bun tools/tutuca.js examples {{MODULE}}

show MODULE NAME="":
    bun tools/tutuca.js show {{MODULE}} {{NAME}}

lint-components MODULE NAME="":
    bun tools/tutuca.js lint {{MODULE}} {{NAME}}

render MODULE NAME="":
    bun tools/tutuca.js render {{MODULE}} {{NAME}}

doctor MODULE:
    bun tools/tutuca.js doctor {{MODULE}}

stresstest iterations="100000" seed="":
    bun scripts/stresstest.js --iterations {{iterations}} {{ if seed != "" { "--seed " + seed } else { "" } }}

smoke-test:
    npm run smoke-test

sync-playground:
    npm run sync-playground
