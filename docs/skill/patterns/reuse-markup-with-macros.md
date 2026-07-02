# Reuse markup with macros

**Problem:** the same markup fragment repeats across a view and you want one
definition — but it has no state of its own.

```js
import { macro, html } from "tutuca";

const badge = macro(
  { label: "'New'", kind: "'info'" },                  // defaults are *expressions*
  html`<span :class="$'badge badge-{^kind}'" @text="^label"></span>`,
);

const card = macro(
  { title: "'Card'" },
  html`<div class="card"><h2 @text="^title"></h2><x:slot></x:slot></div>`,
);

export function getMacros() { return { badge, card }; }
```

```html
<x:badge></x:badge>                  <!-- defaults -->
<x:badge label="Sale"></x:badge>     <!-- static string (no quotes needed) -->
<x:badge :label=".status"></x:badge> <!-- bind a field -->
<x:card title="Hi"><p>body</p></x:card>  <!-- children fill <x:slot> -->
```

A macro is pure template expansion — no fields, no handlers. Parameters are
read as `^name`; calls inside the body (`$method`, `.field`) resolve against
the *host* component. `<x:slot>` (or `<x:slot name="…">` for named slots)
receives the caller's children. Register with `scope.registerMacros(...)`;
registry keys are lowercased (`<x:Card>` → `card`). Full semantics (named
slots, quoting of parameter values) in [macros.md](../macros.md). For repeated
markup that *does* need state, use a child component instead (see the
render-a-child-component recipe).
