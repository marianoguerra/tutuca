# Tutuca — Macros

Macros are pure template expansion — no state, no methods. Calls inside
a macro resolve against the *host* component. Read this file when
authoring `macro({...}, html)` definitions, `<x:name>` calls, or slots.

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

Inside the macro body, `^param` reads a parameter. Static attributes
(`label="Sale"`) pass the raw string; dynamic attributes (`:label=…`)
take the same value forms as any binding — see *Quoting & String
Literals* in [core.md](./core.md) for the literal-vs-template rules.

Register macros at the same scope as components:

```js
const scope = app.registerComponents([Comp]);
scope.registerMacros(getMacros());
```

Registry keys are lowercased on insert because the HTML parser already
lowercases `<x:Tag>` to `<x:tag>`. `{ Card }` and `{ card }` both register
under `card`; registering two *different* macros under the same lowercased
name warns via `console.assert`.

## Slots

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

## Named Slots

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

## See also

- [patterns/reuse-markup-with-macros.md](./patterns/reuse-markup-with-macros.md) —
  the minimal recipe form of the badge example.
- [core.md](./core.md) — notation, quoting rules, and the component
  primer the macro body plugs into.
