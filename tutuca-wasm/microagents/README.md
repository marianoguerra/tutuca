# Micro-agents

The micro-agents app, where **an agent is one pure-tutuca component module** and what the shell
needs to offer it: its manifest, prompt, skills, tools and samples. Packed, it is one JSON
document, a package (`agent.js` has the format), which the shell checks and compiles to
WebAssembly as it loads it, into a scope of its own. The data an agent opens is plain JSON.

```
./build.sh                    # in tutuca-wasm: packs the agents into dist/agents/
npm run serve                 # then http://127.0.0.1:8003/microagents/?loadAgents=all (models from .env)
node --test test/microagents.test.mjs
```

## Layout

| file | does |
|---|---|
| `kit/kit.tutuca.ts` | `MicroAgent`, the interface every agent's root implements (`summary`, `domain`, `data`) |
| `microagents.tutuca.ts` | the shell: `AgentCard`s, `Session` tabs (workspace + chat), `MicroAgents` |
| `agent.js` | the package format, loading an agent into its scope, the contract check, matching |
| `tools.js` | the module's types → JSON Schema, the shared tools, running a tool call (checked, sent, undone when it breaks a check) |
| `app.js` | the page's answers to the shell's asks, with no DOM: agents, sessions, the model loop |
| `loop.js`, `llm.js` | the loop's steps and the model client |
| `main.js`, `store.js` | the page: styles, dropping files, installed agents in IndexedDB |
| `pack.mjs` | packs each agent's folder into its package (`build.sh` runs it) |
| `engines/` | the page's functions agents import as host modules (`microagents/regex`, ...) |

## Writing an agent

`agents/<id>/` holds:

```
agent.tutuca.ts  the root (implements MicroAgent, imported from ../../kit/kit.tutuca) and its rows
manifest.json    { id, title, description, needs, icon, version, root, hostModules: [engines],
                   skills: [paths], tools: [{ name, kind: "message" | "view", description, result? }] }
prompt.md      the system prompt (the shell adds the skills index and the root's summary)
skills/<path>  the read-only skills folder
samples/*.json JSON documents it opens; empty.json is required
```

- **Opening.** The root's fields are the document's keys. A document opens
  with the agent when the root makes from it with no issue, other than missing
  fields that have defaults. So the fields' types and `constraints` say what the
  agent opens (`pointers: { minLength: 1 }`, with no default, makes `pointers`
  required). Use `init` to build child components from the data.
- **Tools.**
  - A message tool is a message of the root.
  - A view tool is a query: a method (it takes arguments) or a getter.
  - Parameters come from the root's schema: names, types and constraints
    become JSON Schema.
  - Its description is the manifest's.
  - `result` names the query a message tool answers with (`summary` by default).
- **Checked first, undone after.** A call that `messageProblem` rejects (wrong
  types, a failing `pre`) never runs, and the model reads why. A call that
  breaks `post`, `changes` or an invariant in dev mode is undone.
- **Data.** `data` is the JSON the agent exports (and `exportPreview`
  shows); `domain` is what `getState` answers.
- **Engines.** What only the page can do (regular expressions, jq, cron, …)
  is an engine, `engines/<name>.js`: its `declaration` (a specifier such as
  `microagents/regex`, a module name, its members' TypeScript signatures)
  is what an agent imports and the compiler checks it against, and `make()` gives the
  members, which answer (null, "", a record saying the error) rather than
  throw. The shell defines each as `Module.member`; what one returns is
  checked against its declared type. tutuca/data's `parseJson`, `toJson`,
  `get` and `itemsOf` read and write JSON.

`regex-lab` is the reference.

## The agents

jsonpointer-lab, regex-lab, json-schema-lab, jsonpath-lab, jq-lab, glob-lab,
vega-lite-lab, echarts-lab, cron-lab and datefmt-lab. The engines are the
page's host functions (`engines/<module>.js`, named by a manifest's
`hostModules`). The bundles are copied from tutuca's `demos/deps/` into
`dist/engines/` by the build. Charts draw in `<ma-vega>` and `<ma-svg>`
(`elements.js`).

## Not ported yet

- **blockkit-lab, css-layout-lab and the Agent Builder.** tq-lab is
  TData-specific.
- **vega-lite-lab's `render_svg`.** vega renders asynchronously, so it can't
  be a synchronous host function.
- **Per-tool chat views (`toolViews`).**
- **The shared UI kit:** `List` with drag, `JsonView` trees and the pager.
  The agents use one-level lists and textareas instead.
- **Map key order.** The runtime's maps don't keep key order, so JSON objects
  come back reordered in summaries, editors and exports.
