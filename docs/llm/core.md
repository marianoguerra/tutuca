# Tutuca Cheatsheet — Core

Tutuca is an immutable-state web framework: components have typed `fields`,
auto-generated mutators (`setX`, `pushInX`, …), HTML-template `view`s with
`@`-prefixed directives, and `bubble` / `receive` / `response` handlers for
orchestration. Read this file when authoring or reviewing
`component({...})` definitions, `view: html\`...\`` templates, macros, or
the `tutuca` CLI.

> Orchestration channels — `bubble`, `send`/`receive`, async
> `request`/`response`, the `$unknown` fallback, and request-handler
> registration: see [request-response.md](./request-response.md).
> Advanced topics (drag & drop, dynamic bindings `*x`, pseudo-`x` for
> `<select>`/`<table>`/`<tr>`, custom seq types, Tailwind/MargaUI
> compilation): see [advanced.md](./advanced.md). CLI commands, flags,
> exit codes, and full linter rule list: see [cli.md](./cli.md).
> Authoring tests — `getTests` shape, calling methods/input/receive/
> bubble/response/alter handlers, designing for testability: see
> [testing.md](./testing.md). Runtime semantics — path steps, the
> transaction lifecycle, dyn-var teleporting, and async key pinning
> (`livePath`): see [semantics.md](./semantics.md). Read those only when
> the task touches them. Task-oriented "how do I do X" recipes (iteration,
> filtering, slicing, conditional content, conditional attributes, dynamic
> vars, composition, events, …): see [patterns/README.md](./patterns/README.md).

## Verifying changes

After editing a Tutuca module, run these checks before declaring the
edit done:

1. **Lint the module** — catches undefined fields/handlers/macros/events
   (all the `*_NOT_DEFINED` / `*_NOT_REFERENCED` codes):

        tutuca lint <module-path>

   Exits `2` on any error-level finding. Pass a component name to scope
   it: `tutuca lint <module-path> Button`.

2. **Test component behavior** — when the edit changes attributes,
   instance methods, input handlers, or static factories (anything
   observable from JS, not just the rendered HTML), run the test
   suite. The module opts in by exporting
   `getTests({ describe, test, expect })`:

        tutuca test <module-path>
        tutuca test <module-path> Counter           # one component
        tutuca test <module-path> --grep "inc()"    # one path

   Exits `4` on any failure. Skip this step when the change is purely
   templates/styling — `render` already covers that. Authoring patterns
   (handler calling convention, designing handlers for testability,
   worked `getTests` export) in [testing.md](./testing.md); CLI flags
   and exit codes in [cli.md](./cli.md).

3. **Render the example(s) that exercise the feature you changed** —
   confirms the component actually mounts in a headless DOM with the new
   behavior. Pick the example whose `title` matches the feature, or
   filter by component:

        tutuca render <module-path> --title "Disabled state"
        tutuca render <module-path> Button

   Exits `3` if any render crashes. If no example covers the feature
   you're adding, add one to `getExamples()` first — that's how the
   feature becomes verifiable. Add `--pretty` when you need to read the
   emitted HTML to verify structure (attributes, nesting, text); omit it
   when you only care that the render didn't crash.

Full reference: [cli.md](./cli.md).

The Tutuca CLI only catches Tutuca-specific issues. For generic JS
problems, pair it with a general linter/formatter — e.g. set up Biome
once with `npx -y @biomejs/biome init` and use its `lint`, `check`,
and `format` subcommands. Run `npx @biomejs/biome -h` for usage help.

## Common pitfalls

- **`.field` reads a field, `$method` calls a no-arg method.** The two are
  distinct prefixes: `.count` reads field `count`, `$inc` calls method
  `inc`. Using the wrong one is a lint error that tells you to swap the
  prefix.
- **Paths are not allowed in values.** `.foo` resolves a single field on
  `this` — `@text=".foo.bar"`, `:value=".user.name"`, `@show=".item.isOpen"`
  all fail. To reach into nested data: render the child as a component
  (`<x render=".foo">` then `@text=".bar"` inside), add a method
  (`fullName() { return this.user.name; }` and use `$fullName`), or use
  `@enrich-with` for scope-level derivation.
- **Coercion is shallow.** `setItems([{a:1}])` stores plain objects inside
  the `List`. Wrap each item in `Comp.make({...})` or run inputs through
  immutable's `fromJS` if you need deep coercion. See *Component Skeleton*.
- **Multiple `@if.<attr>` on one element.** Every `@then`/`@else` after
  the first must name the attr (`@then.title`, `@else.title`) — HTML
  disallows duplicate attrs, so the second `@then=` is dropped silently.
- **Bare unquoted multi-word strings return `null`.** Either quote
  (`'flex gap-3'`) or use a `$'…'` string template (`$'flex gap-3 {.color}'`).
- **`<x>` is stripped inside `<select>` / `<table>` / `<tr>`.** Use the
  `@x` pseudo-x trick (see [advanced.md](./advanced.md)).
- **`receive.init` is a convention, not a lifecycle hook.** Nothing calls it
  automatically — dispatch via `app.sendAtRoot("init")` or from
  another handler.
- **`app.state.set(...)` takes a component instance**, not plain data.
  Build with `Comp.make({...})`.
- **`html\`` templates must start with the opening tag.** A leading
  newline / indent before the first element renders blank silently.
  Use `view: html\`<el ...>` (or `html\`<el<newline>  attr<newline>>...`),
  never `view: html\`<newline>  <el ...>`. Same applies to macro bodies.
- **Macro registry keys are lowercased.** `<x:Card>` becomes `<x:card>` — see *Macros*.

## Bootstrap

```js
import { component, html, tutuca } from "tutuca";

const Counter = component({
  name: "Counter",
  fields: { count: 0 },
  methods: {
    inc() {
      return this.setCount(this.count + 1);
    },
  },
  view: html`<button @on.click="$inc" @text=".count"></button>`,
});

const app = tutuca("#app");
app.registerComponents([Counter]);
app.state.set(Counter.make({}));
app.start();
```

`app.onChange((info) => ...)` fires after every state change with
`{ val, old, info, timestamp }` (logging, persistence). `app.stop()`
removes all listeners and cancels cache eviction; pair with
`app.start()` to remount cleanly in tests or SPA navigation.

## Mental model

Tutuca rests on three invariants: the application state is a single
immutable root value; the view is a pure function of it; every handler
takes the old self and returns a new self. The transactor swaps the
root atomically. Identity-based caching, time-travel-style debugging,
and the entire dispatch model fall out of these three properties.

**The value tree.** Components are nested immutable Records. Children
live in fields — a list of `Item`, a map of `User`, a scalar `count`.
"Updating a deep child" means producing a new root that shares
structure with the old one along the unchanged spine; the renderer
keys its cache on `===` identity, so unchanged subtrees skip work.
Every value carries a hidden tag back to its component class, so the
runtime never needs `instanceof` — it asks the value what it is.

**Stack: frames vs scopes.** As the renderer walks the AST it pushes
`BindFrame`s. A *frame* is a barrier: name lookups (`@x`) stop at it,
so a child component view sees a clean namespace. A *scope* is
transparent: iteration `key` / `value` and `@enrich-with` binds layer
onto the surrounding frame and remain visible to handlers attached to
the same iteration. `it` (the target of `.field` reads and `$method`
calls) is set on both.

| pushed by                           | kind  | shape                                |
| ----------------------------------- | ----- | ------------------------------------ |
| `<x render=".f">` / `<x render-it>` | frame | `it` = child, fresh binds            |
| `<x render-each>` per iter          | frame | `it` = item, binds `{ key }`         |
| `<div @each>` per iter              | scope | `it` = item, binds `{ key, value }`  |
| `<x:scope @enrich-with=…>`          | scope | `it` unchanged, binds = alter result |

For full mechanics see *List Iteration* and *Scope Enrichment*.
This is why a handler attached to `<div @each>` runs against the
*parent* component (the scope is transparent — the surrounding frame
still owns dispatch), while one inside `<x render-it>` runs against
the *item* (render-it pushed a fresh frame for the child).

**Paths, not references.** The DOM is the only thing that survives
between render and click, so the renderer leaves breadcrumbs:
`data-cid` / `data-nid` / `data-eid` on rendered elements, and `§…§`
HTML comments adjacent to iteration entries. On a DOM event the
runtime walks from the target up to the root, reads those breadcrumbs,
and rebuilds a *positional* `Path` — an array of steps from the root
to the value the handler should run against. The same `Path` is reused
verbatim for `ctx.send`, `ctx.bubble`, and `ctx.request` /
response: because it's positional rather than a captured reference, an
async response survives intervening transactions that rebuild the root.
"The right slot" is exact for named fields and for map entries by key
(seq-access keys like `.sheets[.selId]` are *pinned* to their
request-time value by default); a bare list **index** still slides if the
list reordered. See [request-response.md](./request-response.md) for the
dispatch APIs and [semantics.md](./semantics.md) for the path/transaction
model and key pinning.

**Why `alter` is its own table.** Alter handlers are pure, evaluated
on every render, and produce binds (no state change). `input` /
`receive` / `bubble` / `response` are transactional and produce new
values. Same lookup mechanism, different contracts — keep them
separate.

## Notation Reference

Views are name-based: there is no arithmetic expression syntax in
values, and no Vue- or Mustache-style `{{ … }}` placeholders. Every
value slot — conditions (`@show`, `@if`), iteration (`@each`,
`render-each`, `@when`), enrichment (`@enrich-with`, `@loop-with`), template
expansion (`{…}`, `:attr`, `@text`) — names a field, method, macro, or
handler defined on the component (or registered with the app). Logic
lives in `methods` / `alter` / `input` / `bubble` / `receive` /
`response` and is referenced by name; the template itself only routes
data and events.

The one exception is **boolean predicates** in conditional slots
(`@show`, `@hide`, `@if.<attr>`): a closed set of operators applied to
a value, written predicate-first like a handler call —
`empty?`, `truthy?`, `falsy?`, `null?`, `equals?`. E.g.
`@hide="empty? .items"`, `@show="truthy? .query"`. A conditional slot
still accepts a plain field (`@show=".isOpen"`) or no-arg method
(`@show="$canSubmit"`) name too.

`equals?` takes two args and is the idiomatic way to show/hide by name,
e.g. `@show="equals? .view 'detail'"`. Predicate args (and handler
args) accept string literals: `'detail'`, or `'two words'` for a
literal with spaces (escape an interior quote as `\'`).

| Prefix   | Means                                     | Example               |
| -------- | ----------------------------------------- | --------------------- |
| `.x`     | field on `this` (single-level — no `.foo.bar` paths) | `.count`, `.title` |
| `$x`     | no-arg method call on `this`              | `$inc`, `$canSubmit`  |
| `@x`     | local binding (loop / scope)              | `@key`, `@value`      |
| `^x`     | macro parameter                           | `^label`              |
| `!x`     | request handler                           | `!loadData`           |
| `*x`     | dynamic binding — see [advanced.md](./advanced.md) | `*theme`          |
| `Name`   | component type (PascalCase)               | `Item`, `JsonNull`    |
| `name`   | bare identifier — meaning depends on slot | `dec`, `value`        |
| `'str'`  | string literal                            | `'btn btn-success'`   |
| `$'…'`   | string template (`{expr}` interpolation)  | `$'Hi {.name}'`       |
| `.s[.k]` | sequence/map item access                  | `.byKey[.currentKey]` |
| `pred? .x` | boolean predicate in a conditional slot | `empty? .items`, `equals? .view 'detail'` |

`.x` and `$x` are not interchangeable: `.x` only reads a field, `$x`
only calls a method. The linter flags a mismatch and tells you which
prefix to use.

A bare `name` (no prefix) in `@on.<event>="<handler> <arg> <arg>..."`
resolves by slot:

- **First slot** — handler name looked up in `input` / `alter` (use
  `$name` for `methods`).
- **Subsequent slots** — built-in handler arg name (full list in
  *Event Handling*); anything else triggers a lint warning.

```html
<button @on.click="addItem JsonSelector">+</button>
<!--                ↑ handler ↑ Type -->
```

`ctx` (an `EventContext`) is auto-appended as the trailing arg, so the
handler is called as `addItem(JsonSelector, ctx)`. Don't list `ctx` in
the template — it's always passed.

## Quoting & String Literals

A string template is written `$'…'` — a single-quoted run with a leading
`$`, holding `{expr}` interpolations. `:attr=` and other text slots accept
`$'…'` templates; `@if`, `@each`, `<x render=>` do not.

| Form                | Example                   | Where it works                                   |
| ------------------- | ------------------------- | ------------------------------------------------ |
| `'string'`          | `@then="'btn ok'"`        | anywhere a value is allowed                      |
| `$'…'` template     | `:class="$'btn {.kind}'"` | `:attr=`, `@text`, `@title`, macro dynamic attrs |
| Bare without quotes | `flex gap-3`              | **never** — returns `null`                       |
| Bare identifier     | `dec`, `value`            | name slots only (handler/arg, not as a value)    |

```html
<!-- ✅ -->
<p :class="'flex gap-3'">x</p>
<p :class="$'flex {.color}'">x</p>         <!-- $'…' string template -->
<p :class="$'static-classes {\'\'}'">x</p> <!-- folds to a const -->

<!-- ❌ -->
<p :class="flex gap-3">x</p>               <!-- null: no quotes -->
<p :class="flex {.color}">x</p>            <!-- null: unquoted {…} is not a template -->
<x render="'foo bar'"></x>                 <!-- @render rejects string templates -->
```

## Component Skeleton

```js
component({
  name: "MyComp",
  fields: {                    // see "Field Types"
    count: 0,
    items: [],
    nullable: null,
  },
  view: html`<p @text=".count"></p>`,    // default view (named "main")
  views: {                                // additional views
    edit: html`<input :value=".count" @on.input="$setCount valueAsInt" />`,
    big: {
      view: html`<h1 @text=".count"></h1>`,
      style: css`h1 { font-size: 4rem; }`,
    },
  },
  style:        css`p { color: blue; }`,         // scoped to main view
  commonStyle:  css`p { font-family: sans-serif; }`, // scoped to all views of this component
  globalStyle:  css`body { margin: 0; }`,        // injected globally, no scoping
  methods: { inc() { return this.setCount(this.count + 1); } },
  input:   { onClick(ctx) { return this.inc(); } },
  alter:   { filterItem(_k, item) { return item.length > 0; } },
  receive: { init(ctx) { ctx.request("loadData"); return this; } },
  bubble:  { itemPicked(item, ctx) { return this.setSelected(item); } },
  response:{ loadData(res, err, ctx) { return this.setItems(res); } },
  statics: { fromData(d) { return this.make({ count: d.n ?? 0 }); } },
  // provide: { ... }, lookup: { ... }   // see advanced.md
});
```

`Comp.make({...})` builds an instance. Coercion is automatic but
**shallow**: arrays become `List`, plain objects become `IMap`, native
`Set` becomes `ISet`. Items inside a list/map field stay as-is —
`setItems([{a:1}])` gives `List<plainObject>`; access with `item.a`, not
`item.get("a")`. For deep coercion, run inputs through immutable's
`fromJS`, or wrap each item in `Comp.make({...})`.

## Field Types & Auto-generated API

`fields: { name: defaultValue }` — type inferred from the default.

| Default              | Field type | Auto-generated methods (for field `x`)                                                                                             |
| -------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `"hi"`               | text       | `setX`, `updateX`, `resetX`, `xLen`                                                                                                |
| `42`                 | float      | `setX`, `updateX`, `resetX`                                                                                                        |
| (`{type:"int"}`)     | int        | `setX`, `updateX`, `resetX` (no default-value form — declare explicitly via `classFromData`)                                       |
| `true`               | bool       | `setX`, `toggleX`, `updateX`, `resetX`                                                                                             |
| `null`               | any        | `setX`, `updateX`, `resetX`                                                                                                        |
| `[]`/`List()`        | list       | `setX`, `pushInX`, `insertInXAt`, `setInXAt`, `getInXAt`, `updateInXAt`, `deleteInXAt`/`removeInXAt`, `xLen`, `resetX`             |
| `{}`/`IMap()`        | map        | `setInXAt`, `getInXAt`, `updateInXAt`, `deleteInXAt`, `xLen`, `resetX`                                                             |
| `OMap()`             | omap       | same as map (preserves insertion order)                                                                                            |
| `ISet()`/`new Set()` | set        | `addInX`, `deleteInX`, `hasInX`, `toggleInX`, `xLen`, `resetX`                                                                     |

Emptiness / truthiness / null checks are not generated as methods — use
the boolean predicates `empty?`, `truthy?`, `falsy?`, `null?`, `equals?`
in a conditional slot instead (e.g. `@hide="empty? .x"`,
`@show="equals? .view 'detail'"`).

Explicit field types via `classFromData`:

```js
fields: {
  count: { type: "int", defaultValue: 10 },       // text/int/float/bool/list/map/omap/set/any
  child: { component: "Item", args: { ... } },    // deferred reference by name
  child2: Item.make({ name: "" }),                // direct default if Item is in scope
}
```

The `{ component, args }` form is for when the referenced component is **not
available** at field-definition time (forward reference, circular import).
`component` must be the component **name as a string** — passing the class
itself is a common mistake and is flagged by lint code
`COMP_FIELD_BAD_SHAPE`. When the component class **is** in scope, prefer
`ComponentName.make({...})` as the default value — no string indirection.

## Methods as Predicates & Computed Values

A no-arg method called via `$name` is invoked and its return value is
used. Works anywhere a value is read — `@text`, `:attr`, `@show` /
`@hide`, `@if.<attr>`, and `{…}` interpolation. (`.name` is a field
read and never invokes; `$name` is the method call.)

```js
methods: {
  canSubmit()   { return this.title.length > 0 && !this.isLoading; },
  buttonClass() { return this.isActive ? "btn btn-primary" : "btn"; },
  fullName()    { return `${this.first} ${this.last}`; },
}
```

```html
<button @show="$canSubmit" :class="$buttonClass">Save</button>
<p :title="$'Hello, {$fullName}'" @text="$fullName"></p>
```

The boolean predicates (`empty?`, `truthy?`, `falsy?`, `null?`,
`equals?`) cover single-field checks in conditional slots; reach for a
method when the condition spans multiple fields or needs derivation. The
method takes no args.

Tutuca expressions resolve a **single** name on `this` — there is no
path syntax. `@text=".user.name"` does not navigate; it fails. When the
value lives behind a field, your options are:

- **Render the child as a component** — `<x render=".user">` then
  `@text=".name"` inside the child's view. Best when the nested thing is
  already (or could be) a component.
- **Add a method** — `userName() { return this.user.name; }` then
  `@text="$userName"`. Best for one-off derivations or formatting.
- **Use `@enrich-with`** — exposes computed values as `@`-bindings to a
  subtree without putting them on the component. See *Scope Enrichment*.

Exceptions: `@each` / `render-each` accept `.field` or `*dynamic` only
(not a `$method` — a method result has no addressable path for event
dispatch, so `$m` is rejected there at parse time), and `<x render>`
expects a component instance — for a derived list, store it in a field
or use `@when` with `alter`.

## Statics

`statics: {...}` adds methods to the component **class**, not instances.
Available as `Comp.Class.<name>(...)` alongside the auto-generated
`Comp.Class.make(...)` (which `Comp.make(...)` aliases). Inside a static,
`this` is the class itself.

Common use: a `fromData` factory that recursively builds instances from
plain JS data:

```js
statics: {
  fromData({ items = [] }) {
    return this.make({ items: items.map((v) => Item.Class.fromData(v)) });
  },
}
// usage: TreeRoot.Class.fromData([...])
```

### One definition, multiple scopes (`clone`)

A component is built once and bound to a scope at `registerComponents`
time: that scope owns the component's `Class`, the per-instance
component tag, and the scope-bound `make`/statics. Re-registering the
*same* component object into another scope rebinds it (last wins) —
fine for a fresh re-setup, but it means a single definition can't be
live in two scopes at once.

To register the same definition into a second scope simultaneously, use
`Comp.clone()` — it returns a fresh, fully independent `Component` (new
id, its own `Class`) built from the same spec:

```js
scopeA.registerComponents([Widget]);
scopeB.registerComponents([Widget.clone()]); // independent Class + scope
```

Each clone has its own `Class`, so `getCompFor(instance)` and a static's
`this.scope` / `this.make` resolve unambiguously to the scope that
instance belongs to — even after immutable `.set()` updates, since the
component tag lives on the (per-scope) prototype.

**Caveat — statics that reach a child by its module-level const.** A
static like `fromData` that builds a *different* child type by naming the
imported const directly (`Item.Class.fromData(v)` above) hardcodes the
child's *original* scope. In a single-scope app that's the only scope, so
it's fine. But once you `clone()` either component into another scope, the
parent clone still deserializes children through the original `Item` —
wrong scope. For multi-scope safety, resolve the child through the
caller's scope instead of the module-level const:

```js
fromData({ items = [] }) {
  const Item = this.scope.lookupComponent("Item");
  return this.make({ items: items.map((v) => Item.Class.fromData(v)) });
}
```

Recursion into the *same* type needs no lookup — use `this.fromData(v)`
(or `this.make`), which already targets the caller's scope.

## Text Rendering

```html
<span @text=".str"></span>          <!-- prepend text into span -->
<x text=".bool"></x>                <!-- text-only, no DOM element -->
<x text="$getStrUpper"></x>         <!-- $ calls a method -->
<x text="@value"></x>               <!-- loop binding -->
```

Use `@text` when you already have a host element to put the text in; use
`<x text=…>` for bare text with no wrapping element (e.g. text interleaved with
other inline content, or a loop binding). Both take the same value forms
(`.field`, `$method`, `@binding`).

## Attribute Binding

```html
<input :value=".str" @on.input="$setStr value" />
<a :href=".url" :title="$'Hi {.name}'">link</a>       <!-- string template -->
<button class="btn" :class="$'btn {.color}'">x</button>
```

Plain attrs are static. `:attr="..."` is a dynamic expression. Boolean
HTML attributes (`disabled`, `checked`, `hidden`, …) are auto-recognized;
pass a boolean field.

The HTML parser lowercases attribute names before Tutuca sees them, so
`:mapId` arrives as `:mapid` and `<x:Card>` becomes `<x:card>`. Three
consequences:

- SVG attributes are case-sensitive. Tutuca special-cases `:viewbox` →
  `viewBox` so SVG roots work; for other camelCased SVG attrs, wrap them
  in components that emit raw markup.
- Custom-element property setters defined in camelCase **will not fire**.
  `:mapId=".mapId"` runs `node.mapid = value`; if the
  element defined `set mapId(...)`, the lookup misses and JS silently
  creates an own data property `mapid` on the element instead of invoking
  the setter — no error, no warning, the bound state stays null. Author
  custom elements with kebab-case attributes plus lowercased property
  setters (or aliases), and bind via `:kebab-name` from Tutuca templates.
- Macro registry keys are lowercased on insert for the same reason
  (see *Macros* below).

Tutuca auto-namespaces by subtree: elements inside `<svg>` get the SVG
namespace and elements inside `<math>` get MathML, with spec-cased local
names preserved (`linearGradient`, `viewBox`). A `<foreignObject>` switches
its children back to the HTML namespace. Customised built-in elements work
via `is="..."` (e.g. `<button is="x-fancy">`); `is` is applied when the
element is created, so it must be a static attribute — setting it later
does not upgrade the element.

## Event Handling

```html
<!-- method (`$`) vs input handler (no prefix) -->
<button @on.click="$inc">+</button>
<button @on.click="dec">-</button>

<!-- pass args by name -->
<input @on.input="$setStr value" />
<input @on.input="$setN valueAsInt" />
<button @on.click="$pick @key isAlt">pick</button>
<button @on.click="$addItem JsonSelector">+</button>     <!-- type as arg -->
<button @on.click="$loadAnotherWay">load</button>        <!-- ctx auto-appended -->
```

Every `@on.<event>` handler receives an `EventContext` as its trailing
arg automatically — written args come first, `ctx` last. So
`$loadAnotherWay` is called as `loadAnotherWay(ctx)`, and `$pick @key isAlt`
is called as `pick(key, isAlt, ctx)`. You can still write `ctx` in the
template (it resolves to a fresh `EventContext`), but it is redundant.

Built-in handler arg names: `value`, `valueAsInt`, `valueAsFloat`,
`target`, `event`, `isAlt`, `isShift`, `isCtrl`/`isCmd`, `key`, `keyCode`,
`isUpKey`, `isDownKey`, `isSend`, `isCancel`, `isTabKey`, `ctx`,
`dragInfo`.

The content of `value` depends on the event source:

| Source                      | What `value` resolves to                         |
|-----------------------------|--------------------------------------------------|
| `<input type="checkbox">`   | `event.target.checked` (boolean)                 |
| `CustomEvent`               | `event.detail`                                   |
| anything else               | `event.target.value` (string), or null if absent |

For numeric inputs, prefer `valueAsInt` / `valueAsFloat` to skip the
string parse.

### Event Modifiers

`@on.<event>+<mod>+<mod>=...`

- All events: `+ctrl`, `+cmd`/`+meta`, `+alt`
- `keydown` only: `+send` (Enter), `+cancel` (Escape)

```html
<input @on.keydown+send="$submit value" @on.keydown+cancel="$reset" />
<button @on.click+ctrl="$soloOnly">ctrl-click</button>
```

### Web Components & Custom Events

Custom elements just work, and any `CustomEvent` they fire is reachable
via `@on.<event-name>`. The event's `detail` surfaces as `value`:

```js
import "https://cdn.jsdelivr.net/npm/emoji-picker-element/+esm";

input: { onPick(detail) { return this.setCurrent(detail.unicode); } }
view: html`<emoji-picker @on.emoji-click="onPick value"></emoji-picker>`,
```

Handle these events declaratively with `@on.<event-name>` in the view —
don't grab the node from host/glue code and `addEventListener` on it. A
listener attached from outside the component runs outside the handler
model: no `return this.set…()`, no transactor batching, and the mutation
is invisible to the component that owns the state (the same hazard as
reaching into `app.state` directly). For any event with a real element in
the tree, `@on.` is the only entry point you need. Genuinely external
inbound sources (WebSocket, `postMessage`, timers) have no element to bind
— route those through `app.sendAtRoot` instead (see
[request-response.md](./request-response.md)).

Pitfall: binding camelCase JS properties on a custom element silently
fails. `:mapId=".id"` does *not* invoke a `set mapId` setter
— the HTML parser lowercased the attribute name, so the framework assigns
to `node.mapid` instead, creating an own property and bypassing the
setter. Use kebab-case attributes / lowercased setters when authoring
custom elements for use with Tutuca. See *Attribute Binding* above.

## Conditional Display

```html
<div @show=".isLoading">Loading...</div>
<div @hide=".isLoading">content</div>

<!-- boolean predicates; equals? compares against a string literal -->
<div @show="equals? .view 'detail'">detail view</div>

<!-- show / hide also work as wrapper attrs on `<x>` render ops:
     wraps the produced node, no extra DOM element. Allowed on
     text / render / render-it / render-each. First attr in
     source order becomes the outermost wrapper. -->
<x text=".name" show=".isOpen"></x>
<x render-it hide=".isHidden"></x>
<x render-each=".items" when="filter" show=".isOpen"></x>

<!-- Single @if: shorthand @then/@else (attr inferred) -->
<button @if.class=".isActive" @then="'btn btn-success'" @else="'btn btn-ghost'">
  ...
</button>

<!-- Multiple @if on same element: name the attr explicitly -->
<button
  @if.class=".isActive"
  @then="'on'"
  @else="'off'"
  @if.title=".isActive"
  @then.title="'On'"
  @else.title="'Off'"
>
  ...
</button>
```

> HTML disallows duplicate attrs, so with multiple `@if.<attr>` on one
> element every `@then`/`@else` after the first **must** include the attr
> name — otherwise the parser drops it before tutuca sees it.

## List Iteration

`@each` accepts: `.field`, `*dynamic`.

```html
<!-- iterate plain values -->
<li @each=".items"><span @text="@key"></span>: <x text="@value"></x></li>

<!-- filter -->
<li @each=".items" @when="filterItem">...</li>

<!-- per-item enrichment (binds.X => @X in template) -->
<li @each=".items" @enrich-with="enrichItem">
  <x text="@count"></x>
</li>

<!-- shared per-loop data + slicing (computed once before iteration) -->
<li @each=".items" @loop-with="getIterData" @when="filterItem">...</li>

<!-- render a list of components -->
<x render-each=".items"></x>
<x render-each=".items" as="edit"></x>                          <!-- specific view -->
<x render-each=".items" when="filterItem"></x>                  <!-- with filter -->
<x render-each=".items" loop-with="getIterData" when="filterItem"></x>
<x render-each=".items" show=".isOpen"></x>                     <!-- wrap in show -->
```

On `<li @each>` / `<div @each>` and other host-element loops the
filters are written `@when` / `@enrich-with` / `@loop-with` (the `@`
prefix is the element-directive convention). On `<x render-each>` the
same filters drop the prefix — `when=` / `enrich-with=` / `loop-with=`
— because `<x>` carries plain attributes, not directives. Both forms
share the handler-name resolution rules below.

```js
alter: {
  filterItem(_key, item, iterData) { return item.includes(iterData.q); },
  enrichItem(binds, _key, item, iterData) { binds.count = item.length; },
  // `@loop-with` returns { iterData?, start?, end? } — all optional.
  getIterData(seq) {
    const start = this.page * this.pageSize;
    return { iterData: { q: this.query.toLowerCase() }, start, end: start + this.pageSize };
  },
}
```

#### `@loop-with` return shape — `iterData` + slicing

A `@loop-with` handler returns an object with up to three optional keys:

- **`iterData`** — the shared per-loop value handed to `@when` /
  `@enrich-with`. Defaults to `{ seq }` when omitted.
- **`start`, `end`** — a positional slice of the iteration, with
  `Array.prototype.slice` semantics: `end` is exclusive, negatives count
  from the end (`end: -3` drops the last 3), `undefined` means the
  natural bound. Use this to **paginate** — skip a prefix and/or suffix
  without iterating or rendering it.

Slicing is positional but **preserves each item's original key**: a List
sliced to `start: 2` still binds `@key` to `2, 3, …`, so events, drag,
and two-way binding keep their identity. `@when` then filters *within*
the window, so a page may yield fewer than `end - start` items.

### Lifecycle of `@each`

For each render of an element with `@each=".items"`:

1. **Resolve sequence** — evaluate `.items`. Lists, IMaps, OMaps, ISets,
   and any class declaring a `SEQ_INFO` walker are recognized.
2. **`@loop-with`** (once per render) — `getIterData.call(this, seq)` is
   called with the full sequence; its `iterData` becomes the shared
   per-loop value and its `start`/`end` slice the iteration. Skipped if
   no `@loop-with`; then `iterData` is `{ seq }` and the whole sequence
   is iterated.
3. For each `(key, value)` pair in the sliced sequence:
   1. **`@when`** — `filterItem.call(this, key, value, iterData)`; if it
      returns `false`, the item is skipped.
   2. **`@enrich-with`** — `enrichItem.call(this, binds, key, value, iterData)`.
      `binds` is a **mutable object** seeded with `{ key, value }`;
      mutating it (`binds.count = ...`) creates `@`-prefixed bindings
      available in the templated children. The return value is ignored.
   3. **Render** the element with the new bindings on the stack.

Auto-bound names inside the loop are always `@key` and `@value` (or
whatever you wrote into `binds`).

### Handler resolution

`@when` / `@enrich-with` / `@loop-with` resolve like event handler names:
bare `filterItem` → `alter.filterItem` (idiomatic); `$filterItem` →
method on `this` (works, not idiomatic — `alter` keeps iteration helpers
grouped).

## Scope Enrichment

Without an `@each` on the same element, `@enrich-with` becomes a scope
enricher: it takes no `binds` arg, and its **return value** is the
bindings object whose keys become `@`-prefixed bindings for descendants.

```js
alter: { enrichScope() { return { len: this.text.length }; } }
```

```html
<div @enrich-with="enrichScope">Length: <x text="@len"></x></div>
```

## Rendering Components

```html
<x render=".item"></x>                          <!-- default ("main") view -->
<x render=".item" as="edit"></x>                <!-- specific view -->
<x render-it></x>                               <!-- only inside @each / render-each -->
<x render=".byIndex[.currentIndex]"></x>        <!-- list item access -->
<x render=".byKey[.currentKey]"></x>            <!-- map item access -->
<x render="*active"></x>                        <!-- dynamic binding — see advanced.md -->
<x render=".item" show=".isOpen"></x>           <!-- conditional wrap, see "Conditional Display" -->
```

The top-level `view` is registered under `"main"` (the default); extras
go under `views: { name: html\`...\` }`. `as="edit"` selects the `edit`
view of the rendered component, falling back to `main` if absent. `as`
only applies to the **direct** component — for whole-subtree control,
use `@push-view` (next section).

## Multiple Views & View Stack

```js
component({
  view:  html`<p @text=".title"></p>`,                              // "main"
  views: { edit: html`<input :value=".title" @on.input="$setTitle value" />` },
});
```

```html
<!-- @push-view pushes a name onto the rendering stack;
     descendants resolve to first matching view, falling back to "main" -->
<div @push-view=".view"><x render-each=".items"></x></div>
```

| Directive          | Scope                                                                    |
|--------------------|--------------------------------------------------------------------------|
| `as="edit"`        | One `<x render>` element only.                                           |
| `@push-view=".v"`  | Every component rendered recursively under the host (children + descendants). Each picks the first stack entry it has a matching view for; falls back to `"main"`. Inner `@push-view`s nest, extending the outer ones. |

## Styles

```js
component({
  style:       css`.mine { color: red; }`,        // scoped to main view
  commonStyle: css`.shared { color: yellow; }`,   // scoped to all views of this component
  globalStyle: css`.app-thing { color: green; }`, // global, no scoping
  views: {
    two: { view: html`...`, style: css`.mine { color: orange; }` },
  },
});
```

Tagged templates `html` and `css` are just `String.raw` (editor hinting
only). Plain strings work too.

## Triggers and Handlers

Tutuca has four orchestration channels. Each one pairs a trigger with
a same-shape handler block:

| Triggered by                                | Handler block       |
| ------------------------------------------- | ------------------- |
| DOM event (`click`, `input`, …)             | `input:    { ... }` |
| `ctx.send(name)` — message to a target path | `receive:  { ... }` |
| `ctx.request(name)` — async request         | `response: { ... }` |
| `ctx.bubble(name)` — event up the tree      | `bubble:   { ... }` |

Every handler is called as `handler(...args, ctx)` and returns a
(possibly updated) instance of `this`; the framework swaps the
returned value into the dispatch path. The three event-driven channels
beyond `input` — `bubble`, `send`/`receive`, async `request`/`response`
— plus the shared `$unknown` fallback and request-handler registration
are documented in [request-response.md](./request-response.md); the
brief anchors below cover the essentials.

`alter` is a fifth handler block, but unlike the four above it isn't
event-triggered — the renderer invokes alter handlers to produce
binds, not to update state. See *Mental model* and *Scope Enrichment*.

## Orchestration channels (bubble / send-receive / request-response)

Beyond local `input` handlers, three channels move state between
components. Full mechanics — when-to-use guidance, the `ctx.at`
`PathBuilder`, error handling, per-call handler-name overrides, the
`$unknown` fallback, and request-handler registration — are in
[request-response.md](./request-response.md). The essentials:

- **`bubble`** — `ctx.bubble("name", args)` walks the dispatch path
  toward the root; each ancestor with `bubble.<name>(...args, ctx)`
  runs (after descendants transact); `ctx.stopPropagation()` halts it.
  Use for aggregate state owned by an ancestor (logs, selections).

  ```js
  input:  { onClick(ctx) { ctx.bubble("itemSelected", [this]); return this; } },
  bubble: { itemSelected(item, ctx) { return this.insertInLogAt(0, item.label); } },
  ```

- **`send` / `receive`** — `ctx.send("name", args)` delivers a message
  to one target (self by default, or `ctx.at.field("x").send(...)` /
  `.index(name, i)` / `.key(name, k)` for another); the target's
  `receive.<name>(...args, ctx)` runs. `receive.init` is a convention,
  not a lifecycle hook — dispatch it via `app.sendAtRoot("init")`.

- **`request` / `response`** — `ctx.request("name", args)` runs a
  host-registered async handler (registered with
  `scope.registerRequestHandlers({...})`) and routes the result to
  `response.<name>(res, err, ctx)` — `res` set on success, `err` on
  failure. Use for fetch / timer / IndexedDB work.

  ```js
  receive:  { init(ctx) { ctx.request("loadData"); return this.setIsLoading(true); } },
  response: { loadData(res, err, ctx) { return this.setIsLoading(false).setItems(res); } },
  ```

`ctx` is always the last argument of every `bubble` / `receive` /
`response` handler.

## Macros

Pure template expansion — no state, no methods. Calls inside a macro
resolve against the *host* component.

```js
import { macro, html } from "tutuca";

const badge = macro(
  { label: "'New'", kind: "'info'" },     // defaults are *expressions*
  html`<span :class="$'badge badge-{^kind}'" @text="^label"></span>`,
);

export function getMacros() {
  return { badge };
}
```

```html
<x:badge></x:badge>                       <!-- defaults -->
<x:badge label="Sale"></x:badge>          <!-- static string (no quotes needed) -->
<x:badge :label="'Sale'"></x:badge>       <!-- dynamic literal -->
<x:badge :label=".status"></x:badge>      <!-- field reference -->
```

Register macros at the same scope as components:

```js
const scope = app.registerComponents([Comp]);
scope.registerMacros(getMacros());
```

Registry keys are lowercased on insert because the HTML parser already
lowercases `<x:Tag>` to `<x:tag>`. `{ Card }` and `{ card }` both register
under `card`; registering two *different* macros under the same lowercased
name warns via `console.assert`.

### Slots

```js
const card = macro(
  { title: "'Card'" },
  html`<div class="card">
    <h2 @text="^title"></h2>
    <x:slot></x:slot>
  </div>`,
);
```

```html
<x:card title="Hi"><p>body</p></x:card>   <!-- default slot -->
```

### Named Slots

```js
const panel = macro(
  {},
  html`<div>
    <header><x:slot name="actions"></x:slot></header>
    <main><x:slot></x:slot></main>                      <!-- default == name="_" -->
    <footer><x:slot name="footer"></x:slot></footer>
  </div>`,
);
```

```html
<x:panel>
  <x slot="actions"><button @on.click="$inc">+</button></x>
  <p>default slot content</p>
  <x slot="footer">© 2026</x>
</x:panel>
```

## Raw HTML (escape hatch)

```html
<div @dangerouslysetinnerhtml=".trustedHtml"></div>
```

Bypasses all escaping; children of the element are ignored when active.

## Immutable Re-exports

`tutuca` re-exports **everything** from
[`immutable`](https://immutable-js.com/) (`List`, `OrderedMap`, `Record`,
`Seq`, `is`, `fromJS`, ...), plus short aliases to avoid clashes with
the host runtime's `Map` / `Set`:

```js
import {
  IMap, OMap, ISet,         // aliases for Map, OrderedMap, Set
  isIMap, isOMap,           // aliases for isMap, isOrderedMap
  List, Record, Seq, fromJS, is,    // ...everything else immutable exports
} from "tutuca";
```

Because every `immutable` export is reachable through `tutuca`, if an
`immutable-js` skill is available, load it alongside this one — its
guidance applies directly to the values you'll be reading and writing.

## Conventional Module Exports

Examples and the storybook glue follow this shape so files compose freely
and the `tutuca` CLI can introspect any module without per-app glue:

```js
export function getComponents()       { return [Comp, ...]; }
export function getMacros()           { return { name: macro }; }      // optional
export function getRequestHandlers()  { return { name: async fn }; }    // optional
export function getRoot()             { return Root.make({...}); }
export function getExamples()         {
  // Return one section, or an array of sections.
  return {
    title: "...",
    description: "...",
    items: [{ title, description, value, view }],         // value = Comp.make(...)
  };
}
export function getTests({ describe, test, expect }) { /*...*/ }      // optional — see cli.md
```

## See also

- [request-response.md](./request-response.md) — `bubble` / `send`-`receive` /
  `request`-`response` channels, the `ctx.at` `PathBuilder`, `$unknown`, and
  request-handler registration.
- [advanced.md](./advanced.md) — dynamic bindings (`*x`), pseudo-`@x` for
  `<select>` / `<table>` / `<tr>`, drag & drop, custom seq types, Tailwind /
  MargaUI compilation.
- [semantics.md](./semantics.md) — runtime semantics: path steps, the
  transaction lifecycle, dyn-var teleporting, and async key pinning
  (`livePath`).
- [testing.md](./testing.md) — `getTests` shape and the handler calling
  convention for tests.
- [cli.md](./cli.md) — commands, flags, exit codes, and the full linter rule
  list.
- [patterns/README.md](./patterns/README.md) — task-oriented recipes ("how do I
  iterate / filter / paginate / show-hide / build tabs / share state / …"),
  each linking back here and to a runnable example.
