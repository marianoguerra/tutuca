# Tutuca — Advanced Topics

Reach this file only when the task touches drag & drop, context-style
"dynamic bindings", pseudo-`x` (the `<x>`-stripping workaround inside
`<select>`/`<table>`/`<tr>`), registering a custom seq type, or
compiling Tailwind / MargaUI classes. For everything else, `core.md`
is the right place.

## Drag and Drop

```html
<div
  @each=".items"
  draggable="true"
  data-dragtype="my-item"
  data-droptarget="my-item"
  @on.drop="onDrop @key dragInfo event"
></div>
```

```js
input: {
  onDrop(targetKey, dragInfo, e) {
    const sourceKey = dragInfo.lookupBind("key");   // any bind from source render
    return this.setItems(this.items.moveKeyBeforeKey(sourceKey, targetKey));
  },
}
```

Tutuca auto-manages two attrs during a drag — style them with CSS:

```css
[data-dragging="1"] {
  opacity: 0.5;
}
[data-draggingover="my-item"] {
  outline: 1px dashed;
}
```

Touch is wired up too (drag fires after a small move threshold).

## Dynamic Bindings

For passing values "context-style" through nested components without prop
drilling. **`provide`** on the producer; **`lookup`** on consumers;
resolve as `*name`.

> **Best practice:** keep state local to the component and reach for
> `provide` / `lookup` only when it is genuinely the only solution. Dynamic
> bindings couple a consumer to a producer that may not be in scope — prefer
> keeping components as self-contained as possible: pass props down explicitly
> when the chain is short, and lift state only as far as it actually needs to
> live.

```js
const Theme = component({
  name: "Theme",
  fields: { color: "blue" },
  provide: { color: ".color" },
});
const Child = component({
  lookup: { color: { for: "Theme.color", default: "'gray'" } },
  view: html`<p :style="$'color: {*color}'"></p>`,
});
```

A **`provide`** maps an exported name to a field expression. Every
provide is evaluated and pushed onto the dynamic stack automatically
when the producer is entered during render — there is no hook to opt in.

A **`lookup`** reads a value the `*name` way: the key is the name used
in views (`*color`), the value is `"Producer.provideName"`, or
`{ for: "Producer.provideName", default: ".field" }` to supply a
fallback when no producer is in scope (default is optional — without it
a miss resolves to `null`). A `*name` that names the component's own
`provide` resolves to the nearest provided value (including its own).

### Dynamic vars as render targets

A `*name` dynamic var resolves to a value, so it works anywhere a value
is read — not just in `:style` / `:class`. In particular it can be a
component-render target and an iteration source:

```html
<x render="*selected"></x>           <!-- render the dynamic's component -->
<x render="*selected" as="edit"></x> <!-- a specific view of it -->
<div @each="*items"><x render-it></x></div>  <!-- iterate a dynamic seq -->
```

A `provide` value must be **addressable** — a `.field` or a `.seq[.key]`
seq-access, nothing else. (It is both read as `*name` *and* used as a
render-target / teleport path, so a method or constant — which has no
path — is a lint error.) A `lookup` `default`, by contrast, is only a
value fallback and accepts the full grammar, including constants like
`'gray'`. A `provide` can be a sequence/map item access:

```js
const Root = component({
  name: "Root",
  fields: { items: IMap(), selectedKey: "" },
  provide: {
    items: ".items",                  // the whole sequence
    selected: ".items[.selectedKey]", // seq-access to one entry
  },
});
```

There is **no `*name[.key]` form** — a consumer never indexes a dynamic
var. The seq-access lives in the producer's `provide` declaration; the
consumer just reads the resolved value as `*name`.

**Teleporting.** The component rendered via `<x render="*selected">`
physically lives at the producer (e.g. `Root.items`), not under the
consumer. When an event fires inside that dynamically-rendered subtree,
the runtime expands the *render* path (consumer → … → the rendered
node) to reconstruct the handler, but the *transaction* is teleported:
the mutation skips the intermediate components and lands on the
producer's data. Editing the entry in the consumer and the same entry
in the producer's own view update in lock-step.

## Pseudo-`x` (`@x`)

Tutuca's special operations (`render`, `render-it`, `render-each`, `text`,
`show`, `hide`, `slot`) live on the `<x>` tag. That works almost
everywhere, but the browser's HTML parser refuses to keep `<x>` (or any
unknown tag) as a child of certain elements: `<select>` only allows
`<option>` / `<optgroup>`, `<table>` only allows `<thead>` / `<tbody>` /
`<tr>`, `<tr>` only allows `<th>` / `<td>`, etc. Drop `<x render-each>`
inside one of those and the parser silently strips it.

The escape hatch: prefix the **first** attribute on a *legal* tag with
`@x`. Tutuca treats that tag as if it were `<x>` and reads the next
attribute as the special op.

```html
<!-- ❌ <x> stripped by the HTML parser inside <select> -->
<select>
  <x render-each=".items" as="option"></x>
</select>

<!-- ✅ pseudo-x: <option @x render-each=".items" as="option"> -->
<select>
  <option @x render-each=".items" as="option"></option>
</select>
```

Notes:

- `@x` must be the **first** attribute; the special op (`render-each`,
  `render`, `text`, `show`, ...) is the second.
- The host tag (here `<option>`) is otherwise ignored — only the special
  op runs. Tutuca produces the rendered children directly.
- Same trick works inside `<tr>`, `<table>`, `<colgroup>`, `<dl>`,
  `<details>`, or anywhere else the parser would discard `<x>`.

## Registering a custom seq type

To make `@each` recognize your own collection class, install a
`SEQ_INFO` walker on its prototype:

```js
import { SEQ_INFO } from "tutuca";

class MyClass {
  // ...
}
MyClass.prototype[SEQ_INFO] = (seq, visit) => {
  for (const [k, v] of seq.entries()) visit(k, v, "data-sk");
};
```

`SEQ_INFO` is `Symbol.for("tutuca.seqInfo")`, so the same identity
is shared across module graphs (source vs. bundled tutuca). The
renderer reads `seq[SEQ_INFO]` directly (no `.constructor` lookup),
which is why the walker goes on the prototype, not as a static.

The third arg to `visit` is the data attribute used for stable-key
diffing (typically `"data-sk"` for "sequence key").

## Tailwind / MargaUI Class Compilation (extra build)

```js
import { compileClassesToStyleText, injectCss, tutuca } from "tutuca/extra";
import { compile } from "https://cdn.jsdelivr.net/npm/margaui/+esm";

const app = tutuca("#app");
app.registerComponents([Comp]);
const css = await compileClassesToStyleText(app, compile);
injectCss("myapp", css);
app.start();
```

`compileClassesToStyleText` walks every registered component's templates,
collects the `class=` and `:class=` literals, hands them to a `compile`
function (any margaui-compatible signature), and returns CSS text. Pair
with `injectCss(scopeName, css)` to install the result before `start()`.

If a margaui skill is available, load it alongside this one when
authoring class lists — it lists the available components and their
canonical class strings, which is what the `compile` step expects.

**Pitfall: `@if.class` payloads are invisible to the scanner.** Classes
inside `@then` / `@else` (e.g. `@if.class=".active" @then="'btn-success'"
@else="'btn-ghost'"`) are not literals in `class=` / `:class=`, so
`compileClassesToStyleText` skips them and the margaui CSS for those
classes is never emitted — the conditional class renders unstyled.
Workaround: add a hidden "decoy" view on the component that lists every
conditional class as a real literal, so the walker picks them up:

```js
_margauiClasses: html`<p class="btn-success btn-ghost on off"></p>`,
```

The view does not need to be rendered anywhere — registration is enough
for the template walker to find it.
