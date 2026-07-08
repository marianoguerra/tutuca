# Tutuca — Core

Tutuca is an immutable-state web framework: components have typed `fields`,
auto-generated mutators (`setX`, `pushInX`, …), HTML-template `view`s with
`@`-prefixed directives, and `bubble` / `receive` / `response` handlers for
orchestration. Read this file when authoring or reviewing
`component({...})` definitions, `view: html\`...\`` templates, macros, or
the `tutuca` CLI.

> Load the topic files only when the task touches them (the routing
> table in [SKILL.md](./SKILL.md) has the full descriptions):
> [iteration.md](./iteration.md) · [macros.md](./macros.md) ·
> [styles.md](./styles.md) · [request-response.md](./request-response.md) ·
> [component-design.md](./component-design.md) · [testing.md](./testing.md) ·
> [storybook.md](./storybook.md) · [cli.md](./cli.md) ·
> [semantics.md](./semantics.md) · [advanced.md](./advanced.md) ·
> [margaui.md](./margaui.md) · [patterns/README.md](./patterns/README.md).

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

4. **Smoke-test the whole project** — when you've touched several
   `*.dev.js` modules, or are about to launch the storybook, do a
   project-wide dry run instead of opening a browser:

        tutuca storybook --dry-run
        tutuca storybook --dry-run --json    # machine-readable for agents

   It does everything the server would do up front — discovers every
   co-located `*.dev.js`, imports and normalizes each (catching a missing
   `getComponents()` or a malformed `getExamples()` shape), runs their
   `getTests()`, and resolves the runtime import map — then prints what
   it *would* show instead of serving. A broken module is reported in
   place (an `error` line, or `modules[].error` in `--json`) while the
   others still report, so one bad module never hides the rest. This is
   the fast "is the whole catalog wired up correctly?" check; steps 1–3
   stay the per-module loop.

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
  `@enrich-with` for scope-level derivation. The one exception: a
  **binding** may read exactly one member — `@text="@value.title"` inside
  `@each` works (any `@`-binding, one level only; `@value.a.b` is a lint
  error, and render targets still reject it).
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
- **Macro registry keys are lowercased.** `<x:Card>` becomes `<x:card>` — see [macros.md](./macros.md).

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

Because children are just immutable Records held in fields, **handlers
and methods are ordinary JS with full read access to nested child
state** — `this.child.count`, `this.items.get(i).done`,
`this.byKey.get(k).label`. Reading *down* the tree is direct and needs
no channel: an ancestor that owns a list already holds every child's
state and can read it for an aggregate decision. The single-level
`.field` restriction (no `.foo.bar`) is a **view-template** rule, not a
JS one — it's why a derivation like `userName() { return this.user.name; }`
is written as a method (see *Methods as Predicates & Computed Values*).
Reading is free; **mutating** a child still flows through the model —
the owner returns a new self (`setInItemsAt`, …) or messages the child
with `ctx.send`. Don't reach in to mutate around the handler discipline,
and prefer letting a child own and render its own state — reach down to
read only when the ancestor genuinely needs it. See
[component-design.md](./component-design.md) and "When to bubble" in
[request-response.md](./request-response.md).

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
| `<div @enrich-with=…>` (no `@each`) | scope | `it` unchanged, binds = alter result |

For full mechanics see [iteration.md](./iteration.md).
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
otherwise accepts the same value forms as `@text` — a plain field
(`@show=".isOpen"`), a no-arg method (`@show="$canSubmit"`), or a loop/scope
`@binding` (`@show="@isSelected"`, `@hide="@hasDesc"`) — read as a boolean.

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
  subtree without putting them on the component. See *Scope Enrichment*
  in [iteration.md](./iteration.md).

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

> **Scopes own the `Class`.** A component is bound to a scope at
> `registerComponents` time — that scope owns its `Class`, component tag,
> and scope-bound `make`/statics — so a given component object is live in
> one scope at a time. Each app/registry is a separate scope; the same
> *object* registered into two of them rebinds (last wins). To run the
> same definition in two genuinely separate registries at once, build an
> independent copy with `component(Comp.spec)` (new id ⇒ separately
> compiled CSS + separate identity — the price of isolation, not a way to
> dedupe within one app). For reuse inside one scope, register the single
> object once and re-export it.

**Multi-scope caveat for statics.** A static like `fromData` that builds
a *different* child type by naming the imported const directly
(`Item.Class.fromData(v)` above) hardcodes the child's *original* scope.
Fine in a single-scope app; across scopes, resolve the child through the
caller's scope instead — `this.scope.lookupComponent("Item")` — so it
deserializes into the right one. Recursion into the *same* type needs no
lookup: `this.fromData(v)` / `this.make` already target the caller's scope.

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
<button :class="$'btn {.color}'">x</button>
```

Plain attrs are static. `:attr="..."` is a dynamic expression. Boolean
HTML attributes (`disabled`, `checked`, `hidden`, …) are auto-recognized;
pass a boolean field.

A static `class="…"` and a dynamic `:class`/`@if.class` **cannot coexist on the
same element** — setting one attribute two ways is a lint error
(`DUPLICATE_ATTR_DEFINITION`), and at runtime the dynamic value wins and the
static class is dropped. Fold any structural classes into the bound expression,
e.g. `:class="$'btn {.color}'"` (note `btn` is part of the template, not a
separate `class="btn"`). The same applies to other attributes — see the
duplicate-attribute note below.

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
  (see [macros.md](./macros.md)).

Tutuca auto-namespaces by subtree: elements inside `<svg>` get the SVG
namespace and elements inside `<math>` get MathML, with spec-cased local
names preserved (`linearGradient`, `viewBox`). A `<foreignObject>` switches
its children back to the HTML namespace. Customised built-in elements work
via `is="..."` (e.g. `<button is="x-fancy">`); `is` is applied when the
element is created, so it must be a static attribute — setting it later
does not upgrade the element.

### When nothing renders (or renders unstyled)

A few mistakes fail quietly — no error, just a blank or unstyled result, which
is the slowest kind to debug. **Run `tutuca lint <module>` first**: it catches
several of these. The usual suspects:

- **Unparseable attribute value** → the attribute is silently dropped. A bare
  multi-word value isn't a string — quote it (`:label="'two words'"`) or make it
  a template (`:label="$'{.a} {.b}'"`). Lint flags this as `BAD_VALUE`.
- **camelCase attribute on a custom element** → setter no-op (see the lowercasing
  note above). Use kebab-case attributes. Not lintable — the HTML parser
  lowercases the name before either Tutuca or the linter sees it.
- **Forgotten margaui `_palette`/decoy view** → classes assembled in methods or
  interpolations render unstyled. See [margaui.md](./margaui.md). Not lintable.
- **A whitespace-only `html\`\``** → blank render. A *leading* newline before the
  root element is fine (the parser trims it); a template with no element at all
  is not.

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

Ask for the most granular arg the handler actually uses — `value` /
`valueAsInt` / `key`, not the raw `event` — when the specific value is
all you need. A handler that takes `event` forces every test and
storybook story to fabricate a DOM-event-shaped object
(`{ target: { value: … } }`); one that takes `value` is called with a
plain literal. (Genuine exceptions exist — e.g. a file input needs
`event` to reach `event.target.files`.) See
[testing.md](./testing.md) *Designing handlers so tests stay simple*.

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

Pitfall: binding a camelCase JS property on a custom element silently
fails — see the lowercasing rules in *Attribute Binding* above.

## Conditional Display

```html
<div @show=".isLoading">Loading...</div>
<div @hide=".isLoading">content</div>

<!-- boolean predicates; equals? compares against a string literal -->
<div @show="equals? .view 'detail'">detail view</div>

<!-- @show / @hide also work as directives on `<x>` render ops:
     wraps the produced node, no extra DOM element. Allowed on
     text / render / render-it / render-each. First attr in
     source order becomes the outermost wrapper. -->
<x text=".name" @show=".isOpen"></x>
<x render-it @hide=".isHidden"></x>
<x render-each=".items" @when="filter" @show=".isOpen"></x>

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

## List Iteration & Scope Enrichment

```html
<li @each=".items"><span @text="@key"></span>: <x text="@value"></x></li>
<x render-each=".items"></x>
```

Auto-bound names inside a loop are `@key` and `@value`. Iteration
(`@each` / `render-each`), filtering (`@when`), item and scope
enrichment (`@enrich-with`), pagination and the `@loop-with` return
shape, and the `@each` lifecycle: see [iteration.md](./iteration.md).

## Rendering Components

```html
<x render=".item"></x>                          <!-- default ("main") view -->
<x render=".item" as="edit"></x>                <!-- specific view (literal) -->
<x render=".item" as=".mode"></x>               <!-- view chosen by a field at runtime -->
<x render-it></x>                               <!-- only inside @each / render-each -->
<x render=".byIndex[.currentIndex]"></x>        <!-- list item access -->
<x render=".byKey[.currentKey]"></x>            <!-- map item access -->
<x render="*active"></x>                        <!-- dynamic binding — see advanced.md -->
<x render=".item" @show=".isOpen"></x>          <!-- conditional wrap, see "Conditional Display" -->
```

The top-level `view` is registered under `"main"` (the default); extras
go under `views: { name: html\`...\` }`. `as` selects which view of the
rendered component to use, falling back to `main` if absent. It accepts the
same dynamic values as `@push-view` (a literal name like `edit`, or `.field`,
`*dyn`, `@bind`, `$method`, `$'…{x}…'`), evaluated against the **host**
component at render time. `as` only applies to the **direct** component — for
whole-subtree control, use `@push-view` (next section). For `render-each` the
selector is evaluated once against the host, so every item gets the same view.

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
| `as="edit"` / `as=".mode"` | One `<x render>` element only. Literal or dynamic (like `@push-view`), evaluated against the host. |
| `@push-view=".v"`  | Every component rendered recursively under the host (children + descendants). Each picks the first stack entry it has a matching view for; falls back to `"main"`. Inner `@push-view`s nest, extending the outer ones. |

## Styles

`style` is scoped to the main view, `commonStyle` to all views of the
component, `globalStyle` is injected unscoped (see the *Component
Skeleton* above). Scoping mechanics, styling the root element with bare
declarations, and the at-rules that must live in `globalStyle`: see
[styles.md](./styles.md). Tailwind / MargaUI utility classes:
[margaui.md](./margaui.md).

## Triggers and Handlers

Tutuca has four orchestration channels. Each pairs a trigger with a
same-shape handler block:

| Triggered by                                | Handler block       | Use for                                             |
| ------------------------------------------- | ------------------- | --------------------------------------------------- |
| DOM event (`click`, `input`, …)             | `input:    { ... }` | the component handling its own events               |
| `ctx.bubble(name)` — event up the tree      | `bubble:   { ... }` | aggregate state an ancestor owns (logs, selections) |
| `ctx.send(name)` — message to a target path | `receive:  { ... }` | addressing one known component (or self)            |
| `ctx.request(name)` — async request         | `response: { ... }` | fetch / timer / IndexedDB, result routed back       |

Every handler is called as `handler(...args, ctx)` and returns a
(possibly updated) instance of `this`, which the framework swaps into
the dispatch path; `ctx` is always the trailing argument. The three
channels beyond `input` — plus `ctx.at`, the `$unknown` fallback,
per-call handler-name overrides, error handling, and request-handler
registration — are in [request-response.md](./request-response.md);
worked snippets in
[patterns/coordinate-components.md](./patterns/coordinate-components.md).

`alter` is a fifth handler block, but it isn't event-triggered — the
renderer invokes alter handlers to produce binds, not state changes
(see *Mental model*, and *Scope Enrichment* in
[iteration.md](./iteration.md)).

## Macros

Pure template expansion — `macro({ params }, html\`...\`)` definitions
called as `<x:name>`, with `^param` references, slots, and named slots:
see [macros.md](./macros.md). Registry keys are lowercased —
`<x:Card>` resolves as `<x:card>`.

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
    // value = Comp.make(...); requestHandlers (optional) mocks this example's requests
    items: [{ title, description, value, view, requestHandlers }],
  };
}
export function getTests({ describe, test, expect }) { /*...*/ }      // optional — see cli.md
```

An example item may carry an optional **`requestHandlers`** map — per-example
mocks (keyed by request name) that override the module's real
`getRequestHandlers()` for that one instance, so two examples of the same
component show different responses side by side. Return a fixture, `throw` for
the error path, or never resolve to hold a loading state. Full treatment, plus
the `on` lifecycle hooks, in [storybook.md](./storybook.md).

Best practice: have `getComponents()` return **every** component the module
defines — child and helper components included — and give each one at least
one item in `getExamples()`. A component left out of `getComponents()` is
invisible to `tutuca lint`/`render`/`test`, so it silently loses linting and
render coverage. If your components already live behind a differently named
export, alias it instead of teaching tools a new name:

```js
export { allMyComponents as getComponents } from "./app.js";
```

Put these exports in a co-located **`*.dev.js`** file (a dev-only module
holding stories + tests, never shipped) and `tutuca storybook` auto-discovers
and renders them with no setup — see [cli.md](./cli.md). The same shape is
consumed by the shipped `tutuca/storybook` library if you want to embed a
storybook in your own page — see [storybook.md](./storybook.md).

## See also

- [iteration.md](./iteration.md) — `@each` / `render-each`, `@when`,
  `@enrich-with`, `@loop-with` pagination, and the loop lifecycle.
- [macros.md](./macros.md) — `macro()` definitions, `<x:name>` calls,
  slots, and registration.
- [styles.md](./styles.md) — `style` / `commonStyle` / `globalStyle`
  scoping mechanics and pitfalls.
- [component-design.md](./component-design.md) — design judgment for shaping a
  feature into components: responsibilities, where state lives, which channel to
  reach for, and a curated do's & don'ts list.
- [request-response.md](./request-response.md) — `bubble` / `send`-`receive` /
  `request`-`response` channels, the `ctx.at` `PathBuilder`, `$unknown`, and
  request-handler registration.
- [advanced.md](./advanced.md) — dynamic bindings (`*x`), pseudo-`@x` for
  `<select>` / `<table>` / `<tr>`, drag & drop, custom seq types.
- [margaui.md](./margaui.md) — setting up MargaUI styling: install
  (CDN / npm / vendoring), theme CSS, and `compileClassesToStyleText`.
- [semantics.md](./semantics.md) — runtime semantics: path steps, the
  transaction lifecycle, dyn-var teleporting, and async key pinning
  (`livePath`).
- [testing.md](./testing.md) — `getTests` shape and the handler calling
  convention for tests.
- [storybook.md](./storybook.md) — authoring `*.dev.js` story modules and
  running / embedding the storybook.
- [cli.md](./cli.md) — commands, flags, exit codes, and the full linter rule
  list.
- [patterns/README.md](./patterns/README.md) — task-oriented recipes ("how do I
  iterate / filter / paginate / show-hide / build tabs / share state / …"),
  each linking back here and to a runnable example.
