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
drilling. Define on the producer; alias on consumers; resolve as `*name`.

```js
const Theme = component({
  name: "Theme",
  fields: { color: "blue" },
  dynamic: { color: ".color" },
  on: {
    stackEnter() {
      return ["color"];
    },
  },
});
const Child = component({
  dynamic: { color: { for: "Theme.color", default: "'gray'" } },
  view: html`<p :style="$'color: {*color}'"></p>`,
});
```

`on.stackEnter()` is required only on the **producer** (the component
declaring `dynamic: { name: ".field" }` to expose a value). It returns
the list of dynamic-binding names this component pushes onto the stack
when entering its render. Consumers (which only alias via
`{ for: "Producer.name", default: ... }`) don't need it.

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
