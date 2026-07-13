publish:
    npm run release

publish-dry:
    npm run release-dry

tutuca *ARGS:
    node tools/tutuca.js {{ARGS}}

get MODULE:
    node tools/tutuca.js get {{MODULE}}

list MODULE:
    node tools/tutuca.js list {{MODULE}}

examples MODULE:
    node tools/tutuca.js examples {{MODULE}}

show MODULE NAME="":
    node tools/tutuca.js show {{MODULE}} {{NAME}}

lint-components MODULE NAME="":
    node tools/tutuca.js lint {{MODULE}} {{NAME}}

render MODULE NAME="":
    node tools/tutuca.js render {{MODULE}} {{NAME}}

stresstest iterations="100000" seed="":
    node scripts/stresstest.js --iterations {{iterations}} {{ if seed != "" { "--seed " + seed } else { "" } }}
