# tutuca-wasm

tutuca's runtime compiled to WebAssembly, for components written as pure-tutuca modules
(`name.tutuca.ts`, [spec/pure-tutuca](../spec/pure-tutuca/README.md)). The same module runs in
tutuca (JavaScript, `componentModule` in `src/pure/module.js`) and here, and does the same in
both: the same states, the same problems reported, the same page.

```js
import { createRuntime } from "./js/tutuca-wasm.js";

const tutuca = await createRuntime({ document, rootNode });
await tutuca.load(source); // a pure-tutuca module: checked, compiled, registered
tutuca.start("Counter", { count: 1 });
tutuca.mount(); // renders, listens, and renders again after every change
tutuca.send("inc");
tutuca.state(); // { count: 2, step: 1 }
```

## How it is put together

- **A module is checked and compiled when it is loaded.** `componentModuleSource`
  (`src/pure/module.js`) reads it as tutuca does: the host it is checked against, each entry's
  signature, its model, each component's definition as data. pure-js (MoonBit, itself
  WebAssembly) checks that text again and compiles it to a WebAssembly module whose exports
  are the module's entries by path (`Counter.on.inc.run`). Nothing compiled elsewhere is
  trusted, and there is no ABI to version: a component's module imports what every pure-js
  module does.
- **The runtime** (`runtime/`, MoonBit, one WebAssembly module) is tutuca's own, file for
  file: types and `make` (`types.mbt`, as `src/core/model/types.js`), pure-js's values
  (`values.mbt`), components, contracts
  and dev checks (`runtime.mbt`), paths, tasks and notifications (`tree.mbt`, as `src/tree`),
  views (`view.mbt`, as `src/core/view/view.js`) and the virtual DOM (`vdom.mbt`, as
  `src/vdom`).
- **State is pure-js's values**: the records and lists a component's code works on are the
  ones the runtime holds, with nothing converted between them. A component is a record whose
  class is its name; what it doesn't hold (a query) the runtime computes. A handler reads its
  component frozen and changes a copy; a commit keeps of the old state every part that didn't
  change, so what is the same is the same value, as it is with immer.
- **The page** (`js/tutuca-wasm.js`) links the modules, gives compiled code what it asks of
  JavaScript (the methods of strings and numbers, the standard host, `tutuca/data`, the page's
  own modules), applies the runtime's changes to the DOM and tells it of events.

## The pages

| page | what it is |
|---|---|
| `playground/` | an editor: a module is checked, compiled and mounted as you edit it, beside its state, what the runtime reported, its model and the WebAssembly it became |
| `demos/` | the component modules of `components/`, each demo a root on a runtime of its own |
| `microagents/` | agents as packages (one component module and its prompt, tools and samples) with a chat that drives them through their messages; see its README |
| `studio/` | screens composed from layouts and components written in the page, kept in IndexedDB, each screen in a scope chain of its own, with an assistant that edits a component |

```sh
./site.sh                 # the pages and only what they load, in _site/
node scripts/serve.mjs    # http://127.0.0.1:8002/, files only
npm install               # once, for the server below
node scripts/server.mjs   # http://127.0.0.1:8003/, with models behind /api/ (keys from .env)
```

The servers serve `_site/` and never a file whose name starts with a dot; `.env` is read by
`server.mjs` and is in `.gitignore`.

## Scopes

A runtime has a tree of scopes, as tutuca has: `load(source, { scope: ["a", "b"] })` registers
a module's components, interfaces, meta schemas and ask handlers in the scope a path of names
selects, `start(type, fields, { scope })` makes the root there, and `leave(scope)` forgets one.
A name is looked up from a scope outwards, so an inner registration hides an outer one, and a
component carries the scope it was made in: what its handlers make, list and ask for, they do
from there. In fields, message arguments and an ask's answer, `{ $make: Type, fields, scope }`
is a component to make.

What a page asks without running anything: `fits` (whether a type makes from JSON as it is),
`messageProblem` (why a message can't be handled now), `query`, `typeAt`, `names`, `capture`
(a component tree as what makes it again), and `hold`/`put` to put a part of the state back.

## Build and test

```sh
./build.sh                       # dist/: the runtime, pure-js, the glue for a page, the agents
node --test test/                # 101 tests
```

`build.sh` needs MoonBit (for the runtime), Node, and `npm install` at the repository's root
(esbuild, and the `src/pure` the glue imports). pure-js is vendored, built, in
`vendor/pure-js/`; `vendor-pure-js.sh` refreshes it from a checkout of pure-js in MoonBit
(`PURE_JS_MB`, `../../mb/pure-js` when unset). The micro-agents' engines are the bundles
tutuca's `scripts/vendor.js` makes in `../demos/deps/`.

- `test/parity.test.mjs`: scripts of messages, DOM events and drags sent to both runtimes over
  the conformance modules, the counters board and the kanban; after each step, the same state,
  the same problems and the same page. It covers asks answered by a module, by the page (now
  and later) and by nobody, `sendAt`, swaps, notifications handled by a parent, and drops.
- `test/sweep.test.mjs`: every component of every module in the repository (the micro-agents
  from their samples, with their engines), made and rendered in both, then sent the same
  sequence of events; after each, the same state, problems and page.
- `test/scopes.test.mjs`: the same name in two scopes, a layout and an agent below a scope, and
  what a page asks of a component.
- `test/microagents.test.mjs`: every built-in agent's package and tools, and the shell with a
  scripted model.

The studio has no test of its own yet: it was checked by hand in a browser.

## Not yet

- Watches on `ctx.sendAt` (settled, progress, timeout) and `ctx.cancel`: no module uses them.
- Render targets other than the page (`renders`).
- The identity checks on a task's address (stale, orphaned, lost) and the foreign-write check.
- The checks a scope makes when a component is registered (its interfaces, its meta against a
  schema).
- One root for each runtime: a page with several makes several runtimes.
- A draft is a copy of the whole root; copying only the path a handler is at comes with a
  render cache. Neither changes what a component does.
- A component module can't be exported from the studio with the modules it imports: it is its
  own text only.
