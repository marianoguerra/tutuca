# Edit through a dynamic target

**Problem:** render a value owned by a distant ancestor *and* let edits made in
the child land back on the owner — without forwarding events up by hand.

```js
// producer exposes a field (or a seq-access) as a dynamic
const Workspace = component({
  name: "Workspace",
  fields: { sheet: null },
  provide: { active: ".sheet" },                       // or ".items[.selectedKey]"
});

// a distant consumer renders it as a target
const Toolbar = component({
  name: "Toolbar",
  lookup: [{ name: "active", default: ".missing" }],
  view: html`<x render="*active" as="edit"></x>`,
});
```

Because `*active` carries a real **path** alongside its value (not a copy),
rendering it *resumes* there: the render site pushes `Workspace.sheet` as the
active position, so an event fired inside the rendered child mutates
`Workspace.sheet` itself, and the owner and any other view of the same value
update in lock-step. Bubbling still returns to the `Toolbar` that wrote the
`*active`, so an unhandled message keeps walking the visual ancestry.

A `provide` can point at a seq-access (`.items[.selectedKey]`) to expose "the
selected item", and a nested provider of the same name shadows an outer one for
its own subtree. This is the **edit** counterpart of the
share-state-across-the-tree recipe.
