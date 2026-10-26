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
  prelude both are built with. `components/` has the examples, written by
  hand against it, which the tests and demos load.

## Use

```sh
just setup      # npm install (jsdom, Playwright, binaryen's wasm-opt), and builds wax-mb into .tools/, pinned (or set WAX_MB to a wax-mb binary)
just test       # format check, build, then the tests in jsdom, against JS, and in Chromium
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

```js
import { load } from "./js/tutuca-rt.js";

// The runtime, then a component module, which registers its types in a scope.
const tw = await load(new URL("./dist/tutuca-rt.wasm", import.meta.url));
const scope = tw.runtime.scope();
await tw.loadComponent(new URL("./dist/components/counter.wasm", import.meta.url), scope);
const root = tw.runtime.make(scope, "Board", { counters: [], total: 0 });
const host = tw.runtime.createHost(document, container, root).mount();
// Clicks in container now reach the components' handlers.
host.send("addCounter"); // a message to the root, from outside

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
| `components/<module>/` | the example component modules: `counter` (Board, Counter, Label), `todo_list`, two implementations of the TodoItem it holds, `todo_item` (a checkbox) and `todo_card` (a card with buttons), all three dragged to reorder, `showcase` (Shelf and Note: scopes, loop hooks, provided values, `pushView`, `renderIt`, drag and drop), and `json` (tutuca's JSON viewer and editor: a type per kind of value, JsonEditor above them) |
| `scripts/build.mjs` | assembles and compiles `dist/tutuca-rt.wasm` and `dist/components/<module>.wasm`, generating the prelude files components need, and optimizes them with wasm-opt |
| `scripts/format.mjs` | `wax-mb format` over the sources (`npm run format`, `--check` in `npm test`) |
| `scripts/setup-wax-mb.sh` | clones and builds the pinned wax-mb into `.tools/` |
| `js/tutuca-rt.js` | the host side: the imports (DOM, env, host), loading the runtime and component modules, building values, vnodes and semantic trees from JS values, driving a host |
| `js/css.js` | CSS for collected classes: loads margaui-css.wasm, compiles the set of classes loaded modules use into a `<style>` |
| `vendor/margaui/` | margaui-css.wasm (tailwindcss-moonbit v0.5.0) and margaui's light and dark themes, pinned (`just vendor-margaui`) |
| `test/suite.mjs` | the vdom, lowering, value, path and component cases, written once for both test environments |
| `test/jsdom.test.mjs` | the suite in Node against jsdom, with the js-string builtins and with the polyfills |
| `test/parity.test.mjs` | random vnode trees, frames and semantic trees, against tutuca's own runtime, compared step by step |
| `test/browser.test.mjs` | the suite in Chromium, through Playwright, and a smoke test of the demos page |
| `demos/` | the demos page (`just demos`) |
| `scripts/serve.mjs` | the static server for the demos and the browser tests |
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
5. `prelude/value.wax`, `path.wax`, `sem.wax`, `view.wax`, `component.wax`: the shared types
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
16. `sem.wax`: the semantic tree, templates, event handlers
17. `lower.wax`: the semantic tree to vnodes
18. `view.wax`: views as data
19. `walk.wax`: walking views
20. `collect.wax`: what walking views collects: templates, class names
21. `component.wax`: the component runtime's functions and own types
22. `route.wax`: paths: reading and writing the state, dispatch paths, selectors
23. `scope.wax`: scopes: registering and making components
24. `context.wax`: what a handler does through its context
25. `render.wax`: rendering components into the semantic tree
26. `eval.wax`: evaluating views; making specs from them
27. `decode.wax`: routing a DOM event to a handler
28. `host.wax`: tasks, transactions, rendering
29. `api.wax`: the exports for JS
30. `lib/author.wax`: helpers for writing component types by hand
31. `abi.wax`: the component ABI's exports

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
  registers its component types (and ask handlers) in `s`.

`loadComponent` checks the first two, links the module's `"tutuca"` imports
to the runtime instance's exports (the engine checks their types against the
module's declarations), compiles it with the same builtins or polyfills as the
runtime, checks the version and calls `tutuca_register`. Types from different
modules compose through the scope: `todo_list`'s TodoList makes a `TodoItem`
by name, which works once some module registered one there, and fails the
task (committing nothing) until then. Which module that is doesn't matter
to TodoList as long as it implements TodoItem's interface (init's `id`,
`text` and `done`; the `id` and `done` properties; `setDone(bool)`; a
`removeMe` notify): `todo_item` and `todo_card` both do, with different
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
type e_b: e = { .., value: &extern };

const E_A: &e = {e_a| kind: e_kind_a };

fn e_a() -> &e {
    E_A;
}

fn e_b(value: &extern) -> &e {
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

A string is a JS string: `&extern`, or `&?extern` when it may be absent. It
crosses the boundary as it is, and the runtime reads it with the [js-string
builtins](https://github.com/WebAssembly/js-string-builtins) (`imports.wax`,
module `wasm:js-string`; they take `&?extern`, an engine refuses the module
otherwise). The strings the runtime needs are imported string constants,
module `"'"`, whose import names are the strings themselves (`s_value` is
`"value"`). V8 (Chromium, Node 24) supplies both; `js/tutuca-rt.js` polyfills them
for engines that don't, and reports which happened in `vdom.builtins`.

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
and gives the component the scope that was asked. Ask handlers are
registered the same way; `scope_register_host_ask` answers through the
host's `ask` import, later.

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
scope (for a Swapped result).

**The host** (`host.wax`) runs one task per `host_step`, as one transaction:
the handler runs on the component the route reaches, its effects become child
tasks (a notify to the parent, an ask to the asker, a send or forward below
by selector), a notify that wasn't stopped bubbles, the new root is set
through the update path, and the children's targets freeze against it. A
failure throws (the host's `fail`) or traps out of `host_step` before
anything is committed: the root stays and the children are dropped. The JS
side calls `host_step` once per task and collects what failed
(`host.failures`), so the host goes on with the next task. Asks run the
scope's handler: a reply now becomes `NameReplyOk` / `NameReplyError` in the
same transaction, a pending one is answered by `host_settle` later. After the
queue drains, `host_render` renders the root if it isn't the same reference
as the last one rendered. The JS side runs tasks for up to 16ms, as
tutuca's JS host does, then renders and leaves the rest for the next tick
(`host.settled()` waits for them too). After each run it listens on the
container for the events it doesn't yet: `host_new_event_names` gives the
ones the types registered anywhere in the root's scope tree handle, so a
module loaded later brings its events with it.

**Views** (`view.wax`) are data, the spec's `view.rkt` expressions: constants,
fields, seq items, provided values, binds, `if`, elements, fragments,
`render`, `each`, `renderEach`, `renderIt`, `scope`, `pushView`, and the send
actions on elements, whose arguments can also be `targetValue`, `sourceKey`
and `dragKey`. Computed text is a property: `get` answers names that
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
`key` and what `enrich(binds, state)` adds.

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

Not implemented yet: the dev checks (fields against their schema after each task,
message contracts, invariants once the queue is empty, which also need the
properties, messages and init schemas of NOTES.md's `ComponentSpec`), sync
engines, and a view language (the examples spell their views with
`lib/author.wax`'s helpers).

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
  the event's `prevent_default`, `related_target`, `drag_start` and
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
