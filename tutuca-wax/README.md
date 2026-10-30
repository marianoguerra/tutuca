# tutuca-wax

tutuca's runtime in [Wax](https://github.com/ocsigen/wax), compiled to
wasm-gc with [wax-mb](https://github.com/marianoguerra/wax-mb). NOTES.md
has the design. Implemented so far:

- the `Value` type (null, bool, int, float, string, list, map, result,
  component), with `List` and `Map` over wax-mb's persistent vector and hash
  map, vendored in `vendor/wax-mb`;
- the vdom: shapes, vnodes whose props are values, and building and morphing
  the DOM, ported from tutuca's `src/vdom.js`;
- the semantic tree a view evaluates to, and lowering it to vnodes with the
  metadata comments routing reads back, from the spec's `view/sem.rkt`,
  `bind/meta.rkt` and `bind/lower.rkt`;
- the component runtime: components, their specs and vtables, scopes, paths,
  the handler context and its effects, the host's tasks and transactions,
  asks, rendering components, and routing DOM events back to their handlers,
  from NOTES.md, tutuca's `src/host.js`, `src/tasks.js`, `src/paths.js`,
  `src/scope.js` and `src/events.js`, and the spec's `component/paths.rkt`,
  `bind/decode.rkt` and `system/host.rkt`;
- component modules: a component type is a `.wasm` of its own, loaded at run
  time, that imports the runtime's functions and shares its types through a
  prelude both are built with. `components/` has the examples, which the
  tests and demos load;
- components defined in TCD (`tcd/`, its README has the language): a
  WIT-style `.tcd` file says a component's state, protocol (messages with
  their guards, frames, relations and effects) and views; tcd checks it,
  generates the boilerplate (spec, schema, vtable, routing each message to
  its handler), holds the hand-written `.wax` (only what each handler does)
  to a naming convention, and compiles the module. Every example but `probe`
  is written this way, and `js/pbt.js` tests components from the model tcd
  exports: random walks with shrinking, exhaustive exploration, examples.

## Use

```sh
just setup      # npm install (jsdom, Playwright, binaryen's wasm-opt), and builds wax-mb into .tools/, pinned (or set WAX_MB to a wax-mb binary)
just test       # format check, build, then the tests in jsdom, tcd in wasm-gc, against JS, and in Chromium
just            # lists the rest: build, check, fmt, test-one, wat, size, vendor, ...
```

The npm scripts (`npm run setup`, `npm test`, ...) run the same steps, for
when `just` isn't installed.

`just demos` builds and serves `demos/` at http://127.0.0.1:8002/demos/ (`just
demos 9000` for another port): component modules loaded when asked, the
example components mounted in a page, each
with its state and what its host observed (logs, unhandled messages, failed
tasks), buttons that send the root messages from outside, and the bare vdom
re-rendering a keyed list with a count of the DOM mutations each render
caused. Rebuild and reload to see a change. The page and the components are
styled only with Tailwind and margaui classes (margaui uses daisyUI's class
names), compiled in the page as modules load (the next section).

`just playground` builds and serves `playground/` at
http://127.0.0.1:8002/playground/: write a component in the browser. Pick an
example (or the clicker, a starting point), edit its `.tcd` and `.wax` in a
CodeMirror editor, and Compile (Ctrl/Cmd-Enter): tcd and wax-mb's library,
compiled to wasm-gc (`tcd/web`, `dist/tcd/tcd.wasm`, about 2.5 MB), run in a
worker and build the same module the native tcd does. Diagnostics show inline
and in a list; the generated contract, glue, ABI imports and model open as
read-only tabs. The module is loaded into a fresh scope, next to the prebuilt
modules the example composes with (todo_card's TodoItem inside the prebuilt
TodoList), and its root mounted on a dev host, with its state, logs and the
issues the dev checks report. Add missing functions appends `tcd stub
--missing`'s stubs to the `.wax`; Test runs the model's examples and random
walks (`js/pbt.js`). Edits are kept per example in localStorage. It needs the
js-string builtins (Chrome 131, Firefox 134 and later).

`just studio` serves `studio/`, which keeps what you write. The studio is
built with itself where it can: its tabs, scope picker, menu, editor and assistant are a
tutuca-wax module (`studio/studio.tcd`, `dist/components/studio.wasm`) that
`studio.js` hosts, answering its asks for what only the page can do. It's a
set of screens, one tab each, and the tab bar's + makes another: pick the scope it's
made in from the tree of scopes, or add one there. Scopes are a tree, from a
root that registers the layouts, each registering library components or
prebuilt modules. Opening a screen makes its scope chain from scratch, loads
each scope's registrations and mounts the layout, a `Screen` whose toggle
switches between using it and editing it. The studio makes it with `studio`
set, which the `Screen` provides to what's below: a hole's list then offers
a new component, and each slot a ✎, asks the studio answers
(`create_component`, `edit_component`) and other hosts leave out. Either
turns the page into the editor: the `.tcd` and `.wax`, a preview of what
they build (made in the screen's scope chain, on the studio's own host),
the diagnostics, what it registers, the preview's state and events, and the
assistant when there is one. A new component starts from the assistant's
tasks example; "Start from…" replaces its sources with another example's
(asking first when they changed): the ones the build lists in
`dist/examples.json`, the assistant's and the component modules', so a
prebuilt module can be made a component of the library. Save & register keeps it in IndexedDB with its last build
(built again only when its sources or tcd change) and registers it in the
screen's scope, where the hole's list, still open, now has it; saving an
edited one makes the screen again with it. A name a registration of the
same scope gives can't be given again, but one a parent scope gives can:
the inner one hides it there, and the screen is made again with it. So a
copy of `layout` saved in a screen's scope gives that scope's screens a
Screen, Hbox, ... of their own, edited with ✎, while the others keep
root's. A `use "x.tcd"` (or a path ending
in it, `"../x/x.tcd"`) reads another component of the library or a
prebuilt module's `.tcd`. The layout keeps
itself as it changes, as `js/hydrate.js`'s `capture` writes it: each
component by the name it's made by in that scope and its fields, those that
sync at no level left out. The ⋯ menu shows the layout as JSON, and Export
and Import move the library as a JSON bundle, without the builds. Export
components downloads each of the library's components the shown screen's
scopes register as its `.wasm`, which carries its sources (tcd's `tutuca`
section, below); a `.wasm` dropped on a screen, or given to Import, is kept
as a component of the library with those sources, its `.wasm` as its build,
and registered in that screen's scope like one made there, as a prebuilt
module's `dist/components/*.wasm` can be too. A toast says what was imported, what
wasn't and why, and what an imported module needs that the scope doesn't
give (a type it makes, an interface it implements, a host ask the studio
doesn't answer); the events keep it, and the bar says what was imported.
Files dropped anywhere are taken, never opened by the browser: with no
screen shown, or the editor open, the toast says why nothing was imported.

`just studio-server` serves the same studio with an LLM assistant
(`scripts/studio-server.mjs`, over [pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai)):
copy `.env.example` to `.env` and set the API keys you have, and the studio
finds `/api/check`, which lists the models of every provider with a key
that `scripts/studio-models.mjs`'s rules pick (GPT 6 and 5.6, Claude 5 and
5.5, and the latest small, middle and large DeepSeek, Muse, GLM, Kimi K3,
Qwen, MiMo and Grok, from whichever provider carries them), and
shows an Assistant toggle in the editor (served as files only, as on GitHub
Pages, there's no API and no button). A message is sent with the
transcript, kept in pi's format with the component, and the component as it
is now; the server adds the system prompt and asks the model chosen. The
model edits through one tool, `write_component`, with the whole new `.tcd`
or `.wax`; the studio builds what it wrote and answers with the tool's
result, which says what it registers or gives tcd's diagnostics (each
with tcd's hint, the line it points at and carets under the place, and
marked when it was there after the model's last change too) and the
signatures of the functions still missing, and asks again, up to four
tries, stopping sooner when two tries in a row leave the same errors.
The system prompt is read from `studio/assistant/` on every request: the
`*.md` files in order (the role, the `.tcd` language, Wax and the naming
convention, the examples), the example modules in `examples/` (which
`test/tcd-web.test.mjs` builds and runs), and the runtime functions a `.wax`
can call, from `src/abi.wax`. "What the model is told" in the panel shows
it.

```js
import { loadRuntimeFiles, loadTcd } from "./js/tcd-web.js";

// tcd in the browser (or Node 24): JSON-shaped requests, what the CLI's commands do.
const tcd = await loadTcd(new URL("./dist/tcd/tcd.wasm", import.meta.url));
const runtime = await loadRuntimeFiles(new URL("./", import.meta.url)); // prelude, collections, src/abi.wax
const files = { "c.tcd": tcdText }; // the main .tcd and the ones it uses, by path
const res = tcd.build({ main: "c.tcd", files, impls: [{ path: "c.wax", text: waxText }], runtime });
// { ok, diags, contract, glue, abi, model, types, wasm: Uint8Array }; also check, stub, model
if (res.ok) await tw.loadComponent(res.wasm, scope);
```

```js
import { load } from "./js/tutuca-rt.js";

// The runtime, then a component module, which registers its types in a scope.
const tw = await load(new URL("./dist/tutuca-rt.wasm", import.meta.url));
const scope = tw.runtime.scope();
await tw.loadComponent(new URL("./dist/components/counter.wasm", import.meta.url), scope);
const root = tw.runtime.make(scope, "Board", { counters: [], total: 0 });
const host = tw.runtime.createHost(document, container, root).mount();
// Clicks in container now reach the components' handlers.
host.send("add_counter"); // a message to the root, from outside
host.sendAt([["counters", 0]], "reset"); // to the component steps reach from the root

// The vdom alone.
const { h } = tw;
let prev = tw.render(document, container, [h("p", { class: "a" }, "hi")]);
prev = tw.render(document, container, [h("p", { class: "b" }, "hi")], prev);
```

### CSS for the classes components use

`loadComponent` resolves with the constant class names the views of the types
the module registered use (`classes`): views are data, so a walker collects
them, every `if` branch and loop body included (`views_collect_classes`).
`js/css.js` turns them into CSS with `vendor/margaui/margaui-css.wasm`, the
Tailwind CSS v4 compiler with margaui built in, which imports nothing and
needs the engine's js-string builtins:

```js
import { classStyles, loadCssCompiler } from "./js/css.js";

// One set of classes, compiled again into the <style> whenever it grows.
const styles = classStyles(await loadCssCompiler(), document.querySelector("#classes"), ["page classes"]);
styles.add((await tw.loadComponent(url, scope)).classes);
```

The compiled CSS has no theme: load `vendor/margaui/themes/light.css` (which
also applies to `:root`) and `dark.css` (under `[data-theme="dark"]`), as
`demos/demos.js` does. A class computed from the state isn't seen: write
classes as constants, or `if`s of constants.

## Layout

| | |
|---|---|
| `prelude/*.wax` | what the runtime and component modules share: types and i32 consts, no code |
| `src/*.wax` | the runtime, one concern per file; `src/abi.wax` is what component modules import |
| `lib/*.wax` | helpers for writing component types, compiled into the runtime and imported |
| `components/<module>/` | the example component modules, each a `.tcd` and the `.wax` implementing what it can't say: `counter` (Board, Counter, Label), `todo_list` (and the TodoItem interface), two implementations of TodoItem, `todo_item` (a checkbox) and `todo_card` (a card with buttons), all three dragged to reorder, `showcase` (Shelf and Note: scopes, loop hooks, provided values, `push_view`, `render_it`, drag and drop), `json` (tutuca's JSON viewer and editor: a type per kind of value, JsonEditor above them), `media` (views outside HTML: Dot in SVG, Sum in MathML, Rating holding `tw-rating`, a custom element defined in its `rating.js`, through the CustomEvent's detail), `layout` (Hbox, Vbox, Tabs and Grid holding Holes, which ask what their scope can make and swap themselves for the one picked, and a Screen toggling between using a layout, each component's main view, and editing it, by pushing the `layout_edit` view that any component can declare to opt in); `kanban` (Kanban and KanbanLane: cards dragged between lanes, a lane's notify the board answers with `send`s, a limit per lane; it needs nothing from its scope, and the studio doesn't list it, to drop its `.wasm` on a screen); and for the tests `probe`, written by hand (Probe breaks its own schema; Pretender and Impostor fail TodoList's TodoItem interface), and `pbt` (a seeded bug and a dead end for `js/pbt.js` to find) |
| `tcd/` | the TCD tool, in MoonBit (its README has the language and the naming convention) |
| `scripts/build.mjs` | assembles and compiles `dist/tutuca-rt.wasm` and `dist/components/<module>.wasm`, generating the prelude files components need, and optimizes them with wasm-opt |
| `scripts/format.mjs` | `wax-mb format` over the sources (`npm run format`, `--check` in `npm test`) |
| `scripts/setup-wax-mb.sh` | clones and builds the pinned wax-mb into `.tools/` |
| `js/tutuca-rt.js` | the host side: the imports (DOM, env, host), loading the runtime and component modules, building values, vnodes and semantic trees from JS values, driving a host |
| `js/pbt.js` | testing components from their TCD model (`dist/components/*.model.json`): random walks of enabled messages on a headless dev host, shrunk to a 1-minimal failing trace; exhaustive exploration of small state spaces; example blocks |
| `js/tcd-web.js` | loads `dist/tcd/tcd.wasm` (tcd compiled to wasm-gc) and the runtime sources it builds components with |
| `js/json-example.js` | components/json's tree for a JSON value, shared by the demos and the playground |
| `js/hydrate.js` | `hydrate` makes components from `{ $make, fields }` / `{ $json }` JSON in a scope, `capture` writes a component tree that way |
| `js/page.js` | what the playground and the studio share: elements, margaui's themes and CSS, the compiler worker |
| `js/css.js` | CSS for collected classes: loads margaui-css.wasm, compiles the set of classes loaded modules use into a `<style>` |
| `vendor/margaui/` | margaui-css.wasm (tailwindcss-moonbit v0.5.0) and margaui's light and dark themes, pinned (`just vendor-margaui`) |
| `test/suite.mjs` | the vdom, lowering, value, path and component cases, written once for both test environments |
| `test/jsdom.test.mjs` | the suite in Node against jsdom, with the js-string builtins and with the polyfills |
| `test/parity.test.mjs` | random vnode trees, frames and semantic trees, against tutuca's own runtime, compared step by step |
| `test/tcd-web.test.mjs` | tcd in wasm-gc, in Node: builds the module the native tcd does, diagnostics, stubs, uses |
| `test/browser.test.mjs` | the suite in Chromium, through Playwright, and smoke tests of the demos page, the playground and the studio |
| `demos/` | the demos page (`just demos`) |
| `playground/` | the playground (`just playground`): `playground.js` the page, `compiler.worker.js` tcd in a worker, `examples.js` the examples, `editor.src.js` the editor, bundled with CodeMirror into `deps/editor.js` (committed; `just vendor-editor`) |
| `studio/` | the studio (`just studio`): `studio.tcd`/`studio.wax` its tabs, scope picker, menu, editor and assistant, `studio.js` the page that hosts them, `code-editor.js` the editor's custom element (`tw-code-editor`, around CodeMirror), `store.js` the library in IndexedDB and its bundles, `assistant.js` what the page asks the server for the assistant, `assistant/` what its model is told (the reference and example modules) |
| `scripts/studio-server.mjs` | the studio with its assistant's API (`just studio-server`): `/api/check`, `/api/chat`, `/api/prompt`, keys from `.env` |
| `scripts/serve.mjs` | the static server for the demos, the playground, the studio and the browser tests |
| `wax-mb-usage-feedback.md` | what writing this taught about wax-mb: bugs, diagnostics, friction |

## Modules, assembled

Wax has no source imports, package manager or generics: wax-mb's own standard
library is distributed as files to concatenate before the code that uses them.
So is this: each module is its sources concatenated. `scripts/build.mjs`
lists them in order, each after the ones it uses (a type has to be declared
before it's used, outside a `rec` group; functions can come in any order).
The runtime is:

1. `prelude/js_string.wax`: the js-string builtins
2. `imports.wax`: the host imports
3. `vendor/wax-mb/persistent_hash_map.wax`: wax-mb's HAMT, unmodified
4. `vendor/wax-mb/persistent_vector.wax`: wax-mb's persistent vector, unmodified
5. `prelude/value.wax`, `path.wax`, `sem.wax`, `view.wax`, `schema.wax`, `component.wax`: the shared types
6. `str.wax`: string helpers
7. `buf.wax`: growable arrays
8. `key_map.wax`: a string → i32 hash map
9. `value.wax`: the `Value` type's functions
10. `collections.wax`: `List` and `Map`, over the vendored collections
11. `vnode.wax`: shapes and vnodes
12. `dom.wax`: building and morphing the DOM
13. `path.wax`: path keys and frames
14. `text.wax`: building strings, JSON text
15. `meta.wax`: the metadata comments' text
16. `sem.wax`: the semantic tree, templates, event handlers and their modifiers
17. `lower.wax`: the semantic tree to vnodes
18. `view.wax`: views as data
19. `walk.wax`: walking views
20. `collect.wax`: what walking views collects: templates, event names, class names
21. `component.wax`: the component runtime's functions and own types
22. `route.wax`: paths: reading and writing the state, dispatch paths, selectors
23. `schema.wax`: schemas: checking values against types and constraints, interfaces, schemas as values
24. `scope.wax`: scopes: registering and making components
25. `context.wax`: what a handler does through its context
26. `render.wax`: rendering components into the semantic tree
27. `eval.wax`: evaluating views; making specs from them
28. `decode.wax`: routing a DOM event to a handler
29. `host.wax`: tasks, transactions, rendering, drag and drop
30. `check.wax`: what the host checks with schemas: arguments, contracts, the state
31. `api.wax`: the exports for JS
32. `lib/author.wax`: helpers for writing component types and schemas by hand
33. `abi.wax`: the component ABI's exports

A component module is the prelude (with the generated files below) and then
its own sources, listed in `COMPONENTS`. The next section has how.

The assembled modules are kept in `dist/` (`dist/tutuca-rt.wax`,
`dist/components/<module>.wax`). When wax-mb rejects one, the build maps
each location it reports back to the source file, keeping the assembled line
too: `src/dom.wax:59:5 (dist/tutuca-rt.wax:636)`.

wax-mb writes each module as `<module>.debug.wasm`, with its name section,
which binaryen's `wasm-opt -O2` (a pinned dev dependency, or `WASM_OPT`)
optimizes into `<module>.wasm`, the file the tests, the demos and a page
load: about half the runtime's size, and a third of a component's (`just
size` lists both, raw and gzipped). The optimized modules have no function
names, so for a readable stack trace load the `.debug.wasm` instead. wasm-opt
runs with the features engines ship, not `-all`, which turns on proposals
they don't (its output then fails to compile), and not in closed-world mode,
so the types a component shares with the runtime stay as declared: optimized
and unoptimized modules link with each other.

Every top-level name of a module shares one namespace, so names carry their
file's prefix: `str_`, `ext_buf_`, `key_map_`, `value_`, `list_`, `map_`, `smap_`,
`vnode_`, `path_key_`, `text_`, `meta_`, `snode_`, `lower_`, `view_`, `walk_`,
`dispatch_path_`,
`update_path_`, `selector_`, `scope_`, `ctx_`, `render_context_`, `host_`,
`dom_` and `env_` for imports, `s_` for the string constants, `api_` for the
exports' functions (the exports themselves are unprefixed). A component
type's functions take its name (`counter_handle`). A component module has a
namespace of its own: only the prelude's names and the ABI's (which keep the
runtime's names, `list_get`, `ctx_notify`, ...) are taken in it, which is why
the counter module's list component is `Board`.

## Modules: prelude, runtime, ABI, components

A component type can be compiled into its own `.wasm`, a component module,
and loaded at run time: `tw.loadComponent(urlOrBytes, scope)`. The code is in
four places, each with a rule:

- **`prelude/`, shared.** Types, i32 consts (kind tags, property codes,
  `tutuca_abi_version_current`) and the js-string builtins' import
  declarations: never a function or a reference global. The runtime and
  every component module are built with these same files. wasm-gc types are
  equal across modules when their declarations are (structurally, per `rec`
  group; wax-mb emits every declared type, in order, one group per
  declaration), so a component's `&value`, `&context` or `&vtable` is the
  runtime's. The build fails if a prelude file has a top-level `fn`, `let`
  or typed `const`.
- **`src/`, the runtime.** Everything with code, the functions over the shared
  types included, lives here once. Component modules don't carry copies of
  the collections, constructors or helpers, so they stay small (about 9 to 13
  KB here). The shared singletons (`VALUE_NULL`, `VALUE_TRUE`, ...) exist only
  in the runtime, so comparing them by reference stays right.
- **`src/abi.wax`, the ABI.** The functions a component module imports, as
  module `"tutuca"`: thin exports over the runtime's functions, keeping their
  names. It's the one list of the ABI: the build reads it and writes, per
  component module, the import block of the functions that module's sources
  call (`dist/components/<module>.abi.wax`), since a wasm import is in the
  module whether it's called or not. JS calls these exports too. Changing
  them or the prelude's types means a new `tutuca_abi_version_current`.
- **`lib/`, utilities for components.** Helpers for writing component types
  (`el_on`, `views2`, `spec_main`, `init_int`, ...), compiled into the runtime
  and exported through the ABI like the rest.

Some shared types are shared only because the types around them hold them:
`scope`, `scope_entry`, `ask_handler`, and a context's `path` and
`effects`. Components treat them as opaque, through the ABI. A
component reads a context's `source_key`, `event` and `drag`, a message's
`name` and `args`, values' kinds and payloads, and its own instance.

The vendored collections' types are shared too (`value_list` holds a
`pv_vector`, `value_map` a `phm_map`), but their files hold their functions
as well and stay unmodified, so the build extracts their top-level `type`
and `rec` items into `dist/prelude/collections_types.wax` for components.

**A component module:**

- is assembled from `prelude/js_string.wax`,
  `dist/prelude/collections_types.wax`, the rest of `prelude/`, its
  generated ABI imports, then its own sources;
- imports only from `"tutuca"`, `"wasm:js-string"` and `"'"` (its own string
  constants): no DOM, env or host, which only the runtime talks to;
- exports `tutuca_abi_version() -> i32`, returning
  `tutuca_abi_version_current`, and `tutuca_register(s: &scope)`, which
  registers its component types (and ask handlers) in `s`;
- carries, when tcd built it, a custom section named `tutuca`: JSON with
  its sources (`tcd`, the `uses` it reads by the paths written, `impls`),
  the `types` it registers, the `interfaces` it declares, what it `needs`
  from a scope (`types` it makes or holds, `interfaces` it implements or
  holds) and its `host_asks`. The runtime ignores it; `componentMeta(bytes)`
  (`js/tutuca-rt.js`) reads it without compiling the module.

`loadComponent` checks the first two, links the module's `"tutuca"` imports
to the runtime instance's exports (the engine checks their types against the
module's declarations), compiles it with the same builtins or polyfills as the
runtime, checks the version and calls `tutuca_register`. Types from different
modules compose through the scope: `todo_list`'s TodoList makes a `TodoItem`
by name, which works once some module registered one there, and fails the
task (committing nothing) until then. Which module that is doesn't matter
to TodoList as long as it implements TodoItem's interface (init's `id`,
`text` and `done`; the `id` and `done` properties; `set_done(bool)`; a
`remove_me` notify): `todo_item` and `todo_card` both do, with different
layouts and state. Registering a name again takes it over for the components
made after; the ones made before keep their own vtable, so one list can hold
both.

## Conventions

### Enums

Wax has no sum types, so an enum is a small type hierarchy, the way wax-mb's
`stdlib/data/immutable_value.wax` does it. For an enum `e` with cases `a` and
`b`:

```wax
const e_kind_a = 0;
const e_kind_b = 1;

type e = open { kind: i32 };
type e_a: e = { .. };
type e_b: e = { .., value: js_string };

const E_A: &e = {e_a| kind: e_kind_a };

fn e_a() -> &e {
    E_A;
}

fn e_b(value: js_string) -> &e {
    let out: &e_b = { kind: e_kind_b, value };
    out;
}
```

- **The base** is an `open` struct named after the enum with one field,
  `kind: i32`, the case's tag. Nothing else goes in the base: a field every
  case has is still declared per case, so a case reads the same however it
  was matched.
- **A case** is a final (not `open`) subtype named `<enum>_<case>`, whose
  first field is the inherited `kind` (`..`) and then its own fields.
  Immutable unless there's a reason.
- **Tags** are consts `<enum>_kind_<case>`, numbered from 0 in declaration
  order. Every value carries the tag of its case; nothing ever changes it.
- **A constructor** per case, a function with the case type's name (types and
  functions are separate namespaces in Wax), taking the case's fields and
  returning the base type `&<enum>`. Construct only through it, so the tag
  always matches the type.
- **A case without fields** has one shared instance, a const global
  `<ENUM>_<CASE>`, which its constructor returns: it can be compared by
  reference. A case whose fields take few values can do the same per value
  (`value_bool` returns `VALUE_TRUE` or `VALUE_FALSE`).
- **Recursive enums** go in a `rec { }` group with the types they refer to
  and that refer to them (the arrays of themselves, like `vnode_array`).
- **"Maybe"** is a nullable reference, `&?<enum>`, not a case.

To branch on a value, match on the case types:

```wax
match v {
    x: &e_b => {
        return x.value;
    }
    _ => {
        return null;
    }
}
unreachable;
```

A fieldless enum that is only ever compared, never matched on its case type
or extended with fields, can be an `i32` with consts instead (the property
access results, `property_ok` …, and the task kinds): a struct per case would
buy nothing.

Every arm ends in `return` (with `unreachable;` after the `match` when the
function returns a value). wax-mb rejects a statement `match` with two or more
type arms whose arms fall through (see `wax-mb-usage-feedback.md`); when arms
don't return, switch on the tag instead: `if v.kind == e_kind_a { ... }`,
then cast, `v as &e_a`. The tag is also what to compare when two values only
need to be of the same case (`if a.kind != b.kind { return 0; }`).

### Strings

A string is a JS string: `js_string`, or `js_string_opt` when it may be
absent, aliases (`prelude/js_string.wax`) of `&extern` and `&?extern`. It
crosses the boundary as it is, and the runtime reads it with the [js-string
builtins](https://github.com/WebAssembly/js-string-builtins) (`imports.wax`,
module `wasm:js-string`; they take `&?extern`, an engine refuses the module
otherwise). The strings the runtime needs are imported string constants,
module `"'"`, whose import names are the strings themselves (`s_value` is
`"value"`). V8 (Chromium, Node 24) supplies both; `js/tutuca-rt.js` polyfills them
for engines that don't, and reports which happened in `vdom.builtins`.

The other externrefs are named the same way, in `imports.wax`: `dom_node`
(`dom_node_opt`), `dom_document`, `dom_event`, and `value_extern`, a Value
handed to the host as an externref. A plain `&extern` is any of them (the
buffers of `buf.wax` hold strings and nodes). An alias names a value type, `&`
included: `js_string`, never `&js_string`. Aliases document, they don't
check: all of them are `&extern` to the compiler.

### Booleans and arrays

Booleans are `i32`, 0 or 1. Wax has no `&&` or `||`: `(a) & (b)` where both
sides are safe and cheap to evaluate, nested `if`s otherwise. Integers compare
with an explicit sign: `<s`, `>=s`.

wasm-gc arrays have a fixed length and arrays of references need an initial
value, so arrays that JS fills are `[mut &?t]` (`str_array`, `value_array`,
`vnode_array`), and growable ones are a buffer with a count (`ext_buf`).

### Loops

`loop { }` is wasm's `loop`: its body runs once and falls out at the end
unless something branches back to it, so it isn't Rust's endless `loop`.
Repeat with `while 1 { }`. A `br` to a `while`'s label continues it; leaving
early takes a labeled block around it: `'done: do { while c { br 'done; } }`.

### Function types

A function type declared in a `rec` group (the vtable's `init_fn`,
`handle_fn`, `get_fn` and `set_fn`, a loop's `loop_key_fn`, `ask_fn`, a
walker's `visit_fn`, ...) is a type of its own, which a function has only when it's declared with it:

```wax
fn counter_handle: handle_fn (instance: &eq, m: &message, ctx: &context) -> &message_result {
    ...
}
```

Without the `: handle_fn`, `{vtable| handle: counter_handle, ... }` is a type
error.

## The semantic tree and lowering

`sem.wax` is the spec's semantic tree: `snode` is an element, a text, a
comment, a group (an explicit fragment), or one of the wrappers: a
`component` (the render of an instance of a named type), an `enter` (children
rendered at a frame), or `items` (a loop, one `entry` per item: its key, frame
and body). `lower.wax` turns it into vnodes as `bind/lower.rkt` does:

- a component or frame wrapper becomes its opening metadata comment, its
  children and the closing comment, `§/§`;
- a loop becomes an unkeyed fragment of keyed item fragments, each item
  between its frame's comments, so every loop is its own sibling key scope;
- the opening comment's text is `§JSON.stringify(meta)§` with the runtime's
  key order, written by `meta.wax` (with JSON's string escaping, lone
  surrogates included), and the component comment and the closing one are
  shared vnodes, so morph skips them by identity.

An element points at its **template**, made once per element of a component
type's views: its id, its shape, and its event handlers (`on_attr`: the event
and the action it sends, with arguments that are literals, the target's value,
the source key, or conditionals of those). The spec's elements carry their
tag, namespace and props, and lowering sorts the props and adds `data-eid`;
here, as in tutuca's `optimize.js`, that happens once, in the template's
shape: `data-eid` is a static attr of every template with handlers, and the
template is the table entry routing will find its handlers in.

Props and literal send arguments are values. Not implemented yet: props
holding elements (the spec's `prop-value` can be a node or an iterable of
them).

## Values

`value.wax` is NOTES.md's `Value`: an enum (the convention above) with the
cases `null`, `bool`, `int` (i32), `float` (f64), `string` (a JS string),
`list`, `map`, `result` (ok or err, holding a value) and `component`. The
component case holds a `component`, which for now is an empty open struct:
the component runtime will be its subtype. `value_same` is JS's `===`, what a
render compares props with (numbers by value whatever case holds them,
strings by content, everything else by reference), and `value_truthy` is JS
truthiness.

`List` and `Map` (`collections.wax`) are wax-mb's persistent vector and hash
map (`vendor/wax-mb`, copied unmodified, so wax-mb's own tests of them still
describe what runs: `vendor/wax-mb/README.md` says how to update them). The
vendored code stores `&?eq`; the adapter stores only `&value` and casts back.
A map's keys are strings: since a JS string is an externref, outside the eq
hierarchy the HAMT needs, a key is stored as the `value_string` holding it,
and the map's hash (`str_hash`, FNV-1a) and equality read the string through
it. Both are persistent: an update returns a new list or map and the old one
stays usable, sharing what didn't change.

`js/tutuca-rt.js` converts between JS values and values (`vdom.values.from` and
`.to`): null and undefined are null, an integer in i32's range an int and any
other number a float, an array a list, a plain object a map; a result is
`{ ok }` or `{ err }` in JS. A map has no key order, so a round trip can
reorder an object's keys. When a list or map prop reaches the DOM, the host
converts it to its JS value first, so the DOM gets what tutuca's JS gives it
(`title: ["a", "b"]` is `"a,b"`).

## The component runtime

NOTES.md has the design; this is how it came out.

**Components.** A `component` (`component.wax`) is the `component_base` the
`Value` case holds: its type's `component_spec` (name, views, the templates
collected from them, loops, scopes, provides), its instance (any `&eq`,
opaque to the runtime: a new reference is a new state), its type's `vtable`
(`init`, `handle`, `get`, `set`) and the `scope` it was made in. A component
type is written in Wax as a spec made once (a global set on first use) with
`spec_new` or `spec_main`, a vtable, and functions declared with the
vtable's function types: `components/counter/counter.wax` has the shortest one.

**Scopes** (`scope.wax`) are a tree: `scope_register` puts a type's spec and
vtable under a name, `scope_make` finds it here or in a parent, runs `init`
and gives the component the scope that was asked. `init` gets an
`init_context` holding that scope, so it can make the components it holds
with `init_ctx_make` (tcd's `make(c)` field defaults do). Ask handlers are
registered the same way and found the same way, from the asker's scope up;
a handler gets the asker's context (not its instance), so `ctx.scope` is the
scope the asker was made in, wherever the handler was registered. It only
answers, as tutuca's JS ask handlers (which get the context read only) and
the spec's do: it can read the context and log, and sending from it fails
the ask.
`scope_register_host_ask` answers through the host's `ask` import, with
only the ask's name and arguments: `createHost`'s `asks[name]` replies now
with a value, later with a promise, with `name.error` when it throws or
rejects (the error's message: a value can't hold a JS object), and with
`name.unhandled` when `asks` has no such name, as tutuca's JS does.
From JS, `loadComponent(bytes, scope, { names })` registers a module's types
under other names (`{ Counter: "Tally", Label: null }` renames one and leaves
one out), checked as any registration, and `runtime.nameIn(scope, c)` is the
name `c`'s type is made by from `scope` (`scope_name_of`), which a rename
makes other than its `typeName`. Components make each other by name (a
Tabs makes a `"Hole"`), so renaming or leaving out a type another one makes
breaks that make in that scope, unless something else is registered as it.

**Paths** (`path.wax` for the types, `route.wax` for what they do): update
paths read and write the state, through components' `get` and `set` and
through maps and lists; dispatch paths are frames, which resolve to update
paths (provider jumps included), give the component path and the source key;
selectors freeze against the state; targets are a base path and a selector.

**Handlers** get a `context` (`context.wax`): the scope, their component's
path, the source key, the event, and an effects buffer that `ctx_notify`,
`ctx_ask`, `ctx_send_at`, `ctx_forward_at`, `ctx_stop_next` and `ctx_log`
add to; `ctx_now`, `ctx_random` and `ctx_uuid` read the world through the
host's `env` import; `ctx_make` makes components in the handling component's
scope (for a Swapped result), failing the task when it can't, and
`ctx_try_make` makes them as a result instead: Ok(the component), or
Err({ error, issues }), error saying why in words and issues being init's.
`ctx_component_names(ctx, walk)` lists the type names registered there,
sorted (with `walk`, the parents' too, each name once, as `ctx_make` resolves
them): `components/layout`'s Hole asks for them and swaps itself for the one
picked, or stays, saying why, when it can't be made.

**The host** (`host.wax`) runs one task per `host_step`, as one transaction:
the handler runs on the component the route reaches, its effects become child
tasks (a notify to the parent, an ask to the asker, a send or forward below
by selector), a notify that wasn't stopped bubbles, its next hop running
right after, before anything else queued (an ancestor without a
handler passes it on silently; one no hop handled is reported `unhandled`
once, at the root, as is a notify the root sends), the new root is set
through the update path, and the children's targets freeze against it. Every
component has an identity (`id`, fresh when it's made, kept by its updates),
and a route records the identity of the component it reached when it was
fixed: a task whose path another component took meanwhile (it was replaced,
or a list shifted) is dropped and reported `stale`, as tutuca's JS does. A
failure throws (the host's `fail`) or traps out of `host_step` before
anything is committed: the root stays and the children are dropped. The JS
side calls `host_step` once per task and reports what failed, so the host
goes on with the next task. What a host reports is one list,
`host.reports`, of `{ type, ...info }` with the types tutuca's JS
`Host.notify` uses (and the spec's observations): `log`, `unhandled`,
`taskFailed`, `renderFailed`, `eventFailed`, `stale`, `render`, and in dev mode `stateInvalid` and
`messageInvalid`; `createHost`'s `onReport(type, info)` gets each as it
happens, and `host.logs`, `.unhandled`, `.failures` and `.issues` are views
of the list. An ask runs no handler on the asker: once what asked has
committed it starts the scope's handler, and the answer comes back as a reply
task of its own, routed to the asker's path and identity: `name.ok` /
`name.error`, or `name.unhandled` with no handler. Answers aren't messages:
a dotted name only reaches a component as an ask's answer, never from a send.
`ctx_ask` returns the request's id, which the answer's handler reads as
`ctx.request`. One answered
now runs next, ahead of the queue; a pending one is queued by `host_settle`
when it's answered. A reply that fails fails only itself. After the
queue drains, `host_render` renders the root if it isn't the same reference
as the last one rendered. The JS side runs tasks for up to 16ms, as
tutuca's JS host does, then renders and leaves the rest for the next tick
(`host.settled()` waits for them too). After each run it listens on the
container for the events it doesn't yet: `host_new_event_names` gives the
ones the types registered so far in any scope of the module instance handle
(a component can be made in one scope and held by a component of another),
so a module loaded later brings its events with it.

**Views** (`view.wax`) are data, the spec's `view.rkt` expressions: constants,
fields, seq items, provided values, binds, `if`, elements, fragments,
`render`, `each`, `renderEach`, `renderIt`, `scope` and `pushView`; an
element's handlers send actions whose arguments are the handler table's own
(`prelude/sem.wax`'s `arg`: a literal, `targetValue`, `sourceKey`, `dragKey`,
a field of the event, or an `if` of those), not views, since they're
evaluated against the message context, never rendered. Computed text is a property: `get` answers names that
aren't fields (TodoList's `remaining` and `count`, TodoCard's `meta`).
`spec_new` collects a type's templates from its views (`collect.wax`): every
element gets one, numbered in walk order, constant attrs static and the rest
dynamic. It collects the events their handlers are for too, the drag events
with `drop`, which a host listens to.

**Walking** (`walk.wax`) is tutuca's `Walker`: a `walker_vtable` of visits,
one per kind plus `node`, `attr`, `child` and `handler`, and the state they
share. `walker_vtable_default()` walks everything; a consumer sets the visits
it cares about and calls the `walk_*` defaults to go on. Collecting templates,
event names (`views_collect_event_names`) and the constant class names
(`views_collect_classes`) are walkers.

**Rendering** (`eval.wax`, `render.wax`): `render_view` evaluates a
component's best view (the one named, the first pushed one it has, or
`main`) to its semantic tree, in its component wrapper. A `render` renders a
child at its source's frame one frame deeper, capturing what the child
provides; a loop makes one entry per item, at the item's frame. Its loop's
hooks are tutuca's: `prepare(items)` makes the state the others get last;
`iter(items, state)` gives the items as `[key, value]` lists, else they're the
source's that `filter(key, value, state)` keeps; an item is keyed by
`key(key, value, state)` or its key, and its body sees the item, `value`,
`key` and what `enrich(key, value, state)` adds (tutuca's JS passes
`{ value, key }` and the state: a record is the JS way to take them, two
arguments the Wax one, as the other hooks take them).

**Events** (`decode.wax`): the host routes a DOM event the way
`getEventInfoFor` does: from the target up to the container, the `data-eid`s
met before the first component boundary, and the metadata comments of every
ancestor's previous siblings, read back by a JSON reader for what `meta.wax`
writes; the frames give the route, the route's component's spec the template
with that eid, and its handlers the one for the event. Its arguments are
evaluated when the task runs, against its context: literals, the value of
the element with the handler (checked for a checkbox), the source key, the
drag key, and conditionals.

**Drag and drop** (`host.wax`), as in tutuca's JS: from `dragstart` to
`dragend` the host keeps what is dragged, the closest `draggable="true"`
element: its path, its `data-dragtype` and its value there, marking it
`data-dragging`. The drop events (`dragenter`, `dragover`, `dragleave`,
`drop`) bubble: they reach the nearest enclosing component with a handler
for them, so a drop on a child's elements gets to the parent's `on:drop`.
Over a drop target the host lets the drop happen and marks the target
`data-draggingover` with the dragged type (or `external`). A handler reads
`ctx.drag`, a map of the `type`, the `value` and the `key` of its child the
drag started in (what `dragKey` sends), or null.

**Event modifiers and data**: `on:<event>+<modifier>...` takes the event
only when its modifiers match: a key held (`ctrl`, `alt`, `shift`, `meta`)
or the key pressed (`enter`, `escape`, `tab`, `space`, `up`, `down`, `left`,
`right`, `delete`, `backspace`); `prevent` and `stop` call `preventDefault()`
and `stopPropagation()` when it does. TodoList's input adds on
`keydown+enter+prevent`. A handler's `ctx.event` is the event's type, key
and modifier keys, the pointer's buttons, position, movement and kind and a
wheel's deltas (the ones it has), and a view reads them as send arguments
with `event(name)`: `on:mousedown` → `press(event(clientX), event(clientY))`.

**Schemas** (`prelude/schema.wax`, `schema.wax`; tutuca's `t.*` and
`MessageSpec`): a component type can carry its schema as data
(`spec_set_schema`): its fields' and computed properties' types
(`vtype_int()`, `vtype_list(...)`, `vtype_component(names)`, ...) with
constraints in normal form (`constraint_min`, `_max`, `_min_len`,
`_max_len`, `_one_of`, `_none_of`, `_key_of` a field, `_pattern`, `_check`
a named predicate), its messages (arguments, source key, `pre` and `post`
predicates, the fields it `changes`, what it `emits`), its invariants, and
the interfaces it implements. With one, the host rejects a message whose
arguments don't fit before the handler sees them (a reply to an ask too,
whether it arrives in the ask's own task or later: tcd gives `name.ok`,
and `name.error` and `name.unhandled` when they're handled, schemas
of their own), and every rejection
(those and a handler's own, `message_error_failed(reason)` or
`message_error_invalid_arg(i, reason)`) aborts the task with a structured
reason JS reads as `error.rejection`: `{ message, component, reason:
wrongArity | wrongArgType | invalidArg | failed, index, problem, detail }`,
`problem` saying why in words ("argument 0 (n): must be at least 1, got 0").
`runtime.schema(component)` reads a type's schema, types written as TCD
writes them (`list<TodoItem>`, `option<s32>`, constraints as `>= 1`,
`in keys(items)`). Counter, the todos and Probe have schemas; the rest don't,
and the runtime can't check inside them.

**Dev mode** (`check.wax`; `createHost(..., { dev: true })`): the host
checks the whole state when it starts, then after each task the fields it
changed (only what changed: subtrees shared with the previous root are
skipped), the message's contract (`pre`, `post`, `sourceKey`,
`changes:<field>` for a field outside its changes that isn't the same value,
`emits:<kind>:<name>`), and once the queue is empty, the invariants of what
changed since it last was, since a task can leave them broken for the tasks
it queued. What fails is reported as `stateInvalid` and `messageInvalid`, as
in tutuca's JS (`host.issues` is those reports); the tasks still commit.

**Interfaces**: an `interface_schema` (fields, properties and messages, each
of its type) registered in a scope by name (`scope_register_interface`)
means a type registered or made under that name, or one that declares it
implements it, must have all of it, of the same types; registering or
making one that doesn't fails, saying what's missing ("Impostor can't be a
TodoItem: its field done is s32, TodoItem's is bool"). TodoList registers
TodoItem's; todo_item and todo_card implement it. `vtype_component` accepts
a component of a named type (by its name, or one its scope makes it by, as
tutuca's JS checks by lookup, so a type loaded under another name is of
that name) or of a type implementing a named interface.

**Headless hosts**: `host_new` with a null document and container, or
`createHost(null, null, root)`, runs tasks and renders nothing, for tests
and tools.

Not implemented yet: sync engines, and a view language (the examples spell
their views and schemas with `lib/author.wax`'s helpers).

## The DOM imports

`imports.wax` imports the DOM as functions of module `"dom"`, which
`js/tutuca-rt.js` implements. It's the `DomNode` trait of tutuca-mb's
`vdom/dom.mbt` flattened so only nodes, strings, numbers and booleans cross
(NOTES.md has the mapping), plus what this port needed:

- `own` and `is_owned`: the WeakSet of nodes render made. As in tutuca's JS,
  morphing matches vnodes only to these, so nodes other code puts in a
  rendered element don't shift the match, and stay.
- `is_same_node`: externrefs have no identity comparison inside wasm.
- `set_attribute_string` / `_number` / `_bool` / `_ref` and
  `set_string_property` / `_number` / `_bool` / `_ref`: one per kind of value,
  the `_ref` ones for lists, maps, results and components, which the host
  converts to JS values first.
- `fail(message)`: throws a JS `Error`, for duplicate sibling keys and
  invalid shapes, the errors tutuca's JS throws, and for a task that fails.
- `previous_sibling`, `comment_data`, `get_eid` and `target_value`: what
  routing an event reads.
- `closest_draggable`, `dataset_get` / `_set` / `_delete`, `contains`, and
  the event's `prevent_default`, `stop_propagation`, `related_target`, `drag_start` and
  `drop_effect_move`: what tracking a drag does.

## Differences from tutuca's JS vdom

`test/parity.test.mjs` checks that this renders the same markup with the same
DOM mutations as `src/vdom.js`, over random trees with keys, fragments, attrs
and namespaces. Where they differ, on purpose:

- When nodes render made were removed by other code, JS's morph throws
  (`Cannot read properties of undefined (reading 'namespaceURI')`); this
  mounts the vnode anew, as tutuca-mb does.
- A prop is a value, so it can't be a function: JS skips function props;
  here they're an error when the vnode is built.
- An int and a float holding the same number are the same prop, as in JS,
  where there's only one kind of number.
- A prop can't hold vnodes (the spec's `prop-value` can be a node or an
  iterable of them, and tutuca's JS passes an element through as is).

## Differences from tutuca's JS runtime

Beyond the vdom, where this and tutuca's JS (and the spec in `../spec/`)
mean different things, on purpose or for now:

- Numbers are an i32 `int` or an f64 `float`: an integer past i32's range
  arrives as a float, which an `s32` field rejects (`t.number().int()` takes
  it).
- A map is a HAMT, so its keys come in hash order: a loop over a map, and
  a map turned back into JSON, don't keep the order the keys were added in.
- A message's arguments are checked always, not only in dev mode, before the
  handler sees them, and arguments that don't fit abort the task instead of
  being reported after it commits.
- A predicate (`when`, `ensures`, a `where` check, an invariant) that traps
  aborts the task, or the check, instead of counting as broken: wasm can't
  catch a trap.
- Dev mode can't report undeclared fields (an instance is opaque to the
  runtime), and doesn't check inside a component without a schema.
- An error a host ask throws or rejects with is replied as its message: a
  value can't hold a JS object.
- What only this has: interfaces, a message's `changes`, an init hook with an
  init context, typed computed properties, results as values, `ctx_make`,
  `ctx_try_make` and `ctx_component_names`, event modifiers
  (`on_keydown+enter`), `event(name)` send arguments, and `ctx.event` as a
  map of the event's fields.
