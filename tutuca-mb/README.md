# tutuca-mb

A MoonBit implementation of [tutuca](../README.md) that keeps its design and semantics, made
idiomatic for MoonBit. There is no code generation, and as much as possible is checked
statically, most of it by the MoonBit compiler.

```moonbit
pub(all) struct Counter {
  count : Int
} derive(Eq, Debug, ToJson, FromJson, @quickcheck.Arbitrary)

pub(all) enum CounterMsg {
  Inc
} derive(Debug, @quickcheck.Arbitrary)

pub let counter : @tutuca.Component[Counter, CounterMsg] = @tutuca.component(
  "Counter",
  view=() => @tutuca.button([@tutuca.on_click(Inc)], [
    @tutuca.txt("Clicked "),
    @tutuca.show(s => s.count.to_string()),
  ]),
  update=(s, msg, _) => match msg {
    Inc => { count: s.count + 1 }
  },
)
```

In a browser, `@browser.mount(root, counter, { count: 0 })` starts it. In a test,
`@testing.Driver::new(counter, { count: 0 })` runs it headless on memdom.

## Packages

| Package | What it is | JS |
|---|---|---|
| `vdom` | Vnodes, shapes, building and morphing the DOM through the `DomNode` trait | `src/vdom.js` |
| `vdom/memdom` | An in-memory DOM: the test substrate on every target | jsdom in tests |
| `.` (`tutuca`) | Views, lowering, check, components, lenses, paths, typed keys, tasks, host | `src/{view,optimize,walk,component,paths,tasks,host,events}.js`, `src/lint` |
| `browser` | `DomNode` over the real DOM (js target), `mount`, `delegate`, files and downloads | the browser half of `Host` |
| `wasm`, `storybook/wasm`, `examples/common/wasm` | The same on wasm-gc: a `tdom` import namespace (`wasm/loader.mjs`, which also defines `<tutuca-app>` and the console formatter), callbacks by number through the exported `on_call` (a closure can't cross into JS), event info, files, downloads, timers, margaui, `expose`; the storybook UI and the file and clock asks on it. Every demo and the storybook page also run from an `examples/*/wasm` package (exports `start` and `on_call`) | — |
| `testing` | `Driver`, a property runner, random messages (shrunk on failure) and events, generic properties | `src/test/pbt.js` |
| `storybook`, `storybook/web` | Books of stories, runners with a timeline, stress tests (from the story, the current state or generated states) with loadable shrunk counterexamples, sending messages as JSON, the UI (JS's sidebar and Steps, Stress test and Dev tabs), `<tutuca-app>` | `src/storybook` |
| `dev` | Values in plain words; DevNode, DevSection, DevLint and DevPanel (state, tasks, component specs and lint, readable or as code), as JS's; class collection | `src/dev` |
| `examples/*` | counter, todo, json, jsonschema (viewer and studio), math (quadratic, matrix, gallery, workbench), drawing, thingtracker (Track, Insights, Manage, Data, panels, import/export), devtools stories, common (file and clock asks), each with stories and a browser demo (`web` on js, `wasm` on wasm-gc), the storybook page (both builds) and `examples/index.html` | `components/`, `demos/` |
| `examples/playground`, `examples/site/*` | The playground: edit a book's MoonBit files in CodeMirror, compile them in the browser with `@moonbit/moonc-worker` against the prebuilt packages (`playground/run` starts the storybook UI on them, `playground/link` gives the link closure), see compile errors inline and run the stories with the storybook's panels. It offers the landing page's five examples (packages `moon test` checks) and the seven component libraries (each compiled package by package, as moon builds it: its stories, its components and the example packages it builds on, such as `json_editor` under JSON Schema, every one editable). A run compiles to js or to wasm-gc (the page's backend select, `?backend=wasm-gc`; on wasm-gc `playground/run_wasm` and `link_wasm` start the storybook through `storybook/wasm` and `wasm/loader.mjs`). `<tutuca-playground example="…" [backend="wasm-gc"]>` (`playground/element.js`) embeds one in a page, lazily, sharing one compiler; `examples/index.html` embeds the five. `just playground` fetches the compiler and assembles the payload (one per backend); `docs/parity/playground.md` maps the JS tests | `src/playground`, `site/` |

## The design in one paragraph

Wherever JS looks something up by name, MoonBit uses a typed value or a typed key:
- **Messages.** A component's messages are an `enum`, and its `update` is a `match` returning the next state. Immutable structs and `{ ..s, f: v }` take the place of Immer drafts.
- **Children.** A child is reached through a `Lens` or `Items` (JS keys and `seqItem`).
- **Notifications, asks and provided values.** These are typed keys: `Signal[T]`, `Ask[A, R]` and `Provide[T]`, which carry their payload type. Handlers of different payload types are stored as closures built inside generic constructors, so nothing is ever cast.
- **Views.** A view is a typed AST (`View[S, M]`) built by builder functions. Each node carries an untyped IR for the check pass and tools, plus typed closures. Lowering compiles a view once into a plan that the shape-and-values vdom can render cheaply.

## JS → MoonBit

| JS | MoonBit |
|---|---|
| `fields: (t) => ({ ... })` | A struct with `derive(Default/Eq/Debug/ToJson/FromJson/Arbitrary)`. Constraints become `invariants`, newtypes or enums. For the dev tools, `component(..., fields=[field_info(...)], messages=json_messages([...], heard=[heard(signal)], replies=[reply("Saved", ask)]), children=() => [child(comp, lens), each_child(comp, items)], computed=[("has_due", s => ...)])` describes the fields' types and checks, the message variants' names (with the notifications it hears and the ask replies it takes, named as JS's `xReplyOk`/`xReplyError`/`xHandlerNotFound`), the component instances its state holds and its computed values. |
| `methods`, getters | Ordinary functions; the ones the dev panel shows are named in `computed=`. |
| `h`, `field`, `$if`, `Const` | `div(props, childs)`, `show(s => ...)`, `if_`/`when`, `txt`. Static and dynamic props are separate builders (`attr`/`bind`, `cls`/`class_`, `value`, `checked`), so lowering sees what never changes. |
| `each(src, child, loop)` with `loops: { filter, iter, enrich, key, prepare }` | `each(s => iter, body, key=?)`. The body reads `Item { up, value, index }`, and filters, sorts and enrichments are ordinary code in `src`. |
| `scope(name, child)` with `scopes: { bind }` | `scope(s => value, body)`. The body reads `With { up, value }`. |
| `render(field("c"), view)` / `render(seqItem(...))` / `renderEach` / `renderIt` | `render(lens, comp, view=?)` / `render_key(items, x => key, comp)` / `render_each(items, comp, filter=?, key=?)`; `render_self`/`render_self_each` for recursion. A `seqItem` collection or an `each` inside an `each` is `outer.then(inner)`, keyed by both keys (filter on the outer key to keep the selected one). |
| `provides: { p(b) { b.field(...) } }`, `provided("p")` | `provides=[key.from(lens)]` or `key.at(items, s => k)`; `when_provided(key, body)`, `render_provided(key, comp)`, `render_provided_key(key, items, x => k, comp)` for an item of a provided collection (`each(provided(...), renderIt())`), `key.current()`. |
| `pushView(expr, child)`, `views: { ... }` | `push_view(x => name, body)`, `views=() => [(name, view)]`. |
| `"@on.click": send("m", targetValue())` | `on_click(M)`, `on_input(v => M(v))`, `on_check(b => M(b))`, `on_submit(M)`, `on_event(ev, (x, e) => Some(M))`. |
| `on: { m: { args, run, pre, post, emits, sourceKey } }` | `update` (typed messages replace `args`), `pre=`, `post=`. Signals replace `emits`. `sig.from(items, (s, payload, key, ctx) => ...)` replaces `sourceKey: t.index(...)`. |
| `ctx.notify("n", args)` and `stopNext()` | `ctx.notify(sig, payload)` and `ctx.stop()`. It bubbles through the rendered ancestors that listen; the others pass it on. |
| `ctx.ask("n", args)` with `nReplyOk/nReplyError/nHandlerNotFound` | `ctx.ask(key, arg, r => Some(M(r)))`, where `r : AskResult[R]` is `Ok`, `Err` or `NotFound`. Handlers come from `scope.handle(key, (arg, reply) => ...)` or `scope.answer(key, f)`. |
| `ctx.sendAt(name, args, b => ...)`, `forwardAt` | `ctx.send_to(comp, s => lens, msg)`, frozen against the committed state as in JS. |
| `host.scope.register` / `registerAskHandlers` / `start` / `onNotify` | Components are values; `scope.handle`; `host.start(comp, state)` returns an `App` (`state`, `send`, `send_to`); `set_on_report`. |
| `lint` | Mostly the compiler. `check` (and `Component::check`) covers duplicate attributes and handlers, the reserved handler attribute, view names that don't exist and event names it doesn't know. |
| metadata comments (`src/meta.js`) | `Host::new(meta=true)` writes them; `host.component_at(node)` reads them. |
| a component that replaces itself with another kind (`return scopeOf(this).make(...)`) | A sum type for the value, and a dispatch component that renders each variant through a partial lens; the child notifies, the dispatch component swaps the variant (`examples/json_editor`, `examples/drawing`). |
| `ctx.event` (keys, pointer, modifiers, files) | `ctx.event()`: `key()`, `point()` (in the viewBox of the SVG under the pointer), `button()`, `command_key()`, `shift_key()`, `files()`, `capture_pointer()`, `prevent_default()`. |
| `pbt.js` `Driver`, `messageCommands`, `eventCommands`, `specProperties` | `@testing.Driver`, `run_messages(targets)`, `run_events`, `check_component`. |
| `stories({...})`, `step.send/event/check`, `checkStory`, `stressStory`, `startStorybook` | `book`, `story`, `send`/`send_to`/`event`/`check`, `check_books`, `Op::Stress`, `@web.start`. |

## Intentional differences

- **Event routing.** An element with handlers carries `data-h="<path>#<eid>[<loop keys>]"`, and each render binds the handlers it shows. As in JS, a host writes the component metadata comments (`meta=true`, the default), and an event reaches only the handlers of the innermost component it happened in, innermost element first, stopping at another host's root; an element outside that component's comments, even one carrying a copied handler id, routes nowhere. With `meta=false` there are no comments, and the component of the first element with a handler counts as the innermost.
- **Messages are typed values.** So `args`/`emits` schemas, string handler names and most lint rules are compile errors instead; random messages for property tests come from `derive(Arbitrary)`, and the storybook sends messages typed as JSON (`derive(ToJson, FromJson)`). Its step form, as JS's, lists every component instance the state holds (from the components' `children=`, as `Host::instances`) and sends one a message picked by name, its arguments a JSON array (`Host::send_json`); a component's notification and ask-reply handlers are listed with its variants.
- **Handler arguments** are evaluated as JS does, when the event's task runs: the view's context is read again from the state then (an `each` item by its key, or its position). The task's label uses the message the event first made.
- **Rendering skips unchanged children.** A child component's render is reused when its state, its view and every provided value it read are the same objects as last time. This is JS constant hoisting extended to whole components.
- **Notifications match collections by name.** `Signal::from(items, ...)` matches the frame by the collection's name, as JS paths match keys. Every hop of a notification runs in a task of its own, as in JS.
- **Reports are synchronous.** The host calls `on_report` synchronously; JS defers it with `setTimeout`.
- **Recursive components.** Components that reach each other through their views are built by accessor functions over a `Once`, because a toplevel `let` can't refer to itself. A component that renders its own type uses `render_self`/`render_self_each`.
- **Type annotations.** A view fragment kept in a toplevel `let`, or a closure written outside a view's expected type, needs its parameter type spelled out. MoonBit checks arguments in order, so builders take the source before the body.

## Dev tools

- **Dev panel.** `@dev.DevNode`, `DevSection`, `DevLint` and `DevPanel` show what JS's do, from `@dev.Inspected` values: JSON, paths, messages, specs (`SpecInfo::of(comp)`, with the fields and message names the component declares), component instances (a spec and its fields) and scopes. The storybook's dev panel shows the story's state as an instance of its component with its JSON's fields. A spec's methods row lists the computed values the component names in `computed=`.
- **Console formatters.** `@browser.install_formatters()` adds a DevTools custom formatter (enable it in Settings → Console). `@browser.expose(name, host, app, comp)` puts `globalThis.tutuca[name]` with `state`, `vdom` and `component`, which the formatter shows as JS's formatters do, and `componentAt(node)`. `@browser.inspect(d)` logs any `@dev.describe_*` value. MoonBit values have no class the formatter could recognize, so it shows these described values.
- **CSS.** Pages use margaui, as the JS demos do: `@browser.compile_styles(root)` compiles the classes the app renders into `<style id="margaui">`, and compiles again as new ones appear. Story previews run in `<tutuca-app>` shadow roots, with `css`, `links` and `compile` from `@web.start`.
- **Thing tracker text.** On js, search normalization and ordering use `normalize("NFD")` and `localeCompare`, as JS does. On wasm-gc and native they use a Latin table and an approximate ICU order.

## Verify

The JS and wasm-gc smoke entry points run the same scenarios from
`scripts/smoke-scenarios.mjs`, including preview disposal and classes introduced by
interactions. `internal/previews` owns the shared storybook preview lifecycle;
`storybook/web` and `storybook/wasm` adapt their DOM and callback interfaces to it.

`scripts/demos.json` lists the demos staged for release and exercised by smoke tests.
The `justfile` shares debug and release build prerequisites across tasks, and
`scripts/stage-assets.mbtx` stages release assets for either backend. Directly running
`scripts/playground-payload.mjs` still builds its prerequisites; `just playground`
uses the shared release builds and passes `--built`.

```sh
just test    # wasm-gc, js and native
just smoke   # every demo and the storybook, js and wasm-gc builds, and the playground (compiling each example) in jsdom
just serve   # serves the repo root: http://localhost:8001/tutuca-mb/examples/ links every demo (js and wasm-gc), the storybook and the playground
```
