# Render a child component

**Problem:** a component holds another component in a field and wants to render
it (reaching into nested data is not allowed — `@text=".child.name"` fails).

```js
fields: { greeting: Greeting.make({ name: "world" }) },
```

```html
<x render=".greeting"></x>           <!-- default ("main") view -->
<x render=".greeting" as="edit"></x> <!-- a named view -->
```

The child draws its own view from its own fields, so inside `Greeting`'s view
`@text=".name"` reads the child's `name`. This is the idiomatic way to display
nested structure: make the nested thing a component and render it, rather than
trying to path into it. For a list of children use `render-each`
([iterate-a-list.md](iterate-a-list.md)); to flip which view renders, see
[switch-between-views.md](switch-between-views.md).

**Reference:** [core.md#rendering-components](../core.md#rendering-components) ·
**Runnable:** [examples/render-child.js](../../examples/render-child.js),
[examples/multiple-views.js](../../examples/multiple-views.js)
