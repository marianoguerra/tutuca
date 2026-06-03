# Share state without prop-drilling

**Problem:** a deep descendant needs a value owned by a distant ancestor, and
you don't want to thread it through every component in between.

```js
// producer — exposes one of its fields under a name
const Producer = component({
  name: "EntryEditorAndSelector",
  fields: { items: [] },
  provide: { entries: ".items" },
});

// consumer — forwards to the producer's binding by "Component.name"
const Consumer = component({
  name: "Selector",
  lookup: { entries: { for: "EntryEditorAndSelector.entries", default: ".items" } },
});
```

```html
<!-- read the dynamic with the * prefix — iterate or render it -->
<option @each="*entries" :value="@value" @text="@label"></option>
```

`provide` publishes a field under a name; a descendant's `lookup` resolves
`*name` to the nearest matching producer, falling back to `default` when none
is in scope. `*name` works wherever a `.field` does for iteration/rendering.
This is the **read** side; to edit the producer's value through the dynamic,
see the edit-through-a-dynamic-target recipe.
