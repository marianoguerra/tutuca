# Micro-agents in tutuca-wax

The micro-agents app, where **an agent is one `.wasm` component module**
built by tcd. Its code and views are the module. Its manifest, prompt, skills,
tools and samples are JSON in a custom section named `microagent`. The data an
agent opens is plain JSON; TData and tq aren't used here. It replaced the JS app
that was in `apps/microagents/` (still in git history, at 257cd94).

```
just microagents        # build, then http://127.0.0.1:8003/microagents/ (models from .env)
just test-microagents   # each agent's contract, samples and tools; the shell with a scripted model
```

## Layout

| file | does |
|---|---|
| `kit/kit.tcd` | `MicroAgent`, the interface every agent's root implements (`summary`, `domain`, `data`) |
| `microagents.tcd/.wax` | the shell: `AgentCard`s, `Session` tabs (workspace + chat), `MicroAgents` |
| `agent.js` | the format: reading/packing the section, loading an agent into a scope, the contract check, matching |
| `tools.js` | TCD types → JSON Schema, the shared tools, running a tool call (checked, sent, undone on a dev-mode issue) |
| `app.js` | the host's answers to the shell's asks, with no DOM: agents, sessions, the model loop |
| `loop.js`, `llm.js` | the loop's steps and the model client (ported from `apps/microagents/core`) |
| `main.js`, `store.js` | the page: styles, dropping files, installed agents in IndexedDB |
| `../scripts/pack-agent.mjs` | packs an agent's folder into its built module (`scripts/build.mjs` runs it) |

## Writing an agent

`agents/<id>/` holds:

```
agent.tcd      the root (implements MicroAgent, from ../../kit/kit.tcd) and its rows
agent.wax      what the .tcd can't say
manifest.json  { id, title, description, needs, icon, version, root, skills: [paths],
                 tools: [{ name, kind: "message" | "view", description?, result? }] }
prompt.md      the system prompt (the shell adds the skills index and the root's summary)
skills/<path>  the read-only skills folder
samples/*.json JSON documents it opens; empty.json is required
```

- **Opening.** The root's fields are the document's keys. A document opens
  with the agent when the root makes from it with no issue, other than missing
  fields that have defaults. So the fields' types and `where`s say what the
  agent opens (`where len(pointers) >= 1` makes `pointers` required). Use
  `init;` to build child components from the data.
- **Tools.**
  - A message tool is a message of the root.
  - A view tool is a `query` (it takes arguments) or a `get`.
  - Parameters come from the root's schema: names, types and `where`s become
    JSON Schema.
  - A tool without a description takes its member's `///` doc.
  - `result` names the get a message tool answers with (`summary` by default).
- **Checked first, undone after.** A call that `messageProblem` rejects (wrong
  types, a failing `when`) never runs, and the model reads why. A call that
  breaks `ensures`, `changes` or an invariant in dev mode is undone.
- **Data.** `data` is the JSON the agent exports (and `export_preview`
  shows); `domain` is what `get_state` answers.
- **What the runtime adds for agents:**
  - `str_slice`, `str_index_of`, `str_lower`, `str_upper`, `str_trim`,
    `str_replace_all`, `str_split`, `str_join`;
  - `value_json(v, indent)`;
  - `host_call(name, args)` for the page's functions (`runtime.defineHostFn`).
    `json_parse` is always defined.

`regex-lab` is the reference; `PORTING.md` is the guide the ports followed.

## The agents

jsonpointer-lab, regex-lab, json-schema-lab, jsonpath-lab, jq-lab, glob-lab,
vega-lite-lab, echarts-lab, cron-lab and datefmt-lab. The engines are the
page's host functions (`engines/<module>.js`, named by a manifest's
`hostFns`). The bundles are copied from tutuca's `demos/deps/` into
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
