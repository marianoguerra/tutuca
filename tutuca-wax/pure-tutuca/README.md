# pure-tutuca: component modules to tutuca-wax

The MoonBit compiler from pure-tutuca component modules (`name.tutuca.ts`) to
tutuca-wax component modules. A module is TypeScript in pure-js's checked
subset, in the shape of tutuca's `component({...})`, and tutuca's JS loads the
same text (`componentModule`, `src/pure/module.js`). Its conventions and shared
corpus are in [`../../spec/pure-tutuca`](../../spec/pure-tutuca/README.md), and
the reference a model is given is
[`../studio/assistant/2-module.md`](../studio/assistant/2-module.md).

The compiler checks a module with pure-js, builds the model of its components
from what was checked, validates the model, generates the boilerplate (spec,
schema, vtable, routing each message to its handler), lowers the module's
functions to Wax, and compiles the module with the runtime's prelude.

```sh
moon build --target native     # the binary, in _build/native/debug/build/tutuca/pure-tutuca/cmd/pure-tutuca/
pure-tutuca check counter.tutuca.ts
pure-tutuca build counter.tutuca.ts --runtime .. -o counter.debug.wasm
pure-tutuca model counter.tutuca.ts -o counter.model.json        # format 2, tutuca's
pure-tutuca model counter.tutuca.ts --pbt-model -o counter.pbt-model.json   # for js/pbt.js
pure-tutuca explain counter.tutuca.ts Counter.count             # a field's constraints in words
moon test --target native      # the compiler's own tests
```

`--host a.json,b.json` gives the page's host modules a module may import
(`../../spec/pure-tutuca/host/*.json`, `dist/engines/*.host.json`).

Diagnostics go to stderr with the lines they're about underlined and the places
they relate to labeled ([error-report](https://mooncakes.io/docs/marianoguerra/error-report)),
in color on a terminal unless `NO_COLOR` is set. `--short` writes one
`file:line:col: error[code]: message` line each, for editors and grep, and
`--json` one JSON object each to stdout, the shape the playground reads. pure-js's
diagnostics keep their codes (`purejs.*`); the compiler's are `pure-tutuca.*`.

`scripts/build.mjs` builds the compiler and runs it for each module, then
wasm-opt as for the rest, and builds `web` for wasm-gc (`moon build --target
wasm-gc --release`) into `dist/pure-tutuca/pure-tutuca.wasm`: the compiler,
pure-js and wax-mb's library in the browser, which the playground and the
studio compile with. Both build byte-identical modules.

## From a module to the model

`pure/build.mbt` reads the checked module into the model (`check/model.mbt`):

- **Types** are pure-js's: `number` (with `{ int: true }` a whole number),
  `string`, `boolean`, a union of strings (an enum, held as its member's
  name), `T | null` and `x?: T` (optional), `T[]`, `{ [key: string]: T }`, a
  record, `unknown`, a component or interface of the module by name, and the
  host's `Component`. A union of components holds any of them.
- **Constraints** are the module's `constraints` data (`int`, `min`, `max`,
  `minLength`, `maxLength`, `pattern`, `keyOf`), per field, per message
  argument, per getter. `keyOf: "f"` makes a value a key of the list or map
  field `f`, which init checks once the component has all its fields.
- **Defaults** are the module's `defaults` data. A number without one starts
  at 0 pulled into its bounds, as tutuca's `t.number({ min: 1 })` does; a
  component field without one is made as the first component its type names.
- **Messages** are the `on` entries: arguments from `run`'s tuple, `pure`,
  `swap`, `sourceKey`, `why`, `changes`, whether it has a `pre` and a `post`,
  and what it emits, read from its literal `ctx` calls (`ctx.notify("x")`,
  `ctx.ask`, `ctx.make`, `ctx.reply`, `ctx.sendAt` to the components a field
  holds).
- **Signals** are `<C>Notifies` and `<C>Asks`; an `interface` is a component
  interface: its readonly members fields, its methods returning `Pure` pure
  messages, `Notify` notifies, and the rest queries.
- **Views** are the module's `tutuca/view` calls as view nodes
  (`ViewNode`): constants, `field`, `seqItem`, `provided`, `query`,
  `lookupBind`, `when`, `frag`, `render`, `renderEach`, `each`, `renderIt`,
  `withBinds`, `pushView` and elements, with their `"on:event+mods"`
  handlers' sends.
- The rest: `queries`, `invariants`, `init`, `loops`, `binds`, `provides`,
  `public`, `meta`, `implements`, `examples`; and at module level `register`,
  `askHandlers`, `hostAsks` and meta schemas (a const with `metaSchema`).
  The interfaces and meta schemas a module imports come from the model of the
  module that declares them.

`check/validate.mbt` then checks what the parts must meet together: defaults
of their types and constraints, constraints that can't hold, what a message
changes and emits, that a component implements its interfaces, metas against
their schemas, a main view per render target, registers and examples.
`check/views.mbt` checks the views: names that resolve, values read where they
mean something, loops and scopes declared, send arguments that fit the message
they go to.

## What's generated

`build` writes four files next to the module: `<package>.contract.wax`
(strings, the state types, helpers), `<package>.glue.wax` (each component's
views as view data, schema, spec, `init` with defaults and issues, `get`,
`set` validated against the schema, `handle` routing each message to its
handler, loop and scope trampolines, registration), `<package>.abi.wax`
(the runtime functions it imports) and `<package>.impl.wax` (the module's
functions lowered, `pure/lower.mbt`). The module carries a `tutuca` custom
section (`api/meta.mbt`, format 2) with its source and the ones it imports,
what it registers, what it needs from a scope and its components' `meta`, for
a page given only the `.wasm`. The runtime rejects arguments that don't fit a
message's schema before `handle` runs; in dev mode it checks each message's
`pre`, `post` and `changes`, what it emits, the fields and the invariants.

Names reach Wax as written. For a component `C` the lowered functions are
`C_on_<m>` (a message's `run`), `C_when_<m>` and `C_ensures_<m>` (its `pre`
and `post`), `C_inv_<n>`, `C_get_<g>`, `C_query_<q>`, `C_loop_<l>_<hook>`,
`C_scope_<s>`, `C_init` and `C_reply_<a>_<outcome>` (an ask's answers); an
ask handler is `<package>_answer_<a>`. The contract gives them the state
struct `C_state`, `C_with_<field>`, `C_notify_<n>`, `C_ask_<n>`,
`<type>_send_<m>`, `<type>_apply_<m>` for each pure message, and a string
constant for every string the module uses: a name it declares is `gs_` and
the name (`gs_TodoItem`, `gs_notes`), any other text `gt_` and what it says,
and "" is `gs_empty`. `compose` checks the lowered functions against what the
glue calls, and wax-mb's checker the whole module.

## Testing from the model

`model --pbt-model` writes the package as JSON in the runtime's names: types,
constraints, the order fields depend on each other, frames, emits,
invariants, examples. `js/pbt.js` reads it: `walk` runs random walks of
enabled messages on a headless dev host and shrinks a failing trace to a
1-minimal one; `exhaust` explores small state spaces breadth first, reporting
messages never enabled and states where none is; `examples` runs the
module's examples, an `expect` matching the fields it names.

## Layout

| package | does |
|---|---|
| `diag` | spans and diagnostics |
| `pure` | reading a module: checking it with pure-js (`reader.mbt`, with the host and the handlers' contextual types), building the model (`build.mbt`), what its views can't say (`views.mbt`), lowering its functions to Wax (`lower.mbt`, `helpers.mbt`), the format-2 model (`model.mbt`), host modules (`host.mbt`) |
| `check` | the model (`Package`), constraints, validating it, checking views, names |
| `gen` | the contract, the glue, the functions the lowered module must define |
| `compose` | the convention check, assembling the module, checking and compiling it with wax-mb's library |
| `export` | the model as JSON, for `js/pbt.js` |
| `api` | the pipeline over files a read function gives: load (with the modules it imports, paths normalized), build, the `tutuca` section |
| `cli`, `cmd/pure-tutuca` | the command, over an `Io`; the native binary |
| `web` | the compiler in the browser: `api` compiled to wasm-gc, exporting `pt_check`, `pt_model` and `pt_build`, JSON strings in and out (`../js/pt-web.js` loads it; `../playground/` and `../studio/` use it) |

It depends on `marianoguerra/wax` (wax-mb's library, through `moon.work`, from
`../.tools/wax-mb/lib`, which `just setup` builds) and `marianoguerra/pure-js`
(vendored in `../vendor/pure-js-mb`).
