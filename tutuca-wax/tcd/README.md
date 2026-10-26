# tcd: Tutuca Component Definitions

A WIT-flavored language for the declarative part of a tutuca-wax component
(its state, its protocol, its views), and the MoonBit tool that checks it,
generates the boilerplate, holds the hand-written Wax to a naming convention,
and compiles the component module with the runtime's prelude.

A component is two files: `name.tcd`, everything that can be said
declaratively, and `name.wax`, only what can't: what each message does to
the state, computed properties, loop hooks. The JSON viewer and editor went
from about 1300 hand-written lines of Wax to a 230-line `.tcd` and a 270-line
`.wax`; `../components/` has five modules written this way.

```sh
moon build --target native            # the tcd binary, in _build/native/debug/build/tutuca/tcd/cmd/tcd/
tcd check components/counter/counter.tcd
tcd stub components/counter/counter.tcd > counter.wax       # every function to write, typed
tcd stub components/counter/counter.tcd --missing counter.wax   # only the missing ones
tcd build counter.tcd counter.wax --runtime .. -o counter.debug.wasm
tcd model counter.tcd -o counter.model.json   # for js/pbt.js
tcd explain counter.tcd tally.count            # a field's constraints in words
moon test                                      # the tool's own tests
```

`scripts/build.mjs` builds tcd and runs it for the components that have a
`tcd` entry, then wasm-opt as for the rest.

## The language

Every name is snake_case; the runtime gets camelCase for members (`set_text`
is the message `setText`) and PascalCase for types (`json_number` is
`JsonNumber`), and Wax gets the snake_case name.

```wit
package tutuca:todos@0.1.0;

use "../todo_list/todo_list.tcd".{ todo_item };   // interfaces from another file

/// What a list needs of its items.
interface todo_item {
    field id: s32;
    field done: bool;
    message set_done(done: bool);
    notify remove_me();
}

component todo_card: todo_item {           // implements it, checked
    field id: s32 where id >= 0;
    field done: bool;
    field starred: bool;
    get meta: string;                     // computed, in the .wax

    notify remove_me();
    message toggle() changes done ensures next.done == not done;
    message set_done(done: bool) changes done ensures next.done == done;
    message remove() changes nothing emits notify remove_me;

    view main = li(class: if(field(done), "done", "todo"), "data-dragtype": "todo",
        span(field(meta)),
        button(on_click: send(toggle), "toggle"));
}

register todo_card as todo_item;          // default: every component, as itself
example toggles for todo_card { start { done: false } send toggle(); expect done; }
```

**Types**: `bool`, `s32`, `f64`, `string`, `any`, `enum { a, b }`,
`option<T>`, `list<T>`, `map<T>` (string keys), `record { a: T, .. }`,
`one_of<A, B>`, `result<T, E>`, a component or interface name, `component`.
`index<f>` isn't a type: it's `f`'s key type (s32 for a list, string for a
map) with the constraint `in keys(f)`.

**`where`** (fields, properties, arguments) is written like a condition but
only takes what a schema can hold: comparisons of the subject with literals
(`0 <= count < 100`), `len(x)`, `x in [..]`, `x not in [..]`,
`x in keys(f)`, `x in values(f)`, `x matches "re"`, `check(p)`, joined
with `and`. It's normalized (an s32's exclusive bounds become inclusive),
explained (`tcd explain`), and checked: a clause that can never hold, one
implied by another, one that isn't a constraint, a literal of the wrong type,
a default outside it. A field whose type's default breaks it is required.

**Conditions** (`when`, `ensures`, `invariant`, `expect`) take `and`, `or`,
`not`, comparisons, `+`, `-`, `len`, `keys`, `values`, `in`, `matches`,
`all(xs, cond-on-it)`, `any(xs, ...)`, `check(p)`; `ensures` reads
`next.field`. They compile to predicates the runtime runs in dev mode. A
guard that the fields' constraints make impossible, an `ensures` about a
field outside `changes`, an invariant the defaults break: reported.

**Members**: `field`, `get`, `message name(args) [-> swap] [source_key: T]
[when c] [changes a, b | nothing] [ensures c] [emits notify x, ask x, send
type.msg, make type | nothing]`, `notify`, `ask name(args) -> T`,
`invariant name: c`, `init;`, `loop name { prepare: T; iter; key: T; filter;
enrich { b: T } ; view: v }`, `scope name { b: T }`, `provide name =
field(f);`, `view name = ...;`. Package level: `interface`, `component c:
iface`, `register`, `ask_handler name(args) -> T;`, `host_ask name;`, `use`,
`example`.

**Views** are calls, attributes (named arguments) before children
(positional), never interleaved: `div(class: "x", on_click: send(m),
field(count), " left")`. A bare name is always a name (`field(count)`), text
is always quoted. Constructs: `field`, `seq_item`, `provided`, `bind`, `if`,
`frag`, `render(view: v, src)`, `render_each(loop: l, src)`, `each(loop: l,
src, body)`, `render_it(view: v)`, `scope`, `push_view`, `el("tag", ...)`;
`send(msg, args)` in `on_<event>` attributes (quoted for modifiers:
`"on_keydown+enter+prevent"`), whose arguments are literals,
`target_value()`, `source_key()`, `drag_key()`, `event(name)` or an `if` of
them, checked against the message's types and constraints. Inside an `each`
body, `field(x)` reads the item.

## The naming convention

For a component `c`, the implementation provides, with exactly these
signatures (`tcd stub` writes them; the build checks them):

| declared | implement |
|---|---|
| `message m(a: A)` | `fn c_on_m(state: &c_state, ctx: &context, a: A') -> &c_state` (the same state: unchanged) |
| `message m() -> swap` | `... -> &component` |
| `get g: T` | `fn c_get_g(state: &c_state) -> T'` |
| `ask a() -> T` | `c_reply_a_ok(state, ctx, reply: T')`; `_err(state, ctx, error: &value)` and `_not_found(state, ctx)` optional |
| `loop l { ... }` | `c_loop_l_prepare`, `_iter`, `_key`, `_filter`, `_enrich` (returns `&c_loop_l_binds`) |
| `scope s { ... }` | `c_scope_s(state) -> &c_scope_s_binds` |
| `check(p)` | `c_check_p(state[, v: T']) -> i32` |
| `init;` | `c_init(state) -> &c_state` |
| package `ask_handler a` | `<package>_answer_a(ctx, args...) -> &value` (`value_ok(...)` or `value_err(...)`) |

`T'` is the Wax type: `i32` for bool, s32 and enums (with consts
`c_<field>_<member>`), `f64`, `&extern` for strings, `&value` for the rest.
The generated contract gives the implementation the state struct,
`c_with_<field>(state, v)`, `c_notify_<n>(ctx, ...)`, `c_ask_<n>(ctx, ...)`,
`<type>_send_<m>(ctx, selector, ...)`, `c_make_<type>(ctx, fields...) ->
&component`, and a `gs_...` string constant for every string the `.tcd` uses.

## What's generated

`tcd build` writes three files next to the module: `<package>.contract.wax`
(strings, types, helpers), `<package>.glue.wax` (each component's views as
view data, schema with compiled predicates, spec, `init` with defaults and
issues, `get`, `set` validated against the schema, `handle` routing each
message to its `c_on_m`, loop and scope trampolines, registration) and
`<package>.abi.wax` (the runtime functions it imports). The runtime rejects
arguments that don't fit a message's schema before `handle` runs; in dev
mode it checks `when`, `ensures`, `changes`, `emits`, fields and invariants.

## Testing from the model

`tcd model` writes the package as JSON in the runtime's names: types,
constraints in normal form, the order fields depend on each other, guards,
frames, relations, emits, invariants, examples. `js/pbt.js` reads it:
`walk` runs random walks of enabled messages on a headless dev host and
shrinks a failing trace to a 1-minimal one; `exhaust` explores small state
spaces breadth first, reporting messages never enabled and states where none
is; `examples` runs the example blocks.

## Layout

| package | does |
|---|---|
| `diag` | spans and diagnostics |
| `syntax` | lexer, parser, syntax tree |
| `check` | the model (`Package`), resolving, constraints (`where` normal forms, contradictions, redundancy), conditions (typing, an interpreter for initial states), views, names |
| `gen` | the contract, the glue, the stub, the required functions |
| `compose` | the convention check, assembling the module, checking and compiling it with wax-mb's library |
| `export` | the model as JSON |
| `cli`, `cmd/tcd` | the command, over an `Io`; the native binary |

It depends on `marianoguerra/wax` (wax-mb's library, through `moon.work`,
from `../.tools/wax-mb/lib`, which `just setup` builds).
