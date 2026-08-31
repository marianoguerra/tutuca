# Tutuca Cheatsheet

Quick reference for view syntax, the value grammar, and component declarations.
Full docs: [`docs/skill/core.md`](./docs/skill/core.md) and friends.

---

## Bootstrap

```js
import { component, html, tutuca } from "tutuca";

const Counter = component({
  name: "Counter",
  fields: { count: 0 },
  receive: {
    inc(draft) { draft.count++; },
  },
  view: html`<button @on.click="inc" @text=".count"></button>`,
});

const app = tutuca("#app");
app.registerComponents([Counter]);
app.state.set(Counter.make({}));   // takes an instance, not plain data
app.start();
```

- `app.onChange(({ val, old, info, timestamp }) => ...)` — fires after every change.
- `app.stop()` / `app.start()` — remove/remount listeners (tests, SPA nav).
- `app.sendAtRoot(name, args)` — dispatch into the tree from outside any element.

---

## Component Declaration

```js
component({
  name: "MyComp",

  fields: { count: 0 },                       // type inferred from default

  view: html`<p @text=".count"></p>`,         // default view ("main")
  views: {
    edit: html`<input :value=".count" @on.input="setCount e.valueAsInt" />`,
    big:  { view: html`...`, style: css`...` },
  },

  style:       css`p { color: blue; }`,       // scoped to main view
  commonStyle: css`p { font-family: ...; }`,  // scoped to all views of this comp
  globalStyle: css`body { margin: 0; }`,      // injected unscoped

  methods: { doubled() { return this.count * 2; } },   // read-only, call with $name
  alter:   { filterItem(_k, item) { return item.length > 0; } }, // pure, per-render

  receive: {                                  // ADDRESSED handlers (own events,
    inc(draft)             { draft.count++; },// ctx.send to me, intent answers:
    setCount(draft, value) { draft.count = value; },     // <name>Ok/Error/Unhandled)
    loadDataOk(draft, res) { draft.items = res; },
  },
  intent:  { itemPicked(draft, item) { draft.selected = item; } }, // ROUTED handlers

  statics: { fromData(d) { return this.make({ count: d.n ?? 0 }); } }, // Comp.fromData()

  provide: { color: ".color" },               // dynamic binding producer (*color)
  lookup:  [{ name: "color", default: "'gray'" }],  // consumer (*color); "Cell" = a type
  // ambient names: app.registerComponents(comps, { paths: { theme: path().field("theme") } })
});
```

### Field types

| Default | Type | Draft update |
|---|---|---|
| `"hi"` | text | `draft.x = v` |
| `42` | float | `draft.x++` |
| `{ type: "int", defaultValue: 0 }` | int | `draft.x = Math.trunc(v)` |
| `true` | bool | `draft.x = !draft.x` |
| `null` | any | `draft.x = v` |
| `[]` | list | `push`, `splice`, … |
| `{}` | object | `draft.x.k = v` |
| `new Map()` | map | `draft.x.set(k, v)` |
| `new Set()` | set | `add`, `delete` |

Child components: `child: Item.make({...})` (in scope) or
`child: { component: "Item", args: {...} }` (forward/circular ref — name is a **string**).

Handler contract: every dispatched handler is called as
`handler(draft, ...args, ctx)` — mutate `draft`, return nothing (or `draft`);
returning another value swaps the addressed value. `this` is the frozen snapshot.

---

## Value Grammar (what goes inside `="..."`)

| Prefix | Means | Example |
|---|---|---|
| `.x` | field on `this` (**single level only** — no `.foo.bar`) | `.count` |
| `$x` | no-arg method on `this` | `$canSubmit` |
| `@x` | loop/scope binding | `@key`, `@value` |
| `^x` | macro parameter | `^label` |
| `*x` | dynamic (context) binding | `*theme` |
| `'str'` | string literal | `'btn ok'` |
| `$'…'` | string template, `{expr}` interpolation | `$'Hi {.name}'` |
| `.s[.k]` | seq/map item access | `.byKey[.currentKey]` |

Boolean predicates (conditional slots only, predicate-first):

```html
@show="empty? .items"      @show="truthy? .query"     @hide="falsy? .x"
@show="null? .x"           @show="equals? .view 'detail'"
```

Quoting rules:

| Form | Example | Valid? |
|---|---|---|
| quoted literal | `:class="'flex gap-3'"` | ✅ |
| string template | `:class="$'flex {.color}'"` | ✅ |
| bare multi-word | `:class="flex gap-3"` | ❌ → `null` |

No path syntax anywhere: use `<x render=".user">`, a method (`$fullName`),
or `@enrich-with` instead of `.user.name`.

---

## Text & Attributes

```html
<span @text=".str"></span>            <!-- text into host element -->
<x text="@value"></x>                 <!-- bare text, no wrapper element -->

<input :value=".str" />               <!-- :attr = dynamic attribute -->
<a :href=".url" :title="$'Hi {.name}'"></a>
<button :class="$'btn {.color}'"></button>
<button disabled=".isLocked"></button><!-- boolean HTML attrs auto-recognized -->

<div @dangerouslysetinnerhtml=".trustedHtml"></div>  <!-- raw HTML escape hatch -->
```

- Static `class="…"` and dynamic `:class`/`@if.class` **cannot coexist** on one element.
- Attribute names are lowercased by the HTML parser — bind custom elements via kebab-case.
- `is=` must be static (applied at element creation).

## Event Handling

```html
<button @on.click="inc">+</button>                    <!-- receive handler -->
<input @on.input="setStr e.value" />                  <!-- event arg -->
<input @on.input="setN e.valueAsInt" />
<button @on.click="pick @key e.altKey">pick</button>  <!-- multiple args -->
<button @on.click="addItem">+</button>                <!-- ctx.lookupType in the handler -->
<form @on.submit+prevent="save">…</form>              <!-- modifier -->
```

- Handler called as `handler(draft, ...args, ctx)` — `ctx` always auto-appended last.
- Args: `e.value`, `e.key`, `e.altKey`, `e.target`, dotted paths like
  `e.target.dataset.slot`; conveniences `e.valueAsInt`, `e.valueAsFloat`,
  `e.isCtrl`/`e.isCmd`, `e.isUpKey`/`e.isDownKey`, `e.isSend`, `e.isCancel`,
  `e.isTabKey`; drag args `dragInfo`, `e.dragInfo`/`e.dragKey`/`e.dragValue`/`e.dragType`.
- `e.value`: checkbox → `checked`; CustomEvent → `detail`; else `target.value`.

Modifiers: `@on.<event>+<mod>+<mod>=...`
Guards: `+ctrl`, `+cmd`/`+meta`, `+alt`; keydown only: `+send` (Enter),
`+cancel` (Escape). Effects: `+prevent`, `+stop`.

```html
<input @on.keydown+send="submit e.value" @on.keydown+cancel="reset" />
<button @on.click+ctrl="soloOnly">ctrl-click</button>
```

## Conditional Display & Dynamic Attributes

```html
<div @show=".isLoading">Loading...</div>
<div @hide=".isLoading">content</div>
<div @show="equals? .view 'detail'">detail</div>

<!-- @if.<attr>: swap an attribute's value -->
<button @if.class=".isActive" @then="'btn btn-success'" @else="'btn btn-ghost'">

<!-- multiple @if on one element: later @then/@else MUST name the attr -->
<button @if.class=".isActive" @then="'on'" @else="'off'"
        @if.title=".isActive" @then.title="'On'" @else.title="'Off'">

<!-- conditional directives also wrap <x> ops -->
<x text=".name" @show=".isOpen"></x>
<x render-it @hide=".isHidden"></x>
```

Views as functions of state — pick which view renders:

```html
<x render=".item" as="edit"></x>          <!-- literal view name -->
<x render=".item" as=".mode"></x>         <!-- chosen by field at runtime -->
<div @push-view=".view"><x render-each=".items"></x></div>
<!-- @push-view applies recursively to all descendants; as= applies to one <x> only -->
```

## Iteration & Enrichment

```html
<li @each=".items"><span @text="@key"></span>: <x text="@value"></x></li>

<li @each=".items" @when="filterItem">...</li>                  <!-- filter (alter) -->
<li @each=".items" @enrich-with="enrichItem"><x text="@count"/></li>
<li @each=".items" @loop-with="getIterData" @when="filterItem">…</li>

<x render-each=".items"></x>                    <!-- list of components -->
<x render-each=".items" as="edit" @when="filterItem"></x>
```

```js
alter: {
  filterItem(_key, item, iterData) { return item.includes(iterData.q); },
  enrichItem(binds, _key, item, iterData) { binds.count = item.length; }, // sets @count
  getIterData(seq, ctx) {           // returns { iterData?, start?, end?, keys? }
    const start = this.page * this.pageSize;
    return { iterData: { q: this.query.toLowerCase() }, start, end: start + this.pageSize };
  },
}
```

Loop binds: `@key`, `@value`. Scope enrichment (no `@each` on the element):

```js
alter: { enrichScope() { return { len: this.text.length }; } }
```
```html
<div @enrich-with="enrichScope">Length: <x text="@len"></x></div>
```

`keys` return = filter-then-paginate, authoritative (skips `@when`);
original keys are preserved through slicing, so events keep identity.

## Rendering Components

```html
<x render=".item"></x>                     <!-- main view -->
<x render=".item" as="edit"></x>           <!-- named view -->
<x render-it></x>                          <!-- inside @each / render-each only -->
<x render=".byIndex[.currentIndex]"></x>   <!-- list access -->
<x render=".byKey[.currentKey]"></x>       <!-- map access -->
<x render="*selected"></x>                 <!-- dynamic binding target -->
```

## Messages & Intents

```js
receive: {
  load(_draft, ctx) {
    ctx.intent("loadData", [this.query], { route: ["lex"] });  // routed request
  },
  loadDataOk(draft, res)     { draft.items = res; },
  loadDataError(draft, err)  { draft.error = String(err); },
}
```

- **Addressed** (sender knows the target): DOM events and
  `ctx.send(name, args)` → land in `receive`.
- **Routed** (sender doesn't know): `ctx.intent(name, args, opts)` → lands in
  `intent`. Routes: `["dyn"]` walk ancestors, `["lex"]` scope-registered
  handlers, default `["dyn","lex"]`.
- Answer arms: `<name>Ok` / `<name>Error` / `<name>Unhandled` in `receive`.
- In an intent handler: `ctx.reply(v)`, `ctx.fail(e)`, `ctx.forward(...)`,
  `ctx.stop()`; `$unknown` is the fallback handler name.
- In a `receive` handler: `ctx.sendReply(name, args)` answers the sender under a
  name the replier picks (a message declares no answer arms).
- `ctx.lookupType(name, opts)` resolves a component type by name, along the same
  `opts.route` legs as an intent; declare the name in `lookup` so lint checks it.

## Macros

```js
import { macro, html } from "tutuca";

const badge = macro(
  { label: "'New'", kind: "'info'" },              // defaults are expressions
  html`<span :class="$'badge badge-{^kind}'" @text="^label"></span>`,
);
export function getMacros() { return { badge }; }

const app = tutuca("#app");
app.registerComponents([Comp]).registerMacros(getMacros());
```

```html
<x:badge></x:badge>                    <!-- defaults -->
<x:badge label="Sale"></x:badge>       <!-- static string -->
<x:badge :label=".status"></x:badge>   <!-- dynamic value -->
```

Slots: `<x:slot></x:slot>` (default) / `<x:slot name="actions"></x:slot>`;
fill them with `<x slot="actions">…</x>` or plain children.
Registry keys are **lowercased**: `<x:Card>` resolves as `<x:card>`.

## Dynamic Bindings (context-style values)

```js
const Theme = component({ name: "Theme", fields: { color: "blue" },
                          provide: { color: ".color" } });
const Child = component({
  lookup: [{ name: "color", default: "'gray'" }],
  view: html`<p :style="$'color: {*color}'"></p>`,
});
```

- `provide` value must be addressable: `.field` or `.seq[.key]` only — it is
  both read as `*name` and used as the path `<x render="*name">` resumes at.
- `*name` works anywhere a value is read, including `<x render="*sel">`
  and `@each="*items"`. No `*name[.key]` indexing form.
- Nearest rendered provider wins; several components may publish one name.
- Editing inside `<x render="*sel">` mutates the producer's value in place;
  bubbling still returns to the component that wrote the `*sel`.
- Ambient names with no provider — register absolute paths on the scope:
  `app.registerComponents(comps, { paths: { theme: path().field("theme") } })`.

## Drag & Drop

```html
<div @each=".items" draggable="true"
     data-dragtype="my-item" data-droptarget="my-item"
     @on.drop="onDrop @key dragInfo event"></div>
```

```js
onDrop(draft, targetKey, dragInfo, e) {
  const sourceKey = dragInfo.lookupBind("key");
  const [item] = draft.items.splice(sourceKey, 1);
  draft.items.splice(targetKey, 0, item);
}
```

Auto-managed styling hooks: `[data-dragging="1"]`, `[data-draggingover="<type>"]`.
Touch supported.

## Pseudo-`x` (inside `<select>` / table family)

The HTML parser strips `<x>` inside `table/thead/tbody/tfoot/tr/colgroup/
select/optgroup`. Prefix the **first** attr of a legal tag with `@x`:

```html
<select>
  <option @x render-each=".items" as="option"></option>
</select>
```

---

## Conventional Module Exports

```js
export function getComponents()      { return [Comp, ...]; }         // required by CLI
export function getMacros()          { return { name: macro }; }     // optional
export function getIntentHandlers()  { return { name: async fn }; }  // optional
export function getRoot()            { return Root.make({...}); }
export function getExamples()        {                               // storybook shape
  return { title, description?,
           items: [{ title, description?, value, view?, intentHandlers? }] };
}
export function getTests({ describe, test, expect }) {}              // optional
```

## Common Pitfalls

- `.field` reads a field; `$method` calls a method — wrong prefix is a lint error.
- No nested paths in templates (`.foo.bar`) — except one binding member read:
  `@text="@value.title"` inside `@each` is allowed (one level).
- `receive.init` is a convention — nothing calls it automatically.
- Multiple `@if.<attr>` per element: every `@then`/`@else` after the first needs the attr suffix.
- Bare unquoted multi-word strings evaluate to `null` — quote or template them.
- `<x>` is stripped inside `<select>`/tables — use `@x` pseudo-x.

## CLI

```sh
tutuca lint <module> [name]                # exit 2 on errors
tutuca test <module> [--grep p] [--bail]   # exit 4 on failures
tutuca render <module> [name] [--title t] [--pretty]  # exit 3 on crash
tutuca show <module> [name] --format md    # API docs
tutuca storybook [dir] --dry-run           # project-wide smoke test
tutuca help <command> · tutuca agent-context
```
