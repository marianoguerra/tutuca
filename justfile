publish:
    bun run release

publish-dry:
    bun run release-dry

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

stresstest iterations="100000" seed="":
    bun scripts/stresstest.js --iterations {{iterations}} {{ if seed != "" { "--seed " + seed } else { "" } }}
