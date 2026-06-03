# Switch between views

**Problem:** render the *same* component in a different view (e.g. a read-only
"main" vs an "edit" form).

```js
component({
  view:  html`<p @text=".title"></p>`,                  // "main"
  views: { edit: html`<input :value=".title" @on.input="$setTitle value" />` },
});
```

```html
<!-- as= picks the view for one <x render> element only -->
<x render=".value"></x>
<x render=".value" as="edit"></x>

<!-- @push-view forces a view on every component rendered under the host -->
<div @push-view=".view"><x render-each=".items"></x></div>
```

`as="edit"` applies to the direct component only and falls back to `main` if
the view is absent. `@push-view` pushes a view name onto the render stack so
every descendant picks the first matching view (else `main`) — use it to flip a
whole subtree (e.g. a list) into edit mode at once. To toggle *sibling panels*
by a field instead, see [tabbed-interface.md](tabbed-interface.md).

**Reference:** [core.md#multiple-views--view-stack](../core.md#multiple-views--view-stack) ·
**Runnable:** [examples/multiple-views.js](../../examples/multiple-views.js),
[examples/push-view.js](../../examples/push-view.js)
