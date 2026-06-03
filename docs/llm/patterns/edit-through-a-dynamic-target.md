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
  lookup: { active: { for: "Workspace.active", default: ".missing" } },
  view: html`<x render="*active" as="edit"></x>`,
});
```

Because `*active` resolves to a real **path** (not a copied value), the event
fired inside the rendered child is *teleported*: the mutation skips the
intermediate components and lands on `Workspace.sheet`, so the owner and any
other view of the same value update in lock-step. A `provide` can even point at
a seq-access (`.items[.selectedKey]`) to expose "the selected item". This is
the **edit** counterpart of
[share-state-without-prop-drilling.md](share-state-without-prop-drilling.md).

**Reference:** [advanced.md#dynamic-vars-as-render-targets](../advanced.md#dynamic-vars-as-render-targets),
[semantics.md#dynamic-var-teleporting](../semantics.md#dynamic-var-teleporting) ·
**Runnable:** [examples/dynamic-path.js](../../examples/dynamic-path.js),
[examples/dynamic-selected-edit.js](../../examples/dynamic-selected-edit.js)
