# Iterate a list

**Problem:** render one element per item in a list/map field.

```html
<!-- a host element per item: @key and @value are bound in the loop -->
<li @each=".items"><span @text="@key"></span>: <x text="@value"></x></li>

<!-- a child component per item -->
<x render-each=".items"></x>
<div @each=".items"><x render-it></x></div>
```

`@each` accepts a `.field` or a `*dynamic` (not a `$method` — a method result
has no addressable path for event dispatch). `@key`/`@value` are auto-bound on
host-element loops; under `render-each` / `render-it` each item is rendered as
its own component (no `@value`). Use `render-each` for lists of components,
`@each` for plain values.

**Reference:** [core.md#list-iteration](../core.md#list-iteration) ·
**Runnable:** [examples/list-iteration.js](../../examples/list-iteration.js)
